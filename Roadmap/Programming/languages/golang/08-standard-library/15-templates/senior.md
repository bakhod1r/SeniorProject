# 8.15 `text/template` and `html/template` — Senior

> **Audience.** You've written a service that renders a non-trivial
> template tree. This file goes under the hood: how the contextual
> auto-escaper actually works, what trusted string types do at the
> bytecode level, the parse-tree types, set management with `Lookup`
> and `Clone`, the FuncMap-after-Parse trap, and the corner cases
> that turn into multi-hour debugging sessions.

## 1. Two engines, one parser

Both packages share `text/template/parse` for lexing and parsing.
Run this and you'll see — `html/template.Parse` produces a
`text/template`-shaped parse tree first, then `html/template`
**rewrites that tree** by inserting escape calls at every action,
based on the surrounding HTML context.

The rewrite step is the magic. `html/template` walks your parse tree
as if it were rendering, tracks an escaper state machine through
HTML, attribute, JS, CSS, and URL contexts, and at every action it
inserts a wrapper:

```
{{.Name}}
```

becomes (roughly, conceptually) one of:

```
{{._html_template_htmlescaper .Name}}        -- in element body
{{._html_template_attrescaper .Name}}        -- in attribute value
{{._html_template_jsvalescaper .Name}}       -- inside <script>
{{._html_template_cssvaluefilter .Name}}     -- inside <style>
{{._html_template_urlescaper .Name}}         -- inside href/src
```

The names matter only for debugging. The point is: the same action
becomes a different escape pipeline depending on where the parser
sees it. This is why **the same value is escaped differently in
different parts of one template** — and why `html/template` is safe
even when `text/template` is not.

## 2. The state machine

The escaper threads a `context` struct through the parse tree. The
state has four axes:

- **State**: HTML body, attribute name, attribute value, comment,
  script, style, URL, etc.
- **Delim**: which delimiter is closing the current value
  (none, single quote, double quote, space).
- **URL part**: is the action inside the scheme, host, query, etc.
- **JS context**: regex / string / div-context disambiguation
  inside JS.

You can read the source of these states in
`html/template/context.go` in the standard library. The interesting
artifact: the escaper does enough HTML/JS/CSS parsing to know where
it is, but only enough to *escape*. It is not a real HTML parser
and will refuse templates that look ambiguous (e.g., an action that
spans the boundary between two contexts, like inside a partial
attribute name).

## 3. Errors from the escaper

Run this:

```go
const t = `<a href="{{.}}">x</a>`
template.Must(template.New("x").Parse(t)).Execute(os.Stdout, "javascript:alert(1)")
// Output: <a href="#ZgotmplZ">x</a>
```

`#ZgotmplZ` is the escaper's "I refused this URL" sentinel. The
value passed `template.URLQueryEscaper` checks but failed the scheme
whitelist, so the escaper substituted a placeholder.

Other diagnostics:

| Symptom | Meaning |
|---------|---------|
| `cannot use html.Attr in non-attribute context` | You marked a value as `template.HTMLAttr` but it landed in element body |
| `partial escape sequence in URL` | An action splits a percent-encoded byte across actions |
| `... in unquoted attr` | An attribute without quotes can't be safely escaped — quote it |
| `templates clone: cannot clone after execution` | You called `Clone` on a template that has already executed |

These errors come at *parse* time when the issue is structural, and
at *execute* time when it depends on the runtime value. The escaper
favours failing loudly over emitting unsafe output.

## 4. Trusted types: what they actually are

```go
type HTML string
type HTMLAttr string
type JS string
type JSStr string
type CSS string
type URL string
type Srcset string
```

Each is a `string` underneath. The escaper inspects the value's
**type**, not its content. A `string` is escaped; a `template.HTML`
is passed through.

This means *creating* one of these types from user input is the
attack vector:

```go
// SAFE — string is escaped.
data.Body = userInput

// CATASTROPHE — bypasses escaping with raw user input.
data.Body = template.HTML(userInput)
```

Code review rule: **searching the codebase for `template.HTML(`,
`template.JS(`, `template.URL(`, etc., should turn up only a handful
of well-justified call sites.** Any conversion from request data
to these types is a code review red flag.

Audit pattern (with `go vet` or a custom checker):

```bash
git grep -nE 'template\.(HTML|JS|JSStr|CSS|URL|Srcset|HTMLAttr)\('
```

Each hit needs a comment explaining why the value is trustworthy at
the conversion site.

## 5. Sets, `Lookup`, `AssociatedTemplates`

A `*template.Template` is the **representative** of its set. The
"set" is the collection of all templates parsed into it (or
associated by `New` on an existing template).

```go
t := template.New("root")
t.Parse(`{{define "a"}}A{{end}}`)
t.Parse(`{{define "b"}}B{{end}}`)

a := t.Lookup("a")       // *Template, bound to the same set
fmt.Println(a == t)      // false, but they share state

t.ExecuteTemplate(w, "a", nil) // works
a.ExecuteTemplate(w, "b", nil) // also works — same set
```

Every template lookup returns a handle into the same set. Calling
`ExecuteTemplate` on any of them, with any name, works as long as
the name is in the shared set.

`New("name")` on an existing `*Template` creates a **new template
in the same set**, not a new set:

```go
parent := template.New("parent")
child := parent.New("child").Funcs(funcs)
child.Parse(`{{ .X }}`)

parent.ExecuteTemplate(w, "child", data) // works — same set
```

This is how you incrementally build a template set with shared
funcs.

## 6. `Funcs` after parse: what it does and doesn't do

```go
t, _ := template.New("x").Parse(`{{foo}}`)
// parse fails: function "foo" not defined.
```

The parser checks function *identifiers* against the FuncMap.
Adding `Funcs` after this point doesn't help — parsing already
failed.

But:

```go
t, _ := template.New("x").Funcs(template.FuncMap{"foo": func() string { return "bar" }}).Parse(`{{foo}}`)

// Later:
t.Funcs(template.FuncMap{"foo": func() string { return "BAR" }})
```

A second `Funcs` call replaces the function value at execute time.
This is **safe between parses**, **dangerous after concurrent
executes**. The runtime FuncMap is a `map`, and mutating it while
another goroutine executes the template is a data race.

If you need to swap functions at runtime, parse a new set and swap
the pointer atomically:

```go
var current atomic.Pointer[template.Template]

func reload() error {
    t, err := template.New("x").Funcs(newFuncs).Parse(src)
    if err != nil {
        return err
    }
    current.Store(t)
    return nil
}

func render(w io.Writer, data any) error {
    return current.Load().Execute(w, data)
}
```

## 7. `Clone`, `AddParseTree`, the customization escape hatches

`Clone` returns an independent copy of the template *set*. Useful
when you want to derive several specialized variants from a base:

```go
base := template.Must(template.New("base").Funcs(funcs).Parse(layout))

en, err := base.Clone()
if err != nil { return err }
en.New("greet").Parse(`Hello, {{.Name}}!`)

es, err := base.Clone()
if err != nil { return err }
es.New("greet").Parse(`Hola, {{.Name}}!`)
```

`Clone` only works **before any template in the set has executed**.
After execute, the set is in a state that's not safe to clone.

`AddParseTree` lets you splice a parse tree into the set — useful
for inserting templates programmatically rather than via a string
source. You'll see it in code-generation contexts and in tooling
that builds templates from in-memory ASTs.

```go
import "text/template/parse"

trees, err := parse.Parse("x", src, "{{", "}}", builtins)
if err != nil { return err }

t := template.New("x")
for name, tree := range trees {
    if _, err := t.AddParseTree(name, tree); err != nil {
        return err
    }
}
```

Most production code ignores this; it's there if you need it.

