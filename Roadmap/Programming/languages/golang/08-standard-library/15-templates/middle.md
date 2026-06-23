# 8.15 `text/template` and `html/template` — Middle

> **Audience.** You're past [junior.md](junior.md). You can wire up an
> HTTP handler that renders a page and you understand why
> `html/template` is the default. This file covers the structure of a
> real template set: layouts, partials, blocks, FuncMap design,
> embedding via `io/fs`, and the half-dozen options that make templates
> reliable in production.

## 1. The template *set* mental model

A `*template.Template` is not a single template — it is a **set**.
Every `Parse` call adds entries to the set, indexed by name. The
"default" entry is the one whose name matches the value the set was
created with (`New("name")` or the basename of the first parsed
file).

```go
t := template.New("root")               // empty set, default name "root"
t, _ = t.Parse(`{{define "a"}}A{{end}}`) // adds "a", root still empty body
t, _ = t.Parse(`{{define "b"}}B{{end}}`) // adds "b"
t.ExecuteTemplate(os.Stdout, "a", nil)   // -> A
t.ExecuteTemplate(os.Stdout, "b", nil)   // -> B
```

Entries in the set can `{{template "other" .}}` each other freely —
that's how layouts work. You can list the entries:

```go
for _, e := range t.Templates() {
    fmt.Println(e.Name())
}
```

And look one up by name:

```go
content := t.Lookup("content")
if content == nil {
    return fmt.Errorf("no content template")
}
```

`Lookup` returns `nil` when the name isn't in the set — useful for
optional partials.

## 2. `define`, `template`, `block`

Three actions structure templates:

| Action | Effect |
|--------|--------|
| `{{define "name"}} ... {{end}}` | Declare a named template (in the current set) |
| `{{template "name" .}}` | Invoke a template, passing the current dot |
| `{{template "name" data}}` | Invoke a template, passing an explicit value |
| `{{block "name" .}} ... {{end}}` | Define **and** invoke in one stroke; can be overridden by a later `define` of the same name |

`block` is the Jinja-style "default body, override later" mechanism.
A base layout uses `block` for parts that pages can override:

```html
<!-- base.html -->
<!doctype html>
<html>
<head><title>{{block "title" .}}Default{{end}}</title></head>
<body>
  {{block "content" .}}<p>No content.</p>{{end}}
</body>
</html>
```

Pages override by `define`-ing the same name in the same set:

```html
<!-- page.html -->
{{define "title"}}Welcome — {{.Name}}{{end}}

{{define "content"}}
  <h1>Hello, {{.Name}}.</h1>
{{end}}
```

Render order:

```go
t, err := template.ParseFiles("base.html", "page.html")
if err != nil { return err }
err = t.ExecuteTemplate(w, "base.html", data)
```

When `base.html` hits `{{block "title" .}}`, the engine looks up
`"title"` in the current set. If a later parsed file has
`{{define "title"}}`, that wins. If not, the body inside the `block`
is the default. Same for `"content"`.

This is the canonical layout pattern in Go web apps. One base
template, N pages, each defining the blocks it cares about.

## 3. Layouts in practice: the full pattern

A typical `templates/` tree:

```
templates/
  layouts/
    base.html
  partials/
    header.html
    footer.html
  pages/
    home.html
    user.html
```

`base.html`:
```html
<!doctype html>
<html>
<head>
  <title>{{block "title" .}}Site{{end}}</title>
</head>
<body>
  {{template "header" .}}
  <main>{{block "content" .}}{{end}}</main>
  {{template "footer" .}}
</body>
</html>
```

`partials/header.html`:
```html
{{define "header"}}
  <header>...</header>
{{end}}
```

`pages/home.html`:
```html
{{define "title"}}Home{{end}}
{{define "content"}}<h1>Welcome</h1>{{end}}
```

The wiring helper:

```go
func renderer(fsys fs.FS) (map[string]*template.Template, error) {
    pages, err := fs.Glob(fsys, "pages/*.html")
    if err != nil {
        return nil, err
    }
    out := make(map[string]*template.Template, len(pages))
    for _, p := range pages {
        // Each page gets its own set built from base + partials + page.
        files := []string{"layouts/base.html"}
        partials, _ := fs.Glob(fsys, "partials/*.html")
        files = append(files, partials...)
        files = append(files, p)

        t, err := template.New(filepath.Base(p)).
            Option("missingkey=error").
            Funcs(funcs).
            ParseFS(fsys, files...)
        if err != nil {
            return nil, fmt.Errorf("parse %s: %w", p, err)
        }
        name := strings.TrimSuffix(filepath.Base(p), ".html")
        out[name] = t
    }
    return out, nil
}
```

