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
	"tinycld.org/cli/ui"
)

func newCardCmd(c *client.Client) *cobra.Command {
	card := &cobra.Command{
		Use:     "card",
		Short:   "Cards: view, add, edit, move, copy, archive, remove",
		Aliases: []string{"cards"},
	}
	card.AddCommand(
		newCardViewCmd(c),
		newCardAddCmd(c),
		newCardEditCmd(c),
		newCardMoveCmd(c),
		newCardCopyCmd(c),
		newCardArchiveCmd(c),
		newCardRemoveCmd(c),
		newCardLinkCmd(c),
		newCardUnlinkCmd(c),
	)
	return card
}

// newCardViewCmd shows one card in full, including the checklist and comments
// — the detail a board listing deliberately omits.
func newCardViewCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "view <id>",
		Short:   "Show a card in full",
		Long:    "Show a card in full.\n\n<id> is a card id (see `tinycld boards view`).",
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
			links, err := cardLinks(ctx, c, cd.ID)
			if err != nil {
				return err
			}

			ids := append([]string{}, cd.Assignees...)
			if reporterID := cd.reporterID(); reporterID != "" {
				ids = append(ids, reporterID)
			}
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

			// JSON gets the whole card with its children nested; table and CSV
			// get the field list, which is what a terminal reader wants and
			// what a CSV consumer can actually parse. Only JSON short-circuits
			// here — passing nil headers and nil rows to a CSV render emits a
			// bare newline and drops the record.
			// Links are oriented for THIS card before they go anywhere: the
			// stored row says nothing about which end you are reading from,
			// and a consumer should not have to work that out. A far card the
			// caller cannot read is carried as redacted, never dropped — see
			// link.go's header.
			linkRows := orientLinks(ctx, c, links, cd.ID, projectSlugs(ctx, c, links, cd))

			detail := struct {
				card      `json:",inline"`
				Checklist []checklistItem `json:"checklist"`
				Comments  []comment       `json:"comments"`
				Links     []linkRow       `json:"links"`
			}{card: cd, Checklist: items, Comments: comments, Links: linkRows}

			if o.Format == output.JSON {
				return o.Write(cmd.OutOrStdout(), nil, nil, detail)
			}
			// The key's slug half lives on the board, which this command has
			// not otherwise loaded. One lookup by id, and a failure is
			// swallowed: a missing board slug costs a row, not the whole view
			// of a card the caller already fetched.
			cardKey := ""
			boardSlug := ""
			if board, boardErr := resolveProject(ctx, c, cd.Project); boardErr == nil {
				boardSlug = board.Slug
				cardKey = formatCardKey(board.Slug, cd.Number)
			}

			// The list is a foreign key, and every other field in the table
			// below renders a name. Printing the raw id here left one row
			// reading `c7fehmjobre6hr9` among human text — and `board view`
			// shows the same field resolved, so the two commands disagreed
			// about what a list is called. Fetched after the JSON
			// short-circuit: --json carries the id, as a script wants.
			listName := cd.List
			if lists, listErr := listsByID(ctx, c, []string{cd.List}); listErr == nil {
				if l, ok := lists[cd.List]; ok && l.Name != "" {
					listName = l.Name
				}
			}

			rows := [][]string{
				{"Title", cd.Title},
				{"List", listName},
				{"Due", dueCell(cd)},
				{"Assignees", names(cd.Assignees, users)},
				{"Labels", labelNames(cd.Labels, labels)},
				{"Checklist", checklistCell(cd)},
				{"Comments", strconv.Itoa(cd.CommentCount)},
				{"Attachments", strconv.Itoa(cd.AttachmentCount)},
				{"Archived", strconv.FormatBool(cd.Archived)},
				{"ID", cd.ID},
			}
			// Above the ID would be nicer, but the row order above is what
			// existing output tests read; appended so a board without a key
			// simply omits the row rather than shifting every other one.
			if cardKey != "" {
				rows = append(rows, []string{"Key", cardKey})
			}
			// Appended for the same reason Key is: the row order above is what
			// the existing output tests read.
			if reporterID := cd.reporterID(); reporterID != "" {
				rows = append(rows, []string{"Reporter", names([]string{reporterID}, users)})
			}
			// Appended, and only when set, as Priority is.
			if cd.Start != "" {
				rows = append(rows, []string{"Start", dayCell(cd.Start)})
			}
			// Appended, and only when set, for the same reason: a card with
			// no priority shows nothing on the board face either.
			if p := priorityCell(cd); p != "-" {
				rows = append(rows, []string{"Priority", p})
			}
			// Appended, and only when set, as Priority is.
			if cd.Estimate > 0 {
				rows = append(rows, []string{"Estimate", estimateCell(cd.Estimate)})
			}
			// The parent's KEY rather than its record id — the same thing a
			// person would quote — resolved through the same lookup `card
			// view <key>` accepts. Falls back to the id when the parent has
			// been deleted, which un-parents the card without clearing it.
			if cd.Parent != "" {
				parentCell := cd.Parent
				// The parent is always on the same board, so its key shares
				// this card's slug — no second board lookup.
				if pd, parentErr := getCard(ctx, c, cd.Parent); parentErr == nil {
					if key := formatCardKey(boardSlug, pd.Number); key != "" {
						parentCell = key
					}
				}
				rows = append(rows, []string{"Sub-task of", parentCell})
			}
			// Only when the card has sub-tasks, as Estimate is.
			if cd.SubtaskTotal > 0 {
				rows = append(rows, []string{
					"Sub-tasks",
					fmt.Sprintf("%d/%d done", cd.SubtaskDone, cd.SubtaskTotal),
				})
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
			rows = append(rows, linkTableRows(linkRows)...)
			return o.Write(cmd.OutOrStdout(), []string{"FIELD", "VALUE"}, rows, detail)
		},
	}
	return cmd
}

