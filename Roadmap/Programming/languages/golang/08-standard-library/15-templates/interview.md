# 8.15 `text/template` and `html/template` — Interview

> Twenty-five questions that separate "I've used templates" from "I
> understand what the engine is doing." Each question lists a likely
> follow-up.

## 1. Why are there two template packages? What's the actual difference?

`text/template` writes substituted values verbatim. `html/template`
wraps the same parser/runtime with **contextual auto-escaping**: the
escaper walks the parse tree as if rendering, tracks an HTML/JS/CSS/URL
state machine, and inserts escape calls per action based on the
context the action sits in.

**Follow-up.** "What does 'contextual' mean here?" → The same value is
escaped differently depending on whether it lands in element body,
attribute value, inside `<script>`, inside `<style>`, or inside a URL
attribute. One template, multiple escape pipelines.

## 2. When is it safe to use `text/template`?

When the output is not HTML and will not be interpreted by a browser.
Plain-text emails, config files (TOML, YAML, INI), Dockerfiles, k8s
manifests, generated Go source. **Never** for HTML or for SQL queries
(use parameter binding for queries).

**Follow-up.** "What about HTML email?" → Still `html/template`.
Modern email clients render HTML; XSS in an email is XSS.

## 3. Walk me through what happens when you call `Parse` on `html/template`.

1. The text is lexed and parsed by `text/template/parse` into a
   parse tree.
2. `html/template` walks the tree as if rendering, tracking context.
3. At every action, it inserts wrapper functions (one per context)
   that escape the value at execute time.
4. The rewritten tree is stored in the template set.

The escape happens at execute time but the *decision* of which
escape function to use is made at parse time. That's how the engine
knows the same `{{.X}}` should be HTML-escaped in one spot and
JS-escaped elsewhere.

**Follow-up.** "What if the action is in an ambiguous context?" →
Parse fails with an explicit error. The engine rejects templates it
can't escape safely.

## 4. What is `template.HTML`, and when should it be used?

`template.HTML` is `type HTML string`. The auto-escaper detects the
type via reflection and writes the value verbatim instead of
escaping. It is used to inject pre-trusted HTML — output of a
sanitized Markdown renderer, for instance.

**Follow-up.** "Where's the danger?" → Conversion from user-controlled
data: `template.HTML(userInput)` reintroduces XSS. Audit every
conversion.

## 5. What does `#ZgotmplZ` mean?

It's the sentinel `html/template` writes when it refuses to emit a
URL because the scheme isn't whitelisted (e.g., `javascript:`). The
literal value is intentional and Google-able. If you see it in your
output, an action in URL context received a value that didn't look
safe.

**Follow-up.** "How do you bypass it intentionally?" → Convert the
value to `template.URL`. That tells the engine you've vetted it.

## 6. Custom functions — when do they have to be registered?

Before `Parse`. The parser resolves function identifiers by name; if
a name isn't in the FuncMap at parse time, parsing fails.
`Funcs` after `Parse` updates the function values used at execute
time, but it can't make a parse-time-failed template valid.

**Follow-up.** "Is `Funcs` after `Parse` safe to call concurrently?"
→ No. The internal map can be mutated, which races with executing
goroutines. Build a new template set and swap atomically.

## 7. What does `omitempty` look like in templates? (Trick question.)

Templates have no `omitempty`. That's a `encoding/json` tag. In
templates, you guard with `{{if .X}}...{{end}}` or `{{with .X}}...{{end}}`.

**Follow-up.** "How do you skip a block when a slice is empty?" →
`{{range .Items}}...{{end}}` skips the body for empty slices. Use
`{{else}}` to render an alternative.

## 8. What's the difference between `range` and `with`?

`range` iterates a slice/array/map/channel; the dot is rebound to the
current element. `with` evaluates a single expression and binds the
dot to it iff non-zero. Both have an `else` clause.

**Follow-up.** "Why would I use `with` instead of `if`?" → `with`
avoids repeating `.User.X` for several `X`s and gives you a built-in
nil guard. `if` doesn't rebind the dot.

## 9. Inside a `range`, how do I get to the parent context?

`$` is the root data, bound at execute start. To get the immediate
parent context (one level up), declare a variable before entering
the range:

```
{{$page := .}}
{{range .Items}}
  {{.Name}} on {{$page.Title}}
{{end}}
```

