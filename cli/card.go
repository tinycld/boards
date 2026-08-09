package cli

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

func newCardCmd(c *client.Client) *cobra.Command {
	card := &cobra.Command{
		Use:     "card",
		Short:   "Cards: view, add, edit, move, archive, remove",
		Aliases: []string{"cards"},
	}
	card.AddCommand(
		newCardViewCmd(c),
		newCardAddCmd(c),
		newCardEditCmd(c),
		newCardMoveCmd(c),
		newCardArchiveCmd(c),
		newCardRemoveCmd(c),
	)
	return card
}

// newCardViewCmd shows one card in full, including the checklist and comments
// — the detail a board listing deliberately omits.
func newCardViewCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "view <id>",
		Short:   "Show a card in full",
		Long:    "Show a card in full.\n\n<id> is a card id (see `tinycld cards board view`).",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"show"},
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			items, err := client.ListAll[checklistItem](ctx, c, checklistCollection,
				client.Filter("card = {:c}", map[string]any{"c": cd.ID}), rankSort)
			if err != nil {
				return err
			}
			comments, err := client.ListAll[comment](ctx, c, commentsCollection,
				client.Filter("card = {:c}", map[string]any{"c": cd.ID}), "created")
			if err != nil {
				return err
			}

			ids := append([]string{}, cd.Assignees...)
			for _, cm := range comments {
				ids = append(ids, cm.Author)
			}
			users, err := usersByID(ctx, c, ids)
			if err != nil {
				return err
			}
			labels, err := labelsByID(ctx, c, cd.Labels)
			if err != nil {
				return err
			}

			// JSON gets the whole card with its children nested; the table
			// format is a field list, which is what a terminal reader wants.
			detail := struct {
				card      `json:",inline"`
				Checklist []checklistItem `json:"checklist"`
				Comments  []comment       `json:"comments"`
			}{card: cd, Checklist: items, Comments: comments}

			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, detail)
			}
			rows := [][]string{
				{"Title", cd.Title},
				{"List", cd.List},
				{"Due", dueCell(cd)},
				{"Assignees", names(cd.Assignees, users)},
				{"Labels", labelNames(cd.Labels, labels)},
				{"Checklist", checklistCell(cd)},
				{"Comments", strconv.Itoa(cd.CommentCount)},
				{"Attachments", strconv.Itoa(cd.AttachmentCount)},
				{"Archived", strconv.FormatBool(cd.Archived)},
				{"ID", cd.ID},
			}
			if cd.Description != "" {
				rows = append(rows, []string{"Description", firstLine(cd.Description)})
			}
			for _, it := range items {
				mark := " "
				if it.IsDone {
					mark = "x"
				}
				rows = append(rows, []string{"[" + mark + "]", it.Title})
			}
			for _, cm := range comments {
				author := "?"
				if u, ok := users[cm.Author]; ok {
					author = u.displayName()
				}
				rows = append(rows, []string{"comment", author + ": " + firstLine(cm.Body)})
			}
			return o.Write(cmd.OutOrStdout(), []string{"FIELD", "VALUE"}, rows, detail)
		},
	}
	return cmd
}

func newCardAddCmd(c *client.Client) *cobra.Command {
	var boardRef, listRef, description, due string
	var index int
	cmd := &cobra.Command{
		Use:   "add <title>",
		Short: "Add a card to a column",
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
			if listRef == "" {
				return fmt.Errorf("--list is required (a list id or name; see `tinycld cards list show`)")
			}
			l, err := resolveList(ctx, c, p.ID, listRef)
			if err != nil {
				return err
			}
			cards, err := listCards(ctx, c, l.ID, true)
			if err != nil {
				return err
			}
			position, err := rankAt(cardPositions(cards), index, cmd.Flags().Changed("index"))
			if err != nil {
				return err
			}
			dueValue, err := parseDue(due)
			if err != nil {
				return err
			}
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			// `project` is written explicitly even though `list` implies it:
			// the column is DENORMALIZED onto the card so the access rules can
			// resolve membership without a two-hop back-relation, and the
			// create rule reads it. A card without it is refused.
			body := map[string]any{
				"project":     p.ID,
				"list":        l.ID,
				"position":    position,
				"title":       args[0],
				"description": description,
				"due":         dueValue,
				"created_by":  userID,
				"archived":    false,
			}
			created, err := client.CreateRecord[card](ctx, c, cardsCollection, body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "added %q to %s", created.Title, l.Name)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, created)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVarP(&listRef, "list", "l", "", "list id or name (required)")
	cmd.Flags().StringVar(&description, "description", "", "markdown description")
	cmd.Flags().StringVar(&due, "due", "", "due date as YYYY-MM-DD")
	cmd.Flags().IntVar(&index, "index", 0, "insert at this position (default: append)")
	return cmd
}

