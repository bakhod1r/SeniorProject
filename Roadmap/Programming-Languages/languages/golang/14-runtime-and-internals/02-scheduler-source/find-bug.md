# Scheduler Source — Find the Bug

## 1. How to use this file

Sixteen buggy Go programs that exercise the runtime scheduler — `runtime/proc.go` (`schedule`, `findRunnable`, `execute`), `runtime.LockOSThread`, `runtime.Gosched`, `runtime.GOMAXPROCS`, preemption (the cooperative pre-1.14 form and the asynchronous post-1.14 form), `entersyscall` / `exitsyscall`, and cgo handoff. Read each in 30–60 seconds, decide where the defect is, then expand `<details>` for the answer.

Scheduler bugs rarely show up as a panic. They show up as "the program is using one CPU when I asked for sixteen", "the worker pool is mysteriously serialised", "this program ran fine on go1.13 but hangs the goroutine in go1.14", "throughput drops under load and the profiler blames `runtime.gopark`". Three questions on every snippet:

1. *Where is the preemption point — and is one reachable on the hot path?*
2. *Who owns the M, who owns the P, and which transitions (`entersyscall`, `LockOSThread`, cgo) move work between them?*
3. *Does the goroutine count grow unboundedly with work, and is each goroutine eventually parked or running on real work — never busy-spinning?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Tight CPU loop with no function call (go1.13 starves the scheduler)

```go
// GOMAXPROCS=1, runtime built with go1.13.
package main

import (
    "fmt"
    "runtime"
)

func main() {
    runtime.GOMAXPROCS(1)
    done := make(chan struct{})
    go func() {
        fmt.Println("worker started")
        close(done)
    }()
    for i := 0; ; i++ {
        if i == -1 {       // BUG: no function call inside the loop body
            break
        }
    }
    <-done
}
```

<details><summary>Answer</summary>

**Bug:** Before go1.14, the Go scheduler was *cooperatively* preempted. The runtime only got a chance to switch goroutines at function-call boundaries (where the prologue checks `g.stackguard0 == stackPreempt`) and at a handful of explicit points — channel ops, allocator slow path, `runtime.Gosched`. A loop body that compiles to pure arithmetic + a branch has no preemption point. With `GOMAXPROCS=1`, the spinning goroutine owns the only P forever; the spawned goroutine that wants to print "worker started" is on the global run queue and is never scheduled. The program hangs at `<-done`.

