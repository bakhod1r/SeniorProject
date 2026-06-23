# 8.15 `text/template` and `html/template` — Junior

> **Audience.** You have used `fmt.Sprintf` to build strings and maybe
> tried to assemble HTML with `+`. By the end of this file you will
> know which of the two template packages to import (the answer is
> usually `html/template`), the syntax that both share, the four parse
> functions, and the dozen pitfalls that catch every newcomer once.

## 1. The two packages and why there are two

```go
import "text/template" // free-form text
import "html/template" // HTML output, with contextual auto-escaping
```

The two packages share the **same template syntax** and almost the
same Go API. The difference is what `Execute` does with the values you
substitute in:

- `text/template` writes them verbatim. `<script>alert(1)</script>` in
  your data lands literally in the output.
- `html/template` looks at where the action sits in the parse tree —
  HTML body, attribute value, JavaScript context, URL, CSS — and
  escapes the value correctly for that context.

Pick the package by looking at the **content type** of the output you
are generating:

| Output | Use |
|--------|-----|
| HTML page, HTML email | `html/template` |
| JSON, YAML, TOML config file | `text/template` |
| Plain-text email body | `text/template` |
| SQL DDL or fixture data (not parameterized queries!) | `text/template` |
| Generated Go source (gofmt'd afterwards) | `text/template` |
| Dockerfile, k8s manifest, terraform | `text/template` |
| URL with query parameters | `text/template` (build the URL manually) or `html/template` if it's inside HTML |

If the rendered bytes will ever be interpreted as HTML by a browser,
**use `html/template`**. It is the same engine; you do not lose
anything. You gain an industrial-grade XSS defense for free.

## 2. The shape of the API

Both packages expose roughly the same surface. Here is the
`html/template` version:

```go
package main

import (
    "html/template"
    "os"
)

func main() {
    t, err := template.New("hello").Parse(`Hello, {{.Name}}!`)
    if err != nil {
        panic(err)
    }
    if err := t.Execute(os.Stdout, struct{ Name string }{"world"}); err != nil {
        panic(err)
    }
    // Output: Hello, world!
}
```

Three steps:

1. **Create** a template with a name: `template.New("name")`.
2. **Parse** template text into it: `.Parse(text)`.
3. **Execute** it against a value, writing to an `io.Writer`.

The name matters when you have more than one template in a set
(layouts, partials). With a single template, any name works.

## 3. Actions: `{{ ... }}`

The bytes outside `{{` and `}}` go to the output unchanged. The bytes
inside are an *action*: an expression evaluated against the current
data context.

```
Hello, {{.Name}}!
You ordered {{.Items}} items.
```

`.` (dot) is the current context — initially the value passed to
`Execute`. `.Name` looks up the `Name` field on a struct, the `"Name"`
key on a map, or calls a method named `Name` (no arguments, one or
two return values). The dot can be re-bound by `range`, `with`, and
`template`.

Inside an action you can also pipe values through functions and call
methods:

```
{{.User.Email | printf "%q"}}
{{len .Items}}
{{eq .Status "active"}}
```

The pipeline `a | b` means "feed `a` to `b` as its last argument."
This reads left-to-right like a Unix pipe.

## 4. The big rule: `text/template` and HTML do not mix

```go
// BUG: text/template, HTML output, attacker-controlled name.
import "text/template"

t, _ := template.New("x").Parse(`<p>Hello, {{.Name}}</p>`)
t.Execute(w, map[string]string{"Name": "<script>steal()</script>"})
// Output: <p>Hello, <script>steal()</script></p>
//                    ^^^^^^^^^^^^^^^^^^^^^^^^^^ XSS
```

Switch to `html/template` and the same code is safe:

```go
import "html/template"

t, _ := template.New("x").Parse(`<p>Hello, {{.Name}}</p>`)
t.Execute(w, map[string]string{"Name": "<script>steal()</script>"})
// Output: <p>Hello, &lt;script&gt;steal()&lt;/script&gt;</p>
```

The escape happens because the parser sees `{{.Name}}` sitting in HTML
*element body* context and runs the value through `template.HTMLEscapeString`
before writing. The same template string under `text/template` does
not get any escaping at all.

This is non-negotiable for HTML output. Every line you write that
emits HTML must use `html/template`. There is no middle ground.

## 5. Parsing functions: `Parse`, `ParseFiles`, `ParseGlob`, `ParseFS`

You rarely write a template inline as a Go string literal. Real
templates live in `.tmpl` or `.html` files on disk or inside an
`embed.FS`.

```go
// Inline string.
t, err := template.New("x").Parse(`{{.}}`)

// Single file.
t, err := template.ParseFiles("templates/page.html")

// Several files.
t, err := template.ParseFiles("base.html", "page.html")

// Glob pattern.
t, err := template.ParseGlob("templates/*.html")

// embed.FS or any io/fs.FS (Go 1.16+).
//go:embed templates
var fsys embed.FS
t, err := template.ParseFS(fsys, "templates/*.html")
```

Two things to know:

1. The **template name** for each file is its base name. `page.html`
   becomes a template named `"page.html"`. To execute it later you'll
   call `ExecuteTemplate(w, "page.html", data)`, not `Execute`.
2. `ParseFiles` returns a template whose name is the *first* file's
   base. So `ParseFiles("a.html", "b.html")` gives you a template
   set whose default-named entry is `"a.html"`.

For embedded assets, the `ParseFS` form is the modern default. See
[`../09-go-embed/`](../09-go-embed/junior.md) for the full embed story.

## 6. Executing: `Execute` vs `ExecuteTemplate`

```go
// Execute the template's default-named entry against data.
err = t.Execute(w, data)

// Execute a specific named entry from the template set.
err = t.ExecuteTemplate(w, "page.html", data)
```

When you parse one inline string with `New("x").Parse(...)`, `Execute`
runs `"x"`. When you parse files with `ParseFiles`/`ParseGlob`/`ParseFS`,
each file becomes its own named entry in the same set; use
`ExecuteTemplate` to pick which one to render.

## 7. Pipelines and method calls

Inside `{{...}}` you build *pipelines*:

```
{{.Title}}                       — field access
{{.User.Name}}                   — chained access
{{.Format "2006-01-02"}}         — method call with one argument
{{.Items | len}}                 — pipe value into a function
{{printf "%05d" .ID}}            — call function with explicit args
{{.Items | len | printf "%d"}}   — chain
```

Method calls follow Go's rules. The method must be exported (capital
letter), and it must return one value, or two with the second being
`error`. If a method returns `(T, error)` and the error is non-nil,
template execution aborts with that error.