**Follow-up.** "Is `$` re-bound by inner loops?" → No. `$` is the
root, period. Even three `range`s deep, `$` is the data passed to
`Execute`.

## 10. How does method resolution work? Why might `{{.Foo}}` fail?

Reasons it can fail:

1. `Foo` doesn't exist (typo, or the type doesn't have that field).
2. `Foo` is unexported.
3. `Foo` is a method but on a `*T` receiver and the dot is a `T`
   value (not addressable).
4. `Foo` returns more than `(value, error)`.

**Follow-up.** "How do you debug case 3?" → Pass `&value` to
`Execute`, or define the method on the value receiver.

## 11. What happens when `range`-ing over a Go map in a template?

Iteration is in **lexical key order**, not random. This is a
deliberate `text/template` guarantee, the opposite of Go's runtime
`for k, v := range m`.

**Follow-up.** "Why?" → So template output is deterministic for a
given input. Tests, golden files, caching all depend on this.

## 12. What does `{{- .X -}}` do? When is it useful?

The hyphens trim whitespace (including newlines) from the
surrounding text — `-{{` strips trailing whitespace of the preceding
text, `-}}` strips leading whitespace of the following text.

Useful for generating compact YAML, JSON, code (where extra blank
lines matter) or for keeping HTML output tight.

**Follow-up.** "Mandatory space?" → `{{-.X}}` is a parse error. The
hyphen needs a space before the action body.

## 13. What does `Option("missingkey=error")` do, and why bother?

It changes the behavior when you index a map with a missing key. By
default, the result is the literal string `<no value>`. With
`missingkey=error`, execution fails. For services, this catches
typos in templates as test failures rather than as `<no value>` in
production HTML.

**Follow-up.** "Does it apply to struct fields?" → No. Struct field
access on a missing field is always an error, regardless of this
option.

## 14. How do you pass two values to a sub-template?

There's no native multi-arg template invocation; `{{template "name"
.}}` passes one value as the dot. Build a small map (or a struct):

```go
funcs["dict"] = func(kv ...any) (map[string]any, error) { ... }
```

```
{{template "card" (dict "title" .T "user" .U)}}
```

**Follow-up.** "Why doesn't `text/template` ship with `dict`?" →
Minimalist by design. Most projects ship one in their FuncMap.

## 15. Walk me through the layout pattern.

Base template uses `{{block "name" .}}default{{end}}` for parts
pages may override. Each page is a separate set:

```go
files := []string{"layouts/base.html", "partials/...", "pages/page.html"}
t, _ := template.ParseFS(fsys, files...)
t.ExecuteTemplate(w, "base.html", data)
```

The page file has `{{define "name"}}...{{end}}` for each block it
overrides. Because each page is its own set, two pages can both
`define "content"` without colliding.

**Follow-up.** "Why per-page sets?" → Otherwise the second page's
`define "content"` clobbers the first. Per-page isolation is the
standard solution.

## 16. How do you deal with template hot reload in dev but cache in prod?

Inject the FS at construction and have a `Reload` method. In dev,
call it on every render (or via a watcher). In prod, call it once at
startup and cache in an `atomic.Pointer[Template]`. Same code, two
configurations.

**Follow-up.** "How do you make reload race-free?" →
`atomic.Pointer[T]` for the swap. In-flight executions keep the old
set; new ones pick up the new.

## 17. What's the right way to render to an HTTP response?

Buffer first, then copy on success:

```go
var buf bytes.Buffer
if err := t.Execute(&buf, data); err != nil {
    http.Error(w, "error", 500)
    return
}
w.Header().Set("Content-Type", "text/html; charset=utf-8")
buf.WriteTo(w)
```

If you write straight into `w` and execution fails halfway, you've
already sent partial bytes and possibly a `200` status. You can't
recover.

**Follow-up.** "Memory cost?" → Bounded by page size. For typical
HTML pages this is invisible. For huge exports, stream directly.

## 18. What's the FuncMap-after-Parse trap?

`Funcs` works two ways:

1. Before `Parse`: registers names so the parser can resolve them.
   Required.
2. After `Parse`: replaces function values used at execute time.
   Allowed but races with concurrent `Execute`.

People discover this by registering `Funcs` after parse, getting a
"function not defined" error, and being confused. Register before
parse, always.

**Follow-up.** "How do you swap functions in production safely?" →
Build a new template set with the new FuncMap and atomic-swap.

## 19. What's the difference between `Execute` and `ExecuteTemplate`?

`Execute` runs the template whose name matches the receiver. With
`New("x").Parse(...)`, that's `"x"`. `ExecuteTemplate` runs a
specific named entry from the set, which is what you want when you
parsed multiple files (each becomes a named entry).

**Follow-up.** "What's the name when you `ParseFiles("a.html", "b.html")`?"
→ The receiver's name is `"a.html"` (basename of the first file). The
set also contains `"b.html"`.

## 20. What's `Lookup` for?

`Lookup(name)` returns a `*Template` handle to the named entry, or
`nil` if it doesn't exist. Use it for optional templates (a partial
that may or may not be defined) or to share function maps across
multiple specialized templates.

**Follow-up.** "What does it return for missing?" → `nil`, not an
error. Distinguishes "not present" from "present and empty."

## 21. Why does the docs warn against passing user-supplied template sources to `Parse`?

A template author can call any registered function, walk any data
the executor passes, and build outputs of any shape. With a custom
FuncMap that includes anything I/O-related (a "loadFile" helper),
this becomes RCE-adjacent. Templates are not a sandbox.

**Follow-up.** "If I really need user-edited templates, how?" →
Strict FuncMap (no I/O, no DB), `missingkey=error`, and an
allowlist-only template feature set. Be very careful.

## 22. What happens if I `defer` `Close` after `Execute`?

Templates don't need a `Close`. The writer might. Close the writer
yourself if you opened it. The template engine doesn't own any
resource that needs closing.

**Follow-up.** "What about `bufio.Writer`?" → If you wrap the
response in `bufio.Writer`, flush before letting it go out of scope.
`Execute` writes through; if you forget `Flush`, the tail of the
output is lost.

## 23. What's the JSON-in-script-tag pattern?

```html
<script>
  window.__INITIAL__ = {{.State}};
