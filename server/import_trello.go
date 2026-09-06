package boards

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// Reading a Trello board export into the shapes endpoints_import.go writes.
//
// Kept separate from the writing half so this file is pure: it takes bytes and
// returns a board plus what it had to drop, touching no database. That is what
// lets the golden-file tests read a real Trello export and assert the whole
// mapping without a PocketBase app.
//
// Trello's JSON is the "Export JSON" a board's menu produces. Only the parts
// that map onto a boards board are read; the rest (power-ups, stickers,
// backgrounds, member avatars) is ignored rather than rejected, because an
// export carries a great deal that has no counterpart here and refusing a file
// for containing it would make the importer useless.

// trelloBoard is the subset of Trello's export this reads.
type trelloBoard struct {
	Name       string            `json:"name"`
	Lists      []trelloList      `json:"lists"`
	Cards      []trelloCard      `json:"cards"`
	Labels     []trelloLabel     `json:"labels"`
	Checklists []trelloChecklist `json:"checklists"`
	Actions    []trelloAction    `json:"actions"`
	Members    []trelloMember    `json:"members"`
}

type trelloList struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Pos    float64 `json:"pos"`
	Closed bool    `json:"closed"`
}

type trelloCard struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Desc      string   `json:"desc"`
	IDList    string   `json:"idList"`
	Pos       float64  `json:"pos"`
	Closed    bool     `json:"closed"`
	Due       string   `json:"due"`
	Start     string   `json:"start"`
	IDLabels  []string `json:"idLabels"`
	IDMembers []string `json:"idMembers"`
}

type trelloLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type trelloChecklist struct {
	ID         string            `json:"id"`
	IDCard     string            `json:"idCard"`
	Pos        float64           `json:"pos"`
	CheckItems []trelloCheckItem `json:"checkItems"`
}

type trelloCheckItem struct {
	Name  string  `json:"name"`
	State string  `json:"state"` // "complete" | "incomplete"
	Pos   float64 `json:"pos"`
}

// trelloAction is the one place a comment lives in a Trello export: the board's
// action log, filtered to type "commentCard".
type trelloAction struct {
	Type string `json:"type"`
	Date string `json:"date"`
	Data struct {
		Text string `json:"text"`
		Card struct {
			ID string `json:"id"`
		} `json:"card"`
	} `json:"data"`
	MemberCreator trelloMember `json:"memberCreator"`
}

type trelloMember struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
	Username string `json:"username"`
}

// TRELLO_COLORS maps Trello's named label colours onto the hex the board's
// palette speaks. Anything unrecognised — Trello ships shades this list does
// not enumerate, and a label may carry no colour at all — falls back to grey
// rather than failing the import: a wrong colour is one click to fix, and a
// refused board is not.
var trelloColors = map[string]string{
	"green":  "#22c55e",
	"yellow": "#eab308",
	"orange": "#f97316",
	"red":    "#ef4444",
	"purple": "#a855f7",
	"blue":   "#3b82f6",
	"sky":    "#0ea5e9",
	"lime":   "#84cc16",
	"pink":   "#ec4899",
	"black":  "#334155",
}

const trelloFallbackColor = "#94a3b8"

// doneListNames are the list names that read as finished work.
//
// Trello has no status categories, so every imported list would otherwise land
// as `todo` — which would make the board's closed-card behaviour (no reminders,
// never overdue, hidden from My cards) wrong for the column that most needs it.
// Guessing is right here for the reason the plan gives: a wrong guess is one
// menu click, an unguessed board is N.
//
// Matched on the WHOLE trimmed name, case-insensitively, not as a substring —
// "Done" is a done column but "Done thinking, now build" is not, and
// "Definition of Done" certainly is not.
var doneListNames = map[string]bool{
	"done": true, "complete": true, "completed": true, "finished": true,
	"shipped": true, "released": true, "closed": true, "live": true,
}

var inProgressListNames = map[string]bool{
	"doing": true, "in progress": true, "in-progress": true, "wip": true,
	"working": true, "started": true, "in review": true, "review": true,
	"testing": true, "qa": true,
}

var backlogListNames = map[string]bool{
	"backlog": true, "ideas": true, "someday": true, "icebox": true,
	"later": true, "on hold": true,
}

// categoryForListName guesses a list's status category from what it is called.
func categoryForListName(name string) string {
	switch key := strings.ToLower(strings.TrimSpace(name)); {
	case doneListNames[key]:
		return "done"
	case inProgressListNames[key]:
		return "in_progress"
	case backlogListNames[key]:
		return "backlog"
	default:
		return "todo"
	}
}

