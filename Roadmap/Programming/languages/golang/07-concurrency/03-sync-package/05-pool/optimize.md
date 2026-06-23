# sync.Pool — Optimization Exercises

> Each exercise gives you a working but suboptimal program, a target metric, and asks you to improve. Solutions are at the end. The goal is to internalise the cost model of `sync.Pool` and apply it when tuning.

---

## Easy

### Exercise 1 — Reduce `allocs/op` to 0 in the hot path

**Starting code.**

```go
package buf

import (
    "fmt"
    "strconv"
)

func RenderID(id int) string {
    return fmt.Sprintf("id-%d", id)
}
```

**Baseline.** `go test -bench BenchmarkRenderID -benchmem` reports ~3 allocs/op (fmt allocates an internal buffer, an interface, and the result string).

**Target.** ≤ 1 alloc/op (just the result string). Use a pooled `*bytes.Buffer` plus `strconv.Itoa`.

---

### Exercise 2 — Drop oversized buffers before `Put`

**Starting code.**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func Process(input []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.Write(input)
    return buf.String()
}
```

**Baseline.** Under traffic with occasional 50 MB `input`, RSS grows past 1 GB.

**Target.** Cap pool memory at ~64 MB total. Drop buffers larger than 1 MB before `Put`.

---

### Exercise 3 — Eliminate the type assertion via generics

**Starting code.** Same as Exercise 2.

**Issue.** Every `Get` does `.(*bytes.Buffer)`. Tedious; one missing assertion = panic.

**Target.** Wrap `sync.Pool` with a generic `Pool[T]` so callers write `buf := bufPool.Get()` without an assertion.

---

### Exercise 4 — Warm the pool to avoid first-request latency

**Starting code.**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func main() {
    server := http.Server{Handler: handler}
    server.ListenAndServe()
}
```

**Baseline.** The first burst of requests after startup pays `New` cost (which involves a tiny `make` per request).

**Target.** Pre-fill the pool with ~16 buffers at startup so warm-up cost is paid once, not per request.

---

### Exercise 5 — Replace `sync.Pool` with `strings.Builder` zero-alloc path

**Starting code.**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func Fmt(name string, n int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString(name)
    buf.WriteByte(':')
    buf.WriteString(strconv.Itoa(n))
    return buf.String()
}
```

**Baseline.** Pool overhead per call: ~10 ns. Allocs: 1 (the result string).

**Target.** Test whether replacing the pool with `var sb strings.Builder` (stack-allocated, no escape) achieves the same result with no pool. Verify via `-gcflags="-m"` that nothing escapes. If stack-allocation works, the pool is dead weight.

---

## Medium

### Exercise 6 — Reduce per-P pool bloat under high `GOMAXPROCS`

**Starting code.**

```go
var decPool = sync.Pool{
    New: func() any { return &Decoder{scratch: make([]byte, 64<<10)} },
}
```

**Symptom.** On a 64-core box, `pprof` shows the pool holds ~256 `Decoder` instances (4 per P × 64 Ps × victim cache doubling), each with a 64 KB scratch = ~16 MB.

**Target.** Reduce peak pool memory. Options: lazy-allocate `scratch` only when needed, share scratch among decoders (with mutex), or split into a `Decoder` pool plus a separate `scratch` pool.

---

### Exercise 7 — Pool a `*gzip.Writer` correctly across writers

**Starting code.**

```go
var gzPool = sync.Pool{
    New: func() any { return gzip.NewWriter(nil) }, // nil writer — panics on use
}

func compress(out io.Writer, data []byte) error {
    gz := gzPool.Get().(*gzip.Writer)
    defer gzPool.Put(gz)
    gz.Write(data) // BUG: writes to nil
    return gz.Close()
}
```

**Symptom.** Nil pointer panic on first use.

**Target.** Initialise with `io.Discard`; rebind to the real writer via `gz.Reset(out)` before use. Show that the corrected version benchmarks ~10x faster than constructing a fresh `gzip.Writer` per call.

---

### Exercise 8 — Choose between `sync.Pool` and a channel pool for 100 K RPS

**Starting code.** A service processes 100 K RPS, each request needing one 4 KB scratch buffer. You have two prototypes:

1. `sync.Pool` of `*[4096]byte`.
2. `chan *[4096]byte` with capacity 256.

**Target.** Decide which to use. Benchmark both:

- `go test -bench . -cpu 1,4,16,64`
- Memory under burst: 200 K simultaneous in-flight requests.
- p99 latency.

Justify the choice based on the numbers.

---

### Exercise 9 — Eliminate redundant `Reset` work

**Starting code.**

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func putBuf(buf *bytes.Buffer) {
    buf.Reset()
    bufPool.Put(buf)
}

func handler(w http.ResponseWriter, r *http.Request) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer putBuf(buf)
    buf.Reset() // Reset already done by previous put? or by New?
    // ...
}
```

