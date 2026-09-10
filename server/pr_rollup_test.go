package boards

import "testing"

// TestRecountCardPRs_TombstoneIsExcludedFromTheRollup is the regression a
// reviewer's throwaway probe stood in for during task 4: recountCardPRs must
// read `unlinked != true`, not just `card = {:card}`.
//
// The tombstoned link is deliberately "open" and the live one "merged" — the
// reverse of the ordinary case — because derivePRStateFromStates' own
// precedence makes "any open link means open" (see pr_rollup_test.go's table
// above). If the tombstoned row leaked into the derivation, the card would
// read "open" even though its one live link is merged; only the `unlinked`
// filter keeps the rollup honest here. Calling recountCardPRs directly,
// rather than through applyPREvent, isolates the filter itself from the
// branch-name matching github_links_test.go already covers.
func TestRecountCardPRs_TombstoneIsExcludedFromTheRollup(t *testing.T) {
	env := setupCardsEnv(t)
	projectID, cardID := seedBoardWithCard(t, env, "ROLLUP", 1)

	live := seedPRLink(t, env, cardID, projectID, "o/r", 101)
	live.Set("state", "merged")
	if err := env.app.Save(live); err != nil {
		t.Fatalf("save live link: %v", err)
	}

	tombstoned := seedPRLink(t, env, cardID, projectID, "o/r", 102)
	tombstoned.Set("state", "open")
	tombstoned.Set("unlinked", true)
	if err := env.app.Save(tombstoned); err != nil {
		t.Fatalf("save tombstoned link: %v", err)
	}

	recountCardPRs(env.app, cardID)

	card, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	if got := card.GetString("pr_state"); got != "merged" {
		t.Errorf("pr_state = %q, want %q — the tombstoned open link was counted", got, "merged")
	}
}

func TestDerivePRState_AllMergedIsTheEvent(t *testing.T) {
	for _, tc := range []struct {
		name      string
		states    []string
		wantState string
	}{
		{"no links", nil, ""},
		{"one open", []string{"open"}, "open"},
		{"one merged", []string{"merged"}, "merged"},
		{"one of two merged stays open", []string{"merged", "open"}, "open"},
		{"both merged", []string{"merged", "merged"}, "merged"},
		{"three, one open", []string{"merged", "merged", "open"}, "open"},
		{"all closed unmerged", []string{"closed"}, "closed"},
		{"merged beats closed when both present", []string{"merged", "closed"}, "merged"},
		{"an open link outranks everything", []string{"closed", "merged", "open"}, "open"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := derivePRStateFromStates(tc.states, nil)
			if got != tc.wantState {
				t.Errorf("state = %q, want %q", got, tc.wantState)
			}
		})
	}
}

func TestDerivePRState_ReviewStateTakesTheStrongest(t *testing.T) {
	for _, tc := range []struct {
		name    string
		reviews []string
		want    string
	}{
		{"none", nil, ""},
		{"in review", []string{"in_review"}, "in_review"},
		{"approved", []string{"approved"}, "approved"},
		{"approved outranks in_review", []string{"in_review", "approved"}, "approved"},
		{"blank entries ignored", []string{"", "in_review"}, "in_review"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, got := derivePRStateFromStates(nil, tc.reviews)
			if got != tc.want {
				t.Errorf("reviewState = %q, want %q", got, tc.want)
			}
		})
	}
}
