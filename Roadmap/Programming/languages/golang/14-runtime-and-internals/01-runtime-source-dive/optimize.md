# Runtime Source Dive — Optimization

## 1. How to use this file

Seventeen scenarios where code is slower, allocates more, or scales worse than it should because the *runtime* is being asked to do work the author didn't realize they were paying for. Each entry has a **Before** (code + benchmark) and a collapsible **Solution** (optimized code + benchmark + why + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Runtime cost surfaces in seven recurring places: `runtime.newproc` (goroutine creation), `runtime.chansend`/`chanrecv` (channel ops with lock+park), `runtime.gopark`/`goready` (scheduler trips for sync primitives), `runtime.mallocgc` (heap allocation), `runtime.startTimer` (timer heap insertion), `runtime.cgocall` (Go↔C transition), and `runtime.convT*`/`reflect` (interface boxing, type-table lookups). Most wins remove one of those from the hot path.

Reading order: Ex. 1, 2, 4, 8 first. Ex. 3, 5, 7, 13 are the ones senior reviews flag most.

---

### Exercise 1: Spawning a goroutine for trivially short work
**Difficulty:** Junior
**Skills:** scheduler awareness, profiling, `runtime/proc.go`

```go
func ValidateRequest(r Req) error {
    errs := make(chan error, 4)
    var wg sync.WaitGroup
    wg.Add(4)
    go func() { defer wg.Done(); errs <- checkUserID(r.UserID) }()
    go func() { defer wg.Done(); errs <- checkEmail(r.Email) }()
    go func() { defer wg.Done(); errs <- checkAge(r.Age) }()
    go func() { defer wg.Done(); errs <- checkName(r.Name) }()
    wg.Wait(); close(errs)
    for e := range errs { if e != nil { return e } }
    return nil
}
```

**Why it's slow:** `runtime.newproc` (`runtime/proc.go`) is ~400–600 ns per goroutine on amd64 — `malg` allocates the `g` if the gfree list is empty, plus runq enqueue. Each `checkX` finishes in ~50 ns. The runtime does 50× more work than your code.

<details><summary>Hint</summary> Profile shows `runtime.newproc1`, `runtime.malg`, `runtime.chanrecv1` near the top. If goroutine setup dwarfs goroutine work, inline it. </details>

<details><summary>Solution</summary>

```go
func ValidateRequest(r Req) error {
    if err := checkUserID(r.UserID); err != nil { return err }
    if err := checkEmail(r.Email); err != nil { return err }
    if err := checkAge(r.Age); err != nil { return err }
    return checkName(r.Name)
}
```

**Benchmark before/after:**

```
BenchmarkValidateGoroutines-8    200000   6800 ns/op   384 B/op   8 allocs/op
BenchmarkValidateInline-8      20000000    210 ns/op     0 B/op   0 allocs/op
```

**Why it's faster:** No `runtime.newproc`, no `g` allocation, no runq enqueue, no `gopark`/`goready` on the channel. The checks inline through the compiler. Rule: only spawn a goroutine when the body does ≥ 10 µs of CPU or any blocking I/O.
**When NOT:** When each check is itself slow I/O or independent network work that can truly run in parallel.
</details>

---

### Exercise 2: Channel-based counter vs `atomic.Int64`
**Difficulty:** Middle
**Skills:** `runtime/chan.go`, `sync/atomic`, lock-free primitives

```go
type Counter struct { ch chan int64 }

func NewCounter() *Counter {
    c := &Counter{ch: make(chan int64, 1024)}
    go func() { var total int64; for v := range c.ch { total += v }; _ = total }()
    return c
}
func (c *Counter) Inc() { c.ch <- 1 }
```

**Why it's slow:** `runtime.chansend` (`chan.go`) calls `lock(&c.lock)`, copies the element, may `goready` a parked receiver. Even uncontended, the lock + qcount/sendx bookkeeping is ~30 ns. Under cross-P contention, the channel becomes a serialization point.

<details><summary>Hint</summary> A counter doesn't need ordering between writers. `atomic.Int64.Add` compiles to a single `LOCK XADD` — no runtime trip. </details>

<details><summary>Solution</summary>

```go
type Counter struct { n atomic.Int64 }
func (c *Counter) Inc()        { c.n.Add(1) }
func (c *Counter) Load() int64 { return c.n.Load() }
```

**Benchmark before/after:**

```
BenchmarkChanCounter-8         5000000   280 ns/op   0 B/op   0 allocs/op
BenchmarkAtomicCounter-8     500000000     3 ns/op   0 B/op   0 allocs/op
BenchmarkChanCounter_P8-8      3000000   720 ns/op   0 B/op   0 allocs/op
BenchmarkAtomicCounter_P8-8  200000000     8 ns/op   0 B/op   0 allocs/op
```