```go
type User struct{ id int }

func (u User) Email() (string, error) {
    if u.id == 0 {
        return "", errors.New("no id")
    }
    return fmt.Sprintf("user-%d@example.com", u.id), nil
}
```

`{{.Email}}` evaluates the method. Note: **fields and method names
must be exported**. A lowercase field is invisible to the template
engine, the same way it is invisible to `encoding/json`.

## 8. Conditionals: `if`, `else`, `else if`

```
{{if .LoggedIn}}
  Hi, {{.Name}}.
{{else if .Anonymous}}
  Welcome, guest.
{{else}}
  Please log in.
{{end}}
```

`if` evaluates its argument and treats these as "false": the zero
value of any type, plus `nil`. So `if .Items` is true when `Items` is
a non-nil, non-empty slice; `if .Count` is true when `Count != 0`;
`if .User` is true when `User` is a non-nil pointer or interface.

For explicit comparisons use the comparison built-ins:

```
{{if eq .Status "active"}}...{{end}}
{{if ne .Role "admin"}}...{{end}}
{{if gt .Count 0}}...{{end}}
{{if and .LoggedIn (eq .Role "admin")}}...{{end}}
{{if or .ShowAll (gt .Count 0)}}...{{end}}
```

`and`, `or`, `not`, `eq`, `ne`, `lt`, `le`, `gt`, `ge` are the
comparison/logic built-ins. They are functions, not operators —
prefix call style only. There is **no `==` operator** in template
syntax.

## 9. Loops: `range`

```
{{range .Items}}
  - {{.Name}} ({{.Price}})
{{end}}
```

Inside `range`, the dot is rebound to the current element. To get
the parent context back, use `$`:

```
{{range .Items}}
  - {{.Name}} sold by {{$.Seller}}
{{end}}
```

`$` is the **root data** passed to `Execute`. It is bound once at the
start and is the most reliable way to access "outside" data inside
nested loops.

You can capture both index and element with two variables:

```
{{range $i, $item := .Items}}
  {{$i}}: {{$item.Name}}
{{end}}
```

Or just the index:

```
{{range $i, $_ := .Items}}{{$i}}{{end}}
```

When the range collection is empty (a nil/empty slice, an empty map,
zero), the loop body is skipped. To handle the empty case, use the
`else` arm:

```
{{range .Items}}
  - {{.Name}}
{{else}}
  No items.
{{end}}
```

Ranging over a **map** iterates in **lexically sorted key order** —
this is a Go template guarantee, deliberately different from `for ...
range` over a Go map (which is randomized). It exists so template
output is deterministic.

## 10. Variables: `$x := ...`

Inside an action you can declare variables:

```
{{$total := 0}}
{{range .Items}}
  {{$total = add $total .Price}}
{{end}}
Total: {{$total}}
```

Variables start with `$`, are declared with `:=`, and reassigned with
`=`. Their scope is the enclosing block. The implicit variable `$` is
always the root data.

`add` is not a built-in. We'll register it as a custom function in
section 14.

## 11. `with` — narrow the dot

```
{{with .User}}
  Name: {{.Name}}
  Email: {{.Email}}
{{end}}
```

`with` evaluates its argument. If it's not a zero value, the body
runs with the dot bound to that argument. If it is zero/nil, the
body is skipped. This avoids repeating `.User.Name`, `.User.Email`,
`.User.Phone` and gives you a natural "if not nil" guard.

It also has an `else` clause:

```
{{with .CurrentUser}}
  Hi, {{.Name}}.
{{else}}
  Not logged in.
{{end}}
```

Use `with` when you want the safer-by-default chain. `{{.User.Name}}`
on a nil `.User` returns `<no value>` (or errors with `Option("missingkey=error")`).
`{{with .User}}{{.Name}}{{end}}` quietly skips the whole block.

## 12. Defining and including templates

Big templates split across multiple files, with shared partials. Two
key actions:

```
{{define "name"}} ...body... {{end}}    -- declare a named template
{{template "name" data}}                 -- invoke it with the given data
```

Example: a layout with content and footer partials.

`base.html`:
```
<!doctype html>
<html>
  <body>
    <main>{{template "content" .}}</main>
    <footer>{{template "footer" .}}</footer>
  </body>
</html>
```

`page.html`:
```
{{define "content"}}
  <h1>{{.Title}}</h1>
  <p>{{.Body}}</p>
{{end}}

{{define "footer"}}
  <small>Copyright {{.Year}}</small>
{{end}}
```

Render with:
```go
t, err := template.ParseFiles("base.html", "page.html")
if err != nil { return err }
err = t.ExecuteTemplate(w, "base.html", page)
```

The same template *set* contains all named entries; you pick the
entry point with `ExecuteTemplate`. Middle.md covers `block` for
overridable defaults.

## 13. Built-in functions

Both packages share a built-in function set. The ones you'll use
weekly:

| Name | Purpose | Example |
|------|---------|---------|
| `and`, `or`, `not` | Boolean logic | `{{if and .A .B}}` |
| `eq`, `ne`, `lt`, `le`, `gt`, `ge` | Comparisons | `{{if eq .S "x"}}` |
| `len` | Length of slice/array/map/string | `{{len .Items}}` |
| `index` | Index a slice/array/map | `{{index .Map "key"}}` |
| `slice` | Sub-slice (1.13+) | `{{slice .S 0 3}}` |
| `printf`, `print`, `println` | Like `fmt`'s Sprintf/Sprint | `{{printf "%.2f" .X}}` |
| `urlquery` | Percent-encode for query strings | `{{urlquery .Q}}` |
| `js`, `html`, `urlquery` | Manual escape helpers (rarely needed in `html/template`) | |
| `call` | Invoke a function value at runtime | `{{call .Fn .X}}` |

