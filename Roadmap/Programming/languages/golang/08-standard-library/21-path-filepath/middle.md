# 8.21 `path` and `path/filepath` — Middle

> **Audience.** You can call `filepath.Join` and `Dir`. Now you need
> to walk a tree, glob for files, resolve symlinks, write code that
> works on both Linux and Windows, and figure out why `filepath.Rel`
> sometimes returns a path with `..` in it.

## 1. `filepath.Walk` — the classic traversal

`Walk` visits every file and directory under a root, calling your
function for each:

```go
err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if err != nil {
        return err // typically: cannot read directory
    }
    fmt.Println(path, info.Size())
    return nil
})
```

The callback receives:

- `path` — the full path including `root` as a prefix.
- `info` — `os.FileInfo` for the entry. `nil` if there was an error
  reading the directory.
- `err` — non-nil if reading the directory failed (e.g., permission
  denied). Return `nil` to skip that subtree and continue, or
  return the error to abort.

`Walk` returns in lexical order within each directory.

## 2. `filepath.WalkDir` — the modern replacement

Go 1.16 added `WalkDir`, which is faster and more flexible:

```go
err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() {
        return nil // continue walking
    }
    info, err := d.Info()
    if err != nil { return err }
    fmt.Println(path, info.Size())
    return nil
})
```

Why `WalkDir` is preferred:

- `fs.DirEntry` is **lazy** — `IsDir()` and `Name()` are free
  (already known from the directory read), but `Info()` requires a
  separate `stat`. `Walk` always calls `stat` for every entry.
- For a tree with 100k files where you only need names, `WalkDir`
  is 2–5× faster.
- The `fs.DirEntry` interface plugs into `io/fs.FS`, the abstract
  filesystem package — your code becomes testable with a virtual
  filesystem.

Use `WalkDir` for new code. Use `Walk` only if you need
`os.FileInfo` for every entry (then the eager `stat` isn't waste).

## 3. Controlling traversal: `SkipDir` and `SkipAll`

The callback's return value is a control signal:

```go
err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if d.IsDir() && d.Name() == "node_modules" {
        return filepath.SkipDir // don't descend into this directory
    }
    if shouldStopEarly(path) {
        return filepath.SkipAll // stop the entire walk (Go 1.20+)
    }
    return nil
})
```

`SkipDir` is the most common control: it tells the walk to skip
the remaining contents of the current directory. If the current
entry is a directory, that means skip its contents; if it's a
file, that means skip the rest of the parent's contents (less
common, but documented).

`SkipAll` (Go 1.20+) terminates the entire walk without returning
an error. Before 1.20, the idiom was a sentinel `errStop` that the
caller filtered out — works but uglier.

Returning any other non-nil error aborts and propagates to the
caller of `WalkDir`.

## 4. `filepath.Glob` — shell-style patterns

```go
matches, err := filepath.Glob("*.go")
matches, err = filepath.Glob("src/*/main.go")
matches, err = filepath.Glob("logs/2024-??-??.log")
```

Pattern syntax (from `filepath.Match`):

- `*` — matches any sequence of non-separator characters.
- `?` — matches exactly one non-separator character.
- `[abc]` — matches any of the listed characters.
- `[a-z]` — character range.
- `[^abc]` — negated.

**Important:** `*` does **not** cross directory boundaries (no
recursive `**`). For `src/**/main.go` (any depth), use `WalkDir`
and `Match` per entry:

```go
var matches []string
filepath.WalkDir("src", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.Name() == "main.go" {
        matches = append(matches, path)
    }
    return nil
})
```

`Glob` returns paths in lexical order. If no files match, it
returns `nil, nil` — not an error. Errors are reserved for bad
patterns.

## 5. `filepath.Match` — single-pattern check

```go
ok, err := filepath.Match("*.go", "main.go")     // true, nil
ok, err = filepath.Match("*.go", "src/main.go")  // false, nil (path separator)
ok, err = filepath.Match("[", "x")               // false, ErrBadPattern
```