**Why it's faster:** `LOCK XADD` costs ~3–10 ns. No `chansend`, no buffer index math, no aggregator goroutine. The atomic stays in L1 for the writing core; cross-core contention costs cache-line bounces but never the scheduler.
**When NOT:** When you need ordering between writers or batching across events — a channel is the right primitive.
</details>

---

### Exercise 3: `sync.Mutex` ping-pong instead of sharded counters
**Difficulty:** Senior
**Skills:** `runtime/sema.go`, lock contention, cache-line padding

```go
type Limiter struct {
    mu     sync.Mutex
    counts map[string]int
}
func (l *Limiter) Hit(tenant string) int {
    l.mu.Lock(); defer l.mu.Unlock()
    l.counts[tenant]++
    return l.counts[tenant]
}
```

**Why it's slow:** Under contention, `sync.Mutex.Lock` falls into the slow path (`sync.runtime_SemacquireMutex` → `runtime.semacquire` in `sema.go`). The runtime parks the goroutine on the mutex's sudog wait list; the M finds other work via `findrunnable`, then `goready`s the winner. Each park/wake is 1–3 µs.

<details><summary>Hint</summary> Per-tenant updates don't need to serialize with *other* tenants' updates. Shard by hash. </details>

<details><summary>Solution</summary>

```go
type shard struct {
    mu     sync.Mutex
    counts map[string]int
    _      [40]byte // pad to 64-byte cache line
}
type Limiter struct { shards [256]*shard }

func (l *Limiter) Hit(tenant string) int {
    s := l.shards[fnv32(tenant)&255]
    s.mu.Lock()
    s.counts[tenant]++
    n := s.counts[tenant]
    s.mu.Unlock()
    return n
}
```

**Benchmark before/after:**

```
BenchmarkLimiter-8              3000000    420 ns/op   0 B/op   0 allocs/op
BenchmarkLimiterSharded-8       8000000    180 ns/op   0 B/op   0 allocs/op
BenchmarkLimiter_P32-8           400000   3100 ns/op   0 B/op   0 allocs/op
BenchmarkLimiterSharded_P32-8   6000000    240 ns/op   0 B/op   0 allocs/op
```

**Why it's faster:** Contention drops by a factor of `shardCount`. `semacquire` slow-path is rarely entered; `Lock` stays on its atomic-CAS fast path. Cache-line padding prevents adjacent shards from invalidating each other under cross-core writes.
**When NOT:** Single-tenant or very low-QPS systems — sharding is wasted memory and complexity below ~10k QPS per core.
</details>

---

### Exercise 4: Per-call heap allocation that should have stayed on the stack
**Difficulty:** Middle
**Skills:** escape analysis, `-gcflags="-m"`, `runtime.mallocgc`

```go
type Entry struct { Level int; Time time.Time; Message string }
type Handler interface{ Handle(*Entry) }

func Log(h Handler, level int, msg string) {
    e := &Entry{Level: level, Time: time.Now(), Message: msg} // escapes
    h.Handle(e)
}
```

`go build -gcflags="-m"` says `&Entry{...} escapes to heap`.

**Why it's slow:** Because `Handle` takes `*Entry` through an interface, the compiler must assume the pointer may outlive the call, so `e` escapes. `runtime.mallocgc` runs: mcache `tinyalloc` or sizeclass lookup, plus GC bookkeeping. For high-volume logging this is the bottleneck.

<details><summary>Hint</summary> Pass `Entry` by value. The value lives in the caller's stack frame; the concrete-typed handler avoids interface boxing. </details>

<details><summary>Solution</summary>

```go
type Entry struct { Level int; Time time.Time; Message string }
type fastHandler struct{ w io.Writer }
func (f *fastHandler) Handle(e Entry) { fmt.Fprintln(f.w, e.Message) }

func Log(h *fastHandler, level int, msg string) { // concrete type, no iface
    h.Handle(Entry{Level: level, Time: time.Now(), Message: msg})
}
```

**Benchmark before/after:**

```
BenchmarkLog-8         20000000   72 ns/op   48 B/op   1 allocs/op
BenchmarkLogStack-8   100000000   14 ns/op    0 B/op   0 allocs/op
```

**Why it's faster:** No `mallocgc`. The `Entry` is built directly into the stack frame; nothing for the GC to scan. Concrete dispatch lets the compiler inline `Handle`.
**When NOT:** When the entry genuinely outlives the call (async handler queue) — escape is correct; pool the entries instead (Ex. 7, 13).
</details>

---

### Exercise 5: `time.After` inside a loop
**Difficulty:** Middle
**Skills:** `runtime/time.go`, timer heap, `NewTimer` + `Reset`

```go
func Worker(work <-chan Job, timeout time.Duration) {
    for {
        select {
        case j := <-work:
            j.Run()
        case <-time.After(timeout):
            return
        }
    }
}
```

