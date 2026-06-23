# Shared State Anti-Patterns — Find the Bug

> **Category:** [Concurrency Anti-Patterns](../README.md) → **Shared State** — *mutable data crossing threads without protection, or with protection that doesn't actually protect.*
> **Covers (collectively):** Shared Mutable State Without Protection · Busy Waiting / Spin Loop · Thread-Per-Request Without Bounds

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world Go or Java (with a Python GIL note where it changes the answer). Your job is to read it the way a reviewer who has been paged at 3 a.m. reads it, and answer three questions:

> **What's the hazard? Under what interleaving or load does it manifest? How would you fix it?**

Concurrency bugs do not announce themselves. The code compiles, the tests pass, the demo works. The bug is a *latent* property of the code — it needs a specific interleaving of threads, or a specific load, or a specific CPU's memory model to surface. That's exactly why reading for it is a distinct skill: you must simulate the adversarial scheduler in your head. "It worked when I ran it" proves nothing.

> **How to use this file:** read each snippet and write your own answer — *what interleaving breaks it?* — *before* expanding the collapsible. Naming the anti-pattern is the easy half; the hard half is constructing the exact schedule that corrupts state. One snippet below is a deliberate trap: it *looks* racy and is in fact perfectly safe. Don't let the pattern-matching reflex cost you.

A note on Go specifically: most of the Go data races here are caught by `go test -race` / `go run -race`. The race detector is the single highest-leverage tool in this chapter — but it only reports races on code paths that *actually execute under a race during the run*. It finds bugs; it does not prove their absence. Read as if you don't have it, then run it to confirm.

---

## Table of Contents

