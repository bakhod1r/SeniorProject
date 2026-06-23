# Buffered vs Unbuffered Channels — Optimization

> Honest framing first: a channel is a synchronisation primitive, not a queue with magic throughput. Most "channel slowness" is one of three things: (1) per-message scheduler handoff overhead, (2) a buffer sized wrongly for the workload, or (3) a channel being used where a simpler primitive (mutex, atomic, context) would do.
>
> Each entry below states a slow pattern, shows a "before" snippet, the diagnosis, and an "after" snippet with rough perf intuition. Numbers are illustrative — always benchmark on your own workload.

---

## Optimization 1 — Replace busy-wait with channel signalling

**Problem:** Polling a flag in a loop burns a full CPU core for nothing. The goroutine wakes constantly, finds nothing to do, and yields. Throughput on the rest of the system suffers and your laptop fans spin up.

**Before:**
```go
var ready int32 // atomic flag

go func() {
    doWork()
    atomic.StoreInt32(&ready, 1)
}()

for atomic.LoadInt32(&ready) == 0 {
    // spin until ready
}
fmt.Println("worker finished")
```
The main goroutine consumes 100 % of one core for the entire duration of `doWork`.

**After:**
```go
done := make(chan struct{}) // unbuffered signal

go func() {
    doWork()
    close(done) // single signal, fan-out friendly
}()

<-done
fmt.Println("worker finished")
```
The main goroutine parks itself on `<-done` and consumes zero CPU until the worker closes the channel. The Go runtime wakes it precisely when there is something to do.

**Gain:** CPU utilisation while waiting drops from 100 % of a core to ~0 %. Wall-clock time is unchanged or slightly better (no contention with the worker for CPU). This is the textbook reason channels exist.

---

## Optimization 2 — Unbuffered channel forcing sync — switch to buffered for throughput

**Problem:** An unbuffered channel forces a full goroutine handoff on every send. In a hot pipeline, that handshake dominates the per-message cost.

**Before:**
```go
ch := make(chan int) // unbuffered

go consumer(ch)
for i := 0; i < 1_000_000; i++ {
    ch <- i // every send blocks until consumer wakes
}
close(ch)
```
A million synchronous handshakes. Benchmark: ~150–250 ns per message, dominated by the scheduler.

**After:**
```go
ch := make(chan int, 1024) // small buffer absorbs scheduler latency

go consumer(ch)
for i := 0; i < 1_000_000; i++ {
    ch <- i // blocks only if consumer is far behind
}
close(ch)
```
Producer keeps writing while consumer drains; both run hot on their own cores; the scheduler steps in only when one side gets ahead by more than the buffer.

**Gain:** Typically 5–20× throughput improvement on producer-consumer workloads — `~30–50 ns` per message instead of `~200 ns`. The buffer pays for itself with the first dozen messages.

**When *not* to apply:** if you need the synchronous semantics ("the sender knows the receiver got it"), buffering breaks correctness for free performance. Make the choice deliberately.

---

## Optimization 3 — Oversized buffer causing memory waste

**Problem:** "Bigger buffer = better" is a myth. A capacity of 1 000 000 does not buffer a million messages "for free" — it reserves slot space, and once full it represents a million live values that the GC must scan.

**Before:**
```go
type Event struct {
    UserID int64
    Body   [4096]byte // 4 KB struct
}

ch := make(chan Event, 1_000_000) // 4 GB of buffer slots reserved on first growth
```
On a heavy producer, the buffer fills with multi-kilobyte structs, RSS climbs into the gigabytes, and the GC starts spending real wall-clock time scanning the queue.

**After:**
```go
ch := make(chan *Event, 1024) // pointers, modest depth
```
Capacity right-sized to actual burst (measure the deepest queue depth in production and round up to the next power of two). Pointers, not values, so each slot is 8 bytes regardless of payload.

**Gain:** Memory footprint of the channel drops from gigabytes to kilobytes. GC pause times shrink because the live set is smaller. Producer/consumer behaviour is unchanged on the steady state but recovers far faster from a burst.

**Rule of thumb:** buffer capacity should match the largest expected burst the consumer can drain *within tolerable latency*. If your consumer needs longer than a few seconds to drain, you have a design problem, not a buffer-sizing problem — add a real queue.

---

## Optimization 4 — Channel-per-message overhead — batch via slice

**Problem:** Sending one tiny value at a time pays the channel send/receive cost on every value. For workloads where messages are small and numerous, the overhead dwarfs the actual work.