func newCardEditCmd(c *client.Client) *cobra.Command {
	var title, description, due string
	var clearDue bool
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Change a card's title, description, or due date",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			body := map[string]any{}
			// Only fields the caller actually passed are sent. A PATCH built
			// from every flag would blank a description the caller never
			// mentioned, and --title "" is a legitimate no-op rather than an
			// instruction to clear a required field.
			if cmd.Flags().Changed("title") {
				if strings.TrimSpace(title) == "" {
					return fmt.Errorf("--title cannot be empty")
				}
				body["title"] = title
			}
			if cmd.Flags().Changed("description") {
				body["description"] = description
			}
			switch {
			case clearDue && cmd.Flags().Changed("due"):
				return fmt.Errorf("--due and --clear-due contradict each other")
			case clearDue:
				body["due"] = ""
			case cmd.Flags().Changed("due"):
				v, err := parseDue(due)
				if err != nil {
					return err
				}
				body["due"] = v
			}
			if len(body) == 0 {
				return fmt.Errorf("nothing to change — pass --title, --description, --due, or --clear-due")
			}
			updated, err := client.UpdateRecord[card](ctx, c, cardsCollection, args[0], body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "updated %q", updated.Title)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&title, "title", "", "new title")
	cmd.Flags().StringVar(&description, "description", "", "new markdown description")
	cmd.Flags().StringVar(&due, "due", "", "due date as YYYY-MM-DD")
	cmd.Flags().BoolVar(&clearDue, "clear-due", false, "remove the due date")
	return cmd
}

