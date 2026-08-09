package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

// fakeCards is an in-memory stand-in for the server: the cards_* collections
// the commands read and write, with filters parsed against the EXACT shapes
// the CLI builds. An unrecognized filter fails the test rather than returning
// everything — a silently-ignored filter is how a command appears to work
// while reading the wrong board.
//
// WHAT THIS HARNESS CANNOT SEE, and it matters: it runs no access rules and no
// OAuth scope middleware. So it proves the commands send the right requests,
// never that a real server would allow them. The rules are proven by the Go
// RLS suites in cards/server, and the scope classification by core's
// route_classification_test.go — that split is deliberate, and the reason the
// scope table had to be widened before these commands could work at all.
type fakeCards struct {
	t *testing.T

	projects  map[string]*project
	lists     map[string]*list
	cards     map[string]*card
	labels    map[string]*label
	checklist map[string]*checklistItem
	comments  map[string]*comment
	users     map[string]*user

	seq int

	// Recorded writes, so a test can assert what was SENT rather than only
	// what came back — a fake that echoes its input proves nothing about the
	// body the command built.
	lastCardPatch  map[string]any
	lastCardCreate map[string]any
	lastListPatch  map[string]any
	deletedCards   []string
	deletedLists   []string
	patchCount     int
}

func newFakeCards(t *testing.T) *fakeCards {
	return &fakeCards{
		t:         t,
		projects:  map[string]*project{},
		lists:     map[string]*list{},
		cards:     map[string]*card{},
		labels:    map[string]*label{},
		checklist: map[string]*checklistItem{},
		comments:  map[string]*comment{},
		users:     map[string]*user{},
	}
}

func (f *fakeCards) nextID(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s%03d", prefix, f.seq)
}

func (f *fakeCards) addProject(id, name string) *project {
	p := &project{ID: id, Name: name, Color: "#8b5cf6", CreatedBy: "user1", Updated: "2026-08-01 10:00:00Z"}
	f.projects[id] = p
	return p
}

func (f *fakeCards) addList(id, projectID, name, position string) *list {
	l := &list{ID: id, Project: projectID, Name: name, Position: position}
	f.lists[id] = l
	return l
}

func (f *fakeCards) addCard(id, projectID, listID, title, position string) *card {
	c := &card{ID: id, Project: projectID, List: listID, Title: title, Position: position, CreatedBy: "user1"}
	f.cards[id] = c
	return c
}

