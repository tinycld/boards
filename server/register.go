package cards

import (
	"github.com/pocketbase/pocketbase"

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
// because a hosted multi-org tenant runs no feature Go at all — there the rule
// IS the whole authorization. The *_rls_test.go files in this directory are
// what hold that line; they bind no hooks and measure the rule engine alone.
//
// What lives here is only what a rule genuinely cannot express: the board-face
// counters (a rule cannot aggregate), the last-owner guard (a rule sees one
// row and cannot count the remaining owners — and on a hosted tenant only the
// Share dialog's client guard stands, so neither replaces the other) and, in
// M6a, share-link token minting (32 bytes of entropy must come from the
// server).
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

	registerBoardCounters(app)
	registerMemberLastOwnerGuard(app)

	// FTS index-sync record hooks only — deliberately NOT fts.Register, which
	// would also mount GET /api/cards/search. Cards has no in-app search box,
	// so the federated /api/search is its only reader; a per-package route
	// would be dead on arrival.
	fts.RegisterSync(app, ftsConfig)

	// Cards' contribution to the federated GET /api/search. Registered here
	// rather than in Register so a hosted tenant and a self-hosted deployment
	// search identically.
	search.RegisterSources(searchSource())
}