**Before:**
```go
ch := make(chan int, 64)

go func() {
    for i := 0; i < 1_000_000; i++ {
        ch <- i // 1M sends, ~30 ns each = 30 ms of channel overhead
    }
    close(ch)
}()

sum := 0
for v := range ch {
    sum += v
}
```

**After:**
```go
const batchSize = 1024
ch := make(chan []int, 8)

go func() {
    batch := make([]int, 0, batchSize)
    for i := 0; i < 1_000_000; i++ {
        batch = append(batch, i)
        if len(batch) == batchSize {
            ch <- batch
            batch = make([]int, 0, batchSize)
        }
    }
    if len(batch) > 0 {
        ch <- batch
    }
    close(ch)
}()

sum := 0
for batch := range ch {
    for _, v := range batch {
        sum += v
    }
}
```

**Gain:** Channel sends drop from 1 000 000 to ~1000. Wall-clock time on this kind of workload typically improves 10–50× because the per-message scheduler overhead is amortised across the batch. The receiver iterates over the batch in tight cache-friendly loops.

**Watch out for:** latency. Batching trades throughput for per-message latency (a value waits in the partial batch until it fills). For latency-sensitive paths, send a partial batch periodically using a `time.Ticker` in `select`.

---

## Optimization 5 — Replace channel with `sync.Mutex` when no signalling needed

**Problem:** A channel is overkill when all you need is "protect a shared map." Using a channel as a serialising agent burns goroutine handoffs that a mutex would skip entirely.

**Before:**
```go
type Counter struct {
    inc chan struct{}
    get chan chan int
}

func NewCounter() *Counter {
    c := &Counter{
        inc: make(chan struct{}),
        get: make(chan chan int),
    }
    go func() {
        n := 0
        for {
            select {
            case <-c.inc:
                n++
            case reply := <-c.get:
                reply <- n
            }
        }
    }()
    return c
}

func (c *Counter) Inc()    { c.inc <- struct{}{} }
func (c *Counter) Read() int {
    r := make(chan int)
    c.get <- r
    return <-r
}
```
Every `Inc` and `Read` pays for at least one goroutine handoff and one channel allocation (in `Read`).

**After:**
```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func (c *Counter) Read() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.n
}
```
No goroutines, no channels, no allocations.

**Gain:** Roughly 10–100× faster per operation (`~10 ns` mutex vs `~hundreds of ns` channel). The "share by communicating" mantra is correct *when there is communication*. Pure shared state is a mutex's job.

**Rule:** if your channel design is "send a request, wait for a reply, no goroutine other than the owner needs to know," a mutex is almost certainly the right answer.

---

## Optimization 6 — Replace `chan bool` done-signal with `context.Context`

**Problem:** A bespoke `done chan struct{}` works, but it does not compose. Once you have three nested layers (server → request → worker), each one needs to plumb its own done channel and worry about closing it exactly once.

**Before:**
```go
func handler(done chan struct{}) {
    sub := make(chan struct{})
    go inner(sub)

    select {
    case <-done:
        close(sub)
    case <-sub:
    }
}

func inner(done chan struct{}) {
    select {
    case <-done:
        return
    case <-time.After(10 * time.Second):
    }
}
```
Every layer reinvents cancellation. Closing twice or forgetting to close leaks goroutines.

**After:**
```go
func handler(ctx context.Context) {
    inner(ctx)
}

func inner(ctx context.Context) {
    select {
    case <-ctx.Done():
        return
    case <-time.After(10 * time.Second):
    }
}
```
A `context.Context` is itself just a wrapper around a channel-like cancellation primitive, but it carries deadlines, values, and parent-child relationships. Cancellation propagates automatically through `WithCancel`/`WithTimeout` chains.

**Gain:** Less code per layer; correct propagation of cancellation across layers; standardised idiom that every Go developer recognises. Performance is essentially identical to a hand-rolled done channel — you save engineering time, not nanoseconds.

**Rule:** if your "done" signal needs to flow through more than one function boundary, use `context.Context`.

---

## Optimization 7 — Single-receiver inefficiency — fan out to multiple workers

**Problem:** One producer, one consumer, expensive per-message work. The producer bottlenecks on the consumer even though the box has 16 cores.

**Before:**
```go
ch := make(chan Job, 64)

go produce(ch)

for job := range ch {
    process(job) // CPU-heavy: ~5 ms each
}
```
Single consumer ≈ ~200 jobs per second per core, regardless of how many cores you have.

**After (worker pool):**
```go
ch := make(chan Job, 64)

const workers = runtime.NumCPU()
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for job := range ch {
            process(job)
        }
    }()
}

go produce(ch)

wg.Wait()
```
N workers all `range` the same channel; each receive is atomic, so each job goes to exactly one worker. The buffer smooths short-term variance.

