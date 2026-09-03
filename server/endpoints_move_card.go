package cards

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/markdown"
	"tinycld.org/core/yjsdoc"
)

// Moving a card to ANOTHER board.
//
// A within-board move is one PATCH the rules admit. A cross-board move is not
// expressible from the client at all: cards_cards.update pins `project`
// (1980000000, trap 2), and every child row — checklist items, comments,
// attachments — carries the same denormalized `project` behind the same pin.
// So the move is an endpoint that does the whole thing in one transaction
// with the DAO, which bypasses rules, and restates the authorization in Go:
// a writer on the source board AND a writer on the target.
//
// What travels: the card and everything under it. What is REMAPPED: labels
// match the target board's labels by name (case-insensitive) and the rest are
// dropped; assignees and the reporter stay only if they are members of the
// target. What is REISSUED: the number — card_number.go re-keys on a project
// change, so OTTER-12 becomes FOX-31 and the old key is simply gone.
//
// The description lives in the SOURCE board's realtime document while that
// board is open. The room is flushed first so the record is current, then the
// source's baseline is set to what was flushed so later flushes skip the
// lingering fragment, and the target room — if open — is seeded with the
// card's fragment and told about it. A closed target room seeds from the
// record at its next bootstrap, like every other card.

type moveCardRequest struct {
	ProjectID string `json:"project_id"`
	ListID    string `json:"list_id"`
	Position  string `json:"position"`
}

type moveCardResponse struct {
	Card          map[string]any `json:"card"`
	PreviousKey   string         `json:"previous_key"`
	DroppedLabels []string       `json:"dropped_labels"`
}

// boardRealtime is what registerRealtime hands the endpoint: enough to flush
// the source room and seed the target's document.
type boardRealtime struct {
	state    *boardDocState
	runtime  *yjsdoc.Runtime
	flushNow func(roomID string) error
}

func isProjectWriter(app core.App, projectID, userID string) bool {
	if projectID == "" || userID == "" {
		return false
	}
	n, err := app.CountRecords("cards_project_members", dbx.And(
		dbx.HashExp{"project": projectID, "user": userID},
		dbx.In("role", "owner", "editor"),
	))
	return err == nil && n > 0
}

func bindCardRoutes(e *core.ServeEvent, rt *boardRealtime) {
	e.Router.POST("/api/cards/cards/{id}/move", func(re *core.RequestEvent) error {
		return handleMoveCard(e.App, rt, re)
	}).BindFunc(requireAuth)
}

func handleMoveCard(app core.App, rt *boardRealtime, re *core.RequestEvent) error {
	var body moveCardRequest
	if err := json.NewDecoder(re.Request.Body).Decode(&body); err != nil {
		return re.BadRequestError("invalid request body", nil)
	}
	if body.ProjectID == "" || body.ListID == "" || strings.TrimSpace(body.Position) == "" {
		return re.BadRequestError("project_id, list_id and position are required", nil)
	}

	cardID := re.Request.PathValue("id")
	card, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		return re.NotFoundError("card not found", nil)
	}
	source := card.GetString("project")
	// A non-member of the source cannot tell the card exists: 404, the same
	// answer the rules give a read.
	if !isProjectWriter(app, source, re.Auth.Id) {
		if member, _ := app.CountRecords("cards_project_members",
			dbx.HashExp{"project": source, "user": re.Auth.Id}); member == 0 {
			return re.NotFoundError("card not found", nil)
		}
		return re.ForbiddenError("only an editor or owner can move a card", nil)
	}
	if source == body.ProjectID {
		return re.BadRequestError("the card is already on that board; use an ordinary move", nil)
	}
	if !isProjectWriter(app, body.ProjectID, re.Auth.Id) {
		return re.ForbiddenError("you cannot add cards to that board", nil)
	}
	list, err := app.FindRecordById("cards_lists", body.ListID)
	if err != nil || list.GetString("project") != body.ProjectID {
		return re.BadRequestError("list_id must name a list on the target board", nil)
	}

	// The description is current only once the source room has flushed.
	if rt != nil && rt.flushNow != nil {
		if err := rt.flushNow(source); err != nil {
			activityLog.Warn("move: source flush failed", "card", cardID, "error", err)
		}
		card, err = app.FindRecordById("cards_cards", cardID)
		if err != nil {
			return re.NotFoundError("card not found", nil)
		}
	}

	previousKey := ""
	if slugRow, err := app.FindRecordById("cards_projects", source); err == nil {
		previousKey = formatCardKey(slugRow.GetString("slug"), card.GetInt("number"))
	}

	kept, dropped := remapLabels(app, card.GetStringSlice("labels"), body.ProjectID)
	assignees := membersOnly(app, body.ProjectID, card.GetStringSlice("assignees"))
	reporter := card.GetString("reporter")
	if reporter != "" && len(membersOnly(app, body.ProjectID, []string{reporter})) == 0 {
		reporter = ""
	}

	err = app.RunInTransaction(func(tx core.App) error {
		card.Set("project", body.ProjectID)
		card.Set("list", body.ListID)
		card.Set("position", body.Position)
		card.Set("labels", kept)
		card.Set("assignees", assignees)
		card.Set("reporter", reporter)
		if err := tx.Save(card); err != nil {
			return err
		}
		for _, child := range []string{"cards_checklist_items", "cards_comments", "cards_attachments", "cards_activity", "cards_card_watchers"} {
			rows, err := tx.FindRecordsByFilter(child, "card = {:card}", "", 0, 0, dbx.Params{"card": cardID})
			if err != nil {
				return err
			}
			for _, row := range rows {
				row.Set("project", body.ProjectID)
				if err := tx.Save(row); err != nil {
					return err
				}
			}
		}
		// Watchers who cannot see the target board must not keep following.
		watchers, err := tx.FindRecordsByFilter("cards_card_watchers", "card = {:card}", "", 0, 0, dbx.Params{"card": cardID})
		if err != nil {
			return err
		}
		for _, w := range watchers {
			if len(membersOnly(tx, body.ProjectID, []string{w.GetString("user")})) == 0 {
				if err := tx.Delete(w); err != nil {
					return err
				}
			}
		}
		writeActivity(tx, card, re.Auth.Id, "moved_board", previousKey, "")
		return nil
	})
	if err != nil {
		return re.InternalServerError("failed to move card", err)
	}

	handoffDescription(app, rt, source, body.ProjectID, card)

	fresh, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		return re.InternalServerError("failed to reload card", err)
	}
	return re.JSON(http.StatusOK, moveCardResponse{
		Card:          fresh.PublicExport(),
		PreviousKey:   previousKey,
		DroppedLabels: dropped,
	})
}

