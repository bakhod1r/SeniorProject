# Scheduler Source — Optimization

## 1. How to use this file

Fifteen scenarios where code that looks scheduler-friendly is actually fighting the runtime. Each entry has a **Before** (slow code + benchmark + scheduler-level explanation of why), a collapsible **Hint**, and a collapsible **Solution** (optimized code + benchmark + before/after numbers + explanation rooted in scheduler mechanics).

Anchored at Go 1.23, amd64, `GOMAXPROCS=8` on a quiet machine. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Scheduler cost on the hot path is dominated by six things: per-G creation in `newproc`, park/unpark trips through `gopark`/`goready`, syscall handoffs through `entersyscall`/`exitsyscall`, channel ops landing on `chansend`/`chanrecv` slow paths, runqueue contention with work stealing, and M-pinning via `LockOSThread`. Most wins remove one of those six from the hot path.

Reading order: Ex. 1 (goroutine-per-item), Ex. 5 (channel counter), Ex. 12 (GOMAXPROCS), then any order. Ex. 3, 7, 17 are the ones senior reviews flag most.

If you have not read `junior.md` for this topic, do that first — the `g`/`m`/`p` mental model and the `findRunnable` walk are assumed below.

---

## 2. Exercise 1 — Goroutine-per-item for cheap work

**Difficulty:** Junior+
**Skills:** worker pools, `runtime.newproc` cost, batching

A request handler kicks off one goroutine per item to do a few hundred nanoseconds of work each. With 100k items per request, the runtime burns more time spinning up Gs than doing the work.

```go
func ProcessAll(items []Item) []Result {
    out := make([]Result, len(items))
    var wg sync.WaitGroup
    for i, it := range items {
        wg.Add(1)
        go func(i int, it Item) {
            defer wg.Done()
            out[i] = transform(it) // ~200 ns of work
        }(i, it)
    }
    wg.Wait()
    return out
}
```

```
BenchmarkGoroutinePerItem-8   30   38000000 ns/op   8400000 B/op   200001 allocs/op  // 100k items
```

**Why it's slow:** Every `go` statement enters `runtime.newproc` → allocates a `g` (~2 KB stack + `g` struct, ~232 B header), enqueues it onto the P's local runqueue, then potentially wakes an idle M via `wakep`. The `g` struct itself doesn't escape to the heap (it comes from a per-P free list), but the stack and the bookkeeping are real. At 100k goroutines, you pay ~120 ns per `newproc` plus the contention on `runqput` overflow that spills into the global runqueue. The transform itself takes 200 ns — you doubled the wall time on scheduling alone.

<details><summary>Hint</summary>

You don't need 100k Gs. You need `GOMAXPROCS` Gs, each pulling work from a queue. A worker-pool with batched ranges over the input lets each G amortize its creation cost over thousands of items.

</details>

<details><summary>Solution</summary>

Fan out `GOMAXPROCS` workers, each chewing a contiguous slice. Creation cost drops from 100k Gs to 8.

```go
func ProcessAll(items []Item) []Result {
    out := make([]Result, len(items))
    n := runtime.GOMAXPROCS(0)
    var wg sync.WaitGroup
    chunk := (len(items) + n - 1) / n
    for w := 0; w < n; w++ {
        lo := w * chunk
        hi := lo + chunk
        if hi > len(items) { hi = len(items) }
        if lo >= hi { break }
        wg.Add(1)
        go func(lo, hi int) {
            defer wg.Done()
            for i := lo; i < hi; i++ {
                out[i] = transform(items[i])
            }
        }(lo, hi)
    }
    wg.Wait()
    return out
}
```

```
BenchmarkWorkerPool-8   1300   910000 ns/op   192 B/op   9 allocs/op
```

~42× faster, ~44000× fewer allocations.

**Why faster:** 8 calls to `newproc` instead of 100k. Each worker holds its G for the whole batch, so its stack stays hot in cache. No runqueue overflow into the global queue, no `wakep` storm. Output slice writes are still contention-free because each worker owns a disjoint range.
**Trade-off:** Static chunking can starve workers on skewed item costs — switch to a `chan Item` with `cap = GOMAXPROCS` if `transform` time varies by 10× or more.
**When NOT:** When the per-item work is genuinely 10+ ms — at that point the `newproc` cost is invisible and the simpler goroutine-per-item form keeps the code readable.

</details>

---

## 3. Exercise 2 — `runtime.LockOSThread` in a generic worker

**Difficulty:** Senior
**Skills:** OS-thread pinning, work stealing, when pinning is required

A worker pool calls `runtime.LockOSThread()` at startup "for stability." None of the work needs thread-local state. The result: those Ms are now permanently dedicated, work stealing can't touch the Gs queued on them, and the scheduler can't park them when they go idle.

```go
func runWorker(jobs <-chan Job) {
    runtime.LockOSThread() // unnecessary
    defer runtime.UnlockOSThread()
    for j := range jobs {
        process(j)
    }
}
```

```
BenchmarkLockedWorkers-8   80   14000000 ns/op   // unbalanced load, 8 workers, 8 cores
```

**Why it's slow:** `LockOSThread` sets `g.lockedm` and `m.lockedg`. The scheduler refuses to run that G on any other M, and refuses to park that M while the G is alive. When the locked worker's runqueue empties, `findRunnable` on the other Ps will still steal from it (the P is fine), but the locked G itself stays glued to its M — a syscall it makes pins the whole M for the syscall's duration with no handoff. Worse: if you have 8 cores and 8 locked workers, an idle worker's M sits in `mPark` consuming an OS-thread slot that the scheduler can't recycle for a non-locked task.

<details><summary>Hint</summary>

`LockOSThread` is only required when the work needs thread-local state from C, OpenGL contexts, signal masks, `seccomp` rules, or `setns`. Pure Go work never needs it. Audit your worker — is there cgo using TLS? An `EGLContext`? If not, the call is cargo-cult.

</details>

<details><summary>Solution</summary>

Just delete the call. The G now runs on whichever M `findRunnable` puts it on.

```go
func runWorker(jobs <-chan Job) {
    for j := range jobs {
        process(j)
    }
}
```

```
BenchmarkUnlockedWorkers-8   240   4700000 ns/op
```

~3× faster on unbalanced workloads.

