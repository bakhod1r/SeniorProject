# 8.14 `io/fs` — Middle

> **Audience.** You've used `fs.FS` from the consumer side: passing
> `embed.FS` to `template.ParseFS`, calling `fs.WalkDir`, listing a
> directory. Now you need to build *your own* `fs.FS` (a tar reader,
> a layered overlay, an in-memory scratchpad) or you want to know
> exactly which optional capability interfaces to opt into and why.
> This file covers the producer side: the optional interface menu,
> the helpers' fast-path fallback logic, building an FS in fifty
> lines, and confirming it with `fstest.TestFS`.

## 1. Why optional interfaces exist

The core `fs.FS` only has `Open`. Every other operation (read whole
file, list directory, stat without opening, glob, sub) can be
implemented on top of `Open`. The package-level helpers
(`fs.ReadFile`, `fs.ReadDir`, `fs.Stat`, `fs.Glob`, `fs.Sub`) all
contain a default implementation for that case.

But `Open` then `ReadAll` then `Close` is wasteful when the FS knows
the bytes already. `embed.FS.ReadFile` is just a slice copy — no
intermediate `File` value needed. The optional capability interfaces
let an implementation say *"I have a faster path for this; here it
is"*:

```go
type ReadFileFS interface {
    FS
    ReadFile(name string) ([]byte, error)
}
```

The package helpers do a type assertion at call time. If the FS
implements the optional interface, they call it directly; otherwise
they fall back to the generic implementation. As an FS author, you
don't have to implement the optional interfaces — but where you have
a real fast path, doing so is cheap and strictly better for callers.

## 2. The optional interface menu

| Interface | Method | Default fallback |
|-----------|--------|------------------|
| `ReadFileFS` | `ReadFile(name) ([]byte, error)` | `Open` + `io.ReadAll` + `Close` |
| `ReadDirFS` | `ReadDir(name) ([]DirEntry, error)` | `Open` + cast to `ReadDirFile` + read all |
| `StatFS` | `Stat(name) (FileInfo, error)` | `Open` + `File.Stat` + `Close` |
| `GlobFS` | `Glob(pattern) ([]string, error)` | `WalkDir` + `path.Match` |
| `SubFS` | `Sub(dir) (FS, error)` | Wrap with a generic prefix-prepending FS |
| `ReadLinkFS` (Go 1.21+) | `ReadLink(name) (string, error)` and `Lstat(name) (FileInfo, error)` | None — symlink ops fail without it |

Implement what your data structure already supports cheaply. Don't
add methods that just call the default — you save no code on the
caller's side and you spend code on yours.

```go
// embed.FS implements:
var _ fs.FS         = embed.FS{}
var _ fs.ReadFileFS = embed.FS{}
var _ fs.ReadDirFS  = embed.FS{}

// fstest.MapFS implements all of:
var _ fs.FS         = fstest.MapFS{}
var _ fs.ReadFileFS = fstest.MapFS{}
var _ fs.ReadDirFS  = fstest.MapFS{}
var _ fs.StatFS     = fstest.MapFS{}
var _ fs.GlobFS     = fstest.MapFS{}
var _ fs.SubFS      = fstest.MapFS{}
```

Why does `MapFS` go further? Because each of those operations is a
direct map lookup — implementing them all is trivial and faster than
the fallback. `embed.FS` stops at three because globs, sub-views,
and stats are all fine going through the defaults.

## 3. The `ReadDirFile` shape

A subtlety in `ReadDir`: the default implementation in `fs.ReadDir`
opens the file and asserts that the returned `fs.File` implements
`ReadDirFile`:

```go
type ReadDirFile interface {
    File
    ReadDir(n int) ([]DirEntry, error)
}
```

That's the *file*-level interface (different from `ReadDirFS`,
which is the *FS*-level one). When you call `fs.ReadDir(fsys,
name)`:

1. If `fsys` is a `ReadDirFS`, call `fsys.ReadDir(name)`. Done.
2. Else open the name as a file, assert that the result implements
   `ReadDirFile`, call `ReadDir(-1)` to get all entries.

If your FS doesn't implement either, `fs.ReadDir` returns an error
like `not implemented`. That's the contract: a directory open must
yield a `ReadDirFile`, or directory listings don't work.

The `n` parameter on `ReadDirFile.ReadDir(n)` is the same paginated
shape as `(*os.File).ReadDir`: positive `n` returns at most `n`
entries; `n <= 0` returns everything. For most FS implementations,
returning everything in one call is fine.

## 4. Building your own `fs.FS`: a single-file FS

The minimum that compiles:

```go
package singlefs

import (
    "bytes"
    "io"
    "io/fs"
    "time"
)

type SingleFS struct {
    Name string
    Data []byte
}

type singleFile struct {
    name string
    r    *bytes.Reader
    info *singleInfo
    closed bool
}

type singleInfo struct {
    name string
    size int64
}

func (i *singleInfo) Name() string       { return i.name }
func (i *singleInfo) Size() int64        { return i.size }
func (i *singleInfo) Mode() fs.FileMode  { return 0o444 }
func (i *singleInfo) ModTime() time.Time { return time.Time{} }
func (i *singleInfo) IsDir() bool        { return false }
func (i *singleInfo) Sys() any           { return nil }

func (f *singleFile) Stat() (fs.FileInfo, error) { return f.info, nil }
func (f *singleFile) Read(p []byte) (int, error) {
    if f.closed {
        return 0, fs.ErrClosed
    }
    return f.r.Read(p)
}
func (f *singleFile) Close() error {
    if f.closed {
        return fs.ErrClosed
    }
    f.closed = true
    return nil
}

func (s SingleFS) Open(name string) (fs.File, error) {
    if !fs.ValidPath(name) {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
    }
    if name != s.Name {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
    }
    return &singleFile{
        name: s.Name,
        r:    bytes.NewReader(s.Data),
        info: &singleInfo{name: s.Name, size: int64(len(s.Data))},
    }, nil
}

var _ fs.FS = SingleFS{}
var _ io.Reader = (*singleFile)(nil)
```

Sixty-ish lines for a working `fs.FS`. Now any code that takes
`fs.FS` works on a `SingleFS{Name: "robots.txt", Data: ...}`.

The patterns to copy:

- **Validate first.** `fs.ValidPath` rejects malformed names at the
  door. Wrap the result in `*fs.PathError` with the right `Op`.
- **Return sentinel errors.** `fs.ErrNotExist` for missing files,
  `fs.ErrInvalid` for bad paths, `fs.ErrClosed` for use-after-close.
  Callers do `errors.Is(err, fs.ErrNotExist)` and rely on you.
- **Separate file from FS.** The FS describes *what's there*; the
  file is a *cursor* that moves as you read. Two `Open` calls on
  the same name must produce two independent file values.
- **Honor close.** `Read` after `Close` returns `fs.ErrClosed`.

## 5. An in-memory FS for tests (`fstest.MapFS`)

You don't have to write your own; the standard library ships one:

```go
import "testing/fstest"

fsys := fstest.MapFS{
    "config.yaml":         &fstest.MapFile{Data: []byte("debug: true")},
    "templates/index.tpl": &fstest.MapFile{Data: []byte("hi")},
}

data, _ := fs.ReadFile(fsys, "config.yaml")
entries, _ := fs.ReadDir(fsys, "templates")
```

`fstest.MapFile` carries the bytes plus optional `Mode`,
`ModTime`, and `Sys` fields — set them when a test cares. Empty
`MapFile{}` defaults to a zero-byte file with mode 0.

`MapFS` synthesizes directories: if you list `"a/b/c.txt"` as a
key, the `a/` and `a/b/` directories appear in `ReadDir` listings
even though you never declared them. That matches how a real
filesystem looks.