Pattern syntax matches `Glob`. Useful when you have a path and want
to test it against a pattern without globbing the filesystem.

`Match` is locale-agnostic; it doesn't care about case or Unicode
normalization. For case-insensitive matching, lowercase both sides
first.

## 6. `filepath.EvalSymlinks` — resolve symlinks

```go
real, err := filepath.EvalSymlinks("/var/log/syslog")
// real might be "/var/log/2024/01/15/syslog" if /var/log/syslog → newest log
```

`EvalSymlinks` walks the path, resolving symbolic links at every
component. The result is an absolute, symlink-free path (assuming
no race with the filesystem).

It returns an error if any component doesn't exist or if there's a
symlink loop.

Use cases:

- Compare two paths for "do they refer to the same file?".
- Validate that a user-supplied path doesn't escape a sandbox via
  symlinks.
- Find the actual location of a binary that was invoked via a
  symlink (`os.Executable` + `EvalSymlinks`).

## 7. `filepath.Rel` — relative path between two absolute paths

```go
rel, err := filepath.Rel("/home/alice", "/home/alice/docs/file.txt")
// rel == "docs/file.txt", err == nil

rel, err = filepath.Rel("/home/alice", "/home/bob/file.txt")
// rel == "../bob/file.txt", err == nil

rel, err = filepath.Rel("/home/alice", "../etc")
// err: cannot compute relative path (one absolute, one relative)
```

Rules:

- Both arguments must be the same kind: both absolute or both
  relative.
- The result may include `..` components if the target is not under
  the base.
- The result, when joined with the base, equals the target (after
  cleaning).

Use case: generating import paths, displaying user-friendly paths
from absolute paths in error messages.

## 8. `filepath.IsAbs` and `filepath.IsLocal`

```go
filepath.IsAbs("/etc/passwd")     // true on Unix
filepath.IsAbs("C:\\Windows")     // true on Windows
filepath.IsAbs("./relative")      // false

filepath.IsLocal("docs/file.txt")     // true
filepath.IsLocal("../escape")          // false (Go 1.20+)
filepath.IsLocal("/etc/passwd")        // false
filepath.IsLocal("docs/../../escape")  // false
```

`IsLocal` (Go 1.20+) is the right check for "is this path safe to
join with a base directory without escaping it?". It rejects
absolute paths, paths with `..` components that escape, and paths
with reserved names on Windows.

For path-traversal prevention, `IsLocal` is the modern, correct
check. Before 1.20, the idiom was:

```go
clean := filepath.Clean(p)
if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
    return errUnsafe
}
```

`IsLocal` encapsulates this and handles Windows specifics
correctly.

## 9. `filepath.SplitList` — splitting `PATH`-style strings

The `PATH` environment variable separator is `:` on Unix, `;` on
Windows. `SplitList` handles both:

```go
dirs := filepath.SplitList(os.Getenv("PATH"))
for _, dir := range dirs {
    candidate := filepath.Join(dir, "myprog")
    if _, err := os.Stat(candidate); err == nil {
        return candidate, nil
    }
}
```

`filepath.ListSeparator` is the platform separator as a `rune`.

## 10. Cross-platform path handling

The `path` and `path/filepath` distinction is essential for portable
code:

| Use case | Package |
|----------|---------|
| File system paths | `filepath` |
| URL paths | `path` |
| Import paths | `path` |
| Cloud storage keys (S3, GCS) | `path` |
| ZIP archive entries | `path` (always `/`) |
| Operating system paths | `filepath` |

`filepath` uses the host OS separator. `path` always uses `/`.
Mixing them on Windows is a common bug:

```go
// BAD on Windows:
key := path.Join("dir", "file.txt")
err := os.Open(key)  // "dir/file.txt" — works on Linux, may work on Windows

// CORRECT:
key := filepath.Join("dir", "file.txt")  // "dir\\file.txt" on Windows
err := os.Open(key)
```

