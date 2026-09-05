package cli

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
	"tinycld.org/cli/ui"
)

// Sprints on the command line: plan them, file cards into them, start and
// complete them.
//
// A sprint is named BY NUMBER within its board (`--board X 3`), by the words
// `active` and `next`, or by record id — never by name. A name is free text
// the team edits, and "Sprint 3" is what the app prints on every face, so the
// number is the handle a person actually has.
//
// The two transitions go through server endpoints, not record writes: a start
// stamps the commitment and a completion re-files cards, and both write
// columns a client is refused (server/sprint_owned_columns.go). `complete`
// has NO default for where unfinished cards go — the server refuses rather
// than guessing, the contract `card move --family` already follows.

const sprintsCollection = "boards_sprints"

// sprintStates is the forward-only lifecycle server/sprint_guard.go enforces.
var sprintStates = []string{"planned", "active", "completed"}

type sprint struct {
	ID      string `json:"id"`
	Project string `json:"project"`
	// Server-assigned per board (server/sprint_number.go); read-only here.
	Number   int    `json:"number"`
	Name     string `json:"name"`
	Goal     string `json:"goal"`
	Start    string `json:"start"`
	End      string `json:"end"`
	State    string `json:"state"`
	Position string `json:"position"`
	// Everything below is server-owned: the live rollup and the stamps the
	// transitions write. The CLI never sends them.
	StartedAt       string `json:"started_at"`
	CompletedAt     string `json:"completed_at"`
	CardTotal       int    `json:"card_total"`
	CardDone        int    `json:"card_done"`
	PointsTotal     int    `json:"points_total"`
	PointsDone      int    `json:"points_done"`
	CommittedCount  int    `json:"committed_count"`
	CommittedPoints int    `json:"committed_points"`
	CompletedCount  int    `json:"completed_count"`
	CompletedPoints int    `json:"completed_points"`
	RolledCount     int    `json:"rolled_count"`
}

// label mirrors lib/sprint.ts's sprintLabel: the name when given, else
// "Sprint N".
func (s sprint) label() string {
	if s.Name != "" {
		return s.Name
	}
	return fmt.Sprintf("Sprint %d", s.Number)
}

func newSprintCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "sprint",
		Short: "Plan, start and complete sprints",
		Long: "Plan, start and complete sprints.\n\n" +
			"Sprints are per board and off by default; turn them on in the board's\n" +
			"settings in the app. A sprint is named by its number within a board\n" +
			"(`--board X 3`), by `active` or `next`, or by id — never by name.",
	}
	cmd.AddCommand(
		newSprintListCmd(c),
		newSprintViewCmd(c),
		newSprintCreateCmd(c),
		newSprintEditCmd(c),
		newSprintStartCmd(c),
		newSprintCompleteCmd(c),
		newSprintDeleteCmd(c),
	)
	return cmd
}

// projectSprints reads a board's sprints, numbered order.
func projectSprints(ctx context.Context, c *client.Client, projectID string) ([]sprint, error) {
	return client.ListAll[sprint](ctx, c, sprintsCollection,
		client.Filter("project = {:p}", map[string]any{"p": projectID}), "number")
}

// resolveSprint turns a sprint reference into a row on ONE board.
//
// `active` is the running sprint; `next` the planned one that would start
// next (lowest rank, then number); a bare number is the board's numbering;
// anything else is a record id, which must be on this board. A name is
// refused by omission — see the file header.
func resolveSprint(ctx context.Context, c *client.Client, projectID, ref string) (sprint, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return sprint{}, errors.New("no sprint given")
	}
	sprints, err := projectSprints(ctx, c, projectID)
	if err != nil {
		return sprint{}, err
	}
	switch strings.ToLower(ref) {
	case "active":
		for _, s := range sprints {
			if s.State == "active" {
				return s, nil
			}
		}
		return sprint{}, fmt.Errorf("no active sprint on this board")
	case "next":
		if next, ok := nextPlanned(sprints); ok {
			return next, nil
		}
		return sprint{}, fmt.Errorf("no planned sprint on this board")
	}
	if n, err := strconv.Atoi(ref); err == nil {
		for _, s := range sprints {
			if s.Number == n {
				return s, nil
			}
		}
		return sprint{}, fmt.Errorf("sprint %d: %w", n, errNotFound)
	}
	for _, s := range sprints {
		if s.ID == ref {
			return s, nil
		}
	}
	return sprint{}, fmt.Errorf("sprint %q: %w (name a sprint by number, `active`, `next` or id)", ref, errNotFound)
}

