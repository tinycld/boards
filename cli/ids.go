package cli

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"tinycld.org/cli/client"
)

// Row shapes the CLI reads. Deliberately a SUBSET of each collection — the
// commands render a few columns and write a few fields, and naming every
// column here would turn an additive migration into a compile error for no
// gain. `expand` is never requested: the board query in the app avoids it too
// (types.ts explains why), and a CLI table wants ids resolved by a second
// lookup rather than nested objects.

type project struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Archived   bool   `json:"archived"`
	Visibility string `json:"visibility"`
	CreatedBy  string `json:"created_by"`
	Created    string `json:"created"`
	Updated    string `json:"updated"`
}

type list struct {
	ID       string `json:"id"`
	Project  string `json:"project"`
	Name     string `json:"name"`
	Position string `json:"position"`
	IsDone   bool   `json:"is_done"`
}

type card struct {
	ID          string   `json:"id"`
	Project     string   `json:"project"`
	List        string   `json:"list"`
	Position    string   `json:"position"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Due         string   `json:"due"`
	Assignees   []string `json:"assignees"`
	Labels      []string `json:"labels"`
	Archived    bool     `json:"archived"`
	CreatedBy   string   `json:"created_by"`
	Created     string   `json:"created"`
	Updated     string   `json:"updated"`

	// Denormalized counters, maintained by server/counters.go. Read-only —
	// the CLI must never write one: counters.go always RECOMPUTES, so a
	// written value is overwritten on the next checklist or comment change
	// and is wrong until then.
	ChecklistTotal  int `json:"checklist_total"`
	ChecklistDone   int `json:"checklist_done"`
	CommentCount    int `json:"comment_count"`
	AttachmentCount int `json:"attachment_count"`
}

type label struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	Name    string `json:"name"`
	Color   string `json:"color"`
}

type member struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	User    string `json:"user"`
	Role    string `json:"role"`
}

type checklistItem struct {
	ID       string `json:"id"`
	Card     string `json:"card"`
	Title    string `json:"title"`
	IsDone   bool   `json:"is_done"`
	Position string `json:"position"`
}

type comment struct {
	ID      string `json:"id"`
	Card    string `json:"card"`
	Author  string `json:"author"`
	Body    string `json:"body"`
	Parent  string `json:"parent"`
	Created string `json:"created"`
}

type user struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// displayName renders a user for a table cell, falling back to the email when
// the name fields are empty (they are optional on a users row).
func (u user) displayName() string {
	name := strings.TrimSpace(u.FirstName + " " + u.LastName)
	if name == "" {
		return u.Email
	}
	return name
}

var errNotFound = errors.New("not found")

const (
	projectsCollection  = "cards_projects"
	listsCollection     = "cards_lists"
	cardsCollection     = "cards_cards"
	labelsCollection    = "cards_labels"
	membersCollection   = "cards_project_members"
	checklistCollection = "cards_checklist_items"
	commentsCollection  = "cards_comments"

	// Every rank-ordered query sorts by `position, id`. Ranks are NOT unique
	// (rank.go), so `id` is the tiebreaker that keeps a tie rendering in the
	// same order here as it does in the app. Sorting by `position` alone would
	// let the CLI and the board disagree about two tied rows.
	rankSort = "position,id"
)

// visibleProjects lists the boards the caller can see, newest activity first.
// The access rules already scope this to the caller's memberships, so there is
// no filter to write — asking for everything returns exactly their boards.
func visibleProjects(ctx context.Context, c *client.Client) ([]project, error) {
	return client.ListAll[project](ctx, c, projectsCollection, "", "-updated")
}

// resolveProject turns a board reference into a project row.
//
// An id wins outright; otherwise the reference is matched against board NAMES,
// case-insensitively. Boards are the one entity a person knows by name — the
// sidebar shows names, never ids — so requiring an id here would mean opening
// the app to use the CLI. Lists and cards stay id-only: their names are not
// unique even within one board, so a name match there would silently pick one.
//
// An ambiguous name is an ERROR listing the candidates, never a pick. Two
// boards called "Roadmap" is ordinary, and quietly acting on whichever sorted
// first is how a CLI edits the wrong thing.
func resolveProject(ctx context.Context, c *client.Client, ref string) (project, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return project{}, errors.New("no board given")
	}
	projects, err := visibleProjects(ctx, c)
	if err != nil {
		return project{}, err
	}
	for _, p := range projects {
		if p.ID == ref {
			return p, nil
		}
	}
	var matches []project
	for _, p := range projects {
		if strings.EqualFold(p.Name, ref) {
			matches = append(matches, p)
		}
	}
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		return project{}, fmt.Errorf("board %q: %w", ref, errNotFound)
	default:
		names := make([]string, len(matches))
		for i, m := range matches {
			names[i] = m.ID
		}
		sort.Strings(names)
		return project{}, fmt.Errorf(
			"board %q is ambiguous — %d boards share that name (%s); use an id",
			ref, len(matches), strings.Join(names, ", "))
	}
}

// projectLists returns a board's columns in board order.
func projectLists(ctx context.Context, c *client.Client, projectID string) ([]list, error) {
	return client.ListAll[list](ctx, c, listsCollection,
		client.Filter("project = {:p}", map[string]any{"p": projectID}), rankSort)
}

// resolveList turns a column reference into a list row WITHIN one board.
// Unlike boards, a name match is scoped to the given project, so the same
// "Done" on two boards is never ambiguous — but two columns named "Done" on
// ONE board still are, and that is refused rather than guessed.
func resolveList(ctx context.Context, c *client.Client, projectID, ref string) (list, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return list{}, errors.New("no list given")
	}
	lists, err := projectLists(ctx, c, projectID)
	if err != nil {
		return list{}, err
	}
	for _, l := range lists {
		if l.ID == ref {
			return l, nil
		}
	}
	var matches []list
	for _, l := range lists {
		if strings.EqualFold(l.Name, ref) {
			matches = append(matches, l)
		}
	}
	switch len(matches) {
	case 1:
		return matches[0], nil
	case 0:
		return list{}, fmt.Errorf("list %q: %w", ref, errNotFound)
	default:
		ids := make([]string, len(matches))
		for i, m := range matches {
			ids[i] = m.ID
		}
		sort.Strings(ids)
		return list{}, fmt.Errorf(
			"list %q is ambiguous — %d columns on this board share that name (%s); use an id",
			ref, len(matches), strings.Join(ids, ", "))
	}
}

// getCard reads one card BY ID. Cards are addressed by id only: a title is
// free text, is not unique even within a column, and is the field most likely
// to be edited — resolving one by name would make `cards card edit` act on a
// different row after a rename.
func getCard(ctx context.Context, c *client.Client, id string) (card, error) {
	return client.GetRecord[card](ctx, c, cardsCollection, id)
}

// listCards returns a column's cards in board order. Archived cards are
// excluded unless includeArchived — someone listing a board wants active work,
// the same call the search source makes with ExcludeField: 'archived'.
func listCards(ctx context.Context, c *client.Client, listID string, includeArchived bool) ([]card, error) {
	filter := client.Filter("list = {:l}", map[string]any{"l": listID})
	if !includeArchived {
		filter += " && archived = false"
	}
	return client.ListAll[card](ctx, c, cardsCollection, filter, rankSort)
}

// cardPositions is the sorted rank slice the rank helpers take. It must come
// from the SAME ordering the board uses, or an inserted card lands somewhere
// the app would not have put it.
func cardPositions(cards []card) []string {
	out := make([]string, len(cards))
	for i, c := range cards {
		out[i] = c.Position
	}
	return out
}

func listPositions(lists []list) []string {
	out := make([]string, len(lists))
	for i, l := range lists {
		out[i] = l.Position
	}
	return out
}

// usersByID fetches the named users in one request, for rendering assignee and
// author columns. Returns a partial map rather than failing when a user row is
// unreadable: on a shared board the caller may not be able to read every
// user's row, and a missing name must not fail the whole listing.
func usersByID(ctx context.Context, c *client.Client, ids []string) (map[string]user, error) {
	unique := map[string]bool{}
	var terms []string
	for _, id := range ids {
		if id == "" || unique[id] {
			continue
		}
		unique[id] = true
		terms = append(terms, client.Filter("id = {:i}", map[string]any{"i": id}))
	}
	out := map[string]user{}
	if len(terms) == 0 {
		return out, nil
	}
	users, err := client.ListAll[user](ctx, c, "users", strings.Join(terms, " || "), "")
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		out[u.ID] = u
	}
	return out, nil
}

// names renders resolved user ids for a table cell. An id with no readable
// user row shows as "?" rather than vanishing: a card assigned to someone the
// caller cannot see must not read as UNASSIGNED, which is the same asymmetry
// the board face settled on for share-link visitors.
func names(ids []string, users map[string]user) string {
	if len(ids) == 0 {
		return "-"
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		if u, ok := users[id]; ok {
			out[i] = u.displayName()
		} else {
			out[i] = "?"
		}
	}
	return strings.Join(out, ", ")
}
