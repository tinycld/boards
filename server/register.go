package cards

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/fts"
	"tinycld.org/core/offboard"
	"tinycld.org/core/search"
)

// ftsConfig is the cards FTS index/search config, driving both the index-sync
// hooks and the /api/cards/search route. The fts_cards virtual table is created
// by pb-migrations/1980000002; this only reads and writes it.
//
// description is markdown source rather than HTML, so it is indexed verbatim.
var ftsConfig = fts.Config{
	Slug:       "cards",
	Collection: "cards_cards",
	Table:      "fts_cards",
	Columns: []fts.Column{
		{FTS: "title", Field: "title"},
		{FTS: "description", Field: "description"},
	},
	Scope: fts.MemberScope{
		Table:       "cards_project_members",
		MemberField: "project",
		UserField:   "user",
		RecordField: "project",
	},
	Output: []fts.OutputColumn{
		{Name: "title"},
		{Name: "project"},
		{Name: "list"},
		// The card key's numeric half, so a palette row can show OTTER-123.
		//
		// Deliberately an OUTPUT column and NOT an indexed one. FTS5 cannot
		// ALTER-add a column, so indexing the key would mean dropping,
		// recreating and backfilling fts_cards — real risk to the only search
		// index cards has — and it would not even work well: `porter
		// unicode61` splits OTTER-123 on the hyphen, so the full key would
		// match every card on the OTTER board plus everything mentioning
		// "123". Exact-key lookup belongs to the URL resolver
		// (hooks/useCardRoute.ts), which is the right shape for it.
		{Name: "number", Type: "number"},
	},
	// Someone typing `/` wants active work, not history.
	ExcludeField: "archived",
}

// Register wires server-side behavior for the Cards package. Core's generator
// injects a call to this from server/package_extensions.go once the package is
// linked.
//
// Cards is deliberately rule-first: authorization decisions live in the
// access rules the migrations ship (see
// pb-migrations/1980000000_create_cards_collections.js), not in Go hooks,
// because the rules are the ENTIRE authorization for every path that does not
// run through a hook — the REST API a client drives directly, and any future
// caller we do not control. A Go guard can only add to them, never stand in for
// them. The *_rls_test.go files in this directory are what hold that line; they
// bind no hooks and measure the rule engine alone.
//
// NOTE: earlier comments across this package justified the above with "a hosted
// multi-org tenant runs no feature Go at all". That is not true, and anything
// relying on it should be re-read. tinycld/server/main.go hands the SAME
// generated registerPackageExtensions to the tenant path and the single-org
// path ("the SAME generated registrar serves both modes … the artifact is the
// gate"), and multi-org/README.md says a tenant "registers its linked feature Go
// unconditionally". So this file DOES run on a hosted tenant. The rule-first
// design stands on its own merits above; the old rationale was simply wrong.
//
// What lives here is only what a rule genuinely cannot express: the board-face
// counters (a rule cannot aggregate), the last-owner guard (a rule sees one row
// and cannot count the remaining owners), presence-room authorization (a
// WebSocket upgrade never passes through the collection rules) and, in M6a,
// share-link token minting (32 bytes of entropy must come from the server).
func Register(app *pocketbase.PocketBase) {
	registerShared(app)
	// Cards binds no listener and mounts no protocol server, so this single
	// entry point serves the single-org app and a multi-org tenant
	// identically. If hosted behavior must ever differ, detect it with
	// coreserver.GetTenantContext — never fork registerShared.
}

// registerShared is the single source of truth for what BOTH compositions run.
func registerShared(app *pocketbase.PocketBase) {
	// A departing user's authored comments and uploaded attachments reassign
	// rather than cascade — the board keeps its history. Every one of these
	// relations is cascadeDelete:false in the migration, which is the shape
	// offboard exists to handle.
	for _, ref := range []offboard.ReassignableRef{
		{Collection: "cards_projects", Field: "created_by"},
		{Collection: "cards_cards", Field: "created_by"},
		{Collection: "cards_comments", Field: "author"},
		{Collection: "cards_attachments", Field: "uploaded_by"},
	} {
		offboard.RegisterReassignable(ref)
	}

	// Personal automation rules on cards resolve their owner through board
	// membership; created_by would scope them to whoever made the card, so a
	// colleague moving your card would never fire your rule.
	registerAutomation()

	registerBoardCounters(app)
	// Unrelated to the counters above despite the adjacency, and the opposite
	// of them in every invariant: this one is a monotonic sequence, it runs
	// before the row lands, and it FAILS the write when it cannot allocate.
	// See card_number.go.
	registerCardNumbers(app)
	registerMemberLastOwnerGuard(app)
	registerRealtime(app)

	// FTS index-sync record hooks only — deliberately NOT fts.Register, which
	// would also mount GET /api/cards/search. Cards has no in-app search box,
	// so the federated /api/search is its only reader; a per-package route
	// would be dead on arrival.
	fts.RegisterSync(app, ftsConfig)

	// Cards' contribution to the federated GET /api/search. Registered here
	// rather than in Register so a hosted tenant and a self-hosted deployment
	// search identically.
	search.RegisterSources(searchSource())

	registerShareLinkEndpoints(app)
}

// registerShareLinkEndpoints mounts cards' first HTTP routes (M6a).
//
// Owner-facing management only. There is deliberately no public read endpoint:
// a share-link visitor reads the board through the ORDINARY collection REST and
// realtime, because pb-migrations/1980000003 lets their token satisfy the
// list/view rules. That is the whole point of the rules-based design — no
// snapshot endpoint to keep in step with the board UI, and no second read path
// to audit.
//
// Every route requires auth. A public route here would be one that omits
// requireAuth; there is no exemptPaths list to add to.
func registerShareLinkEndpoints(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		bindShareLinkRoutes(e)
		return e.Next()
	})
}

// bindShareLinkRoutes is the route table itself, split out so the tests mount
// the SAME one rather than a paraphrase. A test that registered its own routes
// would keep passing after this table changed.
func bindShareLinkRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/cards/share-link", func(re *core.RequestEvent) error {
		return handleCreateShareLink(e.App, re)
	}).BindFunc(requireAuth)

	e.Router.GET("/api/cards/share-links", func(re *core.RequestEvent) error {
		return handleListShareLinks(e.App, re)
	}).BindFunc(requireAuth)

	e.Router.DELETE("/api/cards/share-link/{id}", func(re *core.RequestEvent) error {
		return handleRevokeShareLink(e.App, re)
	}).BindFunc(requireAuth)

	// PUBLIC — no requireAuth, deliberately. These are how someone with no
	// account gets one: a commentor/editor link holder proves an email address
	// and is minted a membership. A public route here is simply one that omits
	// the middleware; there is no exemptPaths list to add to.
	e.Router.GET("/api/cards/share-link/{token}", func(re *core.RequestEvent) error {
		return handleShareLinkMetadata(e.App, re)
	})

	e.Router.POST("/api/cards/share-link/{token}/otp-request", func(re *core.RequestEvent) error {
		return handleShareOTPRequest(e.App, re)
	})

	e.Router.POST("/api/cards/share-link/{token}/otp-verify", func(re *core.RequestEvent) error {
		return handleShareOTPVerify(e.App, re)
	})
}

func requireAuth(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}
