package boards

import (
	"net/http/httptest"
	"testing"
)

// The domain list ends up verbatim in a `frame-ancestors` directive, and CSP
// has no escaping — so a value that survives parseEmbedDomains must be safe to
// concatenate. These cases are the ones that would not be.
func TestParseEmbedDomainsRejectsUnsafeOrigins(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{"bare host is ambiguous across schemes", "example.com"},
		{"a path is silently ignored by the browser", "https://example.com/board"},
		{"a query is not part of an origin", "https://example.com?a=b"},
		{"credentials are not part of an origin", "https://user:pw@example.com"},
		{"a wildcard is a decision we have not taken", "https://*.example.com"},
		{"an unsupported scheme", "javascript://example.com"},
		{"a semicolon would forge a second directive", "https://example.com;frame-ancestors *"},
		{"a quote would break out of the value", "https://example.com'"},
		{"a comma would forge a second header", "https://example.com,https://evil.example"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, err := parseEmbedDomains(tc.in); err == nil {
				t.Fatalf("parseEmbedDomains(%q) = %q, want an error", tc.in, got)
			}
		})
	}
}

// An empty list is the DEFAULT and means "not embeddable" — not an error. Every
// link that predates the embed columns reads back this way, so a refusal here
// would fail every ordinary mint.
func TestParseEmbedDomainsTreatsEmptyAsNotEmbeddable(t *testing.T) {
	for _, in := range []string{"", "   ", "\n\t"} {
		got, err := parseEmbedDomains(in)
		if err != nil {
			t.Fatalf("parseEmbedDomains(%q) errored: %v", in, err)
		}
		if got != "" {
			t.Errorf("parseEmbedDomains(%q) = %q, want empty", in, got)
		}
	}
}

func TestParseEmbedDomainsNormalizes(t *testing.T) {
	got, err := parseEmbedDomains("https://a.example.com\n  http://localhost:3000 https://a.example.com")
	if err != nil {
		t.Fatalf("parseEmbedDomains: %v", err)
	}
	// Deduplicated, whitespace-normalized, order preserved.
	want := "https://a.example.com http://localhost:3000"
	if got != want {
		t.Errorf("parseEmbedDomains = %q, want %q", got, want)
	}
}

func TestParseEmbedDomainsCapsTheCount(t *testing.T) {
	in := ""
	for i := 0; i <= maxEmbedDomains; i++ {
		in += "https://x" + string(rune('a'+i)) + ".example.com "
	}
	if _, err := parseEmbedDomains(in); err == nil {
		t.Fatal("want an error past the cap")
	}
}

// The URL grammar that earns a framing grant. Strict on purpose: anything this
// does not recognise falls through to core's 'none'.
func TestEmbedTokenFromRequest(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	cases := []struct {
		name string
		url  string
		want string
	}{
		{"an embed of a share link", "/p/boards/" + token + "?embed=1", token},
		{"the bare share page is never framable", "/p/boards/" + token, ""},
		{"embed=0 is not an opt-in", "/p/boards/" + token + "?embed=0", ""},
		{"the workspace is never framable", "/a/boards/PL?embed=1", ""},
		{"another package's share route", "/p/drive/share/" + token + "?embed=1", ""},
		{"a deeper path must not inherit the grant", "/p/boards/" + token + "/x?embed=1", ""},
		{"no token", "/p/boards/?embed=1", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", tc.url, nil)
			if got := embedTokenFromRequest(r); got != tc.want {
				t.Errorf("embedTokenFromRequest(%q) = %q, want %q", tc.url, got, tc.want)
			}
		})
	}
}

// --------------------------------------------------------------------------
// The framing grant against a real database.

// setEmbedDomains is the write the mint endpoint makes, applied directly so
// these cases can build links the endpoint would refuse to build (a revoked
// one, an expired one).
func setEmbedDomains(t *testing.T, env *cardsEnv, token, domains string) {
	t.Helper()
	link, err := env.app.FindFirstRecordByFilter("boards_share_links",
		"token = {:t}", map[string]any{"t": token})
	if err != nil || link == nil {
		t.Fatalf("find link %q: %v", token, err)
	}
	link.Set("embed_domains", domains)
	if err := env.app.Save(link); err != nil {
		t.Fatalf("save link: %v", err)
	}
}

// The property that matters most: a link stops being FRAMABLE at the same
// instant it stops being READABLE. Revocation and expiry are the two ways that
// happens, and both are checked by the resolver both paths share — which is
// why they cannot drift apart.
func TestEmbedDomainsFollowTheLinksLiveness(t *testing.T) {
	env := setupCardsEnv(t)

	live := shareLink(t, env, env.project.Id, tok64("elive"), "viewer", true, "")
	revoked := shareLink(t, env, env.project.Id, tok64("erevoked"), "viewer", false, "")
	expired := shareLink(t, env, env.project.Id, tok64("eexpired"), "viewer", true,
		"2020-01-01 00:00:00.000Z")

	for _, token := range []string{live, revoked, expired} {
		setEmbedDomains(t, env, token, "https://example.com")
	}

	if got := embedDomainsFor(env.app, live); len(got) != 1 || got[0] != "https://example.com" {
		t.Errorf("a live link should be framable, got %v", got)
	}
	if got := embedDomainsFor(env.app, revoked); got != nil {
		t.Errorf("a revoked link must not be framable, got %v", got)
	}
	if got := embedDomainsFor(env.app, expired); got != nil {
		t.Errorf("an expired link must not be framable, got %v", got)
	}
}

// A live link with no domains is the default state of every link, including
// every one that predates the columns. It must not be framable.
func TestEmbedDomainsAreEmptyWithoutAnAllowlist(t *testing.T) {
	env := setupCardsEnv(t)
	token := shareLink(t, env, env.project.Id, tok64("enone"), "viewer", true, "")

	if got := embedDomainsFor(env.app, token); got != nil {
		t.Errorf("a link naming no domains must not be framable, got %v", got)
	}
}

func TestEmbedDomainsOfAnUnknownTokenAreEmpty(t *testing.T) {
	env := setupCardsEnv(t)

	if got := embedDomainsFor(env.app, tok64("nosuch")); got != nil {
		t.Errorf("an unknown token must not be framable, got %v", got)
	}
}

// The client reads `embed` through paramString (first value of a repeat) and
// Go's Query().Get() does the same. Pinned because the two sides disagreeing is
// how a page loses its chrome while being refused the framing grant, or keeps
// its chrome while holding one.
func TestEmbedTokenFromRequestTakesTheFirstRepeatedValue(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	r := httptest.NewRequest("GET", "/p/boards/"+token+"?embed=1&embed=1", nil)
	if got := embedTokenFromRequest(r); got != token {
		t.Errorf("embedTokenFromRequest = %q, want the token", got)
	}
}