**Why it's slow:** Every iteration creates a new `*runtimeTimer` (`runtime.startTimer`) and inserts into the per-P timer heap. The timer survives until it fires or GC reclaims it — even when `work` was selected first. Insertion is O(log n) plus a heap alloc.

<details><summary>Hint</summary> Allocate one `*time.Timer` outside the loop. `Stop` + `Reset` each iteration. </details>

<details><summary>Solution</summary>

```go
func Worker(work <-chan Job, timeout time.Duration) {
    t := time.NewTimer(timeout)
    defer t.Stop()
    for {
        select {
        case j := <-work:
            if !t.Stop() { select { case <-t.C: default: } }
            t.Reset(timeout)
            j.Run()
        case <-t.C:
            return
        }
    }
}
```

**Benchmark before/after:**

```
BenchmarkWorker-8         200000   8200 ns/op   416 B/op   5 allocs/op  // 1000 iters
BenchmarkWorkerReuse-8   1500000   1100 ns/op    96 B/op   1 allocs/op
```

**Why it's faster:** One timer allocation for the entire loop. `Reset` reuses the same `*runtimeTimer` via `resettimer` — re-insertion only, no malloc. The timer heap stays smaller because dead timers don't accumulate.
**When NOT:** Loop bodies that fire once per minute — `time.After` is one line vs five and the cost is invisible.
</details>

---

### Exercise 6: Manual `runtime.GC()` calls
**Difficulty:** Junior
**Skills:** GC pacer, `GOGC`, `debug.SetMemoryLimit`

```go
func HandleBigJob(j Job) Result {
    r := process(j)
    runtime.GC() // "free memory before next request"
    return r
}
```

**Why it's slow:** `runtime.GC` (`runtime/mgc.go`) triggers a synchronous mark cycle: STW start, concurrent mark, STW termination, sweep. The runtime would have run GC anyway when `GOGC=100` was hit; calling it manually does *both* — your manual one *and* the eventual triggered one — burning CPU twice and adding latency to the request that triggered it.

<details><summary>Hint</summary> Trust the pacer (`mgcpacer.go`). It schedules GC exactly when the heap doubles. Manual calls don't free anything `GOGC=100` wouldn't. </details>

<details><summary>Solution</summary>

```go
func HandleBigJob(j Job) Result { return process(j) }
```

If memory pressure is the real concern, tune `GOGC` or `debug.SetMemoryLimit` (Go 1.19+).

**Benchmark before/after:**

```
BenchmarkBigJob-8       100   12500000 ns/op   // p99 = 45 ms
BenchmarkBigJobNoGC-8   100    8200000 ns/op   // p99 = 14 ms
```

**Why it's faster:** No forced mark/sweep. The pacer targets ~25% CPU for GC at steady state; manual `GC()` calls bypass that and run on the request critical path.
**When NOT:** Benchmarks where you want deterministic GC state — `runtime.GC()` before `b.ResetTimer()` is fine.
</details>

---

### Exercise 7: Many short-lived `[]byte` buffers
**Difficulty:** Middle
**Skills:** `sync.Pool`, `runtime/mcache.go`, allocator sizeclasses

```go
func Render(w http.ResponseWriter, data Data) {
    buf := make([]byte, 0, 4096)
    buf = append(buf, "{\"id\":"...)
    buf = strconv.AppendInt(buf, data.ID, 10)
    buf = append(buf, ",\"name\":\""...)
    buf = append(buf, data.Name...)
    buf = append(buf, "\"}"...)
    w.Write(buf)
}
```

**Why it's slow:** Every call hits `runtime.mallocgc` for the 4 KB buffer (sizeclass 36). At 50k RPS that's 200 MB/s of garbage. The mcache → mcentral path warms up frequently; the heap grows under load; the GC scans the buffer briefly before sweep returns it.

<details><summary>Hint</summary> `sync.Pool` is purpose-built for this. P-local pool slot; `Get` is wait-free on the fast path. </details>

<details><summary>Solution</summary>

```go
var bufPool = sync.Pool{
    New: func() any { b := make([]byte, 0, 4096); return &b },
}

func Render(w http.ResponseWriter, data Data) {
    bp := bufPool.Get().(*[]byte)
    buf := (*bp)[:0]
    defer func() { *bp = buf; bufPool.Put(bp) }()
    buf = append(buf, "{\"id\":"...)
    buf = strconv.AppendInt(buf, data.ID, 10)
    buf = append(buf, ",\"name\":\""...)
    buf = append(buf, data.Name...)
    buf = append(buf, "\"}"...)
    w.Write(buf)
}
```

**Benchmark before/after:**

```
BenchmarkRender-8       1000000   1450 ns/op   4096 B/op   1 allocs/op
BenchmarkRenderPool-8   8000000    180 ns/op      0 B/op   0 allocs/op
```

