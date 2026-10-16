package boards

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/forms"
	"tinycld.org/core/html"
	"tinycld.org/core/markdown"
)

// customFieldsText is what of a card's custom values a search can find: text,
// textarea, markdown and rich text as the words a reader sees, and the labels
// of chosen select options. Keys, ids and numbers are not words anyone
// searches for. The type is read per call; the sync runs once per write, so
// the lookup is cheap enough.
//
// Markdown and HTML are reduced to their text through the editor's document
// rather than tag-stripped, so neither `**` nor `&amp;` reaches the index.
func customFieldsText(app core.App) func(*core.Record) string {
	return func(record *core.Record) string {
		def := newFormCache(app).definition(record.GetString("form"))
		if def == nil {
			return ""
		}
		fields, err := cardFields(record)
		if err != nil {
			// The card is still indexed by its own columns; only its custom
			// values are missing from search until the next good write.
			activityLog.Warn("unreadable custom fields; not indexed for search",
				"cardID", record.Id, "err", err)
			return ""
		}
		var parts []string
		for i := range def.Fields {
			f := &def.Fields[i]
			if text := fieldText(f, fields[f.Key]); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, " ")
	}
}

// fieldText renders one custom value as searchable words.
func fieldText(f *forms.Field, value any) string {
	switch f.Kind {
	case "text", "textarea":
		s, _ := value.(string)
		return s
	case "markdown":
		s, _ := value.(string)
		return plainText(markdown.ToPM(s))
	case "richtext":
		s, _ := value.(string)
		return plainText(html.ToPM(s))
	case "select":
		return optionLabels(f, value)
	}
	return ""
}

// optionLabels names the chosen options. A value no option carries is left
// out: its raw value is a key, not a word.
func optionLabels(f *forms.Field, value any) string {
	var chosen []string
	switch v := value.(type) {
	case string:
		chosen = []string{v}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				chosen = append(chosen, s)
			}
		}
	}
	var labels []string
	for _, c := range chosen {
		for _, o := range f.Options {
			if o.Value == c {
				labels = append(labels, o.Label)
				break
			}
		}
	}
	return strings.Join(labels, " ")
}

// plainText is a document's text, with blocks and inline atoms separated by
// spaces so words on either side of a boundary stay apart.
func plainText(doc *markdown.PMNode) string {
	var b strings.Builder
	var walk func(n *markdown.PMNode)
	walk = func(n *markdown.PMNode) {
		if n.Type == markdown.NodeText {
			b.WriteString(n.Text)
			return
		}
		b.WriteByte(' ')
		for i := range n.Content {
			walk(&n.Content[i])
		}
		b.WriteByte(' ')
	}
	walk(doc)
	return strings.Join(strings.Fields(b.String()), " ")
}
