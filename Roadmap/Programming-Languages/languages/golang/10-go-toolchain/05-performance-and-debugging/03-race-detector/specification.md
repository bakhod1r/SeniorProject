# Race Detector — Specification

> **Focus:** Precise reference for Go's race detector — the `-race` build flag, supported platforms, the `GORACE` environment variable, the `race` build tag, and behavioral guarantees.
>
> **Sources:**
> - `go help build`, `go help testflag`
> - Official guide: https://go.dev/doc/articles/race_detector
> - Go Memory Model: https://go.dev/ref/mem
> - Source: `src/runtime/race.go`, `src/runtime/race/`

---

## 1. Synopsis

```
go test    -race [other build flags] [packages]
go run     -race [other build flags] package [arguments...]
go build   -race [other build flags] [-o output] [packages]
go install -race [other build flags] [packages]
```

The `-race` flag instructs the toolchain to build and link a race-instrumented binary. The detector runs at process start and reports any data race it observes during execution.

---

## 2. Supported platforms

| OS | Architectures |
|----|---------------|
| linux | amd64, arm64, ppc64le, s390x |
| darwin (macOS) | amd64, arm64 |
| freebsd | amd64 |
| netbsd | amd64 |
| windows | amd64, arm64 |

On unsupported platforms, `go build -race` fails with `-race requires <list of supported platforms>`. 32-bit platforms, mobile (Android/iOS via gomobile), js/wasm, and wasip1/wasm are not supported.

`-race`, `-msan`, and `-asan` are mutually exclusive in the same build.

---

## 3. The `GORACE` environment variable

Configures the TSan runtime at process start. Format: space- or `_`-separated `key=value` pairs.

```bash
GORACE="log_path=/tmp/race halt_on_error=1 history_size=7" ./app
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `log_path` | path | (stderr) | Write reports to `log_path.<pid>` instead of stderr |
| `exitcode` | int | 66 | Exit status when a race is detected and `halt_on_error=1` |
| `strip_path_prefix` | string | "" | Strip this prefix from filenames in reports |
| `history_size` | 0..7 | 1 | log2 of per-goroutine event history (higher = more memory, better "previous access" stacks) |
| `halt_on_error` | 0\|1 | 0 | If 1, exit on first race report; if 0, continue running |
| `atexit_sleep_ms` | int (ms) | 1000 | Wait this long before final exit to let background reports flush |

Settings not recognized by the Go TSan runtime are ignored silently.

---

## 4. The `race` build tag

The toolchain sets the build tag `race` when `-race` is in effect. Files can opt in or out:

```go
//go:build race
package mypkg

func AssertExpensiveInvariants() { /* runs only in -race builds */ }
```

```go
//go:build !race
package mypkg

func AssertExpensiveInvariants() {} // no-op in normal builds
```

Use this for diagnostic code that should be free in normal builds. The tag is also visible via `go list -f '{{.GoFiles}}' -tags=race`.

---

## 5. Internal runtime API

The `runtime/race` package is **internal**. User code cannot import it. The runtime uses it to bridge synchronization primitives to TSan:

- `runtime.raceread(addr)`, `runtime.racewrite(addr)`, range variants — emitted by the compiler at every load/store.
- `runtime.raceacquire(addr)`, `runtime.racerelease(addr)` — emitted by sync/channel/atomic operations to establish happens-before edges.
- `runtime.racegostart`, `runtime.racegoend` — goroutine lifecycle events.
- `runtime/race.Disable()` / `runtime/race.Enable()` — internal-only; not usable from user packages.

Application code interacts with the detector only through `-race` (build flag), `GORACE` (env), and the `race` build tag.

---

## 6. Behavioral guarantees

- **No false positives.** Every reported race is a real data race under the Go Memory Model. The detector does not invent races.
- **Dynamic only.** The detector observes the current execution; races on unexplored code paths or timings are not reported. A clean run is not a proof of race-freedom.
- **Whole-binary instrumentation.** `-race` instruments every compiled package in the build; you cannot scope it per package. Scoping is done at test selection (`go test -race ./pkg/...`).
- **Recognized synchronization.** Happens-before edges from `sync.Mutex`/`RWMutex`/`Once`/`WaitGroup`, `sync/atomic`, channel send/recv/close, and goroutine create/join are tracked. Synchronization through `time.Sleep`, non-atomic flags, or unsafe.Pointer tricks is not.
- **Cost.** Approximately 2x–20x CPU, 5x–10x memory, ~2x binary size.

---

## 7. Reporting format

A report block printed to stderr (or to `GORACE=log_path=...`):

```
==================
WARNING: DATA RACE
<Read|Write> at 0xADDR by goroutine N:
  <stack frame>
  <stack frame>

Previous <read|write> at 0xADDR by goroutine M:
  <stack frame>
  <stack frame>

Goroutine N (running) created at:
  <stack frame>

Goroutine M (finished|running) created at:
  <stack frame>
==================
```

If `halt_on_error=1`, the process exits with `GORACE.exitcode` (default 66) after printing.
If `halt_on_error=0`, the process continues; the same race can be reported multiple times.

---

## 8. Exit codes

| Situation | Exit behavior |
|-----------|---------------|
| Build fails (`-race` unsupported on target) | `go build` exits non-zero with an error message |
| Program runs, no race detected | Program's normal exit code |
| Program runs, race detected, `halt_on_error=0` | Program's normal exit code (reports still printed) |
| Program runs, race detected, `halt_on_error=1` | `GORACE.exitcode` (default 66) |
| `go test -race` and a test detects a race | `go test` exits non-zero; test is marked failed |

`go test` automatically fails any test under which the detector reports a race, regardless of `halt_on_error`.

---

## 9. Non-goals / limitations

- Not for production use by default (cost, not capacity-planned).
- Not a memory-leak or goroutine-leak detector.
- Not a deadlock detector (Go has its own all-goroutines-asleep check).
- Cannot see races in C code reached via cgo.
- Cannot prove the absence of races — only report observed ones.
- Cannot be combined with `-msan` or `-asan` in the same build.

---

## 10. Related references

- Race detector article: https://go.dev/doc/articles/race_detector
- Go Memory Model: https://go.dev/ref/mem
- `go help build`, `go help testflag`
- ThreadSanitizer (LLVM): https://clang.llvm.org/docs/ThreadSanitizer.html
- Source: `src/runtime/race.go`, `src/runtime/race/`, `src/cmd/compile/internal/ssagen`