// importReport is what the importer had to decide or drop, so the response can
// say what it DID rather than leaving the user to compare two boards by eye.
// The move endpoint's contract, one collection over.
type importReport struct {
	// The Trello members whose assignments could not be carried. Trello member
	// ids mean nothing here, so every card imports unassigned; naming the
	// people lets someone re-assign deliberately instead of discovering the
	// gap later.
	DroppedAssignees []string
	// Lists whose category was guessed as something other than `todo`, so a
	// wrong guess is visible rather than silent.
	GuessedCategories map[string]string
	// Cards Trello had archived. They import archived too, and saying so
	// explains a card count that does not match what the board looked like.
	ArchivedCards int
	// Cards naming a list the file never defined. They have nowhere to go, so
	// they are left out — but named, because a card silently missing from an
	// import is the failure someone discovers weeks later.
	Orphaned []string
}

// parseTrelloBoard turns a Trello export into the same shape the JSON export
// produces, so both formats meet the writer through one door.
//
// Ranks are REGENERATED rather than translated. Trello's `pos` is a float and
// this key space is fracdex strings; sorting by pos and laying down a fresh
// ascending sequence preserves the only thing pos actually meant — the order.
func parseTrelloBoard(raw []byte) (exportedBoard, importReport, error) {
	var t trelloBoard
	if err := json.Unmarshal(raw, &t); err != nil {
		return exportedBoard{}, importReport{}, fmt.Errorf("not a readable Trello export: %w", err)
	}
	if len(t.Lists) == 0 && len(t.Cards) == 0 {
		return exportedBoard{}, importReport{}, fmt.Errorf("this file has no lists or cards — is it a Trello board export?")
	}

	report := importReport{GuessedCategories: map[string]string{}}
	board := exportedBoard{
		Name:   strings.TrimSpace(t.Name),
		Labels: []exportedLabel{},
		Lists:  []exportedList{},
		Cards:  []exportedCard{},
	}
	if board.Name == "" {
		board.Name = "Imported board"
	}

	// Labels first: a card names them by id, and Trello permits several labels
	// with the same name while boards_labels is UNIQUE on (project, name). So
	// they are folded by trimmed-lowercase name, and every id that folded into
	// one keeps pointing at it.
	labelIDForName := map[string]string{}
	// Every Trello label id → the id of the label it folded into. A card names
	// its labels by id, so the aliases are what keep those references pointing
	// at the surviving row.
	labelAlias := map[string]string{}
	for _, l := range t.Labels {
		name := strings.TrimSpace(l.Name)
		if name == "" {
			// A Trello label may be a bare colour with no name. There is
			// nothing to call it here and a blank name fails the field's
			// min-length, so the colour becomes the name.
			name = l.Color
		}
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if existing, ok := labelIDForName[key]; ok {
			labelAlias[l.ID] = existing
			continue
		}
		color, ok := trelloColors[l.Color]
		if !ok {
			color = trelloFallbackColor
		}
		board.Labels = append(board.Labels, exportedLabel{ID: l.ID, Name: name, Color: color})
		labelIDForName[key] = l.ID
		labelAlias[l.ID] = l.ID
	}

	lists := append([]trelloList(nil), t.Lists...)
	sort.SliceStable(lists, func(i, j int) bool { return lists[i].Pos < lists[j].Pos })
	listRanks, err := ranksAppending("", len(lists))
	if err != nil {
		return exportedBoard{}, report, err
	}
	// A Trello list can be archived ("closed"). Boards has no archived list, so
	// it imports as an ordinary column — dropping it would strand its cards,
	// which is worse than a column the user can delete.
	for i, l := range lists {
		category := categoryForListName(l.Name)
		if category != "todo" {
			report.GuessedCategories[l.Name] = category
		}
		board.Lists = append(board.Lists, exportedList{
			ID:       l.ID,
			Name:     strings.TrimSpace(l.Name),
			Position: listRanks[i],
			Category: category,
		})
	}

	checklistsByCard := map[string][]exportedChecklistItem{}
	checklists := append([]trelloChecklist(nil), t.Checklists...)
	sort.SliceStable(checklists, func(i, j int) bool { return checklists[i].Pos < checklists[j].Pos })
	for _, cl := range checklists {
		items := append([]trelloCheckItem(nil), cl.CheckItems...)
		sort.SliceStable(items, func(i, j int) bool { return items[i].Pos < items[j].Pos })
		// Boards has ONE checklist per card, Trello has many. They concatenate
		// in board order rather than the importer picking one — a card's items
		// are the point, and the grouping is recoverable by eye from the names.
		for _, item := range items {
			name := strings.TrimSpace(item.Name)
			if name == "" {
				continue
			}
			checklistsByCard[cl.IDCard] = append(checklistsByCard[cl.IDCard], exportedChecklistItem{
				Title:  name,
				IsDone: item.State == "complete",
			})
		}
	}

	commentsByCard := map[string][]exportedComment{}
	actions := append([]trelloAction(nil), t.Actions...)
	sort.SliceStable(actions, func(i, j int) bool { return actions[i].Date < actions[j].Date })
	for _, a := range actions {
		if a.Type != "commentCard" {
			continue
		}
		text := strings.TrimSpace(a.Data.Text)
		if text == "" {
			continue
		}
		// The author is recorded in the BODY, not the author field: Trello's
		// member ids resolve to nobody here, and attributing a comment to the
		// importing user would put words in their mouth. The writer sets the
		// author to the importer and this line says who actually wrote it.
		if who := trelloMemberName(a.MemberCreator); who != "" {
			text = fmt.Sprintf("**%s** wrote on Trello:\n\n%s", who, text)
		}
		commentsByCard[a.Data.Card.ID] = append(commentsByCard[a.Data.Card.ID], exportedComment{
			Body:    text,
			Created: a.Date,
		})
	}

	// Cards are ranked per LIST, since `position` orders within a column.
	cardsByList := map[string][]trelloCard{}
	for _, c := range t.Cards {
		cardsByList[c.IDList] = append(cardsByList[c.IDList], c)
	}
	dropped := map[string]bool{}
	memberNames := map[string]string{}
	for _, m := range t.Members {
		memberNames[m.ID] = trelloMemberName(m)
	}
	for _, l := range board.Lists {
		cards := cardsByList[l.ID]
		sort.SliceStable(cards, func(i, j int) bool { return cards[i].Pos < cards[j].Pos })
		cardRanks, err := ranksAppending("", len(cards))
		if err != nil {
			return exportedBoard{}, report, err
		}
		for i, c := range cards {
			for _, id := range c.IDMembers {
				name := memberNames[id]
				if name == "" {
					name = id
				}
				dropped[name] = true
			}
			if c.Closed {
				report.ArchivedCards++
			}
			board.Cards = append(board.Cards, exportedCard{
				ID:          c.ID,
				List:        l.ID,
				Position:    cardRanks[i],
				Title:       trelloCardTitle(c.Name),
				Description: c.Desc,
				Start:       dayText(c.Start),
				Due:         trelloDue(c.Due),
				Archived:    c.Closed,
				Labels:      resolveLabelIDs(c.IDLabels, labelAlias),
				Checklist:   checklistsByCard[c.ID],
				Comments:    commentsByCard[c.ID],
			})
		}
	}

	// Cards whose list is not in the file were never placed above. Reported
	// here, where the drop actually happens, rather than left for the writer to
	// notice an absence it has no way to see.
	placed := map[string]bool{}
	for _, l := range board.Lists {
		placed[l.ID] = true
	}
	for _, c := range t.Cards {
		if !placed[c.IDList] {
			report.Orphaned = append(report.Orphaned, trelloCardTitle(c.Name))
		}
	}
	sort.Strings(report.Orphaned)

	for name := range dropped {
		report.DroppedAssignees = append(report.DroppedAssignees, name)
	}
	sort.Strings(report.DroppedAssignees)

	return board, report, nil
}

