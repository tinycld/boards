package boards

import "tinycld.org/core/oauth"

const (
	scopeRead  = "boards:read"
	scopeWrite = "boards:write"
)

// oauthPackage declares what an OAuth token may reach in boards. Registered
// from registerShared; the catalog, the consent screen and the CLI's login
// request are all derived from it. A route or collection missing here is
// default-denied for OAuth callers only — sessions still work — so the CLI's
// surface is pinned in oauth_scopes_test.go. boards_epics shipped with no
// entry and was default-denied for the life of the feature; the move
// endpoint shipped unclassified and `card move --board` 403'd over a token
// while the same command worked for a session.
//
// A grant here widens WHICH ROWS a token may touch not at all. Every content
// row carries a `project` relation (denormalized precisely so a rule can
// reach it) and the access rules resolve membership through
// boards_project_members before any of this applies. The scope only decides
// whether an OAuth caller may use the collection at all.
func oauthPackage() oauth.Package {
	rw := oauth.Access{Read: []string{scopeRead}, Write: []string{scopeWrite}}
	ro := oauth.Access{Read: []string{scopeRead}}
	return oauth.Package{
		Slug: "boards",
		Scopes: []oauth.Scope{
			{ID: scopeRead, Label: "Read your boards and cards"},
			{ID: scopeWrite, Label: "Create and modify your boards and cards"},
		},
		Collections: map[string]oauth.Access{
			// Board content.
			"boards_projects":        rw,
			"boards_lists":           rw,
			"boards_cards":           rw,
			"boards_labels":          rw,
			"boards_checklist_items": rw,
			"boards_comments":        rw,
			"boards_attachments":     rw,

			// The junctions. boards_card_links is the only one that spans two
			// boards: its create rule already demands write on the source and
			// membership on the target, so a token cannot link boards its
			// holder could not link through the app. Reading one discloses
			// the far card's id and nothing else.
			"boards_card_links":        rw,
			"boards_comment_reactions": rw,
			"boards_card_reactions":    rw,
			"boards_card_watchers":     rw,

			// The planning collections — board content in every sense above.
			"boards_epics":   rw,
			"boards_sprints": rw,

			// PR links are board content: a caller who may edit a card may
			// associate a pull request with it.
			"boards_pr_links": rw,

			// READ-ONLY because that is the schema, not a policy choice:
			// boards_activity and boards_sprint_snapshots are server-written
			// history with nil create/update/delete rules (pb-migrations
			// 1980000008), so no client of any kind writes them. Granting
			// write would name a capability that does not exist.
			"boards_activity":         ro,
			"boards_sprint_snapshots": ro,

			// READ-ONLY for OAuth callers, deliberately, and NOT because the
			// rules are weak — they already confine both to owners. These two
			// are the SHARING surface: a write to boards_project_members adds
			// a person to a board, and a write to boards_share_links mints a
			// URL that opens the board to anyone holding it. That is a
			// categorically larger grant than editing cards, and
			// "boards:write" reads to a user consenting on the OAuth screen as
			// "change my cards" — not "give other people my boards".
			//
			// So a leaked or over-broad CLI token cannot reshare a board or
			// publish a public link; those stay in the app, where the Share
			// dialog shows exactly who gains access. Relaxing this later is
			// one line and backward compatible; the reverse would silently
			// revoke a capability integrations had built on, so start closed.
			"boards_project_members": ro,
			"boards_share_links":     ro,

			// READ-ONLY, and for the reason directly above rather than a
			// weaker one. A row here names a repository this deployment holds
			// a GitHub credential for; writing one points that credential at
			// new source code. "boards:write" reads on a consent screen as
			// "change my cards", not "connect my repositories" — so start
			// closed. Relaxing this later is one line; the reverse would
			// silently revoke a capability integrations had built on.
			"boards_project_repos": ro,
		},
		Endpoints: map[string][]string{
			"GET /api/boards/search": {scopeRead},
			// Whole-board transfer. The read/write split is the point: an
			// export handed boards:write would be reachable by a token granted
			// only to change cards, and an import admitted by boards:read
			// alone would let a read-only integration create a board full of
			// content.
			"GET /api/boards/export":  {scopeRead},
			"POST /api/boards/import": {scopeWrite},
		},
		EndpointPrefixes: []oauth.EndpointPrefix{
			// Per-record POST families: /cards/{id}/move, /sprints/{id}/start
			// and /complete. Both mutate board content the caller must
			// already be a writer on (the handlers restate that check in Go).
			{Method: "POST", Prefix: "/api/boards/cards/", Scopes: []string{scopeWrite}},
			{Method: "POST", Prefix: "/api/boards/sprints/", Scopes: []string{scopeWrite}},
		},
	}
}
