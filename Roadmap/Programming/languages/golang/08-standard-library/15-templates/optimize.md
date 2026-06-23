# 8.15 `text/template` and `html/template` — Optimize

> Where the time and allocations actually go, and how to bring both
> down without sacrificing safety. Numbers below come from Go 1.22 on
> an M1 mac unless noted; ratios are stable across hardware.

## 1. The two costs

For a typical HTML template (~500 actions, ~5 KB of source):

- **Parse**: ~30–80 µs. Includes lexing, parsing, and (for
  `html/template`) the contextual-escape rewrite. Allocates ~50–200 KB
  of parse-tree nodes that live forever.
- **Execute**: ~2–10 µs per render against a moderate struct. The
  reflection cost dominates; the actual byte-writes are fast.

**The optimization rule of thumb**: parse zero-or-one times, execute
many times. Any code path that re-parses on each request is the
biggest win available before you optimize anything else.

## 2. Parse once at startup

```go
var tmpl = template.Must(
    template.New("base").
        Option("missingkey=error").
        Funcs(funcs).
        ParseFS(fsys, "templates/*.html"),
)
```

Package-level `var` with `template.Must`. Parsing happens at init,
errors crash the program before serving traffic. After this, every
`Execute` reads the parse tree without touching the parser.

For services with hot reload, parse into a *new* `*Template` and
swap atomically (see [professional.md](professional.md), §3). Don't
mutate the in-use template.

## 3. Pass concrete struct types, not maps

Reflection on a struct field is ~5 ns. Reflection on a map key is
~100 ns. For a template with 50 actions, that's a 5 µs vs 100 µs
gap on the dot-walks alone.

```go
// Slow: map.
data := map[string]any{
    "Title": "Home",
    "Items": items,
    "User":  user,
}

// Fast: struct.
type PageData struct {
    Title string
    Items []Item
    User  User
}
```

Bonus: the struct gives you compile-time safety on field names —
typos fail to compile instead of producing `<no value>`.

## 4. Cache reflect.Type lookups (rarely needed)

The runtime caches reflection lookups internally. You usually don't
need to do anything. The places where a hand-written cache helps:

- A custom function called many times per render that does
  `reflect.TypeOf(x)` itself.
- A complex pre-render data shaping step that uses `reflect`
  directly.

Profile first. Premature reflection caching is a great way to
introduce subtle bugs without measurable wins.

## 5. Pool `bytes.Buffer`

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(t *template.Template, w io.Writer, name string, data any) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer func() {
        if buf.Cap() <= 64*1024 {
            bufPool.Put(buf)
        }
    }()
    if err := t.ExecuteTemplate(buf, name, data); err != nil {
        return err
    }
    _, err := buf.WriteTo(w)
    return err
}
```

The `Cap() <= 64*1024` check prevents one outlier 5 MB page from
sticking around in the pool.

Measured impact: on a render-heavy benchmark (5k req/s), pooling
buffers drops allocations/op from ~80 to ~5, which translates to
visibly less GC pressure under sustained load.

## 6. Strip per-request reflection where you can

A custom function called inside a `range` of 1k items is invoked
1k times per render. If the function takes an `any`, every call
incurs reflection. Tighten the type:

```go
// Reflection per call.
funcs["fmtCents"] = func(v any) string {
    return fmt.Sprintf("$%.2f", reflect.ValueOf(v).Int())
}

// No reflection.
funcs["fmtCents"] = func(c int64) string {
    return fmt.Sprintf("$%.2f", float64(c)/100)
}
```

The template engine still uses reflection to invoke the function —
but the function body itself doesn't have to.

## 7. Watch for `printf` overuse

`{{printf "%s: %d" .Key .Value}}` is convenient but allocates a
`[]any{...}` per call to pass to `fmt.Sprintf`. For hot paths,
prefer:

- Raw concatenation when the format is simple: `{{.Key}}: {{.Value}}`
- A dedicated formatter function that takes typed args.

Each `printf` save in a 1k-item range saves ~1 ns × 1k = 1 µs and
several KB of allocations per render.

## 8. Streaming vs buffer-first

For tiny outputs (< 1 KB), the difference is noise. For large
exports, streaming saves memory. For HTML pages, **buffer first**:
the cost of holding a 50 KB page in RAM is dwarfed by the safety
of being able to swap to an error response on render failure.

```go
// Streaming (use only for huge outputs you can't fail mid-way on).
t.Execute(w, data)

// Buffered (default for HTML).
var buf bytes.Buffer
if err := t.Execute(&buf, data); err != nil { ... }
buf.WriteTo(w)
```

## 9. Avoid `MarshalJSON` on every render

A common pattern: pass a Go map to the template, which then `printf`s
it — under the hood, `fmt.Sprintf("%v", m)` walks the map. Now do
that 1k times per render and your hot path is `runtime.mapiter*`.

```go
// Slow: every render walks the map twice (once for sorting, once for printing).
{{ range $k, $v := .Settings }} ... {{ end }}

