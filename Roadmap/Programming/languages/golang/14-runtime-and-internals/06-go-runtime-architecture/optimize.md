# Go Runtime Architecture — Optimization

## 1. How to use this file

Fourteen scenarios where the Go runtime architecture — scheduler, GC, goroutine model, cgo bridge, signal handling, binary layout — bleeds throughput, latency, or memory if you let it. Each entry has a **Before** (code + benchmark or measurement) and a collapsible **After** (optimized code + result + why + trade-offs + when NOT).

Anchored at Go 1.22+, amd64 Linux. Numbers are reproducible-shape — run `go test -bench=. -benchmem`, `/usr/bin/time -v`, `pprof`, or `runtime/metrics` on your hardware before quoting them. Runtime cost is dominated by six things: scheduler scheduling decisions (`P` count, `M` blocking), GC pacing (heap target vs CPU spent marking), goroutine lifecycle (creation, stack growth, parking), cgo call overhead (~50-200 ns/call plus thread pinning), binary layout (init order, debug bloat), and container/OS coupling (CPU quotas, RSS visibility). Most wins remove one of those from the steady-state hot path or the cold-start path. Reading order: Ex. 1, 2, 5, 11, then any order. Ex. 4, 9, 14 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Boot-time CPU spike from package init

A web service imports 40 packages. Each `init()` builds tables, opens config files, dials a Vault sidecar, compiles regex pools, or pre-warms LRU caches. Boot wall time is 4.2 s with one CPU pegged at 100% before `main` even runs. In Kubernetes, the readiness probe trips and the pod restart loops on a slow node.

```go
package secrets

var vault *VaultClient

func init() {
    c, err := vault.Dial(os.Getenv("VAULT_ADDR"), 5*time.Second)
    if err != nil { log.Fatalf("vault dial: %v", err) }
    vault = c
    // pre-fetch 200 secrets to "speed up first request"
    for _, k := range knownKeys { vault.Get(k) }
}
```

```
$ time ./server -healthcheck
real    4.21s   user 3.84s   sys 0.31s   // CPU-bound init across 40 packages
```

<details><summary>After</summary>

Move work out of `init()`. `init` should declare zero-cost defaults and register handlers, nothing more. Use `sync.Once` to lazy-init on first use, or an explicit `App.Start(ctx)` called from `main` after flags parse.

```go
package secrets

var (
    vault    *VaultClient
    vaultOnc sync.Once
    vaultErr error
)

func Vault() (*VaultClient, error) {
    vaultOnc.Do(func() {
        vault, vaultErr = VaultClient{}.Dial(os.Getenv("VAULT_ADDR"), 5*time.Second)
    })
    return vault, vaultErr
}
```

```
$ time ./server -healthcheck
real    0.18s   user 0.12s   sys 0.04s   // init now does nothing
```

~23× faster boot. Readiness probe passes on the first attempt.

**Why faster:** `init()` runs serially per package in import-graph order before `main` returns control. Network dials, regex compiles, and file reads block the single main goroutine. Lazy-init moves the cost to the first request that needs the dependency, which the request budget can absorb (and which can be warmed in parallel with other startup work).
**Trade-off:** First request that needs `Vault()` pays the full dial latency. Mitigate with an explicit `go warmup()` in `main` that calls `Vault()` in the background. `sync.Once` errors must be re-checkable — store `vaultErr` and decide whether to retry. Loses the "fail loudly on bad config at boot" property — guard with an explicit `App.Validate()` at startup.
**When NOT:** CLI tools where startup is the entire process lifetime. Tests where init order is a feature. Code requiring registry-style auto-registration (`database/sql` drivers) — keep those `init()` blocks pure (no I/O, just `Register` calls).
</details>

---

## 3. Exercise 2 — Goroutine spawned per request

An HTTP handler kicks off a `go processBackground(req)` for every request. Under 50k RPS, the runtime has 500k+ live goroutines, scheduler queues bloat, and GC scan time over the goroutine stacks spikes to 40 ms.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    go processBackground(r.Context(), r.Body)
    w.WriteHeader(http.StatusAccepted)
}

func processBackground(ctx context.Context, body io.ReadCloser) {
    defer body.Close()
    // 50ms of CPU work + 100ms of downstream RPC
}
```

```
$ go tool pprof -alloc_objects http://localhost:6060/debug/pprof/goroutine
Showing top 10 nodes: 487,000 goroutines runnable, scheduler latency p99 = 35 ms
```

<details><summary>After</summary>

Bounded worker pool with `runtime.GOMAXPROCS(0)` workers (CPU-bound) or 2-4× that (I/O-bound). Handler enqueues; workers drain. Reject or block when the queue is full to apply backpressure rather than letting goroutines pile up.

```go
type Job struct{ ctx context.Context; body []byte }

var jobs = make(chan Job, 1024)

func init() {
    n := runtime.GOMAXPROCS(0) * 4 // I/O-bound; tune to your workload
    for i := 0; i < n; i++ {
        go func() { for j := range jobs { processBackground(j.ctx, j.body) } }()
    }
}

