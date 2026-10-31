package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
)

func newBareBoardsApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

// An installation id is GitHub's, not the app's: two apps can hold the same
// one. App B must mint its own token with its own GitHub App key, never
// reuse the token app A minted.
func TestGitHubTokenCacheIsPerApp(t *testing.T) {
	a, b := newBareBoardsApp(t), newBareBoardsApp(t)
	githubTokenCacheFor(a).set("42", "ghs_app_a_token", time.Now().Add(time.Hour))

	token, err := githubInstallationToken(b, "42")
	if token == "ghs_app_a_token" {
		t.Fatal("app B was handed app A's installation token")
	}
	if err == nil {
		t.Fatal("app B has no GitHub App configured; minting must fail")
	}
	if got, ok := githubTokenCacheFor(a).get("42"); !ok || got != "ghs_app_a_token" {
		t.Fatal("app A lost its cached token")
	}
}

func TestShareLimitersArePerApp(t *testing.T) {
	a, b := newBareBoardsApp(t), newBareBoardsApp(t)
	for otpLimiter.For(a).Allow("203.0.113.9") {
	}
	if !otpLimiter.For(b).Allow("203.0.113.9") {
		t.Fatal("app B's OTP budget was spent by app A")
	}
}

func TestRecountLocksArePerApp(t *testing.T) {
	a, b := newBareBoardsApp(t), newBareBoardsApp(t)
	if idLock(a, recountLocksKey, "card-1") == idLock(b, recountLocksKey, "card-1") {
		t.Fatal("two apps share one recount lock for the same card id")
	}
	if idLock(a, recountLocksKey, "card-1") != idLock(a, recountLocksKey, "card-1") {
		t.Fatal("one app got two locks for one card id")
	}
}
