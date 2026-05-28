# Runtime Source — Optimization

## 1. How to use this file

Fourteen scenarios where idiomatic Go talks to the runtime in a way that looks cheap but isn't. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT). The *justification* for every fix lives in `src/runtime/*.go` — the entries cite the functions and slow paths you'd land on with `go tool pprof` or a `runtime/trace`.

Anchored at Go 1.23, amd64, GOGC=100. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Runtime cost is dominated by six things: scheduler entry/exit (`runtime.gopark`/`goready`), per-G heap traffic (`runtime.mallocgc`), STW transitions (`stopTheWorld`), timer-heap mutations (`addtimer`), defer-chain construction (`deferproc`/`deferreturn`), and iface conversion (`convT*`). Most wins remove one of those six from the hot path. Reading order: Ex. 1, 2, 4, 11, then any order. Ex. 3, 9, 13 are the ones most senior reviews flag.

---

## 2. Exercise 1 — Channel send in a hot loop where atomic would do

A producer increments a shared count by sending `1` on a buffered chan to a reducer goroutine. Each send walks `runtime.chansend`, takes `hchan.lock`, copies the element, and may park the reducer on its recvq. For a counter, every one of those steps is wasted.

```go
type Counter struct{ ch chan int64 }

func NewCounter() *Counter {
    c := &Counter{ch: make(chan int64, 1024)}
    go func() { for v := range c.ch { _ = v /* reduce */ } }()
    return c
}

func (c *Counter) Inc() { c.ch <- 1 }
```

```
BenchmarkChanInc-8        8000000     180 ns/op    0 B/op    0 allocs/op
```

<details><summary>After</summary>

`atomic.Int64.Add` — one `LOCK XADD`, no lock, no scheduler involvement.

```go
type Counter struct{ n atomic.Int64 }

func (c *Counter) Inc()         { c.n.Add(1) }
func (c *Counter) Load() int64  { return c.n.Load() }
```

```
BenchmarkAtomicInc-8     300000000    4.2 ns/op   0 B/op   0 allocs/op
```

~43× faster.

**Why faster:** `runtime/chan.go::chansend` (the unbuffered/blocked path drops into `chansend1` → `chansend` → `gopark` if the buffer is full) takes `c.lock` via `lock(&c.lockOrder)`, runs the `sendDirect`/memmove element copy, then `goready`s any sleeping receiver. Even the fast path (buffered, no waiter) does CAS on `qcount`, atomic store of the element, and a `runtime.gosched` budget check. An `atomic.Int64.Add` is a single `LOCK XADD` — no scheduler entry, no `hchan` cache line bouncing across cores.
**Trade-off:** Lose the reducer-goroutine sequencing point — if `Inc` callers needed ordering with other channel ops, the atomic loses it. Lose flow-control: the channel's buffer was implicit backpressure. For counters, neither matters; for queues, they do.
**When NOT:** When the chan delivers a real value (struct, pointer), not a tally. When you need the reducer to run a side effect once per increment (logging, batching). When the chan is the synchronization point with `select` elsewhere.
</details>

---

## 3. Exercise 2 — `select { case x := <-ch: ... default: }` in a spin loop

A worker polls a chan with `select … default` inside a `for` to "check if there's work, otherwise spin." Each iteration walks `runtime.selectgo` — the most expensive operator in the runtime — only to fall through the default and burn a CPU.

```go
for {
    select {
    case job := <-work:
        process(job)
    default:
        // spin — keep polling
    }
}
```

```
BenchmarkSelectDefault-8  20000000   75 ns/op   0 B/op   0 allocs/op  // per failed poll
```

<details><summary>After</summary>

Block on the receive. If you need to also watch a stop signal, add it as a second `case` — still a *blocking* select.

```go
for {
    select {
    case job := <-work:
        process(job)
    case <-done:
        return
    }
}
```

```
BenchmarkBlockingSelect-8   12000000   95 ns/op   0 B/op   0 allocs/op  // amortized
// but CPU drops from 100% per spinner to ~0% when idle
```

Throughput unchanged; CPU at idle drops to zero. On a 16-core machine with 16 spinners, system CPU drops from 1600% to ~0%.

**Why faster:** `runtime/select.go::selectgo` runs three passes per call — `sellock` on every case's channel, a `pollorder` pass to find a ready case, and `lockorder` to acquire locks deterministically (the per-case lock dance is what makes `selectgo` ~10× more expensive than a plain chan op). With a `default`, the `pollorder` pass always finds the default `caseDefault` after checking every other case — so you pay the locking and polling cost on every iteration and never sleep. Blocking selects park on the chan's `recvq` via `gopark`; the OS thread (M) detaches from the G and the P picks up other work. No CPU burns.
**Trade-off:** You lose the ability to "do something else while waiting" within the same goroutine. If "something else" is real work, use a second goroutine and let the scheduler park each.
**When NOT:** When you genuinely have non-blocking work to perform on each iteration (a tick + a chan check is `select` + `time.NewTicker`, not `select` + `default`). When you're in a `runtime.LockOSThread`'d goroutine where parking is unsafe — but you shouldn't be using a chan there either.
</details>

