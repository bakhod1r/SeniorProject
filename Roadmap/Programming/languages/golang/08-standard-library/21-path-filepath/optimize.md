# 8.21 `path` and `path/filepath` — Optimize

> Ten optimization exercises for path-heavy code. Each is a
> before/after pair with measurable improvement. Verify with
> `go test -bench=. -benchmem`.

## O1 — `WalkDir` instead of `Walk`

### Before

```go
filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
    if err != nil { return err }
    if !info.IsDir() && filepath.Ext(path) == ".go" {
        files = append(files, path)
    }
    return nil
})
```

`Walk` calls `os.Lstat` on every entry, but the callback only uses
`IsDir()` — information available from the directory listing.

### After

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if !d.IsDir() && filepath.Ext(d.Name()) == ".go" {
        files = append(files, path)
    }
    return nil
})
```

On a 100k-file tree, 2–5× faster. No `Lstat` per entry; `d.IsDir()`
and `d.Name()` come from the directory read.

## O2 — `SkipDir` for excluded directories

### Before

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if strings.Contains(path, "node_modules") { return nil }
    if d.IsDir() { return nil }
    process(path)
    return nil
})
```

The check skips files inside `node_modules`, but `WalkDir` still
descends into the directory — millions of unnecessary entries are
walked.

### After

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() && d.Name() == "node_modules" {
        return filepath.SkipDir
    }
    if d.IsDir() { return nil }
    process(path)
    return nil
})
```

`SkipDir` prevents `WalkDir` from reading the directory at all. On
a project with a huge `node_modules`, this is the difference
between 30 seconds and 0.3 seconds.

## O3 — Cache `os.Getwd()` instead of repeating `Abs`

### Before

```go
for _, p := range paths {
    abs, err := filepath.Abs(p)
    if err != nil { return err }
    process(abs)
}
```

Each `Abs` calls `os.Getwd` (a syscall) if `p` is relative.

### After

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

For 100k paths, savings: ~100k `getcwd` syscalls = ~50 ms on
Linux.

## O4 — Avoid `filepath.Join` in a tight loop

### Before

```go
for _, name := range names {
    path := filepath.Join(dir, name)
    process(path)
}
```

`Join` allocates a new string and calls `Clean` on every iteration.

### After

```go
dirSep := dir + string(filepath.Separator)
buf := make([]byte, 0, 256)
for _, name := range names {
    buf = append(buf[:0], dirSep...)
    buf = append(buf, name...)
    process(string(buf))
}
```

The `buf[:0]` reslice reuses capacity. `string(buf)` is the only
unavoidable allocation. This skips `Clean`, so callers must ensure
`name` is well-formed (no `..`, no embedded separator).

**Caveat:** less safe than `Join`. Use only with validated inputs.

## O5 — Parallel walk for CPU-bound work

### Before

```go
var totalSize int64
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() { return nil }
    info, err := d.Info()
    if err != nil { return err }
    totalSize += info.Size()
    h := sha256.New()
    f, _ := os.Open(path)
    io.Copy(h, f)
    f.Close()
    return nil
})
```

Walks and hashes in one goroutine. Bottleneck: CPU for hashing.

### After

```go
work := make(chan string, runtime.NumCPU())
g, ctx := errgroup.WithContext(ctx)

g.Go(func() error {
    defer close(work)
    return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
        if err != nil { return err }
        if d.IsDir() { return nil }
        select {
        case work <- path: return nil
        case <-ctx.Done(): return ctx.Err()
        }
    })
})

var mu sync.Mutex
var totalSize int64
for i := 0; i < runtime.NumCPU(); i++ {
    g.Go(func() error {
        h := sha256.New()
        for path := range work {
            f, err := os.Open(path)
            if err != nil { continue }
            n, err := io.Copy(h, f)
            f.Close()
            mu.Lock()
            totalSize += n
            mu.Unlock()
            h.Reset()
        }
        return nil
    })
}
return g.Wait()
```

N-core speedup for CPU-bound work. Watch for I/O contention on slow
disks — limit parallelism to ~4 for spinning disks.

## O6 — Pre-compile glob patterns to a reusable matcher

### Before

```go
for _, name := range names {
    matched, _ := filepath.Match("*.log", name)
    if matched { process(name) }
}
```

`Match` re-parses the pattern on every call.

### After

For a single-pattern check, the cost of `Match` is small. For many
patterns checked against many names, use the `path/filepath` Match
once per name × pattern, or build a custom predicate:

```go
isLog := func(name string) bool {
    return strings.HasSuffix(name, ".log")
}
for _, name := range names {
    if isLog(name) { process(name) }
}
```

For complex patterns where `Match` is in the profile, consider
`regexp` (also pre-compiled) or a hand-rolled state machine.

## O7 — Skip `d.Info()` when not needed

### Before

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    info, err := d.Info()
    if err != nil { return err }
    if info.IsDir() { return nil }
    process(path)
    return nil
})
```

