package cards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// cards_card_links access — the cross-board collection.
//
// Every other suite in this package tests a rule that resolves ONE project.
// These rules resolve two, on two independent join paths, so the cases below
// are organized by which end is doing the work:
//
//   - create: writer on the SOURCE, member of the TARGET (asymmetric on
//     purpose — see the migration).
//   - read: EITHER end, so a link is visible to both boards' members. The far
//     CARD stays governed by cards_cards' own rule, which is what makes the
//     client's redacted chip safe rather than a leak — proved below by
//     asserting the far title never reaches the wire.
//   - delete: writer on the source only.
//
// The share-token pair at the end is the riskiest clause in the feature: two
// aliased @collection joins, each needing its own correlation, on a row that
// points at two different boards.

// linkEnv is the standard env plus a SECOND board, so every test can express
// "the editor's own board" and "somewhere else" without rebuilding it.
type linkEnv struct {
	*cardsEnv
	// far is a board the editor is NOT on; farCard sits on it.
	far     *core.Record
	farCard *core.Record
	// shared is a board the editor IS on, as a plain viewer; sharedCard sits
	// on it. This is the "member of the target" case the create rule admits.
	shared     *core.Record
	sharedCard *core.Record
}

func setupLinkEnv(t *testing.T) *linkEnv {
	t.Helper()
	env := setupCardsEnv(t)

	far := cardsProject(t, env.app, "Far", env.outsider)
	cardsMember(t, env.app, far, env.outsider, "owner")
	farList := cardsList(t, env.app, far, "To do", "a0")
	farCard := cardsCard(t, env.app, far, farList, "far-card", "a0", env.outsider)

	shared := cardsProject(t, env.app, "Shared", env.owner)
	cardsMember(t, env.app, shared, env.owner, "owner")
	// A VIEWER, deliberately: membership alone must be enough to be linked TO.
	cardsMember(t, env.app, shared, env.editor, "viewer")
	sharedList := cardsList(t, env.app, shared, "To do", "a0")
	sharedCard := cardsCard(t, env.app, shared, sharedList, "shared-card", "a0", env.owner)

	return &linkEnv{
		cardsEnv:   env,
		far:        far,
		farCard:    farCard,
		shared:     shared,
		sharedCard: sharedCard,
	}
}

func linkBody(source, target, linkType string) string {
	return `{"source":"` + source + `","target":"` + target + `","type":"` + linkType + `"}`
}

// seedLink writes a link directly, for the read tests — bypassing the create
// rule on purpose, so a read case cannot silently depend on a write passing.
func seedLink(t *testing.T, env *linkEnv, source, target, linkType string) *core.Record {
	t.Helper()
	col, err := env.app.FindCollectionByNameOrId("cards_card_links")
	if err != nil {
		t.Fatalf("find cards_card_links: %v", err)
	}
	row := core.NewRecord(col)
	row.Set("source", source)
	row.Set("target", target)
	row.Set("type", linkType)
	if err := env.app.Save(row); err != nil {
		t.Fatalf("seed link: %v", err)
	}
	return row
}

// --- create -----------------------------------------------------------------

func TestCardLinksRLS_EditorLinksWithinTheirBoard(t *testing.T) {
	env := setupLinkEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	req{
		method:  http.MethodPost,
		url:     "/api/collections/cards_card_links/records",
		token:   env.editorToken,
		body:    linkBody(env.card.Id, other.Id, "blocks"),
		want:    http.StatusOK,
		content: []string{`"type":"blocks"`},
	}.run(t, env.cardsEnv)
}

// The asymmetry, positive half: a VIEWER role on the target board is enough to
// be linked to. Requiring write there would refuse the ordinary case of
// pointing at another team's card.
func TestCardLinksRLS_MembershipOnTheTargetIsEnough(t *testing.T) {
	env := setupLinkEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/collections/cards_card_links/records",
		token:   env.editorToken,
		body:    linkBody(env.card.Id, env.sharedCard.Id, "blocks"),
		want:    http.StatusOK,
		content: []string{`"target":"` + env.sharedCard.Id + `"`},
	}.run(t, env.cardsEnv)
}