---

## 4. Exercise 3 — `time.After` in a select loop

A handler uses `time.After(5*time.Second)` inside a `for { select { case <-ch: ...; case <-time.After(5*time.Second): ... } }`. Every loop iteration adds a new timer to the runtime's timer heap. The old timer becomes garbage but isn't reclaimed until it fires.

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        return // idle timeout
    }
}
```

```
BenchmarkTimeAfter-8      300000   4800 ns/op   208 B/op   3 allocs/op  // per iteration
```

<details><summary>After</summary>

One `time.Timer` outside the loop. `Reset` after each receive; `Stop` on exit.

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    select {
    case msg := <-ch:
        handle(msg)
        if !t.Stop() { <-t.C }
        t.Reset(5 * time.Second)
    case <-t.C:
        return
    }
}
```

```
BenchmarkTimerReset-8    2000000   620 ns/op   0 B/op   0 allocs/op
```

~7.7× faster, allocation eliminated.

**Why faster:** `runtime/time.go::startTimer` (called by `time.NewTimer` and by `time.After` per call) takes the per-P timer bucket lock, sift-ups the timer into the four-heap (`siftupTimer`), and wakes the timer-proc goroutine if the new timer is earliest. `time.After` is a thin wrapper: `func After(d Duration) <-chan Time { return NewTimer(d).C }` — so each call into `time.After` constructs a fresh `*Timer` (allocation), a fresh chan (allocation), and a fresh runtime `timer` struct, then heaps it. With Go 1.23's per-P timer buckets this is cheaper than the old global-lock era, but `addtimer` → `cleantimers` → `siftupTimer` is still O(log N) over the bucket. `Reset` instead mutates the existing `runtime.timer.when` field and re-sifts in place; no new chan, no new alloc, no new G wake.
**Trade-off:** `Reset`'s contract is fiddly — the "drain `t.C` only if `Stop` returned false" dance is famously bug-prone. Wrap in a helper or use `time.AfterFunc` for fire-and-forget patterns. With Go 1.23 `Reset` is safer (the channel was made unbuffered-like via `chanrecv` semantics), but the drain dance is still required for receives the goroutine already started.
**When NOT:** When the loop iterates rarely (once per minute) — the allocation noise is invisible. When you need a *new* deadline per receive that's relative to message arrival — you'd still reset, so this still wins.
</details>

---

## 5. Exercise 4 — `defer Unlock()` in a tight loop

A function takes a mutex, mutates a map, releases. It's called 10M times per second in a hot path. The `defer` adds ~30 ns and an 8-byte heap slot on every call (Go 1.14+ open-coded defers help when there's exactly one defer in a non-loop function — but only sometimes, and never in a loop).

```go
func (s *Set) Add(k string) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.m[k] = struct{}{}
}
```

```
BenchmarkDeferredUnlock-8   50000000   28 ns/op   0 B/op   0 allocs/op
```

<details><summary>After</summary>

Manual `Unlock`. Wrap the body in a helper if it has multiple early returns.

```go
func (s *Set) Add(k string) {
    s.mu.Lock()
    s.m[k] = struct{}{}
    s.mu.Unlock()
}
```

```
BenchmarkManualUnlock-8    150000000   8.5 ns/op   0 B/op   0 allocs/op
```

~3.3× faster.

**Why faster:** `runtime/panic.go::deferproc` records the deferred function in a `_defer` struct linked off the G. `runtime/panic.go::deferreturn` walks the chain at function return and invokes each. Go 1.14 added "open-coded defers" — when the compiler can prove the defer count is small and known, it emits the deferred calls inline with a bitmask; no `_defer` allocation. **But** the open-coded path is disabled if the defer is in a loop, if there are more than 8 defers, or if the function takes the address of `defer`. For `defer Unlock`, the open-coded path applies most of the time and the overhead drops from ~30 ns to ~5-8 ns vs. ~1 ns for a direct call. In a function called millions of times per second, that ~5 ns × 10M = 50 ms/sec of CPU spent on bookkeeping. Manual `Unlock` is a single call; the compiler often inlines `(*Mutex).Unlock`'s fast path (`atomic.CompareAndSwapInt32(&m.state, mutexLocked, 0)`).
**Trade-off:** Panic-safety. If anything between `Lock` and `Unlock` panics, the mutex is never released; subsequent acquirers deadlock. Mitigate by keeping the critical section truly trivial (one map op) and asserting in code review that no allocator/escape-checked operation lives there.
**When NOT:** When the critical section can panic (arithmetic, slice indexing under uncertain length, calls into user code). When the function has multiple return paths and `defer` is the readability win. When the function is called < 1k times/sec — the saved 20 ns is invisible.
</details>

---

## 6. Exercise 5 — Goroutine per item

A request handler fans out one goroutine per row in a 10k-row batch to call an enrichment service. The scheduler creates 10k Gs, runs them, and lets them die — 10k × ~2 KB stack + scheduler bookkeeping per request.

