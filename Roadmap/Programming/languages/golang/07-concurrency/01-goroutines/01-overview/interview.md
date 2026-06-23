# Goroutines — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a goroutine?

**Model answer.** A goroutine is a lightweight unit of independent execution managed by the Go runtime. You start one by writing `go` before a function call. Goroutines start with a small stack (~2 KB) and are multiplexed onto a small pool of OS threads by the Go scheduler.

**Common wrong answers.**
- "It's a thread." (No — it is a unit of work scheduled onto threads.)
- "It's an OS-level concept." (No — the OS does not know about goroutines.)
- "It runs in parallel automatically." (Concurrency is not parallelism. Parallelism depends on `GOMAXPROCS` and core count.)

**Follow-up.** *How is it different from an OS thread?* — Goroutines are user-space, much smaller (~2 KB vs ~1 MB), and switched by the Go runtime in nanoseconds, while threads are kernel-managed and require microseconds to switch.

---

### Q2. What does this print?

```go
package main
import "fmt"
func main() {
    go fmt.Println("hello")
}
```

**Model answer.** Most likely prints nothing. The main goroutine returns before the spawned goroutine has a chance to run, and the program exits. The spawned goroutine is abandoned.

**Follow-up.** *How do you fix it?* — Use `sync.WaitGroup`:

```go
var wg sync.WaitGroup
wg.Add(1)
go func() { defer wg.Done(); fmt.Println("hello") }()
wg.Wait()
```

---

