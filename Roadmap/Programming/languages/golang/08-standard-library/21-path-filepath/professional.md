# 8.21 `path` and `path/filepath` — Professional

> **Audience.** You're the engineer who owns the file-system code in
> a production service: archive extractors, file watchers, log
> rotators, build systems, search indexers. This file is the
> production playbook for `path/filepath` — patterns that have
> survived contact with real workloads, real attackers, and real
> filesystems.

## 1. Safe archive extraction

Extracting a tar or zip archive is a famous source of CVEs. The
class of attacks is "Zip Slip": archive entries with `..` in their
paths escape the destination directory.

The unsafe version:

```go
func extractUnsafe(r io.Reader, dest string) error {
    tr := tar.NewReader(r)
    for {
        hdr, err := tr.Next()
        if err == io.EOF { return nil }
        if err != nil { return err }
        target := filepath.Join(dest, hdr.Name) // BAD: hdr.Name may be ../../passwd
        switch hdr.Typeflag {
        case tar.TypeReg:
            f, err := os.Create(target)
            if err != nil { return err }
            _, err = io.Copy(f, tr)
            f.Close()
            if err != nil { return err }
        }
    }
}
```

The safe version:

```go
func extractSafe(r io.Reader, dest string) error {
    tr := tar.NewReader(r)
    absDest, err := filepath.Abs(dest)
    if err != nil { return err }

    for {
        hdr, err := tr.Next()
        if err == io.EOF { return nil }
        if err != nil { return err }

        // Reject absolute and parent-escaping paths.
        if !filepath.IsLocal(hdr.Name) {
            return fmt.Errorf("unsafe path %q", hdr.Name)
        }

        target := filepath.Join(absDest, hdr.Name)

        // Defense in depth: verify after Join.
        if !strings.HasPrefix(target, absDest+string(filepath.Separator)) {
            return fmt.Errorf("path escapes destination: %q", target)
        }

        switch hdr.Typeflag {
        case tar.TypeDir:
            if err := os.MkdirAll(target, 0o755); err != nil { return err }
        case tar.TypeReg:
            if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
                return err
            }
            f, err := os.OpenFile(target,
                os.O_WRONLY|os.O_CREATE|os.O_TRUNC|os.O_EXCL, 0o644)
            if err != nil { return err }
            // Limit decompression to avoid zip-bombs:
            _, err = io.CopyN(f, tr, maxFileSize)
            f.Close()
            if err != nil && err != io.EOF { return err }
        case tar.TypeSymlink, tar.TypeLink:
            return fmt.Errorf("symlinks not allowed")
        default:
            return fmt.Errorf("unsupported type: %v", hdr.Typeflag)
        }
    }
}
```

Defenses applied:

1. `filepath.IsLocal` rejects unsafe entry names.
2. Post-join prefix check as belt-and-suspenders.
3. `O_EXCL` prevents overwriting existing files (matters for
   symlinks pointing outside `dest` that already exist).
4. Symlinks and hard links rejected (subset of attacks).
5. `io.CopyN` bounds the per-file size (zip-bomb defense).

For Go 1.24+, use `os.OpenRoot(dest)` and `root.OpenFile(name)` for
kernel-enforced jailing.

## 2. Concurrent file indexer

A real indexer walks millions of files and processes each. Single-
threaded walks bottleneck on either filesystem I/O (slow) or CPU
work (slow).

```go
func index(root string, workers int) (map[string]int64, error) {
    type item struct {
        path string
        info fs.FileInfo
    }
    work := make(chan item, workers)
    results := make(chan struct{ path string; size int64 }, workers)

    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for w := range work {
                // CPU-heavy processing here (hash, parse, etc.):
                size := w.info.Size()
                results <- struct{ path string; size int64 }{w.path, size}
            }
        }()
    }

    go func() {
        wg.Wait()
        close(results)
    }()

    var walkErr error
    go func() {
        walkErr = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
            if err != nil { return err }
            if d.IsDir() { return nil }
            info, err := d.Info()
            if err != nil { return err }
            work <- item{path, info}
            return nil
        })
        close(work)
    }()

    out := make(map[string]int64)
    for r := range results {
        out[r.path] = r.size
    }
    return out, walkErr
}
```

The walk runs in one goroutine (the producer); N workers consume.
Backpressure is enforced by the bounded channels.

Tune `workers` based on the bottleneck:

- I/O-bound (network FS, slow disk): 1–4 workers.
- CPU-bound (parsing, hashing): `runtime.NumCPU()` workers.

Excessive parallelism on slow disks causes seek thrashing and
slows down the walk.

## 3. Watching a directory tree (polling)

For projects that need cross-platform directory watching without
external dependencies, polling is the portable answer:

```go
type Watcher struct {
    root    string
    interval time.Duration
    state   map[string]fs.FileInfo
    Events  chan Event
}

type Event struct {
    Op   Operation
    Path string
}

type Operation int
const (
    Create Operation = iota
    Modify
    Remove
)

func (w *Watcher) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-time.After(w.interval):
            if err := w.scan(); err != nil {
                return err
            }
        }
    }
}

func (w *Watcher) scan() error {
    seen := make(map[string]fs.FileInfo)
    err := filepath.WalkDir(w.root, func(path string, d fs.DirEntry, err error) error {
        if err != nil { return nil } // skip permission denied etc.
        info, err := d.Info()
        if err != nil { return nil }
        seen[path] = info
        prev, ok := w.state[path]
        switch {
        case !ok:
            w.Events <- Event{Create, path}
        case prev.ModTime() != info.ModTime() || prev.Size() != info.Size():
            w.Events <- Event{Modify, path}
        }
        return nil
    })
    for path := range w.state {
        if _, ok := seen[path]; !ok {
            w.Events <- Event{Remove, path}
        }
    }
    w.state = seen
    return err
}
```

This polls. For real-time notifications, use a OS-specific library:

- Linux: `golang.org/x/sys/unix` for inotify.
- macOS: `fsnotify` (wraps FSEvents).
- Windows: `fsnotify` (wraps ReadDirectoryChangesW).
- Cross-platform: `github.com/fsnotify/fsnotify`.

The polling version is right when:

- Event timeliness can tolerate seconds of delay.
- The tree is small (< 100k files).
- The team doesn't want a CGO dependency.

For large trees with sub-second latency requirements, use
`fsnotify` and accept the platform abstraction cost.

## 4. Cross-platform config file location

```go
func configPath(appName string) (string, error) {
    base, err := os.UserConfigDir()
    if err != nil { return "", err }
    return filepath.Join(base, appName, "config.toml"), nil
}
```

`os.UserConfigDir` returns:

- Linux: `$XDG_CONFIG_HOME` or `$HOME/.config`.
- macOS: `$HOME/Library/Application Support`.
- Windows: `%AppData%`.

Use it for new code. Hardcoded `~/.config/app/config.toml` works on
Linux and (sometimes) macOS but not Windows.

Other helpful constants:

- `os.UserCacheDir()` — cache files (Linux: `~/.cache`; macOS:
  `~/Library/Caches`; Windows: `%LocalAppData%`).
- `os.UserHomeDir()` — the home directory.
- `os.TempDir()` — temporary file directory.

## 5. Atomic file rename

Updating a config file should be atomic: either the old content or
the new, never half-written:

```go
func atomicWrite(path string, data []byte) error {
    dir := filepath.Dir(path)
    f, err := os.CreateTemp(dir, ".tmp-*")
    if err != nil { return err }
    tmpName := f.Name()
    defer os.Remove(tmpName) // cleanup if rename fails

    if _, err := f.Write(data); err != nil {
        f.Close()
        return err
    }
    if err := f.Sync(); err != nil { // fsync before rename
        f.Close()
        return err
    }
    if err := f.Close(); err != nil { return err }
    return os.Rename(tmpName, path) // atomic on the same filesystem
}
```

Properties:

- Temp file in the same directory: `os.Rename` is atomic only
  within a filesystem.
- `Sync` before close: ensures data is on disk before the rename.
- `O_TRUNC` semantics: rename replaces the target atomically.

On Windows, atomic rename is slightly different (the target must
not exist), so use `os.Remove(path)` before `os.Rename(tmpName, path)`
if cross-platform.

## 6. Cleaning a directory tree

`os.RemoveAll` walks and removes. It's robust but slow for very
large trees because it's single-threaded.

For specialized cases (e.g., a build cache cleaner), a parallel
remover can be faster, but `RemoveAll` is correct and safe.

A common bug: `os.RemoveAll("/")` deletes the entire filesystem.
Always validate the target:

```go
func removeAll(p string) error {
    abs, _ := filepath.Abs(p)
    if abs == "/" || abs == "." || abs == os.Getenv("HOME") {
        return fmt.Errorf("refusing to remove %q", abs)
    }
    return os.RemoveAll(abs)
}
```

For production tools (uninstallers, build cleaners), have a
confirmation step or restrict to known prefixes.

## 7. Testing filesystem code

`testing/fstest` provides `MapFS` for unit tests:

```go
import (
    "io/fs"
    "testing/fstest"
)

func TestFindGoFiles(t *testing.T) {
    fsys := fstest.MapFS{
        "main.go":            &fstest.MapFile{Data: []byte("package main")},
        "internal/foo.go":    &fstest.MapFile{Data: []byte("package foo")},
        "internal/foo_test.go": &fstest.MapFile{Data: []byte("package foo")},
        "vendor/lib.go":      &fstest.MapFile{Data: []byte("package lib")},
    }

    files, err := findGoFiles(fsys)
    require.NoError(t, err)
    require.ElementsMatch(t, files, []string{
        "main.go", "internal/foo.go", "internal/foo_test.go",
    })
}
```

For this to work, your function must accept `fs.FS`, not `string`:

```go
func findGoFiles(fsys fs.FS) ([]string, error) {
    var out []string
    err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
        // ...
    })
    return out, err
}
```

Production callers pass `os.DirFS(root)`. Tests pass `fstest.MapFS`.
No filesystem touched in tests.

## 8. The `os.Root` boundary (Go 1.24+)

`os.OpenRoot` is the new gold standard for path-traversal safety:

```go
root, err := os.OpenRoot("/var/www/uploads")
if err != nil { return err }
defer root.Close()

// All paths are relative to root; symlinks that escape are rejected.
f, err := root.Open("user/photo.jpg")
if err != nil { return err }
defer f.Close()
```

Behind the scenes, this uses `openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS)`
on Linux. Even a symlink inside the root cannot escape — the kernel
enforces it.

For services that handle user-supplied paths, `os.OpenRoot` is the
single most important defensive primitive added to the stdlib in
recent years.

## 9. Working with paths from user input

A web service receives paths in HTTP requests:

```go
func serveFile(w http.ResponseWriter, r *http.Request) {
    // Extract user path from URL or body.
    userPath := r.URL.Query().Get("path")

    // 1. Length cap.
    if len(userPath) > 4096 {
        http.Error(w, "path too long", 400)
        return
    }

    // 2. Reject absolute and escaping paths.
    if !filepath.IsLocal(userPath) {
        http.Error(w, "invalid path", 400)
        return
    }

    // 3. Open via root.
    f, err := uploadRoot.Open(userPath)
    if err != nil {
        if os.IsNotExist(err) {
            http.Error(w, "not found", 404)
            return
        }
        log.Printf("open %s: %v", userPath, err)
        http.Error(w, "internal", 500)
        return
    }
    defer f.Close()

    // 4. Stream the content.
    io.Copy(w, f)
}
```

Each step is a separate defensive measure. Length caps prevent
memory exhaustion. `IsLocal` blocks the path-traversal class.
`OpenRoot` enforces at the kernel layer.

## 10. Logging structured paths

For audit trails, log paths with their resolved (`EvalSymlinks`)
form to make the actual file unambiguous:

```go
func auditOpen(path string) {
    real, err := filepath.EvalSymlinks(path)
    if err != nil {
        slog.Warn("open", "path", path, "real", "?", "err", err)
        return
    }
    slog.Info("open", "path", path, "real", real)
}
```

Two paths can refer to the same file (via symlinks); logging both
the apparent path (what the user passed) and the real path (where
the bytes actually live) makes forensic investigation tractable.

## 11. Common production mistakes

### 11.1 Calling `filepath.Walk` on a remote filesystem

Each `Walk` stats every entry. On NFS, each stat is a network
round-trip. For 100k files, that's 100k RTTs — easily seconds of
walk time.

Mitigation: `WalkDir` with `Info()` called only when needed.

### 11.2 Not closing directory handles

Most callers go through high-level functions and don't see
directory FDs. But `os.OpenFile(dir, os.O_DIRECTORY, 0)` (or
`os.OpenRoot`) returns one. Forgetting to `Close` leaks FDs and
eventually exhausts the per-process limit (1024 by default on
Linux).

### 11.3 Assuming `filepath.Join` is cheap

It's not — see the senior file. In a tight loop over a million
filenames, `Join` is measurable. Optimize when it shows up in a
profile.

### 11.4 Forgetting Windows path quirks

- Path length limit: 260 characters (without long-path prefix).
- Reserved names: `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`,
  `LPT1`-`LPT9`. Files with these basenames cannot be created.
- Case-insensitive but case-preserving filesystem.
- Forward slashes mostly work, but mixed `\`/`/` paths sometimes
  confuse tools.

`filepath.IsLocal` rejects the reserved names. The length and case
issues require explicit handling.

## 12. References

- `os/root.go` — `OpenRoot` and `Root.Open`.
- [Linux `openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html)
- [Zip Slip vulnerability](https://snyk.io/research/zip-slip-vulnerability)
- [`../05-os/`](../05-os/index.md) — file operations on the paths
  you build here.
- [`../14-io-fs/`](../14-io-fs/index.md) — the `fs.FS` abstraction.
- [`../09-go-embed/`](../09-go-embed/index.md) — `embed.FS` works
  with `fs.WalkDir`.
