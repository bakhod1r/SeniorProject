# 8.14 `io/fs` — Find the Bug

Twenty broken `fs.FS` snippets. Read each one, identify the bug,
write down the fix. Most are subtle — they compile, they appear to
work in a smoke test, and they fail in production or under
`fstest.TestFS`.

## Bug 1 — Path with leading slash

```go
func loadConfig(fsys fs.FS) ([]byte, error) {
    return fs.ReadFile(fsys, "/config.yaml")
}
```

The file is at `config.yaml` in the FS, but the call passes
`/config.yaml`. **The fix:** drop the leading slash. `fs.ValidPath`
rejects names starting with `/`. The error you'll see is
`open /config.yaml: invalid argument`.

## Bug 2 — Wrong root for `WalkDir`

```go
fs.WalkDir(fsys, "", func(path string, d fs.DirEntry, err error) error {
    fmt.Println(path)
    return nil
})
```

`""` is not a valid `fs.FS` path. The walk fails immediately with
`*fs.PathError` wrapping `fs.ErrInvalid`. **The fix:** use `"."`
for the root.

## Bug 3 — Embed prefix not stripped

```go
//go:embed templates
var templates embed.FS

var tpl = template.Must(template.ParseFS(templates, "*.html"))
// Error: pattern matches no files
```

The embedded files are at `templates/foo.html`, but the pattern
is `*.html` (root level). **The fix:** either pattern with
`templates/*.html`, or `fs.Sub(templates, "templates")` first.

## Bug 4 — `embed.FS` value receiver after mutation attempt

```go
type Cache struct {
    fs embed.FS
}

func (c *Cache) Add(name string, data []byte) {
    c.fs.ReadFile(name) // attempting to "store" — does nothing
}
```

`embed.FS` is read-only. There's no API to add files at runtime.
**The fix:** if you need a mutable FS, use a different type
(`fstest.MapFS` for tests, your own `map[string][]byte` for
production caches).

## Bug 5 — `fs.Sub` with directory not in FS

```go
sub, err := fs.Sub(fsys, "static")
// err == nil even if "static" doesn't exist; failures appear later
```

`fs.Sub` does not verify the directory exists. It just returns a
wrapper. The first `Open` against the wrapper that needs the
directory will fail. **The fix:** if you need early failure, call
`fs.Stat(fsys, "static")` and check before `Sub`. Often the lazy
behavior is fine.

## Bug 6 — Missing `fs.ValidPath` check in custom FS

```go
func (s SingleFS) Open(name string) (fs.File, error) {
    if name != s.Name {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
    }
    return &singleFile{...}, nil
}
```

`fs.WalkDir` and `fstest.TestFS` will probe with names like `..`,
empty strings, and absolute paths. Without a `ValidPath` check,
you accept them or return the wrong error. **The fix:**

```go
if !fs.ValidPath(name) {
    return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
}
```

## Bug 7 — `*os.File` reused as `fs.File`

```go
func (m MyFS) Open(name string) (fs.File, error) {
    return m.sharedFile, nil // returns the same *os.File every call
}
```

Two consumers reading from the FS share a position cursor and
race. **The fix:** open a fresh file per call. `fs.FS.Open` must
return independent handles.

## Bug 8 — Forgetting `io.ReadAll` returns the file's bytes from any position

```go
f, _ := fsys.Open("data.bin")
defer f.Close()
f.Read(make([]byte, 10)) // discard first 10 bytes
data, _ := io.ReadAll(f)  // missing the first 10 bytes
```

`io.ReadAll` reads from the current position. After the throwaway
`Read`, the first 10 bytes are gone. **The fix:** if you want all
the bytes, call `fs.ReadFile` or open and `io.ReadAll` immediately
without an intervening `Read`.

## Bug 9 — Comparing errors with `==`

```go
data, err := fs.ReadFile(fsys, name)
if err == fs.ErrNotExist {
    // never matches
}
```

The returned error is `*fs.PathError` wrapping `fs.ErrNotExist`.
`==` checks the wrapper, not the cause. **The fix:**

```go
if errors.Is(err, fs.ErrNotExist) { ... }
```

## Bug 10 — Forgetting to close after `Open`

```go
func process(fsys fs.FS, name string) error {
    f, err := fsys.Open(name)
    if err != nil { return err }
    data, err := io.ReadAll(f)
    if err != nil { return err }
    return handle(data)
    // file never closed
}
```

`os.DirFS`-backed files leak OS file descriptors; over time the
process runs out. **The fix:** `defer f.Close()` immediately after
the open. Or use `fs.ReadFile` which closes for you.

