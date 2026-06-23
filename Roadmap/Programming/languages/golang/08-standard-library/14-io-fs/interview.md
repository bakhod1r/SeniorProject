# 8.14 `io/fs` — Interview

A set of questions that come up about `io/fs`, ordered roughly
junior to senior. Each one has a pointed answer and, where useful,
a short snippet that illustrates it.

## 1. What is `io/fs` for?

It's the abstract read-only filesystem interface. The same idea
`io.Reader` applies to byte streams, `fs.FS` applies to
hierarchical file storage. A function that takes `fs.FS` works on
disk (`os.DirFS`), embedded assets (`embed.FS`), zip archives
(`archive/zip`), in-memory test fixtures (`fstest.MapFS`), or
custom implementations.

It was added in Go 1.16 to centralize the interface; before then,
each library that wanted this abstraction invented its own.

## 2. What's the minimum interface an FS must implement?

```go
type FS interface {
    Open(name string) (File, error)
}
```

One method. Every other operation is built on top via helpers that
fall back to `Open` if the implementation doesn't expose a
specialized method.

## 3. What does `Open` return?

```go
type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}
```

Three methods: metadata, byte stream, and resource release. The
returned `File` may also satisfy `ReadDirFile` if it represents a
directory, or `io.Seeker` if the source supports it.

## 4. Why not just take `*os.File`?

Because `*os.File` is concrete. Code written against it requires a
real disk file. Code written against `fs.FS` works on every
backing implementation, with zero changes at the call site.

The dividend: free fakes for tests, free overlay implementations
for production overrides, and zero coupling between callers and
the source of truth.

## 5. What are the optional capability interfaces?

The "fast path" interfaces that an FS can implement when it has a
better-than-default implementation:

- `ReadFileFS` — `ReadFile(name) ([]byte, error)`
- `ReadDirFS` — `ReadDir(name) ([]DirEntry, error)`
- `StatFS` — `Stat(name) (FileInfo, error)`
- `GlobFS` — `Glob(pattern) ([]string, error)`
- `SubFS` — `Sub(dir) (FS, error)`
- `ReadLinkFS` (Go 1.21+) — `ReadLink(name)`, `Lstat(name)`

The package helpers (`fs.ReadFile`, etc.) check via type assertion
and use the fast path when present.

## 6. What's the difference between `FileInfo` and `DirEntry`?

`FileInfo` is the full metadata record: name, size, mode, modtime.
Producing it usually requires a `stat(2)` syscall.

`DirEntry` is the lightweight version returned by directory
listings: name, kind, deferred `Info()` call. The kind comes for
free from `getdents(2)`; size and modtime are deferred until you
ask via `Info()`.

`WalkDir` is faster than the older `Walk` because it gives
callbacks `DirEntry` values and skips the `stat` for entries the
callback doesn't inspect.

## 7. What's `ValidPath` and what does it permit?

```go
func ValidPath(name string) bool
```

A name is valid iff:

- Non-empty.
- Either `"."` or a sequence of non-empty segments separated by
  single forward slashes.
- No segment is `"."` or `".."`.
- No leading or trailing slash.
- No empty segments (no `//`).

Implementations should reject invalid names with
`*PathError{Op, Path, Err: fs.ErrInvalid}`.

## 8. Forward slash on Windows?

Yes. Names in `io/fs` are *virtual* paths, always forward-slash
separated, regardless of OS. The runtime never translates them.
This is one of the ways `io/fs` differs from `path/filepath`.

If you bridge between disk paths and FS paths, use
`filepath.ToSlash` and `filepath.FromSlash` to convert.

## 9. What does `fs.Sub(fsys, "subdir")` do?

It returns an `fs.FS` rooted at `subdir`. Names passed to the
returned FS are prefixed with `subdir/` and forwarded to `fsys`.

Useful for HTTP serving from an embedded directory: the embedded
paths include the directory name (`static/main.css`), but you want
the URL to be `/main.css`. `fs.Sub(static, "static")` strips that
layer.

## 10. Why does my embedded file's `ModTime` return zero?

