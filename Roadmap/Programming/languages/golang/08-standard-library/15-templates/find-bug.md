# 8.15 `text/template` and `html/template` — Find the Bug

> Twenty broken snippets. For each, identify the bug, explain why it
> matters, and give the fix. Most are real production bugs collected
> from code review and incident postmortems. The XSS-flavored ones
> are unflagged on purpose — you should learn to spot them on sight.

## Bug 1

```go
import "text/template"

const page = `<!doctype html>
<html><body>
  <h1>Welcome, {{.Name}}!</h1>
  <p>Search: {{.Query}}</p>
</body></html>`

t := template.Must(template.New("p").Parse(page))
t.Execute(w, struct{ Name, Query string }{r.URL.Query().Get("name"), r.URL.Query().Get("q")})
```

**Bug.** `text/template` for HTML output. `Name` and `Query` come
from `r.URL.Query()` and are written verbatim. A request to
`/?name=<script>steal()</script>&q=<img src=x onerror=alert(1)>` is
stored XSS waiting to happen.

**Fix.** Change the import to `html/template`. The template source
is the same; the engine inserts contextual escapes automatically.

## Bug 2

```go
import "html/template"

t := template.Must(template.New("p").Parse(`<p>Bio: {{.Bio | safeHTML}}</p>`))
funcs := template.FuncMap{
    "safeHTML": func(s string) template.HTML { return template.HTML(s) },
}
t.Funcs(funcs).Execute(w, struct{ Bio string }{userInput})
```

**Bug.** Two compounded bugs.

1. `Funcs` is called *after* `Parse`. Parsing fails with
   `function "safeHTML" not defined`.
2. Even if it worked, `safeHTML` wraps unsanitized user input as
   `template.HTML`, bypassing all auto-escape. This is the canonical
   XSS wrapper.

**Fix.** Register `Funcs` before `Parse`. Then either remove
`safeHTML` entirely (let auto-escape do its job) or run `userInput`
through a sanitizer (`bluemonday.UGCPolicy().Sanitize`) inside the
function before wrapping.

## Bug 3

```go
const cfg = `listen = "{{.Addr}}"
debug = {{.Debug}}
{{range .Tags}}
- {{.}}
{{end}}`

t := template.Must(template.New("c").Parse(cfg))
t.Execute(os.Stdout, Config{Addr: "0.0.0.0:80", Debug: true, Tags: []string{"a", "b"}})
```

Output:

```
listen = "0.0.0.0:80"
debug = true

- a

- b

```

**Bug.** Extra blank lines from the literal newline before each
`{{range}}` and `{{end}}`. The output has stray empty lines that
will break a strict TOML parser.

**Fix.** Trim whitespace with `{{- ` and ` -}}`:

```
{{range .Tags}}
- {{.}}{{end}}
```

Or:

```
{{- range .Tags}}
- {{.}}
{{- end}}
```

## Bug 4

```go
type User struct {
    name string // unexported
}

func (u User) Email() string { return u.name + "@example.com" }

t := template.Must(template.New("x").Parse(`{{.name}} - {{.Email}}`))
t.Execute(os.Stdout, User{name: "alice"})
```

**Bug.** `{{.name}}` accesses an unexported field, which the
template engine can't see (same rule as `encoding/json`). The
template fails with `can't evaluate field name in type User`.

**Fix.** Either export the field (`Name`) or expose it via an
exported method:

```go
func (u User) Name() string { return u.name }
```

## Bug 5

```go
type Page struct{ Items []string }

const tpl = `{{range .Items}}
- {{.}}
{{end}}
Total: {{len .Items}}`

t := template.Must(template.New("p").Parse(tpl))
t.Execute(os.Stdout, Page{Items: []string{"a", "b"}})
```

Inside the range, `len .Items` is fine — but inside *another* range
nested deeper, `.Items` would resolve to the inner element, not the
parent.

**Bug.** Subtle: in a nested range, `.Items` rebinds the dot. To
reach the outer page, you need `$`:

```
{{range .Items}}
  {{range .Subitems}}
    - {{.}} of {{$.Title}}    {{/* not .Title */}}
  {{end}}
{{end}}
```

**Fix.** Use `$` to reach the root data, or capture a variable
before the inner range: `{{$page := .}}{{range .Items}}{{range .Sub}}{{$page.Title}}{{end}}{{end}}`.

## Bug 6

```go
func handler(w http.ResponseWriter, r *http.Request) {
    t := template.Must(template.ParseFiles("page.html"))
    t.Execute(w, getData(r))
}
```

**Bug.** Re-parses on every request. Parsing is far more expensive
than execution; this turns a 5 µs render into a 50 µs render. Worse,
a parse error returns 500 only for some requests (whichever happens
to hit the broken template), and a typo doesn't fail at startup.

