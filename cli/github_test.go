package cli

import (
	"strings"
	"testing"
)

// ── GitHub repos ─────────────────────────────────────────────────────────────

func TestGitHubListPrintsAttachedRepos(t *testing.T) {
	f := board(t)
	f.addRepo("repo1", "prjA", "acme/widgets")
	f.addRepo("repo2", "prjA", "acme/backend")
	_, c := f.serve()

	out, _, err := runCmd(t, c, "boards", "github", "list", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"acme/widgets", "acme/backend"} {
		if !strings.Contains(out, want) {
			t.Errorf("github list missing %q:\n%s", want, out)
		}
	}
}

func TestGitHubListIsEmptyWhenNoneAttached(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "boards", "github", "list", "prjA")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "acme/") {
		t.Errorf("expected no repos, got:\n%s", out)
	}
}

// There is deliberately no `github attach` or `github detach` command — see
// the comment in github.go and the fake's deliberately-missing
// create/update/delete handlers for boards_project_repos: a write reaching
// that fake fails the test outright. Cobra's own listing is the proof here —
// `github` (with no Args validator) falls through to its help text rather
// than dispatching "attach" to anything, and `list` is the only entry in it.
func TestGitHubHasNoAttachCommand(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "boards", "github", "attach", "prjA", "acme/widgets")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "  attach") {
		t.Errorf("`github attach` must not exist:\n%s", out)
	}
	if !strings.Contains(out, "Available Commands:") || !strings.Contains(out, "  list") {
		t.Errorf("expected help listing only `list`:\n%s", out)
	}
	if f.lastPrLinkCreate != nil {
		t.Error("no write should have reached the server")
	}
}

// ── card link-pr ─────────────────────────────────────────────────────────────

func TestGitHubCardLinkPrWritesAManualLink(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "boards", "card", "link-pr", "crdCopy",
		"https://github.com/acme/widgets/pull/42")
	if err != nil {
		t.Fatal(err)
	}
	if f.lastPrLinkCreate == nil {
		t.Fatal("no PR link was created")
	}
	for field, want := range map[string]string{
		"card":        "crdCopy",
		"project":     "prjA",
		"repo":        "acme/widgets",
		"link_source": "manual",
		"state":       "open",
	} {
		if got := str(f.lastPrLinkCreate[field]); got != want {
			t.Errorf("pr link %s = %q, want %q", field, got, want)
		}
	}
	if got := num(f.lastPrLinkCreate["number"]); got != 42 {
		t.Errorf("pr link number = %d, want 42", got)
	}
	if unlinked, ok := f.lastPrLinkCreate["unlinked"].(bool); !ok || unlinked {
		t.Errorf("a freshly linked PR must not be tombstoned: %v", f.lastPrLinkCreate["unlinked"])
	}
	if !strings.Contains(out, "acme/widgets") {
		t.Errorf("link-pr output does not name the repo:\n%s", out)
	}
}

// accepts resolves a card by KEY too, the same as `card link`/`card view`.
func TestGitHubCardLinkPrAcceptsACardKey(t *testing.T) {
	f := board(t)
	f.projects["prjA"].Slug = "PROD"
	f.cards["crdCopy"].Number = 7
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "boards", "card", "link-pr", "PROD-7",
		"https://github.com/acme/widgets/pull/1"); err != nil {
		t.Fatal(err)
	}
	if got := str(f.lastPrLinkCreate["card"]); got != "crdCopy" {
		t.Errorf("card = %q, want crdCopy", got)
	}
}

func TestGitHubCardLinkPrRejectsANonGitHubURL(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "boards", "card", "link-pr", "crdCopy",
		"https://gitlab.com/acme/widgets/-/merge_requests/42")
	if err == nil {
		t.Fatal("a non-GitHub URL must be refused")
	}
	if !strings.Contains(err.Error(), "not a GitHub pull request URL") {
		t.Errorf("error does not explain the problem: %v", err)
	}
	if f.lastPrLinkCreate != nil {
		t.Error("a rejected URL must not reach the server")
	}
}

// The two spoofing shapes parsePrUrl.ts is written to refuse: a path prefix
// impersonating the host, and a lookalike subdomain. A regex loose enough to
// accept the real URL accepts both of these too — which is exactly why the
// parser compares u.Hostname() instead.
func TestGitHubCardLinkPrRejectsSpoofedHosts(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	for _, spoof := range []string{
		"https://evil.example/github.com/acme/widgets/pull/1",
		"https://github.com.evil.example/acme/widgets/pull/1",
	} {
		if _, _, err := runCmd(t, c, "boards", "card", "link-pr", "crdCopy", spoof); err == nil {
			t.Errorf("spoofed URL must be refused: %s", spoof)
		}
	}
	if f.lastPrLinkCreate != nil {
		t.Error("a spoofed URL must not reach the server")
	}
}

