package boards

import (
	"encoding/json"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/forms"
)

// cardFormHost is the forms host a card's type belongs to. Must match
// CARD_HOST_KEY in tinycld/boards/forms/hosts.ts.
const cardFormHost = "boards:card"

// formCache reads card types for one pass over a board. A board's cards share
// a handful of types, so a seed loads each one once rather than once per card.
// A cache lives for one pass only and is never kept between them: it has no
// invalidation, so a longer-lived one would serve a type edited since.
type formCache struct {
	app  core.App
	defs map[string]*forms.Definition
}

func newFormCache(app core.App) *formCache {
	return &formCache{app: app, defs: map[string]*forms.Definition{}}
}

// definition returns a card type's parsed definition, or nil when the card has
// no type or its type cannot be read. A missing or unreadable type means the
// card has no custom fields, never a failed pass: a board's persistence must
// not stall on one card's type.
func (c *formCache) definition(formID string) *forms.Definition {
	if formID == "" {
		return nil
	}
	if def, seen := c.defs[formID]; seen {
		return def
	}
	c.defs[formID] = c.load(formID)
	return c.defs[formID]
}

func (c *formCache) load(formID string) *forms.Definition {
	record, err := c.app.FindRecordById("forms", formID)
	if err != nil {
		activityLog.Debug("a card names a type that no longer exists", "formID", formID)
		return nil
	}
	// The relation names any forms row; only a card type describes a card.
	if record.GetString("host") != cardFormHost {
		activityLog.Warn("a card's type belongs to another host",
			"formID", formID, "host", record.GetString("host"))
		return nil
	}
	def, err := forms.ParseDefinition([]byte(record.GetString("definition")))
	if err != nil {
		activityLog.Warn("could not read a card type's definition", "formID", formID, "err", err)
		return nil
	}
	return def
}

// collabField is how a collaborative field of a card type is persisted: the
// format its fragment carries and the most runes its value may hold.
type collabField struct {
	format   string
	maxRunes int
}

// collaborativeKeys maps each collaborative field of a card type to how it is
// persisted.
//
// maxRunes is the field's own maxLength when it has a tighter one than the
// editor's limit: the host's write gate rejects a longer value, and a rejected
// save fails the board's flush on every retry, stranding every fragment the
// walk had not reached yet.
func (c *formCache) collaborativeKeys(formID string) map[string]collabField {
	def := c.definition(formID)
	if def == nil {
		return nil
	}
	keys := map[string]collabField{}
	for _, f := range def.Fields {
		if !f.Collaborative {
			continue
		}
		field := collabField{maxRunes: descriptionRuneLimit}
		switch f.Kind {
		case "markdown":
			field.format = formatMarkdown
		case "richtext":
			field.format = formatHTML
		default:
			continue
		}
		if f.MaxLength != nil && *f.MaxLength < field.maxRunes {
			field.maxRunes = max(*f.MaxLength, 0)
		}
		keys[f.Key] = field
	}
	return keys
}

// cardFields decodes a card's custom values. A card that never had any reads
// as an empty map, so a caller can merge into it.
func cardFields(record *core.Record) (map[string]any, error) {
	raw, err := json.Marshal(record.Get("fields"))
	if err != nil {
		return nil, err
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		fields = map[string]any{}
	}
	return fields, nil
}
