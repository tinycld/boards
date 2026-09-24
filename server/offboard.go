package boards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/offboard"
)

// Offboarding anonymizes a users row and never deletes it, so a leaver's
// boards_project_members rows survive. A board whose only owner leaves is then
// owned by an account nobody can sign in to, and nobody can manage its members
// again (bootstrapFirstOwner only fires on a memberless board). core's flat FK
// rewrite (RegisterReassignable) cannot fix that: it would hand the successor
// every membership the leaver held, viewer rows on other people's boards
// included, and it fails on the unique (project, user) index when the
// successor is already a member. So boards settles ownership itself, board by
// board, inside the offboard transaction.
//
// boards_projects.created_by is settled here too, not through
// RegisterReassignable. In delete_my_data mode core deletes every row whose
// registered FK points at the leaver, which deleted every board the leaver had
// created, with all its cards, even when other people used it.

// reassignableRefs are the authorship FKs core rewrites (reassign) or deletes
// by (delete_my_data). A departing user's authored comments and uploaded
// attachments reassign rather than cascade, so the board keeps its history.
// Every one of these relations is cascadeDelete:false in the migration, which
// is the shape offboard exists to handle.
var reassignableRefs = []offboard.ReassignableRef{
	{Collection: "boards_cards", Field: "created_by"},
	{Collection: "boards_cards", Field: "reporter"},
	{Collection: "boards_comments", Field: "author"},
	{Collection: "boards_attachments", Field: "uploaded_by"},
	{Collection: "boards_sprints", Field: "created_by"},
}

func registerOffboard() {
	for _, ref := range reassignableRefs {
		offboard.RegisterReassignable(ref)
	}
	offboard.RegisterHandler("boards", handOverSoleOwnedProjects)
}

// soleOwnedProject is a board where the user is the only owner. OtherMembers
// counts the members that are not the user: when it is zero, nobody else can
// see the board.
type soleOwnedProject struct {
	ID           string `db:"id"`
	Name         string `db:"name"`
	OtherMembers int    `db:"other_members"`
}

func findSoleOwnedProjects(app core.App, userID string) ([]soleOwnedProject, error) {
	var out []soleOwnedProject
	err := app.DB().NewQuery(`
		SELECT p.id AS id, p.name AS name,
			(SELECT COUNT(*) FROM boards_project_members o
				WHERE o.project = m.project AND o.user != {:user}) AS other_members
		FROM boards_project_members m
		JOIN boards_projects p ON p.id = m.project
		WHERE m.user = {:user} AND m.role = 'owner'
			AND NOT EXISTS (SELECT 1 FROM boards_project_members o
				WHERE o.project = m.project AND o.role = 'owner' AND o.user != {:user})
		ORDER BY p.name, p.id`,
	).Bind(dbx.Params{"user": userID}).All(&out)
	if err != nil {
		return nil, fmt.Errorf("find sole-owned boards: %w", err)
	}
	return out, nil
}

// boardsHeir picks who takes over the leaver's sole-owned boards: the
// successor in reassign mode, the acting admin in delete-my-data mode. It
// returns "" when there is nobody: a self-delete (the actor is the leaver) or
// a system offboard with no actor.
func boardsHeir(leaverID string, plan offboard.Plan, actorUserID string) string {
	if plan.Mode == offboard.ModeReassign {
		return plan.SuccessorUserID
	}
	if actorUserID == "" || actorUserID == leaverID {
		return ""
	}
	return actorUserID
}

// handOverSoleOwnedProjects is boards' offboard.Handler. It adds or upgrades
// the heir's membership on every board the leaver alone owns, and moves the
// leaver's created_by to the heir. It never deletes a board that someone else
// is a member of, and it leaves every board that has another owner alone. In
// delete-my-data mode it first deletes the boards the leaver created that
// nobody else uses (see deleteUnsharedCreatedProjects).
//
// With no heir (a self-delete in delete-my-data mode) it follows core's
// last-owner guard: refuse, and tell the user what to do first. A board
// nobody else uses costs nobody access, so it does not block the delete.
func handOverSoleOwnedProjects(txApp core.App, leaver *core.Record, plan offboard.Plan, actorUserID string) error {
	if plan.Mode == offboard.ModeDeleteMyData {
		if err := deleteUnsharedCreatedProjects(txApp, leaver.Id); err != nil {
			return err
		}
	}

	owned, err := findSoleOwnedProjects(txApp, leaver.Id)
	if err != nil {
		return err
	}

	heirID := boardsHeir(leaver.Id, plan, actorUserID)
	if heirID == "" {
		for _, p := range owned {
			if p.OtherMembers > 0 {
				return fmt.Errorf("%w: you are the only owner of the board %q, which other people use. "+
					"Make one of them an owner, or choose a successor for your content, before you delete your account",
					offboard.ErrInvalidPlan, p.Name)
			}
		}
		return nil
	}

	heir, err := txApp.FindRecordById("users", heirID)
	if err != nil {
		return fmt.Errorf("load boards heir %s: %w", heirID, err)
	}
	// Guests may not create boards (the boards_projects create rule refuses
	// them), so ownership must not reach them through the back door either.
	if len(owned) > 0 && heir.GetString("role") == "guest" {
		return fmt.Errorf("%w: a guest cannot take over boards; choose a member as the successor",
			offboard.ErrInvalidPlan)
	}

	for _, p := range owned {
		if err := makeProjectOwner(txApp, p.ID, heirID); err != nil {
			return err
		}
	}
	return moveProjectCreator(txApp, leaver.Id, heirID)
}

