---
layout: default
title: sync.Pool Internals — Optimize
parent: sync.Pool Internals
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/03-sync-pool-internals/optimize/
---

# sync.Pool Internals — Optimize

[← Back](../)

> Concrete scenarios where pooling is the right answer and scenarios where it is the wrong one. All with numbers.

---

## Scenario 1 — Pooling JSON encoder state

**Before:**
```go
func encodeAll(items []Item) [][]byte {
    out := make([][]byte, len(items))
    for i, x := range items {
        var buf bytes.Buffer
        json.NewEncoder(&buf).Encode(x)
        out[i] = append([]byte(nil), buf.Bytes()...)
    }
    return out
}
```

Each iteration allocates a `bytes.Buffer`, a `json.Encoder`, and a result slice. For 1000-item batches, that is 3000+ allocations per call.

**After:**
```go
var encPool = sync.Pool{
    New: func() any {
        b := &bytes.Buffer{}
        return &struct {
            buf *bytes.Buffer
            enc *json.Encoder
        }{b, json.NewEncoder(b)}
    },
}

func encodeAll(items []Item) [][]byte {
    out := make([][]byte, len(items))
    e := encPool.Get().(*struct {
        buf *bytes.Buffer
        enc *json.Encoder
    })
    defer encPool.Put(e)
    for i, x := range items {
        e.buf.Reset()
        e.enc.Encode(x)
        out[i] = append([]byte(nil), e.buf.Bytes()...)
    }
    return out
}
```

**Result.** On a real microservice: 65 µs → 18 µs per batch of 100 items; 12 → 2 allocations per item (the result copy and the slice header). The encoder is the expensive thing — its internal type cache survives across calls.

---

## Scenario 2 — Don't pool tiny things

**Before:**
```go
var coordPool = sync.Pool{New: func() any { return &Coord{} }}

func newCoord(x, y int) *Coord {
    c := coordPool.Get().(*Coord)
    c.X, c.Y = x, y
    return c
}
```

**Why this is wrong.** `Coord` is 16 bytes. The pool overhead — `pin`, `unpin`, type assertion, potential CAS — is ~5-20 ns. The allocator can produce a 16-byte object in ~2 ns; the GC of a short-lived 16-byte object is essentially free (lives and dies in the young generation).

**After:**
```go
func newCoord(x, y int) Coord { return Coord{X: x, Y: y} }
```