</script>
```

`html/template` recognises script context. The action emits `.State`
as a JS expression — a JSON-shaped literal for maps/slices, a
quoted JS string for Go strings. Strings containing `</script>` are
escaped to `</script>`, so you can't break out of the tag.

**Follow-up.** "Should the action be inside quotes?" → No. Outside,
let the engine pick the literal type. Inside, you're forcing it into
string-body escaping which usually isn't what you want.

## 24. How do you test that auto-escape is actually working?

Render with adversarial data and assert the output doesn't contain
the attack payload:

```go
data := Page{Title: "<script>alert(1)</script>"}
var buf bytes.Buffer
tmpl.Execute(&buf, data)
if strings.Contains(buf.String(), "<script>") {
    t.Error("escape regression")
}
```

For higher coverage, add a fuzz test that generates random strings
and asserts no `<script>`, `javascript:`, or event-handler patterns
in the output.

**Follow-up.** "What's the failure mode this catches?" → A
`template.HTML(...)` conversion creeping in via a refactor or a
new FuncMap entry returning `template.HTML`.

## 25. What's the single most common bug?

Using `text/template` for HTML, or its modern equivalent: wrapping
user input in `template.HTML`. Every other template bug is fixable
in code review. XSS is the one that ships and gets exploited.

**Follow-up.** "How do you catch it in CI?" → A grep for
`template.HTML(`, `template.JS(`, etc., in the codebase, with each
hit requiring a justification comment. Plus the fuzz test from #24.

## Bonus: rapid-fire

- "What does `{{ . }}` print?" → The current dot's `fmt.Sprint` form.
- "Can you call methods that take arguments?" → Yes. Space-separated.
- "Default whitespace behavior?" → Literal text, including newlines, is preserved.
- "Are templates safe for concurrent execution?" → Yes, after parsing. Don't mutate concurrently.
- "What's `template.Must`?" → Convenience wrapper that panics on parse error. For startup-time templates.
- "What does `ParseFS` give you that `ParseFiles` doesn't?" → `embed.FS` and `fstest.MapFS` support.
- "Why no `==` operator?" → Templates use prefix functions: `{{eq .X "y"}}`.
- "Are there ternaries?" → No. Use `{{if}}{{else}}{{end}}`.
- "Can templates import each other?" → Indirectly, via `define`/`template` within the same set.
- "What's the size of a `*Template`?" → Roughly the parse tree plus FuncMap pointers — a few KB for typical templates.