**Why faster:** Without the lock, the G is a normal candidate for `runqsteal` from other Ps. When one worker finishes its queue early, idle Ps steal from busy ones — load self-balances. When the G blocks on the channel receive, the M is parked back into the M-cache and can be picked up by `startTheWorld` later. The whole pool acts like a unified `GOMAXPROCS` workforce instead of 8 independent silos.
**Trade-off:** None for pure-Go workers. If you ever add cgo to a `runWorker` body that holds OS-thread-bound state (e.g. CUDA), you'll need to put the lock back — but at that point you also need to pin the C-side resource lifetime.
**When NOT:** Workers driving an OpenGL/Vulkan context, calling C libraries that store state in TLS (some BLAS implementations), or holding `signal.Notify` on a thread-bound signal handler.

</details>

---

## 4. Exercise 3 — Excessive `runtime.Gosched()` calls

**Difficulty:** Mid
**Skills:** cooperative scheduling, asynchronous preemption (Go 1.14+), when Gosched is needed

A hot loop sprinkles `runtime.Gosched()` to "be polite to the scheduler." Each call enters `schedule()`, walks the runqueues looking for another runnable G, and only returns when nothing better is available. The yield is free when the runqueue is empty — but you pay the function-call cost every iteration anyway.

```go
func sumOddly(xs []int64) int64 {
    var total int64
    for _, x := range xs {
        total += x
        runtime.Gosched() // "polite"
    }
    return total
}
```

```
BenchmarkSumWithGosched-8   200   6100000 ns/op   // 1M items
```

**Why it's slow:** `runtime.Gosched` calls `mcall(gosched_m)`. The G is put back onto the P's local runqueue (tail position), the M re-enters `schedule()`, which calls `findRunnable`. `findRunnable` checks the local queue (1 item — this G), the global queue, the netpoller, then attempts work stealing. Even when it picks our G right back up, that's ~80–150 ns burned per iteration. Across 1M items, that's 80–150 ms of pure scheduler overhead.

<details><summary>Hint</summary>

Since Go 1.14, the scheduler can asynchronously preempt long-running Gs via a signal (`SIGURG`). The runtime checks at function-prologue safepoints every ~10 ms. Manual `Gosched` is almost never necessary in a CPU-bound loop — and harmful in a hot one.

</details>

<details><summary>Solution</summary>

Delete the yield. The async preemptor handles 10 ms timeslices automatically.

```go
func sumOddly(xs []int64) int64 {
    var total int64
    for _, x := range xs {
        total += x
    }
    return total
}
```

```
BenchmarkSumPlain-8   3000   380000 ns/op
```

~16× faster.

**Why faster:** The loop body is now 2–3 cycles. No `mcall`, no `findRunnable`, no runqueue churn. The async preemptor at Go 1.14+ takes care of the 10 ms slice ceiling — if this loop blocked another G for too long, the runtime would `signal_preempt` the M, the G's safepoint poll would yield, and the scheduler picks the next runnable G. You don't manage it; the runtime does.
**Trade-off:** A genuinely tight, long loop with no function calls inside it has no safepoints to preempt at — async preemption inserts a signal handler that simulates a function call entry. This was the explicit fix in Go 1.14; pre-1.14 loops could indeed hang the scheduler.
**When NOT:** Embedding a long busy-wait inside a signal handler or a `LockOSThread`-pinned region where async preemption is disabled — there `Gosched` is the one cooperative hook you have. Also useful in benchmark stress tests to force scheduler rotation.

</details>

---

## 5. Exercise 4 — Spawning goroutines inside a hot request path

**Difficulty:** Mid
**Skills:** worker reuse, `newproc` amortization, p99 latency

An HTTP handler spawns 4 goroutines per request to parallelize subtasks. At 5k RPS that's 20k Gs/s being created and destroyed. The runtime spends real CPU just managing the churn.

```go
func handleRequest(req Request) Response {
    var wg sync.WaitGroup
    var a, b, c, d Result
    wg.Add(4)
    go func() { defer wg.Done(); a = subtaskA(req) }()
    go func() { defer wg.Done(); b = subtaskB(req) }()
    go func() { defer wg.Done(); c = subtaskC(req) }()
    go func() { defer wg.Done(); d = subtaskD(req) }()
    wg.Wait()
    return combine(a, b, c, d)
}
```

```
BenchmarkSpawnPerReq-8   18000   65000 ns/op   2400 B/op   8 allocs/op  // each subtask ~10us
```

**Why it's slow:** Every request enters `newproc` four times. Each spawn allocates a `g` from the per-P `gFree` list (cheap) or from the heap (expensive when the free list drains). At 20k Gs/s, the free list churns; the runtime periodically drains the global `sched.gFree` back to per-P caches under the `sched.lock`. The p99 picks up the stalls when contention hits.

<details><summary>Hint</summary>

Keep the workers around. A long-lived worker per subtask, fed by a per-worker channel, pays the `newproc` cost once. The request side sends 4 jobs and waits — no spawning per request.

</details>

<details><summary>Solution</summary>

Persistent worker pool, one G per subtask kind, fed by a channel.

```go
type subtaskPool struct {
    in  chan job
    out chan Result
}

func newSubtaskPool(workers int, fn func(Request) Result) *subtaskPool {
    p := &subtaskPool{in: make(chan job, workers), out: make(chan Result, workers)}
    for i := 0; i < workers; i++ {
        go func() {
            for j := range p.in {
                j.out <- fn(j.req)
            }
        }()
    }
    return p
}

type job struct {
    req Request
    out chan Result
}

// Pre-warmed at startup. Reused for every request.
var poolA, poolB, poolC, poolD *subtaskPool

func handleRequest(req Request) Response {
    aCh, bCh, cCh, dCh := make(chan Result, 1), make(chan Result, 1), make(chan Result, 1), make(chan Result, 1)
    poolA.in <- job{req, aCh}
    poolB.in <- job{req, bCh}
    poolC.in <- job{req, cCh}
    poolD.in <- job{req, dCh}
    return combine(<-aCh, <-bCh, <-cCh, <-dCh)
}
```

```
BenchmarkPooledWorkers-8   42000   28000 ns/op   1280 B/op   8 allocs/op
```

~2.3× faster, much better p99 stability.

**Why faster:** No `newproc` on the request path. The four worker Gs were created once at startup and reuse their stacks. The channel sends hit the fast path (`chansend` non-blocking when worker is parked on receive — receiver `g` is in `runnext` slot on its P), so the worker wakes immediately via `goready` without entering the global queue. The result channels are buffered with cap 1 so the worker never blocks sending back.
**Trade-off:** Capacity planning matters — too few workers and requests queue, too many and you pay for Gs sitting idle. Size to your peak in-flight count × subtasks. Result channels per request still allocate; for ultra-low-latency, switch to a result struct with `sync.WaitGroup` or `chan struct{}` signaling.
**When NOT:** Requests are rare (< 100 RPS). Subtasks have wildly different cost so a fixed pool starves on slow ones — use `errgroup` with `SetLimit` instead.

