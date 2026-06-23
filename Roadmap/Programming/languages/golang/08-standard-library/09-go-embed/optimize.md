# 8.9 `embed` and `//go:embed` — Optimize

> Once `embed` is in production, the questions become: how big is the
> binary, how much memory does it take to keep these assets resident,
> how fast is first-byte latency, how much GC pressure does the embed
> path generate? This file is the playbook.

## 1. Measure first

Before optimizing, measure. Three commands cover the cases that
matter:

```bash
# Total binary size
ls -lh ./bin

# Per-symbol size, sorted, filtered to embed
go tool nm -size ./bin | grep go:embed | sort -nrk2 | head -20

# Module-attributed size (Go 1.20+)
go version -m ./bin
```

`go tool nm -size` is the diagnostic. Each `embed` symbol corresponds
to one embedded file (or one chunk for very large files). The size
column is bytes. Sort and you immediately see where the budget is
going.

For runtime memory, `pprof` heap profiles tell you what stays
resident:

```go
import _ "net/http/pprof"
// then: go tool pprof http://localhost:6060/debug/pprof/heap
```

## 2. Trim the file set

The cheapest optimization is "embed less." Check whether you actually
need every file:

- Source maps (`*.map`) for production frontends — usually not.
- README files inside `node_modules` — definitely not.
- Multiple compression variants when only one is served.
- Original SVGs *and* their PNG fallbacks.
- Translations for languages you don't ship to.

A targeted `//go:embed` glob is better than `all:` of an entire
build directory. If your frontend tooling outputs a lot of
incidentals, post-process the output before embedding:

```bash
find dist -name '*.map' -delete
find dist -name 'LICENSE' -delete
```

Or use a per-extension pattern:

```go
//go:embed dist/*.html dist/*.css dist/*.js dist/img/*
var distFS embed.FS
```

This is more typing than `//go:embed dist`, but the file set is
explicit and trimmer.

## 3. Pre-compress text assets

`embed` stores raw bytes. For HTML, CSS, JS, JSON, SQL, and other
text payloads, compression cuts binary size 3-10x with a brief
startup cost.

Two patterns:

**Pattern A: compress at build, decompress at startup.**

```go
//go:embed cities.json.zst
var citiesZst []byte

var cities = func() map[string]string {
    dec, err := zstd.NewReader(bytes.NewReader(citiesZst))
    if err != nil { panic(err) }
    defer dec.Close()
    var m map[string]string
    if err := json.NewDecoder(dec).Decode(&m); err != nil { panic(err) }
    citiesZst = nil // release the compressed copy for GC
    return m
}()
```

Setting `citiesZst = nil` after init releases the compressed bytes
for the next GC cycle. Without it, both the compressed slice and the
decoded map sit in memory.

**Pattern B: compress at build, serve compressed bytes when client
supports it.**

```go
//go:embed dist/main.css.gz
var mainCssGz []byte

func handler(w http.ResponseWriter, r *http.Request) {
    if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
        w.Header().Set("Content-Encoding", "gzip")
        w.Header().Set("Vary", "Accept-Encoding")
        w.Write(mainCssGz)
        return
    }
    // serve the plain version
}
```

This avoids per-request compression cost and the binary stays small.
The catch: you ship two variants per file. Use a build script.

## 4. Choose the compressor

| Format | Ratio (text) | Decode speed | Encoder |
|--------|-------------|--------------|---------|
| `gzip` | 3-4x | Fast | `compress/gzip` (stdlib) |
| `zstd` | 4-5x | Faster | `github.com/klauspost/compress/zstd` |
| `brotli` | 4-6x | Moderate | `github.com/andybalholm/brotli` |
| `xz` | 6-8x | Slow | `github.com/ulikunitz/xz` |

For binary-size optimization where startup latency matters, `zstd` is
usually the right pick: better ratio than gzip and faster decoding.
For HTTP serving where compatibility matters, gzip is universal.
`brotli` for HTTPS-only public sites that want the best ratio for a
modern browser audience.

## 5. Avoid double-buffering

When you serve embedded data, `http.FileServer` reads from the
`fs.FS` and writes to the response. If you load the full file into
your own buffer first, you double the allocation:

```go
// AVOID: extra copy
data, _ := fs.ReadFile(myFS, name)
w.Write(data)

// BETTER: stream from the file
f, _ := myFS.Open(name)
defer f.Close()
io.Copy(w, f)
```

For embedded files, `Open` returns an `fs.File` that implements
`io.WriterTo`, so `io.Copy` takes the fast path without an
intermediate 32 KiB buffer. The bytes already live in the binary;
copying them through a heap buffer is wasted work.

For `[]byte` variables, `w.Write(data)` is already optimal — the data
is a single slice, no scan needed.