**Issue.** `Reset` is called both before `Put` and after `Get`. One of them is redundant.

**Target.** Decide which to keep. Argue for your choice based on:

- What `New` returns (an unset, empty buffer).
- Whether callers can assume "freshly `Get`-ed buffer is clean."
- Error-recovery paths (e.g., a panic between `Get` and `Reset`).

---

### Exercise 10 — Detect pool degradation in production

**Starting code.** A service uses `sync.Pool` for response buffers. Over the last week, RPS grew 3x and p99 latency rose by 8 ms. Suspicion: pool degradation.

**Target.** Design instrumentation that exposes:

- `Gets / sec`
- `Puts / sec`
- `Misses / sec` (calls to `New`)
- Approximate `Hit rate = (Gets - Misses) / Gets`

Plot `Hit rate` over time. If it dropped from 99% to 80%, you have a real signal. Then decide what to do (increase pool retention via `GOGC++`, split pools by size class, ...).

---

## Hard

### Exercise 11 — Build a per-size sharded pool

**Starting code.** A single `sync.Pool` of `*bytes.Buffer`. Profile shows the pool serves buffers of widely varying sizes: ~50% are < 1 KB, ~30% are 1-16 KB, ~20% are 16-256 KB.

**Issue.** A small-buffer caller may receive a 256 KB buffer; a large-buffer caller may receive a 1 KB buffer and immediately grow it (allocating).

**Target.** Build a "tiered pool" that holds three sub-pools:

```go
type tieredPool struct {
    small  sync.Pool // < 4 KB
    medium sync.Pool // 4 KB - 64 KB
    large  sync.Pool // 64 KB - 1 MB
}

func (p *tieredPool) Get(estimated int) *bytes.Buffer { ... }
func (p *tieredPool) Put(buf *bytes.Buffer) { ... }
```

`Put` decides which tier based on `Cap()`. Drop > 1 MB. Benchmark vs single-pool.

---

### Exercise 12 — Remove a pool that no longer helps

**Starting code.** Three years ago, someone added a `sync.Pool` for a struct `*Foo`. Profile today shows:

- `Foo` is allocated ~100 times per second.
- The pool's hit rate is ~10% (`New` is called 90 times per second).

**Target.** Argue that the pool is dead weight. Steps:

1. Confirm the metrics with `pprof -alloc_objects`.
2. Calculate the actual savings: 100 RPS * 10% hit rate = 10 saved allocations/sec. Negligible.
3. Remove the pool. Run benchmarks before and after.
4. Verify production metrics (heap, GC, p99) are unchanged.
5. Write the commit message.

---

### Exercise 13 — Pool the encoder but not the buffer

**Starting code.**

```go
type Encoder struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var encPool = sync.Pool{
    New: func() any {
        b := new(bytes.Buffer)
        return &Encoder{buf: b, enc: json.NewEncoder(b)}
    },
}
```

**Issue.** The buffer is tightly coupled to the encoder. If callers occasionally encode 100 MB payloads, the buffer bloats, and the entire `Encoder` carries that memory. Splitting buffer and encoder lets you replace the buffer when it grows too large.

**Target.** Two separate pools (`*json.Encoder` and `*bytes.Buffer`). On each request, `Get` one of each, bind them temporarily, encode, then return both — but drop the buffer if `Cap() > 1 MB`.

This is harder than it looks: `json.Encoder` is bound to its writer at construction. You need a wrapper that allows re-binding.

---

### Exercise 14 — Use `runtime_procPin` for an unsafe but very fast pool

**Background.** `runtime_procPin` (linkname-imported from `runtime`) pins the current goroutine to its P and returns the P's ID. With this, you can build a per-P array-backed pool with no atomics.

**Starting code.** A `sync.Pool` measured at 8 ns per `Get`/`Put` on the fast path. Can you do better with a manual per-P array?

**Target.** Build an unsafe pool using `procPin`/`procUnpin`. Benchmark vs `sync.Pool`. Discuss why this is fragile (no GC eviction; no victim cache; assumes Ps do not change) and when, if ever, it is worth the trade-off.

