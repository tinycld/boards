package cli

import (
	"fmt"
	"strconv"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

func newBoardCmd(c *client.Client) *cobra.Command {
	board := &cobra.Command{
		Use:     "board",
		Short:   "Boards: list and inspect",
		Aliases: []string{"boards"},
	}
	board.AddCommand(
		newBoardListCmd(c),
		newBoardViewCmd(c),
	)
	return board
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
				state := "active"
				if p.Archived {
					state = "archived"
				}
				rows[i] = []string{p.Name, p.Slug, state, p.Updated, p.ID}
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
						col.Name, formatCardKey(p.Slug, cd.Number), cd.Title, dueCell(cd),
						names(cd.Assignees, users), checklistCell(cd), cd.ID,
					})
				}
				if len(col.Cards) == 0 {
					rows = append(rows, []string{col.Name, "", "-", "", "", "", ""})
				}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"LIST", "KEY", "CARD", "DUE", "ASSIGNEES", "CHECKLIST", "ID"}, rows, view)
		},
	}
	cmd.Flags().BoolVarP(&all, "all", "a", false, "include archived cards")
	return cmd
}

// dueCell renders a card's due date. PocketBase stores a date as a full
// timestamp string, but cards are day-granular (lib/dates is day-granular for
// exactly this reason), so only the date half is shown.
func dueCell(cd card) string {
	if cd.Due == "" {
		return "-"
	}
	if len(cd.Due) >= 10 {
		return cd.Due[:10]
	}
	return cd.Due
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