// nextPlanned is the planned sprint with the lowest rank — what `next` names
// and what a completion's `next` target rolls into.
func nextPlanned(sprints []sprint) (sprint, bool) {
	var planned []sprint
	for _, s := range sprints {
		if s.State == "planned" {
			planned = append(planned, s)
		}
	}
	if len(planned) == 0 {
		return sprint{}, false
	}
	sortSprintsByRank(planned)
	return planned[0], true
}

// sortSprintsByRank is the `position, id` order — ranks are not unique
// (rank.go), so the id is the tiebreak that keeps the CLI and the app agreeing.
func sortSprintsByRank(sprints []sprint) {
	sort.SliceStable(sprints, func(i, j int) bool {
		if sprints[i].Position != sprints[j].Position {
			return sprints[i].Position < sprints[j].Position
		}
		return sprints[i].ID < sprints[j].ID
	})
}

// sprintFromFlags resolves `<sprint>` against --board, or as a bare id when no
// board is given — the one form that needs no board to be unambiguous.
func sprintFromFlags(ctx context.Context, c *client.Client, boardRef, ref string) (sprint, project, error) {
	if boardRef != "" {
		p, err := resolveProject(ctx, c, boardRef)
		if err != nil {
			return sprint{}, project{}, err
		}
		s, err := resolveSprint(ctx, c, p.ID, ref)
		return s, p, err
	}
	s, err := client.GetRecord[sprint](ctx, c, sprintsCollection, strings.TrimSpace(ref))
	if err != nil {
		return sprint{}, project{}, fmt.Errorf("sprint %q: %w (pass --board to name one by number, `active` or `next`)", ref, err)
	}
	p, err := resolveProject(ctx, c, s.Project)
	return s, p, err
}

func sprintRows(sprints []sprint) [][]string {
	rows := make([][]string, 0, len(sprints))
	for _, s := range sprints {
		rows = append(rows, []string{
			strconv.Itoa(s.Number), s.Name, s.State, dayCell(s.Start), dayCell(s.End),
			fmt.Sprintf("%d/%d", s.CardDone, s.CardTotal), pointsCell(s), s.ID,
		})
	}
	return rows
}

var sprintHeaders = []string{"NUMBER", "NAME", "STATE", "START", "END", "CARDS", "POINTS", "ID"}

// pointsCell is "done/total" in points, or "-" on a board that does not
// estimate — the same fallback the section header makes.
func pointsCell(s sprint) string {
	if s.PointsTotal == 0 {
		return "-"
	}
	return fmt.Sprintf("%d/%d", s.PointsDone, s.PointsTotal)
}

func newSprintListCmd(c *client.Client) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list <board>",
		Short: "List a board's sprints",
		Args:  cobra.ExactArgs(1),
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
			sprints, err := projectSprints(ctx, c, p.ID)
			if err != nil {
				return err
			}
			return o.Write(cmd.OutOrStdout(), sprintHeaders, sprintRows(sprints), sprints)
		},
	}
	return cmd
}

func newSprintViewCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:     "view <sprint>",
		Short:   "Show a sprint and its cards",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"show"},
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			s, p, err := sprintFromFlags(ctx, c, boardRef, args[0])
			if err != nil {
				return err
			}
			cards, err := sprintCards(ctx, c, p.ID, s.ID)
			if err != nil {
				return err
			}
			detail := struct {
				sprint `json:",inline"`
				Cards  []card `json:"cards"`
			}{sprint: s, Cards: cards}
			if o.Format == output.JSON {
				return o.Write(cmd.OutOrStdout(), nil, nil, detail)
			}
			rows := [][]string{
				{"Sprint", s.label()},
				{"State", s.State},
				{"Dates", dateRange(s)},
				{"Goal", s.Goal},
				{"Cards", fmt.Sprintf("%d/%d done", s.CardDone, s.CardTotal)},
				{"Points", pointsCell(s)},
				{"ID", s.ID},
			}
			// Only once stamped, as `card view` appends Priority.
			if s.State != "planned" {
				rows = append(rows, []string{"Committed", fmt.Sprintf("%d cards · %d points", s.CommittedCount, s.CommittedPoints)})
			}
			if s.State == "completed" {
				rows = append(rows, []string{"Completed",
					fmt.Sprintf("%d cards · %d points · %d rolled over", s.CompletedCount, s.CompletedPoints, s.RolledCount)})
			}
			for _, cd := range cards {
				rows = append(rows, []string{"card", formatCardKey(p.Slug, cd.Number) + " " + cd.Title})
			}
			return o.Write(cmd.OutOrStdout(), []string{"FIELD", "VALUE"}, rows, detail)
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

