# 8.9 `embed` and `//go:embed` — Middle

> **Audience.** You've shipped at least one program that embeds files
> and you're now writing a service that takes embedding seriously: a
> static site, a templated web app, a CLI with embedded migrations.
> This file covers the patterns that come up once embedding is in
> production: composing `embed.FS` with `io/fs`, serving HTTP correctly
> without a real `mtime`, parsing templates from globs, dual-mode
> dev/prod loading, and the small set of gotchas that separate working
> code from frustrating debugging.

## 1. `embed.FS` is an `io/fs.FS`

`embed.FS` implements three `io/fs` interfaces:

```go
var _ fs.FS         = embed.FS{}
var _ fs.ReadFileFS = embed.FS{}
var _ fs.ReadDirFS  = embed.FS{}
```

That single fact is why `embed` slots into the standard library so
cleanly. Anywhere you see a function that takes `fs.FS`, you can pass
your `embed.FS` directly:

| Caller | Method |
|--------|--------|
| `text/template` | `ParseFS(fsys fs.FS, patterns ...string)` |
| `html/template` | `ParseFS(fsys fs.FS, patterns ...string)` |
| `net/http` | `http.FS(fs fs.FS)` |
| `io/fs` | `fs.WalkDir`, `fs.ReadFile`, `fs.ReadDir`, `fs.Sub`, `fs.Glob` |
| `testing/fstest` | `fstest.TestFS(fsys, expected...)` |

Code that takes `fs.FS` is also instantly testable: pass an
`fstest.MapFS` in tests, an `embed.FS` in production. That dual-mode
pattern is the single biggest reason to design APIs around `fs.FS`
when embedding is in the picture.

## 2. `fs.Sub` — root the view at a subdirectory

When you embed a directory, the directory name is part of every path.
`embed.FS` keeps `templates/index.html`, not `index.html`. For HTTP
serving and for templates that reference each other by basename, you
usually want the prefix gone. `fs.Sub` does that:

```go
//go:embed assets
var assetsFS embed.FS

// Without Sub: paths look like "assets/css/main.css"
// With Sub:    paths look like "css/main.css"
sub, err := fs.Sub(assetsFS, "assets")
if err != nil { return err }

http.Handle("/", http.FileServer(http.FS(sub)))
```

`fs.Sub` returns an `fs.FS`, not an `embed.FS`. That's fine for almost
everything, because any consumer in the stdlib is written against
`fs.FS`. If you need the concrete embed type for some reason, keep the
original around alongside the sub view.

## 3. Serving static files: `http.FS` and `http.StripPrefix`

The minimal pattern:

```go
//go:embed static
var staticFS embed.FS

sub, _ := fs.Sub(staticFS, "static")
http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(sub))))
```

Three things are happening:

1. `fs.Sub(staticFS, "static")` strips the `static/` directory prefix
   *inside* the FS, so requests for `main.css` find `static/main.css`.
2. `http.StripPrefix("/static/", ...)` strips the URL prefix *before*
   the handler sees the path, so `/static/main.css` becomes
   `/main.css` for the file server.
3. `http.FS(...)` adapts an `fs.FS` (no concept of paths-with-leading-slash)
   into an `http.FileSystem` (which expects paths starting with `/`).

Forget any one of those three and you'll see 404s. The most common
mistake: dropping `fs.Sub` and wondering why `/static/static/main.css`
is the only URL that works.

## 4. ETags and `Last-Modified` without a real `mtime`

Embedded files report `time.Time{}` from `Stat().ModTime()`. That
breaks two things in `http.FileServer`:

- **`Last-Modified` header.** `net/http` writes `Last-Modified` from
  the file's `ModTime`. Zero time produces no usable value, so caches
  fall back to revalidating every request.
- **`If-Modified-Since` handling.** With no `Last-Modified`, conditional
  GETs cannot short-circuit, and you re-send the full body every time.

You have two practical fixes:

**Option A: derive an ETag from the build.** Use a build-time variable
plus the file path:

```go
var buildID = "dev" // overridden via -ldflags at build time

func staticHandler(fsys fs.FS) http.Handler {
    fileServer := http.FileServer(http.FS(fsys))
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("ETag", `"`+buildID+`"`)
        w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
        fileServer.ServeHTTP(w, r)
    })
}
```

Build with `go build -ldflags "-X main.buildID=$(git rev-parse HEAD)"`
and every asset gets the same ETag for the lifetime of the binary. New
binary = new ETag = clients refresh.

