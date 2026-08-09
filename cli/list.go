package cli

import (
	"fmt"
	"strconv"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

func newListCmd(c *client.Client) *cobra.Command {
	l := &cobra.Command{
		Use:     "list",
		Short:   "Lists (columns): show, add, rename, move, remove",
		Aliases: []string{"lists", "column"},
	}
	l.AddCommand(
		newListShowCmd(c),
		newListAddCmd(c),
		newListRenameCmd(c),
		newListMoveCmd(c),
		newListDoneCmd(c),
		newListRemoveCmd(c),
	)
	return l
}

func newListShowCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:     "show",
		Short:   "List a board's columns",
		Aliases: []string{"ls"},
		Args:    cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			lists, err := projectLists(cmd.Context(), c, p.ID)
			if err != nil {
				return err
			}
			rows := make([][]string, len(lists))
			for i, l := range lists {
				done := ""
				if l.IsDone {
					done = "done"
				}
				rows[i] = []string{strconv.Itoa(i), l.Name, done, l.ID}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"#", "NAME", "KIND", "ID"}, rows, lists)
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

func newListAddCmd(c *client.Client) *cobra.Command {
	var boardRef string
	var index int
	cmd := &cobra.Command{
		Use:   "add <name>",
		Short: "Add a column to a board",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			lists, err := projectLists(ctx, c, p.ID)
			if err != nil {
				return err
			}
			position, err := rankAt(listPositions(lists), index, cmd.Flags().Changed("index"))
			if err != nil {
				return err
			}
			created, err := client.CreateRecord[list](ctx, c, listsCollection, map[string]any{
				"project":  p.ID,
				"name":     args[0],
				"position": position,
				"is_done":  false,
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "added list %q to %s", created.Name, p.Name)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, created)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().IntVar(&index, "index", 0, "insert at this position (default: append)")
	return cmd
}

func newListRenameCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:   "rename <list> <name>",
		Short: "Rename a column",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			l, err := resolveList(ctx, c, p.ID, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[list](ctx, c, listsCollection, l.ID,
				map[string]any{"name": args[1]})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "renamed to %q", updated.Name)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

func newListMoveCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:   "move <list> <index>",
		Short: "Move a column to a position",
		Long: "Move a column to a position.\n\n" +
			"<index> is the 0-based slot the column should come to rest in, " +
			"counting the board's columns as they are AFTER the move.",
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			l, err := resolveList(ctx, c, p.ID, args[0])
			if err != nil {
				return err
			}
			index, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("index %q is not a number", args[1])
			}
			lists, err := projectLists(ctx, c, p.ID)
			if err != nil {
				return err
			}
			position, err := rankForReorder(listPositions(excludeList(lists, l.ID)), index)
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[list](ctx, c, listsCollection, l.ID,
				map[string]any{"position": position})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "moved %q to position %d", updated.Name, index)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

func newListDoneCmd(c *client.Client) *cobra.Command {
	var boardRef string
	var unset bool
	cmd := &cobra.Command{
		Use:   "done <list>",
		Short: "Mark a column as the done column (or --unset)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			l, err := resolveList(ctx, c, p.ID, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[list](ctx, c, listsCollection, l.ID,
				map[string]any{"is_done": !unset})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "%q is_done = %t", updated.Name, updated.IsDone)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().BoolVar(&unset, "unset", false, "clear the done flag instead of setting it")
	return cmd
}

// newListRemoveCmd deletes a column. `cards_cards.list` ships
// cascadeDelete: true, so PocketBase deletes the column's cards server-side —
// there is no way to delete a list without its cards short of moving them
// first. The confirm therefore NAMES THE COUNT, exactly as the app's dialog
// does: a delete that silently destroys seven cards because the cascade was
// invisible is the failure mode here. An empty column skips the prompt.
func newListRemoveCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:     "remove <list>",
		Short:   "Delete a column AND ALL ITS CARDS",
		Aliases: []string{"rm", "delete"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			p, err := requireProjectFlag(cmd, c, boardRef)
			if err != nil {
				return err
			}
			l, err := resolveList(ctx, c, p.ID, args[0])
			if err != nil {
				return err
			}
			// Count ARCHIVED cards too: the cascade does not care, so a
			// confirm that counted only active cards would understate what is
			// about to be destroyed.
			cards, err := listCards(ctx, c, l.ID, true)
			if err != nil {
				return err
			}
			if len(cards) > 0 && !yes {
				return fmt.Errorf(
					"deleting %q also deletes its %d card(s), and this cannot be undone; "+
						"re-run with --yes to confirm", l.Name, len(cards))
			}
			if err := client.DeleteRecord(ctx, c, listsCollection, l.ID); err != nil {
				return err
			}
			if len(cards) > 0 {
				o.Info(cmd.ErrOrStderr(), "deleted %q and its %d card(s)", l.Name, len(cards))
			} else {
				o.Info(cmd.ErrOrStderr(), "deleted %q", l.Name)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

func excludeList(lists []list, id string) []list {
	out := make([]list, 0, len(lists))
	for _, l := range lists {
		if l.ID != id {
			out = append(out, l)
		}
	}
	return out
}

// addBoardFlag installs the --board flag every list and card command shares.
func addBoardFlag(cmd *cobra.Command, target *string) {
	cmd.Flags().StringVarP(target, "board", "b", "", "board id or name (required)")
}

// rankAt returns the rank for a new row: appended by default, or placed at
// `index` when the caller explicitly passed one. Appending is the default
// because that is what adding a column or card almost always means, and
// --index 0 would otherwise be indistinguishable from "not given".
func rankAt(positions []string, index int, explicit bool) (string, error) {
	if !explicit {
		return rankForAppend(positions)
	}
	return rankForInsert(positions, index)
}

// rankForReorder returns the rank moving an EXISTING row to `index`.
//
// `positions` must already EXCLUDE the moving row. Including it makes every
// downward move off by one and turns a move-in-place into a computation of the
// row's own rank — lib/move.ts hit exactly this and says so.
func rankForReorder(positionsWithoutMover []string, index int) (string, error) {
	return rankForInsert(positionsWithoutMover, index)
}
