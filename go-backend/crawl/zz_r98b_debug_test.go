package crawl

import (
	"fmt"
	"testing"
)

func TestBUG279Debug(t *testing.T) {
	html := `<html><body><a href="/b/12345.html">book</a></body></html>`
	rule := PageRule{
		Enabled: true,
		Fields: PageFields{
			"bookUrl": FieldRule{
				Type:       FieldConst,
				Expression: "https://example.com/c/{path.0}.html",
			},
		},
	}
	// First test URLVars directly
	vars := URLVars("https://example.com/b/12345.html")
	fmt.Printf("URLVars: %+v\n", vars)
	fmt.Printf("vars['path'] = %q\n", vars["path"])
	
	// Test applyConstTemplate directly
	result := applyConstTemplate("https://example.com/c/{path.0}.html", vars)
	fmt.Printf("applyConstTemplate result: %q\n", result)
	
	res := ParseList(html, "https://example.com/b/12345.html", rule, []string{"bookUrl"})
	fmt.Printf("ParseList items: %d\n", len(res.Items))
	if len(res.Items) > 0 {
		fmt.Printf("Item 0 fields: %+v\n", res.Items[0].Fields)
	}
}