**Fix.**

```go
var pageTmpl = template.Must(template.ParseFiles("page.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    pageTmpl.Execute(w, getData(r))
}
```

Parse once at package init.

## Bug 7

```go
type Article struct {
    Body string // raw user input
}

const tpl = `<article>{{.Body | html}}</article>`

t := template.Must(template.New("a").Parse(tpl))  // html/template
t.Execute(w, article)
```

**Bug.** Calling `html` (or `js`, `urlquery`) by hand in
`html/template` is at best redundant and at worst confusing. The
auto-escaper already escapes the value for the HTML body context.
Adding `| html` double-escapes, producing `&amp;lt;` etc., and
muddies the audit (a reader wonders if you meant `template.HTML`).

**Fix.** Drop the manual `html` filter. Let the engine handle it.

## Bug 8

```go
const tpl = `<a href="{{.URL}}">link</a>`

t := template.Must(template.New("u").Parse(tpl))
t.Execute(w, struct{ URL string }{URL: "javascript:alert(1)"})
// Output: <a href="#ZgotmplZ">link</a>
```

**Bug.** Not really a bug — the engine refused the `javascript:`
scheme and emitted `#ZgotmplZ`. The "bug" reports look like "the
link is broken!" The sentinel is a feature, not a fault.

**Fix (genuine).** If the URL is legitimately a non-`http(s)` scheme
that you want to allow (e.g., `mailto:`, `tel:`), those schemes are
allowed by default. For a `data:` URL or similar, you have to mark
the value as `template.URL`:

```go
data.URL = template.URL("data:image/png;base64,...")
```

Audit such conversions carefully.

## Bug 9

```go
funcs := template.FuncMap{
    "now": time.Now,
}

const tpl = `Generated at {{now}}`
t := template.Must(template.New("g").Funcs(funcs).Parse(tpl))
```

**Bug.** `now` is non-deterministic. Templates with non-deterministic
functions break golden-file tests, complicate caching (output
changes on every render), and surprise readers.

**Fix.** Pass timestamps via the data:

```go
type Data struct{ GeneratedAt time.Time }
const tpl = `Generated at {{.GeneratedAt.Format "2006-01-02"}}`
```

Reserve FuncMap entries for *pure* formatters and helpers.

## Bug 10

```go
var tmpl *template.Template

func init() {
    tmpl = template.Must(template.New("x").Parse(src))
}

func updateFunctions(extras template.FuncMap) {
    tmpl.Funcs(extras)
}
```

**Bug.** `Funcs` mutates the FuncMap on a `*template.Template`
that may already be in use by goroutines calling `Execute`. The
internal map is unsynchronised — this is a data race.

**Fix.** Build a new template set with the new FuncMap and atomic-swap:

```go
var tmpl atomic.Pointer[template.Template]

func update(extras template.FuncMap) error {
    funcs := mergeFuncs(baseFuncs, extras)
    t, err := template.New("x").Funcs(funcs).Parse(src)
    if err != nil { return err }
    tmpl.Store(t)
    return nil
}
```

## Bug 11

```go
type Settings map[string]string

const tpl = `{{range $k, $v := .}}{{$k}}={{$v}}
{{end}}`

t := template.Must(template.New("s").Parse(tpl))
for i := 0; i < 5; i++ {
    var buf bytes.Buffer
    t.Execute(&buf, Settings{"x": "1", "y": "2", "z": "3"})
    fmt.Println(buf.String())
}
```