**Warning.** This exercise touches `unsafe` and runtime internals. The result is rarely used in production. The point is to understand what `sync.Pool` is doing under the hood by trying to beat it.

---

### Exercise 15 — Pool that gracefully degrades under memory pressure

**Goal.** Build a pool that releases items proactively when the process's RSS approaches a limit (e.g. 80% of `GOMEMLIMIT`).

**Approach.** Subscribe to GC notifications via `runtime/debug.SetGCPercent` or `runtime.MemStats`. On each GC, if memory pressure is high, force-evict the pool. Otherwise let `sync.Pool` work normally.

**Implementation.** Wrap `sync.Pool` with a `Drain()` method that takes the lock and clears all stored items. Trigger from a background goroutine that polls `runtime.ReadMemStats` once per second.

**Constraint.** The pool must still be lock-free on the fast path. Only the drain path takes a lock.

---

## Solutions Outline

### Solution 1 — `allocs/op` to 0

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func RenderID(id int) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    buf.WriteString("id-")
    buf.WriteString(strconv.Itoa(id))
    return buf.String()
}
```

Result: 1 alloc/op (the returned string is unavoidable without `unsafe`).

### Solution 2 — Cap pool memory

```go
const maxBufCap = 1 << 20

func Process(input []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < maxBufCap {
            bufPool.Put(buf)
        }
    }()
    buf.Reset()
    buf.Write(input)
    return buf.String()
}
```

### Solution 3 — Generic wrapper

(See `tasks.md` Task 7 for full code.)

### Solution 4 — Pre-warm

```go
func init() {
    for i := 0; i < 16; i++ {
        bufPool.Put(new(bytes.Buffer))
    }
}
```

But: GC may evict before first request. A more robust solution is to call `New` lazily; pre-warming is mostly a placebo unless requests arrive immediately after init.

### Solution 5 — `strings.Builder`

```go
func Fmt(name string, n int) string {
    var sb strings.Builder
    sb.Grow(len(name) + 12)
    sb.WriteString(name)
    sb.WriteByte(':')
    sb.WriteString(strconv.Itoa(n))
    return sb.String()
}
```

Check with `go build -gcflags="-m"`. If `sb` does not escape, this beats the pool. Often it does — and the pool was indeed dead weight.

### Solution 6 — Reduce per-P bloat

Option A: lazy scratch allocation.

```go
type Decoder struct {
    scratch []byte
}

func (d *Decoder) ensureScratch(n int) {
    if cap(d.scratch) < n {
        d.scratch = make([]byte, n)
    }
}

func (d *Decoder) Reset() {
    if cap(d.scratch) > 64<<10 {
        d.scratch = nil // let it shrink
    } else {
        d.scratch = d.scratch[:0]
    }
}
```

Option B: split the pool, share scratch.

### Solution 7 — gzip Reset

```go
var gzPool = sync.Pool{
    New: func() any { return gzip.NewWriter(io.Discard) },
}

func compress(out io.Writer, data []byte) error {
    gz := gzPool.Get().(*gzip.Writer)
    gz.Reset(out)
    defer gzPool.Put(gz)
    if _, err := gz.Write(data); err != nil {
        return err
    }
    return gz.Close()
}
```

Benchmark vs `gzip.NewWriter(out)`: typically 5-10x faster because the construction allocates several KB.

### Solution 8 — `sync.Pool` vs channel

Channel pool benchmark numbers (typical, 64 cores):

- `sync.Pool`: 8 ns/op, no contention scaling penalty.
- `chan` pool with cap 256: 60 ns/op single-thread, 200+ ns/op at 64-core contention.

Decision: `sync.Pool` wins for raw speed. The channel pool only wins if you need a strict cap or if the per-allocation cost is so high that 60 ns is invisible compared to it.

### Solution 9 — Where to `Reset`

Keep `Reset` after `Get`, not before `Put`. Reasons:

- The caller knows immediately whether the buffer is dirty.
- A panic between `Get` and `Reset` is still safe (defer `Put` runs; next `Get`-er resets).
- It localises the convention to one place: "after `Get`, reset."
- Removes the question of who owns the `Reset` call.

### Solution 10 — Production instrumentation

Wrap with a custom `Pool` type that maintains atomic counters:

```go
type Counted struct {
    inner    sync.Pool
    gets     atomic.Int64
    puts     atomic.Int64
    misses   atomic.Int64
}

