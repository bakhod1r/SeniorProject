# 8.21 `path` and `path/filepath` — Senior

> **Audience.** You're writing the file-system code others depend
> on. You're asked why two seemingly-equivalent walks have different
> performance, how to prevent path traversal attacks bulletproofly,
> and whether `WalkDir` is safe to use concurrently. This file is
> the layer where you understand the OS and runtime mechanics.

## 1. `WalkDir` internals: why it's faster than `Walk`

`Walk` calls `os.Lstat` on every entry to produce an `os.FileInfo`:

```go
// Simplified Walk:
for _, name := range readdirnames(dir) {
    path := filepath.Join(dir, name)
    info, err := os.Lstat(path) // SYSCALL: stat
    err = walkFn(path, info, err)
    ...
}
```

`WalkDir` uses `os.ReadDir`, which returns `[]os.DirEntry`. The
`os.DirEntry` interface exposes `Name()`, `IsDir()`, and `Type()`
**from the directory entry itself** — already in memory after the
`getdents`/`readdir` syscall:

```go
// Simplified WalkDir:
for _, d := range readdir(dir) {  // SYSCALL: getdents
    path := filepath.Join(dir, d.Name())
    err := walkFn(path, d, nil)
    ...
}
```

For each entry, `Walk` does an extra `Lstat` (one syscall). For a
tree with 1M files, that's 1M extra syscalls. `Lstat` is fast (a
few microseconds), but 1M × few microseconds = several seconds.

The catch: if you call `d.Info()` on a `DirEntry`, you trigger the
same `Lstat`. `WalkDir` is faster only when most callbacks don't
need the full `FileInfo`.

## 2. The `getdents` underbelly

`os.ReadDir` on Linux calls the `getdents64` syscall, which returns
multiple directory entries per call. The kernel buffers ~4 KB of
entries; for very large directories (millions of entries), this
amortizes nicely.

On filesystems with slow `getdents` (NFS, FUSE, network-mounted
storage), walks are dominated by directory reads, not stats. In
that regime, `WalkDir`'s advantage shrinks.

`os.ReadDir` returns sorted by name (Go ≥ 1.16). The sort is done
in Go space, not by the kernel. For a directory with 1M entries,
the sort is 1M log2(1M) ≈ 20M comparisons — measurable.

For unsorted enumeration (when order doesn't matter and the
directory is huge), drop to `os.OpenFile` + `(*os.File).Readdir`
with a small batch size and skip the sort. Most callers don't need
this; the sort is helpful for debugging.

## 3. The `fs.DirEntry` interface

```go
type DirEntry interface {
    Name() string
    IsDir() bool
    Type() FileMode  // file type bits, NOT permission bits
    Info() (FileInfo, error)
}
```

`Type()` returns only the file-type bits from `FileMode`: directory,
symlink, named pipe, socket, etc. It does NOT return permission
bits — `Info()` is required for that.

