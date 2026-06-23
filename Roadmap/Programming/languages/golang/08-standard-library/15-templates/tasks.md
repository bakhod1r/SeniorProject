# 8.15 `text/template` and `html/template` — Tasks

> Twelve exercises in increasing difficulty. Most expect the standard
> library only; a few stretch into `embed`, `io/fs`, and `net/http`.
> Solutions deliberately not provided — try, then compare with the
> corresponding section of the leaf docs.

## Task 1 — Hello, `html/template`

Write a program that:

1. Defines an inline `html/template` with the body `<p>Hello, {{.Name}}.</p>`.
2. Calls `Execute` against `os.Stdout` with `Name: "<script>x</script>"`.
3. Verifies (in a test, with `bytes.Buffer`) that the output contains
   `&lt;script&gt;` and not `<script>`.

Then change the import to `text/template` and observe the failure.
This is the textbook XSS demonstration.

## Task 2 — A `cat`-like template renderer

Write a CLI that takes a template file path and a JSON file path,
parses the template (`text/template`), unmarshals the JSON into a
`map[string]any`, and renders the result to stdout.

```
$ render tmpl.txt data.json > out.txt
```

Requirements:

- Use `os.ReadFile` for both inputs.
- Set `missingkey=error` and propagate the error to the user.
- Exit code 1 with a useful message on any failure.

## Task 3 — Email composer

Build an email composer with `text/template`:

```go
type Email struct {
    To       string
    From     string
    Subject  string
    Body     string // template source
    Data     any
}
```

`Compose(e Email) (subject, body string, err error)` parses
`e.Subject` and `e.Body` independently, executes both against
`e.Data`, and returns the rendered strings.

Bonus: support a custom `dateFormat` function.

## Task 4 — A simple HTTP page renderer

Write a server that serves three pages (`/`, `/about`, `/contact`)
from `html/template` files in `templates/pages/`. Use a single
`base.html` layout with `{{block "title"}}` and `{{block "content"}}`.

Requirements:

- Render-to-buffer-first.
- `Content-Type: text/html; charset=utf-8` and `X-Content-Type-Options: nosniff`.
- Parse all templates at startup with `template.Must`.
- Set `Option("missingkey=error")`.

## Task 5 — `embed.FS` migration

Take the result of Task 4 and switch from disk-loading to
`embed.FS`:

```go
//go:embed templates
var templatesFS embed.FS
```

Use `template.ParseFS(templatesFS, ...)`. Verify that the binary
runs after `go build` from any directory (no relative path
dependency).

## Task 6 — Hot reload toggle

Extend Task 5 with a `--dev` flag. When set, templates are loaded
from `os.DirFS("./templates")` and re-parsed on every request. When
not set, they are loaded from `embed.FS` and parsed once at
startup. Same renderer code path; differ only in the `fs.FS` and
the cache flag.

Bonus: in dev mode, watch the directory with `fsnotify` and reparse
only when files change.

## Task 7 — A FuncMap with an audit trail

Build a FuncMap that includes:

- `upper(string) string` → `strings.ToUpper`
- `humanize(int64) string` → "1.5 KB", "3.2 MB", etc.
- `fmtTime(time.Time) string` → `"2006-01-02 15:04"`
- `default(string, string) string` → second arg if first is `""`
- `safeHTML(string) template.HTML` → marks input as trusted

The last one is the audit point. Place a `// SAFETY: ...` comment
explaining why callers can trust it (or, if they can't, when not to
use it).

Add a unit test that renders a template using each function and
asserts the output.

## Task 8 — Determinism test

Given a `map[string]string` data input with keys `"b": "B", "a": "A"`,
write a template:

```
{{range $k, $v := .}}{{$k}}={{$v}};{{end}}
```

Assert the output is `a=A;b=B;` deterministically across 100
executions in a row, on the same template, with the same data. This
verifies the lexical-key-order guarantee.

## Task 9 — `<no value>` detector

Write a helper `RenderStrict(t *template.Template, data any)
(string, error)` that:

1. Renders into a buffer.
2. After execution, scans the output for the literal substring
   `<no value>` and returns an error if found.

This is a belt-and-suspenders check on top of `missingkey=error` —
it catches sources of `<no value>` other than missing map keys.

## Task 10 — Layout with sub-templates

Build the following template set:

- `base.html` — layout with `{{block "title"}}`, `{{block "head"}}`,
  `{{block "content"}}`, `{{block "footer"}}`.
- `partials/nav.html` — nav bar (defines template `nav`).
- `partials/footer.html` — defines template `footer-content`.
- `pages/home.html` — defines `title`, `content` (uses
  `{{template "nav" .}}`).
- `pages/about.html` — defines `title`, `content`, and overrides
  `head` with a custom meta tag.

Render both pages from one Go program. Assert the about page's
output contains the custom meta and the home page's does not.

## Task 11 — Streaming NDJSON with `text/template`

Write a CSV-like exporter that, given `iter.Seq[Row]`, streams
each row through a `text/template`:

```
{{.ID}},{{.Name}},{{.CreatedAt.Format "2006-01-02"}}{{println}}
```

into an `io.Writer`. Use `bufio.Writer` between the template and
the underlying writer; remember to `Flush`.

Test: pass 100k rows and verify peak memory stays bounded
(use `runtime.MemStats` before and after).

## Task 12 — XSS fuzzer

Write a fuzz test for a `html/template` of your choosing:

```go
func FuzzRender(f *testing.F) {
    f.Add("benign")
    f.Fuzz(func(t *testing.T, s string) {
        var buf bytes.Buffer
        if err := tmpl.Execute(&buf, struct{ X string }{s}); err != nil {
            return
        }
        out := strings.ToLower(buf.String())
        for _, danger := range []string{"<script", "javascript:", " onerror=", " onclick="} {
            if strings.Contains(out, danger) {
                t.Fatalf("escape failed for %q: %q", s, out)
            }
        }
    })
}
```

Run for a minute (`-fuzz=. -fuzztime=1m`). Confirm no failures, then
deliberately replace the `string` field with `template.HTML` and
verify the fuzz catches the bug.

## Stretch tasks

### S1 — A markdown-to-HTML pipeline with sanitization

Wire `goldmark` (or any Markdown library) to produce HTML from
user-supplied Markdown, then run it through `bluemonday` (or another
sanitizer) before wrapping as `template.HTML`. Add a test that an
attempted XSS via Markdown (`[click](javascript:x)`) is neutralized.

### S2 — Custom delimiters for a JS-templating context

Use `Delims("[[", "]]")` to render a `text/template` whose output
contains literal `{{` and `}}` (e.g., a Vue.js template you're
generating with Go). Verify the output is byte-equal to the
expected.

### S3 — Inline render vs buffered render benchmark

Benchmark two render strategies: streaming directly to
`io.Discard` vs render to `bytes.Buffer` then `WriteTo`. Use a
moderately complex `html/template` with a 50-row range. Report
allocs/op for both.

### S4 — Plug a render trace into OpenTelemetry

Wrap your `Render` method to start an OTel span with the template
name, recording duration as an attribute and recording an exception
on error. Verify the spans appear in your collector or in
`tracetest`.

### S5 — Build a `precompile` tool

Write a `go run ./cmd/precompile` that walks a templates directory,
parses every file, and reports parse errors. Wire it into CI as a
guard before build, so a typo in a template fails the pipeline at
compile-time, not deploy-time.

## Self-check

After working through these:

- You know which package to import for which output.
- You can build a layout with `block`/`define` from scratch.
- You can wire `embed.FS` and `os.DirFS` to the same renderer.
- You can write a goldenfile + fuzz test for the auto-escaper.
- You can audit a codebase for unsafe `template.HTML(...)` calls.
- You know the cost of `text/template` for HTML output (one XSS
  ticket, minimum).

If any of these are still fuzzy, re-read the corresponding section
in [middle.md](middle.md) or [senior.md](senior.md).