Windows actually accepts both `/` and `\` in most API calls, so
the `path.Join` version often works by accident. The portable
guarantee is `filepath`.

## 11. `filepath.VolumeName` and Windows specifics

On Windows, paths have a "volume name" prefix: `C:`, `\\server\share`,
or `\\?\C:`. `VolumeName` extracts it:

```go
filepath.VolumeName(`C:\Users\alice`)   // "C:"
filepath.VolumeName(`\\server\share\f`) // "\\server\share"
filepath.VolumeName(`/usr/local`)       // "" on Unix, "" on Windows
```

On Unix, `VolumeName` always returns `""`. On Windows, the result
is meaningful for distinguishing drive paths.

`filepath.Separator` is `/` on Unix, `\` on Windows.
`filepath.ListSeparator` is `:` on Unix, `;` on Windows.

## 12. `filepath.Localize` (Go 1.23+)

`Localize` converts a slash-separated, "io/fs"-style path to the
host's path syntax:

```go
local, err := filepath.Localize("dir/file.txt")
// On Linux: "dir/file.txt", nil
// On Windows: "dir\\file.txt", nil

local, err = filepath.Localize("../escape")
// err: invalid path (Localize rejects unsafe paths)
```

Useful when reading paths from a portable format (config file,
archive metadata) and converting to filesystem operations. The
function also enforces `IsLocal` semantics — refuses to produce a
path that could escape.

## 13. Writing portable directory walkers

Putting it together: a recursive Go file finder that respects
`.gitignore`-style exclusions:

```go
func findGoFiles(root string, excludeDirs []string) ([]string, error) {
    excl := make(map[string]bool)
    for _, d := range excludeDirs {
        excl[d] = true
    }
    var found []string
    err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
        if err != nil { return err }
        if d.IsDir() {
            if excl[d.Name()] {
                return filepath.SkipDir
            }
            return nil
        }
        if filepath.Ext(d.Name()) == ".go" {
            found = append(found, path)
        }
        return nil
    })
    return found, err
}
```

Properties:

- `WalkDir` for efficiency.
- `SkipDir` for excluded directories (no `stat` of their contents).
- `filepath.Ext` for the file extension check.
- Returns paths in deterministic order (lexical within each
  directory).

## 14. Common middle-tier mistakes

### 14.1 Hardcoded separators

```go
// BAD: breaks on Windows
path := dir + "/" + name
```

Use `filepath.Join`:

```go
path := filepath.Join(dir, name)
```

`Join` cleans the result: `Join("/a/", "/b/")` is `"/a/b"`, not
`"/a//b"`.

### 14.2 Trusting user-supplied paths

```go
func serve(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("file")
    http.ServeFile(w, r, filepath.Join("./uploads", name))
    // BAD: name = "../../etc/passwd" escapes the upload dir
}
```

Validate with `IsLocal`:

```go
if !filepath.IsLocal(name) {
    http.Error(w, "bad path", 400)
    return
}
http.ServeFile(w, r, filepath.Join("./uploads", name))
```

### 14.3 Modifying paths during a `Walk`

`Walk`'s contract: the callback must not modify the file system in
a way that affects the rest of the walk. Specifically:

- Creating files in the current directory may or may not be
  visited.
- Renaming or deleting directories you haven't visited yet is
  undefined.

The safe pattern: collect paths during the walk, mutate after.

### 14.4 Using `Glob` for recursive search

```go
// BUG: only matches direct children
matches, _ := filepath.Glob("src/*.go")
```

Use `WalkDir` for recursive search.

### 14.5 Path comparison without `Clean`

```go
if a == b { /* same file */ }  // BUG: "./x" != "x"
```

Either `filepath.Clean` both sides, or `filepath.EvalSymlinks` for
"refers to same inode".

## 15. Where to go next

The senior file covers:

- WalkDir's internals — how it avoids redundant stats.
- Path traversal security in depth.
- Symlink loops and cycle detection.
- Cross-compilation behavior of path constants.
- The `filepath.WalkFunc` contract's edge cases.

The professional file picks up production patterns: file indexing,
archive extraction, watch directories.