```go
func Enrich(rows []Row) []Enriched {
    out := make([]Enriched, len(rows))
    var wg sync.WaitGroup
    for i, r := range rows {
        wg.Add(1)
        go func(i int, r Row) {
            defer wg.Done()
            out[i] = enrich(r)
        }(i, r)
    }
    wg.Wait()
    return out
}
```

```
BenchmarkGoroutinePerItem-8   200   5400000 ns/op   2400000 B/op   10001 allocs/op  // 10k rows
```

<details><summary>After</summary>

Fixed worker pool sized to `GOMAXPROCS` (or `min(GOMAXPROCS, len(rows))`). Feed work through a chan; workers loop.

```go
func Enrich(rows []Row) []Enriched {
    out := make([]Enriched, len(rows))
    workers := runtime.GOMAXPROCS(0)
    if workers > len(rows) { workers = len(rows) }
    type job struct{ i int; r Row }
    ch := make(chan job, workers)
    var wg sync.WaitGroup
    for w := 0; w < workers; w++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range ch { out[j.i] = enrich(j.r) }
        }()
    }
    for i, r := range rows { ch <- job{i, r} }
    close(ch); wg.Wait()
    return out
}
```

```
BenchmarkWorkerPool-8         900   1200000 ns/op    2400 B/op   18 allocs/op
```

~4.5× faster, ~1000× fewer allocations.

**Why faster:** `runtime/proc.go::newproc` (called for every `go func()`) allocates a G struct, links it into the per-P run queue, and may need to wake an M. `gostartcall` sets up the stack frame; the initial G stack is 2 KB (`_StackMin`) and grows via `morestack`. For 10k Gs that's 20 MB of stack scattered across the heap, plus 10k `runqput` calls (with overflow to the global runq when the per-P queue fills, taking `sched.lock`). Worker pool reuses Gs — `newproc` runs once per worker, not once per item; per-item cost drops to a chan send (~150 ns) + the work itself.
**Trade-off:** A slow item blocks one worker, not just itself. Imbalanced batches under-utilize. Mitigate with work stealing (already in the runtime — `runqsteal`) or finer-grained chunks. Cancellation (one error stops all) requires a shared `context.Context` and `select { case <-ctx.Done(): }` in the worker loop.
**When NOT:** When items are short and few (< 100) — `newproc` overhead is negligible. When items are blocking I/O bound and you want maximal concurrency (the scheduler handles 100k blocked Gs fine, but a worker pool caps it). When items recursively spawn — pool deadlocks if a worker waits for its own future job.
</details>

---

## 7. Exercise 6 — Manual `runtime.GC()` to "free memory now"

A long-lived server calls `runtime.GC()` at the end of each request "to keep memory low." Every call is a full STW garbage collection — the entire goroutine population pauses while the runtime scans the heap.

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    serve(w, r)
    runtime.GC() // "to keep memory bounded"
}
```

```
BenchmarkManualGC-8     50   25000000 ns/op   // ~25 ms per request, STW pause included
```

<details><summary>After</summary>

Remove it. Tune `GOGC` (default 100 = double heap before next GC; set lower for tighter memory, higher for less GC pressure) or `GOMEMLIMIT` if you have a hard cap.

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    serve(w, r)
}

// startup:
// GOMEMLIMIT=2GiB GOGC=50 ./server
```

```
BenchmarkNoManualGC-8   30000   42000 ns/op   // background GC, no STW per request
```

~600× faster on the request path. Peak memory stays bounded via `GOMEMLIMIT`.

**Why faster:** `runtime/mgc.go::gcStart` (called by `runtime.GC()`) calls `stopTheWorld("GC")` to enter mark setup, runs concurrent mark on dedicated GC workers, then `stopTheWorld` again for mark termination. The first STW is brief (microseconds), the concurrent mark runs alongside the program but pays a write-barrier tax (`gcWriteBarrier`), and the second STW is bounded but real. By calling `runtime.GC()` per request you force a full cycle every request — completely defeating the concurrent GC's purpose. The runtime already triggers GC when the heap doubles (or hits `GOMEMLIMIT`), runs it concurrently with marker workers (`gcBgMarkWorker`), and amortizes the cost. `debug.SetMemoryLimit` lets you pin a ceiling without forcing cycles. `runtime.GC()` exists for benchmarks and tests where you need a known heap state — not for production.
**Trade-off:** Removing manual GC means peak heap is `2 × live_set` (or `GOGC=X` ⇒ `(1+X/100) × live_set`). If you actually need tighter peak, set `GOMEMLIMIT` — the runtime adjusts its triggering to respect the cap, paying CPU rather than RAM.
**When NOT:** Right before a long benchmark you want to start with a clean heap. Right before a memory-pressure test to force a known state. After releasing a *huge* one-shot dataset (10 GB load-then-process) where the natural trigger would happen seconds later — but even then prefer setting `GOGC` smaller in the loaded section.
</details>

---

