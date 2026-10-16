package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/forms"
	"tinycld.org/core/rlstest"
)

// A share-link visitor reads the types of a shared board's cards, and nothing
// else, through the clause boards registers with core's forms read rules
// (shareVisitorFormsClause). These run against core's real forms collection
// and its migrated rule, composed as a served install composes it.

// servedFormsApp is core's and boards' migrations applied, with the forms
// read rules composed from the clause Register registers.
func servedFormsApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := rlstest.NewAssembledApp(t, rlstest.MigrationsDir(t, "../pb-migrations"))
	registerFormReaders()
	if err := forms.ApplyPublicReaders(app); err != nil {
		t.Fatalf("compose the forms read rules: %v", err)
	}
	return app
}

func shareReaderForm(t *testing.T, app core.App, slug string, isDefault bool) *core.Record {
	t.Helper()
	return seedRow(t, app, "forms", map[string]any{
		"host": cardFormHost, "name": slug, "slug": slug, "is_default": isDefault, "order": 1,
		"definition": `{"version":1,"pages":[{"key":"main","title":"Card"}],"fields":[]}`,
	})
}

// shareReaderBoard is a board whose one card uses form, plus one share link
// unless link is nil.
func shareReaderBoard(t *testing.T, app core.App, owner, form *core.Record, name string, link map[string]any) {
	t.Helper()
	project := cardsProject(t, app, name, owner)
	cardsMember(t, app, project, owner, "owner")
	list := cardsList(t, app, project, "To do", "a0")
	card := cardsCard(t, app, project, list, name+" card", "a0", owner)
	card.Set("form", form.Id)
	if err := app.Save(card); err != nil {
		t.Fatalf("set the card's form: %v", err)
	}
	if link == nil {
		return
	}
	fields := map[string]any{"project": project.Id, "role": "viewer", "created_by": owner.Id}
	for k, v := range link {
		fields[k] = v
	}
	seedRow(t, app, "boards_share_links", fields)
}

func tokenOf(n byte) string {
	b := []byte(longToken)
	b[0] = n
	return string(b)
}

type formsShareEnv struct {
	app *tests.TestApp
	// shared: the default card form, on a board with an active link (tokShared).
	shared *core.Record
	// switchedOff: on a board whose link with tokOff is inactive, beside an
	// active link with tokOn.
	switchedOff *core.Record
	// expired: on a board whose only link (tokExpired) has expired.
	expired *core.Record
	// future: on a board whose only link (tokFuture) expires in the future.
	future *core.Record
	// private: on a board with no share link at all.
	private *core.Record
	// unused: no card uses it.
	unused      *core.Record
	memberToken string
}

var (
	tokShared  = tokenOf('a')
	tokOff     = tokenOf('b')
	tokOn      = tokenOf('c')
	tokExpired = tokenOf('d')
	tokFuture  = tokenOf('e')
)

func setupFormsShareEnv(t *testing.T) *formsShareEnv {
	t.Helper()
	app := servedFormsApp(t)
	owner := cardsUser(t, app, "owner@test.local", "member")
	loner := cardsUser(t, app, "loner@test.local", "member")
	env := &formsShareEnv{
		app:         app,
		shared:      shareReaderForm(t, app, "card", true),
		switchedOff: shareReaderForm(t, app, "bug", false),
		expired:     shareReaderForm(t, app, "chore", false),
		future:      shareReaderForm(t, app, "story", false),
		private:     shareReaderForm(t, app, "secret", false),
		unused:      shareReaderForm(t, app, "spike", false),
		memberToken: cardsToken(t, loner),
	}
	shareReaderBoard(t, app, owner, env.shared, "Shared", map[string]any{"token": tokShared, "is_active": true})
	shareReaderBoard(t, app, owner, env.switchedOff, "Switched off", map[string]any{"token": tokOff, "is_active": false})
	shareReaderBoard(t, app, owner, env.expired, "Expired", map[string]any{
		"token": tokExpired, "is_active": true, "expires_at": "2020-01-01 00:00:00.000Z",
	})
	shareReaderBoard(t, app, owner, env.future, "Future", map[string]any{
		"token": tokFuture, "is_active": true, "expires_at": "2099-01-01 00:00:00.000Z",
	})
	shareReaderBoard(t, app, owner, env.private, "Private", nil)
	// The switched-off board's second, active link: the same board, another
	// token. With it, the inactive link's token admits only if the three
	// checks could land on different link rows.
	project, err := app.FindFirstRecordByData("boards_projects", "name", "Switched off")
	if err != nil {
		t.Fatalf("find the switched-off board: %v", err)
	}
	seedRow(t, app, "boards_share_links", map[string]any{
		"project": project.Id, "token": tokOn, "role": "viewer", "created_by": owner.Id, "is_active": true,
	})
	return env
}