## 8. The `$` variable, scope, and shadowing

```
{{ $x := 1 }}
{{ range .Items }}
  {{ $x }}      -- captured from outer scope
  {{ $x := .X }} -- new $x, shadows outer
  {{ $x }}      -- the new one
{{ end }}
{{ $x }}         -- the original 1
```

Variable scope is lexical, by enclosing block. `:=` declares a new
variable; `=` reassigns. Inside a `range` or `with`, the body is its
own scope, so a `:=` declaration there does not bleed out.

`$` (without a suffix) is bound exactly once, at the start of
execution, to the root data. Even inside nested ranges, `$` is the
root, never the outer range element.

## 9. Method resolution and pointer receivers

```go
type Thing struct { id int }
func (t *Thing) Title() string { return fmt.Sprintf("#%d", t.id) }
```

When you pass a `Thing` (value) to `Execute`, the engine **cannot**
call `Title` because Go only auto-addresses an addressable receiver.
Reflection on the data sees a `Thing` value and a method set that
doesn't include `Title`. The error: "can't evaluate field Title in
type Thing".

Fix: pass `*Thing` (pointer):

```go
t.Execute(w, &thing) // now Title is in the method set
```

Or define the method on the value receiver:

```go
func (t Thing) Title() string { ... }
```

This is the same rule as elsewhere in Go reflection. It catches
people the first time.

## 10. Nil safety and `with`

`{{.User.Name}}` on a `nil` `.User` is a runtime error:

```
template: x:1:1: executing "x" at <.User.Name>: nil pointer evaluating *User.Name
```

Three defenses:

1. **`with`**: `{{with .User}}{{.Name}}{{end}}`. The body runs only
   if `.User` is non-nil and non-zero.
2. **`if`**: `{{if .User}}{{.User.Name}}{{end}}`. Verbose but
   explicit.
3. **A safe accessor method on the parent type**:

   ```go
   func (p Page) UserName() string {
       if p.User == nil { return "" }
       return p.User.Name
   }
   ```

   Then the template just uses `{{.UserName}}`.

Option 3 keeps templates tiny and pushes nil handling into Go where
the compiler helps you.

## 11. Map iteration order and stability

A `range` over a map yields **keys in lexical order**. This is a
documented guarantee in `text/template` (search "map iteration" in
the package docs). It exists so template output is deterministic.

```
{{range $k, $v := .Settings}}
  {{$k}} = {{$v}}
{{end}}
```

If `Settings` is `map[string]string{"b": 2, "a": 1}`, the output
prints `a` then `b`, every time.

For a non-string key type, the engine sorts by the string form of
the key. For maps with comparable but non-orderable keys (structs,
arrays of comparable types), the order is implementation-defined
— don't rely on it.

## 12. JSON inside `<script>` tags

This is the most common interop pattern with the front end:

```html
<script>
  window.__INITIAL_STATE__ = {{.State}};
</script>
```

`html/template` recognises script context and emits `.State` as a
JS expression, which for Go's `map[string]any`, slices, and
primitive types means a JSON-shaped literal. The escaper guarantees
no `</script>` sneaks out — strings containing that sequence are
escaped to `</script>`.

A common mistake:

```html
<!-- WRONG: action is *inside* a JS string literal. -->
<script>
  const s = "{{.State}}";
</script>
```

Now `.State` is escaped as a JS *string body*, not as a JS
expression. If `.State` is a Go `map`, you'll get the `fmt.Sprint`
form quoted, which is not what you want. Move the action outside
the quotes and let the engine decide the literal type.

## 13. SVG and inline content

`html/template` has limited awareness of SVG. Inside `<svg>`, the
escaper still treats it as HTML element body, so `{{.Title}}` in
SVG text is HTML-escaped. Attributes work the same.

But certain SVG attributes (`xlink:href`, `clip-path`, `style`)
have their own escape needs that the engine handles only partially.
For SVG with user data, default to the simpler approach:

1. Validate / sanitize SVG separately with a real SVG parser.
2. Insert the result as `template.HTML` after sanitization.

Don't rely on `html/template`'s built-in SVG handling for security
boundaries.

## 14. Hot reload, atomic swap, race-free updates

For production with hot template reload (file watcher rebuilds
templates), you need to swap the parsed set without races:

```go
import "sync/atomic"

type Renderer struct {
    set atomic.Pointer[template.Template]
}

func (r *Renderer) Reload(fsys fs.FS) error {
    t, err := template.New("base").Funcs(funcs).ParseFS(fsys, "templates/*.html")
    if err != nil {
        return err
    }
    r.set.Store(t)
    return nil
}

func (r *Renderer) Render(w io.Writer, name string, data any) error {
    return r.set.Load().ExecuteTemplate(w, name, data)
}
```

`atomic.Pointer[T]` (Go 1.19+) makes the swap lock-free. Old
in-flight executions keep using the previous set; new ones pick up
the new one. This is the right shape for any "hot reload, but make
it safe" requirement.

## 15. The `Option` flag, in detail

`Option` accepts string values like `"missingkey=error"`. Currently
the only documented option is `missingkey`, with three values:

- `default` (the default): missing map keys yield `<no value>`.
- `zero`: missing keys yield the zero value of the map's value
  type.
- `error`: missing keys cause execution to fail with an explicit
  error.

`Option` is set on the `*Template` value and applies to all
executions. To set it on a specific entry without affecting the
rest of the set, you can't — it's a per-set setting.

For new code, **always set `missingkey=error`**.

## 16. Pipelines: precedence and chaining

A pipeline is a sequence of commands separated by `|`:

```
arg | f1 | f2 arg2 | f3
```

Evaluation:

1. `arg` is the initial value.
2. `f1` is called with `arg` as its sole argument.
3. `f2` is called with `arg2` and the output of `f1`. The pipeline
   value goes as the **last** argument.
4. `f3` is called with the output of `f2`.

Chained method calls work via the same pipe rule:

```
.Items | len | printf "%d items"
```

`printf` is called with two args: `"%d items"` and the integer from
`len`. The literal goes first, the piped value last.

If you forget this and write `{{printf .X "%d"}}`, you get
"%!d(string=%d)" — not what you wanted. Format strings come first.

## 17. `RawTemplate` parse tree direct access

For tooling that wants to inspect templates without executing,
`(*template.Template).Tree` exposes the underlying `*parse.Tree`.
You can walk the AST:

```go
import "text/template/parse"

func walk(node parse.Node, depth int) {
    fmt.Printf("%s%T\n", strings.Repeat("  ", depth), node)
    if listNode, ok := node.(*parse.ListNode); ok {
        for _, n := range listNode.Nodes {
            walk(n, depth+1)
        }
    }
    // ... handle other node kinds
}

walk(tmpl.Tree.Root, 0)
```

Use cases: linters, documentation extractors, codegen that needs
to know which fields a template references. Most apps don't need
this.

## 18. Concurrency: what's safe

| Operation | Safe across goroutines? |
|-----------|-------------------------|
| `Execute` / `ExecuteTemplate` on the same `*Template` | Yes |
| `Lookup` on a parsed set | Yes |
| `Funcs` on a `*Template` already in use by `Execute` | **No** — race |
| `Parse` / `ParseFiles` / `ParseFS` while `Execute` runs | **No** — race |
| `Clone` after any `Execute` has run | Returns an error |

The safe pattern: build the set fully before serving requests, then
treat it as immutable. For dynamic updates, build a *new* set on
the side and swap a pointer (section 14).

Internal state of `*template.Template` is not protected by a mutex.
The package documentation phrases it as "templates may be executed
safely in parallel, although if parallel executions share a Writer
the output may be interleaved" — read that "in parallel" as "after
all `Parse`/`Funcs`/`Option` calls are done."