func handler(w http.ResponseWriter, r *http.Request) {
    b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20)); r.Body.Close()
    select {
    case jobs <- Job{r.Context(), b}:
        w.WriteHeader(http.StatusAccepted)
    default:
        http.Error(w, "busy", http.StatusServiceUnavailable) // shed load
    }
}
```

```
$ go tool pprof -alloc_objects http://localhost:6060/debug/pprof/goroutine
Showing top 10 nodes: 64 goroutines runnable, scheduler latency p99 = 0.4 ms
```

~85× lower scheduler latency, bounded goroutine count, predictable RSS.

**Why faster:** Each goroutine costs ~2 KB stack minimum (grows). The scheduler maintains per-P runqueues; 500k runnable goroutines force expensive global-queue rebalancing under work-stealing. GC scans every goroutine stack — stack scan is proportional to goroutine count. A pool of N workers gives O(N) scheduler state regardless of request rate.
**Trade-off:** Queue size becomes a tuning knob; too small drops requests, too big hides upstream pressure. Workers must be cancel-aware (`select { case <-ctx.Done(): return; case j := <-jobs: ... }`) or jobs run after client disconnect. Per-request goroutines were stateless; the pool serializes work that previously interleaved freely.
**When NOT:** Very low rates (< 100 RPS) where unbounded `go` is fine. Workloads needing strict per-request isolation (e.g. panic in one job killing the worker takes down the others — wrap with `defer recover()`). Long-running background work that doesn't share a queue (use a dedicated supervisor goroutine).
</details>

---

## 4. Exercise 3 — Channel-based pipeline allocating per item

A log-processing pipeline has 4 stages connected by unbuffered channels. Each stage allocates a fresh `*Event` per item passed downstream. At 200k events/s, that's 200k `mallocgc` calls per second, hammering GC.

```go
type Event struct { Ts int64; Level string; Msg string; Fields map[string]any }

func stage1(in <-chan []byte, out chan<- *Event) {
    for raw := range in {
        e := &Event{} // heap alloc per item
        json.Unmarshal(raw, e)
        out <- e
    }
}
// stage2, stage3 each receive *Event, mutate, send to next stage
```

```
BenchmarkPipeline-8   200   62000000 ns/op   48000000 B/op   600000 allocs/op
GC pause p99: 8.4 ms, GC CPU: 22%
```

<details><summary>After</summary>

Object pool for `*Event`, plus bounded-buffer channels so producer/consumer rates decouple without unbounded queueing. Items are returned to the pool when the last stage finishes with them.

```go
var eventPool = sync.Pool{New: func() any { return &Event{Fields: make(map[string]any, 8)} }}

func acquireEvent() *Event { return eventPool.Get().(*Event) }
func releaseEvent(e *Event) {
    e.Ts, e.Level, e.Msg = 0, "", ""
    for k := range e.Fields { delete(e.Fields, k) } // keep capacity
    eventPool.Put(e)
}

func stage1(in <-chan []byte, out chan<- *Event) {
    for raw := range in {
        e := acquireEvent()
        json.Unmarshal(raw, e)
        out <- e
    }
}

func stageN(in <-chan *Event) { // terminal stage
    for e := range in { write(e); releaseEvent(e) }
}

// Use buffered channels of size GOMAXPROCS*2 so stages can run ahead.
ch12 := make(chan *Event, runtime.GOMAXPROCS(0)*2)
```

```
BenchmarkPipelinePool-8   1500   8200000 ns/op   1200000 B/op   8000 allocs/op
GC pause p99: 0.6 ms, GC CPU: 4%
```

~7.5× faster, ~75× fewer allocations, GC CPU down 5×.

**Why faster:** `sync.Pool` is per-P (per scheduler P) with a victim cache. Get/Put are wait-free in the common case. Items skip the heap entirely once the pool warms up. Bounded channels let stage 1 and stage 4 run on separate Ps without synchronizing on every item — buffering smooths jitter.
**Trade-off:** Pool items must be reset on `Put` — a stale field carries data across requests (security: leaking another tenant's payload). Don't pool items reachable through user-visible references that outlive the pipeline. Map fields inside pooled structs need `delete(...)` not `nil` to preserve allocated capacity. Bounded channels apply backpressure — choose the buffer size to absorb burst variance, not to hide a slow downstream.
**When NOT:** Items < 32 B where pool overhead matches alloc cost. Pipelines processing < 10k items/s. Code where lifetime is too tangled to reliably `Put` (use a `defer releaseEvent(e)` at the goroutine entry, or skip pooling).
</details>

---

## 5. Exercise 4 — Cgo call per item

A geo service calls into a C `s2geometry` library through cgo to compute a cell ID per coordinate. Each call crosses the Go-C boundary, switches stacks, and pins the calling goroutine to an OS thread for the duration. Per-item cost: ~180 ns of pure cgo overhead before any C work.

```go
/*
#include "s2.h"
*/
import "C"

func cellID(lat, lng float64) uint64 {
    return uint64(C.s2_cellid(C.double(lat), C.double(lng))) // ~200 ns overhead
}

func processBatch(coords []Coord) []uint64 {
    out := make([]uint64, len(coords))
    for i, c := range coords { out[i] = cellID(c.Lat, c.Lng) }
    return out
}
```

```
BenchmarkCgoPerItem-8   3000   420000 ns/op   0 B/op   0 allocs/op  // 1000 coords
```

<details><summary>After</summary>

Amortize the boundary crossing: one cgo call per batch, passing pointers to Go slices the C side fills in place.

```go
/*
#include "s2.h"
void s2_cellid_batch(const double* lats, const double* lngs, uint64_t* out, size_t n);
*/
import "C"