</details>

---

## 6. Exercise 5 — Channel-based counter

**Difficulty:** Mid
**Skills:** `chansend1` cost, `atomic.AddInt64`, sync primitives

A worker pool reports completed tasks by sending `1` on a counter channel. A collector G sums them. Every increment goes through `chansend1` → potentially `gopark` if the channel is full → wake the collector via `goready`. At 1M ops/s, the scheduler chokes.

```go
var counterCh = make(chan int64, 1024)

func collect() {
    var total int64
    for n := range counterCh { total += n }
    fmt.Println(total)
}

func worker(jobs <-chan Job) {
    for j := range jobs {
        process(j)
        counterCh <- 1
    }
}
```

```
BenchmarkChannelCounter-8   80   14000000 ns/op   // 1M increments, 8 workers
```

**Why it's slow:** `chansend1` on a buffered channel: acquire the channel's mutex, check `qcount < dataqsiz`, copy 8 B into the ring, release the mutex, optionally `goready` a parked receiver. Even on the fast path (no parking), that's ~50–80 ns of locked work plus cross-CPU cache invalidation of the channel header. With 8 producers hammering one channel header, the cacheline ping-pongs across cores and effective throughput collapses to single-digit M-ops/sec.

<details><summary>Hint</summary>

You don't need ordered delivery, batching, or the goroutine wakeup mechanism — you need a number to go up. `atomic.AddInt64` is one `LOCK XADD` instruction.

</details>

<details><summary>Solution</summary>

Atomic counter, read once at the end.

```go
var counter int64

func worker(jobs <-chan Job) {
    for j := range jobs {
        process(j)
        atomic.AddInt64(&counter, 1)
    }
}

func report() { fmt.Println(atomic.LoadInt64(&counter)) }
```

```
BenchmarkAtomicCounter-8   3200   320000 ns/op
```

~44× faster.

**Why faster:** No channel header, no mutex, no scheduler trip. `LOCK XADD` is ~5–20 ns under contention (still cacheline ping-pong, but no software overhead on top). The collector G is gone entirely — one less runnable G the scheduler has to manage. For really hot counters with N cores, shard the counter into `[N]int64` aligned to 64 B and sum on read; eliminates the cacheline bouncing too.
**Trade-off:** Loses the ability to react to each increment (e.g. "print every 1000th"). For that, a channel of batches (`chan int64` with the worker accumulating locally and sending every 1024 ops) keeps both properties cheaply.
**When NOT:** When the receiver actually needs to do per-event work — log, audit, ship to a metrics sink. Then channel-as-queue is the right shape.

</details>

---

## 7. Exercise 6 — Channel sync where a Mutex would do

**Difficulty:** Mid
**Skills:** `sync.Mutex` vs channel, scheduler cost of channel ops

A small map is guarded by a "request-response" channel — a goroutine owns the map and others send updates through a channel. Idiomatic for actor-style code, but the scheduler trips cost more than the mutex it replaces.

```go
type setCmd struct{ k string; v int; done chan struct{} }
var cmds = make(chan setCmd)

func owner(m map[string]int) {
    for c := range cmds {
        m[c.k] = c.v
        close(c.done)
    }
}

func Set(k string, v int) {
    done := make(chan struct{})
    cmds <- setCmd{k, v, done}
    <-done
}
```

```
BenchmarkChannelOwnedMap-8   600   2000000 ns/op   96 B/op   2 allocs/op  // per Set
```

**Why it's slow:** Each `Set` allocates a `chan struct{}`, sends through the cmds channel (often blocking, so `gopark` + `goready`), waits on `done` (another `gopark` + `goready`). Two full scheduler round-trips per write. On a single core, that's ~600 ns per write just in scheduling. The map mutation itself is ~30 ns.

<details><summary>Hint</summary>

If you don't need event ordering across multiple writers, a `sync.Mutex` is plain memory access plus one futex (uncontended: never; contended: rarely). Channels make sense for queueing work, request batching, or fan-out — not for "let me write this one field."

</details>

<details><summary>Solution</summary>

Plain mutex, no owner goroutine.

```go
var (
    mu sync.Mutex
    m  = make(map[string]int)
)

func Set(k string, v int) {
    mu.Lock()
    m[k] = v
    mu.Unlock()
}
```

```
BenchmarkMutexMap-8   25000   50000 ns/op   0 B/op   0 allocs/op
```

~40× faster, zero allocations.

**Why faster:** Uncontended `Mutex.Lock` is a single `CMPXCHG` — no scheduler involvement. Contended path falls through to `runtime_SemacquireMutex` which does park the G, but for short critical sections (a single map store) contention is rare. No owner G to schedule, no done-channel allocation per call, no two-step park/unpark dance.
**Trade-off:** Mutex doesn't preserve ordering across writers — channels do (FIFO send order). If your invariant depends on ordering, you need either a channel or `Mutex` + an explicit sequence number.
**When NOT:** Truly actor-shaped state where the owner does batched processing, dedup across cmds, or has its own lifecycle. Then the channel is structural, not just a lock substitute.

</details>

---

## 8. Exercise 7 — Many goroutines contending on one Mutex

**Difficulty:** Senior
**Skills:** lock contention, sharded locks, `runtime_SemacquireMutex` cost

A cache uses a single `sync.RWMutex` over a `map[string]V`. 32 reader goroutines, each calling `Get` at ~50k ops/s. Contention on the mutex internals (the semaphore waitlist) starves the scheduler.

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string]V
}

func (c *Cache) Get(k string) (V, bool) {
    c.mu.RLock()
    v, ok := c.m[k]
    c.mu.RUnlock()
    return v, ok
}
```

```
BenchmarkSingleLock-8   200   6500000 ns/op   // 32 readers, mixed keys
```

**Why it's slow:** `RLock` is a single atomic increment on the uncontended path, but the contended path enters `runtime_Semacquire`, which `gopark`s the G with reason `waitReasonSemacquire`. With 32 readers spraying lookups, the per-mutex atomic line ping-pongs across 32 cores. Worse, when a writer is contended, the readers all queue on the semaphore's waitlist — each wakeup is a `goready` → runqueue insert → eventual `schedule()` pickup. The scheduler is healthy; the lock is the bottleneck and the parked Gs are scheduler load.

<details><summary>Hint</summary>

Hash the key; pick one of N stripes. Each stripe has its own lock. Contention drops by ~N for uniformly distributed keys. This is what `sync.Map` does internally for the read-mostly path, but a tunable striped map is often clearer.

</details>

<details><summary>Solution</summary>

Sharded cache with `numShards` independent RWMutexes.

```go
const numShards = 32

