package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"tinycld.org/core/authfactor"
)

// An emailed share-link code proves only that the visitor reads the mailbox.
// For an account with a second factor that must not become a session: the
// mailbox alone would skip the second step.
func TestShareOTP_RefusesAnAccountWithASecondFactor(t *testing.T) {
	env := setupOTPEnv(t)
	tok := shareLink(t, env.cardsEnv, env.project.Id, tok64("otpmfa"), "editor", true, "")
	enableTOTPForTest(t, env.app, env.outsider.Id)
	otpID := requestCode(t, env, tok, env.outsider.Email())

	mintReq{
		method:     http.MethodPost,
		url:        "/api/boards/share-link/" + tok + "/otp-verify",
		body:       verifyBody(env.outsider.Email(), env.code(), otpID),
		want:       http.StatusForbidden,
		content:    []string{"two-step verification"},
		notContent: []string{`"token"`},
	}.run(t, env.cardsEnv)
}

// enableTOTPForTest gives userID a confirmed authenticator app. The boards
// test app does not run core's migrations, so the collection is created here
// with the fields authfactor reads.
func enableTOTPForTest(t *testing.T, app core.App, userID string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(authfactor.TOTPCollection)
	if err != nil {
		col = core.NewBaseCollection(authfactor.TOTPCollection)
		col.Fields.Add(&core.TextField{Name: "user"})
		col.Fields.Add(&core.DateField{Name: "enabled_at"})
		if err := app.Save(col); err != nil {
			t.Fatalf("create %s: %v", authfactor.TOTPCollection, err)
		}
	}
	row := core.NewRecord(col)
	row.Set("user", userID)
	row.Set("enabled_at", types.NowDateTime())
	if err := app.Save(row); err != nil {
		t.Fatalf("save totp row: %v", err)
	}
}