## 6. `fstest.TestFS`: automated conformance

Before shipping your custom FS, run `fstest.TestFS` against it.
It exercises the contract:

```go
import "testing/fstest"

func TestSingleFS(t *testing.T) {
    fsys := SingleFS{Name: "hello.txt", Data: []byte("hi")}
    if err := fstest.TestFS(fsys, "hello.txt"); err != nil {
        t.Fatal(err)
    }
}
```

`TestFS(fsys, expected...)` walks the FS, calls every method, and
checks invariants:

- `Open` of a valid path returns a working `File`.
- `Stat` matches `Open` + `File.Stat`.
- `ReadFile` matches `Open` + `io.ReadAll`.
- `ReadDir` returns entries in lexical order.
- `Close` succeeds.
- Every name in `expected` exists.
- The FS does not return `nil` files alongside non-nil errors, etc.

When `TestFS` reports a problem, it tells you which method
disagreed with which. Fix it and rerun. This is the cheapest test
you'll ever write for an FS implementation.

## 7. Layered FS (overlay)

A common need: read from FS A, fall back to FS B. Useful for
"user overrides on top of defaults":

```go
type OverlayFS struct {
    Top    fs.FS
    Bottom fs.FS
}

func (o OverlayFS) Open(name string) (fs.File, error) {
    f, err := o.Top.Open(name)
    if err == nil {
        return f, nil
    }
    if errors.Is(err, fs.ErrNotExist) {
        return o.Bottom.Open(name)
    }
    return nil, err
}
```

That's the whole thing for `fs.FS`. To keep the optional interfaces
working (so a `ReadDir` returns merged contents), you'd implement
them too:

```go
func (o OverlayFS) ReadDir(name string) ([]fs.DirEntry, error) {
    seen := map[string]fs.DirEntry{}
    for _, layer := range []fs.FS{o.Bottom, o.Top} {
        entries, err := fs.ReadDir(layer, name)
        if err != nil && !errors.Is(err, fs.ErrNotExist) {
            return nil, err
        }
        for _, e := range entries {
            seen[e.Name()] = e // top overrides bottom
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

The pattern shows up in tools that want "user-provided template
directory overrides the embedded defaults" without forking the
template file itself.

## 8. Filtered FS

Wrap an FS to hide some names — privacy-preserving views, "no
hidden files," "only `.html`":

```go
type FilteredFS struct {
    Base  fs.FS
    Allow func(name string) bool
}

func (f FilteredFS) Open(name string) (fs.File, error) {
    if !fs.ValidPath(name) {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
    }
    if name != "." && !f.Allow(name) {
        return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
    }
    return f.Base.Open(name)
}
```

For directory listings, you also need to filter the entries:

```go
func (f FilteredFS) ReadDir(name string) ([]fs.DirEntry, error) {
    entries, err := fs.ReadDir(f.Base, name)
    if err != nil {
        return nil, err
    }
    out := entries[:0]
    for _, e := range entries {
        full := path.Join(name, e.Name())
        if f.Allow(full) {
            out = append(out, e)
        }
    }
    return out, nil
}
```

(Reusing the `entries` slice is safe here because we're shrinking
it; the unused tail is GC'd with the slice.)

Common applications: hide `.git`, `node_modules`, `.env` from a
file server.

## 9. Sub-FS, manually

`fs.Sub(parent, dir)` returns an `fs.FS` rooted at `dir`. The
default implementation prepends `dir/` to every name on the way
into `parent`. If `parent` implements `SubFS`, `fs.Sub` calls
`parent.Sub(dir)` instead — letting the FS produce a more
efficient view (e.g., avoiding repeated string concatenation).

For `embed.FS`, the default is fine; the cost is one allocation
per `Open`. For a tar-backed FS where directory metadata is
expensive to recompute, implementing `SubFS` directly might let
you store a precomputed view.

```go
type subFS struct {
    base fs.FS
    dir  string
}