func processBatch(coords []Coord) []uint64 {
    n := len(coords)
    lats := make([]float64, n); lngs := make([]float64, n)
    for i, c := range coords { lats[i] = c.Lat; lngs[i] = c.Lng }
    out := make([]uint64, n)
    C.s2_cellid_batch(
        (*C.double)(unsafe.Pointer(&lats[0])),
        (*C.double)(unsafe.Pointer(&lngs[0])),
        (*C.uint64_t)(unsafe.Pointer(&out[0])),
        C.size_t(n),
    )
    return out
}
```

```
BenchmarkCgoBatch-8   30000   42000 ns/op   24576 B/op   3 allocs/op
```

~10× faster, cgo overhead amortized across 1000 items.

**Why faster:** Each cgo call is not a simple function call — Go performs a stack switch, parks the goroutine on a thread that can leave Go-runtime supervision, sets up cgo argument frames, and (post-call) marks the goroutine ready to be picked back up by a P. ~50-200 ns of pure runtime overhead per call. Batching collapses N×overhead into 1×overhead. C-side SIMD/parallelism is also unlocked when the C function sees the whole batch.
**Trade-off:** C side must validate `n` and bounds-check pointers — Go's slice safety stops at the cgo boundary. Errors per item are harder to surface; return an array of error codes alongside results. Cgo blocks the OS thread; large batches can starve other goroutines. Tune batch size (1k-10k typical) and consider `runtime.LockOSThread` only if the C library has thread-local state (most don't).
**When NOT:** Cgo calls already amortized (one call per request, not per item). Items where pre-marshaling into flat slices costs more than the boundary crossing (e.g. complex variable-length structs). Pure-Go ports available (e.g. `github.com/golang/geo`) — eliminate cgo entirely.
</details>

---

## 6. Exercise 5 — Slow GC triggering on hot path

A batch service processes 10 GB of records. With default GC settings (`GOGC=100`), the heap doubles before each GC, so collections happen every ~1 s of work. Each GC scans 5 GB of live heap; the CPU budget for marking eats 25% of throughput.

```go
// no env vars set; default GOGC=100, GOMEMLIMIT=unlimited
func process(records []Record) {
    cache := map[string]*Result{}
    for _, r := range records { cache[r.Key] = compute(r) }
    // ... use cache ...
}
```

```
$ GODEBUG=gctrace=1 ./service
gc 42 @142.3s 25%: 8.1+312+1.2 ms cpu, 5120->5121->5118 MB
gc 43 @150.1s 25%: 8.2+318+1.3 ms cpu, 10236->10237->5120 MB    // doubled before GC
GC CPU: 25%, GC frequency: every 7-8s, peak RSS: 11 GB
```

<details><summary>After</summary>

Set `GOMEMLIMIT` to the container's memory cap minus ~20% headroom. The GC paces itself to stay under the limit, running more frequent but shorter collections instead of fewer huge ones. Combined with `GOGC=off` (or a high value) for pure soft-limit-driven pacing.

```go
import "runtime/debug"

func init() {
    debug.SetMemoryLimit(8 << 30) // 8 GB soft limit
    // alternative: env GOMEMLIMIT=8GiB
}
```

```
$ GOMEMLIMIT=8GiB GODEBUG=gctrace=1 ./service
gc 89 @142.3s 11%: 3.2+98+0.5 ms cpu, 5800->5801->5400 MB
gc 90 @144.7s 11%: 3.1+96+0.5 ms cpu, 6100->6101->5500 MB
GC CPU: 11%, GC frequency: every 2-3s, peak RSS: 7.8 GB
```

GC CPU drops from 25% to 11%; peak RSS predictable at 8 GB instead of 11 GB.

**Why faster:** Default `GOGC=100` is a *ratio*: GC fires when heap grows 100% past live size. On a 5 GB live heap, that's 10 GB before collection — a single huge mark phase. `GOMEMLIMIT` is an *absolute soft target*: the GC adjusts pacing to stay under it, so it triggers earlier when the heap approaches the cap, doing more, smaller collections that the OS can spread over time. CPU goes down because each mark phase scans less live data per cycle relative to assist credit.
**Trade-off:** GC runs more often — fine for throughput, can add latency jitter for low-latency services (counter with `GOGC=off`). Setting it too tight makes GC thrash (rule: leave 20% headroom). `GOMEMLIMIT` is *soft* — Go will exceed it briefly under allocation bursts rather than OOM-kill itself. Container OOMKills are still possible if the kernel sees RSS spike past the cgroup limit.
**When NOT:** Latency-critical services where 11% GC CPU is acceptable but jitter is not — keep `GOGC=100` and provision RAM. Workloads with stable, predictable heap growth where ratio-based pacing already does the right thing. Tools running for seconds — GC tuning rarely matters.
</details>

---

## 7. Exercise 6 — Long-running process never releases memory

A daemon ingests a 4 GB batch every 6 hours. Peak RSS hits 8 GB during ingest, but the OS never sees the memory return: Go's runtime hands freed pages back to the OS lazily, and on idle the daemon shows 7 GB resident for hours. Operators alert on RSS regression even though Go heap is mostly empty.

```go
func dailyBatch() {
    data := loadBatch()       // peak heap: 4 GB
    process(data)             // peak: 8 GB
    data = nil                // unreferenced
    // 6-hour idle... RSS still 7 GB
}
```

```
$ ps -o rss,cmd -p $(pidof daemon)
RSS    CMD
6915840  daemon  // 6.6 GB resident, 30 min after batch finished
```

<details><summary>After</summary>

Option A: explicit `debug.FreeOSMemory()` after the batch — synchronous, blocks until pages are returned to the OS.
Option B (preferred for steady-state): set `GOMEMLIMIT` so pacing tightens the heap target during idle, and use `runtime/debug.SetGCPercent` to allow more aggressive collection.

```go
import "runtime/debug"