// trelloDue keeps a Trello deadline's instant. Trello due dates carry a time of
// day, unlike a bare day-only deadline, so the value stays an RFC 3339 instant
// and the writer sets due_has_time from its shape — the self-describing
// convention activity.go's dueText established.
// resolveLabelIDs maps a card's Trello label ids onto the labels that survived
// the fold, dropping any the export never defined. Deduplicated: two Trello
// labels sharing a name collapse to one row, and a card holding both would
// otherwise name it twice in a multi-relation.
func resolveLabelIDs(ids []string, alias map[string]string) []string {
	out := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		target, ok := alias[id]
		if !ok || seen[target] {
			continue
		}
		seen[target] = true
		out = append(out, target)
	}
	return out
}

func trelloDue(value string) string {
	return strings.TrimSpace(value)
}

// trelloCardTitle keeps a title inside the column's 500-character limit.
//
// Trello's card name limit is 16,384; boards_cards.title stops at 500. A title
// that long is a description someone typed in the wrong box, so it is truncated
// rather than refused — losing the import over one card would be the worse
// outcome, and the full text is still in the description.
func trelloCardTitle(name string) string {
	title := strings.TrimSpace(name)
	if title == "" {
		return "Untitled card"
	}
	// truncateRunes (description_mentions.go) appends its ellipsis BEYOND the
	// limit, so the budget passed here is one rune short of the column's 500.
	return truncateRunes(title, 499)
}

func trelloMemberName(m trelloMember) string {
	if name := strings.TrimSpace(m.FullName); name != "" {
		return name
	}
	return strings.TrimSpace(m.Username)
}