func (s subFS) Open(name string) (fs.File, error) {
    if name == "." {
        name = s.dir
    } else {
        name = path.Join(s.dir, name)
    }
    return s.base.Open(name)
}
```

`fs.Sub` returns something like the above. Use it; rarely write
your own.

## 10. `archive/zip` as an `fs.FS`

`*zip.Reader` (and `*zip.ReadCloser`, which embeds it) implement
`fs.FS`:

```go
import "archive/zip"

zr, err := zip.OpenReader("assets.zip")
if err != nil { return err }
defer zr.Close()

// zr is *zip.ReadCloser; the embedded *zip.Reader implements fs.FS.
data, err := fs.ReadFile(&zr.Reader, "templates/index.html")
```

Or for an in-memory zip:

```go
zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
if err != nil { return err }
data, err := fs.ReadFile(zr, "name")
```

This is why a Go program can ship a single binary with an embedded
zip and treat its contents as an FS. Compose `embed.FS` for the
outer "container" with `zip.NewReader` for the inner archive, and
you get layered storage with no extra packages.

## 11. `WalkDir` semantics, formally

`fs.WalkDir(fsys, root, fn)` calls `fn(path, d, err)` once for each
file and directory it visits. The order:

1. The root itself, with `d.IsDir() == true` (assuming root is a
   directory).
2. Then for each entry in the root's `ReadDir` result, in
   lexicographical order: visit it. If it's a directory, recurse.

The `err` argument to `fn` is non-nil when something failed before
the call (a `Stat` error on a directory, a `ReadDir` error). Your
function decides:

- Return `nil` to keep going.
- Return `fs.SkipDir` to skip this directory's children (or, on a
  file, the rest of the parent's entries).
- Return `fs.SkipAll` (Go 1.20+) to end the walk.
- Return any other error to stop the walk and propagate the error.

`WalkDir` does not follow symlinks by default. There is no flag to
change this; if you want symlink following, walk yourself with
`Lstat` checks.

For each file `fn` is called with the actual `DirEntry` from the
parent's `ReadDir` — that's why `WalkDir` is faster than the older
`Walk`: it doesn't `Stat` every file before deciding what to do.
Lazy stat in action.

## 12. `fs.Glob` and the `path.Match` grammar

```go
matches, err := fs.Glob(fsys, "templates/*.html")
```

`Glob` walks the FS looking for paths whose basename matches the
pattern's last segment, with the same shape recursively for each
parent segment. The grammar is `path.Match`:

| Pattern | Matches |
|---------|---------|
| `*` | Any sequence of non-`/` characters in one segment |
| `?` | One non-`/` character |
| `[abc]` | One of those characters |
| `[a-z]` | A range |
| `\*` | A literal `*` |

Things that are **not** in the grammar:

- `**` for recursive descent. Not supported. Walk yourself.
- `{a,b}` brace expansion.
- Negation.

For recursive matching, write a `WalkDir` callback:

```go
var matches []string
err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if !d.IsDir() && strings.HasSuffix(path, ".html") {
        matches = append(matches, path)
    }
    return nil
})
```

## 13. `DirEntry` vs `FileInfo`: the lazy-stat pattern

Recap from junior.md: `DirEntry` is the cheap version, `FileInfo`
is the full version.

```go
type DirEntry interface {
    Name() string
    IsDir() bool
    Type() FileMode      // file kind: regular, dir, symlink, etc.
    Info() (FileInfo, error)
}
```

`DirEntry.Type()` returns just the *type* bits of `FileMode`
(`ModeDir | ModeSymlink | ...`), no permissions, no size, no
mtime. Three methods (`Name`, `IsDir`, `Type`) return without an
extra syscall.

`Info()` is where the syscall lives, and it's only called when you
ask. For walks that don't care about size or mtime — counting
files, listing names, filtering by type — that's a real saving.

`fs.FileInfoToDirEntry(info)` is the adapter going the other way,
useful when you implement an FS whose underlying representation
gives you `FileInfo` for free and you need to expose `DirEntry`.

## 14. Generic helpers that take `fs.FS`

These all consume any `fs.FS`:

```go
fs.ReadFile(fsys, "name")
fs.ReadDir(fsys, "dir")
fs.Stat(fsys, "name")
fs.Glob(fsys, "*.go")
fs.Sub(fsys, "subdir")
fs.WalkDir(fsys, "root", fn)
fs.ValidPath(name) bool
fs.FormatFileInfo(info)        // Go 1.21+
fs.FormatDirEntry(d)           // Go 1.21+
```

The point: write your function to take `fs.FS`, use only these
helpers, and your function works on every concrete type without
modification.

```go
func loadAll(fsys fs.FS, dir string) (map[string][]byte, error) {
    entries, err := fs.ReadDir(fsys, dir)
    if err != nil { return nil, err }
    out := map[string][]byte{}
    for _, e := range entries {
        if e.IsDir() { continue }
        b, err := fs.ReadFile(fsys, path.Join(dir, e.Name()))
        if err != nil { return nil, err }
        out[e.Name()] = b
    }
    return out, nil
}
```

`loadAll(os.DirFS("/etc"), "ssl")` works. `loadAll(embedFS, "tpl")`
works. `loadAll(mapFS, ".")` in tests works. Same code.

## 15. Errors with `*fs.PathError`

When you implement an `fs.FS`, every method that takes a name
returns errors wrapped in `*fs.PathError`:

```go
return nil, &fs.PathError{
    Op:   "open",
    Path: name,
    Err:  fs.ErrNotExist,
}
```

The `Op` field is conventionally one of: `"open"`, `"stat"`,
`"read"`, `"readdir"`, `"readfile"`, `"glob"`. Match what the
standard library uses for the equivalent operation; users
parsing error strings (sadly, this happens) will appreciate it.

The wrapped `Err` should be one of the sentinels (`fs.ErrInvalid`,
`fs.ErrPermission`, `fs.ErrExist`, `fs.ErrNotExist`,
`fs.ErrClosed`) so that `errors.Is` works on the receiving end.

## 16. Testing code that takes `fs.FS`

The whole reason to write functions against `fs.FS`: free fakes.

```go
func ParseConfig(fsys fs.FS, name string) (*Config, error) { /* ... */ }