**Why it's faster:** `sync.Pool.Get` consults the P-local pool first (see `pool.go`'s `localPool.private` and `shared`). On a warm pool: load private slot, clear, return. No `mallocgc`, no GC scan. Allocation rate drops by orders of magnitude.
**When NOT:** Buffers of wildly varying size — pool drift wastes memory. Buffers aliased into long-lived structures (Put-after-alias = use-after-free).
</details>

---

### Exercise 8: `fmt.Sprintf` in the hot path
**Difficulty:** Middle
**Skills:** interface boxing, `runtime.convT*`, `strconv.Append*`

```go
func Tag(id int64) string {
    return fmt.Sprintf("user-%d", id)
}
```

**Why it's slow:** Two allocations per call: (1) `id` boxes into `interface{}` via `runtime.convT64` because `Sprintf` takes `...any`; (2) the formatted result string. Then `fmt` walks the format string via reflection, dispatches on verb, calls `strconv.FormatInt` internally — none of which inlines through the variadic any path.

<details><summary>Hint</summary> `strconv.AppendInt` writes into a `[]byte` you control. A stack array holds the result; one final `string()` conversion. </details>

<details><summary>Solution</summary>

```go
func Tag(id int64) string {
    var buf [24]byte // stack-allocated, fits "user-" + int64
    out := append(buf[:0], "user-"...)
    out = strconv.AppendInt(out, id, 10)
    return string(out)
}
```

**Benchmark before/after:**

```
BenchmarkSprintf-8       8000000   180 ns/op   24 B/op   2 allocs/op
BenchmarkAppendInt-8    50000000    32 ns/op   16 B/op   1 allocs/op
```

**Why it's faster:** No `runtime.convT64` — `id` stays as `int64`, never boxed. No reflection over format verbs. Only the final `string(out)` allocation remains. Inner loop is `strconv.formatBits` writing into pre-sized memory.
**When NOT:** Format strings that change at runtime, or cold paths where readability beats 150 ns.
</details>

---

### Exercise 9: Closure capture forcing a heap alloc
**Difficulty:** Middle
**Skills:** closure capture rules, escape analysis, defer-arg pattern

```go
func Handle(req Req) Resp {
    start := time.Now() // captured below → escapes to heap
    defer func() {
        metrics.Observe("handle", time.Since(start))
    }()
    return process(req)
}
```

`go build -gcflags="-m"`: `moved to heap: start`.

**Why it's slow:** Go closures capture by reference. To satisfy escape analysis, the runtime allocates `start` on the heap and the closure environment alongside it — two allocations per call.

<details><summary>Hint</summary> Pass `start` as an *argument* to the deferred function. Arguments are evaluated at `defer`-time and copied — no capture, no escape. </details>

<details><summary>Solution</summary>

```go
func Handle(req Req) Resp {
    defer func(start time.Time) {
        metrics.Observe("handle", time.Since(start))
    }(time.Now())
    return process(req)
}
```

**Benchmark before/after:**

```
BenchmarkHandle-8       3000000   480 ns/op   32 B/op   2 allocs/op
BenchmarkHandleArg-8    8000000   170 ns/op    0 B/op   0 allocs/op
```

**Why it's faster:** No closure environment on the heap. `start` lives in the deferred-call's argument area on the goroutine stack — the runtime's `_defer` record stores arguments inline (see `runtime/runtime2.go`'s `_defer` struct). With no captures, Go 1.14+ uses open-coded defers — inlined at the return point, no `runtime.deferproc` call.
**When NOT:** When you need the *current* value at defer-execution time, not at defer-statement time — capture is correct.
</details>

---

### Exercise 10: Spurious `runtime.LockOSThread`
**Difficulty:** Senior
**Skills:** scheduler M/P/G binding, work-stealing, when LockOSThread is required

```go
func Worker(jobs <-chan Job) {
    runtime.LockOSThread() // copy-pasted "safety"
    defer runtime.UnlockOSThread()
    for j := range jobs { j.Run() } // pure Go work
}
```

**Why it's slow:** `LockOSThread` (`runtime/proc.go`) wires the goroutine to a specific OS thread (M). When the goroutine blocks, the runtime can't reuse the M for other work — it sits parked. If the locked goroutines block frequently, M's pile up and the runtime creates extras (`newm` → `clone`/`pthread_create`), wasting kernel resources.

<details><summary>Hint</summary> `LockOSThread` is required only for: cgo callbacks needing stable TLS, OS APIs that bind to a thread (Linux namespaces, Windows GUI), or signal masks. Pure Go code never needs it. </details>

<details><summary>Solution</summary>

```go
func Worker(jobs <-chan Job) {
    for j := range jobs { j.Run() }
}
```

**Benchmark before/after:**

```
BenchmarkLockedWorker-8     1000   1200000 ns/op
BenchmarkUnlockedWorker-8   3500    320000 ns/op
```