func NewCounted(newFn func() any) *Counted {
    c := &Counted{}
    c.inner.New = func() any {
        c.misses.Add(1)
        return newFn()
    }
    return c
}

func (c *Counted) Get() any { c.gets.Add(1); return c.inner.Get() }
func (c *Counted) Put(v any) { c.puts.Add(1); c.inner.Put(v) }

// expose via /debug/vars or Prometheus:
func (c *Counted) Stats() (gets, puts, misses int64) {
    return c.gets.Load(), c.puts.Load(), c.misses.Load()
}
```

### Solution 11 — Tiered pool

```go
type tieredPool struct {
    small, medium, large sync.Pool
}

func (p *tieredPool) Get(estimated int) *bytes.Buffer {
    switch {
    case estimated < 4<<10:
        return p.small.Get().(*bytes.Buffer)
    case estimated < 64<<10:
        return p.medium.Get().(*bytes.Buffer)
    default:
        return p.large.Get().(*bytes.Buffer)
    }
}

func (p *tieredPool) Put(buf *bytes.Buffer) {
    c := buf.Cap()
    switch {
    case c < 4<<10:
        p.small.Put(buf)
    case c < 64<<10:
        p.medium.Put(buf)
    case c < 1<<20:
        p.large.Put(buf)
    default:
        // drop, too big
    }
}
```

Benchmark vs single-pool: typically a small win (~5-15%) when traffic is genuinely multi-modal. If traffic is unimodal, tiered pool is slightly worse due to branching overhead.

### Solution 12 — Remove the pool

```go
// Commit message:
// Remove dead sync.Pool for *Foo
//
// Profiler shows 100 RPS allocation rate with 10% pool hit rate -
// effectively zero savings. Direct allocation is simpler and equally fast.
// Heap and p99 unchanged in canary deploy. No regression in 7-day prod metrics.
```

### Solution 13 — Split encoder and buffer

```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func encode(v any) ([]byte, error) {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() {
        if buf.Cap() < 1<<20 {
            bufPool.Put(buf)
        }
    }()
    buf.Reset()
    enc := json.NewEncoder(buf) // construct per call, cheap
    if err := enc.Encode(v); err != nil {
        return nil, err
    }
    return bytes.Clone(buf.Bytes()), nil
}
```

In practice, constructing a `json.Encoder` per call is cheap (only the struct, no large internal buffers). Pooling the encoder is rarely worth the coupling. Pool the buffer instead.

### Solution 14 — `procPin` pool

Skipped — see Go standard library `internal/runtime/atomic` and runtime tests for examples. The exercise is for advanced readers only. Result: ~3 ns per op, but loses GC eviction.

### Solution 15 — Memory-aware pool

```go
type Drainable struct {
    pool sync.Pool
    drain chan struct{}
}

func NewDrainable(newFn func() any) *Drainable {
    d := &Drainable{
        pool: sync.Pool{New: newFn},
        drain: make(chan struct{}, 1),
    }
    go d.watch()
    return d
}

func (d *Drainable) watch() {
    t := time.NewTicker(1 * time.Second)
    defer t.Stop()
    var ms runtime.MemStats
    for range t.C {
        runtime.ReadMemStats(&ms)
        if int64(ms.HeapAlloc) > memLimit*80/100 {
            d.Drain()
        }
    }
}

func (d *Drainable) Drain() {
    // sync.Pool has no public Drain. Workaround: re-create.
    d.pool = sync.Pool{New: d.pool.New}
}
```

Caveat: `d.pool = ...` is itself a race with `Get`/`Put`. A safer real-world implementation uses `atomic.Pointer[sync.Pool]` and swaps the pointer.

---

## Reflection

The recurring theme across these exercises is **measure first**. Most pool optimisation is "do we even need this pool" disguised as "make the pool faster." A 10-line `BenchmarkX` with `-benchmem` is the most valuable tool. The second most valuable is `go build -gcflags="-m"` to see escape analysis.

The second theme is **bound the worst case**. Pools without capacity guards eventually OOM in production. The five lines of `if buf.Cap() < maxCap` are not optional in any pool that holds variable-size objects.

The third theme is **monitor in production**. A pool that worked great in benchmarks may fail under real traffic patterns. Hit-rate instrumentation, exposed as `expvar` or Prometheus, costs almost nothing and pays back the first time you investigate a latency regression.