type shard struct {
    mu sync.RWMutex
    m  map[string]V
    _  [40]byte // pad to 64 B to avoid false sharing of mu
}

type Cache struct {
    shards [numShards]shard
}

func (c *Cache) shardFor(k string) *shard {
    h := fnv.New32a()
    h.Write([]byte(k))
    return &c.shards[h.Sum32()%numShards]
}

func (c *Cache) Get(k string) (V, bool) {
    s := c.shardFor(k)
    s.mu.RLock()
    v, ok := s.m[k]
    s.mu.RUnlock()
    return v, ok
}
```

```
BenchmarkShardedCache-8   3200   400000 ns/op
```

~16× faster on 32-reader contention.

**Why faster:** Each shard's mutex header lives on its own cacheline (padding avoids false sharing). 32 readers spread across 32 shards see uncontended `RLock` 31/32 of the time — the atomic stays exclusive on one core. The semaphore parking path is rarely hit, so `gopark`/`goready` traffic disappears. The scheduler's per-P runqueues stay quiet because no readers are getting parked.
**Trade-off:** Hot keys (one key seeing 90% of traffic) still funnel through one shard — sharding by hash doesn't help. For known hot keys, layer a per-CPU read cache (`runtime_procPin`) above the shards.
**When NOT:** Cache size < 1000 entries and ops < 100k/s — the shard count dwarfs the working set, and the FNV hash is overhead. A single RWMutex is fine. Also avoid when iteration order matters (sharding scrambles it).

</details>

---

## 9. Exercise 8 — Worker pool funnel: all workers on one channel

**Difficulty:** Senior
**Skills:** channel contention, fan-out queues, P-local work

A "high-throughput" pool has 64 workers, all blocked on a single `chan Job`. The dispatcher sends 500k jobs/s. The channel's mutex serializes all sends — your 64-worker pool effectively runs at single-channel throughput.

```go
var jobs = make(chan Job, 1024)

func startWorkers(n int) {
    for i := 0; i < n; i++ {
        go func() { for j := range jobs { process(j) } }()
    }
}

func dispatch(js []Job) {
    for _, j := range js { jobs <- j }
}
```

```
BenchmarkSingleChannelPool-8   30   38000000 ns/op   // 500k jobs, 64 workers
```

**Why it's slow:** Every `jobs <- j` and every `<-jobs` takes `c.lock` on the channel. With 65 goroutines (1 sender, 64 receivers) all hitting the same lock, you serialize on a single cacheline. Worse, when 64 receivers all park on the channel's `recvq`, each enqueue is a sender → `goready(receiver)`, the receiver wakes, dequeues, processes, comes back to recv → parks again. The lock is held during the entire `goready` path. Throughput collapses to roughly the latency of a `gopark`/`goready` round-trip (~1 µs), so ~1M ops/s max regardless of how many workers you add past ~4.

<details><summary>Hint</summary>

Give each worker its own channel. Dispatcher round-robins jobs across the N channels. Each channel has at most one receiver and (usually) one sender at any moment — uncontended fast path on every op.

</details>

<details><summary>Solution</summary>

N per-worker channels, dispatched round-robin.

```go
type pool struct {
    chans []chan Job
}

func newPool(n int, bufPerWorker int) *pool {
    p := &pool{chans: make([]chan Job, n)}
    for i := 0; i < n; i++ {
        p.chans[i] = make(chan Job, bufPerWorker)
        ch := p.chans[i]
        go func() { for j := range ch { process(j) } }()
    }
    return p
}