**Why it's faster:** The scheduler multiplexes goroutines onto the smallest set of M's. Blocked goroutines `gopark` without binding their M — `findrunnable` immediately gives the M new work.
**When NOT:** Cgo callbacks that store data in pthread TLS. Linux unshare-based sandboxing. OS GUI loops.
</details>

---

### Exercise 11: `GOMAXPROCS` left at default in a cgroup-limited container
**Difficulty:** Senior
**Skills:** cgroup CPU quotas, `GOMAXPROCS`, `uber-go/automaxprocs`

```go
// No automaxprocs. GOMAXPROCS = NumCPU() = 64 on a 64-core host.
func main() { http.ListenAndServe(":8080", nil) }
```

Run with `docker run --cpus=2 ...`.

**Why it's slow:** Go reads `runtime.NumCPU()` from `sched_getaffinity` and sets `GOMAXPROCS=64`. The Linux CFS scheduler enforces the 2-CPU quota by throttling: when the cgroup's CPU bucket empties, all 64 threads pause until the next CFS period (100 ms). GC pacer math is also wrong — it computes assists assuming 64-way parallelism.

<details><summary>Hint</summary> Import `go.uber.org/automaxprocs` for a zero-effort fix — it reads the cgroup quota at startup. Go 1.25+ does this automatically. </details>

<details><summary>Solution</summary>

```go
import _ "go.uber.org/automaxprocs"

func main() { http.ListenAndServe(":8080", nil) }
```

Or set explicitly: `runtime.GOMAXPROCS(2)`.

**Benchmark before/after:**

```
Default GOMAXPROCS=64:   p99 = 480 ms
With automaxprocs (=2):  p99 =  35 ms
```

**Why it's faster:** No oversubscription. The 2 P's match the 2 real cores; no CFS throttling, no thrashing runqueues across phantom P's. GC pacer computes assist credit correctly.
**When NOT:** Containers with no CPU limit, or standalone servers using all cores.
</details>

---

### Exercise 12: GC pressure from short-lived objects in a hot loop
**Difficulty:** Senior
**Skills:** `sync.Pool`, GC pacer, `GODEBUG=gctrace=1`, `runtime/mgc.go`

```go
type Record struct {
    Fields [20]string
    Tags   []string
    Body   []byte
}

func Process(lines <-chan []byte) {
    for line := range lines {
        r := &Record{}
        json.Unmarshal(line, r)
        emit(r)
    }
}
```

```
$ GODEBUG=gctrace=1 ./service
gc 12 @1.012s 11%: 1.2+18+0.2 ms clock, ...   # GC eating 11% of CPU
```

**Why it's slow:** Each `Record` heap-allocates (escapes through `emit`). At 200k/sec × 2.4 KB = 480 MB/s of garbage. The pacer triggers a cycle every heap doubling; under steady high allocation rate, GC runs constantly. Mark assists run on the allocating goroutine, eating request time.

<details><summary>Hint</summary> Pool the `Record`. `sync.Pool` is GC-aware — pooled objects are dropped at GC but typically survive long enough that allocation pressure plummets. </details>

<details><summary>Solution</summary>

```go
var recordPool = sync.Pool{
    New: func() any { return &Record{Tags: make([]string, 0, 8), Body: make([]byte, 0, 256)} },
}

func Process(lines <-chan []byte) {
    for line := range lines {
        r := recordPool.Get().(*Record)
        r.reset()
        json.Unmarshal(line, r)
        emit(r)
        recordPool.Put(r) // assumes emit copies what it needs
    }
}

func (r *Record) reset() {
    for i := range r.Fields { r.Fields[i] = "" }
    r.Tags = r.Tags[:0]; r.Body = r.Body[:0]
}
```

**Benchmark before/after:**

```
BenchmarkIngest-8       500000   3800 ns/op   2400 B/op   8 allocs/op
BenchmarkIngestPool-8  3000000    410 ns/op    180 B/op   2 allocs/op

# gctrace before: GC every ~80 ms, 11% CPU
# gctrace after:  GC every ~2 s,   <1% CPU
```

**Why it's faster:** `Get` on a warm pool is ~10 ns. `mallocgc` and GC mark drop out of the profile. Mark assists per request go to ~0. The pacer (`gcController` in `mgcpacer.go`) computes longer inter-GC intervals.
**When NOT:** Objects whose reset logic is error-prone (forgotten fields = stale data across requests). Objects pinning large external resources — explicit lifetime management is safer.
</details>

---

### Exercise 13: `runtime.SetFinalizer` for resource cleanup
**Difficulty:** Senior
**Skills:** `runtime/mfinal.go`, finalizer queue, deterministic `Close()`

```go
type Conn struct { sock net.Conn }

func Dial(addr string) (*Conn, error) {
    s, err := net.Dial("tcp", addr)
    if err != nil { return nil, err }
    c := &Conn{sock: s}
    runtime.SetFinalizer(c, func(c *Conn) { c.sock.Close() })
    return c, nil
}
```