func TestParseConfig_HappyPath(t *testing.T) {
    fsys := fstest.MapFS{
        "config.yaml": &fstest.MapFile{Data: []byte("port: 8080")},
    }
    cfg, err := ParseConfig(fsys, "config.yaml")
    if err != nil { t.Fatal(err) }
    if cfg.Port != 8080 { t.Errorf("port = %d", cfg.Port) }
}

func TestParseConfig_Missing(t *testing.T) {
    fsys := fstest.MapFS{}
    _, err := ParseConfig(fsys, "config.yaml")
    if !errors.Is(err, fs.ErrNotExist) {
        t.Errorf("got %v", err)
    }
}
```

No fixtures, no temp dirs, no cleanup. Just a `MapFS` literal that
the test reads at the same fluency as the assertion below it.

## 17. What to read next

- [senior.md](senior.md) — exact contract, `ValidPath` semantics,
  symlink support, `os.DirFS` vs `os.Root` (Go 1.24), `ReadLinkFS`
  (Go 1.21+).
- [professional.md](professional.md) — production patterns: HTTP
  serving, observability, layered FS in real systems.
- [tasks.md](tasks.md) — exercises that build real FS
  implementations (tar, overlay, in-memory).
- [`../09-go-embed/middle.md`](../09-go-embed/middle.md) — `embed.FS`
  patterns that use these helpers.