func (p *pool) Dispatch(js []Job) {
    n := uint64(len(p.chans))
    for i, j := range js {
        p.chans[uint64(i)%n] <- j
    }
}
```

```
BenchmarkPerWorkerChannel-8   170   6800000 ns/op
```

~5.5× faster.

**Why faster:** Each channel's mutex is uncontended — the sender and receiver alternate ownership of one cacheline instead of 64 goroutines spraying it. Buffered ops hit the fast path (`chansend` enqueues to the ring without parking the sender; `chanrecv` dequeues without parking the receiver) when buffers stay above empty and below full. The scheduler's `goready` work drops accordingly.
**Trade-off:** Round-robin doesn't load-balance under skewed job costs. A slow worker on shard 5 backs up everyone hashing to shard 5. Either steal jobs across channels (complex) or use a `select` over a small fan-in.
**When NOT:** Job dispatch rate < 100k/s — single channel is simpler and the contention is invisible. Jobs with wildly variable cost — work-stealing-style (per-worker queue + steal from neighbors) wins.

</details>

---

## 10. Exercise 9 — Blocking file I/O in a tight loop

**Difficulty:** Senior
**Skills:** `entersyscall`/`exitsyscall`, P handoff, batching

A producer reads small records from a file one at a time. Each `Read(8 bytes)` enters a syscall, the M is detached from its P, another M may take over the P, then on `Read` return `exitsyscall` re-acquires (or steals) a P. At millions of reads/s the syscall handshake dominates.

```go
func readAll(f *os.File) []Record {
    var out []Record
    var buf [8]byte
    for {
        n, err := f.Read(buf[:])
        if n == 8 { out = append(out, decode(buf)) }
        if err != nil { break }
    }
    return out
}
```

```
BenchmarkSmallReads-8   3   420000000 ns/op   // 1M records of 8 B each
```

**Why it's slow:** Every `Read` is a syscall. On entry, `runtime.entersyscall` releases the P (so other Gs can run), bumps `sched.sysmonwait` paths, and possibly hands the P to `sysmon` if it doesn't return fast. On exit, `exitsyscall` tries to grab a P back; if its old P is busy, it goes through `acquirep` slow paths (or parks). Each round-trip is ~300–500 ns just in scheduler bookkeeping, on top of the kernel cost. With 1M reads, that's 300–500 ms on scheduler trips alone.

<details><summary>Hint</summary>

`bufio.Reader` exists. One syscall every 4 KB instead of one per 8 B is 512× fewer scheduler trips.

</details>

<details><summary>Solution</summary>

Buffer the reads.

```go
func readAll(f *os.File) []Record {
    br := bufio.NewReaderSize(f, 64*1024)
    var out []Record
    var buf [8]byte
    for {
        n, err := io.ReadFull(br, buf[:])
        if n == 8 { out = append(out, decode(buf)) }
        if err != nil { break }
    }
    return out
}
```

```
BenchmarkBufferedReads-8   85   14000000 ns/op
```

~30× faster.

**Why faster:** `bufio.Reader` fills its 64 KB internal buffer with one syscall (so ~16 syscalls for 1 M × 8 B records instead of 1 M). All other `ReadFull` calls are memory copies from the buffer — no scheduler trip. `entersyscall`/`exitsyscall` overhead drops by ~62500×. The G that was reading no longer churns its P attachment thousands of times per second; the scheduler's `sysmon` thread stops shepherding it.
**Trade-off:** Buffered reads delay error visibility — if the file is corrupted at byte 8, you won't see it until the buffer pulls in the bad bytes. Also adds memory: 64 KB per reader.
**When NOT:** Reading exactly one record from a file. Streaming where each kernel-level read carries semantic meaning (e.g. a SOCK_DGRAM where each `Read` is one packet) — buffering merges packets and breaks framing.

</details>

---

## 11. Exercise 10 — `time.After` in a for-select loop

**Difficulty:** Mid
**Skills:** timer goroutine leak, `runtime.timers`, `Timer.Reset`

A connection reader uses `time.After` inside a `for-select` to time out idle connections. Every loop iteration that doesn't fire the timer leaves a runtime timer (and its underlying G's reference) alive until the deadline elapses — at high event rates, timers pile up.

```go
func readLoop(ctx context.Context, ch <-chan Msg) {
    for {
        select {
        case <-ctx.Done(): return
        case m := <-ch: handle(m)
        case <-time.After(5 * time.Second): // new timer every iteration
            log.Println("idle timeout")
            return
        }
    }
}
```

```
BenchmarkTimeAfterLoop-8   400   3000000 ns/op   320 B/op   4 allocs/op  // per iteration
```

**Why it's slow:** `time.After` allocates a `runtimeTimer` and adds it to the runtime's `timers` heap. The heap is per-P; insertion is O(log n) and contention on `runtime.netpollGenericInit`'s timer code is a real cost. When `ch` fires first, the unfired `time.After` timer is *not* canceled — it stays in the heap until 5 s later, when the runtime's timer goroutine fires it (into a now-unread channel) and finally garbage-collects it. At 10k msgs/s, you have 50k zombie timers in the heap at any moment, all walked by `runtime.checkTimers` during `findRunnable`.

<details><summary>Hint</summary>

Allocate one `time.Timer` outside the loop and `Reset` it each iteration. Cancel it via `Stop` when not used.

</details>

<details><summary>Solution</summary>

Reuse a single timer; reset on each pass.

```go
func readLoop(ctx context.Context, ch <-chan Msg) {
    t := time.NewTimer(5 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(5 * time.Second)
        select {
        case <-ctx.Done(): return
        case m := <-ch: handle(m)
        case <-t.C:
            log.Println("idle timeout")
            return
        }
    }
}
```

```
BenchmarkTimerReset-8   4200   280000 ns/op   0 B/op   0 allocs/op
```

~10× faster, zero allocations per iteration.

**Why faster:** One timer in the heap instead of N. `Reset` updates the existing heap entry's `when` field and sifts it up/down — much cheaper than insert + zombie removal. The `runtime.timers` array stays tiny, so `findRunnable`'s timer check returns in 10 ns instead of walking a heap of zombies.
**Trade-off:** The `Stop`/drain dance is finicky. Go 1.23 fixed many edge cases (`Timer.Reset` is now safe to call concurrently with a draining receive). Pre-1.23 needs care.
**When NOT:** The select fires the timer almost every time (long timeout, rare events) — `time.After` is fine then. Or one-shot timeouts outside a loop.

</details>

---

## 12. Exercise 11 — cgo in a hot loop

**Difficulty:** Senior
**Skills:** cgo overhead, `entersyscall`/`exitsyscall`, batching across the FFI

A hashing function delegates each block to a C library via cgo. Every call enters a syscall-like transition: G detaches from its P, M switches to the cgo stack, runs C code, returns through `cgocall` and re-acquires a P.

```go
/*
#include "fasthash.h"
*/
import "C"

func HashAll(blocks [][]byte) []uint64 {
    out := make([]uint64, len(blocks))
    for i, b := range blocks {
        out[i] = uint64(C.fasthash((*C.uint8_t)(&b[0]), C.size_t(len(b))))
    }
    return out
}
```

```
BenchmarkCgoPerBlock-8   400   2900000 ns/op   // 10k blocks of 64 B each
```

**Why it's slow:** Each cgo call enters `runtime.cgocall` → `entersyscall` → switches to a system stack → runs C → `exitsyscall` → re-acquires P. Even a no-op C function pays ~150–200 ns of scheduler bookkeeping. The G is treated like it's in a syscall, so its P can be stolen by `sysmon`; on return, `exitsyscall` may have to spin or steal a P. With 10k blocks at 200 ns/transition, you spend 2 ms in scheduler glue for 10k actual hashes.

<details><summary>Hint</summary>

Pay the transition once. Pass an array of blocks (or a single concatenated buffer with offsets) to one C function that loops in C. Amortize the cgo cost over all blocks.

</details>

<details><summary>Solution</summary>

Batch the work across the FFI boundary.

```go
/*
#include "fasthash.h"
void fasthash_batch(const uint8_t **bufs, const size_t *lens, size_t n, uint64_t *out);
*/
import "C"

