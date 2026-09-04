package cli

import (
	"fmt"
	"strconv"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

func newBoardCmd(c *client.Client) *cobra.Command {
	board := &cobra.Command{
		Use:     "board",
		Short:   "Boards: list, inspect, archive, remove",
		Aliases: []string{"boards"},
	}
	board.AddCommand(
		newBoardListCmd(c),
		newBoardViewCmd(c),
		newBoardArchiveCmd(c),
		newBoardRemoveCmd(c),
	)
	return board
}

func newBoardArchiveCmd(c *client.Client) *cobra.Command {
	var unset bool
	cmd := &cobra.Command{
		Use:   "archive <board>",
		Short: "Archive a board (or --unset to restore it)",
		Long:  "Archive a board, keeping its lists and cards.\n\n<board> is a board id, key or name.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			p, err := resolveProject(cmd.Context(), c, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[project](cmd.Context(), c, projectsCollection, p.ID,
				map[string]any{"archived": !unset})
			if err != nil {
				return err
			}
			verb := "archived"
			if unset {
				verb = "restored"
			}
			o.Info(cmd.ErrOrStderr(), "%s %q", verb, updated.Name)
			return o.Write(cmd.OutOrStdout(),
				[]string{"NAME", "KEY", "STATE", "ID"},
				[][]string{{updated.Name, updated.Slug, boardState(updated), updated.ID}}, updated)
		},
	}
	cmd.Flags().BoolVar(&unset, "unset", false, "restore an archived board")
	return cmd
}

// newBoardRemoveCmd deletes a board permanently. Everything beneath it
// cascades — lists, cards, comments, attachments, memberships, share links —
// so the confirm counts what goes, the way `list remove` does, and the
// archive command is the reversible option offered first.
func newBoardRemoveCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "remove <board>",
		Short:   "Delete a board AND EVERYTHING ON IT",
		Aliases: []string{"rm", "delete"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := resolveProject(ctx, c, args[0])
			if err != nil {
				return err
			}
			lists, err := projectLists(ctx, c, p.ID)
			if err != nil {
				return err
			}
			// Archived cards go too, so they are counted.
			byList, err := cardsByList(ctx, c, p.ID, true)
			if err != nil {
				return err
			}
			cardCount := 0
			for _, cards := range byList {
				cardCount += len(cards)
			}
			question := fmt.Sprintf(
				"PERMANENTLY delete %q with its %d list(s) and %d card(s), including every comment and attachment? "+
					"(`cards board archive` hides it reversibly)", p.Name, len(lists), cardCount)
			ok, err := ui.Confirm(o, yes, cmd.InOrStdin(), cmd.ErrOrStderr(), question)
			if err != nil {
				return fmt.Errorf("%s: %w", question, err)
			}
			if !ok {
				return nil
			}
			if err := client.DeleteRecord(ctx, c, projectsCollection, p.ID); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "deleted %q", p.Name)
			return nil
		},
	}
	return cmd
}

func boardState(p project) string {
	if p.Archived {
		return "archived"
	}
	return "active"
}

func newBoardListCmd(c *client.Client) *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:     "list",
		Short:   "List the boards you are a member of",
		Aliases: []string{"ls"},
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			projects, err := visibleProjects(cmd.Context(), c)
			if err != nil {
				return err
			}
			if !all {
				active := projects[:0]
				for _, p := range projects {
					if !p.Archived {
						active = append(active, p)
					}
				}
				projects = active
			}
			rows := make([][]string, len(projects))
			for i, p := range projects {
				rows[i] = []string{p.Name, p.Slug, boardState(p), p.Updated, p.ID}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"NAME", "KEY", "STATE", "UPDATED", "ID"}, rows, projects)
		},
	}
	cmd.Flags().BoolVarP(&all, "all", "a", false, "include archived boards")
	return cmd
}

// newBoardViewCmd renders a whole board — every column with its cards — which
// is the shape a person actually wants when they ask about a board. The cards
// come from ONE query grouped by column (cardsByList), not a read per column:
// `position` only orders within a list, but sorting `list,position,id` groups
// the rows without disturbing that within-column order.
func newBoardViewCmd(c *client.Client) *cobra.Command {
	var all bool
	cmd := &cobra.Command{
		Use:     "view <board>",
		Short:   "Show a board's columns and cards",
		Long:    "Show a board's columns and cards.\n\n<board> is a board id or name.",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"show"},
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := resolveProject(ctx, c, args[0])
			if err != nil {
				return err
			}
			lists, err := projectLists(ctx, c, p.ID)
			if err != nil {
				return err
			}

			type columnView struct {
				list  `json:",inline"`
				Cards []card `json:"cards"`
			}
			byList, err := cardsByList(ctx, c, p.ID, all)
			if err != nil {
				return err
			}
			var (
				view    []columnView
				rows    [][]string
				userIDs []string
			)
			for _, l := range lists {
				cards := byList[l.ID]
				view = append(view, columnView{list: l, Cards: cards})
				for _, cd := range cards {
					userIDs = append(userIDs, cd.Assignees...)
				}
			}
			users, err := usersByID(ctx, c, userIDs)
			if err != nil {
				return err
			}
			// KEY leads the card columns: it is the shortest cell and the one a
			// reader copies out to name a card in a later command. The board is
			// already loaded here, so its slug costs nothing.
			for _, col := range view {
				for _, cd := range col.Cards {
					rows = append(rows, []string{
						col.Name, formatCardKey(p.Slug, cd.Number), cd.Title, priorityCell(cd), dueCell(cd),
						names(cd.Assignees, users), checklistCell(cd), cd.ID,
					})
				}
				if len(col.Cards) == 0 {
					rows = append(rows, []string{col.Name, "", "-", "", "", "", "", ""})
				}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"LIST", "KEY", "CARD", "PRIORITY", "DUE", "ASSIGNEES", "CHECKLIST", "ID"}, rows, view)
		},
	}
	cmd.Flags().BoolVarP(&all, "all", "a", false, "include archived cards")
	return cmd
}

// dueCell renders a card's due date. A day-only deadline shows the date half
// of the stored midnight; a timed one is an instant, shown in THIS machine's
// local zone, which is what a terminal user means by "when".
func dueCell(cd card) string {
	if cd.Due == "" {
		return "-"
	}
	if cd.DueHasTime {
		if at, err := time.Parse(pbDateFormat, cd.Due); err == nil {
			return at.Local().Format("2006-01-02 15:04")
		}
	}
	return dayCell(cd.Due)
}

func checklistCell(cd card) string {
	if cd.ChecklistTotal == 0 {
		return "-"
	}
	return strconv.Itoa(cd.ChecklistDone) + "/" + strconv.Itoa(cd.ChecklistTotal)
}

// requireProjectFlag resolves the --board flag, which every list and card
// command needs. Kept here so the error message is identical everywhere.
func requireProjectFlag(cmd *cobra.Command, c *client.Client, flag string) (project, error) {
	if flag == "" {
		return project{}, fmt.Errorf("--board is required (a board id or name; see `tinycld cards board list`)")
	}
	return resolveProject(cmd.Context(), c, flag)
}
