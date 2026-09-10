package boards

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pocketbase/pocketbase/core"
)

// Minting GitHub App installation tokens.
//
// This is a server-to-server credential, not the user OAuth flow: sign a
// short-lived JWT with the App's own private key, exchange it for an
// installation token, and re-mint the next one from scratch when it is about
// to expire. There is no refresh token and nothing to keep silently fresh —
// see the plan-2 spike notes for why that rules out the failure mode that
// sank the Jira Data Center integration (an 8-hour `ghu_` user-token expiry,
// a different credential entirely).
//
// App ID and private key are deployment-wide (system_settings), both
// `is_secret` — mirrors githubWebhookSecret in github_webhook.go.

const (
	githubAppIDKey      = "boards.github.app_id"
	githubPrivateKeyKey = "boards.github.private_key"

	// GitHub caps a JWT's lifetime at 10 minutes; this is comfortably inside
	// it and the token is used once, immediately, to mint the installation
	// token below.
	githubJWTTTL = 10 * time.Minute

	// Installation tokens are valid ~1 hour. Re-mint 5 minutes early so a
	// request that starts just before expiry never races the clock.
	githubTokenRefreshSkew = 5 * time.Minute

	githubAPIBaseURL = "https://api.github.com"

	githubHTTPTimeout = 15 * time.Second
)

// installationToken is one minted token, cached until it is close to expiry.
type installationToken struct {
	token     string
	expiresAt time.Time
}

// tokenCache holds one cached token per installation, in memory only — never
// persisted, and never logged (see githubInstallationToken).
type tokenCache struct {
	mu     sync.Mutex
	tokens map[string]installationToken
}

var githubTokenCache = &tokenCache{tokens: map[string]installationToken{}}

func (c *tokenCache) get(installationID string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cached, ok := c.tokens[installationID]
	if !ok || time.Now().After(cached.expiresAt.Add(-githubTokenRefreshSkew)) {
		return "", false
	}
	return cached.token, true
}

func (c *tokenCache) set(installationID, token string, expiresAt time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tokens[installationID] = installationToken{token: token, expiresAt: expiresAt}
}

// githubInstallationToken returns a valid installation access token for
// installationID, minting a new one when the cache holds none or the cached
// one is within githubTokenRefreshSkew of expiring.
//
// Never logs the private key or the minted token — both are bearer
// credentials for the life of their validity window.
func githubInstallationToken(app core.App, installationID string) (string, error) {
	if cached, ok := githubTokenCache.get(installationID); ok {
		return cached, nil
	}

	appID, err := systemSecret(app, githubAppIDKey)
	if err != nil {
		return "", fmt.Errorf("github app id: %w", err)
	}
	privateKeyPEM, err := systemSecret(app, githubPrivateKeyKey)
	if err != nil {
		return "", fmt.Errorf("github app private key: %w", err)
	}

	signedJWT, err := signGitHubAppJWT(appID, privateKeyPEM)
	if err != nil {
		return "", fmt.Errorf("signing github app jwt: %w", err)
	}

	token, expiresAt, err := exchangeInstallationToken(context.Background(), installationID, signedJWT)
	if err != nil {
		return "", fmt.Errorf("minting installation token: %w", err)
	}

	githubTokenCache.set(installationID, token, expiresAt)
	return token, nil
}

// signGitHubAppJWT builds the App-identity JWT GitHub requires to mint an
// installation token: RS256, `iss` the App ID, a short expiry.
func signGitHubAppJWT(appID, privateKeyPEM string) (string, error) {
	privateKey, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(privateKeyPEM))
	if err != nil {
		return "", fmt.Errorf("parsing private key: %w", err)
	}

	now := time.Now()
	claims := jwt.RegisteredClaims{
		// Backdated 60s: GitHub rejects a JWT whose `iat` is in the future,
		// which a few seconds of clock skew between this host and GitHub's
		// can otherwise trigger.
		IssuedAt:  jwt.NewNumericDate(now.Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(now.Add(githubJWTTTL)),
		Issuer:    appID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	return token.SignedString(privateKey)
}

type installationTokenResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// exchangeInstallationToken calls the token endpoint directly rather than
// through safehttp: the host is a fixed literal (api.github.com), never
// caller-supplied, so the SSRF guard has nothing to validate — only the
// timeout matters here, and http.Client provides that directly.
func exchangeInstallationToken(
	ctx context.Context,
	installationID string,
	appJWT string,
) (string, time.Time, error) {
	url := fmt.Sprintf("%s/app/installations/%s/access_tokens", githubAPIBaseURL, installationID)

	ctx, cancel := context.WithTimeout(ctx, githubHTTPTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+appJWT)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	client := &http.Client{Timeout: githubHTTPTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusCreated {
		// The body is GitHub's own error JSON, not a credential — safe to
		// surface, unlike the token itself.
		return "", time.Time{}, fmt.Errorf("github returned %d: %s", resp.StatusCode, bytes.TrimSpace(body))
	}

	var parsed installationTokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", time.Time{}, fmt.Errorf("decoding response: %w", err)
	}
	if parsed.Token == "" {
		return "", time.Time{}, fmt.Errorf("github response had no token")
	}
	return parsed.Token, parsed.ExpiresAt, nil
}

// systemSecret reads a required value from system_settings, erroring rather
// than silently returning "" — an unconfigured App must fail closed, not mint
// requests against an empty key.
func systemSecret(app core.App, key string) (string, error) {
	rec, err := app.FindFirstRecordByFilter(
		"system_settings", "key = {:key}", map[string]any{"key": key},
	)
	if err != nil {
		return "", fmt.Errorf("no value configured for %s", key)
	}
	value := rec.GetString("value")
	if value == "" {
		return "", fmt.Errorf("no value configured for %s", key)
	}
	return value, nil
}
