package crawl

import (
	"testing"
)

// ParseList container path with FieldConst field (itemSelector = FieldCSS).
func TestBUG279_ParseList_Container(t *testing.T) {
	html := `<html><body><ul><li><a href="/b/1.html">book1</a></li><li><a href="/b/2.html">book2</a></li></ul></body></html>`
	rule := PageRule{
		Enabled: true,
		ItemSelector: &FieldRule{
			Type:       FieldCSS,
			Expression: "ul li",
		},
		Fields: PageFields{
			"name": FieldRule{Type: FieldCSS, Expression: "a"},
			"url":  FieldRule{Type: FieldCSS, Expression: "a", Attr: "href"},
			"tag": FieldRule{
				Type:       FieldConst,
				Expression: "item-{index}-{path.0}",
			},
		},
	}
	res := ParseList(html, "https://example.com/list/1.html", rule, []string{"url"})
	if len(res.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(res.Items))
	}
	// path from /list/1.html → segs = ["", "list", "1.html"] → path.0 = "list"
	// item 0: index=1, tag = "item-1-list"
	// item 1: index=2, tag = "item-2-list"
	tag0 := res.Items[0].Fields["tag"]
	if tag0 != "item-1-list" {
		t.Fatalf("item 0 tag: got %q, want %q", tag0, "item-1-list")
	}
	tag1 := res.Items[1].Fields["tag"]
	if tag1 != "item-2-list" {
		t.Fatalf("item 1 tag: got %q, want %q", tag1, "item-2-list")
	}
}