func newCardAddCmd(c *client.Client) *cobra.Command {
	var boardRef, listRef, description, due, start, reporter, priority, parent string
	var index, estimate int
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
				return fmt.Errorf("--list is required (a list id or name; see `tinycld boards column show`)")
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
			dueValue, dueHasTime, err := parseDueFlag(due)
			if err != nil {
				return err
			}
			startValue, err := parseDay("--start", start)
			if err != nil {
				return err
			}
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			// Defaults to the caller, which is what created_by records anyway.
			// No server hook fills this in — core.RecordEvent carries no request
			// auth, so it could not recover the caller — so every insert path
			// writes it, and `boards card add --reporter <id>` is how the CLI
			// files a card on someone else's behalf.
			reporterID := userID
			if cmd.Flags().Changed("reporter") {
				reporterID = reporter
			}
			if !validPriority(priority) {
				return fmt.Errorf("--priority %q is not one of %s", priority, strings.Join(priorities, ", "))
			}
			if estimate < 0 {
				return fmt.Errorf("--estimate must be 0 or more (0 means no estimate)")
			}
			// `project` is written explicitly even though `list` implies it:
			// the column is DENORMALIZED onto the card so the access rules can
			// resolve membership without a two-hop back-relation, and the
			// create rule reads it. A card without it is refused.
			// A sub-task's parent must be on the same board; the server
			// refuses anything else. Resolved through getCard so a key works
			// here as it does everywhere else.
			parentID := ""
			if parent != "" {
				pd, err := getCard(ctx, c, parent)
				if err != nil {
					return err
				}
				parentID = pd.ID
			}
			body := map[string]any{
				"project":      p.ID,
				"list":         l.ID,
				"position":     position,
				"title":        args[0],
				"description":  description,
				"due":          dueValue,
				"due_has_time": dueHasTime,
				"start":        startValue,
				"created_by":   userID,
				"reporter":     reporterID,
				"priority":     priority,
				"estimate":     estimate,
				"parent":       parentID,
				"archived":     false,
			}
			created, err := client.CreateRecord[card](ctx, c, cardsCollection, body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "added %q to %s", created.Title, l.Name)
			return writeCardResult(cmd, o, created)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVarP(&listRef, "list", "l", "", "list id or name (required)")
	cmd.Flags().StringVar(&description, "description", "", "markdown description")
	cmd.Flags().StringVar(&due, "due", "", "due date as YYYY-MM-DD, or \"YYYY-MM-DD HH:MM\" (local time)")
	cmd.Flags().StringVar(&start, "start", "", "start date as YYYY-MM-DD")
	cmd.Flags().IntVar(&index, "index", 0, "insert at this position (default: append)")
	// A user id, not an email or a name: there is no by-email user lookup in
	// this CLI (usersByID is id-only), and inventing one here would be a
	// resolver nobody has specified. Stated in the help so it is a documented
	// limit rather than a surprise.
	cmd.Flags().StringVar(&reporter, "reporter", "", "user id to report to (default: you)")
	cmd.Flags().StringVar(&priority, "priority", "none", "one of "+strings.Join(priorities, ", "))
	cmd.Flags().IntVar(&estimate, "estimate", 0, "points (0 = no estimate)")
	cmd.Flags().StringVar(&parent, "parent", "", "make this a sub-task of a card on the same board (id or key)")
	return cmd
}

