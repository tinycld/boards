package boards

import (
	"testing"

	"tinycld.org/core/webhookin"
)

func TestGitHubWebhookSource_IgnoresUninterestingEvents(t *testing.T) {
	env := setupCardsEnv(t)

	// A push delivery decodes to "nothing to do" and must succeed rather than
	// error: erroring would make the receiver 500, and GitHub would retry an
	// event we will keep ignoring.
	err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github",
		Event:  "push",
		Body:   []byte(`{"ref":"refs/heads/main"}`),
	})
	if err != nil {
		t.Errorf("an ignored event returned an error: %v", err)
	}
}

func TestGitHubWebhookSource_RejectsMalformedPayload(t *testing.T) {
	env := setupCardsEnv(t)

	err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github",
		Event:  "pull_request",
		Body:   []byte(`{not json`),
	})
	if err == nil {
		t.Error("malformed JSON was accepted")
	}
}

func TestGitHubWebhookSource_AppliesAPullRequestEvent(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 10)
	attachRepo(t, env, board, "o/r")

	body := []byte(`{
		"action": "opened",
		"pull_request": {
			"number": 60, "title": "t", "body": "", "html_url": "https://github.com/o/r/pull/60",
			"state": "open", "merged": false, "draft": false,
			"head": { "ref": "OTTER-10-fix" }, "user": { "login": "nas" }
		},
		"repository": { "full_name": "o/r" }
	}`)

	if err := handleGitHubDelivery(env.app, webhookin.Delivery{
		Source: "github", Event: "pull_request", Body: body,
	}); err != nil {
		t.Fatalf("handleGitHubDelivery: %v", err)
	}

	if links := findLinks(t, env, card); len(links) != 1 {
		t.Fatalf("got %d links, want 1", len(links))
	}
}
