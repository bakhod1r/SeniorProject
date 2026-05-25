# pprof — Middle

## 1. The profile kinds in detail

The `net/http/pprof` package exposes one endpoint per kind. The same kinds are available from `runtime/pprof.Lookup`.

| Kind | URL | Question it answers |
|------|-----|---------------------|
| `cpu` | `/debug/pprof/profile?seconds=N` | Where is on-CPU time spent? |
| `heap` | `/debug/pprof/heap` | What is **live** in memory right now? |
| `allocs` | `/debug/pprof/allocs` | What has been allocated since program start (live or dead)? |
| `goroutine` | `/debug/pprof/goroutine` | What are all goroutines doing right now? |
| `block` | `/debug/pprof/block` | Where do goroutines wait on sync primitives? |
| `mutex` | `/debug/pprof/mutex` | Which mutexes are contended? |
| `threadcreate` | `/debug/pprof/threadcreate` | Where are OS threads spawned? |

Pick the one matching your symptom:

- **High CPU** → `cpu`.
- **OOM, RSS growing** → `heap` (and `allocs` to see churn).
- **Slow but CPU is idle** → `block` (or `mutex` if contention is the cause).
- **Process slowly growing goroutine count** → `goroutine`.

---

## 2. `heap` vs `allocs` — the difference that bites everyone

```
allocs = total objects/bytes allocated since program start (including freed)
heap   = objects/bytes that are still alive at sampling time
```

- If you want to find **what leaks**, read `heap`.
- If you want to find **what churns the GC**, read `allocs` — high allocation rate with normal heap means high garbage pressure.

Both use the same protobuf schema. `heap` has the sample types `alloc_objects`, `alloc_space`, `inuse_objects`, `inuse_space`. By default the pprof CLI shows `inuse_space`. Switch with:

```
(pprof) sample_index=alloc_space
```

---

## 3. Capturing from a live server

```bash
# 30 seconds of CPU
curl -s -o cpu.prof "http://prod.internal:6060/debug/pprof/profile?seconds=30"

# Heap snapshot (instant)
curl -s -o heap.prof "http://prod.internal:6060/debug/pprof/heap"

# All goroutine stacks
curl -s -o goro.prof "http://prod.internal:6060/debug/pprof/goroutine"

# Human-readable goroutine dump (one stack each)
curl "http://prod.internal:6060/debug/pprof/goroutine?debug=2"
```

`?seconds=N` is specific to the `profile` (CPU) endpoint. Other endpoints return a snapshot immediately.

> Production note: never expose `/debug/pprof/` on a public listener. Bind it to localhost or an admin port. The senior file covers the architecture.

---

## 4. Driving pprof from code

Same things, without HTTP:

```go
import (
    "os"
    "runtime/pprof"
)

// CPU
f, _ := os.Create("cpu.prof")
if err := pprof.StartCPUProfile(f); err != nil { ... }
defer pprof.StopCPUProfile()

// Heap (forces a GC for accuracy, then writes)
hf, _ := os.Create("heap.prof")
runtime.GC()
pprof.WriteHeapProfile(hf)
hf.Close()

// Any named profile
gp, _ := os.Create("goroutine.prof")
pprof.Lookup("goroutine").WriteTo(gp, 0)
gp.Close()
```

The `Lookup("goroutine").WriteTo(w, debug)` form accepts `debug=0` (protobuf, machine-readable) or `debug=1`/`2` (text). The `pprof` CLI wants `0`.

---

## 5. Sampling rate

The CPU profiler defaults to **100 Hz** (every 10ms). You can change it:

```go
runtime.SetCPUProfileRate(500) // 500 samples/sec
```

Higher rate = finer detail but more overhead and bigger files. The runtime caps the effective rate around 1000 Hz on most platforms. Lowering below 100 Hz is rarely useful.

Memory sampling is rate-controlled by `runtime.MemProfileRate` (default: sample one in every ~512KB allocated). Set to `1` to sample every allocation (expensive), or `0` to disable.

```go
runtime.MemProfileRate = 1 // sample every allocation; use only for tests
```

---

## 6. The pprof CLI commands you actually use

```
(pprof) top                 # 10 hottest functions, by flat then cum
(pprof) top 30 -cum         # 30 hottest by cumulative time
(pprof) list myFunc         # annotated source of myFunc
(pprof) peek myFunc         # show callers/callees around myFunc
(pprof) web                 # full call graph in browser (needs Graphviz)
(pprof) tree                # text call tree
(pprof) disasm myFunc       # annotated assembly
(pprof) traces              # individual recorded samples
(pprof) sample_index=...    # switch between alloc/inuse for heap profiles
```

`flat` is time spent in the function itself (excluding callees). `cum` is time including everything it called. A leaf hot function has high flat. A dispatcher (e.g., `runtime.mallocgc`) has high cum and modest flat.

---

## 7. Comparing two profiles with `-base`

A profile in isolation tells you what is hot. The valuable question is "what changed?". Capture before and after a change:

```bash
# Baseline
go test -bench=BenchmarkX -cpuprofile=before.prof
# Apply change, recapture
go test -bench=BenchmarkX -cpuprofile=after.prof

# View only the delta
go tool pprof -http=:8080 -base=before.prof after.prof
```

In the delta view, **positive samples are regressions** (after has more) and **negative are improvements** (after has less). This is the single most useful pprof workflow for tuning hot paths.

`-diff_base` is similar but normalizes the totals — better when the absolute workloads differ. `-base` is fine when both profiles came from the same workload.

---

## 8. Profile size and capture window

A 30-second CPU capture is the sweet spot for most servers. Too short (1s) often shows nothing because you only got ~100 samples and they will be noisy. Too long (5 minutes) bloats the file and averages over too many phases.

Rule of thumb:

- **Benchmark profile:** capture all of `b.N`, set `-benchtime=5s` for stability.
- **Production CPU:** 30s.
- **Heap/goroutine:** instant — no window.

---

## 9. Workflow checklist

1. State the symptom in one sentence (CPU pegged at 100%? RSS growing?).
2. Pick the profile kind that matches.
3. Capture from a **representative** workload.
4. Open with `-http`; start at the flame graph.
5. Identify the widest box you can act on.
6. Make the change.
7. Re-capture and compare with `-base`.

Skipping step 1 leads to "I optimized something that was not the bottleneck."

---

## 10. Summary

Beyond the basics: pick the right profile kind for the symptom; understand `heap` vs `allocs`; capture from live servers via `curl`; tweak the sampling rate when you need finer or coarser data; use `top`/`list`/`peek`/`web` in the CLI; always compare before/after with `-base`. Profiling is cheap; profiling without a hypothesis is wasted.

---

## Further reading
- `runtime/pprof`: https://pkg.go.dev/runtime/pprof
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
- `runtime.SetCPUProfileRate`: https://pkg.go.dev/runtime#SetCPUProfileRate
- `runtime.MemProfileRate`: https://pkg.go.dev/runtime#pkg-variables
- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
