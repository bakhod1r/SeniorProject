# 8.15 `text/template` and `html/template` — Specification

> Quick reference. Action grammar, built-in functions, escape contexts,
> error types. For prose, see the other files in this folder.

## 1. Lexical structure

```
template = (text | action)*
action   = "{{" [ "- " ] pipeline [ " -" ] "}}"
text     = any byte not opening a "{{"
```

Whitespace trim:
- `{{- ` strips trailing whitespace (incl. newlines) of the preceding text.
- ` -}}` strips leading whitespace of the following text.
- The space between `-` and the pipeline is mandatory.

Comments:
```
{{/* comment, possibly multi-line */}}
{{- /* trims surrounding whitespace */ -}}
```

Comments do not nest.

## 2. Pipelines

```
pipeline = command ("|" command)*
command  = arg* | function arg* | method arg* | "(" pipeline ")"
arg      = literal | identifier | "." | "$" | "$" name | "." name | "." chain
```

A command is a function/method call. `|` feeds the previous command's
result as the **last** argument of the next.

Literals: `"string"`, `'r'` (rune), `1.5`, `true`, `false`, `nil`.

## 3. Action grammar

| Action | Form |
|--------|------|
| Output | `{{ pipeline }}` |
| Conditional | `{{if pipeline}} T1 {{else}} T0 {{end}}` |
| | `{{if pipeline}} ... {{else if pipeline}} ... {{else}} ... {{end}}` |
| Range | `{{range pipeline}} ... {{end}}` |
| | `{{range pipeline}} ... {{else}} ... {{end}}` |
| | `{{range $i, $v := pipeline}} ... {{end}}` |
| With | `{{with pipeline}} ... {{end}}` |
| | `{{with pipeline}} ... {{else}} ... {{end}}` |
| Define | `{{define "name"}} ... {{end}}` |
| Template invoke | `{{template "name" pipeline}}` (pipeline omitted = nil) |
| Block | `{{block "name" pipeline}} default body {{end}}` |
| Variable decl | `{{$x := pipeline}}` |
| Variable assign | `{{$x = pipeline}}` |

`block` is shorthand: `{{block "n" .}}body{{end}}` ≡ `{{define "n"}}body{{end}}{{template "n" .}}`.

## 4. Truthiness

A pipeline value is "false" iff it is the zero value of its type:

| Type | Zero |
|------|------|
| numeric | `0` |
| string | `""` |
| bool | `false` |
| pointer / interface / chan / func / map / slice | `nil` |
| array of length 0 | (always "true" if length > 0) |
| struct | always "true" |

Use `eq`/`ne`/`lt`/etc. for explicit comparisons; struct values cannot
be tested by `if` for emptiness.

## 5. Built-in functions

| Function | Args | Returns | Notes |
|----------|------|---------|-------|
| `and` | x1, x2, ... | first empty arg, or last | short-circuit |
| `or` | x1, x2, ... | first non-empty arg, or last | short-circuit |
| `not` | x | bool | empty → true |
| `eq` | a, b1, b2, ... | bool | true if a equals any b |
| `ne` | a, b | bool | |
| `lt`, `le`, `gt`, `ge` | a, b | bool | comparable types |
| `len` | x | int | string/slice/array/map/chan |
| `index` | x, k1, k2, ... | element | nested indexing |
| `slice` | x, i, j (, k) | sub-slice | strings, arrays, slices |
| `print` | ... | string | like `fmt.Sprint` |
| `printf` | format, ... | string | like `fmt.Sprintf` |
| `println` | ... | string | like `fmt.Sprintln` |
| `urlquery` | s | string | RFC 3986 percent-encoded |
| `js` | s | string | JS-safe escape (text/template; auto in html/template) |
| `html` | s | string | HTML-safe escape (text/template; auto in html/template) |
| `call` | fn, arg1, ... | result | invoke a function value at runtime |

Comparison functions accept arbitrary types but require compatible
kinds (numeric vs numeric, string vs string). Mismatched kinds are an
execute-time error.

## 6. `html/template` extra escapers

Used by the auto-escape rewriter; rarely called by hand:

| Function | Context |
|----------|---------|
| `html` / `HTMLEscaper` | HTML element body and quoted attribute |
| `js` / `JSEscaper` | inside `<script>` outside string literal |
| `urlquery` / `URLQueryEscaper` | inside `?key=...` query parts |
| internal `_html_template_*` | per-context wrappers inserted into the parse tree |

You usually don't reference these. Use trusted-string types
(section 9) when you need to *bypass* escaping.

## 7. Comparison rules in detail

`eq a b`:
- both numeric kinds → numeric equality (handles int/uint/float mixed)
- both string → byte equality
- both bool → boolean equality
- both nil-interface → true
- otherwise → reflect.DeepEqual

`eq a b1 b2 b3`: short-circuits, true if `a` equals any of the rest.

## 8. Variable scope

```
{{$x := 1}}
{{range .Items}}
    {{$x := 2}}        -- new $x, local to this range body
    {{$x = 3}}         -- assigns to the new $x
{{end}}
{{$x}}                  -- still 1
```

`$` (no name) is bound once, at the start of execution, to the data
value passed to `Execute`. It is in scope everywhere.

## 9. Trusted string types (`html/template` only)

| Type | Underlying | Used for |
|------|------------|----------|
| `template.HTML` | `string` | element body / attribute (raw) |
| `template.HTMLAttr` | `string` | `name="value"` attribute clause |
| `template.JS` | `string` | JS expression inside `<script>` |
| `template.JSStr` | `string` | inside a JS string literal |
| `template.CSS` | `string` | inside `<style>` or `style=""` |
| `template.URL` | `string` | inside `href`, `src`, etc. |
| `template.Srcset` | `string` | inside `srcset=""` |

A value of one of these types **bypasses** auto-escaping in its
context. A value of `string` is escaped. The type is checked via
reflection at execute time.

Conversion `template.HTML(userInput)` is the XSS attack vector. Audit
all such conversions.

## 10. Auto-escape contexts

`html/template` recognises (paraphrased from `context.go`):

| Context | Triggered by | Example |
|---------|--------------|---------|
| HTML body | between tags | `<p>{{.X}}</p>` |
| Attribute name | unfinished tag | rare; usually rejected at parse |
| Attribute value | inside `"..."` or `'...'` | `<a class="{{.X}}">` |
| URL | href, src, action, formaction, etc. | `<a href="{{.X}}">` |
| JS | inside `<script>` | `<script>x={{.X}}</script>` |
| JS string | inside JS quotes | `<script>x="{{.X}}";</script>` |
| CSS | inside `<style>` or `style=""` | `<div style="color: {{.X}}">` |
| Comment | inside `<!-- ... -->` | content is dropped |

Templates that mix actions across context boundaries (e.g.,
`<{{.Tag}}>` to control element name) are rejected at parse with a
clear error.

## 11. URL handling specifics

In URL contexts, `string` values:
1. Are URL-escaped where needed.
2. Have their scheme checked. Schemes other than `http`, `https`,
   `mailto`, `tel`, etc. cause the value to be replaced with
   `#ZgotmplZ`.

`template.URL` values:
1. Bypass scheme checking.
2. Are still URL-escaped to prevent breaking out of the attribute.

## 12. Parse functions

```go
func New(name string) *Template
func (*Template) New(name string) *Template          // sibling in same set
func (*Template) Parse(text string) (*Template, error)
func ParseFiles(filenames ...string) (*Template, error)
func (*Template) ParseFiles(filenames ...string) (*Template, error)
func ParseGlob(pattern string) (*Template, error)
func (*Template) ParseGlob(pattern string) (*Template, error)
func ParseFS(fsys fs.FS, patterns ...string) (*Template, error)
func (*Template) ParseFS(fsys fs.FS, patterns ...string) (*Template, error)
func Must(t *Template, err error) *Template
```

`ParseFS` was added in Go 1.16 alongside `embed`. It is the modern
choice.

`ParseFiles` and friends use the **basename** of each path as the
template name in the resulting set. Two files with the same basename
collide.

## 13. Execute functions

```go
func (*Template) Execute(wr io.Writer, data any) error
func (*Template) ExecuteTemplate(wr io.Writer, name string, data any) error
```