// The asymmetry, negative half: no standing at all on the target board.
func TestCardLinksRLS_CannotLinkToABoardYouAreNotOn(t *testing.T) {
	env := setupLinkEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_card_links/records",
		token:  env.editorToken,
		body:   linkBody(env.card.Id, env.farCard.Id, "blocks"),
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

// Writing the SOURCE is a write, so a commentor is refused — the roles are
// named in the rule, so this also guards trap 1.
func TestCardLinksRLS_CommentorCannotLink(t *testing.T) {
	env := setupLinkEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_card_links/records",
		token:  env.commentorToken,
		body:   linkBody(env.card.Id, other.Id, "blocks"),
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

func TestCardLinksRLS_ViewerCannotLink(t *testing.T) {
	env := setupLinkEnv(t)
	other := cardsCard(t, env.app, env.project, env.list, "other", "a1", env.owner)

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_card_links/records",
		token:  env.viewerToken,
		body:   linkBody(env.card.Id, other.Id, "blocks"),
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

// Being a member of the target does not grant a link FROM it: the source is
// where the write lands. The editor is a viewer on `shared`, so a link whose
// source is a shared card must be refused even though the target is their own.
func TestCardLinksRLS_MembershipOnTheSourceIsNotEnough(t *testing.T) {
	env := setupLinkEnv(t)

	req{
		method: http.MethodPost,
		url:    "/api/collections/cards_card_links/records",
		token:  env.editorToken,
		body:   linkBody(env.sharedCard.Id, env.card.Id, "blocks"),
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

// --- read -------------------------------------------------------------------

// The union: a link is visible from EITHER end. Here the editor holds only the
// source's board, and the target is a board they cannot see at all.
func TestCardLinksRLS_VisibleFromTheNearEndAlone(t *testing.T) {
	env := setupLinkEnv(t)
	crossing := seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_card_links/records",
		token:   env.editorToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, crossing.Id},
	}.run(t, env.cardsEnv)
}

// And from the far end: the outsider owns `far` and sees the same row, without
// any standing on the source's board.
func TestCardLinksRLS_VisibleFromTheFarEndAlone(t *testing.T) {
	env := setupLinkEnv(t)
	crossing := seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method:  http.MethodGet,
		url:     "/api/collections/cards_card_links/records",
		token:   env.outsiderToken,
		want:    http.StatusOK,
		content: []string{`"totalItems":1`, crossing.Id},
	}.run(t, env.cardsEnv)
}

// The union must still exclude: a link with BOTH ends on a board the caller
// cannot see is not theirs to know about.
func TestCardLinksRLS_LinkBetweenTwoUnseenBoardsIsHidden(t *testing.T) {
	env := setupLinkEnv(t)
	farSecond := cardsCard(t, env.app, env.far, cardsList(t, env.app, env.far, "Doing", "a1"),
		"far-second", "a0", env.outsider)
	hidden := seedLink(t, env, env.farCard.Id, farSecond.Id, "related")

	req{
		method:     http.MethodGet,
		url:        "/api/collections/cards_card_links/records",
		token:      env.editorToken,
		want:       http.StatusOK,
		content:    []string{`"totalItems":0`},
		notContent: []string{hidden.Id},
	}.run(t, env.cardsEnv)
}

// THE REDACTION GUARANTEE, and the reason "either end" is not a leak.
//
// Reading a link on the near end hands over the far card's ID and nothing
// else. If this ever failed, the client's redacted chip would be theatre over
// a payload that already carried the secret.
func TestCardLinksRLS_ReadNeverCarriesTheFarCardsTitle(t *testing.T) {
	env := setupLinkEnv(t)
	secret, err := env.app.FindRecordById("cards_cards", env.farCard.Id)
	if err != nil {
		t.Fatalf("load far card: %v", err)
	}
	secret.Set("title", "SECRET-ROADMAP-TITLE")
	if err := env.app.Save(secret); err != nil {
		t.Fatalf("retitle far card: %v", err)
	}
	crossing := seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method:     http.MethodGet,
		url:        "/api/collections/cards_card_links/records",
		token:      env.editorToken,
		want:       http.StatusOK,
		content:    []string{crossing.Id, env.farCard.Id},
		notContent: []string{"SECRET-ROADMAP-TITLE"},
	}.run(t, env.cardsEnv)
}

// `expand` must not become the back door the rule closed.
func TestCardLinksRLS_ExpandDoesNotLeakTheFarCard(t *testing.T) {
	env := setupLinkEnv(t)
	secret, err := env.app.FindRecordById("cards_cards", env.farCard.Id)
	if err != nil {
		t.Fatalf("load far card: %v", err)
	}
	secret.Set("title", "SECRET-ROADMAP-TITLE")
	if err := env.app.Save(secret); err != nil {
		t.Fatalf("retitle far card: %v", err)
	}
	crossing := seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method:     http.MethodGet,
		url:        "/api/collections/cards_card_links/records?expand=target",
		token:      env.editorToken,
		want:       http.StatusOK,
		content:    []string{crossing.Id},
		notContent: []string{"SECRET-ROADMAP-TITLE"},
	}.run(t, env.cardsEnv)
}