func (env *formsShareEnv) read(t *testing.T, name, url string, headers map[string]string, want int, content, absent []string) {
	t.Helper()
	sc := tests.ApiScenario{
		Name:                  name,
		Method:                http.MethodGet,
		URL:                   url,
		Headers:               headers,
		ExpectedStatus:        want,
		ExpectedContent:       content,
		NotExpectedContent:    absent,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	sc.Test(t)
}

const formsURL = "/api/collections/forms/records"

func share(tok string) map[string]string { return map[string]string{"x_share_token": tok} }

func TestFormsShareReader_TokenReadsItsBoardsCardTypes(t *testing.T) {
	env := setupFormsShareEnv(t)
	env.read(t, "list", formsURL, share(tokShared), http.StatusOK,
		[]string{`"totalItems":1`, env.shared.Id},
		[]string{env.unused.Id, env.switchedOff.Id, env.expired.Id, env.private.Id})
	env.read(t, "view", formsURL+"/"+env.shared.Id, share(tokShared), http.StatusOK,
		[]string{`"slug":"card"`}, nil)
	env.read(t, "view of a type no shared card uses", formsURL+"/"+env.unused.Id, share(tokShared), http.StatusNotFound,
		[]string{`"data":{}`}, nil)
}

// With no header, the token term compares against NULL, which also matches
// the missing link row of a board that has no link (the private board's type)
// and of a form no card uses. The header guard in the clause refuses both.
func TestFormsShareReader_NoTokenReadsNothing(t *testing.T) {
	env := setupFormsShareEnv(t)
	for name, headers := range map[string]map[string]string{"no header": nil, "empty header": share("")} {
		env.read(t, name+" list", formsURL, headers, http.StatusOK, []string{`"totalItems":0`},
			[]string{env.shared.Id, env.private.Id, env.unused.Id})
		env.read(t, name+" view of a shared type", formsURL+"/"+env.shared.Id, headers, http.StatusNotFound, []string{`"data":{}`}, nil)
		env.read(t, name+" view of an unshared board's type", formsURL+"/"+env.private.Id, headers, http.StatusNotFound, []string{`"data":{}`}, nil)
	}
}

func TestFormsShareReader_LinkExpiringLaterReadsItsType(t *testing.T) {
	env := setupFormsShareEnv(t)
	env.read(t, "list", formsURL, share(tokFuture), http.StatusOK,
		[]string{`"totalItems":1`, env.future.Id}, []string{env.private.Id})
}

func TestFormsShareReader_InactiveOrExpiredLinkReadsNothing(t *testing.T) {
	env := setupFormsShareEnv(t)
	env.read(t, "inactive link", formsURL, share(tokOff), http.StatusOK,
		[]string{`"totalItems":0`}, []string{env.switchedOff.Id})
	env.read(t, "expired link", formsURL, share(tokExpired), http.StatusOK,
		[]string{`"totalItems":0`}, []string{env.expired.Id})
	env.read(t, "unknown token", formsURL, share(tokenOf('z')), http.StatusOK,
		[]string{`"totalItems":0`}, nil)
	// The positive control for the inactive case: the same board's active
	// link reads its type, so the refusal above is the is_active check.
	env.read(t, "the same board's active link", formsURL, share(tokOn), http.StatusOK,
		[]string{`"totalItems":1`, env.switchedOff.Id}, nil)
}

func TestFormsShareReader_SignedInUserOfNoBoardLists(t *testing.T) {
	env := setupFormsShareEnv(t)
	env.read(t, "list", formsURL, map[string]string{"Authorization": env.memberToken}, http.StatusOK,
		[]string{`"totalItems":6`, env.unused.Id, env.private.Id}, nil)
}