func dailyBatch() {
    data := loadBatch()
    process(data)
    data = nil
    runtime.GC()             // synchronous mark/sweep
    debug.FreeOSMemory()     // madvise(DONTNEED) on freed spans
}

// Or set once at startup:
debug.SetMemoryLimit(2 << 30) // 2 GB cap during idle; ingest paces against it
```

```
$ ps -o rss,cmd -p $(pidof daemon)
RSS    CMD
892144   daemon  // 870 MB, 30 seconds after batch
```

RSS drops from 6.6 GB to 870 MB after a batch — operators stop alerting.

**Why faster (or more accurate: visible):** Go uses `madvise(MADV_DONTNEED)` on Linux to hint freed pages to the kernel — the pages still count as RSS until the kernel reclaims them. Default behavior delays this advise call to amortize the syscall cost; `debug.FreeOSMemory` forces it immediately. `GOMEMLIMIT` forces the runtime to keep heap target tight; the runtime advises pages aggressively to honor the limit. Without either, Go assumes you'll need the memory again soon and keeps it reserved.
**Trade-off:** `debug.FreeOSMemory` is a stop-the-world pause and a syscall storm — don't call it in a hot loop. Future allocations re-fault pages from the OS (slow first-touch). `GOMEMLIMIT` constantly tuned for idle may add GC pressure during ingest — sometimes set it dynamically (high during batch, low after).
**When NOT:** Services where peak ≈ steady-state RSS (no idle dips). Workloads where re-faulting freed memory dominates the next batch's latency. Containers where the cgroup memory accounting doesn't surface RSS to the alerting layer anyway.
</details>

---

## 8. Exercise 7 — Heavy use of `interface{}` in hot path

A metrics aggregator stores values as `interface{}` to support int, float, string, and histogram types. Each store/load box and unbox heap-allocates the int, and type assertions branch unpredictably.

```go
type Metric struct { Name string; Value interface{} }

func (m *Metric) AsInt() int64 {
    switch v := m.Value.(type) {
    case int64: return v
    case int: return int64(v)
    case float64: return int64(v)
    }
    return 0
}

var bucket = map[string]*Metric{}
func Inc(name string, delta int64) {
    if m, ok := bucket[name]; ok {
        bucket[name] = &Metric{Name: name, Value: m.AsInt() + delta} // alloc!
        return
    }
    bucket[name] = &Metric{Name: name, Value: delta} // alloc + box!
}
```

```
BenchmarkInterfaceMetrics-8   2000000   650 ns/op   48 B/op   2 allocs/op
```

<details><summary>After</summary>

Generics + typed maps. The metric type is part of the static type system; no boxing.

```go
type Counter struct{ v atomic.Int64 }
type Histogram struct{ buckets [16]atomic.Uint64 }

type Registry[V any] struct{ m sync.Map } // typed per V

var counters Registry[*Counter]
var hists Registry[*Histogram]

func IncCounter(name string, delta int64) {
    v, _ := counters.m.LoadOrStore(name, &Counter{})
    v.(*Counter).v.Add(delta)
}
```

```
BenchmarkTypedMetrics-8   30000000   42 ns/op   0 B/op   0 allocs/op
```

~15× faster, zero allocations.

**Why faster:** `interface{}` of `int64` heap-allocates the int (boxing) because the iface's data word holds a pointer for non-pointer-sized types on some configurations, and the compiler conservatively boxes when the type isn't statically known. Each `.AsInt()` does an iface comparison through the itab — branch-predictable per call site but mispredicts at hot map iteration. Generics let the compiler stamp out a specialized version per V, removing iface dispatch entirely. `atomic.Int64.Add` is lock-free.
**Trade-off:** Generics-per-type duplicates code at compile time — binary grows ~5-20 KB per instantiation. Loses the ability to store mixed types in one container — needed for true polymorphism. Refactor friction: every caller must commit to a specific metric type.
**When NOT:** Truly polymorphic collections (e.g. a JSON tree) where the type *must* be dynamic. Code where iface overhead is invisible in profiles. Public APIs where breaking the iface contract is too disruptive.
</details>

---

## 9. Exercise 8 — Map of pointers vs map of structs

A symbol table holds 1M `*Symbol` values keyed by name. Each `*Symbol` is its own heap allocation; map iteration chases pointers across the heap, hitting cold cache lines for every entry.

```go
type Symbol struct { Kind uint8; Offset uint32; Type uint16; Name string }

var table = map[string]*Symbol{} // 1M pointer values

func sumOffsets() uint64 {
    var sum uint64
    for _, s := range table { sum += uint64(s.Offset) } // pointer chase per iter
    return sum
}
```

```
BenchmarkMapPtrIter-8   80   14000000 ns/op   0 B/op   0 allocs/op  // 1M entries
```

<details><summary>After</summary>

Store `Symbol` by value. The map's internal buckets pack 8 entries per bucket; values land contiguously with the keys. Iteration becomes sequential within each bucket.

```go
var table = map[string]Symbol{} // value, not pointer

