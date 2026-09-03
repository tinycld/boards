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
	ID   string `json:"id"`
	Name string `json:"name"`
	// The board half of a card key (OTTER). '' for a board created without
	// one; formatCardKey renders nothing in that case.
	Slug       string `json:"slug"`
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
	ID          string `json:"id"`
	Project     string `json:"project"`
	List        string `json:"list"`
	Position    string `json:"position"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// The card half of a key (the 123 in OTTER-123). Assigned by
	// server/card_number.go — read-only here, exactly like the counters below.
	// The CLI must never write one: the hook overwrites whatever a body
	// carries, so a written value is discarded.
	Number    int      `json:"number"`
	Due       string   `json:"due"`
	Assignees []string `json:"assignees"`
	Labels    []string `json:"labels"`
	Archived  bool     `json:"archived"`
	CreatedBy string   `json:"created_by"`
	// Who to ask about the card, as opposed to who inserted it (CreatedBy).
	// Writable, unlike Number above: it defaults to the creator but exists
	// precisely so it can be pointed at someone else.
	Reporter string `json:"reporter"`
	// One of priorities below, or "" on a row written before the column
	// existed — which the app reads as "none". The CLI writes it only when
	// asked, and validates against the same list the schema enforces.
	Priority string `json:"priority"`
	Created  string `json:"created"`
	Updated  string `json:"updated"`

	// Denormalized counters, maintained by server/counters.go. Read-only —
	// the CLI must never write one: counters.go always RECOMPUTES, so a
	// written value is overwritten on the next checklist or comment change
	// and is wrong until then.
	ChecklistTotal  int `json:"checklist_total"`
	ChecklistDone   int `json:"checklist_done"`
	CommentCount    int `json:"comment_count"`
	AttachmentCount int `json:"attachment_count"`
}

// reporterID is who the card reports to, falling back to whoever created it.
//
// The same fallback lib/board-project.ts applies, and it has to stay the same:
// a card shown reporting to one person in the app and another on the terminal
// is worse than the field not existing. Empty only when the card has no creator
// either, which is true of rows written through the bootstrap path.
func (c card) reporterID() string {
	if c.Reporter != "" {
		return c.Reporter
	}
	return c.CreatedBy
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

// priorities is the schema's select, in scale order (most urgent first). The
// server refuses anything else, but validating here turns a 400 from the API
// into a message that names the choices.
var priorities = []string{"urgent", "high", "medium", "low", "none"}

func validPriority(v string) bool {
	for _, p := range priorities {
		if p == v {
			return true
		}
	}
	return false
}

// priorityCell renders a card's priority for a table. "" and "none" are the
// same state and both show as "-", matching what the board face shows for
// them (nothing at all).
func priorityCell(cd card) string {
	if cd.Priority == "" || cd.Priority == "none" {
		return "-"
	}
	return cd.Priority
}

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
// An id wins outright, then the board KEY (the slug shown in `board list`'s KEY
// column and leading every card key), then board NAMES, case-insensitively.
// Boards are the one entity a person knows by name — the sidebar shows names,
// never ids — so requiring an id here would mean opening the app to use the
// CLI. Lists and cards stay id-only: their names are not unique even within one
// board, so a name match there would silently pick one.
//
// The key is matched BEFORE names, and exactly: it is the identifier every
// table puts in front of the reader, so a board whose NAME happens to equal
// another's key must not win over the board that key actually designates.
//
// An ambiguous name is an ERROR listing the candidates, never a pick. Two
// boards called "Roadmap" is ordinary, and quietly acting on whichever sorted
// first is how a CLI edits the wrong thing. Keys are unique, so they need no
// such guard.
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
	for _, p := range projects {
		if p.Slug != "" && strings.EqualFold(p.Slug, ref) {
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
		ids := make([]string, len(matches))
		for i, m := range matches {
			ids[i] = m.ID
		}
		sort.Strings(ids)
		return project{}, fmt.Errorf(
			"board %q is ambiguous — %d boards share that name (%s); use an id",
			ref, len(matches), strings.Join(ids, ", "))
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

// getCard reads one card by RECORD ID or by KEY (OTTER-12).
//
// Still never by TITLE: a title is free text, is not unique even within a
// column, and is the field most likely to be edited — resolving one by name
// would make `cards card edit` act on a different row after a rename. A key has
// none of those problems, which is the whole reason it exists.
//
// The key path costs one extra request, because the slug names a board that has
// to be resolved to a project id before the card can be filtered. Worth it: a
// key is what a person actually has in hand, having read it off a card face or
// out of a URL, whereas an id has to be copied from somewhere.
//
// A key that names no board — or a number that names no card on it — is a
// not-found error rather than a fallthrough to an id lookup. "OTTER-12" is
// unambiguously a key, and retrying it as an id would report the wrong failure.
func getCard(ctx context.Context, c *client.Client, ref string) (card, error) {
	slug, number, isKey := parseCardKey(ref)
	if !isKey {
		return client.GetRecord[card](ctx, c, cardsCollection, ref)
	}

	projects, err := visibleProjects(ctx, c)
	if err != nil {
		return card{}, err
	}
	// No ambiguity handling, unlike resolveProject's by-name path: the unique
	// index on cards_projects.slug guarantees at most one board per key.
	var projectID string
	for _, p := range projects {
		if p.Slug != "" && strings.EqualFold(p.Slug, slug) {
			projectID = p.ID
			break
		}
	}
	if projectID == "" {
		return card{}, fmt.Errorf("no board with key %q", slug)
	}

	cards, err := client.ListAll[card](ctx, c, cardsCollection,
		client.Filter("project = {:p} && number = {:n}",
			map[string]any{"p": projectID, "n": number}), "")
	if err != nil {
		return card{}, err
	}
	if len(cards) == 0 {
		return card{}, fmt.Errorf("no card %s", ref)
	}
	return cards[0], nil
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

// cardsByList fetches a WHOLE BOARD's cards in one request and groups them by
// column, for the board view.
//
// Reading each column separately is one HTTP round trip per column — ten
// sequential requests to render a ten-column board. `project` is denormalized
// onto every card (card.go writes it for exactly this class of reason), so one
// filtered query returns the same rows.
//
// Sorting is `list,position,id`: the leading `list` only groups the result and
// does not disturb the within-column order, which stays the `position,id` that
// rankSort names and that the board itself uses. Grouping preserves the
// server's order, so each column's slice comes back in board order.
func cardsByList(ctx context.Context, c *client.Client, projectID string, includeArchived bool) (map[string][]card, error) {
	filter := client.Filter("project = {:p}", map[string]any{"p": projectID})
	if !includeArchived {
		filter += " && archived = false"
	}
	cards, err := client.ListAll[card](ctx, c, cardsCollection, filter, "list,"+rankSort)
	if err != nil {
		return nil, err
	}
	out := map[string][]card{}
	for _, cd := range cards {
		out[cd.List] = append(out[cd.List], cd)
	}
	return out, nil
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

// idLookupChunk caps how many ids go into one `id = "x" || id = "y"` filter.
//
// The filter travels in the QUERY STRING of a GET, and a PocketBase id is 15
// characters, so each term costs ~26 bytes encoded. A board with hundreds of
// distinct assignees would otherwise build one filter long enough to exceed
// what proxies and servers accept for a request line — and it would fail as an
// opaque 414 or a truncated read, not as anything a caller could act on.
// Chunking trades one request for a bounded number of them.
const idLookupChunk = 50

// recordsByID fetches rows by id, in chunks, and returns them keyed by id.
//
// Returns a PARTIAL map rather than failing when a row is missing or
// unreadable: on a shared board the caller may not be able to read every user
// row, and a name they cannot resolve must not fail the whole listing. The
// callers render the gap (see names and labelNames, which differ deliberately
// on how).
func recordsByID[T any](
	ctx context.Context, c *client.Client, collection string, ids []string, keyOf func(T) string,
) (map[string]T, error) {
	out := map[string]T{}
	unique := map[string]bool{}
	var wanted []string
	for _, id := range ids {
		if id == "" || unique[id] {
			continue
		}
		unique[id] = true
		wanted = append(wanted, id)
	}
	for start := 0; start < len(wanted); start += idLookupChunk {
		end := min(start+idLookupChunk, len(wanted))
		terms := make([]string, 0, end-start)
		for _, id := range wanted[start:end] {
			terms = append(terms, client.Filter("id = {:i}", map[string]any{"i": id}))
		}
		rows, err := client.ListAll[T](ctx, c, collection, strings.Join(terms, " || "), "")
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			out[keyOf(r)] = r
		}
	}
	return out, nil
}

// usersByID fetches the named users for rendering assignee and author columns.
func usersByID(ctx context.Context, c *client.Client, ids []string) (map[string]user, error) {
	return recordsByID(ctx, c, "users", ids, func(u user) string { return u.ID })
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
