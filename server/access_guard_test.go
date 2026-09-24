package boards

import (
	"testing"

	"tinycld.org/core/rlstest"
)

// The boards collections a share-link visitor reads with no login, through
// the `x_share_token` disjunct 1980000003 added to their list and view rules.
var shareLinkReadable = []string{
	"boards_projects", "boards_labels", "boards_lists", "boards_cards",
	"boards_checklist_items", "boards_comments", "boards_attachments",
	"boards_activity", "boards_comment_reactions", "boards_card_reactions",
	"boards_card_links", "boards_epics", "boards_sprints", "boards_sprint_snapshots",
}

func boardsPublicPaths() []rlstest.PublicPath {
	paths := rlstest.CorePublicPaths()
	for _, c := range shareLinkReadable {
		for _, kind := range []string{"list", "view"} {
			paths = append(paths, rlstest.PublicPath{
				Collection: c, Kind: kind,
				Reason: "an anonymous share-link visitor reads the board with an active, unexpired x_share_token",
			})
		}
	}
	return paths
}

// Every access path in every rule of an install with boards — core's rules
// included, since comment_mentions' create rule gains a boards branch — must
// need a login, except the share-link reads named above.
func TestAccessRules_EveryPathRequiresLogin(t *testing.T) {
	app := rlstest.NewAssembledApp(t, rlstest.MigrationsDir(t, "../pb-migrations"))
	rlstest.RequireAuthGuardOnAccessRules(t, app, boardsPublicPaths()...)
}