`html/template` adds context-aware escaping built-ins (`html`, `js`,
`urlquery`) but you almost never call them yourself — the contextual
auto-escaper does it. Use them only when you have a `text/template`
that needs a one-off escape.

## 14. Custom functions: `Funcs`

For anything not built in, register a `template.FuncMap`:

```go
funcs := template.FuncMap{
    "upper": strings.ToUpper,
    "add":   func(a, b int) int { return a + b },
    "fmtDate": func(t time.Time) string {
        return t.Format("2006-01-02")
    },
}

t, err := template.New("x").Funcs(funcs).Parse(text)
```

Three rules:

1. **Register `Funcs` before `Parse`.** The parser looks up function
   names at parse time. Calling `Funcs` after `Parse` does not
   retroactively make the names known to already-parsed templates.
2. Functions can return one value, or `(value, error)`. A non-nil
   error aborts execution.
3. Function names are identifiers — no dots, no spaces. Use
   lowercase or camelCase by convention.

Use it in the template like a built-in:

```
{{.Title | upper}}
{{add .X .Y}}
{{fmtDate .Created}}
```

## 15. The empty value: `<no value>`

By default, `{{.Missing}}` against a value that has no `Missing` field
or key prints the literal string `<no value>`. This is rarely what you
want — it leaks template-implementation details into your output.

Three options:

```go
t.Option("missingkey=default")  // default: print <no value>
t.Option("missingkey=zero")     // print the zero value of the field type
t.Option("missingkey=error")    // fail with an explicit error
```

For services, **always set `missingkey=error`**. A typo in a template
should be a hard failure during testing, not a `<no value>` shipped
to users.

```go
t := template.New("x").Option("missingkey=error")
```

This applies to map lookups specifically. Struct field access already
errors (`can't evaluate field X in type Y`) at execute time without
the option.

## 16. Writing to a buffer for tests and HTTP

Always render through an `io.Writer`. For tests and small payloads,
use `bytes.Buffer`:

```go
var buf bytes.Buffer
if err := t.Execute(&buf, data); err != nil {
    return err
}
fmt.Println(buf.String())
```

For HTTP handlers, write straight into the response writer:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    if err := tmpl.ExecuteTemplate(w, "page.html", data); err != nil {
        // Logged, but the response may have partial output already.
        log.Printf("template: %v", err)
    }
}
```

There is a subtle problem with the second form: if `Execute` fails
halfway, you have already written some bytes to `w`, and you cannot
take them back. Production code renders into a `bytes.Buffer` first
and copies on success — see professional.md.

## 17. A complete first example (`html/template`)

```go
package main

import (
    "html/template"
    "log"
    "net/http"
)

const page = `<!doctype html>
<html>
<head><title>{{.Title}}</title></head>
<body>
  <h1>{{.Title}}</h1>
  <ul>
  {{range .Items}}
    <li>{{.}}</li>
  {{else}}
    <li>(empty)</li>
  {{end}}
  </ul>
  <p>Hi, {{.User}}.</p>
</body>
</html>`

var tmpl = template.Must(template.New("page").Option("missingkey=error").Parse(page))

type Page struct {
    Title string
    Items []string
    User  string
}

func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    p := Page{
        Title: "Hello",
        Items: []string{"alpha", "beta", "<script>x</script>"},
        User:  r.URL.Query().Get("user"),
    }
    if err := tmpl.Execute(w, p); err != nil {
        log.Println(err)
    }
}