## 6. ETag without per-request hashing

Computing a SHA hash per request is unnecessary. Pick one of these
strategies, in order of preference:

**Strategy A: build-stamped ETag (cheapest).**

```go
var BuildID = "dev"
var etag = `"` + BuildID + `"`

func handler(w http.ResponseWriter, r *http.Request) {
    if r.Header.Get("If-None-Match") == etag {
        w.WriteHeader(http.StatusNotModified)
        return
    }
    w.Header().Set("ETag", etag)
    // serve
}
```

One string comparison per request. No allocation.

**Strategy B: per-file hash, computed once.**

```go
type entry struct {
    bytes []byte
    etag  string
}

var entries = func() map[string]entry {
    out := map[string]entry{}
    fs.WalkDir(myFS, ".", func(p string, d fs.DirEntry, _ error) error {
        if d.IsDir() { return nil }
        b, _ := fs.ReadFile(myFS, p)
        sum := sha256.Sum256(b)
        out[p] = entry{bytes: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
        return nil
    })
    return out
}()
```

One hash per file at startup; lookups are map accesses. Use this
when you want per-file invalidation.

## 7. Avoid ParseFS in the hot path

`template.ParseFS` walks the FS, allocates per file, and builds a new
template tree. Do it once at init:

```go
//go:embed templates/*.html
var tplFS embed.FS

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html"))

func handler(w http.ResponseWriter, r *http.Request) {
    tpl.ExecuteTemplate(w, "index.html", data)
}
```

Re-parsing per request adds 50-500 µs of CPU and a few KiB of
allocation. Under load that's the difference between 1k and 10k
req/s on a small instance.

If you need live reload during development, gate the re-parse behind
a build tag:

```go
// dev_templates.go
//go:build dev

package main

func renderTpl(w http.ResponseWriter, name string, data any) {
    tpl, err := template.ParseFS(os.DirFS("./"), "templates/*.html")
    if err != nil { http.Error(w, err.Error(), 500); return }
    tpl.ExecuteTemplate(w, name, data)
}
```

```go
// prod_templates.go
//go:build !dev

package main

var tpl = template.Must(template.ParseFS(tplFS, "templates/*.html"))

func renderTpl(w http.ResponseWriter, name string, data any) {
    tpl.ExecuteTemplate(w, name, data)
}
```

Production gets the parse-once path; dev gets fresh templates per
request.

## 8. Cache directory listings

`embed.FS.ReadDir` is O(n) in the directory's entries. For a hot
endpoint that lists files, cache the result:

```go
var allFiles = func() []string {
    var out []string
    fs.WalkDir(myFS, ".", func(p string, d fs.DirEntry, _ error) error {
        if !d.IsDir() { out = append(out, p) }
        return nil
    })
    return out
}()
```

The list is immutable for the life of the binary. Cache, sort, and
serve from the slice; never re-walk.

## 9. Watch the alloc on `ReadFile`

Each call to `embed.FS.ReadFile` returns a new `[]byte`. For
high-frequency lookups of the same files, cache:

```go
var fileCache = sync.Map{}

func read(name string) ([]byte, error) {
    if v, ok := fileCache.Load(name); ok {
        return v.([]byte), nil
    }
    b, err := myFS.ReadFile(name)
    if err != nil { return nil, err }
    fileCache.Store(name, b)
    return b, nil
}
```

If the embedded set is small (a few dozen files) and known, prefer
loading everything into a `map[string][]byte` at init. Map access
is O(1) and avoids the `sync.Map` overhead.

## 10. Strip debug info from the binary

Production builds rarely need DWARF debug data:

```bash
go build -ldflags "-s -w" -o app
```

`-s` strips the symbol table; `-w` strips DWARF. Together they cut
binary size 25-30% on a typical service. The trade-off: stack traces
in panics still show function names (those are in the `gopclntab`
section, untouched), but you can't attach a debugger to the resulting
binary.

`-trimpath` removes filesystem paths from the binary, which is good
hygiene for distributable artifacts:

```bash
go build -trimpath -ldflags "-s -w" -o app
```

## 11. UPX is not the answer

UPX (the executable packer) shrinks the binary by 50%+ but at the
cost of:

- Slower startup (it decompresses into memory before running).
- Higher resident memory (runtime decompression + the binary itself).
- Antivirus false positives on Windows.
- Loss of in-place updates on copy-on-write filesystems.

If you're embedding because you want a single deployable binary,
UPX's downsides usually outweigh the size win. Pre-compressing the
*assets* before embedding (Section 3) is the better lever.

## 12. Don't embed what the OS already has