func HashAll(blocks [][]byte) []uint64 {
    n := len(blocks)
    bufs := make([]*C.uint8_t, n)
    lens := make([]C.size_t, n)
    for i, b := range blocks {
        bufs[i] = (*C.uint8_t)(&b[0])
        lens[i] = C.size_t(len(b))
    }
    out := make([]uint64, n)
    C.fasthash_batch(&bufs[0], &lens[0], C.size_t(n),
        (*C.uint64_t)(&out[0]))
    return out
}
```

```
BenchmarkCgoBatch-8   6000   200000 ns/op
```

~14× faster.

**Why faster:** One `cgocall` instead of 10k. `entersyscall`/`exitsyscall` overhead drops 10000×. The C side loops with native speed, hot in icache. The G stays attached to its P (the syscall transition happens once, the P likely isn't stolen during a short batch), so `exitsyscall` hits the fast path on return.
**Trade-off:** Memory pinning: the Go slices passed to C must not be moved or freed during the call. Go pins them during cgo automatically, but you can't be running concurrent GC compaction across the boundary. Also: error handling is harder when N inputs are processed in one call.
**When NOT:** Blocks are huge (1 MB each) — the per-call overhead is invisible relative to the work, and per-block error handling is easier. Also avoid when calls are rare.

</details>

---

## 13. Exercise 12 — Default GOMAXPROCS under CPU quotas

**Difficulty:** Senior
**Skills:** container CPU limits, `GOMAXPROCS` sizing, `automaxprocs`

A service runs in a container with CPU quota 2.5 (Kubernetes `limits.cpu: 2500m`). Go's default `GOMAXPROCS` reads `runtime.NumCPU()`, which returns the host's logical CPU count — say 64. The runtime sees 64 Ps, schedules aggressively, the kernel throttles via CFS, and the service exhibits 100 ms+ latency spikes whenever its CPU budget runs out.

```go
// main.go
func main() {
    // No GOMAXPROCS configuration. Defaults to 64 on a 64-core node.
    server.Run()
}
```

```
BenchmarkInContainer-8   p50: 5ms   p99: 180ms   // measured under load, CPU quota 2.5
```

**Why it's slow:** `runtime.NumCPU` reads `/proc/cpuinfo`, which reports the host's CPUs — it does not respect the cgroup CFS quota. The Go runtime creates 64 Ps; under load, all 64 try to run Gs in parallel. The kernel's CFS scheduler then throttles the cgroup once it exceeds 2.5 CPU-seconds per quota period (default 100 ms). The throttle preempts arbitrary Ms mid-G, leaving Gs parked across the runqueues with no M to run them. p99 latency jumps because some requests are sitting on a P whose M has been forcibly suspended for tens of milliseconds.

<details><summary>Hint</summary>

Either set `GOMAXPROCS` explicitly to the integer CPU quota (round down) at startup, or use `go.uber.org/automaxprocs` which reads the cgroup limit automatically.

</details>

<details><summary>Solution</summary>

Set it explicitly, or import automaxprocs.

```go
import _ "go.uber.org/automaxprocs" // reads cgroup CFS quota at init

func main() {
    server.Run()
}
```

Or manually:

```go
func main() {
    if q, ok := readCFSQuota(); ok {
        runtime.GOMAXPROCS(q)
    }
    server.Run()
}
```

```
BenchmarkInContainerTuned-8   p50: 4ms   p99: 9ms
```

p99 drops from 180 ms to 9 ms.

**Why faster:** With `GOMAXPROCS=2`, the runtime creates 2 Ps. The kernel never has to throttle because the runtime won't try to use more than 2 CPUs of wall-clock time per second. No mid-G suspensions, no parked Gs waiting for their throttled M. The scheduler's `findRunnable` work stays bounded to 2 local runqueues + the global queue.
**Trade-off:** You cap parallelism. If the host has spare capacity and your quota is set low for billing reasons, you're not exploiting burst — but you're also not creating tail-latency disasters when you do.
**When NOT:** Bare-metal deployments with no cgroup limits. Single-tenant VMs where the OS isn't multiplexing your cores. Then `NumCPU` is correct.

</details>

---

## 14. Exercise 13 — `runtime.NumGoroutine` in a hot path

**Difficulty:** Mid
**Skills:** atomic reads under contention, observability cost

A handler logs `runtime.NumGoroutine()` on every request "for visibility." The call is a single atomic load — sounds free, but at 200k req/s across cores it cachelines the global `sched.gcount` variable.

```go
func handle(w http.ResponseWriter, r *http.Request) {
    metrics.Gauge("goroutines", float64(runtime.NumGoroutine()))
    do(r)
}
```

```
BenchmarkLogNumG-8   1500000   800 ns/op   // includes do()
```

**Why it's slow:** `runtime.NumGoroutine` returns `gcount()` which is `int32(atomic.Loadint32(&sched.gcount)) - sched.gFree.n - atomic.Loadint32(&sched.ngsys)`. The atomic loads themselves are 1–2 ns each, but `sched.gcount` is also *written* every `newproc` and `gfput`. Reading it pulls the cacheline into your core, the next `go` statement on another core writes it and invalidates yours — ping-pong. At 200k req/s × 8 cores, the cacheline bounces ~1.6M times/s, slowing both the readers and every `newproc` in the program.

<details><summary>Hint</summary>

You don't need exact realtime visibility. Sample every N requests (or every Ns), or push the value from a single timer goroutine into your metrics sink.

</details>

<details><summary>Solution</summary>

Sampled or background-pushed.

```go
var sampled int64

func handle(w http.ResponseWriter, r *http.Request) {
    if atomic.AddInt64(&sampled, 1)%1024 == 0 {
        metrics.Gauge("goroutines", float64(runtime.NumGoroutine()))
    }
    do(r)
}

// Or, better: push from a single goroutine.
func init() {
    go func() {
        t := time.NewTicker(time.Second)
        for range t.C {
            metrics.Gauge("goroutines", float64(runtime.NumGoroutine()))
        }
    }()
}
```

```
BenchmarkSampledNumG-8   2500000   480 ns/op
```

~1.7× faster on the request path, eliminates the global cacheline thrash.

**Why faster:** 1024× fewer reads of `sched.gcount`. The cacheline stays in the writing cores' caches; the runtime's `newproc` no longer competes with the observability reads. The single-goroutine push form is even better: one reader, no contention with `newproc` at all.
**Trade-off:** You lose per-request visibility. For an alert on a sudden G explosion, 1 s polling is plenty. For debugging a per-request leak, an explicit `pprof.Lookup("goroutine")` snapshot is more useful anyway.
**When NOT:** Low-frequency endpoints (admin, debug) where per-call cost is invisible. Test code where determinism matters more than throughput.

</details>

---

## 15. Exercise 14 — Producer pacing with `time.Sleep(0)`

**Difficulty:** Mid
**Skills:** `Sleep(0)` vs Gosched, busy-yield idioms

A producer streams events into a channel "as fast as possible but cooperatively" by sleeping 0 between pushes. `Sleep(0)` on Go's scheduler is essentially `Gosched()` — a full scheduler trip per iteration.

```go
func produce(out chan<- Event, src <-chan Event) {
    for e := range src {
        out <- e
        time.Sleep(0) // "be cooperative"
    }
}
```

```
BenchmarkSleepZero-8   60   20000000 ns/op   // 1M events
```

**Why it's slow:** `time.Sleep(0)` internally calls `runtime.gopark` with a 0 duration → wakes immediately → goes through `findRunnable` again. It's a Gosched dressed up. Asymmetric: the cost is identical to `runtime.Gosched()`, but the intent is hidden so reviewers miss it.

<details><summary>Hint</summary>

The `out <- e` send is itself a cooperative yield point if the channel is full (parks the producer until a receiver shows up). You don't need additional yielding.

</details>

<details><summary>Solution</summary>

Drop the sleep. The channel send paces the loop.

```go
func produce(out chan<- Event, src <-chan Event) {
    for e := range src {
        out <- e
    }
}
```

```
BenchmarkNoSleep-8   1100   1100000 ns/op
```

~18× faster.

**Why faster:** Zero scheduler trips per event when the channel has buffer space. If the channel fills, `chansend` parks the producer via `gopark`, the receiver does its work, then `goready`s the producer back. That's the natural backpressure; the manual `Sleep(0)` was on top of it.
**Trade-off:** None for ordinary producer-consumer code. If you genuinely want to give other Gs a chance (e.g. you're holding a runnable G for longer than 10 ms with no safepoints), use `runtime.Gosched()` with a clear comment — but Go 1.14+ async preemption usually makes even that unnecessary.
**When NOT:** Spinning busy-wait outside a channel where there's no natural park — but at that point you should fix the spin, not yield-pad it.

</details>

---

## 16. Exercise 15 — Worker spawns child goroutines per task

**Difficulty:** Senior
**Skills:** flattening goroutine trees, scheduling fan-out, fan-in cost

A task runner takes a job and spawns 3 child goroutines (parse, validate, persist) inside the worker. The worker has 8 instances, so at 10k jobs/s you're at 30k extra Gs/s being created and joined.

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        var wg sync.WaitGroup
        wg.Add(3)
        go func() { defer wg.Done(); parse(j) }()
        go func() { defer wg.Done(); validate(j) }()
        go func() { defer wg.Done(); persist(j) }()
        wg.Wait()
    }
}
```