func main() {
    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

The `<script>x</script>` element body and the `?user=<>` query
parameter both get escaped automatically. Try the same with
`text/template` and you have an instant XSS bug.

`template.Must` panics if `Parse` returns an error. Use it for
templates known at compile time — a typo in a literal template should
crash the program at startup, not a request later.

## 18. A complete first example (`text/template`)

For non-HTML output, `text/template` is the right choice.

```go
package main

import (
    "os"
    "text/template"
)

const cfg = `# generated config
listen = "{{.Addr}}"
debug  = {{.Debug}}
{{range .Tags}}- {{.}}
{{end}}`

type Config struct {
    Addr  string
    Debug bool
    Tags  []string
}

func main() {
    t := template.Must(template.New("cfg").Parse(cfg))
    _ = t.Execute(os.Stdout, Config{
        Addr:  "0.0.0.0:8080",
        Debug: true,
        Tags:  []string{"web", "api"},
    })
}
```

No HTML escaping happens. The values go in literally, which is what
you want for a TOML or YAML output. Just don't ever feed this kind of
template into a browser.

## 19. Whitespace control: `{{- ` and ` -}}`

Templates often look ugly because the literal newlines around actions
end up in the output. Trim them with `-`:

```
<ul>
{{- range .Items}}
  <li>{{.}}</li>
{{- end}}
</ul>
```

- `{{-` trims **leading** whitespace (including newlines) from the
  text before the action.
- `-}}` trims **trailing** whitespace from the text after the action.

The hyphen must have a space between it and the action body —
`{{-.X}}` is a parse error; `{{- .X}}` is correct.

For HTML output, whitespace usually does not affect rendering, but
it can blow up payload size for templates that loop a lot. For
generated source code or YAML, whitespace is semantically important
and trim is essential.

## 20. Errors you'll see on day one

| Error message | Cause |
|---------------|-------|
| `template: x:1: function "foo" not defined` | Custom function used in template was not registered with `Funcs` *before* `Parse` |
| `template: x:1: bad character U+0024 '$'` | `$variable` outside an action, or before being declared with `:=` |
| `template: x:5: unexpected "end" in command` | Forgot the `{{` before `end` or mismatched `range`/`if`/`with`/`define` |
| `template: x:1: can't evaluate field Foo in type ...` | The field doesn't exist on the type, or it's unexported |
| `<no value>` in output | Missing map key with default `missingkey=default` — set `missingkey=error` to find the typo |
| `template: "x" is an incomplete or empty template` | You called `Execute` on a parsed-but-empty set, or named the wrong file |
| `executing "x" at <.Foo>: ... <nil pointer evaluating .Foo>` | Dereferenced a nil pointer somewhere in the chain — guard with `with` or `if` |
| `<script>...</script>` in your output | You used `text/template` for HTML — switch to `html/template` |

The last one is the bug that matters. Read it again.

## 21. Caching: parse once, execute many times

Parsing is expensive (it allocates a parse tree, resolves function
names, runs the contextual escaper for `html/template`). Execution
is the hot path — it walks the parse tree against your data.

**Do this:**

```go
// Parse at startup, once.
var tmpl = template.Must(template.ParseFS(fsys, "templates/*.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    tmpl.ExecuteTemplate(w, "page.html", data)
}
```

**Not this:**

```go
// Re-parses every request — wasteful and slow.
func handler(w http.ResponseWriter, r *http.Request) {
    t := template.Must(template.ParseFiles("templates/page.html"))
    t.Execute(w, data)
}
```

Templates are safe for concurrent execution after parsing. Multiple
goroutines can call `Execute` on the same `*template.Template` value
at the same time. They are **not** safe to mutate (`Funcs`, `Parse`,
`AddParseTree`) after parsing — see senior.md.

## 22. What's in middle.md and beyond

- **middle.md** — `define`/`block`/`template` in detail, layout
  patterns, FuncMap design, `embed.FS` workflows, deterministic map
  ordering, content-type discipline.
- **senior.md** — the contextual-auto-escaper internals, trusted
  string types (`HTML`, `JS`, `URL`, `CSS`, `JSStr`, `Srcset`),
  `Lookup` / `AssociatedTemplates`, `New`/`Clone` / `AddParseTree`.
- **professional.md** — production patterns: hot reload, atomic
  swap of parsed sets, render-to-buffer-first, error pages, fuzz
  testing.
- **specification.md** — exact action grammar and built-in function
  reference.
- **find-bug.md** — XSS bugs, missing-FuncMap-before-Parse traps,
  range-over-map order, etc.

For the file-loading mechanics (`embed.FS`, `io/fs`), see
[`../09-go-embed/`](../09-go-embed/junior.md) and [`../14-io-fs/`](../14-io-fs/junior.md).
For the HTTP serving side, see
[`../11-net-http-internals/`](../11-net-http-internals/junior.md).