**Option B: hash each file.** Walk the FS at startup, compute SHA-256
per file, store the hex prefix as the ETag. More accurate, more
startup cost, more memory:

```go
type asset struct {
    bytes []byte
    etag  string
}

func loadAssets(fsys fs.FS) (map[string]asset, error) {
    out := map[string]asset{}
    err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
        if err != nil || d.IsDir() { return err }
        b, err := fs.ReadFile(fsys, path)
        if err != nil { return err }
        sum := sha256.Sum256(b)
        out[path] = asset{bytes: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
        return nil
    })
    return out, err
}
```

Option A is fine for most apps. Option B is what you reach for when
you want per-file invalidation (e.g., immutable URLs with a hash in
the filename).

## 5. Templates: `ParseFS` with globs

`text/template.ParseFS` and `html/template.ParseFS` both take an
`fs.FS` and one or more glob patterns:

```go
//go:embed templates/*.html templates/partials/*.html
var tplFS embed.FS

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html", "templates/partials/*.html"))
```

The pattern syntax is `path.Match`, so `*` is a single segment, `?`
is a single character, no `**` recursion. If you want a recursive
parse, walk the FS yourself:

```go
func parseAll(fsys fs.FS, root string) (*template.Template, error) {
    tpl := template.New("")
    err := fs.WalkDir(fsys, root, func(path string, d fs.DirEntry, err error) error {
        if err != nil || d.IsDir() { return err }
        if !strings.HasSuffix(path, ".html") { return nil }
        b, err := fs.ReadFile(fsys, path)
        if err != nil { return err }
        _, err = tpl.New(path).Parse(string(b))
        return err
    })
    return tpl, err
}
```

The template's name is the full path. To execute, call
`tpl.ExecuteTemplate(w, "templates/index.html", data)`. If you'd
rather drop the prefix, use `fs.Sub` first and walk the subview.

## 6. Pattern matching, exactly

The patterns supported by `//go:embed` and by `fs.Glob` follow
`path.Match`:

| Pattern | Matches |
|---------|---------|
| `*` | Any sequence of non-separator characters in one segment |
| `?` | One non-separator character |
| `[abc]` | Any one of `a`, `b`, `c` |
| `[a-z]` | Any character in the range |
| `\*` | A literal `*` |

Things that are **not** supported:

- `**` — there is no recursive glob. To embed a tree, name the
  directory: `//go:embed assets` is recursive by virtue of being a
  directory, but `assets/**/*.css` is a syntax error.
- `{a,b}` brace expansion.
- Negation (`!pat`).

The directive accepts multiple patterns in one line or across lines.
For complex sets, prefer multiple lines; they read better and produce
the same result.

## 7. Dual-mode: dev (live reload) vs prod (embedded)

In development, you want template changes to appear without
recompiling. In production, you want everything embedded. The
canonical pattern uses a build tag and a small switch:

```go
// fs_dev.go
//go:build dev

package assets

import (
    "io/fs"
    "os"
)

func FS() fs.FS {
    return os.DirFS("./assets")
}
```

```go
// fs_prod.go
//go:build !dev

package assets

import (
    "embed"
    "io/fs"
)

//go:embed all:assets
var assetsFS embed.FS

func FS() fs.FS {
    sub, err := fs.Sub(assetsFS, "assets")
    if err != nil { panic(err) }
    return sub
}
```

`go build` produces an embedded binary; `go build -tags dev` produces
one that reads from disk. The rest of your code calls `assets.FS()`
and never knows the difference.

If you skip the build tag and want a pure runtime switch, accept an
`fs.FS` parameter and pass either implementation from `main`:

```go
func newServer(fsys fs.FS) *Server { /* ... */ }
```

## 8. Cross-platform path normalization

The path you pass to `embed.FS.Open` and friends is always
forward-slash-separated, regardless of OS. The compiler stores files
that way and the runtime never translates them.

```go
// CORRECT on Linux, macOS, and Windows
data, _ := tplFS.ReadFile("templates/admin/edit.html")

// WRONG even on Windows — embed paths use /
data, _ := tplFS.ReadFile("templates\\admin\\edit.html")
```

If you build paths from runtime values (e.g., a directory walk on
disk), use `path` (forward-slash) for embed paths and `path/filepath`
(OS-native) for disk paths. Mixing them produces "no such file" errors
that look like bugs in `embed` but aren't.

```go
// Walking disk and querying embed:
rel, _ := filepath.Rel(diskRoot, diskPath)
embedPath := filepath.ToSlash(rel) // normalize for embed lookup
data, _ := embedFS.ReadFile(embedPath)
```