func sumOffsets() uint64 {
    var sum uint64
    for _, s := range table { sum += uint64(s.Offset) } // value-copied, no pointer chase
    return sum
}
```

```
BenchmarkMapValueIter-8   220   5200000 ns/op   0 B/op   0 allocs/op
```

~2.7× faster.

**Why faster:** Go's `map` stores values inline in bucket arrays if the value fits within the map's per-bucket size budget (8 KB total). Pointer-valued maps store 8 B pointers inline but the actual `Symbol` data is at scattered heap addresses; iteration loads the pointer (cache hit) then dereferences (likely cache miss). Value-valued maps put the entire `Symbol` in the bucket — one cache line load covers multiple consecutive entries. Removes 1M heap allocations at build time too.
**Trade-off:** Mutating `s := table[key]; s.Offset = 5` doesn't update the map (`s` is a copy); must `table[key] = s` to write back, or store pointers. Larger values blow the bucket budget — the map degrades to overflow buckets, partially losing the win. `for _, s := range table` copies each value into `s`; for very large values, iterate keys and index back if you only need a few fields.
**When NOT:** Values frequently mutated in place (`m[k].Field = ...` doesn't compile for value maps; you must reassign). Values > 128 B where copy cost dominates. Code sharing a single `*Symbol` across multiple containers — value semantics break aliasing.
</details>

---

## 10. Exercise 9 — Unnecessary `LockOSThread` slowing throughput

A library wraps a stateless C math function. The original author added `runtime.LockOSThread` "just in case" the C side has TLS. Every call now pins the goroutine to its M, preventing the scheduler from migrating work across Ps; throughput drops to ~1/8 of unpinned.

```go
func compute(x float64) float64 {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return float64(C.compute(C.double(x))) // stateless C call
}
```

```
BenchmarkLockedCgo-8   200000   8400 ns/op   0 B/op   0 allocs/op
```

<details><summary>After</summary>

Remove `LockOSThread` for stateless C functions. Only pin when the C side actually uses thread-local state (e.g. OpenGL contexts, GTK main loop, libraries with `errno`-like TLS that must survive across calls).

```go
func compute(x float64) float64 {
    return float64(C.compute(C.double(x))) // unpinned, scheduler can rebalance
}
```

```
BenchmarkUnlockedCgo-8   1500000   1100 ns/op   0 B/op   0 allocs/op
```

~7.6× faster.

**Why faster:** `LockOSThread` ties a goroutine to a specific M (OS thread) for its lifetime (well, until `Unlock`). The scheduler can't move that goroutine to another P, can't reuse the M for other work, and must spawn extra Ms to compensate. Under load, you exhaust Ps and starve other goroutines. Unlocking restores normal scheduler flexibility — Go's work-stealing redistributes load across cores.
**Trade-off:** If the C library *does* use TLS (rare in modern C; common in OpenGL, X11, Lua state, anything called "main thread only"), removing the pin causes crashes that may surface only under load. Audit the C side; if uncertain, document the assumption and add a runtime test that calls from multiple Ms.
**When NOT:** C libraries with thread-affinity requirements (OpenGL, Cocoa main thread, signal handling). `syscall.Syscall` patterns where the kernel ties state to a thread (rare in Go's stdlib — runtime handles it for you). Code where `LockOSThread` is paired with `runtime.GOMAXPROCS` adjustments for deterministic test ordering.
</details>

---

## 11. Exercise 10 — Signal handler doing real work

A graceful-shutdown handler runs cleanup directly in the signal-handling goroutine: drains a queue, closes files, flushes logs. The signal goroutine blocks on a `chan struct{}` waiting for in-flight requests; meanwhile a second SIGTERM arrives and is lost because the channel is full.

```go
func main() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
    s := <-sig
    log.Printf("got %v, flushing...", s)
    flushQueue()      // blocks 5s
    closeDB()         // blocks 2s
    syncFiles()       // blocks 1s
    log.Printf("done")
    os.Exit(0)
}
```

```
$ kill -TERM $PID
... 8 seconds later, second SIGTERM arrives ...
$ kill -TERM $PID  # ignored, sig channel full
```

<details><summary>After</summary>

Signal goroutine does only one thing: signals shutdown intent. A worker goroutine performs the actual cleanup. The signal channel is drained immediately so subsequent signals (e.g. impatient operator's second SIGTERM) escalate to hard-kill.

```go
func main() {
    sig := make(chan os.Signal, 2)
    signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)

    shutdown := make(chan struct{})
    go func() {
        <-sig
        close(shutdown) // signal first; cleanup runs on a normal goroutine
        select {
        case <-sig:               // second signal → force-exit
            log.Println("force exit")
            os.Exit(1)
        case <-time.After(30 * time.Second):
            log.Println("shutdown timeout")
            os.Exit(2)
        }
    }()

    runServer(shutdown) // returns when shutdown channel closes; does its own cleanup
}
```

```
$ kill -TERM $PID   # close(shutdown); cleanup begins in runServer
$ kill -TERM $PID   # second SIGTERM → os.Exit(1) immediately
```

Cleanup overlaps with signal handling; second SIGTERM works.

**Why correct:** Go's `signal.Notify` delivers signals via a non-blocking send to the channel — if the channel is full, the signal is *dropped*. A signal goroutine doing slow work fills the buffer instantly. The fix: the signal goroutine does the minimum (`close(shutdown)`, then drain further signals); the slow work runs on the main or worker goroutines that already had OS thread budget. This mirrors the OS-level pattern of "signal handler sets a flag, main loop checks it."
**Trade-off:** Two goroutines now coordinate; race conditions appear if `runServer` doesn't actually check `shutdown`. The escalation path (`os.Exit(1)` on second signal) bypasses `defer`s — files may not flush. Document this is intentional: second SIGTERM = "I really mean it."
**When NOT:** CLI tools where shutdown is < 100 ms — keep it inline. Code where signals are advisory only (e.g. SIGHUP for reload, not exit). Tools needing exact control over which signals trigger which paths — a switch over signal type is clearer than a generic channel close.
</details>

---

## 12. Exercise 11 — Default `GOMAXPROCS` in container with CPU quota

A service runs in a Kubernetes pod with `cpu: 2` (200ms of CPU per 100ms wall). Go's default `GOMAXPROCS` reads from `nproc` on the host — say 64 — so Go spawns 64 Ps. The scheduler thinks it has 64 cores; CFS throttles the process to 2 cores' worth; latency spikes 10× under load as goroutines wait for quota replenishment.

```go
// no GOMAXPROCS set; defaults to runtime.NumCPU() = 64 (host CPUs)
func main() { http.ListenAndServe(":8080", handler) }
```

```
$ kubectl exec pod -- ./service & ; kubectl exec pod -- wrk -t 32 -c 1000 http://localhost:8080/
Throttled: 87% of intervals
Latency p99: 420 ms (limit: 50 ms target)
```

<details><summary>After</summary>

Use `go.uber.org/automaxprocs` (or, in Go 1.25+, the built-in cgroup-aware default). It reads the container's CPU quota from `/sys/fs/cgroup/cpu.cfs_quota_us` and sets `GOMAXPROCS` accordingly.

```go
import _ "go.uber.org/automaxprocs" // sets GOMAXPROCS from cgroup quota at init time