## 19. Errors, wrapped

`Execute` returns errors of type `template.ExecError`:

```go
type ExecError struct {
    Name string // template that failed
    Err  error  // underlying cause
}
```

`Unwrap()` returns `Err`, so `errors.Is`/`errors.As` work:

```go
var ee *template.ExecError
if errors.As(err, &ee) {
    log.Printf("template %s failed: %v", ee.Name, ee.Err)
}
```

Custom function errors propagate as the inner `Err`. This lets you
attach typed errors from your code, then unwrap them at the
top-level handler:

```go
funcs["loadUser"] = func(id int) (User, error) {
    u, err := db.User(id)
    if err != nil {
        return User{}, fmt.Errorf("load user %d: %w", id, err)
    }
    return u, nil
}
```

(But: don't actually do DB calls in templates — see middle.md, §5.)

## 20. Where `text/template` and `html/template` actually differ

A short list of the runtime-visible differences:

1. **Auto-escape**: `html/template` escapes; `text/template` doesn't.
2. **Trusted types**: `template.HTML` etc. are recognised by
   `html/template` only.
3. **`#ZgotmplZ` sentinel**: only `html/template` can produce it.
4. **Parse rejects ambiguous HTML**: `html/template` rejects some
   templates the text version accepts (actions in unquoted
   attribute values, partially escaping URLs).
5. **`URLQueryEscaper` and friends**: built-ins that auto-escape
   values for specific contexts; `text/template` provides them but
   you have to call them yourself.

Apart from those, the two are interface-compatible — you could
imagine writing code that works against an interface and accepts
either. In practice, you pick one per file based on the output
content type.

## 21. A worked example: the Markdown trap

```go
import "github.com/yuin/goldmark"

type Post struct {
    Title    string
    BodyHTML template.HTML
}

func render(p *Post, src string) {
    var buf bytes.Buffer
    if err := goldmark.Convert([]byte(src), &buf); err != nil {
        return
    }
    p.BodyHTML = template.HTML(buf.String()) // !!! audit point
}
```

The Markdown library produces HTML. We wrap it in `template.HTML`
to pass through the auto-escape. **This is only safe if Markdown
input is sanitized.** A user submitting Markdown like

```
[click](javascript:alert(1))
```

results in `<a href="javascript:alert(1)">click</a>`, which then
flows out as `template.HTML` — bypassing every defense.

The fix: run the Markdown output through a sanitizer
(`bluemonday.UGCPolicy()` is the standard choice) before wrapping.

```go
clean := bluemonday.UGCPolicy().Sanitize(buf.String())
p.BodyHTML = template.HTML(clean)
```

`template.HTML` means "I have validated this." Any code path that
constructs a `template.HTML` value from external data without an
intervening sanitizer is a bug.

## 22. Where the docs say "do not"

Three rules buried in the package docs that catch experienced
developers:

1. **Don't pass user input to a template parser.** `Parse` takes a
   template *source*, not data. A user-controlled template means
   the user controls execution: they can call any registered
   function, walk any data they have access to, and (with a custom
   function set) reach further. Parse only trusted sources.

2. **Don't rely on `html/template` to escape inside CDATA, SVG
   `<foreignObject>`, or other XML islands.** The escaper's HTML
   parser is conservative; complex constructs may slip through. If
   you need to emit those, sanitize separately.

3. **Don't assume `Execute` is atomic on errors.** A failure
   mid-execute may have already written bytes to the writer. For
   HTTP responses, render to a buffer, then copy on success.

## 23. What's next

- [professional.md](professional.md) — production patterns: render
  pipelines, structured error pages, CSP, fuzz testing.
- [specification.md](specification.md) — exact action grammar and
  function reference.
- [find-bug.md](find-bug.md) — failures across all of the topics
  above.
- [optimize.md](optimize.md) — measurement, allocation reduction,
  caching tactics.
