# 8.14 `io/fs` — Professional

> **Audience.** You ship services in production where `fs.FS` is part
> of the architecture: an HTTP server with embedded assets, a CLI
> with embedded migrations, a service that loads templates from
> multiple sources. This file covers the patterns that scale beyond
> "compiles and works on my laptop."

## 1. Architecture: `fs.FS` as a seam

The single most useful pattern at this level: every component that
reads files takes `fs.FS`, never a concrete type. This isn't about
testability alone (though that's a side effect). It's about
*deployment flexibility*.

```go
// Bad: hard-bound to embedded assets.
//go:embed templates
var templates embed.FS

func (s *Server) renderIndex(w io.Writer) error {
    return template.Must(template.ParseFS(templates, "templates/*.html")).
        ExecuteTemplate(w, "index.html", nil)
}

// Good: the server takes its assets as a dependency.
type Server struct {
    templates *template.Template
}

func NewServer(fsys fs.FS) (*Server, error) {
    tpl, err := template.ParseFS(fsys, "*.html")
    if err != nil { return nil, err }
    return &Server{templates: tpl}, nil
}
```

The good version lets you:

- Use `embed.FS` (after `fs.Sub`) in production.
- Use `os.DirFS` in development for live reload.
- Use `fstest.MapFS` in tests.
- Use a custom `OverlayFS` to combine embedded defaults with
  on-disk overrides — the common pattern for "ship defaults but
  let operators override."

All without changing `Server`. The seam is the constructor's
`fs.FS` parameter.

## 2. Layered FS for theming and overrides

A real example: a server ships a default theme as embedded assets.
Operators can drop a `theme/` directory next to the binary to
override individual files. The implementation:

```go
type Layered struct {
    layers []fs.FS // top-of-stack first
}

func (l Layered) Open(name string) (fs.File, error) {
    for _, layer := range l.layers {
        f, err := layer.Open(name)
        if err == nil {
            return f, nil
        }
        if !errors.Is(err, fs.ErrNotExist) {
            return nil, err
        }
    }
    return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func (l Layered) ReadDir(name string) ([]fs.DirEntry, error) {
    seen := map[string]fs.DirEntry{}
    for i := len(l.layers) - 1; i >= 0; i-- { // bottom-up so top wins
        entries, err := fs.ReadDir(l.layers[i], name)
        if err != nil && !errors.Is(err, fs.ErrNotExist) {
            return nil, err
        }
        for _, e := range entries {
            seen[e.Name()] = e
        }
    }
    out := make([]fs.DirEntry, 0, len(seen))
    for _, e := range seen {
        out = append(out, e)
    }
    sort.Slice(out, func(i, j int) bool { return out[i].Name() < out[j].Name() })
    return out, nil
}
```

Wire it:

```go
//go:embed all:assets
var defaults embed.FS

func loadAssets() fs.FS {
    base, _ := fs.Sub(defaults, "assets")
    if _, err := os.Stat("./theme"); err == nil {
        return Layered{layers: []fs.FS{os.DirFS("./theme"), base}}
    }
    return base
}
```

That's a deploy-time decision: ship the binary, optionally drop
a directory, restart. No rebuild.

## 3. HTTP serving: the production checklist

`http.FileServerFS(fsys)` is correct out of the box. To make it
production-grade, wrap it:

```go
func staticHandler(fsys fs.FS, buildID string) http.Handler {
    base := http.FileServerFS(fsys)
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. ETag from the build ID — same for the lifetime of the binary.
        w.Header().Set("ETag", `"`+buildID+`"`)

        // 2. Long cache for hashed-name assets, short for unhashed.
        if strings.Contains(r.URL.Path, ".v") {
            w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
        } else {
            w.Header().Set("Cache-Control", "public, max-age=300")
        }

        // 3. No directory listings.
        if strings.HasSuffix(r.URL.Path, "/") {
            http.NotFound(w, r)
            return
        }

        base.ServeHTTP(w, r)
    })
}
```

The four things to add over the bare file server:

1. **ETag** for conditional GETs. Embedded assets have `ModTime ==
   zero`, so `Last-Modified` is useless; an ETag is the substitute.
2. **`Cache-Control`** that matches your filename strategy. If
   your build pipeline produces hashed filenames (`main.v3a4f.css`),
   they are immutable and can be cached forever; everything else
   gets a short TTL.
3. **No directory listings** unless you want them. The default
   shows them.
4. **Compression** — see section 4.

Build with `-ldflags "-X main.buildID=$(git rev-parse HEAD)"` and
the ETag changes per release.

## 4. Pre-compressed assets

A 1 MiB JSON file embedded uncompressed costs 1 MiB of binary and
1 MiB on the wire. Pre-compress at build time:

```go
//go:embed all:dist
var dist embed.FS // contains foo.css and foo.css.gz

func serveStatic(w http.ResponseWriter, r *http.Request) {
    name := strings.TrimPrefix(r.URL.Path, "/static/")
    accepts := r.Header.Get("Accept-Encoding")
    if strings.Contains(accepts, "gzip") {
        if data, err := fs.ReadFile(dist, "dist/"+name+".gz"); err == nil {
            w.Header().Set("Content-Encoding", "gzip")
            w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
            w.Write(data)
            return
        }
    }
    data, err := fs.ReadFile(dist, "dist/"+name)
    if err != nil {
        http.NotFound(w, r)
        return
    }
    w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
    w.Write(data)
}
```

Production pipelines run gzip and brotli at build time, embed both,
and pick the matching encoding at serve time. No per-request CPU
cost for compression.

## 5. Observability: counting opens

A simple wrapper that meters every `Open` call:

```go
type metered struct {
    base  fs.FS
    opens *prometheus.CounterVec
}

func (m *metered) Open(name string) (fs.File, error) {
    f, err := m.base.Open(name)
    label := "ok"
    if errors.Is(err, fs.ErrNotExist) { label = "missing" } else if err != nil { label = "error" }
    m.opens.WithLabelValues(label).Inc()
    return f, err
}
```

Useful for discovering which embedded files are actually used in
production vs which are dead weight — trim the `//go:embed`
patterns and shrink the binary. For byte-level metrics, wrap the
returned `fs.File` to count `Read` totals.

## 6. Watching for changes (development only)

`fs.FS` itself is read-only and stateless. For live reload during
development, wrap `os.DirFS` in a type that watches with `fsnotify`
and increments an atomic revision counter; templates re-parse
when the counter changes. Production with `embed.FS` doesn't
need any of this — the binary is the snapshot. Use a build tag
(`//go:build dev`) to keep the watcher out of production
binaries.

## 7. SQL migrations from an `fs.FS`

A common production pattern, covered briefly in `09-go-embed/middle.md`:

```go
//go:embed migrations/*.sql
var migrationsFS embed.FS

func runMigrations(ctx context.Context, db *sql.DB, fsys fs.FS) error {
    entries, err := fs.ReadDir(fsys, ".")
    if err != nil { return err }
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].Name() < entries[j].Name()
    })

    for _, e := range entries {
        if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
            continue
        }
        sqlBytes, err := fs.ReadFile(fsys, e.Name())
        if err != nil { return err }

        if err := applyMigration(ctx, db, e.Name(), string(sqlBytes)); err != nil {
            return fmt.Errorf("migration %s: %w", e.Name(), err)
        }
    }
    return nil
}
```

The function takes `fs.FS`. In production:

```go
sub, _ := fs.Sub(migrationsFS, "migrations")
runMigrations(ctx, db, sub)
```

In tests:

```go
fsys := fstest.MapFS{
    "001_init.sql": &fstest.MapFile{Data: []byte("CREATE TABLE ...")},
    "002_add_index.sql": &fstest.MapFile{Data: []byte("CREATE INDEX ...")},
}
runMigrations(ctx, db, fsys)
```

Same code; different sources. For migration tooling that handles
rollback and locking, libraries like `golang-migrate/migrate`
accept `fs.FS` directly via `iofs.New(fsys, ".")`.

## 8. Defaulting to embedded with on-disk override

For a single-file override, try `os.ReadFile(name)` first; on
`fs.ErrNotExist` fall back to `fs.ReadFile(defaultsFS, name)`.
For a tree of overrides, use the layered FS from section 2
instead.

## 9. The `sub` and `prefix` mistake

Cleanest sin in HTTP serving: forgetting `fs.Sub` *or* forgetting
`http.StripPrefix`, leading to 404s. The diagnosis flow:

1. URL `/static/main.css` requested.
2. `http.StripPrefix("/static/", handler)` rewrites it to
   `main.css`.
3. The handler queries the FS for `main.css`.
4. The FS contains `static/main.css` (embedded with prefix).
5. `Open("main.css")` returns `ErrNotExist`.
6. 404.

Fix: `fs.Sub(fsys, "static")` turns the FS into one rooted at
`static/`. Now step 3 finds `main.css` at the FS root. Both
`fs.Sub` and `StripPrefix` are usually needed; one without the
other is a 404 generator.

To debug, dump the FS:

```go
fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
    fmt.Println(p)
    return nil
})
```

If the output starts with `static/main.css`, you need `fs.Sub`. If
it starts with `main.css`, you need only `StripPrefix`.

## 10. Concurrency: opening many files

Most `fs.FS` implementations are safe for concurrent `Open`. The
returned `File` values are not safe for concurrent `Read`. So if
you want parallel reads, open one file per goroutine:

```go
func parallelLoad(fsys fs.FS, names []string) (map[string][]byte, error) {
    var mu sync.Mutex
    out := make(map[string][]byte, len(names))
    g, _ := errgroup.WithContext(context.Background())
    g.SetLimit(8)
    for _, name := range names {
        name := name
        g.Go(func() error {
            data, err := fs.ReadFile(fsys, name)
            if err != nil { return err }
            mu.Lock()
            out[name] = data
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

For `os.DirFS`, each goroutine opens its own `*os.File` —
parallel reads are real parallel I/O. For `embed.FS`, each
`ReadFile` is just a byte-slice copy — parallel "reads" are
parallel `memcpy`, often dominated by allocator contention.

## 11. The `fs.FS` interface and dependency injection

When your service has many components that read files, pass
`fs.FS` as a constructor parameter, not as a global. The server
type holds an `fs.FS` field; `main` wires in `embed.FS` (or
`os.DirFS` for dev); tests pass `fstest.MapFS`. The component
itself never knows the source.

## 12. Loading once at startup vs reading per-request

For small assets accessed often (templates, JSON config), load
once at startup, hold the parsed result, never touch the FS at
request time:

```go
type Server struct {
    tpl *template.Template
}

func New(fsys fs.FS) (*Server, error) {
    tpl, err := template.ParseFS(fsys, "*.html")
    if err != nil { return nil, err }
    return &Server{tpl: tpl}, nil
}

func (s *Server) HandleHome(w http.ResponseWriter, r *http.Request) {
    s.tpl.ExecuteTemplate(w, "home.html", nil)
}
```

For larger assets accessed sometimes (images, downloads), let
`http.FileServerFS` stream them lazily — don't preload into
memory.

The deciding question: what fraction of the asset will be
accessed per request? Templates: 100% per request. CSS: 100% per
request. Per-page images: maybe 10% per request. Don't preload
the 10% case; serve it lazily.

## 13. `fs.FS` and contexts

`fs.FS.Open` does not take a `context.Context`. For local disk,
embedded, or in-memory implementations, operations are short and
context-free is fine. For remote-backed FS (S3, HTTP), the
abstraction leaks: a `Read` taking seconds can't be cancelled
without breaking the interface. Workarounds: aggressive caching
at startup, file wrappers that honor an external context, or
timeouts inside `Open`. None are perfect; `fs.FS` works best for
file-like sources, less well for object-store sources.

## 14. What to read next

- [specification.md](specification.md) — interface reference.
- [find-bug.md](find-bug.md) — drills based on the patterns in
  this file.
- [optimize.md](optimize.md) — performance work for `fs.FS`-based
  code.
- [`../15-templates/`](../15-templates/junior.md) — `template.ParseFS` in
  detail.