**Why subtle:** The same code on go1.14+ runs fine — asynchronous preemption (Go proposal #24543, signal-based, via `runtime.preemptone` and the `SIGURG` handler) interrupts the loop at instruction boundaries. Teams pinned to go1.13 hit it; tests on a CI box that already ships go1.20 don't reproduce.

**Spot:** Any `for { ... }` whose body is pure register arithmetic — no function calls, no channel ops, no allocation, no `runtime.Gosched()`. `runtime.findRunnable` (in `runtime/proc.go`) only runs when the current G yields the P; pure loops never yield on go1.13.

**Fix:** Upgrade to go1.14+ (released February 2020), which made preemption signal-based. If pinning is unavoidable, drop a `runtime.Gosched()` (or any function call — `_ = fmt.Sprint(i)` works) into the loop body once per several thousand iterations:

```go
for i := 0; ; i++ {
    if i%4096 == 0 { runtime.Gosched() }
    if i == -1 { break }
}
```

**Why common:** "Compute-bound loop" is the textbook example of code that *should* be fast and *should not* need scheduler help. On go1.13 and earlier, "fast" required cooperation. Many older blog posts and Stack Overflow answers omit this — they assume modern preemption — and code lifted from them dies silently on legacy builds.
</details>

---

## Bug 2 — Worker pool peppered with `runtime.Gosched()` "for fairness"

```go
func worker(jobs <-chan int, results chan<- int) {
    for j := range jobs {
        runtime.Gosched()               // BUG: yields before doing anything
        result := heavyCompute(j)
        runtime.Gosched()               // BUG: yields after every job
        results <- result
        runtime.Gosched()               // BUG: yields after the send
    }
}
```

<details><summary>Answer</summary>

**Bug:** `runtime.Gosched()` calls into `runtime.mcall(gosched_m)` (see `runtime/proc.go`), which parks the current G on the global run queue and asks the scheduler to pick another runnable G. On a busy system with enough work to keep all Ps loaded, this is *pure overhead*: the G goes to the back of the queue, the scheduler runs `findRunnable`, picks another G (often the same one if no other is ready), and resumes. Three `Gosched` per job multiplies that overhead by three. Throughput drops 10–40% versus a worker with no `Gosched` at all.

**Why subtle:** Senior engineers half-remember "the scheduler is cooperative; sprinkle yields to be fair". That advice was already wrong on go1.0 (Go has always had channel-op preemption) and is *very* wrong on go1.14+ (asynchronous preemption makes any function call equivalent to a yield, and many syscall-edge events trigger reschedules for free).

**Spot:** Any `runtime.Gosched()` outside two rare contexts: (a) a deliberately-spinning lock-free primitive that needs to back off, and (b) `go1.13`-pinned code with a pure-arithmetic loop body that can't be otherwise refactored. Everywhere else, delete it.

**Fix:** Remove all three `Gosched` calls. The channel send `results <- result` is itself a scheduler synchronisation point (`runtime.chansend` parks the G if the receiver isn't ready); the channel receive `for j := range jobs` is another. The scheduler is fair without help.

**Why common:** Engineers who came from cooperative-threaded languages (early Erlang's reductions, Lua coroutines, Python's `asyncio`) assume Go is the same. It isn't — Go's scheduler reschedules at most function-call boundaries (1.13) or arbitrary instruction boundaries (1.14+). Manual yields are vestigial.
</details>

---

## Bug 3 — `LockOSThread` without `UnlockOSThread` (kills the M)

```go
func runOnOpenGLThread() {
    runtime.LockOSThread()            // BUG: no matching UnlockOSThread
    initOpenGL()
    for ev := range events {
        renderFrame(ev)
    }
    // function returns here when events closes
}

func main() {
    go runOnOpenGLThread()
    // ... rest of program continues using normal goroutines
}
```

<details><summary>Answer</summary>

**Bug:** `runtime.LockOSThread()` (in `runtime/proc.go`) increments `g.lockedm`'s reference count and pins the G to the current M (OS thread). When the G *exits* without calling `UnlockOSThread`, the runtime takes that as a strong signal: "this thread is in an unknown state, possibly corrupted by foreign code (OpenGL, Win32 GUI, signal masks)." The M is terminated and not returned to the M pool. Over many invocations of `runOnOpenGLThread`, threads leak — eventually the process hits `pthread_create` limits or RLIMIT_NPROC and crashes with "runtime: program exceeds NN-thread limit".

**Why subtle:** A single call works. A long-running daemon that spawns one of these per session leaks one thread per session. Standard process monitors track goroutines, not OS threads; the leak is invisible until `pthread_create` itself fails.

**Spot:** Any `runtime.LockOSThread()` whose function does not also `defer runtime.UnlockOSThread()` or arrange for unlock on every exit path. The pairing should be as airtight as `mu.Lock()` / `defer mu.Unlock()`.

**Fix:** Pair them with `defer`:

```go
func runOnOpenGLThread() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    initOpenGL()
    for ev := range events {
        renderFrame(ev)
    }
}
```

If thread death *is* what you want — e.g. the thread's TLS is poisoned beyond recovery — that's a one-time `main` initialiser, not a per-call pattern. Document it.

**Why common:** `LockOSThread` is presented in tutorials as "call this to pin to an OS thread", with the unlock as a footnote. Authors copy the snippet and skip the footnote. The leak manifests in production, not in single-test runs.
</details>

---

## Bug 4 — `GOMAXPROCS(1)` expected to make races impossible

```go
func main() {
    runtime.GOMAXPROCS(1)
    var counter int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            counter++          // BUG: still a race, race detector flags it
            wg.Done()
        }()
    }
    wg.Wait()
    fmt.Println(counter)        // also not always 1000
}
```

<details><summary>Answer</summary>

**Bug:** Two distinct misconceptions. (1) `GOMAXPROCS(1)` limits the runtime to *one P* — one G runs at a time — but the scheduler still preempts G's at function-call boundaries (and on go1.14+ at arbitrary instruction boundaries via signal). `counter++` is `load → add → store`; a preemption between any two of those steps loses an update. (2) The race detector instruments memory accesses for the *happens-before* relation defined by the Go memory model, not for actual concurrent CPU execution. Even with one P, two G's accessing `counter` without synchronisation have no happens-before edge between them. `go run -race` flags it correctly.

**Why subtle:** "Only one goroutine runs at a time, so increments are atomic" sounds right and is wrong. Go's memory model is defined in terms of sync primitives (channels, mutexes, `atomic`), not CPU parallelism. `GOMAXPROCS(1)` changes parallelism, not the model.

**Spot:** Any program that uses `GOMAXPROCS(1)` as a synchronisation strategy. The right strategies are `sync.Mutex`, `atomic.AddInt64`, channels, or — best — restructuring so only one goroutine owns the variable.

**Fix:** Use a real synchronisation primitive. `atomic.AddInt64(&counter, 1)` is the smallest fix; a mutex or a channel-based aggregator scales better. `GOMAXPROCS(1)` should be reserved for benchmarks, deterministic replay, or single-CPU embedded targets — never for correctness.

**Why common:** Folklore from single-CPU days persists. The race detector's existence is supposed to dispel it, but a project that doesn't run `-race` in CI never gets the correction.
</details>

---

## Bug 5 — Busy-spin goroutine masks the real problem

```go
func main() {
    done := make(chan struct{})

    // "Watchdog" — wake periodically to print stats.
    go func() {
        for {
            // BUG: busy spin, no sleep, no select, no channel op
            if statsReady() {
                printStats()
            }
        }
    }()

    runApp(done)
    <-done
}
```

<details><summary>Answer</summary>

**Bug:** The "watchdog" goroutine runs an unbounded busy loop calling `statsReady()` and `printStats()`. On go1.14+ the runtime *can* preempt it (asynchronously, via `SIGURG`), so other G's run; on go1.13 the function calls inside the loop body give cooperative preemption points anyway. *But*: the watchdog still consumes a full CPU's worth of cycles for nothing. `runtime.findRunnable` (`runtime/proc.go`) hands the P back to this G every time it's runnable, which is every time. The misdiagnosis is "the runtime is broken — my server uses 100% CPU at idle". The runtime is doing exactly what it was asked.

**Why subtle:** It's not a *correctness* bug — `runApp` still runs, `printStats` still fires. It's a *resource* bug. The fix is one line, and the diagnosis path goes through `top`, `pprof` (showing the spin frames at 100% CPU), and finally the realisation that an event-driven goroutine was written as a polling loop.

**Spot:** Any `for { if cond { ... } }` without a `time.Sleep`, `time.NewTicker`, `select` on a channel, or other blocking call. Same for any "polling" goroutine — polling belongs in the kernel (epoll/kqueue, which Go's netpoller already uses), not in user-space CPU loops.

**Fix:** Drive the watchdog from a timer or a channel:

```go
go func() {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:
            if statsReady() { printStats() }
        case <-done:
            return
        }
    }
}()
```

Now the G is parked on the ticker channel between firings (`runtime.gopark` puts it in `_Gwaiting`), the M is freed to run other work, and CPU at idle drops to ~0.

**Why common:** "Goroutines are cheap" gets misread as "loops are free". They aren't — a running G keeps a P busy and a CPU hot.
</details>

---

## Bug 6 — `GOMAXPROCS(NumCPU())` inside a Docker container

```go
func main() {
    runtime.GOMAXPROCS(runtime.NumCPU())   // BUG: ignores cgroup CPU quota
    // ... heavy concurrent work
}

// Container started with: docker run --cpus=2 myapp
// Host has 32 cores, NumCPU() returns 32.
```

<details><summary>Answer</summary>

**Bug:** `runtime.NumCPU()` returns the number of CPUs the OS sees, not the number the *cgroup* quota allows the container to use. On a 32-core host with `--cpus=2`, `NumCPU()` returns 32. `GOMAXPROCS(32)` lets the Go scheduler spin up 32 P's; the kernel CPU throttler then limits the container to 2 cores' worth of CPU time. Result: 16 G's pile up waiting for CPU time, context switches multiply, tail latency spikes, and `pprof` shows huge `runtime.findRunnable` and `futex` time as P's contend for the throttled budget.

**Why subtle:** It looks correct everywhere. Local laptops have no quota — the number is right. Bare-metal hosts have no quota — the number is right. Only containerised production hits the throttle; the symptom is "latency is fine in staging, terrible in prod, and CPU usage looks low".

**Spot:** Any `runtime.GOMAXPROCS(runtime.NumCPU())`, or no explicit `GOMAXPROCS` at all (the default is `NumCPU()`), in a service deployed to Kubernetes or Docker with CPU limits.

**Fix:** Use `github.com/uber-go/automaxprocs` (or read `/sys/fs/cgroup/cpu.max` directly). `automaxprocs` reads the cgroup v1 / v2 CPU quota and calls `GOMAXPROCS` with the quota-aware value:

```go
import _ "go.uber.org/automaxprocs"
// blank import: init() sets GOMAXPROCS from the cgroup quota.
```

Go 1.25 finally made the runtime cgroup-aware by default, so on that version onward the bug is fixed at the source. For 1.24 and earlier, `automaxprocs` is the standard solution.

**Why common:** Containers became universal long before Go's runtime grew quota awareness. The mismatch was the single largest source of "my Go service has weird latency in Kubernetes" tickets between 2017 and 2025.
</details>

---

## Bug 7 — `runtime.Gosched()` "fixing" a deadlock

```go
var mu sync.Mutex

func transfer(from, to *Account, amt int) {
    from.mu.Lock()
    to.mu.Lock()                       // BUG: lock-order inversion possible
    from.balance -= amt
    to.balance += amt
    to.mu.Unlock()
    from.mu.Unlock()
}

// Symptom: occasional deadlock. "Fix" applied:
func transfer2(from, to *Account, amt int) {
    for !from.mu.TryLock() { runtime.Gosched() }   // BUG: masks lock order
    for !to.mu.TryLock()   { runtime.Gosched() }
    // ... etc
}
```

<details><summary>Answer</summary>

**Bug:** The real bug is a classic AB-BA deadlock: `transfer(a, b)` and `transfer(b, a)` running concurrently can each hold one lock and want the other. The "fix" replaces blocking `Lock` with `TryLock` + `Gosched` — but `TryLock` returning false doesn't *break* the deadlock, it just turns the deadlock into a *livelock*: both goroutines spin forever yielding, neither making progress. The scheduler isn't broken; the lock-order discipline is.

**Why subtle:** Livelock looks better than deadlock because the program doesn't appear stuck — `pprof` shows CPU usage. But neither transfer ever completes. "I sprinkled `Gosched` and the hang went away" — no, the hang became a busy hang.

**Spot:** Any `for !mu.TryLock() { runtime.Gosched() }` retry loop. `sync.Mutex.TryLock` (Go 1.18+) is for "skip if busy" semantics, not "spin until acquired" — that's just `Lock` with extra steps.

**Fix:** Establish a total order on locks (sort by pointer, by ID, by name) and always acquire in that order:

```go
func transfer(from, to *Account, amt int) {
    first, second := from, to
    if uintptr(unsafe.Pointer(first)) > uintptr(unsafe.Pointer(second)) {
        first, second = second, first
    }
    first.mu.Lock()
    defer first.mu.Unlock()
    second.mu.Lock()
    defer second.mu.Unlock()
    from.balance -= amt
    to.balance += amt
}
```

Or use a single global mutex if the contention budget allows. The scheduler isn't the right layer to fix a missing invariant.

**Why common:** `Gosched` looks like a "give the other goroutine a chance" — and it is, but giving the other goroutine a chance to also fail isn't progress. The instinct is right; the depth of the fix is wrong.
</details>

---

## Bug 8 — Cgo call per loop iteration; entersyscall dominates

```go
/*
#include <math.h>
*/
import "C"

func hotLoop(xs []float64) []float64 {
    out := make([]float64, len(xs))
    for i, x := range xs {
        out[i] = float64(C.sqrt(C.double(x)))   // BUG: cgo per iteration
    }
    return out
}
```

<details><summary>Answer</summary>

**Bug:** Every `C.sqrt` call routes through cgo: the G is parked, `runtime.entersyscall` (in `runtime/proc.go`) hands the P to another M, the call dispatches to C through a thunk, and on return `runtime.exitsyscall` re-acquires a P (sometimes a different one, sometimes after a context switch). Reported overhead per cgo call is ~200ns–1μs depending on Go version and platform. For a `sqrt` whose actual cost is a few CPU cycles, the cgo overhead is 100–1000× the useful work. The hot loop runs orders of magnitude slower than `math.Sqrt`.

**Why subtle:** The code is *correct*. It produces the right output. The only signal is that the function is mysteriously slow, and the cause is in the runtime layer the developer doesn't usually inspect. `pprof` showing time inside `runtime.cgocall` and `runtime.exitsyscall` is the smoking gun.

**Spot:** Any cgo call inside a hot loop. Cgo is for crossing the boundary *occasionally* — opening a database driver, calling a vendor library — not for per-iteration math that the standard library already exposes.

**Fix:** Use the Go standard library when one is available:

```go
import "math"

func hotLoop(xs []float64) []float64 {
    out := make([]float64, len(xs))
    for i, x := range xs {
        out[i] = math.Sqrt(x)        // pure Go, inlined, no cgo
    }
    return out
}
```

When cgo is genuinely required (calling a C library with no Go equivalent), batch: cross the boundary *once* with a slice header and let the C code do the loop. The overhead is fixed per call, amortised across the batch.

**Why common:** Cgo's syntactic convenience hides the runtime cost. Developers who measure microbenchmarks of `C.sqrt` in isolation see the per-call cost; developers who write the loop directly don't, until the loop is in production.
</details>

---

## Bug 9 — Blocking file I/O ties up the M (no netpoller help)

```go
func processFiles(paths []string) {
    sem := make(chan struct{}, runtime.GOMAXPROCS(0))
    var wg sync.WaitGroup
    for _, p := range paths {
        wg.Add(1)
        sem <- struct{}{}
        go func(p string) {
            defer wg.Done()
            defer func() { <-sem }()
            data, _ := os.ReadFile(p)            // BUG: blocking file I/O
            process(data)
        }(p)
    }
    wg.Wait()
}
```

<details><summary>Answer</summary>

**Bug:** `os.ReadFile` on local disk is a *blocking* syscall on Linux — the kernel does not deliver disk I/O readiness via epoll the way it does for sockets. (io_uring fixed this in 2019; the Go runtime started experimenting with it via `GOEXPERIMENT=rawfileio` years later but it isn't on by default until very recently.) When the G blocks in `read`, the M blocks too — `entersyscall` handed the P to another M, but the M with the G is stuck waiting on the disk. Spawning more goroutines than `GOMAXPROCS` doesn't help because work-stealing requires runnable G's on idle P's; blocked G's on blocked M's aren't stealable.

**Why subtle:** It looks like the right pattern — bounded concurrency via a semaphore, one G per file. Network I/O *does* scale this way (the netpoller parks the G and re-schedules on readiness, freeing the M). File I/O does not, on most kernels. The semaphore size limits parallelism artificially; raising it spawns more OS threads but doesn't proportionally raise disk throughput.

**Spot:** Any pattern that assumes disk I/O scales like network I/O. `os.ReadFile`, `os.Open` + `Read`, `os.WriteFile` all block the M on Linux. The fix is *not* "more goroutines"; it's "match concurrency to the disk's actual queue depth".

**Fix:** Either accept that one G per file ≈ one M per file and size accordingly (typically `min(NumCPU(), files)` is enough — most of the work after `ReadFile` is CPU-bound), or use a real async-IO interface: `golang.org/x/sys/unix` plus io_uring (e.g., `iouring-go`), or move the I/O into a separate worker pool with fewer goroutines than P's so the rest of the program isn't starved of M's. The standard library file API has no async story; if disk concurrency is the bottleneck, you've outgrown it.

**Why common:** Newcomers learn "goroutines scale because of the netpoller" and assume the netpoller covers *all* I/O. It covers sockets, pipes, and (on some systems) ttys — not disk reads.
</details>

---

## Bug 10 — Unbounded goroutine spawn outruns completion

```go
func ingest(stream <-chan Event) {
    for ev := range stream {
        go func(ev Event) {                  // BUG: no bound
            heavy(ev)                         // takes ~50ms
        }(ev)
    }
}
// stream produces 100k events per second; heavy() takes 50ms.
// goroutines accumulate at ~95k/sec until OOM.
```

<details><summary>Answer</summary>

**Bug:** Goroutines are cheap but not free. Each one starts with an 8 KB stack (growable). At 100k spawned/sec and 50ms each, 5000 are active at any moment in the *best* case; in practice spawn rate exceeds completion rate, so the goroutine count grows linearly with time. Each G also occupies a slot in the runtime's scheduler structures (`allgs`, the P's run queue if runnable, the G->M handoff structures). After a minute, you have 6 million live G's, ~48 GB of stack memory, and the runtime is spending most of its CPU in `runtime.findRunnable` walking long run queues. The process OOMs.

**Why subtle:** Spawning is cheap *per spawn*; the cost is cumulative. Tests with a fixed batch of N events complete normally if N is small; production with a continuous high-rate stream blows up. The fix is "bound concurrency", but it requires explicit machinery the unbounded form doesn't.

**Spot:** Any `for x := range stream { go work(x) }` or `for { go work() }` where the spawn rate isn't capped. The runtime has no built-in back-pressure for goroutine count.

**Fix:** Use a worker pool with a bounded number of workers fed by a channel; or use a counting semaphore (`semaphore.NewWeighted`) to cap in-flight work; or `errgroup.Group.SetLimit` (Go 1.20+):

```go
func ingest(stream <-chan Event) {
    jobs := make(chan Event, 256)
    var wg sync.WaitGroup
    for i := 0; i < runtime.GOMAXPROCS(0)*4; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for ev := range jobs { heavy(ev) } }()
    }
    for ev := range stream { jobs <- ev }    // blocks when workers are full
    close(jobs)
    wg.Wait()
}
```

The blocking send on `jobs <- ev` is the back-pressure: if workers can't keep up, the producer slows down (or, ideally, the upstream sees the slowdown and drops / queues).

**Why common:** "Goroutines are cheap" is repeated so often that "spawn one per event" becomes the default mental model. It's true for small N and catastrophic at scale. The transition point is usually somewhere in production.
</details>

---

## Bug 11 — `time.After` in a hot loop leaks timers

```go
func consumer(ch <-chan Job) {
    for {
        select {
        case j := <-ch:
            process(j)
        case <-time.After(time.Second):    // BUG: new timer every iteration
            log.Println("idle")
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** `time.After(d)` allocates a new `*time.Timer` (and goroutine — actually, since Go 1.23, the runtime uses a more efficient timer wheel, but the allocation persists) on every call. When the channel `ch` is busy and the timer never fires, the timer object is *not* garbage collected until it does fire — its goroutine is still parked on the timer. Over a busy consumer loop, this accumulates one timer per iteration. At 10k jobs/sec, that's 10k timers spinning up per second, all parked, all waiting on the 1-second timeout that will never come (because the next iteration creates a new timer). The runtime's timer heap (`runtime.timers`) grows, GC pressure rises, and the symptom is "memory usage grows linearly with throughput".

**Why subtle:** It looks idiomatic. `time.After` reads naturally in a `select`. The leak is invisible to the source — it's the lifetime of the returned channel that's the problem. Fixed in Go 1.23 in the sense that the timer *can* be GC'd earlier (the package docs were updated), but the cost of allocation per iteration remains.

**Spot:** Any `case <-time.After(d):` inside a `for` loop or `for select` whose other case fires frequently. Equally bad in any hot path: `time.After` is for one-shot waits, not for repeated polling.

**Fix:** Hoist the timer outside the loop with `time.NewTimer` (one timer, reset each iteration) or `time.NewTicker` (fires repeatedly):

```go
func consumer(ch <-chan Job) {
    t := time.NewTimer(time.Second)
    defer t.Stop()
    for {
        select {
        case j := <-ch:
            process(j)
            if !t.Stop() { <-t.C }       // drain if it fired during process
            t.Reset(time.Second)
        case <-t.C:
            log.Println("idle")
            t.Reset(time.Second)
        }
    }
}
```

For "do something every N seconds regardless of work" semantics, `time.NewTicker` is simpler. The `Stop` + drain pattern is documented in `time.Timer.Reset`'s godoc.

**Why common:** `time.After` is in every `select`-with-timeout snippet on the internet. It's correct for one-shot waits. The conversion to "fire repeatedly" hides the leak unless someone profiles long-running consumers under load.
</details>

---

## Bug 12 — Producer spawns a goroutine per item

```go
type Producer struct{ out chan<- Item }

func (p *Producer) Send(items []Item) {
    for _, it := range items {
        go func(it Item) {                  // BUG: one G per item just to send
            p.out <- it
        }(it)
    }
}

// caller pushes 1M items. 1M goroutines spawn; channel buffer is 100.
// 999,900 goroutines park on chansend.
```

<details><summary>Answer</summary>

**Bug:** The producer spawns one goroutine per item, each of which immediately tries to send on a buffered channel. If the channel has buffer capacity, the first 100 sends succeed; the remaining 999,900 G's call `runtime.chansend` (in `runtime/chan.go`), find the buffer full, and `gopark` themselves on the channel's `sendq`. Each parked G holds its 8 KB stack and a scheduler structure. Memory blows up. The scheduler's run queue is fine — these G's are *waiting*, not runnable — but the residual structures still cost.

**Why subtle:** Channel send "blocks" makes it sound like the goroutine is free. The goroutine *is* parked (not on the run queue, not consuming CPU), but it's still in memory and still tracked. Spawning a G just to do a single channel send and exit is pure overhead — the caller could have done the send itself.

**Spot:** Any `go func(){ ch <- x }(x)` or `go func(){ ch <- compute(x) }(x)` where the goroutine's *only* job is to do one send. The goroutine adds nothing — it's a way to make the caller non-blocking, but it converts memory pressure into a "feature".

**Fix:** Either send synchronously from the caller (let the channel's natural back-pressure flow through) or use a small fixed pool of sender goroutines pulling from a local slice. If non-blocking semantics are required, use `select` with `default` to drop or buffer:

```go
func (p *Producer) Send(items []Item) {
    for _, it := range items {
        p.out <- it    // back-pressure flows up
    }
}
// or non-blocking with explicit policy:
func (p *Producer) TrySend(it Item) bool {
    select {
    case p.out <- it: return true
    default:           return false       // dropped; caller decides what to do
    }
}
```

**Why common:** `go func(){ ... }()` is the shortest "do this in the background" syntax. For genuinely independent work it's right; for "block on a channel" it isn't. The goroutine adds a layer of asynchronicity without adding any computation.
</details>

---

## Bug 13 — `select` with `default` busy-loops the scheduler

```go
func worker(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-ch:
            process(j)
        default:                              // BUG: makes select non-blocking
            // nothing
        }
    }
}
```

<details><summary>Answer</summary>

**Bug:** A `select` with a `default` case is *non-blocking* — if neither `ctx.Done()` nor `ch` is ready, the `default` arm runs and the loop immediately iterates. The worker now spins at 100% CPU, asking "anything ready? anything ready? anything ready?" thousands of times per microsecond. The scheduler can preempt it (so other G's run), but the worker still consumes one P's worth of CPU continuously.

**Why subtle:** Add `default:` to a `select` and the program "feels more responsive" — there's no blocking, the worker is "always ready". That's exactly the problem. `select` without `default` parks the G in `runtime.selectgo` (in `runtime/select.go`) until *some* case becomes ready; the M is freed, the P is freed, the CPU is freed. With `default`, none of that happens.

**Spot:** Any `select { ... default: ... }` inside a `for` loop where the `default` case is empty or does only trivial work. The combination "for + select + default" is a near-certain busy loop.

**Fix:** Remove the `default` arm — `select` with only real cases blocks until one fires, which is the desired behaviour:

```go
func worker(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-ch:
            process(j)
        }
    }
}
```

If "non-blocking try" is genuinely needed (rare in worker patterns), pair the `default` with a `time.Sleep` to back off, or restructure so the polling is event-driven.

**Why common:** The `default` arm is often added defensively — "in case the channel and ctx aren't ready, I don't want to block". But blocking *is* what makes Go's scheduler efficient. Non-blocking on every iteration converts an event-driven worker into a polling worker.
</details>

---

## Bug 14 — Forgotten `wg.Done()` traps a parked goroutine

```go
func process(items []Item) error {
    var wg sync.WaitGroup
    errs := make(chan error, len(items))
    for _, it := range items {
        wg.Add(1)
        go func(it Item) {
            if err := step1(it); err != nil {
                errs <- err
                return                       // BUG: forgot wg.Done() on this path
            }
            if err := step2(it); err != nil {
                errs <- err
                wg.Done()
                return
            }
            wg.Done()
        }(it)
    }
    wg.Wait()                                // hangs forever if any step1 fails
    close(errs)
    // ...
}
```

<details><summary>Answer</summary>

**Bug:** One return path forgets `wg.Done()`. If any `step1` fails, that goroutine returns without decrementing the WaitGroup counter. `wg.Wait()` blocks forever — its goroutine is parked in `runtime.semacquire` waiting for the counter to hit zero. Main is hung. The scheduler keeps the parked G alive forever, dutifully waiting for a Done that will never come.

**Why subtle:** The happy path (`step1` and `step2` both succeed) decrements correctly. The first-error path (`step2` fails) decrements correctly. The bug is on the rarest path — `step1` fails. Tests that use mocks where `step1` always succeeds never see the hang.

**Spot:** Any goroutine with multiple `return` paths after `wg.Add(1)`. Either move `wg.Done()` to `defer` at the start, or audit every exit path. `defer` is dramatically less error-prone.

**Fix:** Use `defer wg.Done()` as the first line:

```go
go func(it Item) {
    defer wg.Done()                          // runs on every return path
    if err := step1(it); err != nil { errs <- err; return }
    if err := step2(it); err != nil { errs <- err; return }
}(it)
```

The `defer` adds ~50ns per goroutine (`runtime.deferproc` + `runtime.deferreturn`), which is negligible compared to the cost of debugging a "main hangs sometimes" bug in production.

**Why common:** Multiple `return` statements feel natural for error handling. The cost is one missed `wg.Done()` per added path. `defer` makes the count maintenance positional, not branch-dependent.
</details>

---

## Bug 15 — `LockOSThread` then `UnlockOSThread` mid-function

```go
// Wrapping a thread-local-state C library.
func renderFrame(ev Event) error {
    runtime.LockOSThread()
    if err := C.bindContext(); err != 0 {
        runtime.UnlockOSThread()             // BUG: unlocked while still on the thread
        return fmt.Errorf("bind: %d", err)
    }
    runtime.UnlockOSThread()                 // BUG: unlocked, but cgo state is still on this thread
    return drawFrame(ev)                     // may now run on a different M
}
```

<details><summary>Answer</summary>

**Bug:** The author thought `LockOSThread` was needed only for the `bindContext` call, and unlocked as soon as that returned. The Go scheduler now considers the G free to migrate to another M. But `bindContext` registered thread-local state on the *original* OS thread; `drawFrame` (which presumably reads that state) may run on a different M, where the thread-local slot is empty or stale. The function appears to work the first call (the G stays on the same M by coincidence), then breaks intermittently as the scheduler exercises its freedom to move work.

**Why subtle:** It's the *opposite* of Bug 3. There the bug was forgetting `UnlockOSThread`; here the bug is calling it too early. The G needs to stay locked to the thread for the *entire* duration that thread-local state is in play. The function name `renderFrame` suggests "one rendering pass" — and "one pass" is exactly the lock window.

**Spot:** Any `runtime.LockOSThread` / `UnlockOSThread` pair where the unlock happens before all dependent thread-local operations have completed. The rule: a locked G can do anything; an unlocked G can be migrated. Migration in the middle of thread-local work is the bug.

**Fix:** Hold the lock for the full scope:

```go
func renderFrame(ev Event) error {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    if err := C.bindContext(); err != 0 {
        return fmt.Errorf("bind: %d", err)
    }
    return drawFrame(ev)
}
```

If `drawFrame` itself spawns goroutines, those new G's are *not* locked to the M — they need their own `LockOSThread` *or* the work must come back to this G before any new G is allowed to touch thread-local state.

**Why common:** `LockOSThread` is presented as a one-line marker. The scoping question — *for how long?* — is often glossed. Code reviews catch missing unlocks (Bug 3) more readily than early unlocks (Bug 15), because the latter looks correct from local reading.
</details>

---

## Bug 16 — `runtime.Goexit()` instead of `return`

```go
func worker(id int) {
    defer fmt.Printf("worker %d done\n", id)
    if id < 0 {
        runtime.Goexit()                     // BUG: doesn't terminate main
    }
    process(id)
}