**Result.** 3-5× faster, zero allocations (escape analysis keeps it on the caller's stack).

**Rule of thumb.** Pool objects above ~200 bytes, or with non-trivial constructor cost. Below that, the allocator wins.

---

## Scenario 3 — Pool with explicit cap

**Before:**
```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

A long-lived buffer that briefly grew to 10 MB sits in the pool, holding 10 MB until the next two GCs.

**After:**
```go
const maxRetain = 64 * 1024

var bufPool = sync.Pool{New: func() any {
    return bytes.NewBuffer(make([]byte, 0, 4096))
}}

func putBuf(b *bytes.Buffer) {
    if b.Cap() > maxRetain {
        return // let GC reclaim it
    }
    b.Reset()
    bufPool.Put(b)
}
```

**Result.** Eliminates the "one giant request blows up the pool" failure mode. Long-tail latency drops.

---

## Scenario 4 — Channel of buffers vs sync.Pool

**Before:**
```go
var jobs = make(chan *Job, 100)
```

The channel acts as a bounded pool: producers block if all 100 jobs are in flight.

**Question.** Should we replace `chan *Job` with `sync.Pool`?

**Answer.** Depends on intent. If the channel is providing *backpressure* (producer should slow down when consumer is overloaded), keep it — `sync.Pool` does not block. If the channel is just a free list with no backpressure logic, switch to `sync.Pool` for higher throughput.

**Benchmark on 16 cores, no contention:**
- Channel: 95 ns/op
- Pool: 7 ns/op (fast path) / 35 ns/op (slow path)

The channel pays for an atomic + a mutex on every operation. The pool's fast path is just a pointer load and clear.

---

## Scenario 5 — Pool warm-up at startup

**Before:**
```go
func main() {
    go server.Run()
}
```

First N requests pay the `New` cost for every pooled object.

**After:**
```go
func main() {
    // Pre-warm: estimate concurrency, populate pool.
    warm := runtime.GOMAXPROCS(0) * 4
    for i := 0; i < warm; i++ {
        bufPool.Put(bufPool.New().(*bytes.Buffer))
    }
    go server.Run()
}
```

**Result.** Cold-start latency for the first batch of requests drops by 30-50%. Steady-state behavior is unchanged because the pool would have filled itself anyway.

---

## Scenario 6 — Reduce GC frequency to keep the pool warm

**Before.** GC every 250ms; pool hit rate 60%.

**Change.** Set `GOGC=200` (double the heap target before GC) or use `debug.SetGCPercent(200)`.

**After.** GC every 500ms; pool hit rate 85%.

**Tradeoff.** Heap is 2× larger at the GC trigger point. For services where RSS is not the bottleneck, this is a free 30-40% throughput improvement.

**When to consider.** If `runtime/metrics` `/sched/pauses/total/gc` is more than 1% of total time, or if your pool's miss rate correlates with GC events.

---

## Scenario 7 — Local pool field on a hot-path struct

**Before:** All callers share `var bufPool sync.Pool`.

**After:** Each long-lived `*Service` owns its own `sync.Pool`, with the buffer pre-tuned for that service's typical payload size.

**Why.** Two reasons:
1. Pools have a *one-time* `pinSlow` cost. Many small pools have many costs; one big pool has one.
2. Per-service tuning: a small-payload service can use 1 KB buffers; a streaming service can use 64 KB buffers.

The tradeoff: more pool instances means more GC walks at `poolCleanup` (linear in number of pools). For < 100 pools per process, this is invisible.

---

## Scenario 8 — Pooling regex.MatchString state

**Before:**
```go
func isValid(s string) bool {
    return regexp.MustCompile(`^[a-z]+$`).MatchString(s)
}
```

Re-compiles the regex on every call. Catastrophic.

**After:**
```go
var validRe = regexp.MustCompile(`^[a-z]+$`)

func isValid(s string) bool { return validRe.MatchString(s) }
```

**Even better, for stateful regex use:**
```go
var rePool = sync.Pool{
    New: func() any {
        return regexp.MustCompile(`^[a-z]+$`).Copy()
    },
}

func isValid(s string) bool {
    r := rePool.Get().(*regexp.Regexp)
    defer rePool.Put(r)
    return r.MatchString(s)
}
```

**Why.** `*regexp.Regexp.MatchString` is thread-safe but internally serializes through a mutex on internal scratch state. Pooling lets each goroutine have its own scratch, eliminating the mutex contention.

**Result.** On a high-concurrency endpoint: 4× throughput, zero allocations per match.

---

## Scenario 9 — When the pool actively hurts

**Setup.** A workload that calls `Get`, holds the object for 10ms (I/O bound), then `Put`s.

**Symptom.** Pool hit rate is 5%; profiler shows huge time in `getSlow`.

**Cause.** With objects held for 10ms each and (say) 1000 concurrent goroutines, the pool needs 1000 objects to satisfy every Get without `New`. But the GC drains the pool every few hundred ms, so the steady-state is "always allocating new ones."

**Fix.** For this workload, replace the pool with a *bounded* free list (e.g., a buffered channel of size 1000) that the GC does *not* touch. Yes, this means manually managing the size; yes, you trade memory for predictability. But the pool's GC integration was actively hurting.

---

## Scenario 10 — Replace per-call closures with pooled callbacks

**Before:**
```go
func dispatch(jobs []Job) {
    var wg sync.WaitGroup
    for _, j := range jobs {
        wg.Add(1)
        go func(j Job) {
            defer wg.Done()
            j.Run()
        }(j)
    }
    wg.Wait()
}
```

The `go func(j Job)` closure allocates a small struct per goroutine.

**After (if hot enough):**
```go
type task struct {
    j  Job
    wg *sync.WaitGroup
}

var taskPool = sync.Pool{New: func() any { return new(task) }}

func dispatch(jobs []Job) {
    var wg sync.WaitGroup
    for _, j := range jobs {
        wg.Add(1)
        t := taskPool.Get().(*task)
        t.j, t.wg = j, &wg
        go runTask(t)
    }
    wg.Wait()
}

func runTask(t *task) {
    defer t.wg.Done()
    defer taskPool.Put(t)
    t.j.Run()
}
```

**When to use.** Only when profiling shows closure-allocation as a non-trivial fraction of CPU. Most code is dominated by the closure body, not the allocation, so this transformation is a net loss in clarity for no measurable benefit. Verify with `-benchmem` before committing.

---

## Decision checklist

Before adding a `sync.Pool`, answer:

1. **What is the allocation cost I am saving?** If `< 100 ns`, do not pool.
2. **Are objects above ~200 bytes or do they have constructor cost?** If no, do not pool.
3. **Can I tolerate the object being shared on a different goroutine after `Put`?** If no, do not pool.
4. **Will I remember to `Reset` before `Put` (or `Get`)?** If you have any doubt, write a wrapper that does it for you.
5. **Will the workload `Get` more than it `Put`s?** If yes, the pool will be empty most of the time and you are paying for nothing.
6. **Is GC frequency high enough that the pool drains constantly?** If yes, consider a non-GC free list.

If you answered "yes" to (1) + (2) + (3) and at least one of (4)/(5)/(6) is under control, `sync.Pool` is the right choice.
