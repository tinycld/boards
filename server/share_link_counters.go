package boards

import (
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/logging"
	"tinycld.org/core/sharequota"
)

var shareLog = logging.ForPackage("boards")

// claimShareLinkDownload charges one download against a board link's ceilings
// and reports whether it may proceed.
//
// The check and the charge are ONE statement, for the reason drive's
// equivalent states: splitting them lets concurrent requests each read a
// count below the ceiling and each pass. The WHERE clause is the enforcement
// and RowsAffected is the verdict.
//
// The day rollover is folded in — a stale download_day makes the CASE reset
// the counter to 1 while the comparison sees 0 — so a new day costs no extra
// write and nothing has to run at midnight.
//
// Zero means unlimited, matching sharequota.ShareLimits; the `{:x} = 0 OR`
// guards are that convention in SQL.
//
// Returns false only on a definite, successfully-computed over-limit. An
// error is the caller's to fail open on.
func claimShareLinkDownload(app core.App, token string, limits sharequota.ShareLimits) (bool, error) {
	now := time.Now().UTC()

	res, err := app.NonconcurrentDB().NewQuery(`
		UPDATE boards_share_links
		SET download_count     = COALESCE(download_count, 0) + 1,
		    day_download_count = CASE WHEN download_day = {:day}
		                              THEN COALESCE(day_download_count, 0) + 1
		                              ELSE 1 END,
		    download_day       = {:day}
		WHERE token = {:token}
		  AND ({:lifetime} = 0 OR COALESCE(download_count, 0) < {:lifetime})
		  AND ({:perDay} = 0 OR COALESCE(
		        CASE WHEN download_day = {:day} THEN day_download_count ELSE 0 END, 0
		      ) < {:perDay})
	`).Bind(map[string]any{
		"day":      now.Format("2006-01-02"),
		"token":    token,
		"lifetime": limits.Lifetime,
		"perDay":   limits.PerDay,
	}).Execute()
	if err != nil {
		return false, err
	}

	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// shareLinkDownloadCounts reads a link's counters, to say WHICH ceiling a
// refusal hit. Only called after a refusal, never to decide one.
func shareLinkDownloadCounts(app core.App, token string) (lifetime, day int, err error) {
	var row struct {
		DownloadCount    int    `db:"download_count"`
		DayDownloadCount int    `db:"day_download_count"`
		DownloadDay      string `db:"download_day"`
	}
	err = app.DB().NewQuery(`
		SELECT COALESCE(download_count, 0)     AS download_count,
		       COALESCE(day_download_count, 0) AS day_download_count,
		       COALESCE(download_day, '')      AS download_day
		FROM boards_share_links
		WHERE token = {:token}
	`).Bind(map[string]any{"token": token}).One(&row)
	if err != nil {
		return 0, 0, err
	}

	// A stale day means today's tally is zero, whatever the counter holds.
	if row.DownloadDay != time.Now().UTC().Format("2006-01-02") {
		return row.DownloadCount, 0, nil
	}
	return row.DownloadCount, row.DayDownloadCount, nil
}

// secondsUntilUTCMidnight is the Retry-After for a daily refusal. At least 1,
// because a Retry-After of 0 invites an immediate retry that refuses again.
func secondsUntilUTCMidnight(now time.Time) int {
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).Add(24 * time.Hour)
	if s := int(midnight.Sub(now).Seconds()); s > 0 {
		return s
	}
	return 1
}