func main() {
    worker(-1)                               // calls Goexit from the main goroutine
    fmt.Println("after worker")              // never runs
    // program hangs in "no goroutines" state.
}
```

<details><summary>Answer</summary>

**Bug:** `runtime.Goexit()` terminates the *calling goroutine*, running its deferred functions, then exits. Called from the main goroutine, it terminates main itself. After main is gone, the runtime checks "are there any non-daemon goroutines left?" — there aren't (every other G in this snippet has already finished or never started) — and the program exits with `fatal error: no goroutines (main called runtime.Goexit) - deadlock!`. If background G's *are* running, the program continues without main, prints nothing more, and is effectively zombified — the runtime can't terminate (other G's are still running) and can't make progress (main is gone).

**Why subtle:** `Goexit` is documented as "terminates the goroutine that calls it". Calling it from main terminates the main goroutine, which is *not* the same as `os.Exit`. The semantic distinction is exactly the kind of detail that's easy to miss reading the godoc once.

**Spot:** Any `runtime.Goexit()` outside a goroutine spawned with `go` — and even there, prefer `return` unless you specifically need deferred functions in *all* enclosing frames to run.

**Fix:** Use `return` (or, for main, `os.Exit(1)` if termination of the whole program is intended):

```go
func worker(id int) {
    defer fmt.Printf("worker %d done\n", id)
    if id < 0 {
        return                               // ordinary control flow
    }
    process(id)
}
```

`Goexit` is rarely the right primitive. The legitimate use is "run all my deferred cleanup *and any of my callers' deferred cleanup* before terminating this G" — most often inside test helpers that want to terminate the test goroutine without killing the test binary.

**Why common:** `Goexit` reads like "exit but only the goroutine, not the program". It is. But the main goroutine is a goroutine, so calling it from main exits *main* — which destabilises the program. The semantics are correct; the framing is misleading.
</details>

---

## Bug 17 — `init()` spawns a goroutine that deadlocks before main

```go
var ready = make(chan struct{})

