package boards

import "testing"

func TestScanCardKeys_MirrorsTheTSTable(t *testing.T) {
	// This table MUST stay in step with
	// tests/pr-key-scan.test.ts — there is no captured
	// fixture holding the two implementations together.
	for _, tc := range []struct {
		name string
		text string
		want []scannedKey
	}{
		{"branch name", "nas/OTTER-123-fix-login", []scannedKey{{"OTTER", 123}}},
		{"bare key", "OTTER-7", []scannedKey{{"OTTER", 7}}},
		{"lower case", "fix/otter-12", []scannedKey{{"OTTER", 12}}},
		{
			"several, de-duplicated",
			"Closes OTTER-1, OTTER-2 and OTTER-1 again",
			[]scannedKey{{"OTTER", 1}, {"OTTER", 2}},
		},
		{"leading zeros rejected", "OTTER-007", nil},
		{"slug too long", "PLATFORMENGINEERING-1", nil},
		{"slug too short", "A-1", nil},
		{"embedded in a word", "NOTOTTER-1x", nil},
		{"no key", "just a normal branch name", nil},
		{"empty", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := scanCardKeys(tc.text)
			if len(got) != len(tc.want) {
				t.Fatalf("scanCardKeys(%q) = %v, want %v", tc.text, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("key %d = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestScanSkipDirectives(t *testing.T) {
	for _, tc := range []struct {
		name string
		text string
		want []scannedKey
	}{
		{"skip", "skip OTTER-123", []scannedKey{{"OTTER", 123}}},
		{"ignore", "ignore OTTER-5", []scannedKey{{"OTTER", 5}}},
		{"case-insensitive", "Skip OTTER-5", []scannedKey{{"OTTER", 5}}},
		{"a bare key is not a skip", "OTTER-5", nil},
		{"a closing word is not a skip", "closes OTTER-5", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := scanSkipDirectives(tc.text)
			if len(got) != len(tc.want) {
				t.Fatalf("scanSkipDirectives(%q) = %v, want %v", tc.text, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("key %d = %v, want %v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestDecodePREvent_OpenedPR(t *testing.T) {
	body := []byte(`{
		"action": "opened",
		"pull_request": {
			"number": 42,
			"title": "OTTER-1 fix the redirect",
			"body": "does the thing",
			"html_url": "https://github.com/o/r/pull/42",
			"state": "open",
			"merged": false,
			"draft": false,
			"head": { "ref": "nas/OTTER-1-fix" },
			"user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request", body)
	if err != nil {
		t.Fatalf("decodePREvent: %v", err)
	}
	if !ok {
		t.Fatal("an opened PR was ignored")
	}
	if ev.Number != 42 || ev.Repo != "o/r" || ev.Branch != "nas/OTTER-1-fix" {
		t.Errorf("event = %+v", ev)
	}
	if ev.State != "open" {
		t.Errorf("State = %q, want open", ev.State)
	}
}

func TestDecodePREvent_MergedPR(t *testing.T) {
	body := []byte(`{
		"action": "closed",
		"pull_request": {
			"number": 7, "title": "t", "body": "", "html_url": "u",
			"state": "closed", "merged": true, "draft": false,
			"head": { "ref": "OTTER-2" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request", body)
	if err != nil || !ok {
		t.Fatalf("decodePREvent: ok=%v err=%v", ok, err)
	}
	// A closed PR that merged is `merged`, not `closed` — the distinction the
	// whole feature turns on.
	if ev.State != "merged" {
		t.Errorf("State = %q, want merged", ev.State)
	}
}

func TestDecodePREvent_ClosedUnmerged(t *testing.T) {
	body := []byte(`{
		"action": "closed",
		"pull_request": {
			"number": 8, "title": "t", "body": "", "html_url": "u",
			"state": "closed", "merged": false, "draft": false,
			"head": { "ref": "OTTER-3" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, _, err := decodePREvent("pull_request", body)
	if err != nil {
		t.Fatalf("decodePREvent: %v", err)
	}
	if ev.State != "closed" {
		t.Errorf("State = %q, want closed", ev.State)
	}
}

func TestDecodePREvent_ReviewApproved(t *testing.T) {
	body := []byte(`{
		"action": "submitted",
		"review": { "state": "approved" },
		"pull_request": {
			"number": 9, "title": "t", "body": "", "html_url": "u",
			"state": "open", "merged": false, "draft": false,
			"head": { "ref": "OTTER-4" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	ev, ok, err := decodePREvent("pull_request_review", body)
	if err != nil || !ok {
		t.Fatalf("decodePREvent: ok=%v err=%v", ok, err)
	}
	if ev.ReviewState != "approved" {
		t.Errorf("ReviewState = %q, want approved", ev.ReviewState)
	}
}

func TestDecodePREvent_IgnoresUninterestingEvents(t *testing.T) {
	for _, tc := range []struct{ event, body string }{
		{"push", `{}`},
		{"issues", `{"action":"opened"}`},
		{"pull_request", `{"action":"labeled","pull_request":{"number":1},"repository":{"full_name":"o/r"}}`},
	} {
		_, ok, err := decodePREvent(tc.event, []byte(tc.body))
		if err != nil {
			t.Errorf("decodePREvent(%s) errored: %v", tc.event, err)
		}
		if ok {
			t.Errorf("decodePREvent(%s) = ok, want ignored", tc.event)
		}
	}
}

func TestDecodePREvent_RejectsMalformedJSON(t *testing.T) {
	if _, _, err := decodePREvent("pull_request", []byte(`{not json`)); err == nil {
		t.Error("expected an error for malformed JSON")
	}
}
