# 8.15 `text/template` and `html/template` — Professional

> **Audience.** You run a service in production where templates are
> on the request path. This file is a checklist of patterns that
> prevent the failures that take services down: partial-render leaks,
> XSS regressions, hot-reload races, FuncMap drift, content-type
> mismatches, and slow startup from glob explosion.

## 1. The render-to-buffer-first rule

```go
func RenderHTML(t *template.Template, w http.ResponseWriter, name string, data any) {
    var buf bytes.Buffer
    if err := t.ExecuteTemplate(&buf, name, data); err != nil {
        log.Printf("render %s: %v", name, err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    w.Header().Set("X-Content-Type-Options", "nosniff")
    w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
    buf.WriteTo(w)
}
```

Why this order:

1. If `ExecuteTemplate` fails halfway, no bytes have reached the
   client. You can return a clean 500.
2. `Content-Length` is exact — the client knows when the body ends
   without `Transfer-Encoding: chunked`.
3. The buffer lets you compute and verify content invariants
   (e.g., pass through a CSP-aware HTML rewriter) before sending.

The cost: peak memory grows with page size. For HTML pages of
reasonable size (dozens of KB), this is invisible. For huge dumps
(100k-row CSV), see section 7 on streaming.

## 2. Pool the buffer

`bytes.Buffer` allocations show up in pprof on render-heavy
services. Pool them:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func render(t *template.Template, w http.ResponseWriter, name string, data any) {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    if err := t.ExecuteTemplate(buf, name, data); err != nil {
        log.Printf("render %s: %v", name, err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    buf.WriteTo(w)
}
```

Watch the pool size: a `sync.Pool` doesn't bound itself. If your
average page is 10 KB but one outlier is 5 MB, that 5 MB buffer
might stick around in the pool. For predictable bounds, drop
oversized buffers before returning them:

```go
const maxPooledBuf = 64 * 1024
if buf.Cap() > maxPooledBuf {
    return // let GC reclaim it
}
bufPool.Put(buf)
```

## 3. The atomic-swap reload pattern

Production services need to update templates without a full
restart. The shape:

```go
type Engine struct {
    set     atomic.Pointer[template.Template]
    fsys    fs.FS
    funcs   template.FuncMap
    options []string
}

func NewEngine(fsys fs.FS, funcs template.FuncMap) (*Engine, error) {
    e := &Engine{fsys: fsys, funcs: funcs, options: []string{"missingkey=error"}}
    if err := e.Reload(); err != nil {
        return nil, err
    }
    return e, nil
}

func (e *Engine) Reload() error {
    t := template.New("base").Funcs(e.funcs).Option(e.options...)
    t, err := t.ParseFS(e.fsys, "templates/*.html", "templates/**/*.html")
    if err != nil {
        return err
    }
    e.set.Store(t)
    return nil
}

func (e *Engine) Render(w io.Writer, name string, data any) error {
    return e.set.Load().ExecuteTemplate(w, name, data)
}
```

Workflow:

1. Boot: parse once, fail-fast if a template is broken.
2. SIGHUP / admin endpoint / file watcher: call `Reload`. Failures
   leave the previous set intact; success swaps in the new one.
3. In-flight requests keep using the old `*Template` until they
   finish. New requests pick up the new one.

Pitfall: if `Reload` is exposed via an HTTP endpoint, gate it. A
public `/reload` endpoint that re-parses on every hit is a
denial-of-service vector.

## 4. Watching the filesystem

For dev workflows, a file watcher pulls double duty: see changes,
trigger a reload.

```go
import "github.com/fsnotify/fsnotify"

func watchAndReload(e *Engine, dir string) error {
    w, err := fsnotify.NewWatcher()
    if err != nil {
        return err
    }
    if err := w.Add(dir); err != nil {
        return err
    }
    go func() {
        for ev := range w.Events {
            if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename) != 0 {
                if err := e.Reload(); err != nil {
                    log.Printf("reload: %v", err)
                }
            }
        }
    }()
    return nil
}
```

Add debouncing if your editor writes the file in two stages
(common with vim's atomic-rename + temp-file behavior).

## 5. Content-Type discipline

The browser decides what kind of content it received from headers
and (sometimes) sniffing. Two headers go together:

```go
w.Header().Set("Content-Type", "text/html; charset=utf-8")
w.Header().Set("X-Content-Type-Options", "nosniff")
```

`X-Content-Type-Options: nosniff` tells the browser to trust the
Content-Type and not sniff the body. Without it, a misclassified
JSON response that happens to start with `<!doctype html>` can be
treated as HTML — which means the auto-escape that protects you
when you said HTML is irrelevant if the browser interprets your
JSON as HTML.

For each response type:

| Output | Content-Type |
|--------|--------------|
| Page from `html/template` | `text/html; charset=utf-8` |
| API response | `application/json; charset=utf-8` |
| Plain text email | `text/plain; charset=utf-8` |
| CSV | `text/csv; charset=utf-8` |
| XML/RSS | `application/xml; charset=utf-8` or `application/rss+xml` |
| Generated config | depends on the tool — `application/yaml`, etc. |

For HTML always also set:

```go
w.Header().Set("Content-Security-Policy", csp)
w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
```

The CSP works in concert with `html/template`. The auto-escaper
prevents direct injection; the CSP catches the injection that
slipped through (e.g., via a `template.HTML` wrap around bad input).
Defence in depth.

## 6. CSP and inline scripts

If your CSP forbids `'unsafe-inline'`, embedded `<script>...</script>`
in templates won't run. Three options:

1. **External scripts only.** Move all JS to `.js` files, link with
   `<script src="...">`.
2. **Per-response nonces.** Generate a random nonce per request,
   embed it in the CSP and on every `<script>`:

   ```go
   nonce := randomNonce()
   w.Header().Set("Content-Security-Policy",
       "script-src 'self' 'nonce-"+nonce+"'")
   data.Nonce = nonce
   ```

   Then in the template:

   ```html
   <script nonce="{{.Nonce}}">
     window.x = {{.X}};
   </script>
   ```

3. **SHA hashes.** Compute the hash of every inline script body at
   build time and add `'sha256-...'` to your CSP. Less flexible but
   no per-request work.

For high-throughput services, option 3 is a nice fit because the
CSP is a static header.

## 7. Streaming for big payloads

Some outputs don't fit in memory. CSV exports, NDJSON dumps, log
tails. For those, accept partial-error trade-offs and stream:

```go
func ExportCSV(t *template.Template, w http.ResponseWriter, rows iter.Seq[Row]) error {
    w.Header().Set("Content-Type", "text/csv; charset=utf-8")
    w.Header().Set("Content-Disposition", `attachment; filename="export.csv"`)

    bw := bufio.NewWriter(w)
    defer bw.Flush()

    for row := range rows {
        if err := t.Execute(bw, row); err != nil {
            // Headers are sent. Best we can do is log and stop.
            log.Printf("csv export: %v", err)
            return err
        }
    }
    return nil
}
```

Three things are different from the buffered case:

1. `Content-Length` is unknown — the response is `Transfer-Encoding:
   chunked`.
2. A mid-export error can't change the status code (already sent).
   Log it; surface the truncated file as a partial download.
3. `bufio.Writer` is essential — you don't want a write syscall per
   row.

## 8. The error page itself

Your error pages are templates too. Don't render them with the
same engine in a way that recurses:

```go
// Pseudo: render, on failure render an error page with the same engine.
func render(w http.ResponseWriter, name string, data any) {
    var buf bytes.Buffer
    if err := tmpl.ExecuteTemplate(&buf, name, data); err != nil {
        renderError(w, "Internal error") // recurses if this also fails
        return
    }
    buf.WriteTo(w)
}
```

If `renderError` itself uses `tmpl`, a broken error template
silently fails. Two safer shapes:

1. **Pre-rendered static error pages.** Render `error500.html` and
   `error404.html` at startup into byte slices. Serve those when a
   live render fails.
2. **Plain-text fallback.** When the dynamic template fails, fall
   back to a hard-coded plain-text body:

   ```go
   func writeFallback(w http.ResponseWriter, code int, msg string) {
       w.Header().Set("Content-Type", "text/plain; charset=utf-8")
       w.WriteHeader(code)
       fmt.Fprintln(w, msg)
   }
   ```

A live error page that itself can fail is a hidden second source of
500s.

## 9. Auditing trusted-type conversions

Catch unsafe `template.HTML` constructions in CI:

```bash
# As a pre-commit hook or a CI step:
git grep -nE 'template\.(HTML|JS|JSStr|CSS|URL|Srcset|HTMLAttr)\([^"]'
```

This regex matches conversions whose argument isn't a string
literal. Each hit demands review; allowlist via a comment:

```go
// SAFETY: bluemonday.UGCPolicy().Sanitize was applied above.
p.Body = template.HTML(clean)
```

Linters like `golangci-lint`'s custom rules or `analysistool` can
encode the same check programmatically.

## 10. Fuzz tests for the escaper

`html/template` has a great safety record, but a fuzzer is cheap
and protects against the rare regression in your own code (e.g., a
new FuncMap entry that returns `template.HTML`).

```go
func FuzzRender(f *testing.F) {
    f.Add("hello", "world")
    f.Fuzz(func(t *testing.T, title, body string) {
        var buf bytes.Buffer
        err := tmpl.Execute(&buf, struct{ Title, Body string }{title, body})
        if err != nil {
            return // execution errors are fine; the test is for output
        }
        out := buf.String()
        for _, danger := range []string{"<script>", "javascript:", "onerror="} {
            if strings.Contains(strings.ToLower(out), danger) {
                t.Fatalf("auto-escape failed for inputs %q/%q: output %q", title, body, out)
            }
        }
    })
}
```

Run for an hour with `go test -fuzz=. -fuzztime=1h`. Add to CI as a
short fuzz step (`-fuzztime=30s`) on each PR.

## 11. Avoid `text/template` for HTML, ever

Reiterating because it bears repeating. There is no use case where
`text/template` is the right choice for HTML output. If you find
code like:

```go
import "text/template"

t := template.Must(template.New("page").Parse(htmlSrc))
t.Execute(w, data) // unsafe
```

…rewrite to `html/template`. The syntax is the same; the change is
one import line. The benefit is several orders of magnitude in
safety.

A weaker warning: don't *mix* the two on the same value. If you
build a partial with `text/template` and pass its output as
`template.HTML` into an `html/template` page, you've reintroduced
the XSS the engine was trying to prevent.

## 12. Logging and tracing

Wrap renders in your tracing layer:

```go
func (e *Engine) Render(ctx context.Context, w io.Writer, name string, data any) error {
    span := trace.SpanFromContext(ctx)
    span.SetAttributes(attribute.String("template.name", name))
    start := time.Now()

    err := e.set.Load().ExecuteTemplate(w, name, data)

    span.SetAttributes(attribute.Int64("template.duration_ns", time.Since(start).Nanoseconds()))
    if err != nil {
        span.RecordError(err)
    }
    return err
}
```

Per-template render duration is a great latency signal: a slow
endpoint is often a slow template, not a slow database.

## 13. Glob explosions and parse time

A naive `template.ParseGlob("templates/**/*.html")` (with a
double-star pattern via `doublestar.Glob`) can pull in hundreds of
files, each parsed even if no request will ever render it. On
startup with cold disk caches, this is noticeable.

Three remedies:

1. **Parse on first use** (with a `sync.Once`-guarded loader):

   ```go
   func (e *Engine) load(name string) (*template.Template, error) {
       e.mu.Lock()
       defer e.mu.Unlock()
       if t, ok := e.cache[name]; ok {
           return t, nil
       }
       t, err := template.ParseFS(e.fsys, "layouts/base.html", "partials/*.html", "pages/"+name+".html")
       if err != nil {
           return nil, err
       }
       e.cache[name] = t
       return t, nil
   }
   ```

   Trade-off: first request after deploy is slower; failures show
   up only when the broken template is requested.

2. **Embed-and-walk**: at compile time, walk the embed tree and
   generate a Go init that parses each file. The compiler enforces
   that all templates parse successfully.

3. **Incremental warmup**: at startup, parse the highest-traffic
   templates eagerly; lazy-load the rest.

## 14. Versioned templates

For services that A/B test page layouts:

```go
type TemplateSet struct {
    Default *template.Template
    Variants map[string]*template.Template
}

func (ts *TemplateSet) Pick(req *http.Request) *template.Template {
    if v := req.Header.Get("X-Variant"); v != "" {
        if t, ok := ts.Variants[v]; ok {
            return t
        }
    }
    return ts.Default
}
```

Variants share the FuncMap and are parsed at startup. Each
experiment is a sibling directory under `templates/`, picked per
request via header or feature flag.

## 15. The data DTO discipline

Pass concrete struct types to `Execute`, not `map[string]any`. Two
reasons:

1. **Compile-time safety.** A typo in `data["Tittle"]` is silent;
   `Page{Tittle: ...}` fails to compile.
2. **Reflection cost.** `reflect.Value.MapIndex` is much slower than
   `reflect.Value.FieldByIndex`. On hot paths this is measurable.

Add a `// renders templates/page.html` comment on the DTO so
reviewers can find the contract:

```go
// PageData renders templates/pages/page.html.
type PageData struct {
    Title string
    User  *User
    Items []Item
    Year  int
}
```

For pages with many optional sections, keep the struct flat with
booleans:

```go
type PageData struct {
    Title       string
    ShowSidebar bool
    Sidebar     SidebarData
    ShowAds     bool
    Ads         []Ad
}
```

Then the template guards each section:

```
{{if .ShowSidebar}}{{template "sidebar" .Sidebar}}{{end}}
```

## 16. Tests for the contract

Goldens for output, table tests for edge cases, and a fuzz for
escape regression. The combination catches:

- Output drift (golden mismatch).
- Missing-key typos (with `missingkey=error`, the test fails
  loudly).
- Auto-escape regressions (fuzz).
- Function signature drift (a custom function whose signature
  changes will fail to parse if the template still uses the old
  shape).

Layer them so a refactor that breaks the template gives you a
specific test failure pointing at exactly what changed.

## 17. Deployment: parse failures and rollback

Templates parse at boot. A typo in a template that didn't get
caught in CI takes down the service on next start. Defenses:

1. **Smoke-render in CI.** A test that calls `Reload()` on the
   real templates directory and renders each page with a synthetic
   data struct. Failures block merge.
2. **Atomic deploys.** Build the binary with `embed.FS` so the
   templates ship inside the executable. There is no
   "templates-on-disk-from-the-old-version-vs-new-binary" mismatch.
3. **Health check that renders.** The `/healthz` endpoint renders
   a known-good template; failures are visible to the load
   balancer.

## 18. Production checklist

When you ship a service that uses `html/template` on the request
path:

- [ ] `html/template`, not `text/template`, for all HTML.
- [ ] `Option("missingkey=error")` set.
- [ ] Templates embedded via `embed.FS`, not loaded from disk.
- [ ] Render-to-buffer-first; only flush on success.
- [ ] `Content-Type: text/html; charset=utf-8` on every render.
- [ ] `X-Content-Type-Options: nosniff` on every render.
- [ ] CSP configured; nonces generated per request if you have
      inline scripts.
- [ ] Atomic-swap reload (or no live reload) — no per-request parse.
- [ ] FuncMap audited; no DB calls or panicky helpers.
- [ ] `template.HTML`/`JS`/`URL` conversions audited; each has a
      comment explaining the safety argument.
- [ ] Goldens + fuzz tests in CI.
- [ ] Pre-rendered fallback error pages for when live render fails.
- [ ] Trace span around each render for latency observability.

Eighteen items, every one a real outage someone has had.