// newCardMoveCmd moves a card to another column and/or another position.
//
// Both fields go in ONE update, as useMoveCard does. Two PATCHes would leave
// the card momentarily in the target column at its OLD rank, which every other
// client would render — and if the second call failed, permanently.
func newCardMoveCmd(c *client.Client) *cobra.Command {
	var boardRef, listRef string
	var index int
	cmd := &cobra.Command{
		Use:   "move <id>",
		Short: "Move a card to another column or position",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			hasList := cmd.Flags().Changed("list")
			hasIndex := cmd.Flags().Changed("index")
			if !hasList && !hasIndex {
				return fmt.Errorf("nothing to move — pass --list, --index, or both")
			}

			// The card's OWN project, not a --board flag: a card is addressed
			// by id and already names its board, so asking for one again is
			// redundant and lets the two disagree. --board is accepted only to
			// resolve a --list NAME, and must match.
			projectID := cd.Project
			if boardRef != "" {
				p, err := resolveProject(ctx, c, boardRef)
				if err != nil {
					return err
				}
				if p.ID != projectID {
					return fmt.Errorf("card %s is not on board %q", cd.ID, boardRef)
				}
			}

			targetList := cd.List
			if hasList {
				l, err := resolveList(ctx, c, projectID, listRef)
				if err != nil {
					return err
				}
				targetList = l.ID
			}

			siblings, err := listCards(ctx, c, targetList, true)
			if err != nil {
				return err
			}
			// Exclude the moving card when it is already in the target column,
			// or a downward move is off by one and a move-in-place computes
			// the card's own rank.
			siblings = excludeCard(siblings, cd.ID)

			var position string
			if hasIndex {
				position, err = rankForReorder(cardPositions(siblings), index)
			} else {
				// A cross-column move with no index appends, which is where a
				// dropped card lands when no slot was chosen.
				position, err = rankForAppend(cardPositions(siblings))
			}
			if err != nil {
				return err
			}

			updated, err := client.UpdateRecord[card](ctx, c, cardsCollection, cd.ID, map[string]any{
				"list":     targetList,
				"position": position,
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "moved %q", updated.Title)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVarP(&listRef, "list", "l", "", "destination list id or name")
	cmd.Flags().IntVar(&index, "index", 0, "destination position within the column")
	return cmd
}

func newCardArchiveCmd(c *client.Client) *cobra.Command {
	var unset bool
	cmd := &cobra.Command{
		Use:   "archive <id>",
		Short: "Archive a card (or --unset to restore it)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[card](cmd.Context(), c, cardsCollection, args[0],
				map[string]any{"archived": !unset})
			if err != nil {
				return err
			}
			verb := "archived"
			if unset {
				verb = "restored"
			}
			o.Info(cmd.ErrOrStderr(), "%s %q", verb, updated.Title)
			if o.Format != output.Table {
				return o.Write(cmd.OutOrStdout(), nil, nil, updated)
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&unset, "unset", false, "restore an archived card")
	return cmd
}

// newCardRemoveCmd deletes a card permanently. The checklist, comments and
// attachments cascade with it, so the confirm says so — archive is the
// reversible option and the app offers it first for the same reason.
func newCardRemoveCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "remove <id>",
		Short:   "Delete a card permanently",
		Aliases: []string{"rm", "delete"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			if !yes {
				return fmt.Errorf(
					"deleting %q also deletes its checklist, comments and attachments, "+
						"and this cannot be undone; re-run with --yes to confirm, or use "+
						"`cards card archive` to hide it reversibly", cd.Title)
			}
			if err := client.DeleteRecord(ctx, c, cardsCollection, cd.ID); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "deleted %q", cd.Title)
			return nil
		},
	}
	return cmd
}

func excludeCard(cards []card, id string) []card {
	out := make([]card, 0, len(cards))
	for _, cd := range cards {
		if cd.ID != id {
			out = append(out, cd)
		}
	}
	return out
}

// parseDue accepts a day-granular YYYY-MM-DD and returns what PocketBase
// stores. Cards are day-granular throughout (core's lib/dates is
// LOCAL-TIME and day-granular expressly to avoid the toISOString() round trip
// that shifts a date a day west of Greenwich), so a time-of-day would be
// meaningless precision that renders differently per reader.
func parseDue(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", nil
	}
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return "", fmt.Errorf("--due %q is not a date (want YYYY-MM-DD)", v)
	}
	// PocketBase stores a date field as a full timestamp; the app writes
	// midnight and reads the date half back.
	return v + " 00:00:00.000Z", nil
}

func labelsByID(ctx context.Context, c *client.Client, ids []string) (map[string]label, error) {
	out := map[string]label{}
	if len(ids) == 0 {
		return out, nil
	}
	var terms []string
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		terms = append(terms, client.Filter("id = {:i}", map[string]any{"i": id}))
	}
	labels, err := client.ListAll[label](ctx, c, labelsCollection, strings.Join(terms, " || "), "")
	if err != nil {
		return nil, err
	}
	for _, l := range labels {
		out[l.ID] = l
	}
	return out, nil
}

// labelNames renders a card's labels. An id with no readable row is DROPPED
// rather than shown as "?" — matching toBoardCard, which drops unresolvable
// label ids because deleting a label deliberately leaves its id on the cards
// that carried it (cascadeDelete: false).
func labelNames(ids []string, labels map[string]label) string {
	var out []string
	for _, id := range ids {
		if l, ok := labels[id]; ok {
			out = append(out, l.Name)
		}
	}
	if len(out) == 0 {
		return "-"
	}
	return strings.Join(out, ", ")
}

// firstLine collapses a multi-line body into one table cell. Markdown
// descriptions and comments are frequently long; `--json` gives the full text.
func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = strings.TrimSpace(s[:i]) + " …"
	}
	if len(s) > 80 {
		s = s[:79] + "…"
	}
	return s
}