```
BenchmarkSpawnPerTask-8   1200   980000 ns/op   2400 B/op   8 allocs/op
```

**Why it's slow:** Each task spawns 3 Gs through `newproc`, then joins them through `wg.Wait` → `runtime_Semacquire` parks the worker → 3× `goready` to wake. The worker G itself is bounced through the scheduler as each child finishes. At 10k jobs/s × 3 children × 2 scheduler trips (wake + finish) = 60k unnecessary scheduler trips/s.

<details><summary>Hint</summary>

If parse/validate/persist don't truly need to run concurrently (no I/O, no blocking), flatten them. If they do (parse blocks on a parser pool, persist hits a DB), pool the per-stage workers instead of spawning per task.

</details>

<details><summary>Solution</summary>

If sequential is fine, flatten:

```go
func worker(jobs <-chan Job) {
    for j := range jobs {
        parse(j)
        validate(j)
        persist(j)
    }
}
```

```
BenchmarkFlatWorker-8   8500   140000 ns/op   0 B/op   0 allocs/op
```

~7× faster, zero allocations.

If the stages need concurrency (one is I/O-bound), pipeline them with channels between dedicated stage workers — each G lives once, not per task.

```go
parseIn := make(chan Job, 64)
validateIn := make(chan Job, 64)
persistIn := make(chan Job, 64)

go func() { for j := range parseIn { parse(j); validateIn <- j } }()
go func() { for j := range validateIn { validate(j); persistIn <- j } }()
go func() { for j := range persistIn { persist(j) } }()
```

**Why faster:** Three Gs total instead of three per task. Each G stays hot in cache, its stack reusable across millions of jobs. The scheduler's `runqput`/`runqget` activity drops by orders of magnitude. Pipeline backpressure replaces explicit `WaitGroup` joining.
**Trade-off:** Pipeline form decouples error handling per task — you need to thread a result/error sink. Sequential is the simplest if latency budget allows.
**When NOT:** Tasks where the three stages truly are CPU-parallel (heavy compute on independent fields) — but even then a per-stage worker pool beats per-task spawning.

</details>

---

## 17. Exercise 16 — WaitGroup.Add inside the goroutine

**Difficulty:** Senior
**Skills:** WaitGroup memory ordering, race conditions, scheduler-visible bugs

A subtle one. `wg.Add(1)` is called inside the goroutine, after the `go` statement. This races with `wg.Wait()` — if all spawning Gs are descheduled before any of them runs `Add`, `Wait` returns prematurely with counter == 0.

```go
func parallelMap(items []int, fn func(int) int) []int {
    out := make([]int, len(items))
    var wg sync.WaitGroup
    for i, x := range items {
        go func(i, x int) {
            wg.Add(1) // BUG: race with Wait
            defer wg.Done()
            out[i] = fn(x)
        }(i, x)
    }
    wg.Wait() // may return before any goroutine runs
    return out
}
```

```
BenchmarkRacyWG-8   100000   12000 ns/op   // observable correctness flake under -race
```

**Why it's slow (and wrong):** `wg.Add` inside the G is a race because the scheduler may run `Wait` before the spawned G is even scheduled. `runtime.newproc` enqueues the G but doesn't run it; the parent G continues until `Wait`. If the parent reaches `Wait` before any child has been picked up by `findRunnable`, the counter is still 0 and `Wait` returns immediately, leaving `out` half-written. Detected by `-race`; intermittent in production. The "performance" cost is repeated retries or wasted work; the real cost is incorrectness disguised as a perf bug.

<details><summary>Hint</summary>

`Add` must happen before `go`. The documentation says so for exactly this reason. Move it.

</details>

<details><summary>Solution</summary>

Add before the spawn.

```go
func parallelMap(items []int, fn func(int) int) []int {
    out := make([]int, len(items))
    var wg sync.WaitGroup
    wg.Add(len(items))
    for i, x := range items {
        go func(i, x int) {
            defer wg.Done()
            out[i] = fn(x)
        }(i, x)
    }
    wg.Wait()
    return out
}
```

```
BenchmarkCorrectWG-8   240000   5000 ns/op
```

~2.4× faster and correct.

**Why faster:** Single `wg.Add(len(items))` is one atomic update instead of N. No memory-ordering hazard with `Wait`. `Wait` parks the parent G via `runtime_Semacquire` on the WaitGroup's semaphore until counter hits 0; each child's `Done` does an atomic decrement and, on reaching 0, `runtime_Semrelease`s the waiter. Clean handoff, one scheduler trip total instead of churn from a racy Wait/Add interleaving.
**Trade-off:** You need to know `len(items)` upfront. For dynamic spawning, `Add(1)` is fine *as long as it's called before the corresponding* `go` — pre-increment, then spawn.
**When NOT:** Never — `Add` inside the goroutine is always a bug. The benchmark improvement is incidental; the real win is correctness.

</details>

---

## 18. Exercise 17 — LockOSThread for cgo TLS that isn't required