`embed.FS` doesn't store modification times. Files report
`time.Time{}` for `ModTime()` and a fixed mode (`0o444`).

If you need ETags for HTTP caching, derive them from a build ID
(`-ldflags "-X main.buildID=..."`) or hash the file contents at
startup. Don't rely on `ModTime`.

## 11. What's the difference between `fs.SkipDir` and `fs.SkipAll`?

In a `WalkDir` callback:

- `fs.SkipDir` returned from a directory: skip its children, but
  continue walking siblings.
- `fs.SkipDir` returned from a file: skip the rest of the parent
  directory's entries.
- `fs.SkipAll` (Go 1.20+): end the entire walk; `WalkDir` returns
  `nil`.

Before Go 1.20, "stop the walk" required returning a custom
sentinel and checking for it after the walk. `SkipAll` cleans
that up.

## 12. Does `os.DirFS` prevent path traversal?

No, not via symlinks. It rejects names that fail `ValidPath`
(absolute paths, `..` segments), but a *symlink inside the
rooted directory* whose target is outside is silently followed.

```go
fsys := os.DirFS("/var/www")
// If /var/www/foo is a symlink to /etc/passwd:
data, _ := fs.ReadFile(fsys, "foo") // returns /etc/passwd
```

For user-supplied filenames in untrusted contexts, use
`os.OpenRoot` (Go 1.24+) and `(*os.Root).FS()` instead.

## 13. What's `os.Root` (Go 1.24)?

A confined filesystem handle that refuses to resolve paths
outside its root, even via symlinks. Uses platform syscalls
(`openat` and friends on Linux) to enforce the boundary.

```go
root, _ := os.OpenRoot("/var/www")
defer root.Close()
f, err := root.Open(userPath) // refuses to escape /var/www
fsys := root.FS()
```

For new code that handles user-supplied paths, prefer this over
`os.DirFS`.

## 14. Does `io/fs` support symlinks?

Since Go 1.21, yes, via the `ReadLinkFS` interface and
`fs.ReadLink`/`fs.Lstat` helpers. Before 1.21, the abstraction
had no symlink concept; `Stat` followed them silently and there
was no way to ask about the link itself.

`os.DirFS` (Go 1.21+) implements `ReadLinkFS`. `embed.FS` does
not — symlinks aren't embedded at all.

## 15. How do I test code that takes `fs.FS`?

Use `fstest.MapFS`:

```go
fsys := fstest.MapFS{
    "config.yaml": &fstest.MapFile{Data: []byte("port: 8080")},
}
cfg, err := ParseConfig(fsys, "config.yaml")
```

No fixtures, no temp dirs, no cleanup. The function under test
can't tell the difference between `MapFS` and `embed.FS`.

## 16. What's `fstest.TestFS`?

```go
func TestFS(fsys fs.FS, expected ...string) error
```

A conformance checker. Walks the FS, calls every method on every
name, checks that responses are consistent (e.g., `ReadFile`
returns the same bytes as `Open` then `io.ReadAll`).

Run it on every custom FS implementation. The cost is a few
hundred lines that you didn't have to write.

## 17. How do I parse templates from an `fs.FS`?

```go
tpl, err := template.ParseFS(fsys, "*.html")
```

Both `text/template.ParseFS` and `html/template.ParseFS` take an
`fs.FS` and one or more `path.Match` glob patterns. The glob
matches against names *inside* the FS; if it matches nothing,
`ParseFS` returns an error.

For nested directories, use `fs.Sub` to root the FS at the
directory you want, or pass multiple patterns
(`"layouts/*.html"`, `"partials/*.html"`).

## 18. Can I write to an `fs.FS`?

No. The package is read-only by design. There is no `Write`,
`Create`, `Mkdir`, or `Remove`. The community has proposed
`WriteFS`-style extensions; none have been accepted into the
standard library.

If you need to write, you're back to `os` or to a custom API.

## 19. How do I serve static files from an `embed.FS` via HTTP?

