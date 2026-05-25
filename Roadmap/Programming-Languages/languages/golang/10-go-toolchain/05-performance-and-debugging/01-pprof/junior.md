# pprof — Junior

## 1. What `pprof` is

`pprof` is Go's built-in **sampling profiler**. It periodically asks the runtime "what is the program doing right now?" and writes the answers into a profile file. You then open that file with `go tool pprof` to see where CPU time, memory, goroutines, or blocking are concentrated.

It does not trace every event (that would be too expensive). It **samples** — by default about 100 times per second for CPU — and aggregates samples by stack trace. Hot stacks are sampled most, so they show up at the top.

There are several **profile kinds**:

| Kind | What it measures |
|------|------------------|
| `cpu` | On-CPU time per function |
| `heap` | Live memory in use |
| `allocs` | Total allocations since the program started |
| `goroutine` | Stack traces of all goroutines right now |
| `block` | Time spent blocked on synchronization |
| `mutex` | Contention on mutexes |
| `threadcreate` | OS thread creation sites |

Junior level only needs the first three; the others appear in the middle file.

---

## 2. Three ways to collect a profile

### a) From a test or benchmark

The `testing` package has built-in flags:

```bash
go test -bench=. -cpuprofile=cpu.prof -memprofile=mem.prof ./...
```

This produces `cpu.prof` and `mem.prof` in the working directory. No code changes needed. This is the easiest and most common entry point.

### b) From a long-running server with `net/http/pprof`

Add one blank import; the package registers HTTP handlers on `http.DefaultServeMux` at `/debug/pprof/`:

```go
import (
    "net/http"
    _ "net/http/pprof" // registers handlers under /debug/pprof/
)

func main() {
    go http.ListenAndServe("localhost:6060", nil)
    // ... your server ...
}
```

Then from another terminal:

```bash
# 30-second CPU profile
curl -o cpu.prof http://localhost:6060/debug/pprof/profile?seconds=30
# Current heap snapshot
curl -o heap.prof http://localhost:6060/debug/pprof/heap
```

### c) From arbitrary code with `runtime/pprof`

```go
import (
    "os"
    "runtime/pprof"
)

func main() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()
    work()
}
```

Use this when neither tests nor an HTTP server is convenient.

---

## 3. Opening a profile

Two modes. Both come with the Go toolchain:

```bash
# Interactive terminal UI
go tool pprof cpu.prof

# Web UI with flame graphs in your browser
go tool pprof -http=:8080 cpu.prof
```

The browser mode is much friendlier when you are starting out. It opens to a graph view; switch to "Flame Graph" from the View menu.

For terminal use, the three commands you need first are:

```
(pprof) top          # 10 hottest functions
(pprof) list myFunc  # annotated source of myFunc with samples per line
(pprof) web          # render the call graph in your browser (needs Graphviz)
```

---

## 4. A minimal end-to-end example

Create `slow_test.go`:

```go
package slow

import "testing"

func BenchmarkSum(b *testing.B) {
    for i := 0; i < b.N; i++ {
        s := 0
        for j := 0; j < 10_000; j++ {
            s += j
        }
        _ = s
    }
}
```

Run it and profile:

```bash
go test -bench=. -cpuprofile=cpu.prof
go tool pprof -http=:8080 cpu.prof
```

Open `http://localhost:8080`. You will see the loop dominating the flame graph. That is the whole loop: profile, open, read.

---

## 5. Reading a flame graph (the basics)

- The **x-axis** is sample count (not time order). Wider means more samples.
- The **y-axis** is the call stack. The function at the top of a column is the one actually running on CPU at that sample.
- Each box is a function. Click to zoom; click "Reset" to zoom out.
- Look for the **widest box near the top** — that is your hottest function.

Do not read the x-axis as time. Two adjacent boxes on the x-axis were not necessarily adjacent in time; they are just stacks that share a prefix.

---

## 6. CPU profile vs memory profile

- **CPU profile** (`cpu.prof`) tells you where time is spent executing.
- **Memory profile** (`heap` or `allocs`) tells you where allocations happen.

They answer different questions. A function that allocates a lot but runs rarely will be loud in the heap profile and quiet in the CPU profile, and vice versa. Pick the profile that matches your symptom: high CPU, look at `cpu`; high memory, look at `heap`.

---

## 7. Prerequisites

- Go 1.21+ (`go version`).
- For `web` and `-http` graph rendering: install **Graphviz** (`brew install graphviz`, `apt install graphviz`).
- A workload that actually exercises the code path you want to profile — a profile of nothing tells you nothing.

---

## 8. What `pprof` does **not** do

- It does not record every function call (too expensive). It samples.
- It does not show wall-clock time by default — only on-CPU time. Goroutines that are blocked on I/O are invisible in the CPU profile. Use the `block` profile for that.
- It does not work on optimized-out (inlined) functions the way you expect; inlined calls collapse into the caller. We revisit this in the senior and professional files.

---

## 9. Summary

`pprof` is the Go profiler you reach for first. Collect with `go test -cpuprofile`, `net/http/pprof`, or `runtime/pprof`. Open with `go tool pprof -http=:8080 file.prof` for browser flame graphs or `go tool pprof file.prof` for the terminal. CPU profiles answer "where is time spent?"; heap profiles answer "where is memory used?". Sampling means cheap to run in production — but you need a realistic workload for the numbers to mean anything.

---

## Further reading
- `go help testflag` (the `-cpuprofile`, `-memprofile` flags)
- `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
- `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
- Go blog — Profiling Go programs: https://go.dev/blog/pprof
