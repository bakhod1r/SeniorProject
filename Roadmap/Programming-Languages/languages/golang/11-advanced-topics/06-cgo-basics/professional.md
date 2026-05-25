# cgo Basics — Professional

## 1. The production stance

In production, cgo is a controlled dependency. Each `import "C"` brings:

- Build-time C toolchain requirements.
- Larger binary (~2–3 MiB minimum).
- Cross-compilation complexity.
- Less help from `pprof`, `pgo`, race detector inside C frames.
- A separate security-update flow for the C library.

A team's relationship with cgo should be deliberate: "we use it for these specific reasons, in these packages, with this build/deploy story".

---

## 2. The cgo isolation pattern

Confine cgo to one or two packages:

```
myapp/
  internal/c-bridge/   # only place with `import "C"`
    bridge.go
  pkg/
    handlers/          # pure Go
    storage/           # pure Go
```

The bridge exposes a clean Go API. Application code never imports `"C"` directly. This:

- Keeps build complexity in one place.
- Lets you swap the cgo backend for a pure-Go one if needed.
- Makes the cgo surface area visible at code review time.

---

## 3. Static binaries with cgo

For a fully static cgo binary against musl libc:

```dockerfile
FROM golang:1.24-alpine AS build
RUN apk add --no-cache build-base
WORKDIR /src
COPY . .
RUN CGO_ENABLED=1 CC=gcc \
    go build -ldflags='-linkmode=external -extldflags="-static"' \
    -o /out/app ./cmd/app

FROM scratch
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

Alpine's musl libc supports full static linking. glibc-based images (Debian, Ubuntu) make this much harder.

For most teams, `CGO_ENABLED=0` + pure Go is simpler than cgo + static. Choose accordingly.

---

## 4. Memory leaks in cgo packages

The single biggest production bug class: forgetting to `C.free`.

Defenses:

- **Every `C.CString` paired with `defer C.free`** in the same function.
- **Linters**: `cgocheck` analyzers (some staticcheck rules) flag obvious leaks.
- **Memory monitoring**: process RSS that grows without `HeapAlloc` growing usually means a cgo or mmap leak.
- **Stress tests**: a benchmark with `b.N=1e6` that monitors RSS catches most leaks.

```go
func BenchmarkNoLeak(b *testing.B) {
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)
    for i := 0; i < b.N; i++ { doIt() }
    runtime.GC()
    runtime.ReadMemStats(&after)
    if after.Sys-before.Sys > 10<<20 {
        b.Fatalf("memory grew %d KiB", (after.Sys-before.Sys)/1024)
    }
}
```

(`Sys` includes cgo memory; `HeapAlloc` doesn't.)

---

## 5. Thread-safety per library

Many C libraries have nuanced thread-safety:

- **Fully thread-safe**: any goroutine can call any function. Examples: SQLite (with appropriate flags), libcurl multi.
- **Per-handle**: separate handles can be used concurrently, but one handle is serial. Common pattern.
- **Single-threaded**: only one goroutine total. Requires a worker pattern.

Document which model applies in your bridge package. Add tests that exercise concurrency to ensure you implemented the model correctly.

---

## 6. The worker-goroutine pattern

For non-thread-safe C libraries:

```go
type Request struct {
    arg int
    res chan int
}

func worker(in <-chan Request) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for req := range in {
        req.res <- int(C.do_thing(C.int(req.arg)))
    }
}

func Do(arg int) int {
    res := make(chan int, 1)
    queue <- Request{arg, res}
    return <-res
}
```

One goroutine, one OS thread, serial calls. Adapts to many C libraries that aren't safe for concurrent use.

---

## 7. Error reporting from C

Translate at the boundary:

```go
type CError struct {
    Code int
    Msg  string
}

func (e *CError) Error() string { return fmt.Sprintf("libfoo: %s (%d)", e.Msg, e.Code) }

func doThing() error {
    buf := make([]byte, 256)
    ret := C.libfoo_do_thing((*C.char)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)))
    if ret < 0 {
        return &CError{Code: int(ret), Msg: C.GoString((*C.char)(unsafe.Pointer(&buf[0])))}
    }
    return nil
}
```

Application code receives proper Go errors; the C-specific information is wrapped.

---

## 8. Cross-compilation strategies

Three working approaches:

1. **`CGO_ENABLED=0`**: cross-compile pure-Go binary. Easiest but limited.
2. **Docker buildx**: `docker buildx build --platform linux/arm64`. Works for any target image.
3. **Zig as a cross-compiler**: `CC="zig cc -target aarch64-linux-musl"`. Modern, simple.

For multi-platform release pipelines, Docker buildx is usually the path of least resistance.

---

## 9. Cgo and PGO

Cgo calls are opaque to PGO. The Go compiler can't see into C. So:

- PGO improves the Go side of your service.
- PGO doesn't help the C side.

If profile shows that most CPU is in C, PGO gains will be small. If most CPU is in Go (typical for I/O-bound services with limited C work), PGO is worth running.

---

## 10. Vendoring C dependencies

For reproducible builds, vendor the C source in your module:

```
myapp/
  internal/c-bridge/
    bridge.go
    cdep/         # vendored
      foo.h
      foo.c
```

```go
// #cgo CFLAGS: -I${SRCDIR}/cdep
// in your file
```

This:

- Locks the C source to a known version.
- Removes the system-library dependency.
- Adds the C source to your security update review.

For large libraries (OpenSSL, ICU), vendoring is impractical; use system libs and document the version.

---

## 11. The supply-chain story

When your binary depends on a C library:

- Track upstream security advisories.
- Pin the version in your Dockerfile / `CGO_LDFLAGS`.
- Run image scanners (`trivy`, `grype`) that detect libc/openssl/etc. vulnerabilities.
- Plan a rebuild + redeploy for each CVE.

This is operational work that pure-Go projects don't have. Budget for it.

---

## 12. Cgo-free production stories

Many large Go services run with `CGO_ENABLED=0`:

- HTTP services using `net/http` (pure Go).
- gRPC services using `google.golang.org/grpc` (pure Go).
- PostgreSQL/MySQL via pure-Go drivers (`pgx`, `go-sql-driver/mysql`).
- Crypto via `crypto/*` (pure Go where it matters).

The exceptions tend to be:

- SQLite (cgo bridge to native).
- Image manipulation (libwebp, libheif via cgo).
- ML inference (ONNX Runtime, TensorFlow Lite).
- Hardware access (V4L2, audio APIs).

For most web services, pure Go is enough.

---

## 13. Cgo and observability

Some observability tools don't see inside C:

- `pprof` shows C functions as opaque `cgocall` frames.
- `runtime/trace` captures cgo entry/exit but not internal work.
- The race detector ignores C accesses.
- `runtime/metrics` doesn't track C memory.

For C-heavy services, add explicit instrumentation:

- Wrap C calls in Go functions you can profile.
- Maintain counters for C memory allocations/frees.
- Use `eBPF`/`perf` on the host to see C-side work.

---

## 14. Summary

Production cgo is isolated, vendored where reasonable, monitored for leaks, and worker-pooled when the underlying library isn't thread-safe. Build pipelines are configured for cross-compilation either by skipping cgo (`CGO_ENABLED=0`) or via Docker buildx. Document the cgo surface and its operational implications. Reach for pure-Go alternatives whenever they exist; reserve cgo for the cases where it's truly necessary.

---

## Further reading
- `cmd/cgo` documentation
- Docker buildx: https://docs.docker.com/buildx/working-with-buildx/
- Zig as a cross-compiler: https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html