// sprintCards reads a sprint's live cards in board order.
func sprintCards(ctx context.Context, c *client.Client, projectID, sprintID string) ([]card, error) {
	byList, err := cardsByList(ctx, c, projectID, false)
	if err != nil {
		return nil, err
	}
	var out []card
	for _, cards := range byList {
		for _, cd := range cards {
			if cd.Sprint == sprintID {
				out = append(out, cd)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].List != out[j].List {
			return out[i].List < out[j].List
		}
		if out[i].Position != out[j].Position {
			return out[i].Position < out[j].Position
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func dateRange(s sprint) string {
	if s.Start == "" && s.End == "" {
		return "-"
	}
	return dayCell(s.Start) + " → " + dayCell(s.End)
}

func newSprintCreateCmd(c *client.Client) *cobra.Command {
	var boardRef, name, goal, start, end string
	cmd := &cobra.Command{
		Use:   "create",
		Short: "Plan a new sprint",
		Long: "Plan a new sprint.\n\n" +
			"It is numbered by the server and lands after the board's other planned\n" +
			"sprints. Dates are optional until it starts.",
		Args: cobra.NoArgs,
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
			startValue, err := parseDay("--start", start)
			if err != nil {
				return err
			}
			endValue, err := parseDay("--end", end)
			if err != nil {
				return err
			}
			if startValue != "" && endValue != "" && endValue < startValue {
				return fmt.Errorf("--end cannot be before --start")
			}
			sprints, err := projectSprints(ctx, c, p.ID)
			if err != nil {
				return err
			}
			position, err := rankForAppend(plannedPositions(sprints))
			if err != nil {
				return err
			}
			userID, err := c.UserID(ctx)
			if err != nil {
				return err
			}
			// `number` is deliberately absent: server/sprint_number.go assigns
			// it, as card_number.go does for cards.
			created, err := client.CreateRecord[sprint](ctx, c, sprintsCollection, map[string]any{
				"project":    p.ID,
				"name":       name,
				"goal":       goal,
				"start":      startValue,
				"end":        endValue,
				"state":      "planned",
				"position":   position,
				"created_by": userID,
			})
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "planned %s on %s", created.label(), p.Name)
			return writeSprintResult(cmd, o, created)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVar(&name, "name", "", "a name (default: \"Sprint N\")")
	cmd.Flags().StringVar(&goal, "goal", "", "what the sprint is for")
	cmd.Flags().StringVar(&start, "start", "", "first day as YYYY-MM-DD")
	cmd.Flags().StringVar(&end, "end", "", "last day as YYYY-MM-DD")
	return cmd
}

// plannedPositions is the sorted rank list of a board's planned sprints, the
// space a new one appends to.
func plannedPositions(sprints []sprint) []string {
	var planned []sprint
	for _, s := range sprints {
		if s.State == "planned" {
			planned = append(planned, s)
		}
	}
	sortSprintsByRank(planned)
	positions := make([]string, len(planned))
	for i, s := range planned {
		positions[i] = s.Position
	}
	return positions
}

func newSprintEditCmd(c *client.Client) *cobra.Command {
	var boardRef, name, goal, start, end string
	var clearStart, clearEnd bool
	cmd := &cobra.Command{
		Use:   "edit <sprint>",
		Short: "Change a sprint's name, goal or dates",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			body := map[string]any{}
			if cmd.Flags().Changed("name") {
				body["name"] = name
			}
			if cmd.Flags().Changed("goal") {
				body["goal"] = goal
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
			switch {
			case clearEnd && cmd.Flags().Changed("end"):
				return fmt.Errorf("--end and --clear-end contradict each other")
			case clearEnd:
				body["end"] = ""
			case cmd.Flags().Changed("end"):
				v, err := parseDay("--end", end)
				if err != nil {
					return err
				}
				body["end"] = v
			}
			if len(body) == 0 {
				return fmt.Errorf("nothing to change — pass --name, --goal, --start, --clear-start, --end, or --clear-end")
			}
			s, _, err := sprintFromFlags(ctx, c, boardRef, args[0])
			if err != nil {
				return err
			}
			updated, err := client.UpdateRecord[sprint](ctx, c, sprintsCollection, s.ID, body)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "updated %s", updated.label())
			return writeSprintResult(cmd, o, updated)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVar(&name, "name", "", "new name (\"\" falls back to \"Sprint N\")")
	cmd.Flags().StringVar(&goal, "goal", "", "new goal")
	cmd.Flags().StringVar(&start, "start", "", "first day as YYYY-MM-DD")
	cmd.Flags().BoolVar(&clearStart, "clear-start", false, "remove the first day (planned sprints only)")
	cmd.Flags().StringVar(&end, "end", "", "last day as YYYY-MM-DD")
	cmd.Flags().BoolVar(&clearEnd, "clear-end", false, "remove the last day (planned sprints only)")
	return cmd
}

func newSprintStartCmd(c *client.Client) *cobra.Command {
	var boardRef, name, goal, start, end string
	cmd := &cobra.Command{
		Use:   "start <sprint>",
		Short: "Start a planned sprint",
		Long: "Start a planned sprint.\n\n" +
			"The cards in it become its commitment. Undated, it runs from today for\n" +
			"the board's sprint length; pass --start and --end to say otherwise.\n" +
			"Only one sprint runs at a time.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			startValue, err := parseDay("--start", start)
			if err != nil {
				return err
			}
			endValue, err := parseDay("--end", end)
			if err != nil {
				return err
			}
			s, p, err := sprintFromFlags(ctx, c, boardRef, args[0])
			if err != nil {
				return err
			}
			var started sprint
			err = c.PostJSON(ctx, "/api/boards/sprints/"+s.ID+"/start", map[string]any{
				"start": startValue,
				"end":   endValue,
				"name":  name,
				"goal":  goal,
			}, &started)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "started %s on %s (%s): committed to %d %s, %d points",
				started.label(), p.Name, dateRange(started),
				started.CommittedCount, pluralize(started.CommittedCount, "card", "cards"), started.CommittedPoints)
			return writeSprintResult(cmd, o, started)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVar(&name, "name", "", "rename as it starts")
	cmd.Flags().StringVar(&goal, "goal", "", "set the goal as it starts")
	cmd.Flags().StringVar(&start, "start", "", "first day as YYYY-MM-DD (default: today, or the sprint's own)")
	cmd.Flags().StringVar(&end, "end", "", "last day as YYYY-MM-DD (default: the board's sprint length)")
	return cmd
}

// rolloverTargets is the server's vocabulary for where unfinished cards go.
var rolloverTargets = []string{"next", "new", "backlog"}

func newSprintCompleteCmd(c *client.Client) *cobra.Command {
	var boardRef, unfinished, nextRef string
	cmd := &cobra.Command{
		Use:   "complete <sprint>",
		Short: "Complete the active sprint (--unfinished next|new|backlog)",
		Long: "Complete the active sprint.\n\n" +
			"Cards in a Done or Canceled list stay in it as its record. Every other\n" +
			"card is unfinished and has to go somewhere: --unfinished next moves\n" +
			"them to the next planned sprint (--next picks which), new plans a\n" +
			"following sprint for them, backlog unfiles them. There is no default:\n" +
			"the server refuses to guess, and a sprint with nothing unfinished\n" +
			"needs no answer.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			if unfinished != "" && !contains(rolloverTargets, unfinished) {
				return fmt.Errorf("--unfinished %q is not one of %s", unfinished, strings.Join(rolloverTargets, ", "))
			}
			if nextRef != "" && unfinished != "next" {
				return fmt.Errorf("--next only applies with --unfinished next")
			}
			ctx := cmd.Context()
			s, p, err := sprintFromFlags(ctx, c, boardRef, args[0])
			if err != nil {
				return err
			}
			nextID := ""
			if unfinished == "next" {
				ref := nextRef
				if ref == "" {
					ref = "next"
				}
				next, err := resolveSprint(ctx, c, p.ID, ref)
				if err != nil {
					return err
				}
				if next.State != "planned" {
					return fmt.Errorf("%s is %s, not planned", next.label(), next.State)
				}
				nextID = next.ID
			}
			var result struct {
				Sprint          sprint `json:"sprint"`
				CompletedCount  int    `json:"completed_count"`
				CompletedPoints int    `json:"completed_points"`
				RolledCount     int    `json:"rolled_count"`
				TargetSprint    string `json:"target_sprint"`
				CreatedSprint   bool   `json:"created_sprint"`
			}
			err = c.PostJSON(ctx, "/api/boards/sprints/"+s.ID+"/complete", map[string]any{
				"unfinished":  unfinished,
				"next_sprint": nextID,
			}, &result)
			if err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "completed %s on %s: %d %s done, %d points",
				result.Sprint.label(), p.Name, result.CompletedCount,
				pluralize(result.CompletedCount, "card", "cards"), result.CompletedPoints)
			if result.RolledCount > 0 {
				o.Info(cmd.ErrOrStderr(), "moved %d unfinished %s to %s", result.RolledCount,
					pluralize(result.RolledCount, "card", "cards"), rolloverDestination(ctx, c, result.TargetSprint, result.CreatedSprint))
			}
			return o.Write(cmd.OutOrStdout(), sprintHeaders, sprintRows([]sprint{result.Sprint}), result)
		},
	}
	addBoardFlag(cmd, &boardRef)
	cmd.Flags().StringVar(&unfinished, "unfinished", "",
		"where unfinished cards go: "+strings.Join(rolloverTargets, ", ")+" (required when there are any)")
	cmd.Flags().StringVar(&nextRef, "next", "", "with --unfinished next, the planned sprint to move them to (default: the next one)")
	return cmd
}

// rolloverDestination names where the unfinished cards went, for the
// narration. The created or chosen sprint is read back so the label is the
// server's, not a guess.
func rolloverDestination(ctx context.Context, c *client.Client, targetID string, created bool) string {
	if targetID == "" {
		return "the backlog"
	}
	target, err := client.GetRecord[sprint](ctx, c, sprintsCollection, targetID)
	if err != nil {
		return "the next sprint"
	}
	if created {
		return "a new " + target.label()
	}
	return target.label()
}

func newSprintDeleteCmd(c *client.Client) *cobra.Command {
	var boardRef string
	cmd := &cobra.Command{
		Use:     "delete <sprint>",
		Short:   "Delete a sprint; its cards return to the backlog",
		Aliases: []string{"rm", "remove"},
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			o, yes, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()
			s, p, err := sprintFromFlags(ctx, c, boardRef, args[0])
			if err != nil {
				return err
			}
			question := fmt.Sprintf("Delete %s on %q? Its %d %s stay on the board and return to the backlog",
				s.label(), p.Name, s.CardTotal, pluralize(s.CardTotal, "card", "cards"))
			ok, err := ui.Confirm(o, yes, cmd.InOrStdin(), cmd.ErrOrStderr(), question)
			if err != nil {
				return fmt.Errorf("%s: %w", question, err)
			}
			if !ok {
				return nil
			}
			if err := client.DeleteRecord(ctx, c, sprintsCollection, s.ID); err != nil {
				return err
			}
			o.Info(cmd.ErrOrStderr(), "deleted %s", s.label())
			return nil
		},
	}
	addBoardFlag(cmd, &boardRef)
	return cmd
}

// writeSprintResult is writeCardResult's shape for a sprint mutation.
func writeSprintResult(cmd *cobra.Command, o output.Options, s sprint) error {
	switch o.Format {
	case output.Table:
		return nil
	case output.CSV:
		return o.Write(cmd.OutOrStdout(), sprintHeaders, sprintRows([]sprint{s}), s)
	default:
		return o.Write(cmd.OutOrStdout(), nil, nil, s)
	}
}

func pluralize(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func contains(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}