## 8. Exercise 7 — `runtime.Gosched()` "to give others a chance"

A CPU-heavy goroutine sprinkles `runtime.Gosched()` calls "to be fair." Each call enters the scheduler, looks for runnable work, and either yields or returns. On a system with no other runnable goroutines, it's pure overhead.

```go
func compute(data []float64) float64 {
    sum := 0.0
    for i, v := range data {
        sum += math.Sqrt(v) * math.Sin(v)
        if i%1000 == 0 { runtime.Gosched() } // "be nice"
    }
    return sum
}
```

```
BenchmarkComputeGosched-8   1500   780000 ns/op   // 100k floats
```

<details><summary>After</summary>

Remove the call. The runtime preempts long-running goroutines on its own (Go 1.14+ asynchronous preemption).

```go
func compute(data []float64) float64 {
    sum := 0.0
    for _, v := range data {
        sum += math.Sqrt(v) * math.Sin(v)
    }
    return sum
}
```

```
BenchmarkComputeNoGosched-8   2500   470000 ns/op
```

~1.7× faster.

**Why faster:** `runtime/proc.go::gosched_m` calls `dropg`, `casgstatus(gp, _Grunning, _Grunnable)`, puts the G back on the global runq (`globrunqput`), and re-enters `schedule()` to find work. Each Gosched costs ~100-200 ns and trashes the M's instruction cache (scheduler code is cold relative to your math loop). Worse, Gosched goes to the *global* queue, defeating the per-P run queue's affinity — the next G to run on this P likely isn't yours. Go 1.14 added signal-based asynchronous preemption (`runtime/preempt.go::preemptPark`, fired by the sysmon goroutine after 10 ms in the same G) — the runtime can interrupt your loop without cooperation. Manual `Gosched` is left over from Go 1.0 when goroutines could starve each other.
**Trade-off:** None for CPU-bound code. The only place `Gosched` is occasionally defensible is inside a `for { /* spin */ }` waiting for a condition you can't atomic/chan — but you should restructure such code.
**When NOT:** Inside `runtime.LockOSThread`'d code that explicitly wants to share the OS thread with other Gs — but if you're locking the OS thread, you usually don't want to yield it anyway.
</details>

---

## 9. Exercise 8 — `runtime.LockOSThread` for no reason

A goroutine calls `runtime.LockOSThread()` "to make sure it stays on the same thread for performance." It does no cgo, no syscalls that require thread affinity (like X11 or thread-local storage in C libs), and no OS-thread-specific state.

```go
func worker() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for job := range jobs {
        process(job) // pure Go, no C, no thread-locals
    }
}
```

```
BenchmarkLockedWorker-8    500   2400000 ns/op
```

<details><summary>After</summary>

Remove both calls.

```go
func worker() {
    for job := range jobs {
        process(job)
    }
}
```

```
BenchmarkUnlockedWorker-8  900   1300000 ns/op
```

~1.8× faster.

**Why faster:** `runtime/proc.go::dolockOSThread` (called by `LockOSThread`) sets `g.lockedm = m` and `m.lockedg = g`. From then on, the runtime cannot run this G on any other M, and cannot run any other G on this M. When this G blocks on a chan, the M parks too — it doesn't pick up other work. When this G is descheduled and rescheduled, the runtime must find this specific M; if it's busy, the G waits even if other M/P pairs are idle. Effective parallelism collapses: with `GOMAXPROCS=8` and 8 locked workers, you get 8 dedicated OS threads with no sharing. Worse, `LockOSThread` disables the G's preemption guarantees — the M cannot service signals for other Gs while this one runs.
**Trade-off:** None when the lock was unnecessary. When it's necessary (cgo with thread-local storage, OpenGL contexts, `syscall.Setuid` per-thread, Linux netns/usrns work), the lock is non-negotiable.
**When NOT:** Cgo into a library with thread-local state (CUDA, OpenGL, X11). Linux per-thread namespace operations (`unshare`, `setns`). Signal handlers that must run on a specific thread. Calls to `syscall.RawSyscall` that mutate per-thread kernel state (rlimits, capabilities) — Go's `syscall.Setuid` already issues to all threads; raw syscalls don't.
</details>

---

## 10. Exercise 9 — `make([]byte, n)` per call for short-lived buffers

A request handler allocates a 64 KB buffer per call to decode protobuf, hands it to `Unmarshal`, then discards it. At 10k req/s that's 640 MB/s of GC pressure.

```go
func decode(data []byte) (*Message, error) {
    buf := make([]byte, 64*1024)
    n, err := unpack(data, buf)
    if err != nil { return nil, err }
    return parse(buf[:n])
}
```

```
BenchmarkAllocPerCall-8   100000   12000 ns/op   65536 B/op   1 allocs/op
```

<details><summary>After</summary>

`sync.Pool` keyed on buffer size. Reset and put back at the end.

```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 64*1024); return &b },
}

func decode(data []byte) (*Message, error) {
    bp := bufPool.Get().(*[]byte)
    buf := *bp
    defer bufPool.Put(bp)
    n, err := unpack(data, buf)
    if err != nil { return nil, err }
    return parse(buf[:n])
}
```