### Q3. What is wrong with this loop?

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()
}
time.Sleep(time.Second)
```

**Model answer.** Pre-Go 1.22: the closure captures `i` by reference. By the time the goroutines run, `i == 5`, so it prints `5 5 5 5 5`. Go 1.22+: each iteration creates a fresh `i`, so output is some permutation of `0..4`.

**Fix that works in every version:**

```go
for i := 0; i < 5; i++ {
    go func(i int) { fmt.Println(i) }(i)
}
```

**Follow-up.** *Why was this changed in 1.22?* — The captured-variable bug was the most-reported Go gotcha. The cost (a tiny extra allocation per loop iteration in the rare cases it matters) was considered worth the safety win.

---

### Q4. What is `sync.WaitGroup` used for?

**Model answer.** It is a counter that lets one goroutine wait for N others to finish. You call `Add(N)` to set the counter, each goroutine calls `Done()` to decrement, and the waiting goroutine calls `Wait()` to block until the counter reaches 0.

**Common bug.** Calling `Add` *inside* the goroutine instead of before it:

```go
go func() {
    wg.Add(1)            // BUG: race with Wait
    defer wg.Done()
    work()
}()
wg.Wait()
```

`Wait` may run before `Add`, miss the goroutine, and return early. Always `Add` in the parent before `go`.

**Follow-up.** *What if you forget `Done`?* — `Wait` blocks forever. Use `defer wg.Done()` at the top of the goroutine to make it exception-safe.

---

### Q5. What happens if a goroutine panics?

**Model answer.** If the panic is not recovered inside that goroutine, the entire program terminates. A `recover` in goroutine A does not catch a panic in goroutine B. Always wrap risky goroutine bodies with `defer func() { recover() }()`.

**Common wrong answer.** "Just that goroutine dies." (No, the whole program dies.)

**Follow-up.** *Why this design?* — The Go authors decided that an uncaught panic indicates a programmer error that may have left state corrupted. Crashing the process is safer than continuing with possibly-broken invariants.

---

## Middle

### Q6. How do goroutines communicate with each other?

**Model answer.** Two main mechanisms: **channels** (preferred for transferring data and ownership) and **shared memory protected by `sync.Mutex` / `atomic`** (for shared state). The Go proverb "share memory by communicating" leans toward channels, but mutexes are appropriate for read/write-mostly shared state like in-memory caches.

**Follow-up.** *When do you use a Mutex over a channel?* — When the data sits in one structure that many goroutines read and update. A typical example: an in-memory map with a `sync.RWMutex`. Channels would force every read to round-trip through the owner goroutine, adding latency.

---

### Q7. What is a goroutine leak?

**Model answer.** A goroutine that is started but never exits. Common causes:

- Sending to an unbuffered channel that nobody reads.
- Receiving from a channel that nobody closes.
- Holding a mutex forever (deadlock without runtime detection).
- Looping with no exit condition.

The cost: each leaked goroutine holds ~2 KB of stack plus any closure captures (often more). At scale, leaks become memory exhaustion.

**Follow-up.** *How do you detect leaks?* — `runtime.NumGoroutine()` over time (rising trend), `pprof` goroutine dump (`/debug/pprof/goroutine?debug=2`), or `go.uber.org/goleak` in tests.

---

### Q8. Explain `context.Context` in the context of goroutines.

**Model answer.** `context.Context` is the standard way to propagate cancellation, deadlines, and request-scoped values across goroutines. Every long-running goroutine should accept a `ctx` and watch `ctx.Done()` in its `select` statements. When the parent cancels (via `cancel()`, deadline, or explicit `WithCancel`), `ctx.Done()` closes, and the goroutine should exit.

**Follow-up.** *Why is context.Context a parameter and not a goroutine-local?* — Go deliberately has no goroutine-local storage. Explicit `ctx` parameters make the cancellation tree visible in function signatures. It also keeps libraries pure — they do not need to know about a goroutine identity.

---

### Q9. Difference between `WaitGroup` and `errgroup.Group`.

**Model answer.**
- `sync.WaitGroup` is a counter; you wait for N goroutines to finish, with no error reporting.
- `errgroup.Group` adds error propagation and cancellation: the first non-nil error cancels the group's context, the rest exit early, and `Wait` returns that first error.

`errgroup` is the better default in modern Go. Use plain `WaitGroup` only when there are no errors to report.

**Follow-up.** *Can `errgroup` limit parallelism?* — Yes: `g.SetLimit(n)` since Go 1.20.

---

### Q10. What does this code do?

```go
ch := make(chan int)
go func() { ch <- 42 }()
val := <-ch
fmt.Println(val)
```

**Model answer.** Prints `42`. The goroutine sends `42` on the channel; the main goroutine blocks on receive until the send completes; the synchronisation via the channel guarantees memory visibility.

**Follow-up.** *What if the channel is buffered with capacity 1?* — Same output, but the send completes without waiting for the receive. The behaviour is observationally identical here, but with capacity 1 the goroutine is no longer blocked if the receiver is slow.

---

### Q11. Why is this dangerous?

```go
go func() {
    res, _ := http.Get(url)
    body, _ := io.ReadAll(res.Body)
    process(body)
}()
```

**Model answer.** Multiple problems:
1. No `context` — cannot cancel.
2. No `defer res.Body.Close()` — connection leak.
3. Errors are silently dropped (`_`) — failed `Get` causes nil-deref panic in `ReadAll`, which kills the program.
4. The goroutine has no clear exit; if `process` blocks, you leak.
5. `process` runs concurrently with whatever else is happening; if it touches shared state, race.

**Fix.** Pass a `ctx`, use `errgroup.Group`, handle errors, defer `Close`, recover panics at the boundary, document that `process` is goroutine-safe.

---

### Q12. What does `runtime.GOMAXPROCS` control?

**Model answer.** The maximum number of OS threads that can simultaneously execute goroutines. By default, it is `runtime.NumCPU()`. With `GOMAXPROCS=1`, only one goroutine runs at any instant (concurrency without parallelism). The runtime may use *more* OS threads — for example, threads stuck in syscalls — but only `GOMAXPROCS` of them actively run user code.

**Follow-up.** *In a container with a CPU limit, what should `GOMAXPROCS` be?* — Match the limit. Since Go 1.16, the runtime reads the cgroup quota; before that, use `go.uber.org/automaxprocs`.

---

## Senior

### Q13. Walk through what happens when you write `go f(x)`.

**Model answer.**

1. The caller evaluates `x` (and `f`).
2. `runtime.newproc` is called.
3. A `g` struct is allocated (or recycled from a free list).
4. A 2 KB stack is allocated (also possibly recycled).
5. The new G's saved register state (`g.sched`) is initialised so that, when scheduled, control jumps to a trampoline that calls `f(x)`.
6. The G is pushed onto the current P's local run queue.
7. If there are idle Ps and surplus work, the runtime calls `wakep` to wake an M.
8. The caller continues to the next statement immediately.
9. Some time later (microseconds typical), the scheduler picks up the new G.

The "create" cost is hundreds of nanoseconds — far cheaper than `pthread_create`.

---

### Q14. Explain the GMP model.

**Model answer.** Three abstractions:

- **G (Goroutine)** — a unit of work. Lightweight, ~2 KB stack.
- **M (Machine)** — an OS thread.
- **P (Processor)** — a logical scheduler context with a local run queue. Number of Ps = `GOMAXPROCS`.

To execute a G, the runtime must bind it to a P (which has the runqueue) and to an M (which has the OS thread). Most scheduling happens on P-local data, lock-free. When a P's local queue empties, the runtime steals from another P (work-stealing). When an M blocks in a syscall, its P is handed to another M so the runtime keeps scheduling.

**Follow-up.** *Why have Ps at all? Why not just M and G?* — Ps eliminate scheduler lock contention. With per-P local queues, most operations are lock-free.

---

### Q15. What is asynchronous preemption and why does it matter?

**Model answer.** Before Go 1.14, the scheduler could only preempt a goroutine at function-call boundaries (where the stack-growth check lived). A tight loop with no inner calls — `for { i++ }` — was uninterruptible. With `GOMAXPROCS=1`, such a loop would freeze the entire runtime, including GC.

Go 1.14 added asynchronous preemption: sysmon periodically sends a POSIX signal (`SIGURG` on Linux) to the M running a long-running goroutine. The signal handler arranges for the goroutine to resume in a state where the runtime can deschedule it. Now any goroutine is preemptable at any instruction (with some safe-point caveats).

**Why it matters.** GC no longer stalls behind tight loops; one CPU-bound goroutine cannot starve others; co-located workloads are more predictable.

---

### Q16. How would you design a worker pool that is safe under load?

**Model answer.** Key properties to engineer:

1. **Bounded buffering** in the input channel (avoid OOM under spike).
2. **Supervised workers** — recover panics, restart on crash.
3. **Backpressure mechanism** — `TrySubmit` returns `false` when full, so callers can drop / reject / 503.
4. **Explicit Stop** that closes a quit channel and waits via `WaitGroup` for workers to actually exit.
5. **Pool size matched to downstream limits** (DB connections, rate limits).
6. **Observability** — gauges for queue depth, worker panic count, processing latency.
7. **Cancellation propagation** — every worker takes `context.Context` and exits on cancel.

I would lean on `errgroup.SetLimit` for short-lived bounded parallelism, and a custom pool for long-lived consumer loops.

---

### Q17. What is structured concurrency, and how does Go support it?

**Model answer.** Structured concurrency: every goroutine spawned in a function exits before the function returns. The lifetime of concurrent work is bounded by syntactic blocks, just like regular function calls.

Go does not enforce it at the language level, but `errgroup.Group` is a strong pattern:

```go
g, ctx := errgroup.WithContext(parent)
g.Go(work1)
g.Go(work2)
return g.Wait()
```

When this function returns, both `work1` and `work2` have exited. No leaks possible.

The opposite — fire-and-forget — is the leading source of leaks. Adopting structured concurrency by convention prevents most of them.

---

### Q18. Two goroutines update a shared counter. How do you make it correct, and what are the trade-offs?

**Model answer.** Three options:

1. **`sync.Mutex`** — simplest, correct, ~10–30 ns per acquire/release.
2. **`sync/atomic.AddInt64`** — lock-free, ~1–3 ns per op, but only works for primitives.
3. **Channel-based actor** — one owner goroutine; updates sent via channel. Slowest (~50–200 ns) but composes well.

For a hot counter, atomics. For a value with multiple coupled fields, mutex. For "one writer, many subscribers," channels.

**Follow-up.** *What about `sync/atomic.Value`?* — It stores any `any` atomically. Useful for copy-on-write configuration: readers `Load`, writers `Store`. No allocation on read.

---

### Q19. How do you debug a goroutine leak in production?

**Model answer.** Steps:

1. Confirm the leak: graph `runtime.NumGoroutine()` over time.
2. Hit `/debug/pprof/goroutine?debug=2` on the suspect process. This dumps every goroutine's stack.
3. Group by stack — leaks usually show up as thousands of identical stacks.
4. Find the line where they are blocked. Common: a channel receive or send, a mutex acquire, or a `time.After` that never fires.
5. Trace upward: who allocated this channel? Who was supposed to close it?
6. Tag goroutines with `pprof.Labels` so you can group by tenant, request, or feature flag and isolate the source.
7. Add a `goleak`-based regression test once fixed.

---

### Q20. Why might `GOMAXPROCS` need to be set explicitly in a container?

**Model answer.** Go before 1.16 read `NumCPU` from `/sys/devices`, ignoring cgroup CPU quotas. A pod limited to 0.5 CPUs running on a 64-core node would set `GOMAXPROCS=64`, oversubscribing badly: many runnable Ps, but only 0.5 CPU's worth of throughput. The result was extreme scheduler latency, GC mark assist degradation, and burst-throttling by the kernel.

Go 1.16+ honours cgroup quotas on Linux, mostly fixing this. For older Go versions or non-Linux containers, use `go.uber.org/automaxprocs` to read the limit and call `runtime.GOMAXPROCS` accordingly.

---

## Staff

### Q21. Two goroutines communicate via an unbuffered channel. One sends, one receives. What is the happens-before guarantee?

**Model answer.** From the Go memory model: in a send-receive pair on an unbuffered channel, the send *happens-before* the corresponding receive *completes*. That means every memory write made by the sender before the send is visible to the receiver after the receive.

For a buffered channel of capacity C, the rule is: the kth send on the channel happens-before the (k+C)th receive completes. The sender does not synchronise with the receiver until the buffer has wrapped.

This is why channels are a synchronisation primitive: the language guarantees memory visibility on top of message passing.

---

### Q22. You have a service handling 50 000 requests per second. Profiling shows scheduler latency dominates. How do you investigate?

**Model answer.** Hypotheses to check, in order:

1. **Goroutine count too high** — `runtime.NumGoroutine` rising. Pool-bound work, fix bounds.
2. **GOMAXPROCS misconfigured** — too few Ps for the work. Check cgroup limits.
3. **GC pressure** — `GODEBUG=gctrace=1` shows tight GC cycles. Reduce allocations or raise `GOGC`.
4. **Lock contention** — `pprof mutex` profile. A hot mutex serialises everything.
5. **Cgo blocking Ps** — long syscalls or cgo calls force M creation; profile shows many Ms.
6. **Large global runqueue** — `GODEBUG=schedtrace=1000` shows it. Suggests bursts overflowing local queues.
7. **Spinning M storm** — too many Ms looking for work; `spinningthreads` high.

Tools: `runtime/trace` (most powerful for scheduler-induced latency), `pprof`, `schedtrace`. Fix the dominant cause first; re-measure.

---

### Q23. Explain what `runtime.LockOSThread` does and when you would use it.

**Model answer.** `LockOSThread` pins the calling goroutine to its current OS thread. Until `UnlockOSThread` is called the same number of times, no other goroutine runs on that thread.

Use cases:

- **OpenGL** — must call from the thread that owns the GL context.
- **Some `cgo`** — libraries with thread-local state (X11, certain crypto libs).
- **Signal handling** for specific threads.
- **OS-level scheduling priority** — `setpriority` and similar are per-thread.

Cost: that goroutine cannot move; it is effectively a thread, not a goroutine. Use sparingly — typically one or two `LockOSThread` goroutines per program.

---

### Q24. What do you put in a code review checklist for goroutine-related code?

**Model answer.** My checklist:

1. Every `go` statement has an articulable exit condition.
2. Every long-running goroutine takes `context.Context`.
3. `context.Context` is the *first* parameter, named `ctx`.
4. Loop variables are passed by parameter, not captured.
5. `defer` covers `wg.Done`, `cancel()`, `recover` if needed.
6. Channels have a documented "who closes" contract.
7. No `time.Sleep` for synchronisation outside tests.
8. Shared state is either guarded by a mutex or owned by a single goroutine.
9. The race detector passes (`go test -race`).
10. `goleak` passes (or `runtime.NumGoroutine` is asserted).
11. Panics in worker goroutines are recovered or supervised.
12. Pool sizes are justified by downstream limits, not gut feeling.

---

### Q25. A junior engineer asks "why don't we just use channels for everything?" What do you say?

**Model answer.** Channels are powerful but not free. Reasons to use a mutex over a channel:

- **Speed.** Mutex acquire is ~10 ns; channel send is ~50–200 ns due to scheduling and synchronisation overhead.
- **Cognitive model.** "Many readers, one writer" maps cleanly onto `RWMutex`. Expressing it as a channel-routed actor is more code, more goroutines, more potential leaks.
- **Backpressure semantics.** A channel is queue-shaped. If you do not want a queue (you want "block the writer until readers catch up"), an unbuffered channel works, but a `Cond` or `Mutex` may be clearer.
- **Performance-critical paths.** A counter, an LRU cache, an in-memory index — these are mutex territory.

Channels shine for *flow*: pipelines, fan-out/fan-in, request queues, cancellation. Mutexes shine for *state*. Most production code uses both.

The Go proverb "share memory by communicating" is a default, not a law. Apply judgement.

---

## Summary of follow-ups by level

| Level | Follow-up themes |
|---|---|
| Junior | "What does this print?", "Fix this loop bug," "What is `WaitGroup` for?" |
| Middle | "How do you cancel?", "How do you detect leaks?", "When mutex vs channel?" |
| Senior | "Walk through the runtime," "How do you size a pool?", "What is structured concurrency?" |
| Staff | "Memory model details," "Scheduler tuning," "When NOT to use channels," "LockOSThread use cases" |
