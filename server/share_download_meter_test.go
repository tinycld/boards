package boards

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// timeAt is a fixed UTC date at the given clock time, so the midnight
// arithmetic is tested against something that does not move.
func timeAt(h, m, s int) time.Time {
	return time.Date(2026, 3, 1, h, m, s, 0, time.UTC)
}

func request(t *testing.T, method, url string, headers map[string]string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, url, nil)
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

// A plain GET with no Range is one transfer and must be charged.
func TestIsChargeableRange_NoRangeHeader(t *testing.T) {
	if !isChargeableRange(request(t, http.MethodGet, "/f", nil)) {
		t.Error("a request with no Range must be charged")
	}
}

// A request opening a file from the start is a transfer beginning, so it is
// charged — this is what a downloader or a player sends first.
func TestIsChargeableRange_FromByteZero(t *testing.T) {
	for _, v := range []string{"bytes=0-", "bytes=0-1023"} {
		if !isChargeableRange(request(t, http.MethodGet, "/f", map[string]string{"Range": v})) {
			t.Errorf("Range %q starts a transfer and must be charged", v)
		}
	}
}

// The case the whole helper exists for: PocketBase serves files through
// http.ServeContent, so scrubbing a video issues many mid-file requests. Each
// is a continuation of one download, not a new one.
func TestIsChargeableRange_MidFileContinuationIsNotCharged(t *testing.T) {
	for _, v := range []string{"bytes=1024-2047", "bytes=500000-", "bytes=-500"} {
		if isChargeableRange(request(t, http.MethodGet, "/f", map[string]string{"Range": v})) {
			t.Errorf("Range %q is a continuation and must not be charged", v)
		}
	}
}

func TestSecondsUntilUTCMidnight_Boards(t *testing.T) {
	// Values mirror drive's, because the two packages must agree on when a
	// day ends or the same ceiling means two different things.
	cases := []struct {
		name    string
		h, m, s int
		want    int
	}{
		{"just after midnight", 0, 0, 30, 86370},
		{"just before midnight", 23, 59, 50, 10},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			now := timeAt(c.h, c.m, c.s)
			if got := secondsUntilUTCMidnight(now); got != c.want {
				t.Errorf("= %d, want %d", got, c.want)
			}
		})
	}

	if got := secondsUntilUTCMidnight(timeAt(0, 0, 0)); got <= 0 {
		t.Errorf("at midnight = %d, want a positive delay — zero invites an immediate retry", got)
	}
}