```
BenchmarkPooled-8         800000   1500 ns/op    24 B/op   1 allocs/op  // pool header on miss only
```

~8× faster, ~2700× less GC pressure.

**Why faster:** Every `make([]byte, 64*1024)` walks `runtime/malloc.go::mallocgc`. The 64 KB size puts it into the "large object" path (objects > 32 KB go via `mcache.allocLarge` → straight to `mheap` lock acquisition). Even smaller objects pay per-call overhead: `mcache` per-P fast path checks the span, finds a free slot, sets the bitmap bit, possibly refills from `mcentral` (taking `mcentral.partial[].spineLock`), and the GC eventually scans the object. `sync.Pool` keeps a per-P local cache (`poolLocal`), pulled with no lock; on miss it walks the victim cache and other Ps' pools (`getSlow`). The 24 B/op in the After is the `*[]byte` indirection — using a pointer-to-slice avoids the slice-header escape that plain `[]byte` would cause inside `Pool.Get`.
**Trade-off:** `sync.Pool` evicts during GC — a low-traffic endpoint sees zero hit rate. Buffers must be reset (or you leak data across calls). Pool isn't suitable for buffers of variable size (different requests need different sizes) — use a slab pool or a `sync.Pool` per size bucket.
**When NOT:** When buffers vary wildly in size (the pool either keeps oversized buffers, wasting memory, or constantly allocates new ones, defeating the point). When the allocation isn't on a hot path. When the buffer lifetime crosses goroutines in unclear patterns — pool reuse becomes a correctness risk.
</details>

---

## 11. Exercise 10 — `runtime.SetFinalizer` to close resources

A struct wrapping a file handle uses `runtime.SetFinalizer(f, (*File).close)` "for safety." The finalizer runs eventually (GC-triggered), possibly after the FD limit is hit. Each finalizer adds work to the dedicated finalizer goroutine.

```go
type File struct{ fd int }

func Open(path string) (*File, error) {
    fd, err := syscall.Open(path, syscall.O_RDONLY, 0)
    if err != nil { return nil, err }
    f := &File{fd: fd}
    runtime.SetFinalizer(f, (*File).close)
    return f, nil
}

func (f *File) close() { syscall.Close(f.fd) }
```

```
// Real symptom: "too many open files" errors under load before GC catches up.
// Benchmark not the right tool; check FD count under sustained Open without Close.
```

<details><summary>After</summary>

`Close()` method + `defer f.Close()` at the call site. Finalizer (if kept) only as a debugging belt-and-suspenders that *warns* on leak.

```go
type File struct{ fd int; closed bool }

func Open(path string) (*File, error) {
    fd, err := syscall.Open(path, syscall.O_RDONLY, 0)
    if err != nil { return nil, err }
    f := &File{fd: fd}
    runtime.SetFinalizer(f, func(f *File) {
        if !f.closed { panic("File leaked without Close") } // dev-only
    })
    return f, nil
}

func (f *File) Close() error {
    if f.closed { return nil }
    f.closed = true
    runtime.SetFinalizer(f, nil) // disarm
    return syscall.Close(f.fd)
}

// Callers:
//   f, err := Open(path); if err != nil { return err }
//   defer f.Close()
```

```
// FD count stays bounded under sustained load. Close happens in microseconds, not
// "whenever GC notices."
```