Then at request time:

```go
func renderPage(w http.ResponseWriter, name string, data any) {
    t, ok := pages[name]
    if !ok {
        http.NotFound(w, nil)
        return
    }
    var buf bytes.Buffer
    if err := t.ExecuteTemplate(&buf, "base.html", data); err != nil {
        http.Error(w, "render", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    buf.WriteTo(w)
}
```

Two things worth highlighting:

1. **Each page has its own set.** Otherwise `define "content"` in
   `home.html` and `user.html` would collide. By scoping a set per
   page, each `block "content"` resolves to the right override.
2. **Render to a buffer, then to the response.** This is the most
   important production detail — see professional.md.

## 4. `Funcs`: registering custom functions

```go
var funcs = template.FuncMap{
    "upper":    strings.ToUpper,
    "title":    cases.Title(language.English).String, // x/text
    "humanize": humanizeBytes,
    "fmtTime":  func(t time.Time) string { return t.Format("2006-01-02 15:04") },
    "money":    func(cents int64) string { return fmt.Sprintf("$%.2f", float64(cents)/100) },
    "default":  func(def, v string) string { if v == "" { return def }; return v },
}
```

The non-negotiable rules:

1. **Register before parse.** The parser resolves function *names*
   when it sees them. If `funcs` doesn't contain `"humanize"` at
   parse time, parsing fails. Calling `t.Funcs(more)` after `Parse`
   adds names for *future* parses on the same template, and lets
   already-parsed templates *call* those names — but it does not
   un-fail an earlier parse.
2. **Functions return one or two values.** A second return must be
   `error`. A non-nil error aborts execution and bubbles up from
   `Execute`.
3. **Function values are checked at execute time.** `{{call .Fn .X}}`
   compiles regardless of `.Fn`'s type, but execution panics or
   errors if it isn't actually callable.

A useful trick: register the `funcs` map once, share it across many
templates:

```go
var funcs template.FuncMap = template.FuncMap{ ... }

func parsePage(file string) (*template.Template, error) {
    return template.New(filepath.Base(file)).
        Funcs(funcs).
        ParseFiles(file)
}
```

## 5. FuncMap design: what to put in there

Templates are easier to reason about when functions are pure and
short. Patterns that work:

- **Formatters.** `fmtTime`, `money`, `humanizeBytes`. The whole job
  is value → string.
- **Predicates.** `isEmpty`, `hasRole`. Small, side-effect-free,
  return `bool`.
- **Safe-string constructors** in `html/template`. See section 11
  on `template.HTML` and friends.

Patterns that backfire:

- **DB lookups in templates.** Doing `{{lookupUser .ID}}` from a
  template hides N+1 queries in the rendering layer. Keep all data
  fetching in the handler; pass everything the template needs in
  the data struct.
- **Panicky helpers.** A template function that `panic`s on bad
  input takes the whole request down. Always return `(value, error)`
  and let the engine surface it.
- **Stateful functions.** A `counter()` that increments per call
  produces order-dependent output and breaks parallel execution.
  Keep functions referentially transparent.

## 6. `template.Must`: parse-time failures

`template.Must` is a one-liner that wraps a `(*Template, error)` pair
and panics on the error:

```go
var tmpl = template.Must(template.ParseFS(fsys, "templates/*.html"))
```

Use it for templates that are part of the binary — embedded files,
inline literals. A failure means the program is broken, and you want
it to crash at startup, not at the first request hours later.

Don't use `Must` for user-supplied templates. There you want the
error in your hands.

## 7. Parsing from `embed.FS`

The Go 1.16+ `embed` package + `io/fs` make assets a compile-time
artifact:

```go
package main

import (
    "embed"
    "html/template"
    "net/http"
)

//go:embed templates
var templatesFS embed.FS

var tmpl = template.Must(
    template.New("base").
        Option("missingkey=error").
        Funcs(funcs).
        ParseFS(templatesFS, "templates/layouts/*.html", "templates/partials/*.html", "templates/pages/*.html"),
)
```

Three things to note:

1. The path inside an `embed.FS` always uses **forward slashes**, on
   every OS — it's a virtual filesystem.
2. `ParseFS` accepts multiple glob patterns and concatenates the
   matches.
3. The basenames are still the keys. Two files with the same
   basename clobber each other — so don't put `pages/home.html` and
   `partials/home.html` in the same set.

For more on `embed`, see [`../09-go-embed/`](../09-go-embed/junior.md). For
the `io/fs` interface itself,
[`../14-io-fs/`](../14-io-fs/junior.md).