`d.Info()` triggers `Lstat` — exactly what `WalkDir` avoided.

### After

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() { return nil } // already known from DirEntry
    process(path)
    return nil
})
```

`IsDir()` is free on `DirEntry`. Only call `Info()` if you need
size, modtime, or permissions.

## O8 — Use `os.ReadDir` over `os.OpenFile + Readdir`

### Before

```go
f, err := os.Open(dir)
if err != nil { return err }
defer f.Close()
entries, err := f.Readdir(-1)
```

`Readdir` returns `[]FileInfo`, which calls `Lstat` per entry.

### After

```go
entries, err := os.ReadDir(dir)
```

Returns `[]DirEntry` from a single `getdents` syscall. 5–10× faster
for large directories.

## O9 — Stream paths instead of collecting

### Before

```go
var paths []string
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if !d.IsDir() {
        paths = append(paths, path)
    }
    return nil
})
for _, p := range paths {
    process(p)
}
```

For a 100M-file tree, `paths` is huge — gigabytes of string headers.

### After

```go
filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
    if !d.IsDir() {
        return process(path)
    }
    return nil
})
```

Process during the walk. Memory stays bounded.

If you need pipelined processing (walk in one goroutine, process in
another), use a bounded channel — not an unbounded slice.

## O10 — Use `path` package for slash-only paths

### Before

```go
key := filepath.Join("uploads", date, name)
// uploading to S3, which uses '/'
s3Client.Put(bucket, key, data)
```

On Windows, `key` is `uploads\2024-01-15\file.txt`. S3 keys are
literal — the user sees backslashes in URLs.

### After

```go
import "path"

key := path.Join("uploads", date, name)
// always 'uploads/2024-01-15/file.txt'
s3Client.Put(bucket, key, data)
```

`path` is the right tool for cloud-storage keys. Same for URL
paths, archive entries, and similar.

## Bonus — Walking with notifications instead of polling

If you're walking the tree repeatedly to detect changes, switch to
a notification API:

```go
import "github.com/fsnotify/fsnotify"

watcher, _ := fsnotify.NewWatcher()
defer watcher.Close()
watcher.Add(root)
for {
    select {
    case ev := <-watcher.Events:
        // file changed; react
    case err := <-watcher.Errors:
        // handle
    }
}
```

A polling walker that runs every second on a 1M-file tree wastes
~1 second per second. A notification-based watcher uses near-zero
CPU when idle.

The trade-off: `fsnotify` is a third-party dependency, and event
delivery has platform-specific quirks (events lost on macOS rename,
inotify watch limits on Linux). For production, instrument both
the watcher and a periodic full-walk as a backstop.

## Checklist

After optimizing a path-heavy code path:

- [ ] `WalkDir` instead of `Walk` (unless full FileInfo is needed
  everywhere).
- [ ] `SkipDir` for entire excluded subtrees.
- [ ] `d.Info()` called only when its data is needed.
- [ ] `filepath.Join` not in tight inner loops (or accepted as
  acceptable overhead).
- [ ] Working directory cached if `Abs` is called repeatedly.
- [ ] Parallelism added when CPU-bound and not I/O contention.
- [ ] `path` package used for slash-only paths (not `filepath`).
- [ ] Path streaming, not accumulation, for very large trees.

## References

- `os/dirent_linux.go`, `os/dir_*.go` — the syscall layer.
- `io/fs/walk.go` — the abstract walker.
- [Brendan Gregg, "Off-CPU Analysis"](https://www.brendangregg.com/offcpuanalysis.html)
  — when stat syscalls become the bottleneck.
- [`../05-os/`](../05-os/index.md) for file operations.
- [`../14-io-fs/`](../14-io-fs/index.md) for the abstract FS.