**Why faster:** `runtime/mfinal.go::SetFinalizer` adds a `specialFinalizer` to the object's span. `runtime/mgc.go::gcStart` flushes the finalizer queue at the end of each cycle; `runtime/mfinal.go::runfinq` is a dedicated goroutine that pulls finalizers off a buffer and runs them. Two latency consequences: (1) finalizer runs *after* the GC cycle that found the object unreachable — minimum tens of milliseconds even on a small heap, seconds under load. (2) Finalizers run on `runfinq`'s G, serialized with other finalizers — one slow finalizer (a slow `Close` on a network handle) blocks every other waiting object's cleanup. Worse, an object with a finalizer survives one extra GC cycle (the finalizer needs the object alive to run on it), so finalizer-protected objects double-cost GC. Explicit `Close` releases the FD in nanoseconds, the moment the caller signals "I'm done."
**Trade-off:** Explicit close requires discipline — every caller must `defer f.Close()`. The finalizer-as-leak-detector pattern (only panics, doesn't fix) catches bugs in dev; remove in prod (finalizer overhead remains).
**When NOT:** When the resource genuinely can't be tied to a lexical scope (a cache returning entries that the consumer holds for unpredictable durations) — finalizers may be the only safety net. Map values backed by external resources where the map drops references without a hook (use `runtime.AddCleanup` in Go 1.24+ instead of `SetFinalizer` for less overhead).
</details>

---

## 12. Exercise 11 — `interface{}` boxing in a hot path

A logger accepts `...interface{}` and stores each value in a ring buffer. Every `int`, `int64`, `float64`, and other-than-pointer value gets boxed via `runtime.convT64` / `runtime.convTslice` / etc., allocating an `_type`-tagged heap object per call.

```go
type Logger struct{ buf []any }

func (l *Logger) Logf(format string, args ...any) {
    l.buf = append(l.buf, formatted(format, args)...)
}

func main() {
    l := &Logger{}
    for i := 0; i < 1_000_000; i++ {
        l.Logf("iter=%d val=%f", i, float64(i)*1.5)
    }
}
```

```
BenchmarkIfaceArgs-8   200   6800000 ns/op   24000000 B/op   2000000 allocs/op  // 1M calls × 2 args
```

<details><summary>After</summary>

Typed API for hot fields, or generics for monomorphized paths. `slog` uses typed `Attr` for exactly this reason.

```go
type Attr struct {
    Key   string
    Kind  uint8 // KindInt, KindFloat, KindString
    Int   int64
    Float float64
    Str   string
}

func KV(key string, v any) Attr {
    switch v := v.(type) {
    case int:     return Attr{Key: key, Kind: KindInt, Int: int64(v)}
    case int64:   return Attr{Key: key, Kind: KindInt, Int: v}
    case float64: return Attr{Key: key, Kind: KindFloat, Float: v}
    case string:  return Attr{Key: key, Kind: KindStr, Str: v}
    }
    return Attr{Key: key, Kind: KindStr, Str: fmt.Sprint(v)}
}

func (l *Logger) Log(msg string, attrs ...Attr) {
    // serialize without boxing
}

// Caller:
//   l.Log("iter", Int("i", i), Float("val", float64(i)*1.5))
```

```
BenchmarkTypedAttrs-8   1500   780000 ns/op   1024 B/op   1 allocs/op
```

~8.7× faster, ~23000× fewer allocations.

**Why faster:** `runtime/iface.go::convT64` (and friends `convT32`, `convTstring`, `convTslice`, `convT`) packs a value into a fresh `*_type, unsafe.Pointer` pair and allocates the value on the heap when it doesn't fit inline. Pre-Go 1.18 *every* `convT*` allocated; Go 1.18+ has small-value optimizations (`convT16`, `convT32`, `convT64` for `int`/`int32`/`int64` reuse a static table for small ints), but `float64` and `string` still allocate when crossing the iface boundary, and *any* user struct does. Each allocation hits `mallocgc`, sets bitmap bits, and creates GC scan work. The typed `Attr` is a fixed-size struct passed by value — no boxing, the union-of-fields wastes a few bytes per attr but eliminates millions of allocations.
**Trade-off:** `Attr` carries dead fields (a string attr wastes `Int` and `Float`). For 1M-call/s logs the trade is obviously worth it. For 10-call/s admin logs the iface API is fine.
**When NOT:** When the values truly are heterogeneous and rare — `any` is the right abstraction. When you need full generics across many types — generic monomorphization beats both iface and tagged union, at the cost of binary size.
</details>

---

## 13. Exercise 12 — `runtime.NumGoroutine()` polled in metrics

A `/metrics` endpoint reports goroutine count by calling `runtime.NumGoroutine()` on every scrape. The runtime walks `allgs` (all goroutines ever created, filtered by status) — under sustained load with millions of historical Gs created and dead, this becomes slow and takes the `allgs` lock.

```go
func metricsHandler(w http.ResponseWriter, r *http.Request) {
    n := runtime.NumGoroutine()
    fmt.Fprintf(w, "goroutines %d\n", n)
}
```

```
BenchmarkNumGoroutine-8   1000   1200000 ns/op   // under 100k live Gs
```

<details><summary>After</summary>

For the *application-level* concept ("active workers", "in-flight requests") use an atomic counter. Keep `NumGoroutine` for occasional debugging.

```go
type Server struct{ inFlight atomic.Int64 }

func (s *Server) handle(req Req) {
    s.inFlight.Add(1)
    defer s.inFlight.Add(-1)
    process(req)
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "in_flight %d\n", s.inFlight.Load())
}
```

```
BenchmarkAtomicCount-8    300000000   4 ns/op
```

~300000× faster on the metrics path.

**Why faster:** `runtime/proc.go::gcount` walks `allgs` accumulating those with status in `{_Grunnable, _Grunning, _Gsyscall, _Gwaiting, _Gpreempted}` minus those in `_Gdead`. The `allgs` slice grows monotonically over the process lifetime (Gs are reused but the slice never shrinks); a long-lived server with bursty goroutine creation can have `len(allgs)` in the millions. `gcount` takes `allglock` and iterates — that's microseconds-to-milliseconds depending on history. An atomic counter is one `LOCK XADD`. Also: `NumGoroutine` reports a runtime-level number that's only loosely related to "how busy is my app" — it includes the GC workers, the timer-proc, the finalizer goroutine, network poller, etc. The atomic counter measures the thing the operator actually wants.
**Trade-off:** You're not measuring goroutine *leaks* — `NumGoroutine` does that and you still want it on an occasional debug endpoint. The atomic counter only knows about the app-level units you instrument.
**When NOT:** When you specifically want to detect goroutine leaks — keep `NumGoroutine` on a slow-poll debug endpoint, alongside the cheap atomic counters. When the number of goroutines created over the process lifetime is small (< 10k) — `gcount` is fast.
</details>

---

## 14. Exercise 13 — `runtime.ReadMemStats` per request

A handler emits memory stats per request to a tracing system. `runtime.ReadMemStats` is documented to stop the world to collect a consistent snapshot of all memory counters.

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    serve(w, r)
    var ms runtime.MemStats
    runtime.ReadMemStats(&ms)
    tracer.RecordHeapInUse(ms.HeapInuse)
}
```

```
BenchmarkReadMemStats-8   500   2800000 ns/op   // ~2.8 ms STW per request
```

<details><summary>After</summary>

`runtime/metrics.Read` for a non-STW snapshot of the metrics you actually want.

```go
import "runtime/metrics"

