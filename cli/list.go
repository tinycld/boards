package cli

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

func newColumnCmd(c *client.Client) *cobra.Command {
	l := &cobra.Command{
		Use:     "column",
		Short:   "Columns (lists): show, add, rename, move, limit, remove",
		Aliases: []string{"columns"},
	}
	l.AddCommand(
		newListShowCmd(c),
		newListAddCmd(c),
		newListRenameCmd(c),
		newListMoveCmd(c),
		newListCategoryCmd(c),
		newListDoneCmd(c),
		newListWipCmd(c),
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
				rows[i] = []string{strconv.Itoa(i), l.Name, categoryCell(l), wipCell(l), l.ID}
			}
			return o.Write(cmd.OutOrStdout(),
				[]string{"#", "NAME", "STATUS", "WIP", "ID"}, rows, lists)
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
				"category": "todo",
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "added list %q to %s", created.Name, p.Name)
			return writeListResult(cmd, o, created)
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
			return writeListResult(cmd, o, updated)
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
			return writeListResult(cmd, o, updated)
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

// newListCategoryCmd sets what a column means in the board's workflow.
func newListCategoryCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:   "category <list> <" + strings.Join(listCategories, "|") + ">",
		Short: "Set a column's status: backlog, todo, in_progress, done, or canceled",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !validListCategory(args[1]) {
				return fmt.Errorf("category %q is not one of %s", args[1], strings.Join(listCategories, ", "))
			}
			return setListCategory(cmd, c, boardRef, args[0], args[1])
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

