# 8.14 `io/fs` — Optimize

The package itself is a thin abstraction; most performance work is
in the *consumer* (helpers, walks, HTTP serving) or in the *custom
implementation* (where the work actually happens). This file
covers both.

## 1. The lazy-stat advantage of `WalkDir`

The single biggest source of "we made our walker faster" is using
`fs.WalkDir` instead of the older `filepath.Walk`. Recap:

- `filepath.Walk` calls the callback with a `FileInfo` per file.
  Producing the `FileInfo` requires `stat(2)`. A walk of 100,000
  files = 100,000 syscalls, even if the callback only inspects
  the name.
- `fs.WalkDir` calls the callback with a `DirEntry`. Name and
  type come from `getdents(2)` (free with the directory read);
  `Info()` is deferred. A name-only walk = ~one syscall per
  directory, not per file.

For typical project trees (Go module with maybe 10k files), the
difference is small. For deep monorepos, archive enumeration, or
disk-cache scanners, it's an order of magnitude. Always reach for
`WalkDir` first.

```go
// Slow on big trees.
filepath.Walk(root, func(path string, info os.FileInfo, _ error) error {
    if !info.IsDir() && strings.HasSuffix(path, ".go") {
        fmt.Println(path)
    }
    return nil
})

// Fast: no Stat for the rejected entries.
fs.WalkDir(os.DirFS(root), ".", func(path string, d fs.DirEntry, _ error) error {
    if !d.IsDir() && strings.HasSuffix(path, ".go") {
        fmt.Println(path)
    }
    return nil
})
```

## 2. `DirEntry.Info()` cost: when it's free, when it isn't

`DirEntry.Info()` is the lazy escape hatch. Different
implementations have different costs:

| Backing | `Info()` cost |
|---------|---------------|
| `os.DirFS` on Linux | `stat(2)` syscall — tens of μs |
| `os.DirFS` on Linux with `getdents64` providing type | `stat(2)` if you ask for size/mtime, free if you only call `Type()` |
| `embed.FS` | Free (struct in memory) |
| `fstest.MapFS` | Free (struct in memory) |

For walks that filter by name only, never call `Info()`. For
walks that filter by size or modtime, you pay the syscall — but
only on entries that survived the name filter.

```go
err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
    if err != nil { return err }
    if d.IsDir() { return nil }
    // Cheap filter first.
    if !strings.HasSuffix(d.Name(), ".log") { return nil }
    // Expensive check only on candidates.
    info, err := d.Info()
    if err != nil { return err }
    if info.Size() > 100<<20 {
        bigLogs = append(bigLogs, path)
    }
    return nil
})
```

This is the canonical shape: cheap filter, then expensive check.

## 3. `fs.ReadFile` vs `Open`+`io.ReadAll`

For an FS that implements `ReadFileFS`, `fs.ReadFile` is faster:
no intermediate `File` value, no buffer growth in `io.ReadAll`,
just a direct slice copy.

For an FS that doesn't, `fs.ReadFile` falls back to the open-then-read-all
shape — same cost as doing it yourself. So:

- Always call `fs.ReadFile` rather than open-and-read manually,
  unless you need streaming.