// remapLabels matches the card's labels to the target board's by name.
func remapLabels(app core.App, labelIDs []string, targetProject string) (kept []string, droppedNames []string) {
	kept = []string{}
	droppedNames = []string{}
	if len(labelIDs) == 0 {
		return kept, droppedNames
	}
	targets, err := app.FindRecordsByFilter("cards_labels", "project = {:p}", "", 0, 0, dbx.Params{"p": targetProject})
	if err != nil {
		return kept, droppedNames
	}
	byName := map[string]string{}
	for _, t := range targets {
		byName[strings.ToLower(strings.TrimSpace(t.GetString("name")))] = t.Id
	}
	for _, id := range labelIDs {
		label, err := app.FindRecordById("cards_labels", id)
		if err != nil {
			continue
		}
		name := label.GetString("name")
		if target, ok := byName[strings.ToLower(strings.TrimSpace(name))]; ok {
			kept = append(kept, target)
		} else {
			droppedNames = append(droppedNames, name)
		}
	}
	return kept, droppedNames
}

// membersOnly keeps the ids that hold a membership on the project.
func membersOnly(app core.App, projectID string, userIDs []string) []string {
	out := []string{}
	for _, id := range userIDs {
		if id == "" {
			continue
		}
		n, err := app.CountRecords("cards_project_members", dbx.HashExp{"project": projectID, "user": id})
		if err == nil && n > 0 {
			out = append(out, id)
		}
	}
	return out
}

// handoffDescription moves the card's collaborative text between rooms.
//
// Source: the fragment lingers until the room closes, and a flush would find
// it "changed" relative to no baseline and try to write it to a card that now
// belongs elsewhere (saveDescription refuses, loudly). Setting the baseline to
// the flushed text keeps every later flush silent unless someone edits the
// stale fragment — and even then the refusal stands.
//
// Target: an open room was bootstrapped before this card existed there, so
// its fragment is seeded now and the update is published to every client in
// the room. A closed room needs nothing; bootstrap seeds from the record.
func handoffDescription(app core.App, rt *boardRealtime, source, target string, card *core.Record) {
	if rt == nil {
		return
	}
	description := card.GetString("description")
	serialized := markdown.FromPM(markdown.ToPM(description))
	if rt.state != nil {
		rt.state.setBaseline(source, card.Id, serialized)
	}
	if rt.runtime == nil || description == "" {
		return
	}
	handle := rt.runtime.HandleFor(target)
	if handle == nil {
		return
	}
	pmJSON, err := json.Marshal(markdown.ToPM(description))
	if err != nil {
		return
	}
	err = handle.WithDoc(func(doc *yjsdoc.Doc) error {
		return yjsdoc.SeedFragmentFromPMJSON(doc, cardFragment(card.Id), pmJSON)
	})
	if err != nil {
		activityLog.Warn("move: could not seed the target fragment", "card", card.Id, "error", err)
		return
	}
	if rt.state != nil {
		rt.state.setBaseline(target, card.Id, serialized)
	}
	if room := rt.runtime.RoomFor(target); room != nil {
		if update, err := handle.EncodeStateAsUpdate(); err == nil {
			if err := room.PublishDocUpdate(update); err != nil {
				activityLog.Warn("move: could not publish the seeded fragment", "card", card.Id, "error", err)
			}
		}
	}
}