```
# Service running 1 hour:
$ lsof -p $(pgrep service) | wc -l
8192   # hit ulimit, new dials fail
```

**Why it's slow:** Finalizers (`runtime/mfinal.go`) run on a dedicated `finalizergoroutine` after the object's *next* GC cycle determines it unreachable. They double the object's GC lifetime: cycle N marks dead, cycle N+1 actually frees. Under low allocation rate, cycles are minutes apart. Sockets leak past the FD ulimit.

<details><summary>Hint</summary> Finalizers are a safety net at best. Explicit `Close()` plus `defer` is the production pattern. Reserve finalizers to catch forgotten-close in *tests*. </details>

<details><summary>Solution</summary>

```go
type Conn struct { sock net.Conn }

func Dial(addr string) (*Conn, error) {
    s, err := net.Dial("tcp", addr)
    if err != nil { return nil, err }
    return &Conn{sock: s}, nil
}
func (c *Conn) Close() error { return c.sock.Close() }

// Usage:
c, err := Dial(addr)
if err != nil { return err }
defer c.Close()
```

For tests, a finalizer that *panics* catches leaks:

```go
if testing.Testing() {
    runtime.SetFinalizer(c, func(c *Conn) { panic("Conn leaked — missing Close()") })
}
```

**Benchmark before/after:**

```
# Same load, 1 hour:
$ lsof -p $(pgrep service) | wc -l
42   # steady state, sockets close on Close()
```