1. [The view counter that drifts](#snippet-1--the-view-counter-that-drifts)
2. [The cache that panics under load](#snippet-2--the-cache-that-panics-under-load)
3. [The worker that never wakes](#snippet-3--the-worker-that-never-wakes)
4. [The fan-out that fans into the loop variable](#snippet-4--the-fan-out-that-fans-into-the-loop-variable)
5. [One goroutine per connection](#snippet-5--one-goroutine-per-connection)
6. [The progress poller](#snippet-6--the-progress-poller)
7. [The results slice everyone appends to](#snippet-7--the-results-slice-everyone-appends-to)
8. [The double-checked ready flag](#snippet-8--the-double-checked-ready-flag)
9. [The metrics aggregator that looks racy](#snippet-9--the-metrics-aggregator-that-looks-racy)
10. [The Java request dispatcher](#snippet-10--the-java-request-dispatcher)
11. [The retry counter on the hot path](#snippet-11--the-retry-counter-on-the-hot-path)
12. [The graceful shutdown that hangs](#snippet-12--the-graceful-shutdown-that-hangs)
13. [The lazy singleton everyone shares](#snippet-13--the-lazy-singleton-everyone-shares)
14. [The Python scraper that "uses threads"](#snippet-14--the-python-scraper-that-uses-threads)

---

## Snippet 1 — The view counter that drifts

```go
// Go — counts page views across many request-handling goroutines
type Counter struct {
    views int64
}

func (c *Counter) Inc() {
    c.views++           // called from every request goroutine
}

func (c *Counter) Value() int64 {
    return c.views
}

// in main: 1000 goroutines, each calling Inc() 1000 times.
// Expected final value: 1,000,000.
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection** — specifically the **lost-update** race, the canonical non-atomic read-modify-write.

`c.views++` is not one operation. It compiles to **load `views` → add 1 → store `views`**. Two goroutines can interleave:

```
G1: load views (=41)
G2: load views (=41)
G1: add 1 -> 42
G2: add 1 -> 42
G1: store 42
G2: store 42        // one increment lost; should be 43
```

The final value is therefore **≤ 1,000,000**, drifting lower the more contention there is. It's not off by one in a predictable way — it's off by however many increments happened to overlap, which varies run to run. This is also a **data race** in the Go memory-model sense (concurrent unsynchronized read/write of `views`), so the program has *undefined behavior*, not merely a wrong count — `go run -race` flags it immediately.

**Fix — make the read-modify-write atomic:**

```go
import "sync/atomic"

type Counter struct {
    views atomic.Int64       // Go 1.19+ typed atomic
}

func (c *Counter) Inc()         { c.views.Add(1) }
func (c *Counter) Value() int64 { return c.views.Load() }
```

`atomic.Int64.Add` is a single uninterruptible hardware instruction (e.g. `LOCK XADD`), so no interleaving can lose an increment. A `sync.Mutex` around `views++` is also correct but heavier; for a single counter, the atomic is the right tool.

> **Python note:** `self.views += 1` is *also* not atomic in CPython, despite the GIL. The GIL guarantees a single *bytecode* executes atomically, but `+=` is several bytecodes (`LOAD`, `INPLACE_ADD`, `STORE`) with a possible thread switch between them. So a multithreaded CPython program loses updates here too — the GIL does not save you. Use `itertools.count` consumed under a lock, or a `threading.Lock`.

</details>

---

## Snippet 2 — The cache that panics under load

```go
// Go — a memoizing cache shared by all request handlers
type Cache struct {
    data map[string][]byte
}

func New() *Cache { return &Cache{data: make(map[string][]byte)} }

func (c *Cache) Get(key string) ([]byte, bool) {
    v, ok := c.data[key]        // read
    return v, ok
}

func (c *Cache) Set(key string, val []byte) {
    c.data[key] = val           // write
}

// Get and Set are called concurrently from thousands of goroutines.
```

> What's the hazard? Under what interleaving or load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection** over a Go built-in `map`, which is **not safe for concurrent use** when at least one goroutine writes.

This is worse than a lost update: the Go runtime *actively detects* concurrent map access and **deliberately crashes the whole process** with `fatal error: concurrent map writes` (or `concurrent map read and map write`). That fatal is **not recoverable** — `recover()` does not catch it, because the runtime calls `throw`, not `panic`. One unlucky interleaving and your entire server dies, dropping every in-flight request, not just the two racing ones.

**When it manifests:** any time a `Set` overlaps another `Set` or a `Get` on the same map. Under low traffic you may never hit it; under load it's a matter of time. The map's internal structure (buckets, the `flags` field tracking `hashWriting`) is what the runtime checks — that's how it knows you raced.

**Fix — guard the map, or use a concurrent map.** A `sync.RWMutex` lets reads proceed in parallel while serializing writes:

```go
type Cache struct {
    mu   sync.RWMutex
    data map[string][]byte
}

func (c *Cache) Get(key string) ([]byte, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    v, ok := c.data[key]
    return v, ok
}

func (c *Cache) Set(key string, val []byte) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.data[key] = val
}
```

For a write-once / read-many or high-churn-keys workload, `sync.Map` is an alternative — but don't reach for it reflexively; a plain `RWMutex` + `map` is faster for most patterns and far easier to reason about.

> **Java contrast:** `HashMap` doesn't crash the JVM, but concurrent writes during a resize can corrupt the bucket chain into a **cycle**, sending a later `get` into an *infinite loop* that pins a CPU core at 100% forever — a notorious production hang. The cure is the same: `ConcurrentHashMap`.

</details>

---

## Snippet 3 — The worker that never wakes

```go
// Go — background worker that should stop when `stopped` flips
type Worker struct {
    stopped bool
    jobs    chan Job
}

func (w *Worker) Run() {
    for !w.stopped {            // spin until told to stop
        select {
        case j := <-w.jobs:
            j.Do()
        default:
            // nothing to do right now
        }
    }
}

func (w *Worker) Stop() {
    w.stopped = true            // flip the flag from another goroutine
}
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Two anti-patterns at once: Busy Waiting *and* Shared Mutable State Without Protection.**

1. **Busy Waiting / Spin Loop.** When `jobs` is empty, the `select` hits `default` and the `for` immediately loops again. There is no blocking call and no `sleep`, so this goroutine spins as fast as the CPU allows, burning **100% of a core** doing nothing. With one such worker per CPU you've melted the machine to wait for work that arrives a few times a second.

2. **Unsynchronized flag → the loop may *never* observe the stop.** `stopped` is read by `Run`'s goroutine and written by `Stop`'s goroutine with **no synchronization**. This is a data race. The Go memory model gives **no guarantee** that the writing goroutine's store to `stopped` is ever made visible to the reading goroutine — the compiler may legally hoist `w.stopped` into a register once and spin on the stale copy forever. So `Stop()` returns, but `Run` keeps running. (On x86 you might get lucky and observe it; on ARM, or after an aggressive optimizing rebuild, you may not. "Works on my laptop" is exactly the trap.)

**Fix — don't poll a flag; block on a channel and wake on the event.** `context.Context` is the idiomatic Go primitive:

```go
type Worker struct {
    jobs chan Job
}

func (w *Worker) Run(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():     // wakes immediately on cancel; no spinning
            return
        case j := <-w.jobs:    // blocks (parks the goroutine) until a job arrives
            j.Do()
        }
    }
}

// caller:
ctx, cancel := context.WithCancel(context.Background())
go w.Run(ctx)
// ...later...
cancel()                       // happens-before the receive on ctx.Done()
```

The blocking `select` parks the goroutine (zero CPU while idle), and channel operations establish a **happens-before** edge, so the cancellation is *guaranteed* visible. Both bugs vanish.

</details>

---

## Snippet 4 — The fan-out that fans into the loop variable

```go
// Go (built with Go 1.21 or earlier) — launch one goroutine per URL
func fetchAll(urls []string) map[string]int {
    results := make(map[string]int)
    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        go func() {
            defer wg.Done()
            code := httpGet(u)        // captures loop variable u
            results[u] = code         // writes shared map
        }()
    }
    wg.Wait()
    return results
}
```

> What's the hazard? (There are two.) Under what conditions does each manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Two distinct bugs, both classic — this snippet combines patterns.**

**Bug 1 — loop-variable capture (the pre-1.22 Go closure gotcha).** In Go ≤ 1.21, the loop variable `u` is a **single variable reused across iterations**, not a fresh one per iteration. All the goroutines close over the *same* `u`. By the time they run, the loop has likely advanced, so most goroutines see `u` equal to the *last* URL (or some arbitrary in-flight value). You fetch the last URL N times and miss the others. This is a *correctness* bug independent of any race detector.

> **Version note:** Go **1.22** changed the semantics — the loop variable is now per-iteration, so this specific capture bug is gone on 1.22+. But (a) huge amounts of code still target older versions, and (b) the same trap exists verbatim in Java lambdas, JavaScript pre-`let`, C#, etc. Know it.

**Bug 2 — concurrent writes to a shared `map` (independent of Bug 1).** Even on Go 1.22, where each goroutine captures its own `u`, every goroutine still writes `results[u] = code` into the **same unsynchronized map** concurrently. That's the Snippet-2 hazard: `fatal error: concurrent map writes`, an unrecoverable process crash. Fixing the loop-variable bug does *not* fix this one — they are orthogonal.

**Fix — bind the variable explicitly (for old Go) *and* protect the shared write.** Cleanest is to remove the shared map entirely by sending results over a channel; here's the minimal lock-based fix that addresses both bugs:

```go
func fetchAll(urls []string) map[string]int {
    results := make(map[string]int)
    var mu sync.Mutex
    var wg sync.WaitGroup
    for _, u := range urls {
        u := u                       // shadow: fresh var per iteration (no-op but harmless on 1.22+)
        wg.Add(1)
        go func() {
            defer wg.Done()
            code := httpGet(u)
            mu.Lock()
            results[u] = code        // serialized; no concurrent map write
            mu.Unlock()
        }()
    }
    wg.Wait()
    return results
}
```

Note: you must still launch only a *bounded* number of these goroutines if `urls` can be large — see Snippet 5.

</details>

---

## Snippet 5 — One goroutine per connection

```go
// Go — a TCP server accepting client connections
func serve(ln net.Listener) {
    for {
        conn, err := ln.Accept()
        if err != nil {
            continue
        }
        go handle(conn)             // one goroutine per connection, forever
    }
}

func handle(conn net.Conn) {
    defer conn.Close()
    buf := make([]byte, 64*1024)    // 64 KB scratch buffer per connection
    for {
        n, err := conn.Read(buf)
        if err != nil {
            return
        }
        process(buf[:n])            // process() can take seconds under load
    }
}
```

> What's the hazard? Under what load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Thread-Per-Request Without Bounds** (goroutine-per-connection flavor).

Goroutines are cheap — a few KB of stack each — which is *exactly* why this anti-pattern is so seductive in Go. But "cheap" is not "free," and unbounded is unbounded. There is **no ceiling** on how many `handle` goroutines exist. Each holds a 64 KB buffer plus its stack plus an open file descriptor (the socket). Under a connection flood — a traffic spike, a slow-loris attack, or a downstream dependency slowing `process` so connections pile up — concurrent connections climb without limit. You hit, in roughly this order:

- **File-descriptor exhaustion** — `accept: too many open files` (the process `ulimit -n`), after which `Accept` fails and you *drop new healthy connections*.
- **Memory exhaustion / OOM** — N × (64 KB buffer + goroutine stack); at hundreds of thousands of connections the runtime can't allocate and the **OS OOM-killer reaps the process**.
- **Scheduler thrash** — even before OOM, scheduling hundreds of thousands of runnable goroutines degrades throughput for *everyone*.

The failure is **load-triggered and abrupt**: fine at 1,000 conns, dead at 50,000. There's no graceful degradation — the server doesn't get slow, it falls over.

**Fix — bound the concurrency.** A counting semaphore caps in-flight handlers; excess connections wait (or you can shed them):

```go
var sem = make(chan struct{}, 2000)   // at most 2000 concurrent handlers

func serve(ln net.Listener) {
    for {
        conn, err := ln.Accept()
        if err != nil {
            continue
        }
        sem <- struct{}{}              // blocks once 2000 are in flight (back-pressure)
        go func() {
            defer func() { <-sem }()
            handle(conn)
        }()
    }
}
```

This converts an unbounded resource demand into **back-pressure**: when saturated, `Accept` simply stops pulling new connections off the kernel's accept queue, which is a *survivable* state. For richer control (queue + reject + metrics) use a real worker pool. The principle is universal — **never let an external party dictate your concurrency level.**

</details>

---

## Snippet 6 — The progress poller

```java
// Java — wait for a background import to finish, then read the result
class Importer {
    private boolean done = false;
    private int rowsImported = 0;

    void runImport() {                 // executed on a background thread
        rowsImported = doImport();     // takes ~10s
        done = true;
    }

    int awaitResult() {                // called from the main thread
        while (!done) {
            // spin until the import finishes
        }
        return rowsImported;
    }
}
```

> What's the hazard? (There are two.) Under what conditions does each manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Busy Waiting *and* a visibility (memory-ordering) bug** — combined.

**Bug 1 — Busy Waiting.** `while (!done) {}` is a tight spin with no body. The `awaitResult` thread pins a CPU core at 100% for the full ~10 seconds of the import, doing zero useful work and stealing cycles from the import thread itself (so the import may even run *slower*). On a battery device this drains it; on a server it wastes a core per waiter.

**Bug 2 — `done` is not `volatile`, so the spin may never end.** `done` is written by the background thread and read by the main thread with **no happens-before relationship** (no `volatile`, no lock, no `synchronized`). Under the Java Memory Model the JIT is permitted to hoist the read of `done` out of the loop — `while (!done) {}` legally becomes `if (!done) while (true) {}` — because nothing tells the compiler the field can change underneath it. Result: the background thread sets `done = true`, but the spinning thread reads its cached/register copy forever and **hangs**. This reliably reproduces under `-server` JIT optimization and is a textbook JMM example.

A *second* visibility subtlety: even if `done` were visible, without proper ordering you have no guarantee `rowsImported` (written *before* `done`) is visible when you read it after seeing `done == true`. `volatile` fixes both because a write to a volatile *happens-before* a subsequent read of it, and that edge publishes everything written before it.

**Fix — don't spin, and don't hand-roll the synchronization.** Use a `CountDownLatch` (or, better, a `Future`/`CompletableFuture`) so the waiter **blocks** and the result is safely published:

```java
class Importer {
    private final CountDownLatch latch = new CountDownLatch(1);
    private volatile int rowsImported = 0;

    void runImport() {
        rowsImported = doImport();
        latch.countDown();          // publishes rowsImported with happens-before
    }

    int awaitResult() throws InterruptedException {
        latch.await();              // blocks (0% CPU) until countDown; no spin
        return rowsImported;
    }
}
```

The waiter is parked by the OS until signaled, and `await()`/`countDown()` establish the happens-before edge that makes `rowsImported` visible. Idiomatic alternative: model the whole thing as a `Future<Integer>` from an `ExecutorService` and call `future.get()`.

</details>

---

## Snippet 7 — The results slice everyone appends to

```go
// Go — parallel map: apply f to each input, collect outputs
func parallelMap(inputs []int, f func(int) int) []int {
    var results []int
    var wg sync.WaitGroup
    for _, x := range inputs {
        x := x
        wg.Add(1)
        go func() {
            defer wg.Done()
            results = append(results, f(x))   // append from many goroutines
        }()
    }
    wg.Wait()
    return results
}
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection** — concurrent `append` to a shared slice, which is a data race with two distinct bad outcomes.

`append` is not atomic and is not safe to call concurrently on the same slice header. Recall a slice is a `(ptr, len, cap)` triple. `results = append(results, v)` reads `len`/`cap`/`ptr`, possibly allocates a new backing array, writes the element, and reassigns the slice header. Concurrent appends race on **both** the element write and the header reassignment:

- **Lost / overwritten elements:** two goroutines read the same `len` (say 5), both write index 5, both set `len = 6`. One value clobbers the other; your output has fewer than `len(inputs)` elements, or duplicates, non-deterministically.
- **Worse, a torn slice header or stale backing array:** if one goroutine triggers a grow (realloc + copy) while another is writing into the *old* backing array, that write lands in an array nobody references anymore — silently dropped — or you get memory corruption-class weirdness. `go run -race` flags the write/write and the header read/write.

The result length is **non-deterministic**: run it 100 times and you'll see lengths scattered below `len(inputs)`.

**Fix — give each goroutine a private destination; no shared mutable target.** Because the index is known up front, preallocate and let each goroutine write its *own* index (disjoint indices need no lock):

```go
func parallelMap(inputs []int, f func(int) int) []int {
    results := make([]int, len(inputs))   // preallocated; fixed length
    var wg sync.WaitGroup
    for i, x := range inputs {
        i, x := i, x
        wg.Add(1)
        go func() {
            defer wg.Done()
            results[i] = f(x)             // each goroutine owns one distinct index
        }()
    }
    wg.Wait()
    return results
}
```

Writing to **distinct, non-overlapping** indices of a pre-sized slice is data-race-free without any lock — no goroutine touches another's element and the header never changes. (If the output count weren't known up front, you'd collect via a channel or append under a mutex instead.) Don't forget to *also* bound the goroutine count for large inputs (Snippet 5).

</details>

---

## Snippet 8 — The double-checked ready flag

```go
// Go — share config loaded once at startup with request goroutines
var (
    config *Config
    ready  bool
)

func loadConfig() {                 // called once, from a startup goroutine
    c := parse(readFile("config.yaml"))
    config = c
    ready = true                    // signal: config is now populated
}

func handler() {
    if !ready {                     // fast path: skip work until ready
        return                      // serve 503 until config loaded
    }
    use(config.Timeout)             // assumes config != nil once ready == true
}
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection**, manifesting as a **publication / reordering** bug — a cousin of broken double-checked locking.

The intent: `ready` acts as a barrier — "once you see `ready == true`, `config` is safe to read." But there is **no synchronization** between the writer (`loadConfig`) and the readers (`handler`), so the Go memory model gives **zero ordering guarantees** across goroutines. Two failure modes:

1. **Reordering (the subtle one):** the compiler/CPU may reorder the two independent writes in `loadConfig`, so `ready = true` becomes visible *before* `config = c`. A reader sees `ready == true`, falls through, dereferences `config` — which is still `nil` — and **panics with a nil-pointer dereference**. The writes look ordered in source, but nothing makes that ordering observable to another goroutine.

2. **Stale visibility:** even without reordering, a reader may see `ready == true` but still read a stale `nil` for `config` from its cache, because there's no happens-before edge to flush/acquire the new value.

This manifests as rare startup-window panics that are nearly impossible to reproduce locally (the window is milliseconds) but show up in production right after a deploy or restart. `go run -race` flags the unsynchronized access to both globals.

**Fix — use `sync.Once`, which provides the happens-before edge and the once-only semantics for free:**

```go
var (
    config *Config
    once   sync.Once
)

func getConfig() *Config {
    once.Do(func() {
        config = parse(readFile("config.yaml"))   // runs exactly once
    })
    return config                                 // safe: Do() happens-before Do() returns
}

func handler() {
    cfg := getConfig()      // blocks the first time, cheap thereafter; never nil after return
    use(cfg.Timeout)
}
```

`sync.Once` guarantees that the completion of `f()` *happens-before* the return of every `Do()` call — so once you hold the returned pointer, `config` is fully constructed and visible. No flag, no reordering window. (If you genuinely need a non-blocking "not ready yet" path, store the pointer in an `atomic.Pointer[Config]` and check it for `nil` — the atomic load provides the ordering the bare `bool` lacked.)

</details>

---

## Snippet 9 — The metrics aggregator that looks racy

```go
// Go — collect a count from each worker, then sum. Looks like a shared-state race?
func aggregate(work [][]int) int {
    partial := make(chan int, len(work))   // buffered so senders never block

    for _, chunk := range work {
        chunk := chunk
        go func() {
            sum := 0
            for _, v := range chunk {
                sum += v               // mutates a LOCAL variable
            }
            partial <- sum             // publish only via the channel
        }()
    }

    total := 0
    for range work {
        total += <-partial             // single goroutine reads & sums
    }
    return total
}
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: there is no race. This code is correct.** If your reflex was "goroutines mutating, must be a data race" — that's exactly the reflex this trains you to override.

Walk through *why* it's safe, because the reasoning is the point:

1. **State is confined to one goroutine.** Each goroutine's `sum` is a **local variable** living on that goroutine's own stack. No two goroutines touch the same `sum`. `chunk` is shadowed (`chunk := chunk`), so even on pre-1.22 Go each goroutine captures its own slice header — and the goroutines only *read* their chunk, never write it. Nothing mutable is shared.

2. **The only cross-goroutine data crosses a channel.** Each worker publishes its result *solely* by sending on `partial`. A channel send **happens-before** the corresponding receive (Go memory model guarantee). So when the main goroutine receives a value, that worker's writes to `sum` are fully visible — the channel is the synchronization, no lock needed.

3. **The accumulation is single-threaded.** `total += <-partial` runs in exactly one goroutine (the caller), so `total` is never shared. The buffered channel (`cap == len(work)`) just means senders never block; it doesn't change the happens-before story.

This is the **textbook idiomatic Go pattern**: *"Don't communicate by sharing memory; share memory by communicating."* Confine mutable state to a single goroutine and pass ownership over channels.

**The lesson for critical reading:** a goroutine writing to a variable is only a hazard if that variable is *shared*. Confined state + channel publication is provably safe — `go run -race` reports nothing here, correctly. Don't add a mutex "to be safe"; that's cargo-culting that hides your understanding and adds contention.

> **Where it *would* break:** if the workers wrote into a shared `results[i]` *and* the main goroutine read `results` before `wg.Wait()`/all receives completed — then you'd have a race. Or if `chunk` were a shared slice that some goroutine *mutated*. Neither happens here.

</details>

---

## Snippet 10 — The Java request dispatcher

```java
// Java — handle each incoming request on its own thread
class Server {
    void serve(ServerSocket socket) throws IOException {
        while (true) {
            Socket conn = socket.accept();
            new Thread(() -> handle(conn)).start();   // new OS thread per request
        }
    }

    void handle(Socket conn) {
        try (conn) {
            byte[] req = readRequest(conn);
            byte[] resp = process(req);    // calls a slow downstream API
            writeResponse(conn, resp);
        } catch (IOException e) { /* log */ }
    }
}
```

> What's the hazard? Under what load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Thread-Per-Request Without Bounds** — the original, heavyweight form of the anti-pattern.

Unlike a Go goroutine, `new Thread().start()` creates a **real OS thread**, and OS threads are expensive: each reserves a stack (default ~512 KB–1 MB on the HotSpot JVM), consumes a kernel scheduling entity, and costs real time to create and tear down. There is no cap here, so:

- **Memory blows up fast.** At 1 MB/stack, 10,000 concurrent requests reserve ~10 GB of thread stacks alone — you hit `OutOfMemoryError: unable to create new native thread` (often *before* heap OOM, because thread stacks are native memory). Once that throws, `accept` dies and the server stops serving entirely.
- **The scheduler drowns.** Thousands of runnable OS threads cause massive context-switching overhead; throughput *collapses* under the very load that demanded more threads — a congestion-collapse curve, not a graceful slope.
- **It's amplified by the slow `process` call.** Because `process` blocks on a slow downstream, each thread lives a long time, so concurrent threads accumulate proportional to *arrival rate × latency* (Little's Law). A downstream slowdown silently multiplies your thread count until you fall over.

**When it manifests:** a traffic burst, or — insidiously — a downstream dependency getting slower. The downstream's latency becomes *your* thread-count multiplier, so their incident becomes your outage.

**Fix — a bounded thread pool, so concurrency is capped and excess work queues (with back-pressure) instead of spawning unbounded threads:**

```java
class Server {
    // bounded pool + bounded queue + a rejection policy = survivable under overload
    private final ExecutorService pool = new ThreadPoolExecutor(
        50, 200, 60, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(1000),
        new ThreadPoolExecutor.CallerRunsPolicy());   // back-pressure when saturated

    void serve(ServerSocket socket) throws IOException {
        while (true) {
            Socket conn = socket.accept();
            pool.submit(() -> handle(conn));
        }
    }
}
```

The pool reuses a fixed number of threads, bounds memory, and the rejection policy turns overload into back-pressure (or explicit rejection) instead of a crash.

> **Modern note (JDK 21+):** **virtual threads** (Project Loom) make thread-per-request *cheap again* — `Executors.newVirtualThreadPerTaskExecutor()` parks blocked virtual threads off a small carrier-thread pool, so the slow `process` no longer pins an OS thread. But virtual threads remove the *memory/scheduling* cost, **not** the need for back-pressure: you must still bound concurrency against the *downstream* (e.g. a `Semaphore`) or you'll simply overwhelm `process` instead of the JVM.

</details>

---

## Snippet 11 — The retry counter on the hot path

```go
// Go — count retries across all in-flight requests, guarded by a mutex
type Stats struct {
    mu      sync.Mutex
    retries int
}

func (s *Stats) recordRetry() {
    s.mu.Lock()
    s.retries++
    s.mu.Unlock()
}

func (s *Stats) Snapshot() int {
    return s.retries          // read without the lock — "it's just an int read"
}
```

> What's the hazard? Under what interleaving does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection** — a *partially* protected variable, which is as broken as no protection. The classic "I locked the writes, surely the reads are fine" mistake.

`recordRetry` correctly serializes increments under `s.mu`. But `Snapshot` reads `s.retries` **without taking the lock**. This is still a **data race**: the Go memory model requires that *all* accesses to a shared variable — reads included — be synchronized if any concurrent access writes it. A lock only creates a happens-before relationship between operations that *both acquire the same lock*; a read that skips the lock participates in no such relationship.

**What actually goes wrong:**

- **Torn / stale reads.** `Snapshot` may observe a stale value indefinitely (no acquire barrier flushes the writer's update into the reader's view), or — on a platform where `int` writes aren't atomic, or under a compiler that reorders/folds the read — a torn value.
- **It's UB, not just "approximately right."** People rationalize this as "metrics can be a little stale, who cares." But a data race is *undefined behavior*; the compiler may optimize the racy read in ways that produce nonsense, and `go run -race` will (correctly) fail your build. "Stale is fine" is a *semantic* argument; the *memory-model* violation is independent and real.

**When it manifests:** whenever `Snapshot` runs concurrently with `recordRetry` — i.e. constantly on a hot path. The race detector flags it on the first overlap.

**Fix — read under the same lock, or drop the lock and use an atomic:**

```go
// Option A: read under the lock (consistent with the existing write path)
func (s *Stats) Snapshot() int {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.retries
}

// Option B (better for a single counter): no mutex at all, just an atomic
type Stats struct {
    retries atomic.Int64
}
func (s *Stats) recordRetry()  { s.retries.Add(1) }
func (s *Stats) Snapshot() int64 { return s.retries.Load() }
```

Option B is preferable here: a single counter doesn't need a mutex, and `atomic.Int64` makes *both* the increment and the read correctly synchronized with no lock contention. **Rule:** every access to shared mutable state — read *or* write — must use the same synchronization mechanism.

</details>

---

## Snippet 12 — The graceful shutdown that hangs

```go
// Go — drain a pipeline on shutdown by busy-checking a counter
type Pipeline struct {
    inFlight int32          // incremented on start, decremented on finish
}

func (p *Pipeline) Submit(job Job) {
    atomic.AddInt32(&p.inFlight, 1)
    go func() {
        defer atomic.AddInt32(&p.inFlight, -1)
        job.Run()
    }()
}

func (p *Pipeline) Shutdown() {
    for atomic.LoadInt32(&p.inFlight) > 0 {
        // wait for all in-flight jobs to drain
    }
    log.Println("drained, shutting down")
}
```

> What's the hazard? (The counter itself is fine — look at the loop.) How would you fix it?

<details>
<summary>Answer</summary>

**Busy Waiting / Spin Loop.** Note the deliberate misdirection: the *counter* is correct — `atomic.AddInt32` and `atomic.LoadInt32` are properly synchronized, so there's no data race and the visibility is sound (unlike Snippets 3, 6, 8). The bug is purely in **how `Shutdown` waits**.

`for atomic.LoadInt32(&p.inFlight) > 0 {}` is a tight, empty spin. During shutdown — which may take seconds while long jobs finish — this loop hammers an atomic load millions of times per second, pinning a **CPU core at 100%**. Worse, on a busy machine that spinning core *steals scheduler time from the very worker goroutines you're waiting on*, so they finish *slower*, extending the spin. You've built a shutdown that actively fights its own progress. (At least, unlike a non-atomic flag, this loop *will* eventually observe the drain — it's a pure CPU-waste bug, not a correctness/visibility bug.)

**Fix — use a primitive that blocks until the count reaches zero.** `sync.WaitGroup` is purpose-built for exactly "wait for N goroutines to finish":

```go
type Pipeline struct {
    wg sync.WaitGroup
}

func (p *Pipeline) Submit(job Job) {
    p.wg.Add(1)
    go func() {
        defer p.wg.Done()
        job.Run()
    }()
}

func (p *Pipeline) Shutdown() {
    p.wg.Wait()                 // parks the goroutine; 0% CPU until count hits 0
    log.Println("drained, shutting down")
}
```

`wg.Wait()` parks the calling goroutine and the runtime wakes it only when the counter reaches zero — no polling, no wasted core, no stealing cycles from the workers. (Mind the `WaitGroup` rule: all `Add` calls must happen-before the `Wait`; here each `Add(1)` is before the goroutine that `Done`s it, so it's correct.)

</details>

---

## Snippet 13 — The lazy singleton everyone shares

```java
// Java — a lazily-initialized shared connection pool
class Pool {
    private static Pool instance;

    private final List<Conn> conns = new ArrayList<>();

    static Pool getInstance() {
        if (instance == null) {            // checked without a lock
            instance = new Pool();         // constructed without a lock
        }
        return instance;
    }

    Conn acquire() { return conns.remove(conns.size() - 1); }
    void release(Conn c) { conns.add(c); }
}
```

> What's the hazard? (There are two layers.) Under what interleaving does each manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Shared Mutable State Without Protection on two layers** — both the lazy init and the pool's internal list are unsynchronized. This combines the publication race with an unprotected-collection race.

**Layer 1 — racy lazy initialization (lost-update / duplicate construction).** Two threads call `getInstance` concurrently, both read `instance == null` before either assigns, and **both construct a `Pool`**. One wins the assignment; the other's `Pool` is orphaned. If a `Pool` owns real resources (DB connections, sockets), you've now opened *two* pools and leaked one — and different callers may hold references to *different* "singletons," so `release` on one pool's connection lands in the other pool's list. There's also a publication hazard: another thread can see a non-null `instance` whose `conns` field is not yet fully constructed (the reference is published before the object's writes are visible) and observe a half-built object.

**Layer 2 — unsynchronized `ArrayList` mutated concurrently.** Even after construction, `acquire`/`release` mutate a plain `ArrayList` from many threads. `ArrayList` is **not thread-safe**: concurrent `add`/`remove` can corrupt the internal array and `size`, producing `ArrayIndexOutOfBoundsException`, returning the *same* `Conn` to two callers (so two threads use one connection simultaneously — a deeper bug), or silently dropping a released connection.

**When it manifests:** Layer 1 only during the startup race window (rare, but catastrophic — leaked resources). Layer 2 constantly, under any concurrent acquire/release.

**Fix — eager (or holder-idiom) initialization for the singleton, and a thread-safe structure for the pool:**

```java
class Pool {
    // Initialization-on-demand holder idiom: thread-safe, lazy, lock-free.
    private static class Holder { static final Pool INSTANCE = new Pool(); }
    static Pool getInstance() { return Holder.INSTANCE; }

    // A blocking queue is the right structure for a connection pool anyway:
    // thread-safe AND it lets acquire() wait when the pool is empty.
    private final BlockingQueue<Conn> conns = new LinkedBlockingQueue<>();

    Conn acquire() throws InterruptedException { return conns.take(); }
    void release(Conn c) { conns.offer(c); }
}
```

The **holder idiom** leans on the JVM's guarantee that a class is initialized lazily, exactly once, with full happens-before publication — no lock, no double-checked-locking subtlety. And `BlockingQueue` makes the pool's mutation thread-safe while giving you the blocking-acquire semantics a pool wants.

</details>

---

## Snippet 14 — The Python scraper that "uses threads"

```python
# Python (CPython) — scrape many URLs concurrently with threads
import threading

results = {}                       # shared dict, no lock

def scrape(url):
    html = fetch(url)              # network I/O (releases the GIL while waiting)
    results[url] = parse(html)     # write into the shared dict

def scrape_all(urls):
    threads = [threading.Thread(target=scrape, args=(u,)) for u in urls]
    for t in threads: t.start()
    for t in threads: t.join()
    return results
```

> What's the hazard? Does the GIL save you? Under what load does it manifest? How would you fix it?

<details>
<summary>Answer</summary>

**Two anti-patterns: Thread-Per-Request Without Bounds *and* Shared Mutable State Without Protection — with a GIL twist that makes the second one subtler than people think.**

**Bug 1 — unbounded threads.** One `threading.Thread` per URL, no cap. Threads in CPython are real OS threads (~8 MB default stack reservation on Linux, though lazily committed). Scrape 50,000 URLs and you spawn 50,000 OS threads — `RuntimeError: can't start new thread` or memory exhaustion. Threads also have non-trivial creation cost, so this is slow even when it doesn't crash.

**Bug 2 — `results[url] = ...` on a shared dict. Does the GIL save you?** *Partly, and that's the trap.* The GIL guarantees that a single bytecode runs without a thread switch, and `dict.__setitem__` for a simple key is *effectively* one atomic C-level operation in CPython — so for **this exact line** you won't corrupt the dict's internals the way Go or Java would. **But:**
- The safety is a CPython *implementation detail*, not a language guarantee. It does **not** hold for non-atomic compound operations: `results[url] = results.get(url, 0) + 1` is a read-modify-write across multiple bytecodes with a possible thread switch in the middle → **lost updates**, identical to Snippet 1. Relying on "the GIL makes my dict writes atomic" is fragile and breaks the moment the operation is anything more than a single assignment.
- It does **not** hold on **free-threaded / no-GIL Python (PEP 703, the 3.13+ experimental build)**, where there is no global lock and this *is* a genuine data race that can corrupt the dict.
- Most importantly: the GIL gives you **memory safety here by accident, not correctness in general**. Reasoning "I have the GIL so I don't need synchronization" is exactly the habit that produces lost-update bugs the moment the code grows past a single assignment.

**Fix — bound the concurrency with a pool, and make the aggregation explicit instead of relying on GIL accidents.** `ThreadPoolExecutor` does both:

```python
from concurrent.futures import ThreadPoolExecutor, as_completed

def scrape_all(urls):
    results = {}
    with ThreadPoolExecutor(max_workers=20) as pool:   # bounded
        futures = {pool.submit(fetch_and_parse, u): u for u in urls}
        for fut in as_completed(futures):
            url = futures[fut]
            results[url] = fut.result()   # written by ONE thread (the main loop)
    return results

def fetch_and_parse(url):
    return parse(fetch(url))              # pure: no shared state touched
```

Now concurrency is capped at 20 workers, and the shared dict is written **only by the main thread** as futures complete — state is confined, no cross-thread mutation, no dependence on GIL atomicity. (For pure network I/O, `asyncio` + `aiohttp` scales to thousands of in-flight requests far more cheaply than threads — but the bounding principle is identical: cap in-flight work with a semaphore.)

> **The meta-point:** "Python has the GIL so concurrency is safe" is one of the most expensive half-truths in the language. The GIL serializes bytecode execution; it does **not** make your *logical* operations atomic, and it is on its way out. Synchronize shared mutable state as if it weren't there.

</details>

---

## Summary — patterns of spotting

You don't spot a concurrency bug by reading a single line — you spot it by **simulating the adversarial scheduler** and asking a fixed set of questions. The repeatable moves from these fourteen snippets:

- **Find every piece of mutable state and ask "who else touches this?"** If a variable, map, slice, or field is read or written by more than one goroutine/thread and *any* of those is a write, you need synchronization — a lock, an atomic, or a channel handing off ownership. A counter (`x++`, Snippets 1, 14), a built-in map (Snippets 2, 4), a slice `append` (Snippet 7), and an `ArrayList` (Snippet 13) are all unsafe under concurrent mutation. In Go, a racy map *crashes the whole process*; in Java a racy `HashMap` can *infinite-loop* a core.
- **A partial lock is no lock.** Synchronizing the writes but reading without the lock is still a data race (Snippet 11). *Every* access — reads included — must use the same mechanism.
- **Distrust every spin loop with an empty body.** `for !done {}` / `while (!done) {}` is Busy Waiting: it burns 100% of a core and often *steals cycles from the thread it's waiting on* (Snippets 3, 6, 12). Replace polling with a blocking primitive that wakes on the event — channel/`context` (Go), `CountDownLatch`/`Future`/`WaitGroup`.
- **A bare flag across goroutines is a visibility trap, not just a style nit.** Without `volatile` (Java) or an atomic/channel/lock (Go), a writer's update to a flag may *never become visible* to a spinning reader — the loop hangs forever — and independent writes may be *reordered*, publishing a "ready" flag before the data it guards (Snippets 3, 6, 8). Happens-before edges (channel send/receive, `sync.Once`, lock acquire/release, volatile write/read) are what make a value safely visible.
- **Count where concurrency is bounded — and panic if the answer is "it isn't."** `go handle(conn)` or `new Thread(...)` in an `accept` loop with no cap is Thread-Per-Request Without Bounds (Snippets 5, 10, 14). It's fine in the demo and fatal under load: fd exhaustion, OOM, scheduler collapse — abruptly, with no graceful slope. Bound it with a semaphore or a fixed pool so overload becomes *back-pressure*, and remember a slow downstream silently multiplies your thread/goroutine count (Little's Law).
- **Know your loop-variable semantics.** Capturing a loop variable in a goroutine/lambda is a correctness bug on Go ≤ 1.21, Java lambdas, pre-`let` JS, and friends (Snippet 4) — independent of any data race that may *also* be present.
- **The GIL is not synchronization.** CPython's GIL makes a *single bytecode* atomic, not your *logical* operation; `x += 1` and read-modify-write on a dict still lose updates, and free-threaded Python removes the accidental safety entirely (Snippets 1, 14).
- **Resist the false positive.** Goroutines/threads writing to *local, confined* state and publishing results *only* through a channel are provably safe — adding a mutex there is cargo-culting (Snippet 9). The hazard is *sharing* mutable state, not *mutating* it.

The deeper cure runs through the whole chapter: the root cause is almost always **shared mutable state**, and every lock, atomic, and `volatile` is a patch over it. The structural fix — confine state to one goroutine, pass ownership over channels, or make data immutable — removes the hazard instead of guarding it.

---

## Related Topics

- [`tasks.md`](tasks.md) — small concurrent programs to fix from the writing side.
- [`junior.md`](junior.md) — what each shared-state bug looks like and why it's hard to reproduce.
- [`middle.md`](middle.md) — how to detect these (the race detector, `-race`, stress tests) and the safer patterns.
- [`senior.md`](senior.md) — debugging a corrupted map or a runaway thread count in production.
- [`optimize.md`](optimize.md) — making these implementations both safe *and* fast.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Synchronization Misuse → Find the Bug](../01-synchronization/find-bug.md) — the sibling chapter on locks and memory ordering used wrongly.
- [Coordination → Find the Bug](../02-coordination/find-bug.md) — deadlocks and lock-granularity bugs.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — removing shared *mutable* state at the source.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — the smell-level view of shared state.
- [Concurrency & Async Parallelism](../../../../language-internals/concurrency-async-parallel/README.md) — the positive primitives and memory models behind these fixes.
