# 8.21 `path` and `path/filepath` — Find the Bug

> Twelve buggy snippets. Each compiles. Each looks reasonable. Each
> has a real bug — security, correctness, performance, or
> portability. Find it, explain it, write the fix.

## Bug 1 — The classic path traversal

```go
func serveFile(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("file")
    http.ServeFile(w, r, filepath.Join("./uploads", name))
}
```

**What happens?**

`?file=../../etc/passwd` serves the password file. `filepath.Join`
resolves the `..`s; the result escapes `./uploads`.

**Why?**

`Join` is lexical; it does not enforce containment.

**Fix.**

```go
if !filepath.IsLocal(name) {
    http.Error(w, "invalid path", 400)
    return
}
http.ServeFile(w, r, filepath.Join("./uploads", name))
```

For Go 1.24+, use `os.OpenRoot` for kernel-enforced safety.

## Bug 2 — Hardcoded separator

```go
func configPath(home, app string) string {
    return home + "/.config/" + app + "/config.toml"
}
```

**What happens?**

Works on Linux. On macOS, lives in the wrong place
(`~/.config` vs `~/Library/Application Support`). On Windows, breaks
because `\` is the separator.

**Why?**

Hardcoded `/`, ignoring `os.UserConfigDir`.

**Fix.**

```go
func configPath(app string) (string, error) {
    base, err := os.UserConfigDir()
    if err != nil { return "", err }
    return filepath.Join(base, app, "config.toml"), nil
}
```

## Bug 3 — `path.Join` for filesystem path

```go
import "path"

func openLog(dir, name string) (*os.File, error) {
    return os.Open(path.Join(dir, name))
}
```

**What happens?**

On Windows: `path.Join("logs", "2024.log")` returns `"logs/2024.log"`.
Windows generally accepts forward slashes, but in some contexts
(symlinks, certain tools, network paths) this fails.

**Why?**

Wrong package. `path` is for slash-separated URL/import paths;
`filepath` is for filesystem paths.

**Fix.**

```go
import "path/filepath"
return os.Open(filepath.Join(dir, name))
```

## Bug 4 — `Walk` without checking the err parameter

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    fmt.Println(path, info.Size())
    return nil
})
```

**What happens?**

If a subdirectory is unreadable, `info` is `nil` and `info.Size()`
panics with a nil pointer dereference.

**Why?**

The `err` parameter signals "couldn't read this entry"; the
callback must handle it.

**Fix.**

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if err != nil { return nil } // or return err to abort
    fmt.Println(path, info.Size())
    return nil
})
```

## Bug 5 — `Glob` for recursive search

```go
files, _ := filepath.Glob("src/**/*.go")
```

**What happens?**

Returns no files (or only direct children of a literal `**`
directory).

**Why?**

`filepath.Glob` does not support `**`. The `*` doesn't cross
separator boundaries.

**Fix.**

```go
var files []string
filepath.WalkDir("src", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if filepath.Ext(path) == ".go" {
        files = append(files, path)
    }
    return nil
})
```

## Bug 6 — Modifying tree during `Walk`

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if strings.HasSuffix(path, ".tmp") {
        os.Remove(path)
    }
    return nil
})
```

**What happens?**

May skip files (the directory's contents changed mid-iteration) or
revisit deleted entries. Behavior is undefined.

**Why?**

`Walk`'s contract: the file system must not change during the walk
in ways that affect the rest of the traversal.

**Fix.**

```go
var toRemove []string
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if strings.HasSuffix(d.Name(), ".tmp") {
        toRemove = append(toRemove, path)
    }
    return nil
})
for _, p := range toRemove {
    os.Remove(p)
}
```

## Bug 7 — Comparing paths without `Clean`

```go
func isSame(a, b string) bool {
    return a == b
}

isSame("./x", "x")          // false
isSame("/a/b/../c", "/a/c") // false
```

**What happens?**

Equivalent paths compare unequal because the string forms differ.

**Why?**

`==` is byte-equality; paths can have multiple syntactic
representations.

**Fix.**

```go
func isSame(a, b string) bool {
    return filepath.Clean(a) == filepath.Clean(b)
}
```

For "refers to the same file", use `os.SameFile` (handles symlinks
and hardlinks).

## Bug 8 — Symlink confused for a directory

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if err != nil { return err }
    if info.IsDir() {
        // ...
    }
    return nil
})
```

**What happens?**

A symlink to a directory shows up as a symlink (`info.Mode()&os.ModeSymlink != 0`),
not as a directory. `IsDir()` is `false`. The directory is skipped.

**Why?**

`Walk` uses `os.Lstat`, which doesn't follow symlinks. This is
deliberate: to avoid loops.

**Fix.**

If you want to follow symlinks (with loop detection):

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if err != nil { return err }
    if info.Mode()&os.ModeSymlink != 0 {
        target, err := filepath.EvalSymlinks(path)
        if err != nil { return nil }
        targetInfo, err := os.Stat(target)
        if err != nil { return nil }
        if targetInfo.IsDir() {
            // recursively walk target — track visited paths!
        }
    }
    return nil
})
```