If you're embedding TLS root CAs because Go's defaults felt
unreliable, consider whether the `crypto/x509.SystemCertPool()` plus
explicit pin lists is cheaper. Embedding ~250 KB of root certs adds
weight to every binary and rotates only on rebuild.

Same logic for time zone data: Go 1.15+ uses `time/tzdata` (~450 KB)
when imported, or the system zoneinfo when available. Don't embed
your own copy.

For locales, `golang.org/x/text` pulls big tables; if you only need
2-3 locales, generate trimmed data with `gen` rather than embedding
the full set.

## 13. Profile-guided binary trimming

Go 1.21+ supports profile-guided optimization (PGO):

```bash
go test -cpuprofile=cpu.prof -bench=.
go build -pgo=cpu.prof -o app
```

PGO doesn't shrink the binary directly, but it can eliminate dead
code more aggressively when the profile tells the linker which
functions are hot. For services with large embed sets, this
sometimes shaves a few percent. Worth measuring; not always worth
maintaining.

## 14. Lazy decompression for large datasets

If you embed a large dataset that's only sometimes needed, decompress
on first access rather than at startup:

```go
//go:embed bigtable.json.zst
var bigtableZst []byte

var (
    bigtableOnce sync.Once
    bigtable     map[string]string
)

func getBigtable() map[string]string {
    bigtableOnce.Do(func() {
        dec, _ := zstd.NewReader(bytes.NewReader(bigtableZst))
        json.NewDecoder(dec).Decode(&bigtable)
        dec.Close()
        bigtableZst = nil
    })
    return bigtable
}
```

Cold paths pay nothing at startup. Hot paths pay one decompression
on first hit, then nothing.

## 15. Small allocations on the HTTP path

For each static file response, `http.FileServer` does several
allocations: response header map, `bytes.Buffer` for chunked
transfer, etc. None are unique to embed. The embed-specific
optimizations are:

- Use `[]byte` for hot single files, not `embed.FS.ReadFile` (saves
  one allocation per request).
- Set `Content-Length` explicitly when possible to avoid chunked
  encoding overhead.
- Use a `sync.Pool` for any per-request buffer you allocate in
  custom handlers.

```go
var bufPool = sync.Pool{
    New: func() any { return make([]byte, 0, 4096) },
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().([]byte)
    defer bufPool.Put(buf[:0])
    // ... build response in buf, then w.Write(buf)
}
```

Most embed-served sites don't need this. Profile first.

## 16. Cold-start vs steady-state

Two distinct optimization targets:

**Cold start.** Time from binary launch to first useful response.

- Avoid `template.ParseFS` of huge sets at init; lazy-parse if
  reasonable.
- Avoid `fs.WalkDir` at init for everything; walk on first request
  if the result is cacheable.
- Decompress lazily (Section 14).

**Steady state.** Latency and throughput once warm.

- Pre-parse templates (Section 7).
- Cache `ReadFile` results (Section 9).
- Use streaming `io.Copy` instead of `ReadFile` + `Write` (Section 5).

If your service rarely restarts, optimize for steady state. If you
run on FaaS/serverless with frequent cold starts, optimize for
startup time first.

## 17. Memory residency

Embedded `string` and `[]byte` variables live in the binary's
read-only data segment. They're mapped into memory once when the
process starts, but the OS only pages in the parts you touch. For a
50 MB binary you don't read at startup, resident memory stays small;
the data is on disk.

This means cold reads of rarely-accessed embedded files cost a page
fault. For HTTP serving where every file is hit eventually, pages
get fetched and stay in cache. For an opt-in dataset you may never
read on a given run, it sits on disk.

You can prefetch by reading at startup, or accept the page fault on
first access. For typical web workloads, accept the fault — there's
no significant gain to prefetching.

## 18. Trade-off summary

| Optimization | Saves | Costs |
|--------------|-------|-------|
| Trim file set | Binary size | Build complexity |
| Pre-compress text | Binary size | Startup CPU, heap RAM |
| Pre-compress for HTTP | Binary size, response CPU | Build complexity |
| ETag from build ID | Per-request hashing | Coarse invalidation |
| Cache ParseFS at init | Per-request CPU | Init RAM |
| Strip debug (`-s -w`) | Binary size | No debug attach |
| `-trimpath` | Binary size, info leakage | Less informative tracebacks |
| Lazy decompression | Startup time | First-hit latency |
| `sync.Pool` for buffers | GC pressure | Code complexity |
| PGO | A few % CPU | Profile maintenance |

Pick optimizations from the top of the table first. Most services
get 90% of the win from trimming the file set, pre-compressing text,
and stripping debug info. The rest is fine-tuning.

## 19. What to read next

- [professional.md](professional.md) — production patterns, including
  versioning and CI integration.
- [find-bug.md](find-bug.md) — bugs that masquerade as performance
  problems.
