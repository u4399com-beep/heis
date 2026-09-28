package crawl

import (
	"strings"
	"testing"
)

// R98-B BUG-279 verify: FieldConst in HTML mode now evaluates template.
func TestBUG279_FieldConstHTMLMode_ParseList(t *testing.T) {
	// HTML page with a single link containing bookId in href.
	html := `<html><body><a href="/b/12345.html">book</a></body></html>`
	// list.fields.bookUrl = const "{q.bookId}" — but q.bookId won't be in URLVars
	// (no query param). Use a const that references path segment instead.
	// list with no itemSelector = no-container path (single item from page).
	rule := PageRule{
		Enabled: true,
		Fields: PageFields{
			"bookUrl": FieldRule{
				Type:       FieldConst,
				Expression: "https://example.com/c/{path.0}.html",
			},
		},
	}
	// baseURL path = /b/12345.html → URLVars path = "0=b\n1=12345.html"
	// {path.0} should resolve to "b".
	res := ParseList(html, "https://example.com/b/12345.html", rule, []string{"bookUrl"})
	if len(res.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(res.Items))
	}
	got := res.Items[0].Fields["bookUrl"]
	want := "https://example.com/c/b.html"
	if got != want {
		t.Fatalf("FieldConst HTML mode: got %q, want %q (BUG-279: was empty before fix)", got, want)
	}
}

func TestBUG279_FieldConstHTMLMode_ParseToc(t *testing.T) {
	// HTML toc page with 2 chapter links.
	html := `<html><body><ul><li><a href="/c/1.html">ch1</a></li><li><a href="/c/2.html">ch2</a></li></ul></body></html>`
	rule := PageRule{
		Enabled: true,
		ItemSelector: &FieldRule{
			Type:       FieldCSS,
			Expression: "ul li",
		},
		Fields: PageFields{
			"title": FieldRule{Type: FieldCSS, Expression: "a"},
			"url":   FieldRule{Type: FieldCSS, Expression: "a", Attr: "href"},
			"volume": FieldRule{
				Type:       FieldConst,
				Expression: "vol-{index}-{path.0}",
			},
		},
	}
	res, err := ParseToc(nil, "https://example.com/b/123.html", html, rule, nil, nil)
	if err != nil {
		t.Fatalf("ParseToc error: %v", err)
	}
	if len(res.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(res.Items))
	}
	// First item: index=1, path.0 = "b" (from /b/123.html)
	// volume = "vol-1-b"
	vol1 := res.Items[0].Volume
	want1 := "vol-1-b"
	if vol1 != want1 {
		t.Fatalf("item 0 volume: got %q, want %q (BUG-279: was empty before fix)", vol1, want1)
	}
	vol2 := res.Items[1].Volume
	want2 := "vol-2-b"
	if vol2 != want2 {
		t.Fatalf("item 1 volume: got %q, want %q (BUG-279: was empty before fix)", vol2, want2)
	}
}

// Verify the propagation: vol const references {url} which is also extracted.
func TestBUG279_FieldConstHTMLMode_ParseToc_Propagation(t *testing.T) {
	html := `<html><body><ul><li><a href="/c/1.html">ch1</a></li></ul></body></html>`
	rule := PageRule{
		Enabled: true,
		ItemSelector: &FieldRule{
			Type:       FieldCSS,
			Expression: "ul li",
		},
		Fields: PageFields{
			"title": FieldRule{Type: FieldCSS, Expression: "a"},
			"url":   FieldRule{Type: FieldCSS, Expression: "a", Attr: "href"},
			"volume": FieldRule{
				Type:       FieldConst,
				Expression: "ref:{url}",
			},
		},
	}
	res, err := ParseToc(nil, "https://example.com/b/123.html", html, rule, nil, nil)
	if err != nil {
		t.Fatalf("ParseToc error: %v", err)
	}
	if len(res.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(res.Items))
	}
	// url is absolutized to https://example.com/c/1.html
	// volume = "ref:https://example.com/c/1.html"
	vol := res.Items[0].Volume
	if !strings.HasPrefix(vol, "ref:") {
		t.Fatalf("volume should start with 'ref:', got %q (BUG-279 propagation: was empty before fix)", vol)
	}
}