// Faster, if the map is per-request: pre-shape the data.
type Setting struct { Key, Val string }
data.Settings = sortedSettings(rawMap) // []Setting, sorted once
{{ range .Settings }} ... {{ end }}
```

Slices iterate without sort, without map-key allocation, without
reflection on key types.

## 10. Method calls vs field access

Field access on a struct is ~5 ns of reflection. A method call
that does any work is whatever-the-method-does plus ~50 ns of
reflection-call overhead.

If a value is computed once per render, **compute it before
`Execute`** and pass the result as a field:

```go
// Method called once per render — fine.
func (p Page) FormattedDate() string { return p.Date.Format("Jan 2") }

// Method called inside a 10k-row range — bad.
{{range .Rows}}{{.FormattedFoo}}{{end}}  // 10k method calls

// Better: pre-format.
type DisplayRow struct {
    Foo string // already formatted
}
```

## 11. Trim the FuncMap

Each entry in the FuncMap is consulted at parse time and at execute
time. A 500-entry FuncMap isn't slow, but unused entries clutter
audits. Keep only what you actually call.

## 12. Avoid recursive `template`

```
{{define "node"}}
  <li>{{.Name}}{{if .Children}}<ul>
    {{range .Children}}{{template "node" .}}{{end}}
  </ul>{{end}}</li>
{{end}}
```

For small trees: fine. For deeply nested trees (thousands of nodes
deep): the Go stack grows per recursive `template` call (each
allocates a frame in the engine's evaluator). You may exhaust it on
large recursive calls.

For very deep recursive structures, consider flattening to a list
with depth markers and rendering with a single `range`.

## 13. Benchmark your own templates

```go
func BenchmarkRenderHome(b *testing.B) {
    data := makeTestData()
    var buf bytes.Buffer
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        buf.Reset()
        if err := tmpl.ExecuteTemplate(&buf, "home.html", data); err != nil {
            b.Fatal(err)
        }
    }
}
```

Run with `go test -bench=. -benchmem`. The `B/op` and `allocs/op`
columns are where you focus. Aim for:

- **B/op**: roughly the size of the rendered output (page bytes).
- **allocs/op**: < 50 for a moderate page. Drops to ~5 with
  buffer pooling.

If allocs/op is 200+ for a 5 KB page, you have a `printf` that's
boxing values into `[]any`, or a map being walked, or a method
returning a freshly allocated string each time.

## 14. Profile the hot render

```go
import _ "net/http/pprof"

go func() { http.ListenAndServe("localhost:6060", nil) }()
```

Hit your service under load, then `go tool pprof
http://localhost:6060/debug/pprof/profile?seconds=30`. Look for:

- `text/template.(*state).walk*` — pure execute time.
- `reflect.Value.MapIndex` — map-shaped data, switch to structs.
- `runtime.makeslice` from `[]any` boxing — `printf` overuse.
- `fmt.Sprintf` — same.

Look for: anything in `text/template/parse.*`. If you see parse
functions in a profile of a running service, you have a parse-on-render
bug.

## 15. Custom write paths

For maximum throughput, you can implement `io.WriterTo` on a custom
data type and have the template's range body just call `{{.}}`,
which the engine writes via `fmt.Fprint`, which respects
`io.WriterTo`:

```go
type Row [3]string

func (r Row) WriteTo(w io.Writer) (int64, error) {
    var n int
    for i, s := range r {
        if i > 0 {
            m, _ := io.WriteString(w, ",")
            n += m
        }
        m, _ := io.WriteString(w, s)
        n += m
    }
    m, _ := io.WriteString(w, "\n")
    return int64(n + m), nil
}
```

The template `{{range .Rows}}{{.}}{{end}}` then writes each row
without going through reflection on its fields. This is exotic and
rarely worth the contortion; reach for it only after profiling
shows the bottleneck.

## 16. Compare `text/template` vs `html/template` cost

Execute time is similar. Parse time differs: `html/template` runs
the contextual-escape rewrite, adding ~2x parse time on
HTML-heavy templates.

If you have non-HTML templates that don't need escaping (config
files, emails), use `text/template` — you save the parse cost
*and* you don't pay the auto-escape function lookups at execute time.

But: never trade `text/template` for `html/template` on HTML output
to save a microsecond. The XSS defense is worth orders of magnitude
more than the speedup.

## 17. Caching rendered output

If a template's output for a given input is stable, cache the
output, not the data:

```go
type CacheKey struct {
    Page    string
    UserID  int
    Version int
}

var renderCache, _ = lru.New[CacheKey, []byte](1024)

func render(key CacheKey, data PageData) ([]byte, error) {
    if cached, ok := renderCache.Get(key); ok {
        return cached, nil
    }
    var buf bytes.Buffer
    if err := tmpl.Execute(&buf, data); err != nil {
        return nil, err
    }
    out := buf.Bytes()
    renderCache.Add(key, out)
    return out, nil
}
```

Cache invalidation: bump `Version` on any deploy that changes the
template (or the data shape). Or hash the template source plus the
data into the key.

## 18. Final checklist

1. Parse once at startup, atomic-swap on reload.
2. `Option("missingkey=error")` set.
3. Pass concrete structs, not maps.
4. Pool `bytes.Buffer` if render is on the hot path.
5. Strip `printf` from inner ranges.
6. Pre-format display strings when called inside large ranges.
7. Buffer-first for HTML; stream only for huge exports.
8. Profile before optimizing further; most templates are fast
   enough that the work above is plenty.

The biggest single win remains "don't re-parse on every request."
Everything else is incremental from there.