## Bug 11 — Writing to a `[]byte` from `embed.FS` thinking it mutates the embed

```go
data, _ := embedFS.ReadFile("config.yaml")
data[0] = 'X'
// Next call to ReadFile returns the original bytes, not the modified ones.
```

`embed.FS.ReadFile` returns a copy. Mutating it doesn't change the
FS. **No fix needed** — this is correct behavior. But code that
*assumed* the change would persist is buggy.

## Bug 12 — Backslashes in embed paths

```go
data, _ := embedFS.ReadFile("templates\\admin\\edit.html")
// fs.ErrNotExist, even on Windows
```

`io/fs` paths are forward-slash everywhere. **The fix:** use
forward slashes:

```go
data, _ := embedFS.ReadFile("templates/admin/edit.html")
```

## Bug 13 — `os.DirFS` symlink escape

```go
fsys := os.DirFS("/var/www/uploads")
// /var/www/uploads/foo is a symlink to /etc/passwd.
data, _ := fs.ReadFile(fsys, "foo")
// data == /etc/passwd contents
```

`os.DirFS` does not prevent symlink escape. **The fix:** on Go
1.24+, use `os.OpenRoot("/var/www/uploads")` and call its `FS()`
method. On older Go versions, walk the resolved path manually with
`filepath.EvalSymlinks` and confirm it's still under the root.

## Bug 14 — Concurrent file reads

```go
f, _ := fsys.Open("big.bin")
defer f.Close()

go func() { f.Read(buf1) }()
go func() { f.Read(buf2) }()
// Race condition on the file's position.
```

`fs.File.Read` is not safe for concurrent calls on the same file.
**The fix:** open the file once per goroutine:

```go
go func() {
    f, _ := fsys.Open("big.bin")
    defer f.Close()
    f.Read(buf1)
}()
```

## Bug 15 — `WalkDir` callback ignoring `err`

```go
fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    fmt.Println(path)
    return nil // ignores err
})
```

If a `ReadDir` somewhere in the tree fails, the callback is called
with a non-nil `err`, and the buggy version silently continues —
losing visibility of the failure. **The fix:**

```go
if err != nil {
    return err
}
```

## Bug 16 — `template.ParseFS` with no matching files

```go
//go:embed assets
var assets embed.FS

var tpl = template.Must(template.ParseFS(assets, "*.html"))
// Panics: pattern matches no files: `*.html`
```

The embedded files live at `assets/*.html`, but the pattern looks
at the root. **The fix:** either pattern with the prefix or use
`fs.Sub`:

```go
sub, _ := fs.Sub(assets, "assets")
var tpl = template.Must(template.ParseFS(sub, "*.html"))
```

## Bug 17 — Returning `nil, nil` from `Open`

```go
func (m MyFS) Open(name string) (fs.File, error) {
    if name == "magic" {
        return nil, nil // forgot the error
    }
    // ...
}
```

A nil file with a nil error breaks every caller. `io.ReadAll(nil)`
panics. **The fix:** always pair a nil file with a non-nil error:

```go
if name == "magic" {
    return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}
```

## Bug 18 — Using `path/filepath` for FS path operations

```go
data, _ := fsys.Open(filepath.Join("templates", "index.html"))
// On Windows, this passes "templates\\index.html" — fs.ErrInvalid.
```

`filepath.Join` produces OS-native paths. `fs.FS` wants forward
slashes. **The fix:** use `path.Join` for FS paths and
`path/filepath.Join` for OS paths:

```go
fsys.Open(path.Join("templates", "index.html"))
```

## Bug 19 — `embed` directive with blank line above the var

```go
//go:embed config.yaml

var config []byte // build error: directive not bound to var
```

Blank line between the directive and the `var` invalidates the
binding. **The fix:** remove the blank line:

```go
//go:embed config.yaml
var config []byte
```

## Bug 20 — `embed` of hidden files without `all:`

```go
//go:embed assets
var assets embed.FS
// assets/.well-known/security.txt is silently excluded.
```

`embed` skips files and directories starting with `.` or `_`
unless the pattern is prefixed with `all:`. **The fix:**

```go
//go:embed all:assets
var assets embed.FS
```

## Bug 21 — `*fs.PathError` with the wrong `Op`

```go
return nil, &fs.PathError{Op: "lookup", Path: name, Err: fs.ErrNotExist}
```

The convention is `"open"` for `Open`, `"stat"` for `Stat`, and
so on. Custom op strings break log greppability and confuse
people parsing the error. **The fix:** match the standard
library:

```go
return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
```

## Bug 22 — Forgetting `http.StripPrefix`

```go
sub, _ := fs.Sub(staticFS, "static")
http.Handle("/static/", http.FileServer(http.FS(sub)))
// /static/main.css → 404
```

The handler sees `/static/main.css`, looks up `static/main.css` in
the FS (because `Sub` already stripped one `static/`). Result:
not found, but the user only sees a 404. **The fix:**

```go
http.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(sub))))
```

## Bug 23 — `MapFS` with `fs.MapFile` instead of `fstest.MapFile`

```go
fsys := fstest.MapFS{
    "x": fstest.MapFile{Data: []byte("hello")}, // value, not pointer
}
```

`MapFS` is `map[string]*MapFile`, pointers. The literal above
is a compile error. **The fix:** use `&fstest.MapFile{...}`.

## Bug 24 — `fstest.TestFS` with paths that include leading `.`

```go
fstest.TestFS(fsys, "./config.yaml")
// reports paths in the wrong shape
```

The expected paths are FS paths, not relative-with-`.`-prefix.
**The fix:** drop the `./`:

```go
fstest.TestFS(fsys, "config.yaml")
```

## Bug 25 — Reading the same file repeatedly in a hot path

```go
func handler(w http.ResponseWriter, r *http.Request) {
    data, _ := fs.ReadFile(embedFS, "templates/index.html")
    w.Write(data)
}
```

Each call allocates a new slice copy of the embedded bytes. Fine
for a low-traffic endpoint; wasteful at scale. **The fix:** read
once at startup and reuse:

```go
var indexHTML = mustRead(embedFS, "templates/index.html")

func handler(w http.ResponseWriter, r *http.Request) {
    w.Write(indexHTML)
}
```

For templates, parse once and call `Execute` per request.

## Bug 26 — `fs.ReadDir` results assumed unsorted

```go
entries, _ := fs.ReadDir(fsys, ".")
sort.Slice(entries, func(i, j int) bool {
    return entries[i].Name() < entries[j].Name()
})
// Redundant: fs.ReadDir already returns sorted output.
```

Not a bug exactly, but wasted work. **The fix:** rely on
`fs.ReadDir`'s sort guarantee.

## Bug 27 — Missing `Close` on `*zip.ReadCloser`

```go
zr, _ := zip.OpenReader("assets.zip")
// no defer zr.Close()
data, _ := fs.ReadFile(&zr.Reader, "x")
```

The OS file behind `OpenReader` is leaked. **The fix:** `defer
zr.Close()` after the open, before the reads.

## Bug 28 — Returning `os.ErrClosed` from a custom `File` after first `Read`

```go
func (f *file) Read(p []byte) (int, error) {
    if f.done {
        return 0, fs.ErrClosed
    }
    // ...
    f.done = true
    return n, nil
}
```

The author conflates "no more bytes" with "closed." Subsequent
`Read`s should return `(0, io.EOF)`, not `(0, fs.ErrClosed)`.
`fs.ErrClosed` is for use after `Close`. **The fix:**

```go
return 0, io.EOF
```

## Bug 29 — Walk with `path/filepath.Walk` on an `embed.FS`

```go
filepath.Walk("templates", func(path string, info os.FileInfo, err error) error {
    // ...
})
```

`filepath.Walk` walks the *real* disk, not your embed. On a
production binary where `templates` doesn't exist on disk, this
walks nothing. **The fix:**

```go
fs.WalkDir(embedFS, "templates", func(path string, d fs.DirEntry, err error) error { ... })
```

## Bug 30 — Comparing `fs.FileMode` directly

```go
info, _ := fs.Stat(fsys, "x")
if info.Mode() == fs.ModeDir {
    // never matches: real directories have ModeDir | 0o555 or similar
}
```

`Mode()` is a bitfield. Permissions are bundled with type. **The
fix:**

```go
if info.Mode().IsDir() { ... }
// or
if info.Mode()&fs.ModeDir != 0 { ... }
```

## How to use this list

For each bug, write a one-line fix in your editor before reading
the explanation. If your fix matches, you've internalized that
mistake. If not, the explanation should tell you which contract
you missed; reread the relevant section of `senior.md`.

The bugs cluster around five themes: paths (leading `/`,
backslashes, FS vs OS), errors (`==` vs `errors.Is`, missing
`Close`, wrong `Op`), concurrency (shared cursor), embed/sub/strip
combination, and the `os.DirFS` symlink escape. If you can
recognize which theme you're in, the fix is usually one line.