**Difficulty:** Senior
**Skills:** OS-thread pinning, cgo TLS semantics, when pinning is mandatory

Code calls a thread-safe C library but pins the goroutine to an OS thread "to be safe with cgo TLS." The C library doesn't use TLS; it's pure-function. The pin disables the scheduler's work-stealing and parking optimizations for nothing.

```go
func encrypt(data []byte) []byte {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    return C.GoBytes(C.aes_encrypt(...), C.int(len(data)))
}
```

```
BenchmarkLockedCgoCall-8   400   3000000 ns/op   // 1k concurrent callers
```

**Why it's slow:** `LockOSThread` sets `g.lockedm`. The cgo call still goes through `entersyscall`/`exitsyscall`, but now the G can't migrate, the M can't be parked when the G is blocked, and on `exitsyscall` the runtime is forced to schedule this G back onto its locked M — which may be running another G already. The scheduler's `findRunnable` is constrained: it can't steal a locked G across Ps. Effectively each pinned G serializes a slice of throughput.

<details><summary>Hint</summary>

`LockOSThread` is required only when the C library actually stores per-thread state (TLS), uses `pthread_*` APIs that bind to the calling thread, or holds an OS resource (GL context, NSS database handle) the next call must find on the same thread. A pure function like `aes_encrypt` over caller-owned buffers needs no pin.

</details>

<details><summary>Solution</summary>

Drop the lock.

```go
func encrypt(data []byte) []byte {
    return C.GoBytes(C.aes_encrypt(...), C.int(len(data)))
}
```

```
BenchmarkUnlockedCgoCall-8   1200   980000 ns/op
```

~3× faster.

**Why faster:** Without the lock, when the cgo call blocks (e.g. waiting for a hardware crypto accelerator), `entersyscall` releases the P and another G can run on it. On return, `exitsyscall` picks any available P — no constraint to a specific M. The scheduler load-balances normally. With 1k concurrent callers, the runtime can keep `GOMAXPROCS` Ms busy instead of having Gs queued on specific locked Ms.
**Trade-off:** None for pure-function C. If you later need TLS-bound C (e.g. switching to a library that uses `errno`-style thread state), put the lock back — but `errno` itself is safe under cgo because Go's cgo wrapper saves/restores it.
**When NOT:** OpenGL/Vulkan/CUDA contexts (always TLS-bound). Some signal-handling code that needs a stable thread. `setns`/`unshare`-style namespace switches that affect the current thread.

</details>

---

## 19. When NOT to optimize

Scheduler cost dominates only when goroutine creation, channel ops, or syscall transitions are on the hot path of a high-frequency operation. If your service does 100 req/s, every optimization here is irrelevant — a `time.After` leak that costs 5 µs/req is 500 µs/s total, invisible against any real workload.

**Profile first.** Scheduler overhead has six signatures in a CPU profile:
- `runtime.newproc` / `runtime.malg` on a hot stack → Ex. 1, 4, 15
- `runtime.gopark` / `runtime.goready` dominating → Ex. 5, 6, 7
- `runtime.entersyscall` / `runtime.exitsyscall` heavy → Ex. 9, 11
- `runtime.findRunnable` / `runtime.runqsteal` dominating → Ex. 2, 8, 17
- `runtime.checkTimers` walking deep heaps → Ex. 10
- `sync.runtime_SemacquireMutex` showing high samples → Ex. 7, 16

**Common premature optimizations:** worker pools (Ex. 1) on workloads doing < 1k Gs/s; sharded mutexes (Ex. 7) for caches with < 10k ops/s; per-worker channels (Ex. 8) for dispatch rates < 50k jobs/s; batched cgo (Ex. 11) for batches of fewer than 100 items; automaxprocs (Ex. 12) on bare-metal deployments without cgroup limits.

**Correctness gaps disguised as optimizations:** dropping `LockOSThread` (Ex. 2, 17) when C code actually does use TLS — silent corruption when calls bounce across Ms; atomic counter replacing channel (Ex. 5) when ordering between events matters; mutex replacing channel (Ex. 6) when batched processing semantics are lost; `WaitGroup.Add` inside the goroutine (Ex. 16) — flaky test failures masquerading as scheduler weirdness; flattened pipeline (Ex. 15) when one stage's I/O is blocking the others; reused `time.Timer` (Ex. 10) without correct `Stop`/drain sequence pre-Go-1.23.

---

## 20. Summary

**Always-ship wins** (default in any new scheduler-touching code): pool workers instead of goroutine-per-item when items are cheap (Ex. 1); never call `LockOSThread` without a C-side reason (Ex. 2, 17); never sprinkle `runtime.Gosched` or `time.Sleep(0)` (Ex. 3, 14); `Add` before `go` (Ex. 16); reuse `time.Timer` across loop iterations (Ex. 10); `bufio` around any small-record file reader (Ex. 9); set `GOMAXPROCS` to match your container CPU quota (Ex. 12).

**Wins behind a profile** (when measurements justify them): worker pool with per-worker channels (Ex. 8, when channel contention shows in `chansend`); atomic counter replacing channel-as-counter (Ex. 5, when `chansend` dominates a hot path); mutex replacing channel-as-lock (Ex. 6, when `gopark`/`goready` shows in single-writer paths); sharded mutex for high-concurrency caches (Ex. 7, when `runtime_SemacquireMutex` shows); long-lived per-stage pipeline workers replacing per-task spawning (Ex. 4, 15, when `newproc` shows on a hot stack); cgo batching across the FFI (Ex. 11, when `cgocall` shows on a hot stack); sampled or background-pushed `NumGoroutine` (Ex. 13, when its cacheline ping-pong shows in mutex profiles).

**Specialty** (only when the design calls for it): per-CPU read caches via `runtime_procPin` above sharded mutexes for hot-key workloads; lock-free SPSC queues per-worker for ultra-low-latency dispatch (replaces Ex. 8 with one channel per producer-consumer pair); custom timer wheel for services with millions of pending timers (replaces `runtime.timers` heap entirely); pinned-thread pools for cgo libraries with mandatory TLS (GPU compute, signal handlers).

Scheduler cost is `newproc`, park/unpark, syscall transitions, channel contention, runqueue contention, and M-pinning. Strip those six from the hot path by matching the concurrency primitive to the shape of the work: long-lived workers for cheap items, atomics for counters, sharded locks for read-mostly state, batched cgo for FFI-heavy paths. The runtime is fast — most "scheduler is slow" reports are application code asking the scheduler to do work it shouldn't have to. Profile, identify the signature, pick the lever; the six signatures above tell you which one.