`Execute` runs the template whose name matches the receiver's. Use
`ExecuteTemplate` to run a different named entry from the set.

Both write directly to the writer. Errors mid-execute leave partial
output. Render to a buffer if that matters.

## 14. Set management

```go
func (*Template) Lookup(name string) *Template     // nil if not found
func (*Template) Templates() []*Template            // all in the set
func (*Template) Name() string
func (*Template) Clone() (*Template, error)         // deep copy of the set
func (*Template) AddParseTree(name string, tree *parse.Tree) (*Template, error)
func (*Template) Funcs(funcMap FuncMap) *Template   // before parse
func (*Template) Option(opts ...string) *Template
func (*Template) Delims(left, right string) *Template
```

`Delims("[[", "]]")` lets you change the action delimiters. Useful when
your output language already uses `{{` `}}` (e.g., Vue, Mustache, some
templating in JS).

## 15. Options

| Option | Effect |
|--------|--------|
| `missingkey=default` | (default) print `<no value>` for missing map key |
| `missingkey=zero` | use the zero value of the map's value type |
| `missingkey=error` | abort execution with a clear error |

`Option` may be called multiple times; later calls override earlier
ones for the same option name.

## 16. Errors

| Error | Source | Meaning |
|-------|--------|---------|
| `*template.ExecError` | `Execute`/`ExecuteTemplate` | Wraps the underlying cause; has `Name` (template) and `Err` (cause) |
| Parse error | `Parse`/`ParseFiles`/`ParseGlob`/`ParseFS` | Lexer/parser/escaper error; message includes line/column |
| `template: ... in unquoted attr` | escaper | Action in an attribute that has no quotes — quote the attribute |
| `template: ... unsafe URL` | escaper | URL action with a value the engine refuses; check the trusted-types audit |

`ExecError`'s `Unwrap` returns `Err`, so `errors.Is`/`errors.As` work.

## 17. Method invocation rules

A method `Foo` on the dot is callable from `{{.Foo}}` if:

1. It is exported (uppercase).
2. It has 0 or more arguments.
3. It returns 1 value, or 2 with the second being `error`.

The pointer-receiver vs value-receiver rule applies as in normal Go:
to call a `*T`-receiver method, the dot must be addressable. Pass
pointers, not values, when methods are on `*T`.

Variadic methods (`func (T) Format(...string) string`) are callable.
The template invocation collects positional args.

## 18. Map ordering

`range` over a `map[K]V`:

1. K is sorted by string form (string keys: lexical; numeric keys:
   numeric; otherwise: implementation-defined but deterministic
   within a single execute).
2. Iteration is single-threaded; the loop body runs in order.

This is guaranteed by `text/template`, intentionally different from
Go's runtime map iteration.

## 19. Whitespace and HTML rendering

The auto-escape state machine treats `'>' '<'` as tag boundaries.
Whitespace inside actions is the action's own; outside, it's literal
text. Use `{{- ... -}}` to remove unwanted whitespace.

`html/template`'s parser is conservative on edge constructs:

- `<![CDATA[ ... ]]>` is treated as literal HTML; actions inside go
  through HTML body escaping, which is *correct* for HTML5 but may be
  wrong if you actually need true XML CDATA.
- `<!-- ... -->` comments swallow actions; the engine refuses to put
  data inside HTML comments because the result is hard to escape
  safely.
- Conditional comments (`<!--[if IE]>`) are not specially recognised.

## 20. Cross-references

| Topic | See |
|-------|-----|
| `embed.FS` | [`../09-go-embed/`](../09-go-embed/junior.md) |
| `io/fs` | [`../14-io-fs/`](../14-io-fs/junior.md) |
| HTTP serving | [`../11-net-http-internals/`](../11-net-http-internals/junior.md) |
| `bytes.Buffer`, `io.Writer` | [`../01-io-and-file-handling/`](../01-io-and-file-handling/junior.md) |
| Official docs | [`text/template`](https://pkg.go.dev/text/template), [`html/template`](https://pkg.go.dev/html/template), [`text/template/parse`](https://pkg.go.dev/text/template/parse) |