var samples = []metrics.Sample{
    {Name: "/memory/classes/heap/objects:bytes"},
    {Name: "/gc/heap/allocs:bytes"},
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
    serve(w, r)
    metrics.Read(samples)
    tracer.RecordHeapInUse(samples[0].Value.Uint64())
}
```

```
BenchmarkMetricsRead-8    5000000   320 ns/op   0 B/op   0 allocs/op
```

~8700× faster. No STW.

**Why faster:** `runtime/mstats.go::readmemstats_m` (the M-routine that `ReadMemStats` calls into) is wrapped in `stopTheWorld("read mem stats")` to ensure a coherent snapshot across all per-P stats caches (`mcache.local_*`, `mcentral.nmalloc`, etc.). The STW pauses every G — under load that's per-request multi-millisecond latency injected into every other concurrent handler. `runtime/metrics` (Go 1.16+) was designed to expose individual counters via atomic reads — `metrics.Read` walks the requested samples and grabs each value with a load, no global pause. Most production observability stacks (Prometheus, OpenTelemetry) now expose `runtime/metrics` by default; only legacy code still reads `MemStats`.
**Trade-off:** The set of metrics differs slightly. Anything in `MemStats` worth reporting has a `runtime/metrics` equivalent — see `runtime/metrics.All()` for the inventory.
**When NOT:** When you need a *coherent* snapshot across many counters (you don't, usually — operators want individual gauges). One-shot tools where the STW pause is irrelevant. Tests that profile heap precisely after a known point.
</details>

---

## 15. Exercise 14 — `runtime.Stack(buf, true)` always-on dump

A panic handler proactively captures `runtime.Stack(buf, true)` on every request "in case we need debug info." `all=true` stops the world and walks every goroutine's stack, formatting frames into the buffer.

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true) // all goroutines, every request
    log.Debug("stacks", string(buf[:n]))
    serve(w, r)
}
```

```
BenchmarkStackAll-8   30   42000000 ns/op   1048576 B/op   1 allocs/op  // ~42 ms STW
```

<details><summary>After</summary>

Dump stacks only on the conditions that need them — panics, deadlock detection (timeouts), debug endpoint.

```go
func handleRequest(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if rv := recover(); rv != nil {
            buf := make([]byte, 1<<20)
            n := runtime.Stack(buf, true) // only on panic
            log.Error("panic", "value", rv, "stacks", string(buf[:n]))
        }
    }()
    serve(w, r)
}

// Plus a debug endpoint:
http.HandleFunc("/debug/goroutines", func(w http.ResponseWriter, r *http.Request) {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    w.Write(buf[:n])
})
```

```
BenchmarkStackOnDemand-8   50000000   3 ns/op   // unchanged hot path; debug dump only when needed
```

>10000× faster on the hot path. Debug data still available on panic and on `/debug/goroutines`.

**Why faster:** `runtime/mprof.go::Stack` (with `all=true`) calls `stopTheWorld("runtime.Stack")` and walks each G's stack via `forEachGRace` / `tracebackOthers`, formatting each frame with `traceback`'s symbolic resolution. For 10k live Gs that's 10k tracebacks per call. The STW pauses every other handler. `pprof.Lookup("goroutine").WriteTo(w, 1)` does the same when explicitly requested; it's the same underlying machinery and equally expensive — meant for debugging, not for the request path. The 1 MB allocation per call is also worth avoiding; use a pooled buffer if you keep this on a panic path with high panic rates.
**Trade-off:** You lose stack snapshots for non-panic-but-still-weird cases (slow requests with no error). Replace with `pprof.Lookup("goroutine")` on a debug endpoint or `runtime/pprof.Profile` on a sampled basis.
**When NOT:** A deadlock detector that triggers on hung requests and needs a one-time dump — fine. A panic handler — fine. A timeout escalation that captures the state of all goroutines once before killing the process — fine. Per-request, always-on capture — never.
</details>

---

## 16. When NOT to optimize