This matters for symlink handling: `Type()` returns
`fs.ModeSymlink` if the entry is a symlink, **without resolving
it**. To check whether the target is a directory, call
`os.Stat(path)` (which follows symlinks) vs `os.Lstat(path)` (which
doesn't).

## 4. Path traversal: the full defense

User-supplied paths can attack three boundaries: the base
directory, the OS root, and the process's privilege boundary.

### 4.1 The naive defense (broken)

```go
func unsafeServe(base, name string) string {
    return filepath.Join(base, name)
}
```

Attack: `name = "../../etc/passwd"`. `Join` resolves the `..`s and
the result escapes `base`.

### 4.2 The classic defense

```go
func saferServe(base, name string) (string, error) {
    p := filepath.Join(base, name)
    p = filepath.Clean(p)
    absBase, _ := filepath.Abs(base)
    absP, _ := filepath.Abs(p)
    if !strings.HasPrefix(absP, absBase + string(filepath.Separator)) {
        return "", errEscape
    }
    return p, nil
}
```

This works for most cases, but has subtle issues:

- `HasPrefix` matches `"/foo"` as a prefix of `"/foobar"`. The
  `+ string(filepath.Separator)` fixes that — but the trailing
  slash is itself fragile (what if `absBase` already ends in `/`?).
- Symlinks inside `base` can still escape: if `base/link` is a
  symlink to `/etc/passwd`, the path-string check passes.

### 4.3 The modern defense

```go
func bestServe(base, name string) (string, error) {
    if !filepath.IsLocal(name) {
        return "", errEscape
    }
    return filepath.Join(base, name), nil
}
```

`IsLocal` (Go 1.20+) rejects:

- Absolute paths.
- Paths with `..` components that escape.
- Empty paths.
- Windows-specific traps (NUL, COM1, etc., reserved names).

For symlink-safe access, combine with `os.Root` (Go 1.24+):

```go
root, err := os.OpenRoot(base) // base is the trust boundary
if err != nil { return err }
defer root.Close()

f, err := root.Open(name) // any escape attempt fails at the syscall layer
```

`os.OpenRoot` uses the `openat2` syscall on Linux (with
`RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS`) to enforce the boundary
in the kernel. This is the gold standard.

## 5. Symlink loops

`filepath.EvalSymlinks` detects loops:

```go
// /tmp/loop -> /tmp/loop
real, err := filepath.EvalSymlinks("/tmp/loop")
// err: too many links
```

The implementation tracks visited paths and gives up at ~40 levels.

If you implement your own resolver (rare), you must handle:

- Direct loops: `A → A`.
- Indirect loops: `A → B → A`.
- Length-bounded loops: `A → B → C → ... → A`.

The standard limit is `MAXSYMLINKS` (Linux: 40; macOS: 32; varies
elsewhere). Beyond that, return ELOOP.

## 6. Cross-compilation behavior

`filepath.Separator` and friends are determined at **compile time**,
not runtime, based on `GOOS`:

```go
// path/filepath/path_unix.go:
const Separator = '/'
const ListSeparator = ':'

// path/filepath/path_windows.go:
const Separator = '\\'
const ListSeparator = ';'
```

This is enforced by build tags. Cross-compiling for Windows from
Linux gives you `\`-using `filepath.Join` results — even though
your build host uses `/`.

The implication: testing path code on Linux doesn't catch Windows
bugs. CI must build and test on Windows (or use `GOOS=windows`
with `go test` for compile-only checks).

## 7. The `filepath.WalkFunc` contract in depth

```go
type WalkFunc func(path string, info fs.FileInfo, err error) error
```

The contract:

1. `err != nil` means the directory read failed. `path` is the
   directory; `info` may be `nil` or stale. Return `nil` to
   continue; return any error to abort.

2. `path` is **slash-separated on Unix, backslash-separated on
   Windows**. Don't compare against literal `"/"` in a
   cross-platform way.

3. `info` is from `os.Lstat`, not `os.Stat`. Symlinks appear as
   symlinks, not their targets.

4. Returning `filepath.SkipDir`:
   - From a directory: skip its contents.
   - From a file: skip the rest of the parent's contents.
   - From the root: stops the walk.

5. Returning any other error: aborts the walk; that error is
   returned from `Walk`.

6. The order is deterministic: lexical sort within each directory.
   But if the directory is modified during the walk, behavior is
   undefined.

## 8. `WalkDir` vs custom recursion

For specialized use (e.g., parallel walk, custom ordering), you
might implement your own walker. The pattern:

```go
func walk(root string, fn func(string, fs.DirEntry) error) error {
    info, err := os.Lstat(root)
    if err != nil { return err }
    if !info.IsDir() {
        return fn(root, fs.FileInfoToDirEntry(info))
    }
    entries, err := os.ReadDir(root)
    if err != nil { return err }
    for _, e := range entries {
        path := filepath.Join(root, e.Name())
        if e.IsDir() {
            if err := walk(path, fn); err != nil { return err }
        } else {
            if err := fn(path, e); err != nil { return err }
        }
    }
    return nil
}
```

The stdlib `WalkDir` is a polished version of this. Roll your own
only for parallel walks or custom skip behavior; otherwise use the
standard.

### Parallel walk pattern

```go
func parallelWalk(root string, workers int, fn func(string, fs.DirEntry) error) error {
    ch := make(chan string, workers)
    g, ctx := errgroup.WithContext(context.Background())
    g.Go(func() error {
        defer close(ch)
        return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
            if err != nil { return err }
            if d.IsDir() { return nil }
            select {
            case ch <- path:
                return nil
            case <-ctx.Done():
                return ctx.Err()
            }
        })
    })
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for path := range ch {
                d, err := os.Lstat(path)
                if err != nil { return err }
                if err := fn(path, fs.FileInfoToDirEntry(d)); err != nil {
                    return err
                }
            }
            return nil
        })
    }
    return g.Wait()
}
```

Single producer (the walker) feeds N consumers. Common pattern when
the per-file work is CPU-heavy (e.g., parsing). For I/O-bound work,
parallelism beyond 4-8 is rarely beneficial.

## 9. `filepath.Clean` edge cases

`Clean` normalizes a path by:

1. Replacing multiple separators with single ones.
2. Resolving `.` and `..` components.
3. Stripping trailing separators (except for the root).

```go
filepath.Clean("a//b/./c/../d") // "a/b/d"
filepath.Clean("/")             // "/"
filepath.Clean("")              // "." (NOT empty)
filepath.Clean(".")             // "."
filepath.Clean("../a")          // "../a" (cannot resolve without context)
```

Surprises:

- `Clean("")` returns `"."`, not `""`. Don't pass empty strings
  through `Clean` and expect a falsy result.
- `Clean("/a/../../b")` returns `/b`. The path is "cleaned" past
  the root, which is the convention for absolute paths.
- Symlinks are NOT resolved. `Clean` is purely textual.

## 10. `filepath.Base` and `filepath.Ext`

```go
filepath.Base("/usr/local/bin/")       // "bin"
filepath.Base("/usr/local/bin")        // "bin"
filepath.Base("")                       // "."
filepath.Base("/")                      // "/"