Tracking visited paths is essential to avoid infinite loops.

## Bug 9 — Zip extraction without `IsLocal` check

```go
for _, f := range zipFile.File {
    target := filepath.Join(dest, f.Name)
    out, _ := os.Create(target)
    rc, _ := f.Open()
    io.Copy(out, rc)
    out.Close()
    rc.Close()
}
```

**What happens?**

If `f.Name` is `"../../etc/passwd"`, `target` escapes `dest`. The
extraction writes outside the destination. This is the classic
Zip Slip vulnerability.

**Why?**

`Join` doesn't enforce containment.

**Fix.**

```go
for _, f := range zipFile.File {
    if !filepath.IsLocal(f.Name) {
        return fmt.Errorf("unsafe entry: %q", f.Name)
    }
    target := filepath.Join(dest, f.Name)
    // ... rest unchanged
}
```

Plus defense in depth: refuse to extract symlinks and hardlinks.

## Bug 10 — `filepath.Ext` on a dual extension

```go
func contentType(name string) string {
    switch filepath.Ext(name) {
    case ".gz":
        return "application/gzip"
    case ".tar":
        return "application/tar"
    }
    return "application/octet-stream"
}

contentType("backup.tar.gz") // ???
```

**What happens?**

`Ext` returns `".gz"`, so the result is `"application/gzip"`. But
the file is a tarball.

**Why?**

`Ext` returns from the last `.` onward. Dual extensions are not
recognized.

**Fix.**

For dual extensions, parse manually or use a content-type library:

```go
func contentType(name string) string {
    name = filepath.Base(name)
    if i := strings.Index(name, "."); i >= 0 {
        switch name[i:] {
        case ".tar.gz", ".tgz": return "application/gzip"
        case ".gz":             return "application/gzip"
        case ".tar":            return "application/tar"
        }
    }
    return "application/octet-stream"
}
```

Or use `mime.TypeByExtension` which has its own table.

## Bug 11 — `Abs` in a loop

```go
for _, p := range paths {
    abs, _ := filepath.Abs(p)
    process(abs)
}
```

**What happens?**

Each call to `Abs` invokes `os.Getwd()`, which is a syscall. For
1M paths, that's 1M syscalls just to get the working directory.

**Why?**

`Abs` doesn't cache the working directory.

**Fix.**

```go
wd, err := os.Getwd()
if err != nil { return err }
for _, p := range paths {
    var abs string
    if filepath.IsAbs(p) {
        abs = filepath.Clean(p)
    } else {
        abs = filepath.Join(wd, p)
    }
    process(abs)
}
```

For 1M paths, this is the difference between seconds and
milliseconds.

## Bug 12 — `EvalSymlinks` race condition

```go
func checkAccess(p, base string) error {
    real, err := filepath.EvalSymlinks(p)
    if err != nil { return err }
    if !strings.HasPrefix(real, base) {
        return errors.New("outside base")
    }
    // ... time passes ...
    f, err := os.Open(p) // SECURITY HOLE: p might now be a symlink
    if err != nil { return err }
    defer f.Close()
    return process(f)
}
```

**What happens?**

Between the `EvalSymlinks` check and the `os.Open`, an attacker
can replace `p` with a symlink that points outside `base`. The
check passes; the open accesses the symlink target. This is a
TOCTOU (Time Of Check / Time Of Use) race.

**Why?**

The check and the open are two separate filesystem operations.

**Fix.**

```go
// Go 1.24+:
root, err := os.OpenRoot(base)
if err != nil { return err }
defer root.Close()
rel, err := filepath.Rel(base, p)
if err != nil { return err }
f, err := root.Open(rel)
// `Root` enforces the boundary in the kernel; no race window.
```

For older Go, the race cannot be fully eliminated with `EvalSymlinks`.
The defense is to use `openat` with the right resolve flags directly
(via `golang.org/x/sys/unix`).

## Bonus — The `Clean("")` surprise

```go
func savePath(p string) string {
    return filepath.Clean(p)
}

s := savePath("")
fmt.Println(s == "")  // false
fmt.Println(s == ".") // true
```

**What happens?**

`Clean("")` returns `"."`, not `""`.

**Why?**

The empty path is treated as "current directory".

**Fix.**

Special-case empty input if your code expects empty-out-for-empty-in:

```go
func savePath(p string) string {
    if p == "" { return "" }
    return filepath.Clean(p)
}
```

Most code that doesn't special-case empty strings ends up with
`"."` appearing in unexpected places (logs, error messages,
filenames).