// newListDoneCmd is `list category <list> done`, kept as the shorthand it
// always was; --unset makes the column an ordinary `todo` one again.
func newListDoneCmd(c *client.Client) *cobra.Command {
	var boardRef string
	var unset bool
	cmd := &cobra.Command{
		Use:   "done <list>",
		Short: "Mark a column as done — shorthand for `category <list> done` (or --unset)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			category := "done"
			if unset {
				category = "todo"
			}
			return setListCategory(cmd, c, boardRef, args[0], category)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().BoolVar(&unset, "unset", false, "make the column an ordinary todo column again")
	return cmd
}

func setListCategory(cmd *cobra.Command, c *client.Client, boardRef, listRef, category string) error {
	o, _, err := output.FromCommand(cmd)
	if err != nil {
		return err
	}
	ctx := cmd.Context()
	p, err := requireProjectFlag(cmd, c, boardRef)
	if err != nil {
		return err
	}
	l, err := resolveList(ctx, c, p.ID, listRef)
	if err != nil {
		return err
	}
	updated, err := client.UpdateRecord[list](ctx, c, listsCollection, l.ID,
		map[string]any{"category": category})
	if err != nil {
		return err
	}
	o.Info(cmd.ErrOrStderr(), "%q is now %s", updated.Name, categoryCell(updated))
	return writeListResult(cmd, o, updated)
}

// newListWipCmd sets how many cards belong in a column at once.
//
// NOTHING ENFORCES THE LIMIT — it colours the board's column header and this
// command's WIP column, and no write is ever refused because of it. See
// pb-migrations/1980000019 for why blocking was rejected.
func newListWipCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:   "wip <list> <limit>",
		Short: "Set a column's WIP limit; 0 clears it (a warning only, never enforced)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			// Validated BEFORE the request, the way newListCategoryCmd rejects
			// an unknown category: a rejected value must never reach the
			// server, where the column's own min/max would 400 with a message
			// written for a schema rather than for a person.
			limit, err := strconv.Atoi(args[1])
			if err != nil {
				return fmt.Errorf("limit %q is not a number", args[1])
			}
			if limit < 0 || limit > 999 {
				return fmt.Errorf("limit %d is out of range (0-999, where 0 means no limit)", limit)
			}
			return setListWip(cmd, c, boardRef, args[0], limit)
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

func setListWip(cmd *cobra.Command, c *client.Client, boardRef, listRef string, limit int) error {
	o, _, err := output.FromCommand(cmd)
	if err != nil {
		return err
	}
	ctx := cmd.Context()
	p, err := requireProjectFlag(cmd, c, boardRef)
	if err != nil {
		return err
	}
	l, err := resolveList(ctx, c, p.ID, listRef)
	if err != nil {
		return err
	}
	updated, err := client.UpdateRecord[list](ctx, c, listsCollection, l.ID,
		map[string]any{"wip_limit": limit})
	if err != nil {
		return err
	}
	if limit == 0 {
		o.Info(cmd.ErrOrStderr(), "%q has no WIP limit", updated.Name)
	} else {
		o.Info(cmd.ErrOrStderr(), "%q is limited to %d cards", updated.Name, limit)
	}
	return writeListResult(cmd, o, updated)
}

// newListRemoveCmd deletes a column. `boards_cards.list` ships
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
			if len(cards) > 0 {
				question := fmt.Sprintf(
					"Deleting %q also deletes its %d card(s), and this cannot be undone. Continue?",
					l.Name, len(cards))
				ok, err := ui.Confirm(o, yes, cmd.InOrStdin(), cmd.ErrOrStderr(), question)
				if err != nil {
					// Keep the cascade detail on the non-TTY path: a bare
					// "pass --yes" would hide how many cards go with the column.
					return fmt.Errorf("%s: %w", question, err)
				}
				if !ok {
					return nil
				}
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

// writeCardResult renders what a card mutation produced.
//
// A table run prints nothing — the o.Info chatter on stderr already said what
// happened, and a field dump after every edit is noise. A MACHINE format must
// still emit the record: `-o csv` used to take the CSV branch with nil headers
// and nil rows, which writes a bare newline and silently drops the record, so
// a scripted consumer got an empty result rather than an error.
func writeCardResult(cmd *cobra.Command, o output.Options, cd card) error {
	switch o.Format {
	case output.Table:
		return nil
	case output.CSV:
		return o.Write(cmd.OutOrStdout(),
			[]string{"ID", "LIST", "TITLE", "DUE", "ARCHIVED", "POSITION"},
			[][]string{{
				cd.ID, cd.List, cd.Title, dueCell(cd),
				strconv.FormatBool(cd.Archived), cd.Position,
			}}, cd)
	default:
		return o.Write(cmd.OutOrStdout(), nil, nil, cd)
	}
}

// writeListResult is writeCardResult for a column. Same contract.
func writeListResult(cmd *cobra.Command, o output.Options, l list) error {
	switch o.Format {
	case output.Table:
		return nil
	case output.CSV:
		return o.Write(cmd.OutOrStdout(),
			[]string{"ID", "NAME", "STATUS", "WIP", "POSITION"},
			[][]string{{l.ID, l.Name, categoryCell(l), wipCell(l), l.Position}}, l)
	default:
		return o.Write(cmd.OutOrStdout(), nil, nil, l)
	}
}

// rankAt returns the rank for a new row: appended by default, or placed at
// `index` when the caller explicitly passed one. Appending is the default
// because that is what adding a column or card almost always means, and
// --index 0 would otherwise be indistinguishable from "not given".
func rankAt(positions []string, index int, explicit bool) (string, error) {
	if !explicit {
		return rankForAppend(positions)
	}
	if err := checkIndex(index); err != nil {
		return "", err
	}
	return rankForInsert(positions, index)
}

// checkIndex refuses a negative index.
//
// rankForInsert CLAMPS out-of-range indexes, which is right for one past the
// end — "put it last" is what an off-by-one at the top means. A negative index
// is different: nobody types --index -1 meaning "first", so it is a typo or an
// arithmetic slip in a calling script, and clamping it to a prepend would carry
// out a move the caller never asked for.
func checkIndex(index int) error {
	if index < 0 {
		return fmt.Errorf("index %d is negative — positions count from 0", index)
	}
	return nil
}

// rankForReorder returns the rank moving an EXISTING row to `index`.
//
// `positions` must already EXCLUDE the moving row. Including it makes every
// downward move off by one and turns a move-in-place into a computation of the
// row's own rank — lib/move.ts hit exactly this and says so.
func rankForReorder(positionsWithoutMover []string, index int) (string, error) {
	if err := checkIndex(index); err != nil {
		return "", err
	}
	return rankForInsert(positionsWithoutMover, index)
}