```go
//go:embed static
var staticFS embed.FS

sub, _ := fs.Sub(staticFS, "static")

// Go 1.22+:
http.Handle("/", http.FileServerFS(sub))

// Pre-1.22:
http.Handle("/", http.FileServer(http.FS(sub)))
```

For a URL prefix:

```go
http.Handle("/static/", http.StripPrefix("/static/", http.FileServerFS(sub)))
```

Forgetting either `fs.Sub` or `StripPrefix` is the classic 404
generator.

## 20. What's the difference between `fs.WalkDir` and `filepath.Walk`?

| Aspect | `filepath.Walk` | `fs.WalkDir` |
|--------|-----------------|--------------|
| Source | OS filesystem only | Any `fs.FS` |
| Callback gets | `os.FileInfo` (full stat) | `fs.DirEntry` (lazy) |
| Speed on large trees | Slower (stats everything) | Faster (lazy stat) |
| Symlinks | Followable via `os.Lstat` calls | Not followed; use `fs.ReadLink` |

For new code, prefer `fs.WalkDir` regardless of source. For
on-disk walks, wrap with `os.DirFS`.

## 21. What error should I return for a missing file?

```go
return nil, &fs.PathError{
    Op:   "open",
    Path: name,
    Err:  fs.ErrNotExist,
}
```

A `*fs.PathError` wrapping `fs.ErrNotExist`. Callers do
`errors.Is(err, fs.ErrNotExist)` and rely on you.

## 22. What's the relationship between `fs.ErrNotExist` and `os.ErrNotExist`?

They're the same value. `fs.ErrNotExist == os.ErrNotExist` (and
similarly for the other sentinels). New code should use the
`fs.*` form because it's the canonical name; the `os.*` form
remains for backward compatibility.

## 23. Why is `fs.ReadDir` sorted?

Because the helper sorts before returning. Many callers want
deterministic order; sorting once at the helper saves every
caller from doing it.

If you implement `ReadDirFS.ReadDir` directly, the helper trusts
your order — but the standard practice is to return sorted
results yourself, matching every other implementation.

## 24. How do I implement an `fs.FS` for a tar file?

Read the tar at construction, build a map of entries, look them
up in `Open`. The tar format is sequential, so random access
requires reading the whole archive once:

```go
type TarFS struct{ entries map[string]*tarEntry }

func New(r io.Reader) (*TarFS, error) {
    t := &TarFS{entries: map[string]*tarEntry{}}
    tr := tar.NewReader(r)
    for {
        hdr, err := tr.Next()
        if err == io.EOF { break }
        if err != nil { return nil, err }
        data, _ := io.ReadAll(tr)
        t.entries[hdr.Name] = &tarEntry{header: hdr, data: data}
    }
    return t, nil
}
```

Then implement `Open` against the map. For very large tars, you'd
keep offsets and re-read on demand instead of loading everything.

## 25. What's the FS analogue of `bufio.Scanner`?

There isn't one at the FS level. `fs.FS` is about *opening*
named files; what you read out of them is bytes, and you scan
those bytes with `bufio.Scanner`, the same as for `*os.File`.

```go
f, _ := fsys.Open("log.txt")
defer f.Close()
s := bufio.NewScanner(f)
for s.Scan() {
    process(s.Text())
}
```

The `fs.FS` is just the way you got the `io.Reader`.

## 26. What's the cost of `fs.Sub`?

For most implementations, the default `fs.Sub` returns a wrapper
that prepends the directory prefix to every name on the way into
the underlying FS. The cost per call is one string concatenation.

If the underlying FS implements `SubFS`, `fs.Sub` calls its
method, which can be cheaper (e.g., precomputing the view).

For HTTP file serving, `fs.Sub` runs once at startup and is
forgotten. The per-request cost is one allocation per file open;
negligible.

## 27. Can I use `fs.FS` as a security boundary?

Carefully. `fs.FS` itself is not a sandbox. Some implementations
enforce sandboxing (`os.OpenRoot`-derived FS), some don't
(`os.DirFS` allows symlink escape).

If you accept user-supplied names, validate them with
`fs.ValidPath` *and* use a sandbox-enforcing FS. Don't rely on
the abstraction alone.