**Bug.** None — output is deterministic across iterations because
template `range` over a map sorts by key. (Some interview candidates
think this is buggy because they expect Go's randomized map order.)

**Fix.** Nothing to fix. This is a feature: deterministic output for
templates is intentional, the opposite of `for k, v := range m`.

## Bug 12

```go
const tpl = `<p>{{.User.Name}}</p>`
t := template.Must(template.New("p").Parse(tpl))
t.Execute(w, struct{ User *User }{User: nil})
```

**Bug.** `.User.Name` on a `nil` pointer crashes with
`executing "p" at <.User.Name>: nil pointer evaluating *User.Name`.
The user sees a 500.

**Fix.** Guard with `with`:

```
{{with .User}}<p>{{.Name}}</p>{{end}}
```

Or push the nil check into Go:

```go
func (p Page) UserName() string {
    if p.User == nil { return "" }
    return p.User.Name
}
```

Then `{{.UserName}}` is total.

## Bug 13

```go
funcs := template.FuncMap{
    "div": func(a, b int) int { return a / b },
}
```

**Bug.** Panics on `b == 0`. A panic from a custom function aborts
template execution with a runtime panic, not a clean error — the
HTTP handler has no chance to recover.

**Fix.** Return `(value, error)` and let the engine surface it:

```go
"div": func(a, b int) (int, error) {
    if b == 0 { return 0, errors.New("divide by zero") }
    return a / b, nil
},
```

## Bug 14

```go
const tpl = `{{range .Items}}<li>{{.}}</li>{{end}}`

var page Page
json.Unmarshal(body, &page) // page.Items might be nil
t.Execute(w, page)
```

**Bug.** Not a bug per se — `range` over a nil slice is a no-op,
matching Go semantics. But if your tests expect "always at least an
empty `<ul>`," you may have surprised yourself with a missing list
when there are no items.

**Fix.** If the empty case needs explicit handling:

```
<ul>
{{range .Items}}<li>{{.}}</li>{{else}}<li>No items.</li>{{end}}
</ul>
```

`{{else}}` inside `range` runs when the iterated value is empty.

## Bug 15

```go
const tpl = `<input value={{.Q}}>`
t := template.Must(template.New("x").Parse(tpl))  // html/template
t.Execute(w, struct{ Q string }{Q: "x onmouseover=alert(1)"})
```

**Bug.** The attribute has no quotes. `html/template` rejects this
at parse time with `... in unquoted attr` because it can't safely
escape into an unquoted attribute (the escape would have to handle
spaces as terminators, which is brittle).

**Fix.** Quote the attribute:

```
<input value="{{.Q}}">
```

Now the auto-escaper has a clear delimiter and can safely escape
quotes inside the value.

## Bug 16

```go
funcs["render"] = func(name string, data any) (template.HTML, error) {
    var buf bytes.Buffer
    if err := tmpl.ExecuteTemplate(&buf, name, data); err != nil {
        return "", err
    }
    return template.HTML(buf.String()), nil
}
```

**Bug.** `tmpl` here is the same template currently being executed.
A FuncMap entry that re-enters `Execute` on the same template can
deadlock if the template engine takes any internal lock during
execution, or — more commonly — re-uses internal scratch state. It
also short-circuits the auto-escaper because the recursive render
returns `template.HTML`, which is not re-escaped at the call site.

**Fix.** Use `{{template "name" data}}` for sub-templates. It's
designed for exactly this case and integrates with the auto-escaper.

## Bug 17

```go
const tpl = `Hi, {{.Name}}.`
t := template.Must(template.New("x").Parse(tpl))

w := bufio.NewWriter(os.Stdout)
t.Execute(w, struct{ Name string }{"world"})
// Output (sometimes empty)
```

**Bug.** `bufio.Writer` not flushed. The buffer holds the bytes
until `Flush` is called or the buffer fills.

**Fix.**

```go
defer w.Flush()
```

Or use `os.Stdout` directly if buffering isn't needed.

## Bug 18

```go
type Page struct{ Title string }

func (p Page) Title() string { return strings.Title(p.Title) }
```

**Bug.** Field `Title` and method `Title` collide on the same type —
the compiler errors with `Page.Title redeclared`. (It compiles only
if you misread.) But even renaming, `strings.Title` is deprecated
in favor of `cases.Title`.

**Fix.** Rename either the field or the method, and use `golang.org/x/text/cases`:

```go
import (
    "golang.org/x/text/cases"
    "golang.org/x/text/language"
)

var titleCase = cases.Title(language.English)
func (p Page) DisplayTitle() string { return titleCase.String(p.title) }
```

## Bug 19

```go
const tpl = `<script>const cfg = "{{.Config}}";</script>`
t := template.Must(template.New("s").Parse(tpl))  // html/template
t.Execute(w, struct{ Config map[string]any }{Config: cfgMap})
```

**Bug.** The action is inside a JS string literal. The auto-escaper
escapes `cfgMap` for the *string-body* context — meaning it produces
something like `"map[a:1 b:2]"` after `fmt.Sprint`-style stringifying
through the JS-string escaper. Not the JS object the front-end
expects.

**Fix.** Move the action *outside* the quotes:

```html
<script>const cfg = {{.Config}};</script>
```

Now the auto-escaper recognises JS expression context and emits a
JSON-shaped literal that JS can parse. The engine handles quoting
itself.

## Bug 20

```go
import "text/template"

const sql = `SELECT * FROM users WHERE name = '{{.Name}}'`
t := template.Must(template.New("q").Parse(sql))

var buf bytes.Buffer
t.Execute(&buf, struct{ Name string }{Name: r.URL.Query().Get("name")})
db.Query(buf.String())
```

**Bug.** Templated SQL with user input. SQL injection through
`name=' OR 1=1; --`. Templates don't know about SQL escaping — the
result is `... WHERE name = '' OR 1=1; --'`. Catastrophic.

**Fix.** Use parameter binding. Don't use templates to build queries
that include user data:

```go
db.Query("SELECT * FROM users WHERE name = $1", r.URL.Query().Get("name"))
```

Templates are fine for *DDL* (`CREATE TABLE` from a schema spec) and
fixtures, but never for queries with user-controlled values.

## Bug 21

```go
const layout = `{{template "content" .}}`
const page = `{{define "content"}}<p>{{.}}</p>{{end}}`

t := template.Must(template.New("layout").Parse(layout))
template.Must(t.Parse(page))
t.Execute(w, "hi")
```

**Bug.** The first `Parse` creates `"layout"` whose body invokes
`{{template "content" .}}`. The second `Parse` on the same template
*replaces* `"layout"`'s body — the parser sees `{{define "content"}}...{{end}}`
and parses it as the new body of the receiver template (`"layout"`),
defining `content` as a side effect. After the second `Parse`,
`"layout"`'s body is whatever wasn't inside the `define`, which is
empty.

**Fix.** Use distinct names (`New("layout")` and `New("page")`), or
use `ParseFiles` which keeps each file's name distinct via basename:

```go
t := template.Must(template.ParseFiles("layout.html", "page.html"))
t.ExecuteTemplate(w, "layout.html", "hi")
```

## Bug 22

```go
//go:embed templates
var fsys embed.FS

t := template.Must(template.ParseFS(fsys, "templates\\*.html"))
```

**Bug.** Backslash separator. `embed.FS` always uses forward
slashes, on every OS (including Windows). The glob fails to match.

**Fix.**

```go
template.ParseFS(fsys, "templates/*.html")
```

For real-filesystem paths, use `filepath.Join` with OS-specific
separators. For `embed.FS` and `fs.FS`, always `/`.

## Bug 23

```go
type Tree struct {
    Name     string
    Children []*Tree
}

const tpl = `{{define "tree"}}{{.Name}}
{{range .Children}}{{template "tree" .}}{{end}}{{end}}
{{template "tree" .}}`

t := template.Must(template.New("t").Parse(tpl))
t.Execute(w, root)
```

**Bug.** Recursive template. Works for finite trees, but a cyclic
data structure (a node that references its ancestor) becomes an
infinite loop. The engine has no cycle detection.

**Fix.** Either guarantee acyclic input (often easy) or push a
depth counter through the data:

```go
type Node struct {
    Name     string
    Children []*Node
    Depth    int // capped at, e.g., 100
}
```

And in the template, `{{if lt .Depth 100}}...{{end}}`.

## Bug 24

```go
const tpl = `Welcome to {{.SiteName}}!`
t := template.Must(template.New("w").Parse(tpl))
t.Execute(w, map[string]string{"siteName": "Acme"})
```

**Bug.** Map key is `"siteName"` (lowercase `s`); template references
`{{.SiteName}}` (uppercase). The default `missingkey=default` mode
silently emits `<no value>`. Output: `Welcome to <no value>!`.

**Fix.** Set `missingkey=error`:

```go
t := template.New("w").Option("missingkey=error")
t = template.Must(t.Parse(tpl))
```

Now the typo fails loudly: `map has no entry for key "SiteName"`.

## Bug 25

```go
type Article struct {
    Title string
    Body  template.HTML // pre-rendered Markdown
}

func setBody(a *Article, md string) {
    var buf bytes.Buffer
    goldmark.Convert([]byte(md), &buf)
    a.Body = template.HTML(buf.String())
}
```

**Bug.** Markdown can produce HTML with `javascript:` URLs and
inline `onerror=` handlers. The output of a permissive Markdown
renderer is **not** safe HTML. Wrapping it as `template.HTML`
bypasses auto-escape, shipping the attack to the browser.

**Fix.** Run the Markdown output through a sanitizer with a strict
allowlist:

```go
import "github.com/microcosm-cc/bluemonday"

var policy = bluemonday.UGCPolicy()

func setBody(a *Article, md string) {
    var buf bytes.Buffer
    goldmark.Convert([]byte(md), &buf)
    clean := policy.Sanitize(buf.String())
    a.Body = template.HTML(clean)
}
```

Add a test that a malicious Markdown sample comes out without any
of the dangerous sequences.

## How to read these

The pattern across all twenty-five: the engine is doing what you
asked. Either the import was wrong (`text/template` for HTML), the
code bypassed the engine (`template.HTML(unsafe)`), or the code
mishandled lifecycle (`Funcs` after `Parse`, parse-on-every-request,
mutate-while-execute).

Templates are not a sandbox. They are a string templater with one
specific feature — `html/template`'s auto-escape — that is the
single most important defense against HTML XSS in your stack. Treat
that defense like a load-bearing wall: don't drill holes in it
without a code review attached.
