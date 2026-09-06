package boards

import (
	"testing"

	"tinycld.org/core/oauth"
)

func registerScopes(t *testing.T) {
	t.Helper()
	oauth.RegisterPackage(oauthPackage())
}

// The board-content collections the boards CLI drives. Every one of these was
// default-denied until the commands needed them: the rules admit the caller,
// the handler runs in tests, and only a real OAuth client sees the 403.
func TestOAuthContentCollectionsAreReadWrite(t *testing.T) {
	registerScopes(t)
	for _, collection := range []string{
		"boards_projects", "boards_lists", "boards_cards", "boards_labels",
		"boards_checklist_items", "boards_comments", "boards_attachments",
		"boards_card_links", "boards_comment_reactions", "boards_card_watchers",
		// boards_epics shipped with no entry and was default-denied for the
		// life of the feature; naming it here is what keeps the next
		// collection from repeating that.
		"boards_epics", "boards_sprints",
	} {
		path := "/api/collections/" + collection + "/records"
		read := oauth.ScopeForRoute("GET", path)
		if !read.SatisfiedBy([]string{scopeRead}) {
			t.Errorf("GET %s: boards:read must admit a read (got %v)", path, read)
		}
		write := oauth.ScopeForRoute("POST", path)
		if !write.SatisfiedBy([]string{scopeWrite}) {
			t.Errorf("POST %s: boards:write must admit a write (got %v)", path, write)
		}
		// Read must not carry write. A token consented to read-only access
		// that could still POST would make the consent screen a lie.
		if write.SatisfiedBy([]string{scopeRead}) {
			t.Errorf("POST %s: boards:read alone must NOT admit a write", path)
		}
	}
}

// The sharing surface is deliberately READ-ONLY for OAuth callers. A write to
// boards_project_members adds a person to a board; a write to
// boards_share_links mints a URL that opens the board to anyone holding it.
// Asserted positively so relaxing it is a deliberate edit to this test rather
// than an unnoticed side effect of touching the registration.
func TestOAuthSharingSurfaceIsReadOnly(t *testing.T) {
	registerScopes(t)
	for _, collection := range []string{"boards_project_members", "boards_share_links"} {
		path := "/api/collections/" + collection + "/records"
		if !oauth.ScopeForRoute("GET", path).SatisfiedBy([]string{scopeRead}) {
			t.Errorf("GET %s: boards:read must still admit reading the roster/links", path)
		}
		// Every write verb, not just POST: revoking a link is a DELETE and
		// changing a member's role is a PATCH.
		for _, method := range []string{"POST", "PATCH", "PUT", "DELETE"} {
			p := path
			if method != "POST" {
				p += "/abc123"
			}
			if oauth.ScopeForRoute(method, p).SatisfiedBy([]string{scopeWrite, scopeRead}) {
				t.Errorf("%s %s must not be reachable — an OAuth token must not be able to "+
					"reshare a board or mint a public link", method, p)
			}
		}
	}
}

// boards_activity and boards_sprint_snapshots are server-written: their write
// rules are nil, so granting write would name a capability that does not
// exist and could never succeed.
func TestOAuthServerWrittenCollectionsAreReadOnly(t *testing.T) {
	registerScopes(t)
	for _, collection := range []string{"boards_activity", "boards_sprint_snapshots"} {
		path := "/api/collections/" + collection + "/records"
		if !oauth.ScopeForRoute("GET", path).SatisfiedBy([]string{scopeRead}) {
			t.Errorf("GET %s: boards:read must admit reading it", path)
		}
		for _, method := range []string{"POST", "PATCH", "PUT", "DELETE"} {
			p := path
			if method != "POST" {
				p += "/abc123"
			}
			if oauth.ScopeForRoute(method, p).SatisfiedBy([]string{scopeWrite, scopeRead}) {
				t.Errorf("%s %s must not be reachable — the collection is server-written", method, p)
			}
		}
	}
}

// The bespoke routes: search, whole-board transfer, and the per-record POST
// families classified by prefix. The move endpoint shipped unclassified, so
// `card move --board` over a token was denied while a session succeeded.
func TestOAuthClassifiesEndpoints(t *testing.T) {
	registerScopes(t)
	for _, r := range []struct{ method, path, scope string }{
		{"GET", "/api/boards/search", scopeRead},
		{"GET", "/api/boards/export", scopeRead},
		{"POST", "/api/boards/import", scopeWrite},
		{"POST", "/api/boards/cards/abc123/move", scopeWrite},
		{"POST", "/api/boards/sprints/abc123/start", scopeWrite},
		{"POST", "/api/boards/sprints/abc123/complete", scopeWrite},
	} {
		rule := oauth.ScopeForRoute(r.method, r.path)
		if len(rule) == 0 {
			t.Errorf("%s %s is default-denied for OAuth callers", r.method, r.path)
			continue
		}
		if !rule.SatisfiedBy([]string{r.scope}) {
			t.Errorf("%s %s: %q must admit it (got %v)", r.method, r.path, r.scope, rule)
		}
	}
	// The read/write split is the assertion that matters for import/export
	// and for the record families.
	for _, r := range []struct{ method, path string }{
		{"POST", "/api/boards/import"},
		{"POST", "/api/boards/cards/abc123/move"},
		{"POST", "/api/boards/sprints/abc123/start"},
	} {
		if oauth.ScopeForRoute(r.method, r.path).SatisfiedBy([]string{scopeRead}) {
			t.Errorf("%s %s: boards:read alone must NOT admit a write", r.method, r.path)
		}
	}
	if oauth.ScopeForRoute("GET", "/api/boards/export").SatisfiedBy([]string{scopeWrite}) {
		t.Error("GET /api/boards/export: boards:write alone must not admit an export")
	}
	// The bare family prefixes are different routes and must not ride along.
	for _, path := range []string{"/api/boards/cards/", "/api/boards/sprints/"} {
		if got := oauth.ScopeForRoute("POST", path); len(got) != 0 {
			t.Errorf("POST %s: the bare prefix must stay default-denied, got %v", path, got)
		}
	}
}

// The search source's scopes must be scopes this package actually registers,
// or the federated search would admit a scope no grant can carry.
func TestSearchSourceScopesAreRegistered(t *testing.T) {
	registerScopes(t)
	registered := oauth.PackageScopes("boards")
	for _, s := range searchSource().Scopes {
		if !oauth.HasScope(registered, s) {
			t.Errorf("search source names scope %q, which boards does not register (%v)", s, registered)
		}
	}
}