func main() { http.ListenAndServe(":8080", handler) }
// Log line at startup: "maxprocs: Updating GOMAXPROCS=2: determined from CPU quota"
```

```
$ kubectl exec pod -- wrk -t 32 -c 1000 http://localhost:8080/
Throttled: 4% of intervals
Latency p99: 38 ms
```

p99 latency drops from 420 ms to 38 ms; throttling drops from 87% to 4%.

**Why faster:** With `GOMAXPROCS=64` in a 2-CPU container, the Go scheduler dispatches 64 runnable goroutines simultaneously, expecting parallel execution. The Linux CFS scheduler immediately throttles after the quota is exhausted, parking the entire process. The goroutines now wait not for I/O but for *kernel quota replenishment* — which arrives only at the next 100 ms boundary. Setting `GOMAXPROCS=2` lets Go dispatch only what the kernel will allow to run, keeping the scheduler's view consistent with reality. Context switches drop, throttling vanishes.
**Trade-off:** `automaxprocs` reads cgroup info at init; if quota changes dynamically (vertical pod autoscaling), the value is stale. Set via `runtime.GOMAXPROCS(n)` at config-reload time if needed. Fractional quotas round down (`cpu: 1.5` → `GOMAXPROCS=1`); some workloads prefer to round up — pass a custom rounder.
**When NOT:** Bare-metal or VMs with no CPU limits — default is correct. Go 1.25+ where the runtime itself reads cgroups — `automaxprocs` becomes redundant (still safe to keep for older Go versions). Workloads CPU-bound enough that `GOMAXPROCS=1` would underutilize a 2-quota — measure both ways.
</details>

---

## 13. Exercise 12 — Stack growth thrashing for deep recursion

A recursive parser handles deeply nested JSON (60 levels). Go's goroutine stacks start at 2 KB and grow by doubling on overflow. A 60-deep recursion triggers 5-6 growth events per parse, each one a stop-the-world stack copy with all pointers rewritten. Profile shows `runtime.morestack_noctxt` at 12% of CPU.

```go
func parse(d *json.Decoder, depth int) (any, error) {
    tok, err := d.Token(); if err != nil { return nil, err }
    switch tok {
    case json.Delim('{'):
        m := map[string]any{}
        for d.More() {
            k, _ := d.Token()
            v, err := parse(d, depth+1) // recurses 60 levels for deep payloads
            if err != nil { return nil, err }
            m[k.(string)] = v
        }
        d.Token(); return m, nil
    // ... arrays, primitives ...
    }
    return tok, nil
}
```

```
$ go tool pprof -top cpu.prof
runtime.morestack_noctxt: 12% (320 ms / 2.6 s)
runtime.copystack: 8% (210 ms / 2.6 s)
```

<details><summary>After</summary>

Convert to an explicit-stack iterative parser. The runtime stack stays at the initial 2 KB; a heap-allocated `[]frame` slice holds the state machine. Profile shows `morestack` near zero.

```go
type frame struct { kind byte; m map[string]any; a []any; key string }