**Gain:** Throughput scales near-linearly with worker count up to the number of cores (or until the producer becomes the bottleneck). On a 16-core box: ~3000 jobs/second instead of ~200.

**Watch out for:** if `process` writes to shared state, you have just introduced races. Either make `process` purely functional or guard the shared state with a mutex / use atomic ops.

---

## Optimization 8 — Excessive allocations from sending big structs by value

**Problem:** Channels copy values on send. A 4 KB struct copied a million times is 4 GB of memory traffic that the CPU could be doing real work on instead.

**Before:**
```go
type Frame struct {
    ID     int64
    Pixels [4096]byte
}

ch := make(chan Frame, 16)

go func() {
    for i := 0; i < 1_000_000; i++ {
        ch <- Frame{ID: int64(i)} // 4 KB copy on every send
    }
    close(ch)
}()
```

**After (send pointers):**
```go
ch := make(chan *Frame, 16)

go func() {
    for i := 0; i < 1_000_000; i++ {
        f := &Frame{ID: int64(i)}
        ch <- f // 8-byte pointer copy
    }
    close(ch)
}()
```

**Gain:** Channel send cost drops from "memcpy 4 KB" to "store 8 bytes." On large structs the per-send time can drop 100×; total CPU spent in `runtime.chansend` falls correspondingly.

**Watch out for:** sharing pointers means the receiver sees mutations the sender makes after sending. Either make the value immutable after send, or use a `sync.Pool` (Optimization 11) so the producer always allocates a fresh one.

**Rule of thumb:** if `unsafe.Sizeof(T) > 64`, prefer `chan *T` to `chan T`. Below that, copies are usually cheap enough that simplicity wins.

---

## Optimization 9 — Avoid `select` with `default` busy loop

**Problem:** `select` with a `default` case is non-blocking. Putting it in a tight loop reproduces the busy-wait of Optimization 1 with extra steps.

**Before:**
```go
for {
    select {
    case v := <-ch:
        process(v)
    default:
        // "no work, try again"
    }
}
```
This burns 100 % of a core, again. The `default` branch fires every iteration that the channel is empty.

**After:**
```go
for v := range ch {
    process(v)
}
```
A blocking receive parks the goroutine. The runtime wakes it when a value arrives.

**Gain:** CPU utilisation while idle drops from 100 % to ~0 %. Latency to process a new value is essentially identical (the runtime wakes a parked goroutine in microseconds).

**Legitimate use of `select` with `default`:** non-blocking *send* (drop on overflow, see Bug 15), or non-blocking *receive when paired with another channel* — never as the only case in a hot loop.

---

## Optimization 10 — Eliminate the channel altogether for trivial coordination

**Problem:** A channel was the right primitive at design time. After a refactor, the synchronisation it provides is already guaranteed by the surrounding code, but the channel and its goroutine are still there — pure overhead.

**Before:**
```go
func loadConfig() Config {
    ch := make(chan Config, 1)
    go func() {
        ch <- readFile("config.json")
    }()
    return <-ch
}
```
The goroutine launches, writes one value, exits. The caller waits. There is no actual concurrency benefit — `loadConfig` does exactly one thing in series.

**After:**
```go
func loadConfig() Config {
    return readFile("config.json")
}
```

**Gain:** One less goroutine spawned per call (~2 KB stack saved + scheduler entry), one less channel allocated, one less send/receive pair. On a hot path called millions of times, this is real overhead.

**The mental check:** if the goroutine-plus-channel pair only runs once and the caller is going to block on the result anyway, just call the function. Concurrency primitives are not free.

---

## Optimization 11 — Pool reuse to reduce GC pressure across channel sends

**Problem:** Each message allocates a fresh `*T`, then becomes garbage after the consumer is done. On a high-throughput path that's a million allocations a second feeding the GC.

**Before:**
```go
type Msg struct {
    Buf [4096]byte
}

ch := make(chan *Msg, 64)

go func() {
    for {
        m := &Msg{}
        fillBuffer(m.Buf[:])
        ch <- m // allocation per message; m is GC trash after consumer returns
    }
}()

for m := range ch {
    process(m)
    // m abandoned to GC
}
```
On a 1 M msg/s pipeline this allocates 4 GB/s of garbage and the GC works hard.