**Why it's faster:** `Close()` runs at scope exit, releasing the FD immediately. The GC doesn't carry the object through an extra cycle. No finalizer-table entry per conn.
**When NOT:** Wrapping C-owned memory where you cannot guarantee a `Close()` call (e.g., cgo handle across an API boundary you don't control). Even then, also expose `Close()`.
</details>

---

### Exercise 14: Cgo calls in a hot loop
**Difficulty:** Senior
**Skills:** `runtime/cgocall.go`, `entersyscall`, batching

```go
/*
#include "hash.h"
*/
import "C"

func HashAll(records [][]byte) []uint64 {
    out := make([]uint64, len(records))
    for i, r := range records {
        out[i] = uint64(C.hash((*C.char)(unsafe.Pointer(&r[0])), C.int(len(r))))
    }
    return out
}
```

**Why it's slow:** Each `C.hash` goes through `runtime.cgocall` (`cgocall.go`): `entersyscall` detaches the goroutine's M from its P (so the P runs other goroutines), switch to the C stack, execute, then `exitsyscall` reattaches. Overhead is ~150–300 ns per call regardless of the C work; for tiny C bodies the runtime is doing more than C.

<details><summary>Hint</summary> One cgo call hashing 10k records is hundreds of times cheaper than 10k cgo calls. </details>

<details><summary>Solution</summary>

```go
/*
#include "hash.h"
void hash_batch(const char** ptrs, const int* lens, int n, unsigned long long* out);
*/
import "C"

func HashAll(records [][]byte) []uint64 {
    n := len(records)
    ptrs := make([]*C.char, n)
    lens := make([]C.int, n)
    for i, r := range records {
        ptrs[i] = (*C.char)(unsafe.Pointer(&r[0]))
        lens[i] = C.int(len(r))
    }
    out := make([]uint64, n)
    C.hash_batch(&ptrs[0], &lens[0], C.int(n), (*C.ulonglong)(&out[0]))
    return out
}
```

**Benchmark before/after:**

```
BenchmarkHashCgoPerCall-8     3000   480000 ns/op
BenchmarkHashCgoBatch-8     400000     3200 ns/op
```

**Why it's faster:** One cgo crossing instead of 10k. `entersyscall`/`exitsyscall` fires once. Inside the C function, calls are direct. If the C function uses SIMD, batching lets it stay in vectorized inner loops.
**When NOT:** When the C call must interleave with Go decision points. Even then, pure-Go implementations often beat per-record cgo by avoiding the crossing entirely.
</details>

---

### Exercise 15: `reflect`-based field copy in a loop
**Difficulty:** Senior
**Skills:** reflect cost, cached type plans, code generation

```go
func Copy(dst, src any) {
    dv := reflect.ValueOf(dst).Elem()
    sv := reflect.ValueOf(src).Elem()
    for i := 0; i < sv.NumField(); i++ {
        name := sv.Type().Field(i).Name
        df := dv.FieldByName(name) // O(N) name lookup
        if df.IsValid() && df.CanSet() { df.Set(sv.Field(i)) }
    }
}
```

**Why it's slow:** `FieldByName` is O(N) per lookup — walks the struct's field table with string compares. `reflect.Value` is 24 B, returned by value; storing it through interface boxes it. `Set` does another type-check trip through the runtime's `unsafe_NewAt`.

<details><summary>Hint</summary> Cache the field offset map per (src, dst) type pair on first call. Subsequent calls are O(1) lookups + direct memory writes. </details>

<details><summary>Solution</summary>

```go
type fieldCopy struct{ srcOff, dstOff, size uintptr }
type copyPlan struct{ fields []fieldCopy }

var planCache sync.Map // map[[2]reflect.Type]*copyPlan

func Copy[D, S any](dst *D, src *S) {
    key := [2]reflect.Type{reflect.TypeOf(*dst), reflect.TypeOf(*src)}
    pv, ok := planCache.Load(key)
    if !ok { pv = buildPlan(key); planCache.Store(key, pv) }
    plan := pv.(*copyPlan)
    dPtr, sPtr := unsafe.Pointer(dst), unsafe.Pointer(src)
    for _, f := range plan.fields {
        copyBytes(unsafe.Add(dPtr, f.dstOff), unsafe.Add(sPtr, f.srcOff), f.size)
    }
}
```

For maximum performance, use codegen (`copygen`, `goverter`) — emit literal `dst.Field = src.Field` assignments.

**Benchmark before/after:**

```
BenchmarkReflectCopy-8     200000   8400 ns/op   720 B/op   18 allocs/op
BenchmarkPlanCopy-8       5000000    220 ns/op     0 B/op    0 allocs/op
BenchmarkCodegenCopy-8   50000000     22 ns/op     0 B/op    0 allocs/op
```

**Why it's faster:** Plan-based version does `reflect` work once at startup; the hot path is `unsafe.Pointer` arithmetic with memcpy. Codegen eliminates even the cache lookup. No `runtime.convT*` boxes, no `runtime.typehash` calls.
**When NOT:** Truly dynamic schemas (user-defined mappings at runtime). One-shot config loaders where 8 µs is invisible.
</details>

---

### Exercise 16: `select` with `time.After` leaking timers under context cancel
**Difficulty:** Senior
**Skills:** timer heap, `time.NewTimer` + `Stop`, ctx-aware patterns

```go
func Wait(ctx context.Context, d time.Duration) error {
    select {
    case <-ctx.Done():
        return ctx.Err() // timer leaks until d fires
    case <-time.After(d):
        return nil
    }
}
```

**Why it's slow:** `time.After` schedules a timer firing at `now+d`. If `ctx` cancels first, the select returns but the timer sits in the runtime's per-P timer heap (siftup/siftdown in `time.go`). `checkTimers` scans the heap every scheduler tick; with thousands of dead timers, scan time dominates idle CPU.

<details><summary>Hint</summary> `time.NewTimer` returns a `*Timer` you can `Stop`. Always pair creation with a `Stop` on the cancel path. </details>

<details><summary>Solution</summary>

```go
func Wait(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-t.C:
        return nil
    }
}
```

**Benchmark before/after:**

```
# 100k cancelled requests with d=1m, sampled after 30s:
Heap timers outstanding:  100000 → 0
runtime.checkTimers CPU:     8% → 0.2%
Tail latency p99:          80 ms → 5 ms
```

**Why it's faster:** `t.Stop()` calls `runtime.stopTimer` (`runtime/time.go`), which removes the timer from the heap on next `checkTimers` scan. Memory and CPU stop accumulating. Under high cancel rate this is the difference between a memory-stable service and one OOMing in an hour.
**When NOT:** When `d` is sub-millisecond — the leak window is too small to matter. Code where `ctx` never cancels mid-wait.
</details>

---

### Exercise 17: Map of large structs copies on every lookup
**Difficulty:** Middle
**Skills:** `runtime/map.go`, value vs pointer values, cache locality

```go
type Position struct {
    Symbol   [32]byte
    Quantity int64
    Price    float64
    // ... 200+ more bytes (256 B total)
}

var book = map[uint64]Position{}

func Get(id uint64) (Position, bool) {
    p, ok := book[id]
    return p, ok
}
```

**Why it's slow:** `runtime.mapaccess2_fast64` (`runtime/map.go`) finds the bucket and returns a pointer to the value slot; the compiler emits a memcpy of `sizeof(Position) = 256 B` into the caller's `p`. Each bucket holds 8 entries × 256 B = ~2 KB — blows past L1 cache lines and forces extra bucket misses.

<details><summary>Hint</summary> Store pointers. Lookup returns 8 B; allocation happens once on insert. </details>

<details><summary>Solution</summary>

```go
var book = map[uint64]*Position{}

func Get(id uint64) (*Position, bool) {
    p, ok := book[id]
    return p, ok
}
```

Callers that need a defensive copy do `*p` themselves; most callers just read fields.

**Benchmark before/after:**

```
BenchmarkGetByValue-8     2000000   720 ns/op   0 B/op   0 allocs/op
BenchmarkGetByPointer-8  20000000    65 ns/op   0 B/op   0 allocs/op
```

**Why it's faster:** 8-byte pointer copy vs 256-byte value copy. Buckets hold 8 pointers (64 B) plus keys — fits in one cache line. `mapaccess` returns a value small enough to live in a register. Downstream code dereferences only the fields it needs; the hardware prefetches.
**When NOT:** Tiny values (≤ 32 B) where the pointer is no smaller. Maps where callers mutate returned values — pointer aliasing causes spooky action at a distance.
</details>

---

## 19. When NOT to optimize

Runtime overhead dominates only when the per-operation cost rivals real work. A CLI tool that runs once per minute, a startup-only config loader, a test fixture — none benefit from arena allocation, sharded locks, or pooling. `time.After` leak (Ex. 16) doesn't matter if your service handles 10 RPS; `runtime.LockOSThread` (Ex. 10) is a non-issue with 4 workers and 1000 RPS.

**Profile first.** Runtime overhead has recognizable signatures in `go tool pprof`:

- `runtime.newproc1`, `runtime.malg` → Ex. 1 (excess goroutine spawn)
- `runtime.chansend1`, `runtime.chanrecv` → Ex. 2 (channel over atomic)
- `sync.runtime_SemacquireMutex` → Ex. 3 (mutex contention)
- `runtime.mallocgc` on a hot stack → Ex. 4, 7, 12 (escape, pooling)
- `runtime.startTimer`, `runtime.checkTimers` → Ex. 5, 16 (timer reuse, Stop on cancel)
- `runtime.convT64`, `runtime.convT*` → Ex. 8 (interface boxing in fmt)
- `runtime.deferproc`, closure allocations → Ex. 9 (defer-arg pattern)
- `runtime.cgocall`, `runtime.exitsyscall` → Ex. 14 (cgo batching)
- `runtime.mapaccess*` returning large values → Ex. 17 (pointers in maps)

**Common premature optimizations:** pooling `Record` (Ex. 12) when the service does 100 RPS; sharding the mutex (Ex. 3) on a low-QPS service; batching cgo (Ex. 14) when each call is already milliseconds of C work; replacing `fmt.Sprintf` (Ex. 8) in error and log paths.

**Correctness gaps disguised as optimizations:** `sync.Pool` (Ex. 7, 12) reused after Put → use-after-free; `defer t.Stop()` (Ex. 5, 16) where `t.C` was already drained → second drain blocks forever; sharded counter (Ex. 3) summed non-atomically → torn reads; pointer-in-map (Ex. 17) mutated through one alias and read through another → data race; reflect plan cache (Ex. 15) keyed on `reflect.Type` across plugin reloads → stale offsets; cgo batch (Ex. 14) where C holds Go pointers past return → memory model violation; closure replaced by defer-arg (Ex. 9) where the captured value was supposed to be the *current* one at defer time.

---

## 20. Summary

**Always-ship wins:** inline trivial goroutine bodies (Ex. 1); `atomic` over channel for counters (Ex. 2); pass `start` as a defer arg (Ex. 9); never call `runtime.GC()` in production (Ex. 6); never `runtime.LockOSThread` unless you need TLS or thread-pinned OS APIs (Ex. 10); `time.NewTimer + Stop` over `time.After` in any loop or cancelable wait (Ex. 5, 16); explicit `Close()` over finalizers (Ex. 13); `automaxprocs` in any containerized service (Ex. 11); pointers in maps when values exceed ~64 B (Ex. 17).

**Wins behind a profile:** shard mutexes (Ex. 3, when `semacquire` shows); pool buffers and structs (Ex. 7, 12, when `mallocgc` shows); replace `fmt.Sprintf` with `strconv.Append*` (Ex. 8, when `convT*` shows); batch cgo (Ex. 14, when `cgocall` shows per-record); cache reflect plans or use codegen (Ex. 15, when reflect methods show); refactor to avoid escape (Ex. 4, when `mallocgc` shows on a leaf and `-gcflags="-m"` confirms).

**Specialty:** hand-written arena allocators for parser/AST workloads with millions of nodes; custom lock-free queues for SPSC ring buffers; pinned-OS-thread workers for hardware syscalls (io_uring, perf_event); custom GC tuning via `debug.SetMemoryLimit` and tuned `GOGC` for batch jobs with large persistent heaps.

The runtime is fast — extraordinarily so, given what it does. Most overhead is self-inflicted: spawning goroutines for nanoseconds of work, choosing channels where atomics suffice, allocating where stacks would do, paying for `time.After` you forgot to stop. Read `runtime/proc.go`, `runtime/chan.go`, `runtime/malloc.go`, `runtime/time.go`, and `runtime/cgocall.go` once — three hours of source-diving — and you'll spot these patterns in your own code for the rest of your career. Profile, find the signature, apply the matching exercise. The runtime's hot paths are short and well-engineered; the user code calling them is where the wins live.
