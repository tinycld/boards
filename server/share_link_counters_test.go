package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/sharequota"
)

// seedShareLink creates a live link on the given project and returns its token.
func seedCounterShareLink(t *testing.T, app core.App, project, createdBy *core.Record, token string) {
	t.Helper()

	col, err := app.FindCollectionByNameOrId("boards_share_links")
	if err != nil {
		t.Fatalf("find boards_share_links: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("project", project.Id)
	rec.Set("token", token)
	rec.Set("role", "viewer")
	rec.Set("created_by", createdBy.Id)
	rec.Set("is_active", true)
	rec.Set("download_count", 0)
	if err := app.Save(rec); err != nil {
		t.Fatalf("seed share link: %v", err)
	}
}

func boardLinkCount(t *testing.T, app *tests.TestApp, token string) int {
	t.Helper()
	rec, err := app.FindFirstRecordByData("boards_share_links", "token", token)
	if err != nil {
		t.Fatalf("reload link: %v", err)
	}
	return rec.GetInt("download_count")
}

// A 64-char token, matching the length resolveLiveLink gates on.
func boardToken(suffix string) string {
	t := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	return t[:64-len(suffix)] + suffix
}

func TestClaimShareLinkDownload_BoardsIncrements(t *testing.T) {
	env := setupCardsEnv(t)
	token := boardToken("aa01")
	seedCounterShareLink(t, env.app, env.project, env.owner, token)

	for i := 1; i <= 3; i++ {
		ok, err := claimShareLinkDownload(env.app, token, sharequota.ShareLimits{})
		if err != nil || !ok {
			t.Fatalf("claim %d: ok=%v err=%v", i, ok, err)
		}
	}

	if got := boardLinkCount(t, env.app, token); got != 3 {
		t.Errorf("download_count = %d, want 3", got)
	}
}

func TestClaimShareLinkDownload_BoardsRefusesAtTheDailyCeiling(t *testing.T) {
	env := setupCardsEnv(t)
	token := boardToken("aa02")
	seedCounterShareLink(t, env.app, env.project, env.owner, token)
	limits := sharequota.ShareLimits{PerDay: 2}

	for i := 1; i <= 2; i++ {
		if ok, err := claimShareLinkDownload(env.app, token, limits); err != nil || !ok {
			t.Fatalf("claim %d: ok=%v err=%v", i, ok, err)
		}
	}
	if ok, _ := claimShareLinkDownload(env.app, token, limits); ok {
		t.Error("the third download was allowed past a daily ceiling of 2")
	}

	// A refusal must not charge, or a refused link keeps climbing.
	if got := boardLinkCount(t, env.app, token); got != 2 {
		t.Errorf("download_count = %d after a refusal, want 2", got)
	}
}

func TestClaimShareLinkDownload_BoardsDailyCounterResets(t *testing.T) {
	env := setupCardsEnv(t)
	token := boardToken("aa03")
	seedCounterShareLink(t, env.app, env.project, env.owner, token)
	limits := sharequota.ShareLimits{PerDay: 1}

	if ok, err := claimShareLinkDownload(env.app, token, limits); err != nil || !ok {
		t.Fatalf("first claim: ok=%v err=%v", ok, err)
	}
	if ok, _ := claimShareLinkDownload(env.app, token, limits); ok {
		t.Fatal("precondition: the link should be at its daily ceiling")
	}

	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	if _, err := env.app.NonconcurrentDB().NewQuery(`
		UPDATE boards_share_links SET download_day = {:day} WHERE token = {:token}
	`).Bind(map[string]any{"day": yesterday, "token": token}).Execute(); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	if ok, err := claimShareLinkDownload(env.app, token, limits); err != nil || !ok {
		t.Errorf("a new day must start the window over: ok=%v err=%v", ok, err)
	}
	if got := boardLinkCount(t, env.app, token); got != 2 {
		t.Errorf("download_count = %d, want 2 — the lifetime count must not reset", got)
	}
}

// Boards and drive must agree on when a day ends, or one ceiling means two
// different things.
func TestShareLinkDownloadCounts_BoardsStaleDayReadsAsZero(t *testing.T) {
	env := setupCardsEnv(t)
	token := boardToken("aa04")
	seedCounterShareLink(t, env.app, env.project, env.owner, token)

	if _, err := claimShareLinkDownload(env.app, token, sharequota.ShareLimits{}); err != nil {
		t.Fatal(err)
	}
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	if _, err := env.app.NonconcurrentDB().NewQuery(`
		UPDATE boards_share_links SET download_day = {:day} WHERE token = {:token}
	`).Bind(map[string]any{"day": yesterday, "token": token}).Execute(); err != nil {
		t.Fatal(err)
	}

	lifetime, day, err := shareLinkDownloadCounts(env.app, token)
	if err != nil {
		t.Fatalf("counts: %v", err)
	}
	if lifetime != 1 || day != 0 {
		t.Errorf("counts = (%d, %d), want (1, 0)", lifetime, day)
	}
}