**After (with `sync.Pool`):**
```go
var msgPool = sync.Pool{
    New: func() any { return &Msg{} },
}

ch := make(chan *Msg, 64)

go func() {
    for {
        m := msgPool.Get().(*Msg)
        fillBuffer(m.Buf[:])
        ch <- m
    }
}()

for m := range ch {
    process(m)
    *m = Msg{}        // zero before returning to pool
    msgPool.Put(m)    // hand back for reuse
}
```

**Gain:** Allocations on the hot path drop near zero. GC frequency drops, GC pause time drops, and the L1/L2 cache stays warm because the same memory keeps getting reused. On a heavy pipeline this can halve total CPU usage.

**Watch out for:** the consumer must be the one putting back to the pool, *after* it has finished using the value. If the producer puts back before the consumer is done, you have a use-after-free in spirit. The handoff via channel makes the lifetime clear: producer allocates/gets, sends, ownership transfers; consumer uses, returns to pool. Document the ownership transfer clearly.

---

## Optimization 12 — Channel as a semaphore with the right capacity

**Problem:** Limiting concurrent operations (e.g. "no more than 8 simultaneous HTTP fetches") is often hand-rolled with a counter and a mutex. A buffered channel of `struct{}` is shorter, faster, and obviously correct.

**Before:**
```go
var (
    mu      sync.Mutex
    inFlight int
    cond    = sync.NewCond(&mu)
)

func limited(do func()) {
    mu.Lock()
    for inFlight >= 8 {
        cond.Wait()
    }
    inFlight++
    mu.Unlock()

    defer func() {
        mu.Lock()
        inFlight--
        cond.Signal()
        mu.Unlock()
    }()

    do()
}
```

**After:**
```go
var sem = make(chan struct{}, 8) // capacity = max concurrency

func limited(do func()) {
    sem <- struct{}{}        // acquire (blocks if 8 in flight)
    defer func() { <-sem }() // release
    do()
}
```

**Gain:** Less code, no condition variable, no risk of "forgot to broadcast." The buffered channel-of-empty-struct is O(1) per acquire/release and ~30 ns each — typically faster than the mutex+cond version on contention.

**Why empty struct?** `struct{}` is zero bytes, so the buffer is essentially just a counter. The slot doesn't carry data; it carries permission.

---

## Benchmarking and Measurement

Optimisation without measurement is folklore. For channel-heavy code, the standard tools are:

```bash
# Per-operation cost
go test -bench=. -benchmem -run=^$ ./...

# Where time is spent (look for runtime.chansend, runtime.chanrecv, runtime.gopark)
go test -bench=. -cpuprofile=cpu.prof -run=^$ ./...
go tool pprof -top -cum cpu.prof | head -30

# Goroutine snapshot at runtime — confirms no leaks
import _ "net/http/pprof"
go func() { http.ListenAndServe("localhost:6060", nil) }()
# Then: go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Useful microbenchmarks to keep in your head:

| Operation                      | Approx. cost |
|--------------------------------|-------------:|
| Mutex Lock/Unlock (uncontended)| `~10 ns`     |
| Atomic load/store              | `~1 ns`      |
| Buffered send/recv (no block)  | `~30 ns`     |
| Unbuffered send/recv (rendezvous) | `~150–250 ns` |
| Goroutine creation             | `~1 µs`      |
| Channel allocation             | `~100 ns`    |

If your "channel optimisation" does not move these dials by a measurable amount in your benchmark, it is not an optimisation — it is a refactor.

---

## When NOT to Optimize

- **The pipeline is correct and fast enough.** Channels at default sizing usually are. Premature buffer-tuning makes code harder to reason about for marginal wins.
- **The channel runs once at program start.** Spending engineering time saving 200 ns at boot is a poor trade.
- **The team is still learning concurrency.** A clear unbuffered channel and a deadlock that teaches the developer is better than a complex buffered design that "just works" until a corner case bites in production.
- **The bottleneck is not the channel.** Profile first. The most common surprise is that the channel was fine and the receiver's `process()` was the slow part.

---

## Summary

Channel optimisation is mostly:

1. Match the buffer size to the workload's burst, not to "big number."
2. Send pointers, not large values.
3. Drop the channel entirely when a mutex / atomic / direct call would do.
4. Batch when per-message overhead dominates the actual work.
5. Use `select`-with-default for non-blocking sends, never as a busy-wait.
6. Reach for `sync.Pool` once allocation is the bottleneck, not before.

Most channel performance problems in Go are not "channels are slow." They are either an unnecessary handshake (Opt 2), an oversized or undersized buffer (Opts 3, 11), or a channel doing a job a simpler primitive could do (Opts 5, 10, 12). Knowing which of those is in play is what separates "I use channels" from "I know when not to."