## 8. Hot reload during development

In production you parse once at startup. In development, you want
template changes to show up without restarting. The pattern: pick at
runtime.

```go
type Renderer struct {
    devMode bool
    fsys    fs.FS // os.DirFS or embed.FS
    cache   *template.Template
}

func (r *Renderer) get() (*template.Template, error) {
    if !r.devMode && r.cache != nil {
        return r.cache, nil
    }
    t, err := template.New("base").
        Funcs(funcs).
        ParseFS(r.fsys, "templates/*.html")
    if err != nil {
        return nil, err
    }
    if !r.devMode {
        r.cache = t
    }
    return t, nil
}
```

Initialise with `os.DirFS("./templates")` in dev, `embed.FS` in prod.
Same code, different filesystem, dev gets reparses, prod gets the
cache.

For atomic swaps under load — re-parsing in the background, then
flipping a pointer — see professional.md.

## 9. Options: making missing data loud

`*Template.Option` configures execution behavior. Three relevant
flags:

```go
t.Option(
    "missingkey=error",  // map lookup on missing key fails
    "missingkey=zero",   // map lookup on missing key returns zero
    "missingkey=default",// (default) returns <no value>
)
```

For services, **set `missingkey=error`**. Templates with typos
become test failures, not silent `<no value>` strings in production
HTML.

Note: this is **map keys only**. Struct field access on a missing
field fails at parse time (`can't find field`) and at execute time
(`can't evaluate field`), regardless of this option. Method calls
that return an error still propagate that error.

## 10. Determinism: ordering and reproducibility

Two stdlib guarantees worth knowing:

- **Map iteration via `range` in templates is sorted by key**, in
  lexical order. Unlike Go's runtime map iteration, which is
  intentionally randomized.
- **Template execution writes output in the order actions appear in
  the parse tree.** No reordering, no concurrency inside one
  `Execute` call.

So template output is deterministic given the same data. This is the
property that lets you write golden-file tests:

```go
func TestRenderHome(t *testing.T) {
    var buf bytes.Buffer
    if err := tmpl.ExecuteTemplate(&buf, "home.html", testData); err != nil {
        t.Fatal(err)
    }
    want, _ := os.ReadFile("testdata/home.html")
    if !bytes.Equal(buf.Bytes(), want) {
        t.Errorf("output drift")
    }
}
```

A failing test points at exactly what changed. Combine with `-update`
flag patterns to regenerate fixtures on intent.

## 11. Trusted string types in `html/template`

`html/template` defines string-named types that **bypass escaping**
in their respective contexts. Use them only when you have already
ensured the value is safe in that context.

| Type | Context | Use when |
|------|---------|----------|
| `template.HTML` | element body, attribute | You produced trusted HTML (e.g., from a Markdown renderer that you trust) |
| `template.HTMLAttr` | attribute name=value pair | You're emitting an entire attribute clause |
| `template.JS` | inside `<script>` | You're inserting a JS expression |
| `template.JSStr` | inside a JS string literal | You're inserting a JS string body |
| `template.CSS` | inside `<style>` or `style=""` | You're inserting a CSS value |
| `template.URL` | inside `href`, `src`, etc. | The URL is safe (whitelisted scheme) |
| `template.Srcset` | inside `srcset=""` | You constructed the srcset yourself |

```go
data := struct{ Body template.HTML }{
    Body: template.HTML("<p>I trust this HTML</p>"),
}
tmpl.Execute(w, data)
// <p>I trust this HTML</p>  -- not escaped
```

The naming is deliberate: these types are visibly unsafe at the call
site. `string` in your data → safe (escaped). `template.HTML` in
your data → unsafe by construction (your responsibility).

The only **production** uses I'd defend:

1. Output of a Markdown renderer that runs on a strict allowlist
   (e.g., `bluemonday` with a tight policy).
2. Output of a CMS where editors with sanitized input have produced
   HTML through a separate validator.
3. SVG fragments you control fully.

For everything else, leave it as `string`. Auto-escaping is the
whole point of `html/template`.

## 12. Building safe URLs

URLs in HTML are tricky because they can carry `javascript:`
schemes. `html/template` defends against this in two ways:

- A `string` value substituted into a URL context is escaped
  *and* checked. Disallowed schemes (anything but `http`, `https`,
  `mailto`, `tel`, etc.) are replaced with `#ZgotmplZ`.
- A `template.URL` value is treated as already-vetted and inserted
  verbatim (after URL-escaping unsafe bytes).

```html
<a href="{{.Profile}}">profile</a>
```

If `.Profile` is the string `"javascript:alert(1)"`, the rendered
output is:

```html
<a href="#ZgotmplZ">profile</a>
```

The `#ZgotmplZ` sentinel is `html/template` saying "I refused to
emit a possibly-dangerous URL." Search for it in your output as a
diagnostic if links are suddenly broken.

To allow other schemes intentionally, mark the value as
`template.URL`:

```go
data.Profile = template.URL("data:image/png;base64,...")
```

Now you take the responsibility.

## 13. JS and CSS contexts

`html/template` recognises a handful of contexts inside `<script>`
and `<style>`. Inside `<script>`, an action's value is encoded as a
**JavaScript expression**:

```html
<script>const cfg = {{.Config}};</script>
```

If `.Config` is a Go `map[string]any`, the engine emits a JSON-like
literal. A `string` becomes a JS string literal. A number becomes a
number. The output is safe to evaluate as JS.

Inside a JS string, mark it explicitly:

```html
<script>const name = "{{.Name | js}}";</script>
```

Or — better — let the auto-escaper handle it by putting the action
*outside* the quotes:

```html
<script>const name = {{.Name}};</script>
```

The engine generates valid JS string syntax for you, including the
quotes.

For CSS:

```html
<div style="color: {{.Color}}">
```

The engine validates `.Color` against a CSS-safe whitelist
(numbers, color names, simple identifiers). Anything funky is
replaced with `ZgotmplZ`.

## 14. `text/template` cases worth being explicit about

For non-HTML output, `text/template` is the right choice. A few
canonical uses:

### Email bodies (plain text)

```go
const body = `Hi {{.Name}},

Your invoice {{.InvoiceID}} is ready.

Total: {{money .CentsTotal}}
View: {{.URL}}

— Acme`

t := template.Must(template.New("email").Funcs(funcs).Parse(body))
```

### Generated config files

```go
const dockerfile = `FROM golang:1.22 AS build
WORKDIR /src
COPY . .
RUN go build -o /app ./cmd/{{.Service}}

FROM gcr.io/distroless/base-debian12
COPY --from=build /app /app
ENTRYPOINT ["/app"]
`
```

### Generated Go source

```go
const stub = `package {{.Pkg}}

func {{.Name}}({{.Params}}) {{.Return}} {
    panic("TODO")
}
`
```

Run `gofmt` on the output. Templates are not aware of Go syntax.

### SQL — only for DDL/fixtures, never queries