- For streaming (you don't want to load the whole file), use
  `Open` and read in chunks.

```go
// Bulk: 100 small files. Use fs.ReadFile.
for _, name := range names {
    data, _ := fs.ReadFile(fsys, name)
    process(data)
}

// Streaming: one large file. Use Open.
f, _ := fsys.Open("big.bin")
defer f.Close()
buf := make([]byte, 64<<10)
for {
    n, err := f.Read(buf)
    if n > 0 { process(buf[:n]) }
    if err == io.EOF { break }
    if err != nil { return err }
}
```

## 4. `embed.FS.ReadFile` returns a fresh copy every call

A subtle cost. The bytes from `embed.FS` live in the binary's
read-only segment, so you can't return a slice that aliases them
(Go doesn't have read-only slice types). Each `ReadFile` call
copies into a new `[]byte`.

For a hot endpoint that reads the same template every request,
this is wasted work. Cache once at startup:

```go
var (
    indexHTML = mustRead(embedFS, "templates/index.html")
)

func mustRead(fsys fs.FS, name string) []byte {
    b, err := fs.ReadFile(fsys, name)
    if err != nil { panic(err) }
    return b
}
```

For templates specifically, parse once with `template.ParseFS` and
serve from the parsed `*template.Template`. The HTML representation
exists exactly once in memory.

## 5. Concurrent reads: parallelism on `os.DirFS`

`os.DirFS`-backed reads go through real syscalls. On disk, that
means real I/O parallelism is possible:

```go
func loadAll(fsys fs.FS, names []string) (map[string][]byte, error) {
    var (
        mu  sync.Mutex
        out = make(map[string][]byte, len(names))
    )
    g, _ := errgroup.WithContext(context.Background())
    g.SetLimit(runtime.NumCPU())
    for _, n := range names {
        n := n
        g.Go(func() error {
            data, err := fs.ReadFile(fsys, n)
            if err != nil { return err }
            mu.Lock()
            out[n] = data
            mu.Unlock()
            return nil
        })
    }
    return out, g.Wait()
}
```

For SSDs, the speedup is real (multiple in-flight read requests
to the device). For spinning disks, it depends on the access
pattern (sequential reads stay sequential; random reads benefit
from queue depth).

For `embed.FS`, parallel reads are parallel `memcpy` — the cost
is allocation, not I/O. Single-goroutine reads are usually faster
because they avoid the `errgroup` overhead.

## 6. `fs.Glob` vs manual walk

`fs.Glob` matches a single pattern. For multiple patterns, calling
`fs.Glob` once per pattern walks the FS once per pattern.

```go
// Three walks of the FS:
a, _ := fs.Glob(fsys, "*.go")
b, _ := fs.Glob(fsys, "*.txt")
c, _ := fs.Glob(fsys, "*.md")
```

For three patterns this is fine. For thirty, walk once and check
all patterns per entry:

```go
patterns := []string{"*.go", "*.txt", "*.md"}
var matches []string
fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
    if err != nil || d.IsDir() { return err }
    for _, pat := range patterns {
        if ok, _ := path.Match(pat, d.Name()); ok {
            matches = append(matches, p)
            break
        }
    }
    return nil
})
```

One walk, all patterns checked.

## 7. Sorted output: don't re-sort

`fs.ReadDir` returns sorted output. `fs.WalkDir` traverses
directory entries in lexicographical order. If you append walk
results to a slice and your downstream consumer expects sorted
input, *you don't need to sort it*.

Code that calls `sort.Strings` after `fs.ReadDir` is doing
unnecessary work. The slice is already sorted.

## 8. Avoid `*os.File` finalizer pressure

When you forget to `Close` an `fs.File` returned by `os.DirFS`,
the runtime's GC runs the file's finalizer eventually. Finalizers
are expensive: they force an extra GC cycle to actually clean up,
and they pin objects past their usefulness.

In high-throughput servers that open many files, the
forgotten-close-then-finalize cycle can become a noticeable cost
(visible in profiles as `runtime.runfinq`). Always `defer
f.Close()` immediately after a successful open. The
`defer` overhead is tiny compared to the finalizer overhead.

## 9. `http.FileServerFS` overhead

`http.FileServerFS` per request:

1. Parse the URL into a clean FS path.
2. `Open` the file.
3. `Stat` the file.
4. Set headers (`Content-Type`, `Content-Length`, `Last-Modified`,
   maybe `Etag`).
5. Handle range requests.
6. Stream the body via `io.Copy`.

For embedded files, every step is fast except the stream. For
disk files, the `Open`+`Stat` are syscalls. Cost per request on
modern hardware: a few microseconds plus the actual byte copy.

Profile shows the byte copy dominates for large files, syscall
overhead dominates for many small files. For the latter, an
in-memory cache of pre-rendered responses can be 10x faster than
re-opening per request.

## 10. Pre-compressed assets

For static HTTP serving, gzip and brotli compression at build
time saves runtime CPU:

```go
//go:embed all:dist
var dist embed.FS

func serve(w http.ResponseWriter, r *http.Request) {
    name := strings.TrimPrefix(r.URL.Path, "/")
    if accepts(r, "br") {
        if data, err := fs.ReadFile(dist, name+".br"); err == nil {
            w.Header().Set("Content-Encoding", "br")
            // ...
            w.Write(data)
            return
        }
    }
    if accepts(r, "gzip") {
        if data, err := fs.ReadFile(dist, name+".gz"); err == nil {
            w.Header().Set("Content-Encoding", "gzip")
            // ...
            w.Write(data)
            return
        }
    }
    data, _ := fs.ReadFile(dist, name)
    w.Write(data)
}
```

The build pipeline runs `gzip` and `brotli` over each static asset
once, embeds all three, and the handler picks. No per-request
gzip cost. Win-win except the binary grows by 2x or 3x — usually
acceptable for binaries that already include the uncompressed
assets.

## 11. Caching parsed templates

`template.ParseFS` is slow relative to template execution. Always
parse once at startup:

```go
var tpl = template.Must(template.ParseFS(templates, "*.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    tpl.ExecuteTemplate(w, "index.html", data)
}
```

For dev mode with live reload, parse on every request (cheap on a
local disk and what you want for instant feedback):

```go
func devHandler(w http.ResponseWriter, r *http.Request) {
    tpl, _ := template.ParseFS(os.DirFS("./templates"), "*.html")
    tpl.ExecuteTemplate(w, "index.html", data)
}
```

The build-tag pattern from `professional.md` toggles between
these.

## 12. Avoiding intermediate copies in chained `io/fs`

When you chain `fs.Sub` then read:

```go
sub, _ := fs.Sub(embedFS, "static")
data, _ := fs.ReadFile(sub, "main.css")
```

The default `fs.Sub` returns a wrapper that prepends `static/` to
every name and calls into `embedFS`. Per `Open`: one extra string
concat. Per `Read`: passthrough.

For `embed.FS`, this overhead is invisible. For an FS where the
underlying `Open` is expensive (e.g., a remote object store), the
indirection is still negligible compared to the I/O.

If you ever profile and the wrapper shows up, implement `SubFS`
on your own type and short-circuit the prefix stuff with a
precomputed view.

## 13. Benchmarking

Benchmark `Open`, `fs.ReadFile`, and `fs.WalkDir` independently
with `-benchmem`. Three allocations per `Open` is typical (a
`File`, a `FileInfo`, the path string); more suggests redundancy.

## 14. `fstest.MapFS` is for test-scale, not production

`MapFS` re-derives directory entries on every `ReadDir` call by
walking the map. Fine for a dozen entries, slow at a million.
`MapFS` is a test fixture, not a production data structure.

## 15. Profile checklist

When `fs.FS`-using code is slow:

1. **Is the source disk?** Profile syscalls (`strace -c` or `perf`)
   and check whether the cost is `read`, `open`, `stat`, or
   `getdents`. Each suggests a different fix.
2. **Are templates parsed per request?** Check with `pprof` for
   `template.parse`. If yes, hoist to `init` or `sync.Once`.
3. **Is `WalkDir` calling `Info()` for every entry?** Check the
   callback for an unconditional `d.Info()` call. Lazy-stat by
   filtering on `d.Name()` first.
4. **Are repeated `ReadFile` calls returning the same bytes?**
   Check if the file is hot — cache once at startup if so.
5. **Are concurrent reads serialized through a single file?** Look
   for one `*os.File` shared across goroutines. Open per goroutine
   or use `ReadAt` for positioned I/O.

## 16. What not to optimize

- **`fs.ValidPath` calls.** They're constant-time string scans.
  The cost is irrelevant compared to anything else in the
  pipeline.
- **`*fs.PathError` allocation.** It happens once per error;
  errors should be rare in the hot path.
- **The `embed.FS` index.** It's a hashtable; lookups are O(1).
  You're not going to beat it.
- **`fs.ReadDir` sorting.** It's done once per directory; the cost
  is dominated by reading the directory in the first place.

The 80/20 rule holds: the actual bytes-moving (file reads,
template execution, byte copies) dominates everything else. Spend
optimization budget there first.

## 17. What to read next

- [`../09-go-embed/optimize.md`](../09-go-embed/optimize.md) —
  binary-size and embed-specific optimizations.
- [`../01-io-and-file-handling/optimize.md`](../01-io-and-file-handling/optimize.md)
  — the underlying `io.Reader` performance work.
- The `pprof` documentation — the right way to find your actual
  hot spots, instead of guessing.
