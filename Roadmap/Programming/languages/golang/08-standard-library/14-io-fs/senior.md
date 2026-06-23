# 8.14 `io/fs` — Senior

> **Audience.** You've built code around `fs.FS`, written your own
> `FS` once, and shipped a service that depends on the abstraction.
> This file is the precise contract: what `Open` is allowed to do,
> what `ValidPath` permits, where `os.DirFS` quietly fails on
> symlinks, what `os.Root` (Go 1.24) was added to fix, the symlink
> support added in Go 1.21, and the small set of edge cases that
> bite when an FS becomes a security boundary.

## 1. The exact `fs.FS` contract

The package documentation:

> An FS provides access to a hierarchical file system. The FS
> interface is the minimum implementation required of the file
> system. A file system may implement additional interfaces, such
> as ReadFileFS, to provide additional or optimized functionality.

```go
type FS interface {
    Open(name string) (File, error)
}
```

The contract on `Open`:

1. **`name` must satisfy `fs.ValidPath`.** If not, `Open` should
   return a `*PathError` whose `Err` is `fs.ErrInvalid`. The
   standard library does this universally; user-written FSes that
   skip the check are technically non-conformant.
2. **The returned `File` is not yet read.** `Read` on a freshly
   opened file produces the file's first byte, not an arbitrary
   midpoint.
