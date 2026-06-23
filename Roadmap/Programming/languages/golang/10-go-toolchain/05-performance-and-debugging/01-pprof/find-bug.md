# pprof — Find the Bug

Each scenario shows a setup or interpretation that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — `/debug/pprof/` returns 404

```go
import (
    "net/http"
    "net/http/pprof"   // <-- not blank-imported
)

func main() {
    http.ListenAndServe(":6060", nil)
}
```

```
$ curl localhost:6060/debug/pprof/heap
404 page not found
```

**Bug:** the import is **named**, not blank. The compiler drops unused imports; the package's `init()` (which registers the handlers) never runs.
**Fix:** make it blank: `_ "net/http/pprof"`. The blank import keeps the side effects.

---

## Bug 2 — pprof endpoint exposed publicly

```go
import _ "net/http/pprof"

func main() {
    // public HTTPS LB terminates at :8080
    http.ListenAndServe(":8080", nil)
}
```

**Bug:** the pprof handlers are registered on `http.DefaultServeMux`, which is the public server. Anyone on the internet can pull goroutine stacks, heap snapshots (memory addresses, leaked secrets), and tie up CPU for `?seconds=300`.
**Fix:** run pprof on a private listener with its own mux, e.g.:

```go
admin := http.NewServeMux()
admin.Handle("/debug/pprof/", http.DefaultServeMux) // pprof registered on default mux
go http.ListenAndServe("127.0.0.1:6060", admin)
// public server uses a *separate* mux that does NOT include pprof
```

---

## Bug 3 — "Empty" CPU profile

```bash
$ go tool pprof cpu.prof
File: app
Type: cpu
Duration: 1.00s, Total samples = 0
```

**Bug:** the capture was only 1 second at the default 100 Hz, against a mostly-idle workload — too few samples to register anything.
**Fix:** capture longer (`?seconds=30`), drive the workload harder during capture, or temporarily raise `runtime.SetCPUProfileRate(500)`. If the program really is idle, the profile is accurate — look at the right kind (block? heap?).

---

## Bug 4 — `-base` shows nonsense functions

```bash
$ go tool pprof -http=:8080 -base=old.prof new.prof
... shows functions that don't exist in either binary
```

**Bug:** `old.prof` was captured from a different binary (different commit, different compiler). The PC addresses do not symbolize the same in both, and the delta is meaningless.
**Fix:** always capture both profiles against the **same binary version**, or symbolize against the matching binary using `PPROF_BINARY_PATH`. In CI, version your benchmark baselines per commit.

---

## Bug 5 — "We're not leaking" — heap looks flat, but RSS grows

```
heap inuse_space: stable around 200MB
RSS: grew from 1GB to 4GB overnight
```

**Bug:** the engineer looked at `inuse_space` only. The actual problem is **allocation churn**: huge `alloc_space` per request causes the runtime to keep memory around (the Go runtime is conservative about returning memory to the OS). The `heap inuse` is small, but the process footprint is large.
**Fix:** look at `alloc_space` (`sample_index=alloc_space`) and reduce allocations. Confirm with `runtime.ReadMemStats` (`HeapIdle`, `HeapReleased`). High `HeapIdle` + flat `inuse` = churn problem.

---

## Bug 6 — Profile file is empty

```go
f, _ := os.Create("cpu.prof")
pprof.StartCPUProfile(f)
// ... work ...
// (no StopCPUProfile, program exits)
```

**Bug:** `pprof.StopCPUProfile` is what flushes the protobuf trailer and writes the gzip footer. Without it, the file is missing the end-of-stream and `go tool pprof` reports a truncated/empty profile.
**Fix:** `defer pprof.StopCPUProfile()` right after `StartCPUProfile`. Also `defer f.Close()` after that.

---

## Bug 7 — Profile dominated by `runtime.gcBgMarkWorker`

```
(pprof) top
     flat  flat%   cum  cum%
   18.5s  44.2%  18.5s  44.2% runtime.gcBgMarkWorker
    9.2s  22.0%  ...               runtime.mallocgc
    ...
```

**Bug:** the engineer concluded "the GC is slow, the runtime is the problem" and started reading Go runtime source. The real cause is **their code's allocation rate** — the GC scales with allocations.
**Fix:** switch to a heap (`allocs`) profile. Find what allocates the most. Reduce it via pooling, buffer reuse, avoiding interface conversions on hot paths. The `gcBgMarkWorker` line shrinks proportionally.

---

## Bug 8 — Inlined function "disappears"

```
(pprof) top
     flat
   30%   outer
   0%    inner   // wait, I optimized inner — why is it not showing time?
```

**Bug:** `inner` was inlined into `outer` by the compiler, so its samples are attributed to `outer`. The flame graph hides the call boundary.
**Fix:** use `list outer` to see per-source-line attribution — the inlined `inner` body shows up on its source lines inside `outer`. Or compile with `-gcflags='-m=2'` to confirm the inline decision. Do **not** disable inlining (`-l`) just to read the profile; it changes performance.

---

## Bug 9 — Block profile is empty

```bash
$ curl -o block.prof localhost:6060/debug/pprof/block
$ go tool pprof -top block.prof
File: app
Type: contentions
Duration: 0s, Total samples = 0
```

**Bug:** the block profiler is **off by default**. `SetBlockProfileRate(n)` was never called, so no events were recorded.
**Fix:** at startup, `runtime.SetBlockProfileRate(10000)` (sample once per ~10μs of blocking). Same story for mutex contention — `runtime.SetMutexProfileFraction(1)`. Both are off by default to avoid overhead.

---

## Bug 10 — "I see `runtime.gopark` everywhere — what is that?"

```
(pprof) top -cum
     cum%
   95%   runtime.gopark
   95%   runtime.chanrecv
   90%   main.worker
```

**Bug:** this is the **goroutine** profile, not the CPU profile. `runtime.gopark` is "this goroutine is parked (sleeping)" — every blocked goroutine ends in `gopark`. The engineer misread it as a CPU bottleneck.
**Fix:** distinguish profile kinds. The goroutine profile shows what every goroutine is **currently doing**, including parked ones. To see who is on CPU, use the CPU profile. To see who is contended, use block/mutex. A `runtime.gopark`-heavy goroutine profile is normal for an idle server.

---

## How to approach these

1. No handlers? → check the import is **blank**: `_ "net/http/pprof"`.
2. Profile empty? → capture longer, run a real workload, or check `StopCPUProfile` was called.
3. Delta nonsense? → both profiles must come from the same binary.
4. RSS up, heap flat? → look at `alloc_space`, not `inuse_space`.
5. GC dominates CPU? → fix allocations, not the GC.
6. Function "missing"? → likely inlined; use `list`.
7. Block/mutex empty? → enable the rates first.
8. `gopark` is normal in goroutine profiles — not in CPU profiles.
9. Never expose `/debug/pprof/` on a public port.
