# 8.14 `io/fs` — Specification

A compact reference of every interface, function, type, and constant
that the package exports, along with the contract each one obeys.

## 1. Core interfaces

```go
type FS interface {
    Open(name string) (File, error)
}

type File interface {
    Stat() (FileInfo, error)
    Read([]byte) (int, error)
    Close() error
}

type FileInfo interface {
    Name() string
    Size() int64
    Mode() FileMode
    ModTime() time.Time
    IsDir() bool
    Sys() any
}

type DirEntry interface {
    Name() string
    IsDir() bool
    Type() FileMode
    Info() (FileInfo, error)
}

type ReadDirFile interface {
    File
    ReadDir(n int) ([]DirEntry, error)
}
```

## 2. Optional capability interfaces

| Interface | Method |
|-----------|--------|
| `ReadFileFS` | `ReadFile(name string) ([]byte, error)` |
| `ReadDirFS` | `ReadDir(name string) ([]DirEntry, error)` |
| `StatFS` | `Stat(name string) (FileInfo, error)` |
| `GlobFS` | `Glob(pattern string) ([]string, error)` |
| `SubFS` | `Sub(dir string) (FS, error)` |
| `ReadLinkFS` (Go 1.21+) | `ReadLink(name string) (string, error)`, `Lstat(name string) (FileInfo, error)` |

Each one embeds `FS`. An implementation that satisfies the
optional interface speeds up the corresponding helper; otherwise
the helper falls back to a default built on `Open`.

## 3. Helper functions

| Function | Returns |
|----------|---------|
| `ReadFile(fsys FS, name string)` | `([]byte, error)` |
| `ReadDir(fsys FS, name string)` | `([]DirEntry, error)` (sorted) |
| `Stat(fsys FS, name string)` | `(FileInfo, error)` |
| `Glob(fsys FS, pattern string)` | `([]string, error)` |
| `Sub(fsys FS, dir string)` | `(FS, error)` |
| `WalkDir(fsys FS, root string, fn WalkDirFunc)` | `error` |
| `ValidPath(name string)` | `bool` |
| `ReadLink(fsys FS, name string)` (Go 1.21+) | `(string, error)` |
| `Lstat(fsys FS, name string)` (Go 1.21+) | `(FileInfo, error)` |
| `FormatFileInfo(info FileInfo)` (Go 1.21+) | `string` |
| `FormatDirEntry(d DirEntry)` (Go 1.21+) | `string` |
| `FileInfoToDirEntry(info FileInfo)` | `DirEntry` |

## 4. `WalkDirFunc`

```go
type WalkDirFunc func(path string, d DirEntry, err error) error
```

Sentinel returns:

| Sentinel | Effect |
|----------|--------|
| `nil` | Continue |
| `SkipDir` | From a directory: skip its contents. From a file: skip the rest of the parent directory |
| `SkipAll` (Go 1.20+) | End the entire walk; `WalkDir` returns `nil` |
| any other error | Stop the walk; `WalkDir` returns that error |

## 5. Error sentinels

```go
var (
    ErrInvalid    = errors.New("invalid argument")
    ErrPermission = errors.New("permission denied")
    ErrExist      = errors.New("file already exists")
    ErrNotExist   = errors.New("file does not exist")
    ErrClosed     = errors.New("file already closed")
)
```

These are aliased to `os.ErrInvalid`, `os.ErrPermission`,
`os.ErrExist`, `os.ErrNotExist`, `os.ErrClosed` respectively. Use
`errors.Is(err, fs.ErrXxx)` for matching.

## 6. The `PathError` type

```go
type PathError struct {
    Op   string
    Path string
    Err  error
}

func (e *PathError) Error() string
func (e *PathError) Unwrap() error
func (e *PathError) Timeout() bool
```

Aliased to `*os.PathError`. Returned by every method that takes a
name when an error occurs.

## 7. The `FileMode` type

```go
type FileMode uint32
```

Bitfield. The kind bits:

| Constant | Meaning |
|----------|---------|
| `ModeDir` | Directory |
| `ModeAppend` | Append-only file |
| `ModeExclusive` | Exclusive use |
| `ModeTemporary` | Temporary file |
| `ModeSymlink` | Symbolic link |
| `ModeDevice` | Device file |
| `ModeNamedPipe` | FIFO |
| `ModeSocket` | Socket |
| `ModeSetuid` | setuid |
| `ModeSetgid` | setgid |
| `ModeCharDevice` | Unix char device |
| `ModeSticky` | Sticky bit |
| `ModeIrregular` | Non-regular file |
| `ModeType` | Mask of all type bits |
| `ModePerm` | Mask of permission bits (`0o777`) |

Methods on `FileMode`:

| Method | Returns |
|--------|---------|
| `IsDir()` | `mode&ModeDir != 0` |
| `IsRegular()` | `mode&ModeType == 0` |
| `Perm()` | `mode & ModePerm` |
| `Type()` | `mode & ModeType` |
| `String()` | `ls -l`-style string |

## 8. `ValidPath` rules

A name `n` satisfies `ValidPath(n) == true` if:

1. `n` is non-empty.
2. `n == "."` (allowed) or every segment of `n` (after splitting
   on `"/"`) is non-empty, not `"."`, and not `".."`.
3. `n` does not start or end with `"/"`.
4. `n` does not contain consecutive `"/"` characters.

Any other name fails. Implementations should reject failing names
with `*PathError{Op, Path: n, Err: ErrInvalid}`.

## 9. `Open` contract

Reject invalid names with `*PathError{Op: "open", Path: name,
Err: ErrInvalid}`. Return `ErrNotExist` for missing files,
`ErrPermission` for access denied. Otherwise return a `File`
whose first `Read` produces the first byte and whose `Stat`
reports metadata. `Open(".")` must return a directory file
(implementing `ReadDirFile`).

## 10. `File` method contract

`Stat()` returns metadata. May be called any number of times.

`Read(p []byte)` follows the `io.Reader` contract. In particular:

- Short reads are legal.
- May return `(n > 0, io.EOF)` or `(n > 0, nil)` followed by `(0, io.EOF)`.
- After `Close`, returns an error wrapping `ErrClosed`.

`Close()` releases resources. After the first call:

- Subsequent operations should return errors wrapping `ErrClosed`.
- Behavior of a second `Close` is implementation-defined; convention is to return an error wrapping `ErrClosed`.

## 11. `ReadDirFile.ReadDir(n int)`

| `n` | Behavior |
|-----|----------|
| `n > 0` | Return up to `n` next entries. If fewer remain, return what's there; signal EOF on this or the next call |
| `n <= 0` | Return all remaining entries. Subsequent calls return `(nil, nil)` or `(nil, io.EOF)` |

Order is implementation-defined; the package-level `fs.ReadDir`
sorts the result.

## 12. `WalkDir` algorithm

Walks `fsys` from `root` depth-first in lexical order. The
callback `fn` is called once per visited entry; if `ReadDir`
fails for a directory, `fn` is called a second time with the
non-nil error. Sentinel returns: `SkipDir`, `SkipAll`, or any
other error. Symlinks are not followed.

## 13. `Glob` pattern grammar (`path.Match`)

| Pattern | Matches |
|---------|---------|
| `*` | Any sequence of non-`/` characters in one segment |
| `?` | One non-`/` character |
| `[abc]` | One character from the set |
| `[a-z]` | One character from the range |
| `[^abc]` | One character not in the set |
| `\c` | Literal character `c` |

Not supported: `**`, `{a,b}`, negation by `!`.

Pattern errors return `path.ErrBadPattern`.

## 14. `Sub` semantics

`fs.Sub(fsys, dir)` returns an FS rooted at `dir`. Names are
joined with `dir` and passed to `fsys.Open`. If `fsys` implements
`SubFS`, its `Sub(dir)` is called instead. `fs.Sub(fsys, ".")`
returns `fsys` unchanged. `dir` is validated with `ValidPath`.

## 15. Concrete implementations

| Source | Implements |
|--------|------------|
| `os.DirFS(root)` | `FS`, plus `ReadFileFS`, `ReadDirFS`, `StatFS`, `GlobFS`, `SubFS`, `ReadLinkFS` (Go 1.21+) |
| `embed.FS` | `FS`, `ReadFileFS`, `ReadDirFS`. File `Mode() == 0o444`; dir `Mode() == 0o555\|ModeDir`. `ModTime() == time.Time{}` |
| `fstest.MapFS` | All optional interfaces. Synthesizes parent directories from keyed paths |
| `*zip.Reader` | `FS`, `ReadDirFS` |

`os.DirFS` does not prevent symlink escape; for confined access
use `os.OpenRoot(root).FS()` (Go 1.24+).

## 16. `fstest.TestFS`

```go
func TestFS(fsys fs.FS, expected ...string) error
```

Walks the FS, calls every method on every name, checks
invariants, and confirms each `expected` path is present. Returns
nil on success.

## 17. Concurrency

The package makes no claims. Concrete implementations:
`os.DirFS`, `embed.FS`, `fstest.MapFS` are all safe for
concurrent `Open`; returned files are single-goroutine. Custom
implementations should at minimum permit concurrent `Open`.

## 18. Cross-references

- [junior.md](junior.md) — friendly walkthrough.
- [middle.md](middle.md) — building your own FS.
- [senior.md](senior.md) — exact contract and edge cases.
- The official package docs: [`io/fs`](https://pkg.go.dev/io/fs).