Runtime cost dominates only when the runtime is on the hot path of a high-frequency operation. If your handler runs 10 times per minute, all 14 of these "wins" combined save you microseconds you can't measure. The signature in a profile that says "I should look at the runtime" is one of: `runtime.mallocgc` >5% of CPU, `runtime.chansend1`/`chanrecv1` >2%, `runtime.selectgo` >2%, `runtime.deferreturn` on a hot stack, `runtime.gopark` with the wrong reason at the wrong frequency, `runtime/mgc.go::gcBgMarkWorker` >10% (or `gcDrain` consuming a worker), STW intervals >100 μs.

**Profile first.** `go tool pprof` on a CPU profile collected with `runtime/pprof.StartCPUProfile` — search the call graph for the runtime functions named in each exercise. `runtime/trace` shows scheduler events: `EvGoBlockSync` (Ex. 1, channel send blocked), `EvGoBlockSelect` (Ex. 2), `EvGoSched` (Ex. 7), `EvGCSTWStart`/`EvGCSTWDone` (Ex. 6, 13, 14). Each maps to a row in the trace UI; click into it and you see exactly which call site triggered.

**Common premature optimizations:** atomic counter (Ex. 1) replacing a chan that genuinely carries values; manual `Unlock` (Ex. 4) inside a function that does anything that can panic; worker pool (Ex. 5) on a 50-row batch; removing `runtime.GC` (Ex. 6) before checking whether `GOMEMLIMIT` covers the use case; `sync.Pool` (Ex. 9) on buffers smaller than 1 KB; typed-attr API (Ex. 11) on a logger called twice per request.

**Correctness gaps disguised as optimizations:** atomic counter (Ex. 1) where ordering with other channel ops was load-bearing; blocking `select` (Ex. 2) that removes the non-blocking case where work *did* happen on default; `Reset` (Ex. 3) without the `Stop+drain` dance — the timer fires twice; manual `Unlock` (Ex. 4) inside a path that can panic — deadlock on retry; worker pool (Ex. 5) without `context.Context` cancellation — one error doesn't stop the batch; removing `runtime.GC` (Ex. 6) in a process that legitimately needs to bound heap before a known-large operation; removing `Gosched` (Ex. 7) inside a `LockOSThread`'d G that was sharing a thread with another locked G (don't do this); `sync.Pool` (Ex. 9) holding buffers that weren't reset, leaking data across requests; explicit `Close` (Ex. 10) at call sites that forgot `defer`; typed-attr API (Ex. 11) that silently drops attrs of unsupported kinds; atomic in-flight counter (Ex. 12) that doesn't reset when a panic skips the `defer Add(-1)` — fix with `defer` inside `recover`'d wrapper; `metrics.Read` (Ex. 13) consuming the same slice from multiple goroutines (it mutates the slice); on-demand `runtime.Stack` (Ex. 14) inside the same goroutine that's already panicking — captures a stack you already have via `recover`.

---

## 17. Summary

**Always-ship wins** (default in any new runtime-touching code): never call `runtime.GC()` in production (Ex. 6); never call `runtime.Gosched()` (Ex. 7) — the scheduler has been preempting for years; never `runtime.LockOSThread()` without a cgo/syscall reason (Ex. 8); never `time.After` in a loop (Ex. 3); never `select { default: }` as a spin (Ex. 2); use `runtime/metrics` over `runtime.ReadMemStats` (Ex. 13); dump stacks on panic, not per request (Ex. 14); `defer f.Close()` at the call site, not `runtime.SetFinalizer` for the happy path (Ex. 10).

**Wins behind a profile** (when measurements justify them): atomic counter over chan-of-counts (Ex. 1, when `chansend` shows); manual `Unlock` (Ex. 4, when `deferproc` shows on a million-call/s function); worker pool over goroutine-per-item (Ex. 5, when `newproc` shows); `sync.Pool` for short-lived buffers (Ex. 9, when `mallocgc` shows in the same span class); typed-attr/generic API over `any` (Ex. 11, when `convT64`/`convTstring` shows); atomic in-flight counter for app-level metrics (Ex. 12, when `gcount` or `allglock` shows in a metrics path).

**Specialty** (only when the design calls for it): custom timer wheel for systems with millions of pending timers per process (Discord's `gobwas/ws` style); per-P sharded counters using `sync.Pool` or runtime internals exposed via `internal/runtime/atomic` (cgo-grade hot paths only); manual stack snapshots via `runtime.Callers` (~200 ns) instead of `runtime.Stack` when you only need PCs not symbolized text.

Runtime cost is allocation, scheduler entry, lock contention, STW pauses, defer-chain construction, and iface boxing. Strip those six from the read path by choosing the right primitive: atomics for counters; blocking chans/selects for coordination, never spinning; pooled buffers for short-lived large objects; typed APIs for hot dispatch; explicit `Close` over finalizers; `runtime/metrics` over `MemStats`; on-demand stack dumps. The runtime itself is well-engineered — the wins come from not calling into it unnecessarily. Profile, then pick the lever; the call-graph signatures above tell you which one.