3. **Two `Open` calls on the same name return independent files.**
   They have independent positions, can be read concurrently, and
   close independently. (Whether the underlying *bytes* are shared
   is implementation-defined; the file values aren't.)
4. **`Open(".")` is the FS root.** It must return a `File` whose
   `Stat` reports `IsDir() == true` and which implements
   `ReadDirFile`. Without this, `fs.WalkDir(fsys, ".", ...)`
   doesn't work.

Implementations may return additional capabilities by satisfying
optional interfaces (`ReadFileFS`, `ReadDirFS`, `StatFS`, `GlobFS`,
`SubFS`, `ReadLinkFS`). Optional interfaces are *additive*: they
can speed up an operation but never change its semantics.

## 2. `ValidPath`: what it permits, exactly

```go
func ValidPath(name string) bool
```

Source-of-truth implementation, paraphrased:

```go
// ValidPath reports whether the given path name
// is valid for use in a call to Open.
//
// Path names passed to open are UTF-8-encoded,
// unrooted, slash-separated sequences of path elements,
// like "x/y/z". Path names must not contain an element
// that is "." or ".." or the empty string, except for
// the special case that the root directory is named ".".
// Paths must not start or end with a slash: "/x" and "x/"
// are invalid.
//
// Note that paths are slash-separated on all systems,
// even Windows. Paths containing other characters such
// as backslash and colon are accepted as valid, but
// those characters must never be interpreted by an FS
// implementation as path element separators.
```

The full set of rejections:

| Input | Reject reason |
|-------|---------------|
| `""` | Empty |
| `"/"` or `"/x"` | Leading slash |
| `"x/"` | Trailing slash |
| `"x//y"` | Empty element |
| `"./x"` or `"x/."` | `.` element |
| `"../x"` or `"x/.."` or `"a/../b"` | `..` element |

Permitted:

| Input | Notes |
|-------|-------|
| `"."` | The root, the only `.` allowed |
| `"x"` | Single segment |
| `"x/y"` | Multiple segments |
| `"a\\b"` | Allowed: backslash is *not* a separator in this universe |
| `"foo:bar"` | Allowed |
| Any UTF-8 string subject to the rules | Allowed, including spaces |

UTF-8 is required but not validated — `ValidPath` does not check
that the name decodes cleanly. An FS that wants to enforce
well-formed UTF-8 has to do that itself.

## 3. The `File` contract

```go
type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}
```

Each method:

1. **`Stat`** returns metadata. May be called multiple times. May
   return the same `FileInfo` value each time (it's read-only from
   the caller's perspective).
2. **`Read`** follows the `io.Reader` contract from
   [../01-io-and-file-handling/senior.md](../01-io-and-file-handling/senior.md):
   short reads are legal, EOF can come with data, `(0, nil)` is
   discouraged. After `Close`, `Read` should return an error
   wrapping `fs.ErrClosed`.
3. **`Close`** releases resources. After `Close`, all subsequent
   methods should return errors wrapping `fs.ErrClosed`. Behavior
   of double-`Close` is implementation-defined; conventionally the
   second `Close` returns an error wrapping `fs.ErrClosed`.

The optional `io.Seeker` is *not* required. A file from `embed.FS`
or `fstest.MapFS` happens to implement it (because it's backed by
a `bytes.Reader`), but a file from a streaming source (a pipe-style
zip entry) may not. Don't assume.

## 4. The `ReadDirFile` contract

A directory entry is also a `File`, but its `Read` is not useful;
instead it implements `ReadDirFile`:

```go
type ReadDirFile interface {
    File
    ReadDir(n int) ([]DirEntry, error)
}
```

Semantics of the `n` argument:

- `n > 0`: return up to `n` entries. If fewer remain, return what's
  there and `io.EOF` on the *next* call (or together — same EOF
  ambiguity as `io.Reader`).
- `n <= 0`: return all remaining entries. Subsequent calls return
  `nil, nil` (or `nil, io.EOF` — both are acceptable).

The entries should be in some order; the standard library
implementations all return them in lexicographical order, and
`fs.ReadDir` (the helper) sorts the result anyway. So if you
return them unsorted, `fs.ReadDir` still gives sorted output, but
direct callers of `ReadDir(-1)` see whatever you produce.

## 5. The five sentinel errors

```go
var (
    ErrInvalid    = errors.New("invalid argument")
    ErrPermission = errors.New("permission denied")
    ErrExist      = errors.New("file already exists")
    ErrNotExist   = errors.New("file does not exist")
    ErrClosed     = errors.New("file already closed")
)
```

These are *the same values* as the corresponding `os` errors. In
Go 1.16+, `os.ErrNotExist == fs.ErrNotExist` (both point to the
same `*errorString`). That means `errors.Is(err, fs.ErrNotExist)`
works whether the error originated in `os` or in `io/fs`, and
similarly for the others.

What they mean:

| Error | When |
|-------|------|
| `ErrInvalid` | The arguments were syntactically invalid (bad name) |
| `ErrPermission` | The OS or implementation denied access |
| `ErrExist` | A create-style operation found the file already there (less relevant here since `io/fs` is read-only) |
| `ErrNotExist` | The named file isn't in the FS |
| `ErrClosed` | A method was called after `Close` |

The wrapper type:

```go
type PathError struct {
    Op   string
    Path string
    Err  error
}

func (e *PathError) Error() string { return e.Op + " " + e.Path + ": " + e.Err.Error() }
func (e *PathError) Unwrap() error { return e.Err }
```

`*PathError` is the same type as `*os.PathError` (alias in Go 1.16+).
`errors.Is(err, fs.ErrNotExist)` traverses the `Unwrap` chain
correctly.

## 6. `os.DirFS` does not prevent path escape

The most-tested footgun. `os.DirFS(root)` creates an `fs.FS` rooted
at `root`. The names you pass are validated by `fs.ValidPath`,
which rejects `..` and absolute paths. So far so good.

But `os.DirFS` resolves names by *concatenating* with `root` and
calling `os.Open` on the result. If anything along the way is a
*symlink* whose target is outside `root`, the OS happily follows
it.

```go
fsys := os.DirFS("/var/www")

// Suppose /var/www/uploads/foo is a symlink to /etc/passwd.
data, _ := fs.ReadFile(fsys, "uploads/foo")
// data == contents of /etc/passwd
```

For a server that stores user uploads in `/var/www/uploads`, an
attacker who controls a single symlink wins. `os.DirFS` is
*name-safe*, not *symlink-safe*.

The package documentation says exactly this:

> Note that DirFS("/prefix") only guarantees that the Open calls
> it makes to the operating system will begin with "/prefix":
> DirFS("/prefix").Open("file") is the same as os.Open("/prefix/file").
> So if /prefix/file is a symbolic link pointing outside the /prefix
> tree, then using DirFS does not stop the access any more than
> using os.Open does. Additionally, the root of the fs.FS returned
> for a relative path, DirFS("prefix"), will be affected by later
> calls to Chdir.

The fix arrived in Go 1.24.

## 7. `os.Root` and `os.OpenRoot` (Go 1.24+)

`*os.Root` is a confined filesystem handle. Symlinks that resolve
outside the root, `..` segments at the OS level, absolute paths in
syscalls — all rejected.

```go
root, err := os.OpenRoot("/var/www")
if err != nil { return err }
defer root.Close()

f, err := root.Open("uploads/foo") // refuses to escape /var/www
```

Under the hood, `os.Root` uses platform-specific syscalls
(`openat` with `O_NOFOLLOW`-like semantics on Linux,
`AT_NO_AUTOMOUNT` and friends, equivalents on other platforms) to
ensure each path component is resolved within the root.

`(*os.Root).FS()` returns an `fs.FS` view of the root:

```go
fsys := root.FS()
data, err := fs.ReadFile(fsys, "uploads/foo") // safe
```

For new code that takes user-supplied paths, prefer
`os.OpenRoot` over `os.DirFS`. For code that doesn't take user
paths (your own assets, your own templates), `os.DirFS` is fine.

The relationship:

| Use case | Pre-1.24 | 1.24+ |
|----------|----------|-------|
| Your own asset directory | `os.DirFS` | `os.DirFS` |
| User-supplied path under your root | Manual validation, never quite right | `os.OpenRoot` then `.FS()` |
| `fs.FS` for testing | `os.DirFS` | `os.DirFS` |

## 8. Symlink support: Go 1.21+

Before Go 1.21, `io/fs` had no symlink concept. `Stat` followed
symlinks (returning info about the target); there was no `Lstat`
or `ReadLink` in the abstraction. Go 1.21 added `ReadLinkFS`:

```go
// Go 1.21+
type ReadLinkFS interface {
    FS
    ReadLink(name string) (string, error)
    Lstat(name string) (FileInfo, error)
}
```

And the package-level helpers:

```go
fs.ReadLink(fsys fs.FS, name string) (string, error)
fs.Lstat(fsys fs.FS, name string) (FileInfo, error)
```

If `fsys` implements `ReadLinkFS`, the helpers call its methods.
Otherwise:

- `fs.Lstat` falls back to `fs.Stat` (which follows symlinks). On
  an FS that doesn't expose symlinks, the two are the same.
- `fs.ReadLink` returns an error indicating the FS doesn't support
  symlinks.

A `FileInfo` whose `Mode()` includes `fs.ModeSymlink` is a symlink.
`os.DirFS` (Go 1.21+) implements `ReadLinkFS`. `embed.FS` does not
(symlinks aren't embedded). `fstest.MapFS` implements it for
testing, where you can set `Mode: fs.ModeSymlink` on a `MapFile`
and put the target in `Data`.

## 9. The exact `WalkDir` algorithm

```go
func WalkDir(fsys FS, root string, fn WalkDirFunc) error
```

Pseudocode:

```
info, err := Stat(fsys, root)
if err != nil {
    err = fn(root, nil, err)
} else {
    err = walkDir(fsys, root, FileInfoToDirEntry(info), fn)
}
if err == SkipDir || err == SkipAll {
    return nil
}
return err

walkDir(fsys, name, d, fn):
    if err := fn(name, d, nil); err != nil {
        if d.IsDir() && err == SkipDir { return nil }
        return err
    }
    if !d.IsDir() { return nil }

    entries, err := ReadDir(fsys, name)
    if err != nil {
        // Second call to fn with the error.
        err = fn(name, d, err)
        if err != nil { return err }
    }
    for _, e := range entries {
        sub := name + "/" + e.Name()  // approximately; uses path.Join
        if err := walkDir(fsys, sub, e, fn); err != nil {
            if err == SkipDir { break }
            return err
        }
    }
    return nil
```

The subtle parts:

1. **`fn` may be called twice for a directory** — once before
   reading its contents, once again with an error if `ReadDir`
   fails.
2. **`SkipDir` returned from a non-directory** has the effect of
   skipping the rest of the parent directory. (This is sometimes
   confusing; many callers only return it from directories.)
3. **`SkipAll` (Go 1.20+)** terminates the entire walk and is
   converted to a `nil` return from `WalkDir`.
4. **Symlinks are not followed.** If you want symlink-following
   walks, do it yourself with `ReadLink`.

## 10. `WalkDir` vs `filepath.Walk`: why `WalkDir` is faster

The older `filepath.Walk` calls `fn` with a `FileInfo` for every
file. To produce that `FileInfo`, it has to `Stat` every entry
even if the caller never inspects the size or mtime.

`WalkDir` passes a `DirEntry` instead. `DirEntry.Name()`,
`IsDir()`, and `Type()` come for free from the parent directory's
`ReadDir` result; `Info()` is deferred. For walks that filter by
extension or prune by directory name, no extra syscalls happen.

On a tree with 100,000 files where the walker only inspects
filenames, `WalkDir` is roughly twice as fast as `Walk` on
typical Linux filesystems. The exact ratio depends on the FS
type and how cold the cache is. For embedded data and `MapFS`,
both are instantaneous.

## 11. Concurrency

Nothing in `io/fs` makes concurrency claims. The interfaces don't
mention it. Each implementation decides:

- **`os.DirFS`**: each `Open` returns a fresh `*os.File`. Two
  goroutines opening the same name get independent files. Reading
  the same `*os.File` from two goroutines races (same caveats as
  always; see [../01-io-and-file-handling/senior.md](../01-io-and-file-handling/senior.md)).
- **`embed.FS`**: thread-safe for `Open`, `ReadFile`, `ReadDir`,
  `Stat`. Returned `fs.File` values are not safe for concurrent
  `Read` from two goroutines (independent goroutines reading
  *separately opened* files are fine).
- **`fstest.MapFS`**: not safe to mutate while reading. Read-only
  use is fine.

A custom FS author should treat *the FS itself* as concurrent-safe
(many goroutines calling `Open`, `ReadFile`, etc.) and *the
returned `File`* as single-goroutine. That matches the standard
library and is the least surprising contract.

## 12. The `path` package, not `filepath`

When you implement an FS, every path manipulation uses the `path`
package, not `path/filepath`:

| Need | Use |
|------|-----|
| Join two FS path segments | `path.Join` |
| Get parent | `path.Dir` |
| Get base name | `path.Base` |
| Match a glob | `path.Match` |
| Clean | `path.Clean` |

`path/filepath` is OS-aware (uses backslashes on Windows). `path`
is for forward-slash virtual paths — the universe `io/fs` lives
in. Mixing them produces "no such file" errors that look like
bugs in the FS.

If you build an FS that bridges to disk (a tar reader, a zip
reader), keep the `path` operations on the FS side and any
`filepath` operations on the disk side, with `filepath.ToSlash`
and `filepath.FromSlash` as bridges.

## 13. The `embed.FS` zero value

```go
var fsys embed.FS // zero value
fs.ReadFile(fsys, "anything") // returns *fs.PathError wrapping fs.ErrNotExist
```

A zero `embed.FS` is a valid empty FS — every file lookup returns
`fs.ErrNotExist`. Useful as a sentinel: a function that conditionally
embeds can use a zero `embed.FS` for the "no embedded assets"
case without a nil check.

`fstest.MapFS` zero value is also a valid empty FS (it's a `nil`
map, which acts like an empty map for reads).

## 14. Optional interface assertions: when they happen

The package-level helpers do type assertions to find optional
interfaces. The cost is one type assertion per call (cheap, but
non-zero). If you call `fs.ReadFile(fsys, name)` in a hot loop and
`fsys` is the same value each iteration, the type assertion
happens every time.

For very hot paths, type-assert once and reuse:

```go
rf, ok := fsys.(fs.ReadFileFS)
for _, name := range names {
    var data []byte
    var err error
    if ok {
        data, err = rf.ReadFile(name)
    } else {
        data, err = fs.ReadFile(fsys, name)
    }
    // ...
}
```

This is rarely worth the extra code; the type assertion is faster
than nearly any operation it gates.

## 15. `http.FS` vs `http.FileServerFS`

`http.FS(fsys fs.FS) http.FileSystem` is the older adapter, from
Go 1.16 when `io/fs` was introduced. `http.FileServerFS(fsys
fs.FS) http.Handler` is from Go 1.22 — same idea, one less call.

Either is fine. The Go 1.22 version is conventional in new code:

```go
http.Handle("/", http.FileServerFS(fsys))
```

Behind the scenes, `http.FileServerFS` calls `http.FileServer(http.FS(fsys))`.
The behavior is identical: directory listings if no `index.html`,
content-type sniffing, range requests, conditional GETs.

## 16. `template.ParseFS` errors and how to read them

```go
tpl, err := template.ParseFS(fsys, "templates/*.html", "partials/*.html")
```

The argument is one or more glob patterns. Each pattern *must
match at least one file*; if any pattern matches nothing,
`ParseFS` returns:

```
template: pattern matches no files: `partials/*.html`
```

This is a frequent source of "but the file is right there"
debugging. Causes:

1. The file's path in the FS includes a directory prefix that the
   pattern doesn't account for. (`embed.FS` keeps the
   `templates/` prefix; `fs.Sub` removes it.)
2. The FS is empty (zero `embed.FS`, empty `MapFS`).
3. The pattern uses `**` (not supported) or assumes recursive glob.
4. The file has a `.` or `_` prefix and `embed.FS` was built
   without `all:`.

Run `fs.WalkDir(fsys, ".", func(p string, _ fs.DirEntry, _ error) error { fmt.Println(p); return nil })`
to dump what the FS thinks is in it. If your file isn't there,
the problem is upstream.

## 17. `fs.FormatFileInfo` and `fs.FormatDirEntry` (Go 1.21+)

Two helpers for human-readable formatting:

```go
info, _ := fs.Stat(fsys, "go.mod")
fmt.Println(fs.FormatFileInfo(info))
// output like: -rw-r--r-- 1234 May 5 14:30 go.mod
```

Useful in CLIs, log output, and debugging. The format matches
`ls -l` roughly. Don't parse it — it's for humans.

## 18. `os.DirFS` and relative roots

```go
fsys := os.DirFS("relative/path") // legal but tied to cwd
```

A relative root is resolved against the *current* working
directory at *each* call. If the program calls `os.Chdir` between
`os.DirFS` and `Open`, the FS shifts under it. The package
documentation calls this out as a known sharp edge.

Practical advice: pass an absolute path to `os.DirFS`, or convert
once at startup:

```go
abs, err := filepath.Abs("relative/path")
if err != nil { return err }
fsys := os.DirFS(abs)
```

## 19. The `Sys()` method: implementation-specific data

```go
type FileInfo interface {
    // ... other methods ...
    Sys() any
}
```

`Sys` is the escape hatch. Different implementations stash
different things:

- `os.FileInfo.Sys()` returns `*syscall.Stat_t` on Unix-like
  systems, `*syscall.Win32FileAttributeData` on Windows. You can
  read uid/gid/inode from it if you really need to.
- `embed.FS` files return `nil` from `Sys()` — there's no
  underlying OS data.
- `fstest.MapFS` returns whatever you put in `MapFile.Sys`.

A function that wants to be portable across FS types should not
depend on `Sys()`. Use it only when you've narrowed the source to
a known concrete type.

## 20. Read-only by design

`io/fs` has no `Write`, no `Create`, no `Mkdir`, no `Remove`. The
abstraction is read-only and there is no plan to extend it.

The reasoning, articulated in the design discussion (Russ Cox,
2020): a write API has to address atomicity, durability, locking,
and crash safety — all of which are filesystem-specific in ways a
single interface couldn't paper over without lying. Read access
is comparatively benign: a missing file is a missing file
everywhere; a permission error is a permission error everywhere.

If you want to write, you're in `os` or in custom-implementation
territory. The community has occasionally proposed `WriteFS`-style
interfaces (e.g., the `hackpadfs` library); none have made it
into the standard library, and none seem likely to.

## 21. Reading: what to read next

- [professional.md](professional.md) — production patterns for
  `fs.FS`-based services.
- [specification.md](specification.md) — the interface reference
  in compact form.
- [find-bug.md](find-bug.md) — drills targeting the items in this
  file.
- [`../01-io-and-file-handling/senior.md`](../01-io-and-file-handling/senior.md)
  — the `io.Reader` / `io.Writer` contracts that `fs.File` builds on.
- The official package docs: [`io/fs`](https://pkg.go.dev/io/fs).

External references:

- Russ Cox, "io/fs: add filesystem interface" (golang.org/issue/41190)
  — the original design discussion.
- The Go 1.24 release notes, "os" — the introduction of
  `os.OpenRoot` and the rationale.