```go
// OK: schema migration, fully controlled.
const ddl = `CREATE TABLE {{.Name}} (
  id BIGSERIAL PRIMARY KEY,
  {{range .Columns}}
  {{.Name}} {{.Type}}{{if .NotNull}} NOT NULL{{end}},
  {{end}}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`

// NEVER: query strings with user data.
// Use database/sql parameter binding instead.
```

If a value can come from a request, it does **not** belong in a
templated query. Use `db.Query("SELECT ... WHERE id = $1", id)` and
let the driver parameterise.

## 15. Method calls with arguments

Templates can call methods that take arguments:

```go
type Page struct {
    items []Item
}

func (p Page) ItemsBy(category string) []Item {
    var out []Item
    for _, it := range p.items {
        if it.Category == category {
            out = append(out, it)
        }
    }
    return out
}
```

In the template:

```
{{range .ItemsBy "books"}}
  - {{.Title}}
{{end}}
```

The first space after the method name separates the receiver-method
expression from its arguments. Arguments after the first separator
are passed positionally.

For more arguments:

```
{{.Search "go" 10}}
{{call .DynamicFn .X .Y}}
```

`call` is the dynamic dispatcher; use it when the function value
itself comes from the data (e.g., a closure passed in).

## 16. Comparison and boolean rules

```
{{if .X}}truthy{{end}}
{{if eq .Status "active"}}match{{end}}
{{if and .A .B}}both{{end}}
{{if or .A (not .B)}}A or not B{{end}}
```

The truthy rule: a value is "false" iff it is the zero value of its
type (`0`, `""`, `false`, `nil` pointer/slice/map/interface,
zero-length array). Otherwise it's "true."

`eq` accepts arbitrary types: `eq .Status "active"`, `eq .Count 0`.
Behind the scenes it uses `reflect.DeepEqual` for incompatible
types, but for primitives it does the obvious thing. `eq` accepts
multiple comparands: `eq .Role "admin" "owner"` returns true if
`.Role` matches any of them.

`lt`, `gt`, `le`, `ge` work on comparable types of the same kind.
Mixing `int` and `string` is an execute-time error.

## 17. Streaming output

For large pages, you can stream into the response writer rather
than buffering. The trade-off:

- Streaming: lower memory, but a render error mid-stream means
  partial bytes already sent — you can't switch to an error page.
- Buffer-first: full output assembled before headers go out;
  errors yield clean 500 responses.

For HTML pages of any reasonable size, **buffer first**. For huge
data exports (CSV, NDJSON), stream.

```go
// CSV export with text/template.
w.Header().Set("Content-Type", "text/csv")
for _, row := range hugeRows {
    if err := tmpl.Execute(w, row); err != nil {
        log.Println(err)
        return
    }
}
```

Each `Execute` call writes one row. Memory stays flat regardless of
row count.

## 18. Composition: passing data into nested templates

`{{template "name" .}}` passes the current dot. `{{template "name" .X}}`
passes `.X` as the dot for the included template. There is no other
way — templates do not have keyword arguments.

When you need to pass several values, build a map (or a small struct)
in the calling template:

```go
funcs["dict"] = func(values ...any) (map[string]any, error) {
    if len(values)%2 != 0 {
        return nil, errors.New("dict: odd argument count")
    }
    out := make(map[string]any, len(values)/2)
    for i := 0; i < len(values); i += 2 {
        k, ok := values[i].(string)
        if !ok {
            return nil, errors.New("dict: non-string key")
        }
        out[k] = values[i+1]
    }
    return out, nil
}
```

Then in the template:

```
{{template "card" (dict "title" .Title "user" .User)}}
```

This `dict` helper is the standard workaround for "I want to pass
two things to a partial." Many template-heavy projects ship with one.

## 19. Errors during execution

`Execute` returns an `error`. The error has a useful message but no
stable type — most production code logs it and serves an error page.

```go
if err := tmpl.ExecuteTemplate(&buf, "page.html", data); err != nil {
    var ee template.ExecError
    if errors.As(err, &ee) {
        log.Printf("template %q: %v", ee.Name, ee.Err)
    }
    return err
}
```

`template.ExecError` is the typed wrapper for execution errors.
`Name` is the template name; `Err` is the underlying cause (a method
call's error, a nil-deref, a missing key).

For your custom functions, return errors via the second return
value. They surface as `ExecError`:

```go
funcs["safeDiv"] = func(a, b int) (int, error) {
    if b == 0 {
        return 0, errors.New("divide by zero")
    }
    return a / b, nil
}
```

In the template, a non-nil error from `safeDiv` aborts execution
with `template: x:1:1: executing "x" at <safeDiv 1 0>: error
calling safeDiv: divide by zero`.

## 20. Testing templates

Write golden-file tests against a `bytes.Buffer`. Be explicit about
the data, the expected output, and the option flags.

```go
func TestPage(t *testing.T) {
    tmpl := template.Must(template.New("p").Option("missingkey=error").Parse(src))

    cases := []struct {
        name string
        data any
        want string
    }{
        {"empty", Page{}, "<p>(empty)</p>"},
        {"one", Page{Items: []string{"a"}}, "<p>a</p>"},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            var buf bytes.Buffer
            if err := tmpl.Execute(&buf, tc.data); err != nil {
                t.Fatal(err)
            }
            if got := strings.TrimSpace(buf.String()); got != tc.want {
                t.Errorf("got %q, want %q", got, tc.want)
            }
        })
    }
}
```

For the auto-escaper specifically, also test that inputs that look
like attacks come out *escaped*:

```go
data := Page{Title: `<script>x</script>`}
var buf bytes.Buffer
tmpl.Execute(&buf, data)
if strings.Contains(buf.String(), "<script>") {
    t.Error("auto-escape failed: raw <script> in output")
}
```

## 21. Performance: parse vs execute

Parsing is one-shot. Execute is the hot path. Order-of-magnitude
numbers (Go 1.22, m1 mac, single core):

- Parse: ~10–50 µs per template, depending on size.
- Execute: ~1–10 µs per render of a moderate page, dominated by
  reflection on the data.

Two consequences:

1. **Cache parsed templates.** Parsing on every request is the
   single most common Go template performance bug.
2. **Strip reflection by passing concrete struct types**, not
   `map[string]any`. The reflection cost on maps is much higher
   than on structs.

See [optimize.md](optimize.md) for a deeper look.

## 22. What's next

- [senior.md](senior.md) — the contextual-escaper internals,
  trusted types, `Lookup`/`AddParseTree`, sets and `Clone`.
- [professional.md](professional.md) — production patterns:
  buffer-first rendering, hot reload with atomic swap, error pages,
  fuzzing, CSP integration.
- [find-bug.md](find-bug.md) — broken templates and their fixes.
- [optimize.md](optimize.md) — allocation discipline and
  benchmarking.