func parse(d *json.Decoder) (any, error) {
    var stack []frame
    var cur any
    for {
        tok, err := d.Token()
        if err == io.EOF { return cur, nil }
        if err != nil { return nil, err }
        switch t := tok.(type) {
        case json.Delim:
            if t == '{' { stack = append(stack, frame{kind: '{', m: map[string]any{}}); continue }
            if t == '[' { stack = append(stack, frame{kind: '['}); continue }
            // closing brace: pop and attach to parent
            top := stack[len(stack)-1]; stack = stack[:len(stack)-1]
            val := any(top.m); if top.kind == '[' { val = top.a }
            if len(stack) == 0 { cur = val; continue }
            attach(&stack[len(stack)-1], val)
        default:
            attach(&stack[len(stack)-1], t)
        }
    }
}
```

```
$ go tool pprof -top cpu.prof
runtime.morestack_noctxt: 0.3% (8 ms / 2.6 s)
Total parse time: 2.1 s (down from 2.6 s)
```

~20% faster, stack-growth overhead eliminated.

**Why faster:** Go's stack-growth strategy doubles capacity by allocating a new stack, copying frames, and rewriting all pointers that point into the old stack — a stop-the-world operation per goroutine. Deep recursion that grows 2 KB → 4 KB → 8 KB → 16 KB → 32 KB → 64 KB pays five copies. The iterative version uses a single goroutine stack of constant size and an `append`-grown `[]frame` slice that doubles in heap memory once (cheap, no pointer rewriting). `runtime/debug.SetMaxStack` can *cap* per-goroutine stacks to fail fast on runaway recursion (1 GB default is huge), but it doesn't reduce per-grow cost — it's a safety net, not a performance fix.
**Trade-off:** Iterative parsers are harder to read; state-machine bookkeeping replaces natural call/return. Tests must cover the closing-delimiter paths separately. Don't confuse `SetMaxStack` with a performance lever — it's only for catching infinite recursion before it OOMs.
**When NOT:** Recursion depths < 16 — stack growth cost is invisible. Code where readability of the recursive form beats marginal speed (compilers, evaluators with many node types). Cases where a `sync.Pool` of buffers solves the allocation side and the stack growth is a one-time cost per goroutine, not per call.
</details>

---

## 14. Exercise 13 — Static binary 50MB

A microservice's `go build` produces a 52 MB binary. The Docker image is 380 MB after adding distroless base + binary. Cold-start time on Kubernetes pulls the image over the network; pulls take 4-8 s, dwarfing the 200 ms boot. The binary includes DWARF debug info, symbol tables, and absolute build paths.

```
$ go build -o service ./cmd/service
$ ls -lh service
-rwxr-xr-x  52M  service
$ file service
service: ELF 64-bit LSB executable, ..., not stripped
```

<details><summary>After</summary>

Strip debug info and symbol tables with `-ldflags="-s -w"` and rewrite build paths with `-trimpath`. For further reduction, use `upx` (compression) — but it interferes with `pprof` profiling and some kernel security checks.

```
$ go build -ldflags="-s -w" -trimpath -o service ./cmd/service
$ ls -lh service
-rwxr-xr-x  18M  service
$ file service
service: ELF 64-bit LSB executable, ..., stripped

$ upx --best service  # optional, halves again
$ ls -lh service
-rwxr-xr-x  6.2M  service
```

Binary drops from 52 MB to 18 MB (or 6.2 MB with UPX). Image pull time drops from 8 s to 1.5 s.

**Why smaller:** `-s` strips the symbol table (saves ~10-15% for typical services), `-w` strips DWARF debug info (saves ~25-30%). Together they remove information needed by `gdb`, line-number reporting in stack traces stays intact via Go's own pcln tables. `-trimpath` removes absolute file paths (`/home/builder/foo/bar.go` → `foo/bar.go`), which both shrinks the binary marginally and improves reproducibility. UPX compresses the executable; the kernel decompresses on load (~50 ms one-time cost).
**Trade-off:** Stripped binaries lose `gdb` source debugging — but `delve` still works against an unstripped sibling artifact. Crash dumps from production are harder to symbolicate; keep an unstripped binary in your release artifacts and pass `--symbols` to the symbolicator. UPX-compressed binaries trigger AV false positives, can't be `mmap`-shared between processes, and break `pprof`'s ability to read embedded symbols.
**When NOT:** Development builds — keep symbols and DWARF for `delve` to work. Binaries shipped to customers who run `gdb` on them. CGo-heavy binaries where stripping helps less (C symbols obey their own rules). Codebases using `runtime.Caller` to extract function names — works either way but worth verifying.
</details>

---

## 15. Exercise 14 — Cold-start latency

A latency-critical API's first 1000 requests after deploy run 2-3× slower than steady-state. The Go compiler chose generic inlining heuristics at build time; the hot paths under real traffic don't match the compiler's default cost model. Cold start p99: 280 ms; warm p99: 95 ms.

```
$ go build -o api ./cmd/api
$ ./api &
$ for i in $(seq 1 1000); do curl http://localhost:8080/predict; done | latency-cdf
First 100 reqs: p99 = 280 ms
After 5k reqs:  p99 = 95 ms   # steady-state
```

<details><summary>After</summary>

Use Profile-Guided Optimization (PGO, Go 1.20+): capture a representative `cpu.pprof` from production, commit it as `default.pgo`, rebuild. The compiler now inlines and devirtualizes based on real call-frequency data.

```
# 1. Capture a profile from prod (under realistic load, 30-60 s)
$ go tool pprof -proto -seconds=30 http://prod-host:6060/debug/pprof/profile > default.pgo

# 2. Place at ./cmd/api/default.pgo (go automatically picks it up)
$ ls ./cmd/api/default.pgo
default.pgo

