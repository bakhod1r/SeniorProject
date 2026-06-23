# Goroutine Common Pitfalls — Professional Level

> Focus: how the Go runtime — scheduler, GC, network poller, cgo — turns innocent-looking pitfalls into pathologies at scale. What the runtime sees, what it cannot see, and how to diagnose problems that span both worlds.

## Table of Contents
1. [Runtime visibility into pitfalls](#runtime-visibility-into-pitfalls)
2. [Scheduler starvation pitfalls](#scheduler-starvation-pitfalls)
3. [GC pressure from goroutine churn](#gc-pressure-from-goroutine-churn)
4. [M leaks via cgo and `LockOSThread`](#m-leaks-via-cgo-and-lockosthread)
5. [Network poller pitfalls](#network-poller-pitfalls)
6. [Memory-model subtleties](#memory-model-subtleties)
7. [Stack growth and oversize closures](#stack-growth-and-oversize-closures)
8. [Diagnosing in production](#diagnosing-in-production)
9. [Summary](#summary)

---

## Runtime visibility into pitfalls

The Go runtime exposes a finite set of signals. Knowing them is the difference between debugging blind and debugging informed.

| Signal | What it tells you | What it does *not* tell you |
|---|---|---|
| `runtime.NumGoroutine()` | Current count of goroutines | What they are doing, why they exist, when they exit |
| `pprof goroutine` | Stack trace of every goroutine | Per-goroutine memory, scheduler state over time |
| `pprof heap` | Heap allocations by stack | What is *referenced* by each goroutine |
| `runtime/trace` | Per-event scheduler / GC trace | Steady-state behaviour beyond the trace window |
| `GODEBUG=schedtrace=1000` | Periodic scheduler stats | Goroutine-level detail |
| Race detector | Observed races during a run | Races on unexecuted paths |
| `fatal error: concurrent map writes` | A specific runtime check fired | Any other concurrency bug |

When debugging, identify which signal you can read and what it cannot answer. Many production bugs are invisible to *every* signal and require code-level reasoning. The race detector cannot run on a 100 GB heap production binary; pprof goroutine dumps can be 10 MB and slow.

---

## Scheduler starvation pitfalls

### Pitfall: tight CPU-bound loop preempts other goroutines slowly

Pre-Go 1.14, a tight loop without function calls was *uninterruptible*. The scheduler could only preempt at function entry. A goroutine running `for { x++ }` could hold the M indefinitely.

Go 1.14+ added asynchronous preemption: the runtime uses signals to interrupt long-running goroutines. The cost is small per-context-switch overhead and some interaction with cgo and signal handlers. The benefit is that pre-1.14 starvation patterns are gone.

What is *not* gone: cgo. A goroutine inside a C function call holds its M for the entire C call. No preemption. If you have 8 cores and 8 goroutines all stuck in `C.expensive()`, the runtime has zero Ms for any other goroutine to run.

**Fix.** Bound cgo concurrency with a semaphore. Treat cgo calls as long syscalls.

### Pitfall: many goroutines in `LockOSThread` saturate Ms

Each `runtime.LockOSThread` goroutine occupies an M for its full lifetime. If you have 100 pinned goroutines, you need 100 Ms. The runtime creates them as needed, but more Ms means more scheduler overhead and more kernel state.

**Fix.** Avoid `LockOSThread` unless you need it (CGO with thread-affine state, namespace operations). When you need it, use a small fixed pool of pinned goroutines, not "one per request."

### Pitfall: misconfigured `GOMAXPROCS` in containers

Pre-Go 1.16, the runtime did not read cgroup CPU quotas. A container limited to 500m CPU on a 64-core node had `GOMAXPROCS=64`. The scheduler created 64 Ps competing for half a CPU. Latency was terrible; throughput surprisingly stable.

**Fix.** Upgrade to Go 1.16+ on Linux (cgroup-aware) or use `go.uber.org/automaxprocs` to set `GOMAXPROCS` from the cgroup quota.

### Pitfall: huge `GOMAXPROCS` with tiny work

```go
runtime.GOMAXPROCS(128)
```

On a workload of mostly I/O-bound goroutines, this does nothing useful. The Ms are mostly idle. Set `GOMAXPROCS` to match the number of CPUs actually available; the runtime handles I/O parking efficiently.

---

## GC pressure from goroutine churn

Every goroutine allocates: its stack, its closure, anything it touches. High churn → high allocation rate → frequent GC. Frequent GC → high CPU overhead → less time doing useful work.

### Pitfall: spawn-per-request without amortisation

A handler that spawns 5 internal goroutines per request, at 10k RPS, creates 50k short-lived goroutines per second. Each is a small allocation, but at this rate it dominates GC time.

**Fix.** Pool the work into a small number of long-running goroutines. The "fan-out then join" pattern works fine for low-rate handlers; switch to a pipeline of long-lived workers when rates exceed ~1k spawns/s.

### Pitfall: large closures capturing the world

```go
go func() {
    log.Printf("user %s requested %s", req.User, req.Path)
    sendMetric(req)
}()
```

The closure captures `req` — the whole request struct including body, headers, cookies, decoded params. If `req` is large (e.g., 100 KB), each goroutine pins 100 KB of heap until it exits.

**Fix.** Capture only what you need.

```go
user, path := req.User, req.Path
go func() {
    log.Printf("user %s requested %s", user, path)
    sendMetric(...)
}()
```

### Pitfall: long-running goroutine builds a heap-pinning closure chain

A goroutine that receives a `func() error` from a channel runs each function. Each function may close over its own data. If the goroutine holds a stale value (e.g., a parameter from the previous iteration), the heap pin persists.

**Fix.** Explicitly `nil` references after use, or scope variables to the smallest block that needs them.

---

## M leaks via cgo and `LockOSThread`

Threads (Ms) are *not* garbage collected automatically. The runtime creates Ms as needed. It destroys them under specific conditions:

- A goroutine that called `runtime.LockOSThread` exits without `UnlockOSThread`: the M is destroyed.
- An M idle for a long time *may* be destroyed by `sysmon`.

But the runtime does *not* destroy Ms aggressively. A burst of `LockOSThread` + exit creates a burst of Ms that may all be destroyed sequentially, which costs kernel time.

### Pitfall: cgo + `LockOSThread` permanent pin

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    C.heavy_init()                      // thread-local init
    for j := range jobs {
        C.use_heavy(j)
    }
}()
```

This works correctly: the M is held for the goroutine's lifetime. The pitfall is *creating thousands* of such goroutines. Each holds one M. If the goroutines are long-lived, you have thousands of OS threads. The OS thread limit (`ulimit -u`) becomes the bottleneck.

**Fix.** Use a fixed pool of pinned goroutines. Send work through a channel.

### Pitfall: `LockOSThread` without `UnlockOSThread` destroys Ms

```go
func enterNamespace(fd int) {
    runtime.LockOSThread()
    syscall.Setns(fd, ...)
}                                       // exits without unlock
```

When this goroutine returns, the runtime destroys its M. Calling 1000 times destroys 1000 Ms (the OS may keep them in a TIME_WAIT-like state briefly).

Sometimes this is *intentional*: thread-local state from the syscall is poisoned, and the M cannot be reused safely. But often it is accidental, and the cost adds up.

### Pitfall: cgo callbacks into Go from arbitrary threads

A C library that calls back into Go from a thread the runtime did not create. The runtime has to attach the thread, which costs allocations and may pin an M. If the C library spawns many threads that each call back, you accumulate Ms.

**Fix.** Document the threading model of any cgo integration. Pin callbacks to known threads if possible.

---

## Network poller pitfalls

Go's network poller is built into the runtime. Goroutines waiting on `net.Conn.Read` are parked on the poller; their Ms are freed to run other goroutines. This is why "one goroutine per connection" scales.

### Pitfall: blocking syscalls outside the network poller

`os.File.Read` on a regular file is *not* polled (most filesystems are not pollable). The goroutine blocks the M for the duration of the syscall. Under heavy disk I/O, all Ms can be parked in the kernel waiting for reads; the runtime creates more Ms; thread count balloons.

**Fix.** For high disk-I/O workloads, use a fixed worker pool. Limit concurrent file operations.

### Pitfall: too few file descriptors

A leak of `net.Conn` (or any FD) hits the FD limit (`ulimit -n`). `accept` returns errors. Connections are refused. The leak is *invisible* in goroutine count if the FDs are held by goroutines that exited but did not close the FD.

**Fix.** Always `defer conn.Close()`. Monitor `proc/<pid>/fd` count.

### Pitfall: poller starvation under extreme socket count

Pre-Go 1.14, the network poller ran on a dedicated goroutine that could be starved by a CPU-bound goroutine on a low-`GOMAXPROCS` system. Async preemption fixed this.

---

## Memory-model subtleties

Go's memory model (formalised in <https://go.dev/ref/mem>) is the contract the runtime offers. Most pitfalls in this file are visible at the language level; some require memory-model reasoning.

### Pitfall: "I added a mutex, so the read is safe"

```go
mu.Lock()
mu.Unlock()
x := shared       // BUG: still racy if shared is written elsewhere without the same mutex
```

A `Lock`/`Unlock` pair establishes a *happens-before* relationship with other `Lock`/`Unlock` operations on the *same mutex*. If the writer uses a different mutex (or no mutex), the read is not synchronised with that write.

**Fix.** The same mutex must protect every access — read or write — to a given variable.

### Pitfall: "atomic.Load makes everything visible"

```go
atomic.StoreInt32(&ready, 1)
data = computeData()    // BUG: not synchronised with reader's atomic.Load
```

`atomic` operations establish happens-before relationships *between atomic operations on the same variable*. A reader that does `atomic.LoadInt32(&ready)` sees writes that happened *before* the corresponding store — but the writer must do the store *after* setting `data`. Order matters.

```go
data = computeData()
atomic.StoreInt32(&ready, 1)        // store last
```

```go
if atomic.LoadInt32(&ready) == 1 {  // load first
    use(data)
}
```

### Pitfall: relying on `chan` close ordering

```go
go func() {
    work()
    close(done)
}()
<-done
useResult()
```

This is *correct*. `close` happens-before the receive observes the close. `useResult` sees all writes that `work` made.

But:

```go
go func() {
    result = compute()
    close(done)
}()
<-done
useResult()                         // OK: result written before close
```

This is also correct *because* of the channel's happens-before. The pitfall is when developers use other "looks-like-it-syncs" primitives:

```go
go func() {
    result = compute()
    flag.Store(true)
}()
for !flag.Load() {}                 // OK: atomic load syncs with store
useResult()
```

But:

```go
go func() {
    result = compute()
    runtime.Gosched()               // BUG: Gosched does NOT establish hb
}()
runtime.Gosched()
useResult()                         // unsynchronised
```

`runtime.Gosched()` is a scheduler hint, not a memory barrier.

---

## Stack growth and oversize closures

Each goroutine starts with ~2 KB stack. The runtime grows the stack as needed by allocating a bigger stack and copying. Growth is cheap but not free.

### Pitfall: a recursive function with huge per-frame state

```go
func process(node *Node) {
    var buf [1024]byte              // 1KB on the stack per frame
    ...
    process(node.left)
    process(node.right)
}
```

Deep recursion plus large stack frames triggers many stack growths. Each growth allocates a new stack (doubling each time) and copies all live pointers. On hot paths, this adds up.

**Fix.** Move large per-frame allocations to the heap or to a reusable pool. Or convert recursion to iteration.

### Pitfall: closure captures large arrays

```go
func loop() {
    var huge [1_000_000]int
    go func() {
        sum(huge[:])                // captures huge by reference
    }()
}
```

The closure captures `huge` (escape analysis hoists it to the heap). The goroutine pins the 8 MB array until exit. Multiply by N goroutines.

**Fix.** Pass a slice explicitly, share via sync, or rethink the algorithm.

---

## Diagnosing in production

When a goroutine pitfall reaches production, the diagnostic kit:

### 1. pprof goroutine dump

```bash
curl -o gor.txt 'http://prod:6060/debug/pprof/goroutine?debug=2'
```

Read it. Group by stack trace. The largest group is usually the leak. Common signatures:

- Many goroutines stuck on `chan receive` → unclosed channel.
- Many on `chan send` → unread buffered channel or no receiver.
- Many on `IO wait` → slow downstream.
- Many on `select` → cancellation not propagating.

### 2. `GODEBUG` for runtime visibility

```
GODEBUG=schedtrace=1000,scheddetail=1
```

Prints scheduler state every second. Look for `runqueue`, `idle Ms`, and Ps in `idle` vs. `running`.

```
GODEBUG=gctrace=1
```

GC events. Look at pause times and frequency. Spikes correlate with allocation bursts.

### 3. Tracing

```go
import "runtime/trace"

func main() {
    f, _ := os.Create("trace.out")
    trace.Start(f)
    defer trace.Stop()
    // ... reproduce ...
}
```

`go tool trace trace.out` opens the UI. Per-goroutine timelines reveal starvation, blocking, and unexpected stalls.

### 4. Race detector in canaries

Race detector is too expensive for full production (~10x memory). But running a small canary fleet with `-race` catches races at production traffic patterns that local tests miss.

### 5. eBPF for kernel-level views

Tools like `bcc`, `bpftrace`, and `perf` show kernel-level data:

- Per-thread CPU.
- syscall latency.
- mutex contention.

When goroutines stall in syscalls or `pthread_mutex`, only kernel tools see it.

### 6. Continuous profiling

Tools like Pyroscope, Parca, or Datadog Continuous Profiler sample pprof continuously. A leak that takes 3 days to manifest shows up as a slow-growing line in the goroutine-count chart.

---

## Summary

At the professional level, goroutine pitfalls are inseparable from the runtime. A captured loop variable becomes a 200 GB GC pressure problem at 10k RPS. A `LockOSThread` without unlock becomes a thread-count alarm at scale. A missing `cancel` becomes a context-tree memory leak that pages on-call. A blocking syscall becomes M creation pressure that the OS notices before you do.

The senior-level toolkit (ownership, contracts, supervisors) prevents most of these. The professional-level toolkit (pprof, trace, GODEBUG, eBPF) catches what slipped past. Together they form the loop: design out the pitfall; instrument so you catch what you missed; debug what reaches production with runtime-level tools.

The next file — `specification.md` — anchors all of this in the Go specification: which pitfalls the language guarantees against, which it permits, and where the gap between "spec-compliant" and "production-safe" lies.
