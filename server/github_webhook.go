package boards

import (
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/webhookin"
)

// The GitHub webhook source.
//
// Core provides the TRANSPORT — signature verification, replay dedupe, rate
// limiting — and knows nothing about GitHub or boards. This file supplies the
// MEANING, which is the half that cannot be generic: "this branch names
// OTTER-123, and all its sibling PRs have now merged" is irreducibly specific
// to one provider and one schema.
//
// Registered from registerShared, the oauth.RegisterPackage inversion: core
// learns the source exists at runtime rather than naming this package.

const githubWebhookSecretKey = "boards.github.webhook_secret"

// registerGitHubWebhook installs the source at POST /api/webhooks/github.
func registerGitHubWebhook() {
	webhookin.Register("github", webhookin.Source{
		Secret:          githubWebhookSecret,
		SignatureHeader: "X-Hub-Signature-256",
		EventHeader:     "X-GitHub-Event",
		DeliveryID: func(r *http.Request) string {
			return r.Header.Get("X-GitHub-Delivery")
		},
		Handle: handleGitHubDelivery,
	})
}

// githubWebhookSecret reads the deployment's configured signing secret.
//
// Read per request rather than cached at boot because it is rotatable from the
// admin console, and a cached value would keep verifying against the old one.
// A missing secret returns an error, which the receiver treats as "fail
// closed" — unconfigured is never permission.
func githubWebhookSecret(app core.App, _ *http.Request) (string, error) {
	settings, err := app.FindRecordsByFilter(
		"system_settings", "key = {:key}", "", 1, 0,
		map[string]any{"key": githubWebhookSecretKey},
	)
	if err != nil {
		return "", fmt.Errorf("reading the github webhook secret: %w", err)
	}
	if len(settings) == 0 {
		return "", fmt.Errorf("no github webhook secret is configured")
	}
	return settings[0].GetString("value"), nil
}

// handleGitHubDelivery interprets one verified delivery.
//
// An event we do not act on returns nil, NOT an error: the receiver turns an
// error into a 500, and GitHub would then retry an event we will go on
// ignoring forever. Only a genuinely malformed payload errors.
func handleGitHubDelivery(app core.App, d webhookin.Delivery) error {
	ev, ok, err := decodePREvent(d.Event, d.Body)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	return applyPREvent(app, ev)
}