func init() {
    go func() {
        <-ready                              // BUG: nothing sends to ready
        fmt.Println("background ready")
    }()
}

func main() {
    // ... main does normal work, never closes ready.
    fmt.Println("main done")
}
```

<details><summary>Answer</summary>

**Bug:** The goroutine spawned in `init()` parks on `<-ready` forever. The Go runtime's deadlock detector (`runtime.checkdead` in `runtime/proc.go`) only fires when *every* G is parked and no G is runnable. Since `main`'s goroutine is running, the detector never fires for the orphan G. The program prints "main done" and exits — taking the orphan G with it, no warning, no panic. If the orphan G was *supposed* to do work, that work silently never happens.

**Why subtle:** No error. No panic. No log line. The program produces what looks like a clean shutdown. The bug surfaces only when someone notices the work the goroutine was supposed to do never happened.

**Spot:** Any `init()` that spawns goroutines, especially ones that wait on channels, mutexes, or condition variables. `init()` runs once before main, and any goroutine it leaves parked is a silent leak.

**Fix:** Don't spawn worker goroutines from `init`. Spawn them from `main` (or a `Start` method called from main) where their lifecycle is bound to the program's lifecycle:

```go
func StartBackground(ctx context.Context) {
    go func() {
        select {
        case <-ready:
            fmt.Println("background ready")
        case <-ctx.Done():
            return
        }
    }()
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    StartBackground(ctx)
    // ...
}
```

The context gives the G an exit path that fires on shutdown, so it's not silently leaked when main returns.

**Why common:** `init()` looks like a place to "set up the world" — register singletons, open connections, start background workers. The first two are fine; the third has the lifecycle mismatch above. Stick to declarative setup in `init` and spawn from `main`.
</details>

---

## Bug 18 — Signal handler does blocking work; async-safe preemption breaks

```go
func main() {
    sigs := make(chan os.Signal, 1)
    signal.Notify(sigs, syscall.SIGUSR1)
    go func() {
        for range sigs {
            // BUG: blocking DB call from inside what is morally a signal handler
            db.Exec("INSERT INTO audit VALUES (...)")
        }
    }()
    runApp()
}
```

<details><summary>Answer</summary>

**Bug:** Two layered issues. (1) `os/signal` notification is *not* the kernel signal handler — Go's runtime installs its own handler that posts to the channel, which is async-safe. So strictly speaking, you *can* do blocking work in the goroutine reading from `sigs`. (2) The real bug is that signals on Go 1.14+ are *also* used internally for asynchronous preemption — `runtime.preemptone` sends `SIGURG` to the M to interrupt the running G. If you install your own handler for `SIGURG` (a likely overlap if you're inheriting handlers from C code or another runtime), you break the runtime's preemption machinery; goroutines stop being preemptible at instruction boundaries and fall back to cooperative behaviour.

The bug as written is less dramatic — it works correctly — but illustrates the trap: any signal handler *outside* the Go signal channel mechanism that calls back into Go must obey async-safe rules, and any handler that uses `SIGURG` (or interferes with `SIGPROF`, used by the CPU profiler) breaks runtime invariants.

**Why subtle:** It "works" — the audit log writes happen — and only fails when (a) someone runs the program under heavy preemption pressure or (b) someone installs a non-Go signal handler for `SIGURG`. The connection between application code and runtime signal use is invisible from the source.

**Spot:** Any direct `signal.Notify` use is fine. Any cgo code that calls `sigaction` directly, or any program that handles `SIGURG` outside Go's channel mechanism, is a red flag.

**Fix:** For application-level signal handling, stick to `signal.Notify` — it's safe. For cgo or low-level interop, *never* install handlers for `SIGURG`, `SIGPROF`, `SIGCHLD`, or `SIGCANCEL`; the Go runtime needs all of them. The `os/signal` documentation explicitly lists which signals are reserved.

**Why common:** Programs mixing cgo and signal-using libraries (most graphics libraries, some database drivers) accidentally clobber runtime signals. The symptom is "preemption stops working" — a hot loop in one G freezes other G's on go1.14+. The cause is sometimes hours of bisection away from the signal handler installation.
</details>

---

## Summary

These bugs cluster into four families.

**Preemption and scheduling fairness (1, 2, 5, 13):** tight loops with no preemption point on go1.13, `runtime.Gosched` sprinkled defensively, busy-spin "watchdogs", and `select` with `default` converting a parked G into a polling G. The Go scheduler is cooperative on go1.13 and asynchronously preemptive on go1.14+; either way, blocking on channels, timers, or syscalls is how a G releases its P. Any G that never blocks consumes a CPU's worth of CPU forever — that's the cost, not a bug in the runtime.

**Thread / M discipline (3, 8, 9, 15, 18):** `LockOSThread` without `UnlockOSThread` leaks threads; `LockOSThread` unlocked too early loses thread-local state; cgo per iteration burns the boundary cost; blocking file I/O ties up an M because the netpoller doesn't cover disk; signal handlers that overlap with runtime-reserved signals break preemption. The scheduler's job is to multiplex G's onto M's onto P's; any operation that pins a G to an M (`LockOSThread`, blocking syscalls, cgo) breaks the multiplexing for the duration of that pin. Use them deliberately, scope them tightly, pair them with `defer`.

**Resource accounting (4, 6, 10, 11, 12):** `GOMAXPROCS(1)` mistaken for synchronisation, `NumCPU()` mistaken for cgroup quota, unbounded goroutine spawn, `time.After` allocating per iteration, goroutines whose only job is one channel send. Goroutines are cheap per spawn and expensive per million; the runtime gives you the scheduler, not back-pressure. Concurrency limits — worker pools, semaphores, `errgroup.SetLimit` — are the user's responsibility.

**Lifecycle correctness (7, 14, 16, 17):** `Gosched` masking a lock-order deadlock as livelock; missed `wg.Done()` on an error path parking `Wait` forever; `runtime.Goexit()` from main killing main; `init()` spawning a goroutine that outlives the only path that could unblock it. The scheduler dutifully waits on parked G's even when nothing will unpark them. The scheduler is not the deadlock detector; `checkdead` only catches the case where *every* G is parked.

Review checklist for any scheduler-adjacent PR — goroutine spawning, sync primitives, signal handling, cgo, or `runtime` package use:

- [ ] Does every `for { ... }` body contain a function call, a channel op, an allocation, or a `runtime.Gosched` so preemption can fire on go1.13? On go1.14+, is the loop guaranteed not to disable signal preemption (no cgo bridges holding `SIGURG`)?
- [ ] Is every `runtime.Gosched()` justified — backing off a lock-free retry, or a documented go1.13 preemption point — and *not* a "be fair" sprinkle?
- [ ] Is every `runtime.LockOSThread()` paired with a `defer runtime.UnlockOSThread()`, scoped to cover *all* thread-local-state-dependent operations?
- [ ] Is `GOMAXPROCS` set from the cgroup quota (via `automaxprocs` or Go 1.25+) rather than `runtime.NumCPU()` in any containerised deployment?
- [ ] Is concurrency bounded? Every `go func(){...}()` should answer: how many of these can exist at once, and what's the back-pressure mechanism (worker pool, semaphore, `errgroup.SetLimit`, channel buffer)?
- [ ] Does every cgo call live outside hot loops — or, if inside, is the loop *itself* in C, called once across a batch of work?
- [ ] Is blocking file I/O treated as M-pinning — sized to `~NumCPU` workers, not "one G per file"?
- [ ] Is `time.After` outside hot loops — replaced by a hoisted `time.NewTimer` (with `Reset`) or `time.NewTicker` (with `Stop`)?
- [ ] Is every `select` inside a `for` loop blocking (no `default:` arm) unless non-blocking semantics are explicitly required and paired with back-off?
- [ ] Does every `wg.Add(1)` in a goroutine pair with `defer wg.Done()` as the first statement, so all return paths decrement?
- [ ] Is `runtime.Goexit()` used only where deferred-frames-must-run termination is genuinely required — never from `main`?
- [ ] Are background goroutines spawned from `main` (or a `Start` method), bound to a context, not from `init()`?
- [ ] Do signal handlers go through `os/signal.Notify` (safe) and avoid `SIGURG`/`SIGPROF`/`SIGCHLD`/`SIGCANCEL` (reserved by the runtime)?
- [ ] Does the program run cleanly under `go test -race -timeout 5m` and `go build && pprof -http :8080` on a representative workload, so latent races, leaks, and CPU spins surface in CI rather than production?