// deleteUnsharedCreatedProjects keeps what delete_my_data did before boards
// had a handler: a board the leaver created is deleted with its content. It
// now spares every board that has a member other than the leaver, because
// that board is no longer only the leaver's data.
func deleteUnsharedCreatedProjects(txApp core.App, leaverID string) error {
	projects, err := txApp.FindRecordsByFilter("boards_projects",
		"created_by = {:user}", "", 0, 0, dbx.Params{"user": leaverID})
	if err != nil {
		return fmt.Errorf("load boards created by %s: %w", leaverID, err)
	}
	for _, p := range projects {
		others, err := txApp.CountRecords("boards_project_members",
			dbx.HashExp{"project": p.Id},
			dbx.Not(dbx.HashExp{"user": leaverID}),
		)
		if err != nil {
			return fmt.Errorf("count members of board %s: %w", p.Id, err)
		}
		if others > 0 {
			continue
		}
		if err := txApp.Delete(p); err != nil {
			return fmt.Errorf("delete board %s: %w", p.Id, err)
		}
	}
	return nil
}

// moveProjectCreator rewrites boards_projects.created_by from the leaver to
// the heir. It is one hook-free UPDATE, the same as core's reassign of a
// registered ref: created_by is not indexed content and drives no counter.
func moveProjectCreator(txApp core.App, leaverID, heirID string) error {
	_, err := txApp.DB().NewQuery(
		"UPDATE boards_projects SET created_by = {:heir} WHERE created_by = {:leaver}",
	).Bind(dbx.Params{"heir": heirID, "leaver": leaverID}).Execute()
	if err != nil {
		return fmt.Errorf("move boards_projects.created_by: %w", err)
	}
	return nil
}

// makeProjectOwner gives the user an owner membership on the board, upgrading
// the existing row when there is one: the unique (project, user) index allows
// only one.
func makeProjectOwner(txApp core.App, projectID, userID string) error {
	existing, err := txApp.FindFirstRecordByFilter("boards_project_members",
		"project = {:project} && user = {:user}",
		dbx.Params{"project": projectID, "user": userID})
	if err == nil {
		if existing.GetString("role") == "owner" {
			return nil
		}
		existing.Set("role", "owner")
		if err := txApp.Save(existing); err != nil {
			return fmt.Errorf("upgrade membership on board %s: %w", projectID, err)
		}
		return nil
	}

	col, err := txApp.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		return fmt.Errorf("boards_project_members collection: %w", err)
	}
	member := core.NewRecord(col)
	member.Set("project", projectID)
	member.Set("user", userID)
	member.Set("role", "owner")
	if err := txApp.Save(member); err != nil {
		return fmt.Errorf("add owner to board %s: %w", projectID, err)
	}
	return nil
}

// registerSoleOwnerDeleteGuard refuses a direct users delete (the REST DELETE
// that PocketBase's default rule allows on your own account) while the user is
// the only owner of a board other people use. The boards_project_members.user
// cascade would remove the owner row, and leave its members with a board
// nobody can manage. The offboard path is not affected: it anonymizes the
// users row and never deletes it, and its handler above hands the board over.
//
// Superusers step aside, as in core's last-owner guard: they can add an owner
// back from the superuser console.
func registerSoleOwnerDeleteGuard(app core.App) {
	app.OnRecordDeleteRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.Auth != nil && e.Auth.IsSuperuser() {
			return e.Next()
		}
		owned, err := findSoleOwnedProjects(e.App, e.Record.Id)
		if err != nil {
			return e.InternalServerError("board ownership check failed", err)
		}
		for _, p := range owned {
			if p.OtherMembers > 0 {
				return e.ForbiddenError(fmt.Sprintf(
					"You are the only owner of the board %q, which other people use. "+
						"Make someone else an owner, delete the board, or delete your account "+
						"through account settings (/api/account/delete) and choose a successor.", p.Name), nil)
			}
		}
		return e.Next()
	})
}