filepath.Ext("file.tar.gz")             // ".gz" (last . onward)
filepath.Ext("README")                  // ""
filepath.Ext(".bashrc")                 // ".bashrc" (hidden files are tricky)
```

`Ext` returns from the last `.` onward, including the `.`. For
`.bashrc`, the entire name starts with `.`, so `Ext` returns
`.bashrc`. This is rarely what callers want.

For dual extensions (`.tar.gz`, `.min.js`), parse manually:

```go
func ext2(name string) string {
    name = filepath.Base(name)
    if i := strings.Index(name, "."); i >= 0 {
        return name[i:]
    }
    return ""
}
```

## 11. `filepath.Abs` and the working directory

```go
abs, err := filepath.Abs("file.txt")
// abs == "/current/working/dir/file.txt"
```

`Abs` calls `os.Getwd()` internally if the path is relative. This
involves a syscall (`getcwd`) and is therefore not cheap.

For repeated `Abs` calls in a hot loop, cache the working
directory:

```go
wd, _ := os.Getwd()
for _, p := range paths {
    abs := p
    if !filepath.IsAbs(abs) {
        abs = filepath.Join(wd, abs)
    }
    // use abs
}
```

This is what `filepath.Abs` does internally; the manual version
avoids re-fetching `wd` on every call.

## 12. The `io/fs` connection

`fs.FS` is the abstract filesystem. `WalkDir` works with any `fs.FS`,
not just the OS:

```go
import "io/fs"

fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    // ...
})
```

`fsys` can be:

- `os.DirFS(root)` — wraps a directory.
- An embedded `embed.FS` — see
  [`../09-go-embed/`](../09-go-embed/index.md).
- `fstest.MapFS` — for tests.
- Any custom implementation (database-backed, network-mounted).

This is the abstraction that makes file-walking code testable. Where
possible, write functions that accept `fs.FS` rather than a `string`
root path.

## 13. Performance: `filepath.Join` is not free

```go
// Inner loop:
for _, name := range names {
    path := filepath.Join(dir, name)
    // ...
}
```

`Join` does:

1. Concatenate with separator.
2. `Clean` the result.

For a million calls, that's a million small allocations and a
million `Clean` passes.

Optimized version (when you control `dir`):

```go
dirWithSep := dir + string(filepath.Separator)
buf := make([]byte, 0, len(dirWithSep) + 256)
for _, name := range names {
    buf = append(buf[:0], dirWithSep...)
    buf = append(buf, name...)
    path := string(buf) // necessary if you keep the path
    // ...
}
```

This skips `Clean` (you're trusting that `name` is well-formed).
Use only when profiles justify and inputs are validated.

## 14. References

- `path/filepath/path.go`, `path_unix.go`, `path_windows.go` — the
  package source.
- `io/fs/walk.go` — `WalkDir`'s implementation.
- `os/file.go` — `ReadDir`, `OpenRoot`.
- [Linux `getdents64(2)`](https://man7.org/linux/man-pages/man2/getdents.2.html)
- [Linux `openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html)
  — the syscall behind `os.OpenRoot`.
