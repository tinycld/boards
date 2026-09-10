package boards

import "testing"

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