`filepath.ToSlash` is the bridge between the two worlds.

## 9. Walking embedded trees

`fs.WalkDir` works the same as on a real filesystem:

```go
err := fs.WalkDir(staticFS, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() {
        return nil
    }
    info, err := d.Info()
    if err != nil { return err }
    fmt.Printf("%s (%d bytes)\n", path, info.Size())
    return nil
})
```

`d.Info()` returns an `fs.FileInfo`. Size is real; `ModTime()` is
zero; `Mode()` is `0o444` for files (read-only) and `0o555|fs.ModeDir`
for directories. The mode is documented and stable — code that asserts
on it is fine.

To prune a subtree (say, skip `_drafts`), return `fs.SkipDir`:

```go
if d.IsDir() && strings.HasPrefix(d.Name(), "_") {
    return fs.SkipDir
}
```

## 10. Reading a single file: three equivalent calls

```go
// Method on embed.FS
data, err := myFS.ReadFile("path/to/file")

// Function from io/fs (works on any fs.FS)
data, err := fs.ReadFile(myFS, "path/to/file")

// Open then read (pre-1.16 style)
f, err := myFS.Open("path/to/file")
if err != nil { return err }
defer f.Close()
data, err := io.ReadAll(f)
```

Pick the package-level `fs.ReadFile` when your function takes a
generic `fs.FS` — it doesn't tie you to `embed`. Pick the method when
you have an `embed.FS` directly and want one less import.

## 11. Memory model: who owns the bytes

When you call `embed.FS.ReadFile`, the returned `[]byte` is a fresh
copy. You can modify it without affecting the embedded data. Each call
copies again — the embed bytes themselves live in the binary's
read-only data section.

When you call `embed.FS.Open` and then `io.ReadAll`, you also get a
fresh copy via the buffer.

This is mostly invisible, but matters for two reasons:

1. **You cannot accidentally corrupt the embedded data.** Modifying
   the slice you got is fine; it doesn't write back.
2. **Reading the same file repeatedly allocates each time.** For a
   hot path, cache the bytes once and reuse them.

```go
var indexHTML = mustReadFile(tplFS, "templates/index.html") // read at init

func mustReadFile(fsys fs.FS, name string) []byte {
    b, err := fs.ReadFile(fsys, name)
    if err != nil { panic(err) }
    return b
}
```

## 12. `fs.FileServer` quirks: directory listings and `index.html`

`http.FileServer` does two things that surprise people:

- For requests ending in `/`, it serves `index.html` from that
  directory. If `index.html` doesn't exist, it generates an HTML
  directory listing instead.
- A request for a directory *without* a trailing slash gets a 301
  redirect to add the slash.

For an embedded site, the directory listing is rarely what you want.
Either ensure every directory has an `index.html` or wrap the file
server to disable listings:

```go
type noListing struct{ fs http.FileSystem }

func (n noListing) Open(name string) (http.File, error) {
    f, err := n.fs.Open(name)
    if err != nil { return nil, err }
    info, err := f.Stat()
    if err != nil { f.Close(); return nil, err }
    if info.IsDir() {
        idx := strings.TrimSuffix(name, "/") + "/index.html"
        if _, err := n.fs.Open(idx); err != nil {
            f.Close()
            return nil, fs.ErrNotExist
        }
    }
    return f, nil
}
```

Wrap with `http.FileServer(noListing{http.FS(myFS)})`.

## 13. SQL migrations from an embedded directory

A common pattern for CLIs and services that own their schema:

```go
//go:embed migrations/*.sql
var migrations embed.FS

func runMigrations(db *sql.DB) error {
    entries, err := fs.ReadDir(migrations, "migrations")
    if err != nil { return err }
    for _, e := range entries {
        if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") { continue }
        sqlBytes, err := fs.ReadFile(migrations, "migrations/"+e.Name())
        if err != nil { return err }
        if _, err := db.Exec(string(sqlBytes)); err != nil {
            return fmt.Errorf("migration %s: %w", e.Name(), err)
        }
    }
    return nil
}
```

`fs.ReadDir` returns entries in lexical order, so naming files
`001_create.sql`, `002_add_index.sql` works. If you need ordering by a
parsed prefix, read the names, sort them yourself, and replay.

For real migration tooling (rollback, locking, history table),
libraries like `golang-migrate/migrate` accept an `fs.FS` directly:

```go
import "github.com/golang-migrate/migrate/v4/source/iofs"

src, _ := iofs.New(migrations, "migrations")
m, _ := migrate.NewWithSourceInstance("iofs", src, dbURL)
m.Up()
```

The `iofs` source means embedded migrations and disk migrations look
identical to the migrator.

## 14. Tests: `embed.FS` plus `fstest.TestFS`

`testing/fstest.TestFS` validates that a filesystem behaves correctly:

```go
import "testing/fstest"

func TestEmbedded(t *testing.T) {
    if err := fstest.TestFS(myFS, "templates/index.html", "templates/admin/edit.html"); err != nil {
        t.Fatal(err)
    }
}
```

`TestFS` walks the FS, opens each named file, and checks that
`Stat`, `ReadFile`, and `Open` behave consistently. It's the
fastest way to confirm that your embedded patterns matched the files
you expected.

For unit tests of code that takes an `fs.FS`, use `fstest.MapFS`:

```go
fsys := fstest.MapFS{
    "config.yaml": &fstest.MapFile{Data: []byte("debug: true")},
}
loadConfig(fsys, "config.yaml")
```

You don't need to embed anything in test code. The function under test
can't tell the difference between `embed.FS` and `MapFS`.

## 15. Compression: there isn't any

`embed` stores file bytes verbatim. There is no built-in compression.
A 10 MiB JSON file becomes 10 MiB in the binary. The Go linker doesn't
gzip or zstd the embedded data section.

If binary size matters, compress *manually* before embedding and
decompress at runtime:

```go
//go:embed data.json.gz
var compressed []byte

var data = mustGunzip(compressed)

func mustGunzip(b []byte) []byte {
    gz, err := gzip.NewReader(bytes.NewReader(b))
    if err != nil { panic(err) }
    defer gz.Close()
    out, err := io.ReadAll(gz)
    if err != nil { panic(err) }
    return out
}
```

Trade-offs: smaller binary, slower startup (decompression cost), more
RAM at runtime (the decompressed copy lives in heap rather than the
binary's read-only data section). For text payloads, ratios of 3-10x
are typical with gzip; zstd does better at higher compression cost.

For static HTTP content, a more useful angle is to serve the
*compressed* bytes directly when the client supports `gzip`:

```go
//go:embed all:static.gz
var staticGz embed.FS

func handler(w http.ResponseWriter, r *http.Request) {
    if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
        w.Header().Set("Content-Encoding", "gzip")
        // serve from staticGz
    } else {
        // serve from a non-gz copy
    }
}
```

Pre-compressing at build time keeps the binary small *and* avoids
runtime gzip cost per request.

## 16. Build-time only — no dynamic embeds

`//go:embed` is fully evaluated by the compiler. Consequences:

- File names cannot contain `${...}` substitutions.
- You cannot embed a file whose path is determined at runtime.
- You cannot embed a file generated *during* the build unless your
  `go generate` step runs *before* the compile that sees the directive.

For build-time generated files, the standard pattern is `go generate`
plus a normal `//go:embed` directive that names the generated file:

```go
//go:generate go run gen.go > data.bin
//go:embed data.bin
var data []byte
```

Run `go generate ./...` before `go build`. The directive then sees
`data.bin` as a normal source file.

## 17. The "where is my file" debugging checklist

When `embed.FS.ReadFile` returns `file does not exist`:

1. Did the file actually get embedded? Add a quick `fs.WalkDir` and
   print everything to confirm what's in the FS.
2. Are you using forward slashes? `assets\foo.css` is wrong even on
   Windows.
3. Are you using the path *with* the directory prefix, or did you
   `fs.Sub` already? They're not interchangeable.
4. Is the file hidden (`.foo` or `_foo`)? Did you use `all:`?
5. Does the pattern actually match? Run `go list -f '{{.EmbedFiles}}'`
   on the package to see what the compiler picked up.

`go list -f '{{.EmbedFiles}}' ./...` is the underrated tool here. It
prints the resolved list of files for each `//go:embed` directive in
the package, no recompile needed.

## 18. What to read next

- [senior.md](senior.md) — exact directive grammar, hidden-file rules,
  fs.FS guarantees, edge cases around symlinks and special files.
- [professional.md](professional.md) — production patterns: versioning,
  large-asset strategies, build IDs, deployment with embedded assets.
- [find-bug.md](find-bug.md) — drills based on the bugs in this file.
- [`../15-templates/`](../15-templates/junior.md) — `text/template` and
  `html/template` in depth.