func newCardEditCmd(c *client.Client) *cobra.Command {
	var title, description, due, start, reporter, priority, parent string
	var estimate int
	var clearDue, clearStart, clearReporter, clearParent bool
	cmd := &cobra.Command{
		Use:   "edit <id>",
		Short: "Change a card's title, description, dates, reporter, priority, estimate, or parent",
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
				body["due_has_time"] = false
			case cmd.Flags().Changed("due"):
				v, hasTime, err := parseDueFlag(due)
				if err != nil {
					return err
				}
				body["due"] = v
				body["due_has_time"] = hasTime
			}
			switch {
			case clearStart && cmd.Flags().Changed("start"):
				return fmt.Errorf("--start and --clear-start contradict each other")
			case clearStart:
				body["start"] = ""
			case cmd.Flags().Changed("start"):
				v, err := parseDay("--start", start)
				if err != nil {
					return err
				}
				body["start"] = v
			}
			// Same shape as --due/--clear-due, and for the same reason: an
			// empty --reporter is indistinguishable from not passing it, so
			// clearing needs its own flag. Note that clearing restores the
			// created_by fallback rather than emptying the field — the card
			// reports to its creator again.
			switch {
			case clearReporter && cmd.Flags().Changed("reporter"):
				return fmt.Errorf("--reporter and --clear-reporter contradict each other")
			case clearReporter:
				body["reporter"] = ""
			case cmd.Flags().Changed("reporter"):
				if strings.TrimSpace(reporter) == "" {
					return fmt.Errorf("--reporter cannot be empty (use --clear-reporter)")
				}
				body["reporter"] = reporter
			}
			// `none` is how a priority is cleared — it is a value the schema
			// names, so there is no --clear-priority to pair with it.
			if cmd.Flags().Changed("priority") {
				if !validPriority(priority) {
					return fmt.Errorf("--priority %q is not one of %s", priority, strings.Join(priorities, ", "))
				}
				body["priority"] = priority
			}
			// 0 is how an estimate is cleared — it is what the row stores for
			// "none" — so there is no --clear-estimate to pair with it.
			if cmd.Flags().Changed("estimate") {
				if estimate < 0 {
					return fmt.Errorf("--estimate must be 0 or more (0 clears it)")
				}
				body["estimate"] = estimate
			}
			// A relation has no sentinel "empty" value the way priority and
			// estimate do, so clearing needs its own flag — the --reporter
			// shape. The parent must be a card on the SAME board; the server
			// refuses anything else (pb-migrations/1980000015).
			switch {
			case clearParent && cmd.Flags().Changed("parent"):
				return fmt.Errorf("--parent and --clear-parent contradict each other")
			case clearParent:
				body["parent"] = ""
			case cmd.Flags().Changed("parent"):
				if strings.TrimSpace(parent) == "" {
					return fmt.Errorf("--parent cannot be empty (use --clear-parent)")
				}
				pd, err := getCard(ctx, c, parent)
				if err != nil {
					return err
				}
				body["parent"] = pd.ID
			}
			if len(body) == 0 {
				return fmt.Errorf("nothing to change — pass --title, --description, --due, --clear-due, --start, --clear-start, --reporter, --clear-reporter, --priority, --estimate, --parent, or --clear-parent")
			}
			// Through getCard so a card key (OTTER-12) works here exactly as it
			// does in `card view`/`card move` — the id is what the API needs.
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[card](ctx, c, cardsCollection, cd.ID, body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "updated %q", updated.Title)
			return writeCardResult(cmd, o, updated)
		},
	}
	cmd.Flags().StringVar(&title, "title", "", "new title")
	cmd.Flags().StringVar(&description, "description", "", "new markdown description")
	cmd.Flags().StringVar(&due, "due", "", "due date as YYYY-MM-DD, or \"YYYY-MM-DD HH:MM\" (local time)")
	cmd.Flags().BoolVar(&clearDue, "clear-due", false, "remove the due date")
	cmd.Flags().StringVar(&start, "start", "", "start date as YYYY-MM-DD")
	cmd.Flags().BoolVar(&clearStart, "clear-start", false, "remove the start date")
	cmd.Flags().StringVar(&reporter, "reporter", "", "user id to report to")
	cmd.Flags().BoolVar(&clearReporter, "clear-reporter", false, "report to the card's creator again")
	cmd.Flags().StringVar(&priority, "priority", "", "one of "+strings.Join(priorities, ", ")+" (none clears it)")
	cmd.Flags().IntVar(&estimate, "estimate", 0, "points (0 clears it)")
	cmd.Flags().StringVar(&parent, "parent", "", "make this a sub-task of a card on the same board (id or key)")
	cmd.Flags().BoolVar(&clearParent, "clear-parent", false, "stop being a sub-task")
	return cmd
}