func TestGitHubCardLinkPrRejectsIssuesAndZero(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	for _, bad := range []string{
		"https://github.com/acme/widgets/issues/7",
		"https://github.com/acme/widgets/pull/0",
	} {
		if _, _, err := runCmd(t, c, "boards", "card", "link-pr", "crdCopy", bad); err == nil {
			t.Errorf("must be refused: %s", bad)
		}
	}
}

// Trailing slashes, fragments, query strings and a sub-path (/files,
// /commits) all still name the same PR and must be accepted.
func TestGitHubCardLinkPrAcceptsURLVariants(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	variants := []string{
		"https://github.com/acme/widgets/pull/42/",
		"https://github.com/acme/widgets/pull/42#discussion_r1",
		"https://github.com/acme/widgets/pull/42?tab=files",
		"https://github.com/acme/widgets/pull/42/files",
		"https://github.com/acme/widgets/pull/42/commits",
		"https://www.github.com/acme/widgets/pull/42",
	}
	for i, u := range variants {
		f.lastPrLinkCreate = nil
		cardID := f.addCard(f.nextID("crd"), "prjA", "lstTodo", "variant", "z"+string(rune('a'+i))).ID
		if _, _, err := runCmd(t, c, "boards", "card", "link-pr", cardID, u); err != nil {
			t.Errorf("variant rejected: %s: %v", u, err)
			continue
		}
		if got := num(f.lastPrLinkCreate["number"]); got != 42 {
			t.Errorf("%s: number = %d, want 42", u, got)
		}
		if got := str(f.lastPrLinkCreate["repo"]); got != "acme/widgets" {
			t.Errorf("%s: repo = %q, want acme/widgets", u, got)
		}
	}
}

func TestGitHubCardLinkPrUnknownCardFailsCleanly(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "boards", "card", "link-pr", "NOPE-1",
		"https://github.com/acme/widgets/pull/1")
	if err == nil {
		t.Fatal("an unknown card key must fail")
	}
	if strings.Contains(err.Error(), "goroutine") || strings.Contains(err.Error(), ".go:") {
		t.Errorf("error looks like a stack trace, not a message: %v", err)
	}
}

// ── card unlink-pr ───────────────────────────────────────────────────────────

// A MANUAL link is deleted outright — nothing re-derives it.
func TestGitHubCardUnlinkPrDeletesAManualLink(t *testing.T) {
	f := board(t)
	f.prLinks["prl1"] = &prLink{
		ID: "prl1", Card: "crdCopy", Project: "prjA", Repo: "acme/widgets",
		Number: 42, LinkSource: "manual",
	}
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "boards", "card", "unlink-pr", "crdCopy",
		"https://github.com/acme/widgets/pull/42"); err != nil {
		t.Fatal(err)
	}
	if len(f.deletedPrLinks) != 1 || f.deletedPrLinks[0] != "prl1" {
		t.Errorf("expected prl1 deleted, got %v", f.deletedPrLinks)
	}
	if f.lastPrLinkPatch != nil {
		t.Error("a manual link must be deleted, not patched")
	}
}

// A DERIVED link (branch/title/body) is TOMBSTONED, never deleted — branch
// linkage recomputes on every webhook delivery, so a deleted derived link
// would simply reappear on the next push. This is the same rule
// usePrLinkMutations.ts's useUnlinkPr follows; the CLI must agree with the UI.
func TestGitHubCardUnlinkPrTombstonesADerivedLink(t *testing.T) {
	for _, source := range []string{"branch", "title", "body"} {
		f := board(t)
		f.prLinks["prl1"] = &prLink{
			ID: "prl1", Card: "crdCopy", Project: "prjA", Repo: "acme/widgets",
			Number: 42, LinkSource: source,
		}
		_, c := f.serve()

		if _, _, err := runCmd(t, c, "boards", "card", "unlink-pr", "crdCopy",
			"https://github.com/acme/widgets/pull/42"); err != nil {
			t.Fatalf("%s: %v", source, err)
		}
		if len(f.deletedPrLinks) != 0 {
			t.Errorf("%s: link source must not be deleted, got deletes: %v", source, f.deletedPrLinks)
		}
		if v, ok := f.lastPrLinkPatch["unlinked"].(bool); !ok || !v {
			t.Errorf("%s: expected unlinked=true patch, got %v", source, f.lastPrLinkPatch)
		}
	}
}

func TestGitHubCardUnlinkPrRejectsANonGitHubURL(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "boards", "card", "unlink-pr", "crdCopy",
		"not-a-url"); err == nil {
		t.Error("a non-GitHub URL must be refused")
	}
}

func TestGitHubCardUnlinkPrReportsWhenNotLinked(t *testing.T) {
	f := board(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "boards", "card", "unlink-pr", "crdCopy",
		"https://github.com/acme/widgets/pull/99")
	if err == nil {
		t.Fatal("unlinking a PR that was never linked must fail")
	}
}