# 3. Build — PGO triggers automatically
$ go build -o api ./cmd/api
$ ./api -pgo-enabled
```

```
$ for i in $(seq 1 1000); do curl http://localhost:8080/predict; done | latency-cdf
First 100 reqs: p99 = 110 ms   # 2.5× faster cold
After 5k reqs:  p99 = 76 ms    # 20% faster warm too
```

Cold p99 drops from 280 ms to 110 ms; warm also improves from 95 ms to 76 ms.

**Why faster:** PGO feeds runtime call-frequency data back into the compiler. Without it, Go uses a static cost model (function size, parameter count) to decide inlining — which guesses wrong for cold paths that turn out to be hot, and over-inlines paths that turn out to be cold. PGO also enables devirtualization: when the profile shows that an interface call resolves to one concrete type 95% of the time, the compiler emits a direct call with a type check + fallback, dodging the itab lookup. Cold start improves because PGO-optimized inlining brings hot code closer together, improving I-cache locality immediately rather than after the branch predictor warms up.
**Trade-off:** Profile must be representative — a profile from a synthetic benchmark optimizes for the wrong workload. Profile drift over months degrades PGO benefits; re-capture quarterly. Build time grows ~5-10% with PGO enabled. Profile data leaks information about prod call patterns; treat `default.pgo` like a secret in regulated environments.
**When NOT:** Codebases without representative production profiles (early stage, pre-launch). Code where ~10% speedup isn't worth the profile-management workflow. Heavily reflection-driven code (ORMs, codec libraries) where PGO has less to optimize. Binaries shipped to users with diverse workloads where one PGO profile would be wrong for most.
</details>

---

## 16. When NOT to optimize

Runtime architecture cost dominates only when you're at scale: high RPS, large heaps, container limits, low-latency targets, or large binaries deployed frequently. If your service serves 10 RPS, has 50 MB heap, runs on a single VM, and the binary is built once a quarter, every optimization here is irrelevant. Premature runtime tuning is the cardinal sin of Go: the language is designed to be fast enough out of the box. Profile first.

**Profile first.** Runtime overhead has six signatures:
- `runtime.mallocgc` hot → Ex. 3 (object pool) or Ex. 7 (interface boxing).
- `runtime.gcBgMarkWorker` > 10% CPU → Ex. 5 (GOMEMLIMIT) or Ex. 3.
- `runtime.morestack_noctxt` > 1% CPU → Ex. 12 (iterative recursion).
- `runtime.cgocall` hot → Ex. 4 (batch cgo) or Ex. 9 (drop LockOSThread).
- `runtime.findrunnable` > 5% CPU → Ex. 2 (worker pool) or Ex. 11 (GOMAXPROCS).
- Goroutine count growing unboundedly → Ex. 2.

**Common premature optimizations:** lazy-init (Ex. 1) on CLI tools that run for seconds; worker pools (Ex. 2) at 100 RPS where unbounded `go` works fine; object pools (Ex. 3) for items < 32 B; cgo batching (Ex. 4) for already-amortized cgo paths; `GOMEMLIMIT` (Ex. 5) on services with stable heaps; `FreeOSMemory` (Ex. 6) on services where RSS doesn't matter to ops; generics-over-interface (Ex. 7) when iface dispatch isn't in the profile; value maps (Ex. 8) for values > 128 B; removing `LockOSThread` (Ex. 9) without auditing the C side first; PGO (Ex. 14) without a representative profile.

**Correctness gaps disguised as optimizations:** lazy-init (Ex. 1) that hides config errors until first traffic; worker pool (Ex. 2) without cancellation, running jobs after client disconnect; pooled objects (Ex. 3) without reset, leaking data across requests/tenants; batched cgo (Ex. 4) without per-item error reporting; `GOMEMLIMIT` (Ex. 5) set too tight, thrashing GC; `FreeOSMemory` (Ex. 6) called in a hot loop, hammering the kernel with `madvise` calls; generic-typed metrics (Ex. 7) that lose runtime polymorphism the code depended on; value-map mutation (Ex. 8) where `m[k].field = v` silently fails; removed `LockOSThread` (Ex. 9) where the C library actually had TLS; signal handler (Ex. 10) doing real work and dropping the second SIGTERM; `automaxprocs` (Ex. 11) reading a stale quota after VPA resize; iterative parser (Ex. 12) with off-by-one on closing delimiters; stripped binary (Ex. 13) that can't be symbolicated on crash; stale PGO profile (Ex. 14) optimizing for last quarter's traffic shape.

---

## 17. Summary

**Always-ship wins** (default in any new Go service): clean `init()` blocks (Ex. 1) — declare defaults, register handlers, no I/O; bounded worker pools (Ex. 2) for any per-request background work; `automaxprocs` import (Ex. 11) for containerized services; `-ldflags="-s -w" -trimpath` (Ex. 13) on all release builds; signal handler delegates to a goroutine (Ex. 10); audit `LockOSThread` usage (Ex. 9) — remove unless the C side has TLS.

**Wins behind a profile** (when measurements justify them): object pools (Ex. 3, when `mallocgc` shows on hot path); batch cgo (Ex. 4, when `cgocall` shows); `GOMEMLIMIT` (Ex. 5, when `gcBgMarkWorker` shows > 10% CPU); `FreeOSMemory` (Ex. 6, when RSS regression alerts after batch jobs); generics over `interface{}` (Ex. 7, when boxing shows in alloc profile); value-typed maps (Ex. 8, when pointer-chase stalls show in cache profile); iterative recursion (Ex. 12, when `morestack` shows); PGO (Ex. 14, when cold-start latency matters).

**Specialty** (only when the design calls for it): `debug.SetMaxStack` (Ex. 12) as a safety net for runaway recursion in untrusted plugin code; UPX compression (Ex. 13) for edge deployments where image-pull time dominates and `pprof` isn't needed in prod; dynamic `runtime.GOMAXPROCS` adjustment for VPA-resized pods (Ex. 11 follow-on); custom arena allocators for parse-heavy services (out of scope here — see the Composite optimize doc).

Go runtime cost is scheduling, allocation, GC pacing, cgo overhead, container-OS coupling, and binary layout. Strip those from the steady-state and cold-start paths by choosing the right primitive: bounded pools instead of unbounded `go`; typed containers instead of `interface{}`; batch boundaries at cgo edges; `GOMEMLIMIT` and `automaxprocs` so the runtime and the kernel agree on resources; stripped binaries with PGO for fast cold starts. The runtime is fast by default — the wins come from matching its model to your deployment shape. Profile, identify which of the six signatures fires, then pick the corresponding lever.
