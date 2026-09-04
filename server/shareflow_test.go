package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The whole loop, end to end: mint a link through the REAL endpoint, then read
// the board as an ANONYMOUS caller carrying only that token.
//
// Every other test in this package proves one half. The endpoint suite proves a
// well-formed row lands; the RLS suite proves a hand-written token opens the
// board. Neither would notice if the two drifted — a role string the rule does
// not expect, an expiry in a format `?>` cannot compare — and the failure would
// surface as "the link I just created does not work", which is the worst place
// to find it.
func TestShareLinks_MintedLinkOpensTheWholeBoard(t *testing.T) {
	env := setupCardsEnv(t)
	cardsLabel(t, env.app, env.project, "probe-label", "#ef4444")

	mintReq{
		method:  http.MethodPost,
		url:     "/api/boards/share-link",
		token:   env.ownerToken,
		body:    mintBody(env.project.Id, "viewer", 7),
		want:    http.StatusOK,
		content: []string{`"token":"`},
		after: func(t testing.TB, app *tests.TestApp) {
			link, err := app.FindFirstRecordByFilter("boards_share_links",
				"project = {:p}", dbx.Params{"p": env.project.Id})
			if err != nil {
				t.Fatalf("read minted link: %v", err)
			}
			tok := link.GetString("token")

			check := func(collection, id string) {
				rec, err := app.FindRecordById(collection, id)
				if err != nil {
					t.Fatalf("load %s: %v", collection, err)
				}
				info := &core.RequestInfo{
					Context: core.RequestInfoContextDefault,
					Method:  http.MethodGet,
					Headers: map[string]string{"x_share_token": tok},
					Query:   map[string]string{},
				}
				ok, err := app.CanAccessRecord(rec, info, rec.Collection().ListRule)
				if err != nil {
					t.Fatalf("%s listRule: %v", collection, err)
				}
				if !ok {
					t.Fatalf("%s is NOT readable with a freshly minted token", collection)
				}
				t.Logf("%s readable anonymously ✓", collection)
			}

			check("boards_projects", env.project.Id)
			check("boards_lists", env.list.Id)
			check("boards_cards", env.card.Id)
		},
	}.run(t, env)
}
