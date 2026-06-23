# 8.21 `path` and `path/filepath` — Specification

> Reference card. Function signatures, semantics, and platform
> differences. Source of truth: `$GOROOT/src/path/` and
> `$GOROOT/src/path/filepath/`.

## 1. Package distinction

| Package | Purpose | Separator |
|---------|---------|-----------|
| `path` | URL paths, import paths, slash-separated identifiers | always `/` |
| `path/filepath` | Filesystem paths | OS-specific (`/` on Unix, `\` on Windows) |

Do not mix them. Use `path` for any string that is not a host
filesystem path; use `filepath` for paths you'll pass to `os.*`
functions.

## 2. Constants and variables

### `path/filepath`

```go
const Separator = os.PathSeparator       // '/' or '\\'
const ListSeparator = os.PathListSeparator // ':' or ';'

var SkipDir error = fs.SkipDir       // signal: skip remaining dir
var SkipAll error = fs.SkipAll       // signal: stop walk (Go 1.20+)
var ErrBadPattern = errors.New("syntax error in pattern")
```

### `path`

```go
var ErrBadPattern = errors.New("syntax error in pattern")
```

`path` does not define separators; it always uses `/`.

## 3. `path/filepath` — full API

### Path manipulation

```go
func Abs(path string) (string, error)
func Base(path string) string
func Clean(path string) string
func Dir(path string) string
func Ext(path string) string
func IsAbs(path string) bool
func IsLocal(path string) bool   // Go 1.20+
func Join(elem ...string) string
func Localize(path string) (string, error) // Go 1.23+
func Rel(basepath, targpath string) (string, error)
func Split(path string) (dir, file string)
func SplitList(path string) []string
func ToSlash(path string) string
func FromSlash(path string) string
func VolumeName(path string) string
```

### Filesystem operations

```go
func EvalSymlinks(path string) (string, error)
func Glob(pattern string) (matches []string, err error)
func Match(pattern, name string) (matched bool, err error)
func Walk(root string, fn WalkFunc) error
func WalkDir(root string, fn fs.WalkDirFunc) error
```

### Types

```go
type WalkFunc func(path string, info fs.FileInfo, err error) error
```

`fs.WalkDirFunc` is defined in `io/fs`:

```go
type WalkDirFunc func(path string, d DirEntry, err error) error
```

## 4. `path` — full API

```go
func Base(path string) string
func Clean(path string) string
func Dir(path string) string
func Ext(path string) string
func IsAbs(path string) bool
func Join(elem ...string) string
func Match(pattern, name string) (matched bool, err error)
func Split(path string) (dir, file string)
```

No `Walk`, `Glob`, `Abs`, or `EvalSymlinks` — those are
filesystem-specific.

## 5. Function semantics — `filepath.Clean`

Returns the shortest equivalent path:

1. Replace runs of separator with a single separator.
2. Eliminate each `.` path name element.
3. Eliminate each inner `..` together with the non-`..` element
   that precedes it.
4. Eliminate `..` at the start of a rooted path (i.e., `"/.."` → `"/"`).
5. If the result is empty, return `.`.

```go
filepath.Clean("a//b")           // "a/b"
filepath.Clean("a/b/./c")        // "a/b/c"
filepath.Clean("a/b/../c")       // "a/c"
filepath.Clean("/../a")          // "/a"
filepath.Clean("")               // "."
filepath.Clean(".")              // "."
filepath.Clean("../../a")        // "../../a"  (cannot resolve)
```

On Windows, separators are normalized to `\` and `Clean` understands
volume names.

## 6. Function semantics — `filepath.Join`

```go
filepath.Join("a", "b", "c")         // "a/b/c"
filepath.Join("/a/", "/b/", "c")     // "/a/b/c"
filepath.Join("")                     // ""
filepath.Join("a", "")               // "a"
filepath.Join("", "a")               // "a"
filepath.Join("a", "..")             // "."
```

Equivalent to `Clean(strings.Join(elem, string(Separator)))`. Empty
elements are skipped.

## 7. Function semantics — `filepath.IsLocal` (Go 1.20+)

Returns true if `path`, "lexically", is a local path that lies
within the current directory. Reject:

- Absolute paths (`IsAbs(path)` is true).
- Empty paths.
- Paths that start with `..` or contain `..` segments that escape.
- Paths containing Windows-reserved names (`CON`, `PRN`, `NUL`,
  `COM1`...`COM9`, `LPT1`...`LPT9`, etc.).
- Paths with embedded `NUL`.

```go
filepath.IsLocal("file")              // true
filepath.IsLocal("a/b/c")             // true
filepath.IsLocal("/etc/passwd")       // false
filepath.IsLocal("../escape")         // false
filepath.IsLocal("a/../../escape")    // false
filepath.IsLocal("CON")               // false on Windows; true on Unix
```

For platform-portable security, use `IsLocal` as the gatekeeper
before `Join`.

## 8. Function semantics — `filepath.Glob`

Pattern syntax (same as `filepath.Match`):

| Token | Matches |
|-------|---------|
| `*` | sequence of non-separator characters |
| `?` | one non-separator character |
| `[abc]` | one character from set |
| `[a-z]` | one character from range |
| `[^abc]` | one character not in set |
| `\c` (Unix only) | literal `c` |

Returns `nil, nil` (no error) if no files match. Returns
`ErrBadPattern` for malformed patterns.

Does NOT support `**` (recursive). Does NOT match hidden files
(`.foo`) with leading `*` — Glob's behavior on hidden files is
shell-like.

## 9. Function semantics — `filepath.Walk` vs `WalkDir`

```go
type WalkFunc func(path string, info fs.FileInfo, err error) error
type WalkDirFunc func(path string, d fs.DirEntry, err error) error
```

| Aspect | `Walk` | `WalkDir` |
|--------|--------|-----------|
| Per-entry | `os.Lstat` always called | `os.Lstat` only on `d.Info()` |
| Callback receives | `fs.FileInfo` | `fs.DirEntry` |
| Performance | slower (extra stat per entry) | faster |
| Sort order | lexical within each directory | same |
| `SkipDir` | supported | supported |
| `SkipAll` | not supported | supported (Go 1.20+) |
| Symlinks | not followed (uses `Lstat`) | not followed |

Use `WalkDir` for new code.

### Sentinel errors

| Returned by callback | Effect |
|----------------------|--------|
| `nil` | Continue normally. |
| `filepath.SkipDir` | Skip remaining contents of current directory (if entry is a dir) or remaining contents of parent (if entry is a file). |
| `filepath.SkipAll` | Stop the entire walk. Returns `nil` to the caller. |
| any other error | Stop the walk. Returns the error to the caller. |

## 10. Function semantics — `filepath.Rel`

```go
func Rel(basepath, targpath string) (string, error)
```

Returns a relative path from `basepath` to `targpath` such that
`filepath.Join(basepath, result)` is equivalent to `targpath`.

Returns an error if:

- `basepath` and `targpath` are not both absolute or both relative.
- `targpath` cannot be made relative to `basepath` (e.g., different
  drives on Windows).

```go
filepath.Rel("/a", "/a/b/c")  // "b/c", nil
filepath.Rel("/a/b", "/a/c")  // "../c", nil
filepath.Rel("/a", "b")        // error: one absolute, one relative
```

## 11. Function semantics — `filepath.EvalSymlinks`

```go
func EvalSymlinks(path string) (string, error)
```

Returns the path after evaluating all symlinks. If the path does
not exist, or there's a symlink loop, returns an error.

The result is always absolute? No — `EvalSymlinks("./foo")` returns
a path relative to the working directory. Use `filepath.Abs` for
absolute results.

## 12. Function semantics — `filepath.Abs`

```go
func Abs(path string) (string, error)
```

Returns an absolute representation of `path`. If `path` is already
absolute, returns it cleaned. If relative, joins with the current
working directory.

May fail if `os.Getwd()` fails (e.g., the working directory has
been deleted).

Does NOT resolve symlinks; for that, combine with `EvalSymlinks`.

## 13. Function semantics — `filepath.Split`

```go
func Split(path string) (dir, file string)
```

Splits at the last separator. `dir` includes the trailing separator;
`file` is the last component.

```go
filepath.Split("/a/b/c")     // "/a/b/", "c"
filepath.Split("/a/b/")      // "/a/b/", ""
filepath.Split("c")           // "", "c"
filepath.Split("")            // "", ""
```

`dir + file == path`. Always.

## 14. Function semantics — `filepath.Match`

```go
func Match(pattern, name string) (matched bool, err error)
```

Same pattern syntax as `Glob`. The match is against `name` as a
whole; no anchoring needed.

Important constraint: `*` does NOT match the path separator. So
`Match("*", "a/b")` is `false`, but `Match("a/*", "a/b")` is `true`.

## 15. Platform differences

### Unix

```go
filepath.Separator       == '/'
filepath.ListSeparator   == ':'
filepath.IsAbs("/foo")   // true
filepath.IsAbs("foo")    // false
filepath.VolumeName(...) // always ""
```

### Windows

```go
filepath.Separator       == '\\'
filepath.ListSeparator   == ';'
filepath.IsAbs("C:\\")   // true
filepath.IsAbs("\\\\srv\\share") // true
filepath.IsAbs("foo")    // false

filepath.VolumeName("C:\\Users")          // "C:"
filepath.VolumeName("\\\\server\\share")  // "\\\\server\\share"
filepath.VolumeName("\\\\?\\C:\\Users")   // "\\\\?\\C:"
```

Windows also normalizes `/` to `\` in most function results, but
input with `/` is accepted by `Clean`, `Join`, etc.

## 16. `path` package semantics

Same shape as `filepath.{Base,Clean,Dir,Ext,IsAbs,Join,Match,Split}`,
but always uses `/`. Never platform-dependent.

```go
path.Join("a", "b")     // "a/b" on all platforms
path.Clean("a/./b/../") // "a"
path.Dir("a/b/c")        // "a/b"
path.Base("a/b/c")       // "c"
```

Use for: URL path components, S3/GCS keys, ZIP archive entries,
Go import paths, anything that is logically slash-separated and
not a filesystem path.

## 17. `fs.WalkDir` (cross-link)

`io/fs.WalkDir` works with `fs.FS`, not the OS directly:

```go
func WalkDir(fsys FS, root string, fn WalkDirFunc) error
```

`filepath.WalkDir` is equivalent to `fs.WalkDir(os.DirFS(""), root, fn)`
but uses the OS directly for efficiency.

For testable code, accept `fs.FS` and call `fs.WalkDir`. For
production code that needs to walk the actual filesystem, use
`filepath.WalkDir`.

## 18. Complexity summary

| Function | Time |
|----------|------|
| `Clean`, `Join`, `Base`, `Dir`, `Ext` | O(n) where n = path length |
| `Abs` | O(n) + `getcwd` syscall |
| `Glob` | O(entries matched + pattern complexity) |
| `Match` | O(name × pattern) worst case |
| `Walk`, `WalkDir` | O(total entries) + filesystem cost |
| `EvalSymlinks` | O(path depth × symlinks per level) |
| `Rel` | O(max(base, target)) |

## 19. Compatibility notes

- All listed functions are part of Go 1 compatibility promise.
- `IsLocal`: Go 1.20+.
- `SkipAll`: Go 1.20+.
- `Localize`: Go 1.23+.
- `os.OpenRoot`: Go 1.24+.
- `fs.WalkDir` and the `io/fs` package: Go 1.16+.

## 20. References

- [pkg.go.dev/path](https://pkg.go.dev/path)
- [pkg.go.dev/path/filepath](https://pkg.go.dev/path/filepath)
- [pkg.go.dev/io/fs](https://pkg.go.dev/io/fs)
- Source: `$GOROOT/src/path/`, `$GOROOT/src/path/filepath/`,
  `$GOROOT/src/io/fs/`
- Cross-links: [`../05-os/`](../05-os/index.md),
  [`../14-io-fs/`](../14-io-fs/index.md),
  [`../09-go-embed/`](../09-go-embed/index.md).
