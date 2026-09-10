package boards

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Decoding a GitHub webhook payload into something this package can act on.
//
// PURE: no database, no app, no network — which is why it is split from
// github_webhook.go. Payload shapes are the part most likely to be subtly
// wrong, and here they are cheap to table-test exhaustively.
//
// The scan functions are the Go twin of tinycld/boards/lib/pr-key-scan.ts.
// There is no captured-vector fixture holding them in step (unlike rank.go),
// so this file's test table and that file's tests are the only thing that
// does. Change one, change the other.

const (
	minSlugLength = 2
	maxSlugLen    = 10

	// A card number is a small positive integer — PocketBase's own counter
	// column won't produce more than a handful of digits in this app's
	// lifetime. Capping the digit run here means a garbage token like
	// "OTTER-999999999999999999999" next to a key-shaped prefix is rejected
	// outright instead of overflowing strconv.Atoi (Go) / silently rounding
	// through Number.parseInt (TS) — the twins would otherwise disagree on
	// what such an input returns. Mirror this bound in the TS twin.
	maxCardNumberDigits = 9
)

type scannedKey struct {
	Slug   string
	Number int
}

// prEvent is one PR-shaped GitHub event, flattened.
//
// State is provider-NEUTRAL (open/merged/closed), matching the column it
// lands in: GitHub reports a merge as action=closed with merged=true, and
// collapsing that here means nothing downstream has to remember it.
type prEvent struct {
	Action      string
	Repo        string
	Branch      string
	Title       string
	Body        string
	Author      string
	URL         string
	Number      int
	State       string
	ReviewState string
}

// The first slug character is required to be a LETTER ([A-Za-z]), narrower
// than cli/key.go's parseCardKey ([A-Za-z0-9]+). That's deliberate: a
// digit-led token in free text (branch names, PR bodies) is more often a
// version string than a card key, and this scanner would rather miss a key
// than mislink one. Mirrors the same narrowing in the TS twin
// (tinycld/boards/lib/pr-key-scan.ts) — keep both in step if this changes.
var keyInText = regexp.MustCompile(
	fmt.Sprintf(`(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{%d,%d})-([1-9][0-9]{0,%d})([^A-Za-z0-9]|$)`,
		minSlugLength-1, maxSlugLen-1, maxCardNumberDigits-1),
)

var skipInText = regexp.MustCompile(
	fmt.Sprintf(`(?i)\b(?:skip|ignore)\s+([A-Za-z][A-Za-z0-9]{%d,%d})-([1-9][0-9]{0,%d})([^A-Za-z0-9]|$)`,
		minSlugLength-1, maxSlugLen-1, maxCardNumberDigits-1),
)

// scanCardKeys returns every distinct key in text, in first-seen order.
//
// Go's RE2 has no lookahead, so the trailing boundary is a consuming group
// rather than `(?!...)`. That makes adjacent matches ("OTTER-1 OTTER-2") a
// hazard: the separator consumed by the first match is not available to the
// second. FindAllStringSubmatchIndex with a manual walk avoids it by
// restarting the scan at the end of the KEY rather than the end of the match.
func scanCardKeys(text string) []scannedKey {
	return collectKeys(text, keyInText)
}

// scanSkipDirectives returns keys the PR author opted out of.
//
// Required, not convenience: branch-name linkage re-derives from immutable
// branch state on every delivery, so a deleted link row reappears on the next
// push. Only this directive, living in the mutable PR body, survives.
func scanSkipDirectives(text string) []scannedKey {
	return collectKeys(text, skipInText)
}

func collectKeys(text string, pattern *regexp.Regexp) []scannedKey {
	if text == "" {
		return nil
	}
	var found []scannedKey
	seen := map[string]bool{}
	for offset := 0; offset < len(text); {
		loc := pattern.FindStringSubmatchIndex(text[offset:])
		if loc == nil {
			break
		}
		slug := strings.ToUpper(text[offset+loc[2] : offset+loc[3]])
		number, err := strconv.Atoi(text[offset+loc[4] : offset+loc[5]])
		if err == nil && len(slug) <= maxSlugLen {
			dedupe := fmt.Sprintf("%s-%d", slug, number)
			if !seen[dedupe] {
				seen[dedupe] = true
				found = append(found, scannedKey{Slug: slug, Number: number})
			}
		}
		// Restart after the NUMBER, not after the whole match, so a consumed
		// trailing separator cannot hide an immediately following key.
		offset += loc[5]
	}
	return found
}

// githubPRPayload is the subset of GitHub's payload this package reads.
type githubPRPayload struct {
	Action string `json:"action"`
	Review struct {
		State string `json:"state"`
	} `json:"review"`
	PullRequest struct {
		Number  int    `json:"number"`
		Title   string `json:"title"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		State   string `json:"state"`
		Merged  bool   `json:"merged"`
		Draft   bool   `json:"draft"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
		User struct {
			Login string `json:"login"`
		} `json:"user"`
	} `json:"pull_request"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
}

// prActions are the pull_request actions worth acting on. `labeled`,
// `assigned` and friends change nothing this package tracks, and processing
// them would rewrite rows (and re-fire triggers) for no reason.
var prActions = map[string]bool{
	"opened":             true,
	"reopened":           true,
	"closed":             true,
	"edited":             true,
	"synchronize":        true,
	"ready_for_review":   true,
	"converted_to_draft": true,
	"review_requested":   true,
}

// decodePREvent flattens a payload. ok=false means "a legitimate event we do
// not act on" — distinct from an error, so the receiver can 200 it rather
// than inviting a retry.
func decodePREvent(event string, body []byte) (prEvent, bool, error) {
	if event != "pull_request" && event != "pull_request_review" {
		return prEvent{}, false, nil
	}

	var payload githubPRPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return prEvent{}, false, fmt.Errorf("decoding the payload: %w", err)
	}
	if payload.Repository.FullName == "" || payload.PullRequest.Number == 0 {
		return prEvent{}, false, nil
	}
	if event == "pull_request" && !prActions[payload.Action] {
		return prEvent{}, false, nil
	}
	if event == "pull_request_review" && payload.Action != "submitted" {
		return prEvent{}, false, nil
	}

	ev := prEvent{
		Action: payload.Action,
		Repo:   payload.Repository.FullName,
		Branch: payload.PullRequest.Head.Ref,
		Title:  payload.PullRequest.Title,
		Body:   payload.PullRequest.Body,
		Author: payload.PullRequest.User.Login,
		URL:    payload.PullRequest.HTMLURL,
		Number: payload.PullRequest.Number,
	}

	// GitHub reports a merge as closed+merged. Collapse it here so nothing
	// downstream has to remember the distinction.
	switch {
	case payload.PullRequest.Merged:
		ev.State = "merged"
	case payload.PullRequest.State == "closed":
		ev.State = "closed"
	default:
		ev.State = "open"
	}

	if event == "pull_request_review" {
		switch strings.ToLower(payload.Review.State) {
		case "approved":
			ev.ReviewState = "approved"
		case "changes_requested", "commented":
			ev.ReviewState = "in_review"
		}
	}
	if payload.Action == "review_requested" {
		ev.ReviewState = "in_review"
	}

	return ev, true, nil
}