// newCardMoveCmd moves a card to another column and/or another position.
//
// Both fields go in ONE update, as useMoveCard does. Two PATCHes would leave
// the card momentarily in the target column at its OLD rank, which every other
// client would render — and if the second call failed, permanently.
func newCardMoveCmd(c *client.Client) *cobra.Command {
	var boardRef, listRef, family string
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

			// The card's OWN project by default: a card is addressed by id and
			// already names its board. A --board naming ANOTHER board is a
			// cross-board move, which goes through the server endpoint —
			// the rules pin `project`, so no PATCH could do it — and needs
			// neither --list nor --index (the target's first column, appended).
			projectID := cd.Project
			if boardRef != "" {
				p, err := resolveProject(ctx, c, boardRef)
				if err != nil {
					return err
				}
				if p.ID != projectID {
					return moveCardToBoard(cmd, c, o, cd, p, listRef, hasList, family)
				}
			}
			if !hasList && !hasIndex {
				return fmt.Errorf("nothing to move — pass --list, --index, or both")
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
			return writeCardResult(cmd, o, updated)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVarP(&listRef, "list", "l", "", "destination list id or name")
	cmd.Flags().IntVar(&index, "index", 0, "destination position within the column")
	// Required by the server for a cross-board move of a card in a sub-task
	// family, and meaningless otherwise. No default: the server refuses rather
	// than guessing, because both answers move work the caller cannot see.
	cmd.Flags().StringVar(&family, "family", "",
		"with --board, what to do with sub-tasks: move or unlink")
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
			ctx := cmd.Context()
			// Same key-or-id resolution as the sibling commands.
			cd, err := getCard(ctx, c, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[card](ctx, c, cardsCollection, cd.ID,
				map[string]any{"archived": !unset})
			if err != nil {
				return err
			}
			verb := "archived"
			if unset {
				verb = "restored"
			}
			o.Info(cmd.ErrOrStderr(), "%s %q", verb, updated.Title)
			return writeCardResult(cmd, o, updated)
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
			// Prompt on a TTY like every other package's rm; ui.Confirm still
			// refuses (rather than hanging) when there is no terminal, so a
			// script must pass --yes exactly as before.
			question := fmt.Sprintf(
				"PERMANENTLY delete %q, with its checklist, comments and attachments? "+
					"(`boards card archive` hides it reversibly)", cd.Title)
			ok, err := ui.Confirm(o, yes, cmd.InOrStdin(), cmd.ErrOrStderr(), question)
			if err != nil {
				// The generic "pass --yes" refusal alone would not say WHAT the
				// delete destroys, which is the whole point of the warning.
				return fmt.Errorf("%s: %w", question, err)
			}
			if !ok {
				return nil
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

// moveCardToBoard moves a card to another board through
// POST /api/boards/cards/{id}/move. The destination list defaults to the
// target board's first column; the rank appends, as a cross-column move
// with no --index does.
func moveCardToBoard(cmd *cobra.Command, c *client.Client, o output.Options, cd card, target project, listRef string, hasList bool, family string) error {
	ctx := cmd.Context()
	lists, err := projectLists(ctx, c, target.ID)
	if err != nil {
		return err
	}
	if len(lists) == 0 {
		return fmt.Errorf("board %q has no lists to move the card into", target.Name)
	}
	dest := lists[0]
	if hasList {
		dest, err = resolveList(ctx, c, target.ID, listRef)
		if err != nil {
			return err
		}
	}
	siblings, err := listCards(ctx, c, dest.ID, true)
	if err != nil {
		return err
	}
	position, err := rankForAppend(cardPositions(siblings))
	if err != nil {
		return err
	}
	var result struct {
		Card             card     `json:"card"`
		PreviousKey      string   `json:"previous_key"`
		DroppedLabels    []string `json:"dropped_labels"`
		MovedChildren    int      `json:"moved_children"`
		OrphanedChildren int      `json:"orphaned_children"`
		ClearedParent    bool     `json:"cleared_parent"`
	}
	err = c.PostJSON(ctx, "/api/boards/cards/"+cd.ID+"/move", map[string]any{
		"project_id": target.ID,
		"list_id":    dest.ID,
		"position":   position,
		"family":     family,
	}, &result)
	if err != nil {
		return err
	}
	o.Info(cmd.ErrOrStderr(), "moved %q to %s as %s", result.Card.Title, target.Name,
		formatCardKey(target.Slug, result.Card.Number))
	if len(result.DroppedLabels) > 0 {
		o.Info(cmd.ErrOrStderr(), "dropped labels not on %s: %s", target.Name,
			strings.Join(result.DroppedLabels, ", "))
	}
	// Say what happened to the family, for the reason dropped labels are
	// reported: a card arriving with fewer relations than it left is a
	// surprise unless it is stated.
	if result.MovedChildren > 0 {
		o.Info(cmd.ErrOrStderr(), "brought %d sub-task(s) along", result.MovedChildren)
	}
	if result.OrphanedChildren > 0 {
		o.Info(cmd.ErrOrStderr(), "left %d sub-task(s) behind as top-level cards",
			result.OrphanedChildren)
	}
	if result.ClearedParent {
		o.Info(cmd.ErrOrStderr(), "this card is no longer a sub-task — a parent cannot follow it")
	}
	return writeCardResult(cmd, o, result.Card)
}

func newCardCopyCmd(c *client.Client) *cobra.Command {
	var title string
	cmd := &cobra.Command{
		Use:   "copy <id>",
		Short: "Duplicate a card on its board, with its checklist",
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
			siblings, err := listCards(ctx, c, cd.List, true)
			if err != nil {
				return err
			}
			position, err := rankForAppend(cardPositions(siblings))
			if err != nil {
				return err
			}
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			newTitle := "Copy of " + cd.Title
			if cmd.Flags().Changed("title") {
				newTitle = title
			}
			reporter := cd.Reporter
			if reporter == "" {
				reporter = userID
			}
			body := map[string]any{
				"project":      cd.Project,
				"list":         cd.List,
				"position":     position,
				"title":        newTitle,
				"description":  cd.Description,
				"due":          cd.Due,
				"due_has_time": cd.DueHasTime,
				"start":        cd.Start,
				"assignees":    cd.Assignees,
				"labels":       cd.Labels,
				"created_by":   userID,
				"reporter":     reporter,
				"priority":     cd.Priority,
				"estimate":     cd.Estimate,
				"archived":     false,
			}
			created, err := client.CreateRecord[card](ctx, c, cardsCollection, body)
			if err != nil {
				return err
			}
			items, err := client.ListAll[checklistItem](ctx, c, checklistCollection,
				client.Filter("card = {:c}", map[string]any{"c": cd.ID}), rankSort)
			if err != nil {
				return err
			}
			for _, it := range items {
				_, err := client.CreateRecord[checklistItem](ctx, c, checklistCollection, map[string]any{
					"card":     created.ID,
					"project":  cd.Project,
					"title":    it.Title,
					"is_done":  it.IsDone,
					"position": it.Position,
				})
				if err != nil {
					return err
				}
			}
			o.Info(cmd.ErrOrStderr(), "copied %q as %q", cd.Title, created.Title)
			// Attachments are files, and a file cannot be copied with a JSON
			// create; the app leaves them behind for the same reason.
			if cd.AttachmentCount > 0 {
				o.Info(cmd.ErrOrStderr(), "note: %d attachment(s) were not copied", cd.AttachmentCount)
			}
			return writeCardResult(cmd, o, created)
		},
	}
	cmd.Flags().StringVar(&title, "title", "", "title for the copy (default: \"Copy of …\")")
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

func estimateCell(points int) string {
	if points == 1 {
		return "1 pt"
	}
	return strconv.Itoa(points) + " pts"
}

// parseDay accepts a day-granular YYYY-MM-DD and returns what PocketBase
// stores for it. A day names a calendar day, the same for every reader
// (core's lib/dates is LOCAL-TIME and day-granular expressly to avoid the
// toISOString() round trip that shifts a date a day west of Greenwich), so
// it is written as midnight UTC and the app reads the date half back.
func parseDay(flag, v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", nil
	}
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return "", fmt.Errorf("%s %q is not a date (want YYYY-MM-DD)", flag, v)
	}
	return v + " 00:00:00.000Z", nil
}

// parseDueFlag accepts a day (YYYY-MM-DD) or a day with a time
// ("YYYY-MM-DD HH:MM"). A time is read in THIS machine's local zone — a
// deadline typed at a terminal means the terminal's afternoon — and stored
// as the instant, with the flag that tells the app to read it as one.
func parseDueFlag(v string) (value string, hasTime bool, err error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "", false, nil
	}
	if at, err := time.ParseInLocation("2006-01-02 15:04", v, time.Local); err == nil {
		return at.UTC().Format(pbDateFormat), true, nil
	}
	day, err := parseDay("--due", v)
	if err != nil {
		return "", false, fmt.Errorf("--due %q is not a date (want YYYY-MM-DD or \"YYYY-MM-DD HH:MM\")", v)
	}
	return day, false, nil
}

// pbDateFormat is how PocketBase renders a date field.
const pbDateFormat = "2006-01-02 15:04:05.000Z"

// dayCell keeps the day half of a stored date.
func dayCell(v string) string {
	if len(v) >= 10 {
		return v[:10]
	}
	return v
}

func labelsByID(ctx context.Context, c *client.Client, ids []string) (map[string]label, error) {
	return recordsByID(ctx, c, labelsCollection, ids, func(l label) string { return l.ID })
}

func listsByID(ctx context.Context, c *client.Client, ids []string) (map[string]list, error) {
	return recordsByID(ctx, c, listsCollection, ids, func(l list) string { return l.ID })
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
//
// The cap counts RUNES, not bytes. Slicing a string at a byte offset cuts a
// multi-byte rune in half and emits invalid UTF-8 — a description of 60 "é"
// rendered as a truncated rune followed by the ellipsis — and it also made the
// visible limit depend on the alphabet, so a CJK body was cut at ~26 characters
// rather than 80.
func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "\r\n"); i >= 0 {
		s = strings.TrimSpace(s[:i]) + " …"
	}
	if r := []rune(s); len(r) > firstLineRunes {
		s = string(r[:firstLineRunes-1]) + "…"
	}
	return s
}

const firstLineRunes = 80