// The other half of the same guarantee: holding the far card's ID is not a key
// to the card. cards_cards' own rule still refuses it.
func TestCardLinksRLS_TheFarCardItselfStaysUnreadable(t *testing.T) {
	env := setupLinkEnv(t)
	seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method: http.MethodGet,
		url:    "/api/collections/cards_cards/records/" + env.farCard.Id,
		token:  env.editorToken,
		want:   http.StatusNotFound,
	}.run(t, env.cardsEnv)
}

// --- update and delete ------------------------------------------------------

// updateRule is nil: a link is filed or removed, never edited.
//
// 403 rather than the 404 a filtered rule gives, and the difference is the
// point: a nil rule is superuser-only, so the request is refused before any
// record resolution happens. cards_activity's suite asserts the same shape.
func TestCardLinksRLS_NobodyCanEditALink(t *testing.T) {
	env := setupLinkEnv(t)
	link := seedLink(t, env, env.card.Id, env.sharedCard.Id, "blocks")

	req{
		method: http.MethodPatch,
		url:    "/api/collections/cards_card_links/records/" + link.Id,
		token:  env.ownerToken,
		body:   `{"type":"related"}`,
		want:   http.StatusForbidden,
		after:  requireLinkType(link.Id, "blocks"),
	}.run(t, env.cardsEnv)
}

func TestCardLinksRLS_SourceWriterCanUnlink(t *testing.T) {
	env := setupLinkEnv(t)
	link := seedLink(t, env, env.card.Id, env.sharedCard.Id, "blocks")

	req{
		method: http.MethodDelete,
		url:    "/api/collections/cards_card_links/records/" + link.Id,
		token:  env.editorToken,
		want:   http.StatusNoContent,
	}.run(t, env.cardsEnv)
}

// The far board's members may SEE the link but must not detach it: the link
// hangs off the source, and the source's board is the one tracking the
// dependency.
func TestCardLinksRLS_TargetSideCannotUnlink(t *testing.T) {
	env := setupLinkEnv(t)
	link := seedLink(t, env, env.card.Id, env.farCard.Id, "blocks")

	req{
		method: http.MethodDelete,
		url:    "/api/collections/cards_card_links/records/" + link.Id,
		token:  env.outsiderToken,
		want:   http.StatusNotFound,
		after:  requireLinkExists(link.Id),
	}.run(t, env.cardsEnv)
}

func requireLinkType(linkID, want string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		row, err := app.FindRecordById("cards_card_links", linkID)
		if err != nil {
			t.Fatalf("reload link: %v", err)
		}
		if got := row.GetString("type"); got != want {
			t.Fatalf("link type = %q, want %q", got, want)
		}
	}
}

func requireLinkExists(linkID string) func(t testing.TB, app *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		if _, err := app.FindRecordById("cards_card_links", linkID); err != nil {
			t.Fatalf("link was deleted by a caller that should not have been able to: %v", err)
		}
	}
}