var (
	reProjectEq  = regexp.MustCompile(`^project = "((?:[^"\\]|\\.)*)"$`)
	reListEq     = regexp.MustCompile(`^list = "((?:[^"\\]|\\.)*)"$`)
	reListActive = regexp.MustCompile(`^list = "((?:[^"\\]|\\.)*)" && archived = false$`)
	reCardEq     = regexp.MustCompile(`^card = "((?:[^"\\]|\\.)*)"$`)
	reIDTerm     = regexp.MustCompile(`id = "((?:[^"\\]|\\.)*)"`)
	reIDList     = regexp.MustCompile(`^id = "((?:[^"\\]|\\.)*)"( \|\| id = "(?:(?:[^"\\]|\\.)*)")*$`)
	reUnquote    = strings.NewReplacer(`\"`, `"`, `\\`, `\`)
)

func unquote(s string) string { return reUnquote.Replace(s) }

// sortByRank orders rows the way `position,id` does server-side. The tiebreak
// on id is not cosmetic: ranks are not unique, and a fake that ignored the
// tiebreak would let a rank bug pass unnoticed.
func sortByRank[T any](items []T, pos func(T) (string, string)) {
	sort.SliceStable(items, func(i, j int) bool {
		pi, ii := pos(items[i])
		pj, ij := pos(items[j])
		if pi != pj {
			return pi < pj
		}
		return ii < ij
	})
}

func listResponse[T any](w http.ResponseWriter, items []T) {
	if items == nil {
		items = []T{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"page": 1, "perPage": 200, "totalItems": len(items), "totalPages": 1,
		"items": items,
	})
}

func decodeBody(r *http.Request) map[string]any {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	return body
}

func (f *fakeCards) serve() (*httptest.Server, *client.Client) {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /oauth/userinfo", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"sub": "user1"})
	})

	// --- projects -----------------------------------------------------------
	mux.HandleFunc("GET /api/collections/cards_projects/records", func(w http.ResponseWriter, r *http.Request) {
		if filter := r.URL.Query().Get("filter"); filter != "" {
			f.t.Errorf("projects must be listed unfiltered (the rules scope them): %q", filter)
		}
		var out []project
		for _, p := range f.projects {
			out = append(out, *p)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		listResponse(w, out)
	})

	// --- lists --------------------------------------------------------------
	mux.HandleFunc("GET /api/collections/cards_lists/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		m := reProjectEq.FindStringSubmatch(filter)
		if m == nil {
			f.t.Errorf("unsupported cards_lists filter: %q", filter)
			listResponse(w, []list{})
			return
		}
		f.assertRankSort(r)
		var out []list
		for _, l := range f.lists {
			if l.Project == unquote(m[1]) {
				out = append(out, *l)
			}
		}
		sortByRank(out, func(l list) (string, string) { return l.Position, l.ID })
		listResponse(w, out)
	})
	mux.HandleFunc("POST /api/collections/cards_lists/records", func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(r)
		created := &list{
			ID:       f.nextID("lst"),
			Project:  str(body["project"]),
			Name:     str(body["name"]),
			Position: str(body["position"]),
			IsDone:   body["is_done"] == true,
		}
		f.lists[created.ID] = created
		json.NewEncoder(w).Encode(created)
	})
	mux.HandleFunc("PATCH /api/collections/cards_lists/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		l, ok := f.lists[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		body := decodeBody(r)
		f.lastListPatch = body
		f.patchCount++
		if v, ok := body["name"].(string); ok {
			l.Name = v
		}
		if v, ok := body["position"].(string); ok {
			l.Position = v
		}
		if v, ok := body["is_done"].(bool); ok {
			l.IsDone = v
		}
		json.NewEncoder(w).Encode(l)
	})
	mux.HandleFunc("DELETE /api/collections/cards_lists/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		f.deletedLists = append(f.deletedLists, id)
		delete(f.lists, id)
		// cards_cards.list ships cascadeDelete: true, so the server removes
		// the column's cards. Emulating it keeps a test that counts cards
		// after a delete honest.
		for cid, c := range f.cards {
			if c.List == id {
				delete(f.cards, cid)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// --- cards --------------------------------------------------------------
	mux.HandleFunc("GET /api/collections/cards_cards/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		f.assertRankSort(r)
		var (
			listID   string
			onlyLive bool
		)
		if m := reListActive.FindStringSubmatch(filter); m != nil {
			listID, onlyLive = unquote(m[1]), true
		} else if m := reListEq.FindStringSubmatch(filter); m != nil {
			listID = unquote(m[1])
		} else {
			f.t.Errorf("unsupported cards_cards filter: %q", filter)
			listResponse(w, []card{})
			return
		}
		var out []card
		for _, c := range f.cards {
			if c.List != listID {
				continue
			}
			if onlyLive && c.Archived {
				continue
			}
			out = append(out, *c)
		}
		sortByRank(out, func(c card) (string, string) { return c.Position, c.ID })
		listResponse(w, out)
	})
	mux.HandleFunc("GET /api/collections/cards_cards/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, ok := f.cards[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		json.NewEncoder(w).Encode(c)
	})
	mux.HandleFunc("POST /api/collections/cards_cards/records", func(w http.ResponseWriter, r *http.Request) {
		body := decodeBody(r)
		f.lastCardCreate = body
		created := &card{
			ID:          f.nextID("crd"),
			Project:     str(body["project"]),
			List:        str(body["list"]),
			Position:    str(body["position"]),
			Title:       str(body["title"]),
			Description: str(body["description"]),
			Due:         str(body["due"]),
			CreatedBy:   str(body["created_by"]),
		}
		f.cards[created.ID] = created
		json.NewEncoder(w).Encode(created)
	})
	mux.HandleFunc("PATCH /api/collections/cards_cards/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, ok := f.cards[r.PathValue("id")]
		if !ok {
			notFound(w)
			return
		}
		body := decodeBody(r)
		f.lastCardPatch = body
		f.patchCount++
		if v, ok := body["title"].(string); ok {
			c.Title = v
		}
		if v, ok := body["description"].(string); ok {
			c.Description = v
		}
		if v, ok := body["due"].(string); ok {
			c.Due = v
		}
		if v, ok := body["list"].(string); ok {
			c.List = v
		}
		if v, ok := body["position"].(string); ok {
			c.Position = v
		}
		if v, ok := body["archived"].(bool); ok {
			c.Archived = v
		}
		json.NewEncoder(w).Encode(c)
	})
	mux.HandleFunc("DELETE /api/collections/cards_cards/records/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		f.deletedCards = append(f.deletedCards, id)
		delete(f.cards, id)
		w.WriteHeader(http.StatusNoContent)
	})

	// --- checklist, comments, labels, users ---------------------------------
	mux.HandleFunc("GET /api/collections/cards_checklist_items/records", func(w http.ResponseWriter, r *http.Request) {
		m := reCardEq.FindStringSubmatch(r.URL.Query().Get("filter"))
		if m == nil {
			f.t.Errorf("unsupported checklist filter: %q", r.URL.Query().Get("filter"))
			listResponse(w, []checklistItem{})
			return
		}
		var out []checklistItem
		for _, it := range f.checklist {
			if it.Card == unquote(m[1]) {
				out = append(out, *it)
			}
		}
		sortByRank(out, func(i checklistItem) (string, string) { return i.Position, i.ID })
		listResponse(w, out)
	})
	mux.HandleFunc("GET /api/collections/cards_comments/records", func(w http.ResponseWriter, r *http.Request) {
		m := reCardEq.FindStringSubmatch(r.URL.Query().Get("filter"))
		if m == nil {
			f.t.Errorf("unsupported comments filter: %q", r.URL.Query().Get("filter"))
			listResponse(w, []comment{})
			return
		}
		var out []comment
		for _, cm := range f.comments {
			if cm.Card == unquote(m[1]) {
				out = append(out, *cm)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Created < out[j].Created })
		listResponse(w, out)
	})
	mux.HandleFunc("GET /api/collections/cards_labels/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		if !reIDList.MatchString(filter) {
			f.t.Errorf("unsupported labels filter: %q", filter)
			listResponse(w, []label{})
			return
		}
		want := map[string]bool{}
		for _, m := range reIDTerm.FindAllStringSubmatch(filter, -1) {
			want[unquote(m[1])] = true
		}
		var out []label
		for _, l := range f.labels {
			if want[l.ID] {
				out = append(out, *l)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		listResponse(w, out)
	})
	mux.HandleFunc("GET /api/collections/users/records", func(w http.ResponseWriter, r *http.Request) {
		filter := r.URL.Query().Get("filter")
		if !reIDList.MatchString(filter) {
			f.t.Errorf("unsupported users filter: %q", filter)
			listResponse(w, []user{})
			return
		}
		want := map[string]bool{}
		for _, m := range reIDTerm.FindAllStringSubmatch(filter, -1) {
			want[unquote(m[1])] = true
		}
		var out []user
		for _, u := range f.users {
			if want[u.ID] {
				out = append(out, *u)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		listResponse(w, out)
	})

	// The sharing surface is READ-ONLY for OAuth callers by core's scope
	// table. Any request here is a bug in this package — fail loudly rather
	// than answer, so a future `cards share` command cannot be built against
	// a fake that permits what the real server refuses.
	for _, path := range []string{"cards_project_members", "cards_share_links"} {
		mux.HandleFunc("/api/collections/"+path+"/records", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				f.t.Errorf("%s %s: the sharing surface is read-only for OAuth callers",
					r.Method, r.URL.Path)
			}
			listResponse(w, []map[string]any{})
		})
	}

	srv := httptest.NewServer(mux)
	f.t.Cleanup(srv.Close)
	store := &staticStore{tok: client.TokenSet{
		AccessToken: "test-token", RefreshToken: "r", ExpiresAt: time.Now().Add(time.Hour),
	}}
	return srv, client.New(srv.URL, store, srv.Client())
}

// assertRankSort pins the ordering contract at the WIRE. Ranks are not unique,
// so `position` alone lets two tied rows render in a different order here than
// on the board — sorting must always be `position,id`.
func (f *fakeCards) assertRankSort(r *http.Request) {
	if s := r.URL.Query().Get("sort"); s != rankSort {
		f.t.Errorf("%s: sort = %q, want %q — ranks are not unique, so `id` is "+
			"the tiebreaker that keeps a tie ordered the same here as on the board",
			r.URL.Path, s, rankSort)
	}
}

func notFound(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNotFound)
	json.NewEncoder(w).Encode(map[string]string{"message": "Not found"})
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

type staticStore struct{ tok client.TokenSet }

func (s *staticStore) Load() (client.TokenSet, error) { return s.tok, nil }
func (s *staticStore) Save(t client.TokenSet) error   { s.tok = t; return nil }

// newTestRoot mirrors the shell root's persistent flag set — the contract
// output.FromCommand reads — and registers the cards group.
func newTestRoot(c *client.Client) *cobra.Command {
	root := &cobra.Command{Use: "tinycld", SilenceUsage: true, SilenceErrors: true}
	pf := root.PersistentFlags()
	pf.String("output", "table", "")
	pf.Bool("json", false, "")
	pf.String("context", "", "")
	pf.Bool("quiet", false, "")
	pf.Bool("no-color", false, "")
	pf.Bool("yes", false, "")
	Register(root, c)
	return root
}

func runCmd(t *testing.T, c *client.Client, args ...string) (string, string, error) {
	t.Helper()
	root := newTestRoot(c)
	var out, errBuf bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&errBuf)
	root.SetIn(strings.NewReader(""))
	root.SetArgs(args)
	err := root.Execute()
	return out.String(), errBuf.String(), err
}
