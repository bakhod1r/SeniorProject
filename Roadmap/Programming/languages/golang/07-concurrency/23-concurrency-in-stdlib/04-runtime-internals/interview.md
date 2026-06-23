---
layout: default
title: Runtime Internals — Interview
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/interview/
---

# Runtime Internals Used by Stdlib — Interview Questions

[← Back](../)

> 30+ practice questions, junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does `runtime.Gosched()` do?

**Model answer.** It yields the current goroutine voluntarily. The goroutine is moved to the back of the local run queue, and the scheduler picks another runnable goroutine on the same P. It does *not* block the goroutine; it stays runnable. Useful inside tight CPU loops on Go versions before 1.14 where the scheduler could not preempt without a function call.

**Common wrong answers.**
- "It blocks until I/O is ready." (No — that is `runtime.gopark` from the netpoll path.)
- "It pins the goroutine to the current OS thread." (No — that is `LockOSThread`.)

**Follow-up.** *Is `Gosched` still needed in Go 1.14+ with async preemption?* Rarely — async preemption (signal-based) handles tight loops. `Gosched` is still useful in cooperative spin paths and benchmarks.

---

### Q2. What does `runtime.LockOSThread()` do, and when do you need it?

**Model answer.** It pins the current goroutine to its current OS thread. Until you call `UnlockOSThread` an equal number of times (or the goroutine exits), the goroutine runs only on that thread, and the thread runs no other goroutines. You need it when the underlying C library has thread-local state (OpenGL contexts, `pthread_setspecific` data, GUI main loops on macOS, Linux signal masks, capabilities on Linux, `setuid`/`seteuid` per-thread state).

**Follow-up.** *Does `main` lock its OS thread?* Yes — historically the main goroutine was implicitly locked to the OS thread; check `runtime/proc.go` `main()`.

---

### Q3. What is `runtime.SetFinalizer`?

**Model answer.** It registers a function to be called by the GC when an object becomes unreachable. The finalizer runs on a dedicated goroutine, not the main goroutine that lost the reference, and not necessarily immediately. Common uses: warn about unclosed file descriptors (`os.File` registers a finalizer), release C resources, audit leaks.

**Common wrong answers.**
- "Like a destructor in C++." (No — the timing is non-deterministic.)
- "Runs before the program exits." (No — finalizers do not run at exit; you must call them yourself or rely on the GC.)

**Follow-up.** *What goroutine runs finalizers?* A single dedicated goroutine started by `runtime.createfing` (`runtime/mfinal.go`).

---

### Q4. What is the difference between `runtime.Goexit` and `return`?

**Model answer.** `Goexit` terminates the current goroutine after running all deferred functions. It is more aggressive than `return`: even if you called `Goexit` ten frames deep, *all* deferred functions in those frames run, then the goroutine ends. The main goroutine calling `Goexit` does *not* exit the program; instead the runtime panics with "no goroutines (main called runtime.Goexit) - deadlock!".

**Follow-up.** *Why does `testing.T.FailNow` call `Goexit`?* So that subtests using `t.Fatal` cleanly unwind their deferred cleanup without bringing down the whole test binary.

---

### Q5. What does `runtime.NumGoroutine()` return, and is it racy?

**Model answer.** It returns the number of currently existing goroutines. It is read with a single atomic load of `runtime.allglen` (or equivalent). The value is racy in the sense that goroutines may be created or exit between your call and your use of the value — but the read itself is safe.

---

### Q6. What is `runtime.GC()`?

**Model answer.** It forces a garbage collection cycle and waits for it to complete. Used for diagnostics, benchmarks, and test cleanup. It can briefly stop the world (STW) for stack scanning and mark termination, but most work happens concurrently.

**Follow-up.** *What flag controls automatic GC frequency?* `GOGC` (default 100 = collect when heap doubles). Set to `off` to disable, or use `GOMEMLIMIT` to cap total heap size since Go 1.19.

---

### Q7. Where does `time.Sleep` go in the runtime?

**Model answer.** `time.Sleep` calls `runtime.timeSleep`, which adds a timer to the current P's timer heap, then `gopark`s the goroutine. When the timer fires, `runtime.netpoll` and `sysmon` (or another P checking timers) call `goready` on the parked goroutine, putting it back on a run queue.

---

### Q8. What is the `runtime/race` package?

**Model answer.** A compile-time instrumentation that wraps every load and store with a call to ThreadSanitizer's runtime. Enabled with `go build -race` or `go test -race`. It detects data races at run time but only along paths your tests exercise, and adds ~5-10x memory and ~2-20x CPU overhead.

---

### Q9. Why must signal handlers be limited in what they call?

**Model answer.** A signal handler runs on whatever stack and goroutine context the signal interrupted. Allocating, locking, or scheduling could deadlock or corrupt state. Go's runtime installs its own signal handler (`runtime.sigtramp`) and translates signals into channel sends or `runtime.notewakeup`s on a dedicated goroutine.

---

### Q10. What is `sync/atomic`'s relation to `runtime/internal/atomic`?

**Model answer.** Public `sync/atomic` is a thin wrapper. Internal `runtime/internal/atomic` (now `internal/runtime/atomic` since Go 1.22) has the same operations but is callable from runtime code without import cycles, and is the actual implementation in platform-specific assembly.

---

## Middle

### Q11. Explain `gopark` and `goready` in one paragraph.

**Model answer.** `gopark(unlockf, lock, reason, traceEv, traceskip)` removes the current goroutine from the run queue and marks it `_Gwaiting`. The caller passes an `unlockf` callback that the scheduler invokes after the parking is committed but before another goroutine is scheduled — typically to release a runtime lock that protected the wait queue. `goready(gp, traceskip)` does the inverse: marks `gp` as `_Grunnable` and puts it on the local run queue (or global if full). Together they implement all blocking in Go — channels, mutexes, network I/O, timers, finalizer wait.

**Follow-up.** *What are the trace events emitted?* `traceEvGoBlock`, `traceEvGoBlockSync`, `traceEvGoBlockRecv`, etc. See `runtime/trace.go`.

---

### Q12. What is a `note`?

**Model answer.** A `note` is a one-shot binary semaphore used by the runtime, declared in `runtime/runtime2.go` as `type note struct { key uintptr }`. `notesleep(n)` blocks until `notewakeup(n)` is called. Once woken, the note must be `noteclear`-ed before it can be reused. On Linux it is implemented with futexes (`runtime/lock_futex.go`); on macOS with `semaphore_*` Mach calls (`runtime/lock_sema.go`). The mutex slow path uses notes when it must put the calling M (not G) to sleep.

---

### Q13. What is `semacquire` / `semrelease`?

**Model answer.** A goroutine-level semaphore implemented in `runtime/sema.go`. `sync.Mutex.Lock` calls `runtime_SemacquireMutex`, which is the public name for `semacquire1`. Waiters are stored in a treap (balanced BST) keyed by the address of the semaphore word, so multiple semaphores share one table. It is the primary blocking primitive for stdlib `sync` types.

**Follow-up.** *Why a treap instead of one queue per address?* Memory: there can be millions of `sync.Mutex` values, most uncontended; per-address queues would waste memory. The treap is keyed by address only when there is contention.

---

### Q14. What does `runtime.procPin()` do?

**Model answer.** It disables preemption of the current goroutine and returns the current P's id (an int). After `procPin`, the goroutine cannot be migrated to another P until `procUnpin`. `sync.Pool` uses it to safely index per-P shards without a lock. `runtime.procPin` is *not* exported under that name to general users; it is exposed via `sync.runtime_procPin` linkname.

**Follow-up.** *Why pin?* If preemption fired between `getg().m.p.ptr().id` and the array index, you could race with another goroutine on a different P that re-entered the same pool.

---

### Q15. How does `sync.Mutex` use the runtime?

**Model answer.** Fast path (uncontended) is a single `CAS` in `sync/mutex.go` — no runtime call. Slow path: after a short spin (`runtime_canSpin` + `runtime_doSpin`), the goroutine calls `runtime_SemacquireMutex`. The runtime parks it via `gopark` on a sudog queued in the sema treap. `Unlock` calls `runtime_Semrelease`, which dequeues the sudog and `goready`s the waiter.

---

### Q16. How does `sync.WaitGroup` use the runtime?

**Model answer.** Counter is an `atomic.Uint64`. `Wait` busy-checks the counter; if positive, it parks via `runtime_SemacquireWaitGroup`. `Done` (which is `Add(-1)`) decrements; if the counter reaches zero with waiters, it calls `runtime_Semrelease` for each waiter.

---

### Q17. What is `runtime.lock` (lowercase)?

**Model answer.** A runtime-internal spinlock-then-park primitive used to protect runtime data structures (e.g., the heap allocator's mcentral, scheduler queues, the semaphore treap). It is *not* a `sync.Mutex`; it does not depend on the goroutine scheduler being functional, so it is safe to call from low-level paths.

---

### Q18. Why can't `runtime.lock` be replaced by `sync.Mutex`?

**Model answer.** `sync.Mutex` itself relies on the runtime (`semacquire`, `gopark`, `goready`). If the scheduler tried to use `sync.Mutex` it would recurse infinitely or deadlock. `runtime.lock` is implemented directly with `notesleep`/`notewakeup` or futex calls, bypassing the goroutine layer.

---

### Q19. What goroutine runs finalizers?

**Model answer.** A single goroutine started by `runtime.createfing` (`runtime/mfinal.go`). It reads finalizers off the `finq` queue and runs them sequentially. If a finalizer blocks, *all subsequent finalizers* are blocked. This is why finalizers must be fast and non-blocking.

---

### Q20. Why is `SetFinalizer` with a method value dangerous?

**Model answer.** If you write `runtime.SetFinalizer(p, p.Close)`, the bound method value holds a pointer back to `p`, making `p` reachable from the finalizer table — so the GC will never collect it. The fix: `runtime.SetFinalizer(p, func(p *T) { p.Close() })` with a *function* taking `*T` (or use a closure that does not capture `p` outside the parameter).

---

## Senior

### Q21. How does stdlib `net` block a goroutine on a socket read?

**Model answer.** `net.Conn.Read` calls `internal/poll.FD.Read`, which calls the platform `syscall.Read` non-blocking. If `EAGAIN`/`EWOULDBLOCK`, it calls `runtime_pollWait`, which `gopark`s the goroutine and registers the fd with the netpoller (epoll on Linux, kqueue on BSD/macOS, IOCP on Windows). When the netpoller (called by `sysmon` or any P with idle time via `findrunnable`) sees the fd ready, it `goready`s the parked goroutine.

---

### Q22. Where does the per-P timer wheel live, and when was it added?

**Model answer.** Since Go 1.14, each P has its own timer heap in `p.timers` (`runtime/runtime2.go`). Before 1.14 there was a single global timer goroutine and global heap, which was a contention point. With per-P timers, each P checks its own heap in `findrunnable`, in `sysmon`, and at `schedule` time. The heap is a 4-ary min-heap keyed by deadline (`runtime/time.go`).

---

### Q23. What does the race detector add to every memory access?

**Model answer.** Compiler-inserted calls to `runtime/race`: `raceread`, `racewrite`, `racereadrange`, `racewriterange`. These call into the C runtime of ThreadSanitizer (`tsan_go.cpp`), which maintains a per-goroutine vector clock and shadow memory storing the last reader/writer of each 8-byte word. Sync events emit `raceacquire` (load-acquire on a sync address) and `racerelease` (store-release).

---

### Q24. What is `runtime.SetCPUProfileRate` and how does the profiler avoid locking on the hot path?

**Model answer.** It sets the SIGPROF rate. The kernel delivers SIGPROF periodically; the signal handler (`runtime.sigprof`) walks the stack and writes a sample to a lock-free ring buffer (`profileBuf` in `runtime/cpuprof.go`). A separate goroutine reads from the ring buffer and forwards to pprof. The lock-free buffer uses a head/tail design and atomic stores so signal-safety is preserved.

---

### Q25. How are `runtime/trace` events emitted without locks?

**Model answer.** Each P has its own trace buffer. Events written from goroutines running on that P go directly into the local buffer — no global lock. Full buffers are flushed by a dedicated reader goroutine. The format is documented in `runtime/trace.go` (and `internal/trace`); event types like `evGoBlock`, `evProcStart`, `evGoSched` are emitted at the same call sites that drive `gopark`/`goready`.

---

### Q26. What is the `sysmon` goroutine and what does it do that affects stdlib?

**Model answer.** A goroutine that runs without a P (`runtime/proc.go` `sysmon`). It periodically:
- Polls the netpoller (so blocked `net.Conn` waiters wake up even if all Ps are busy).
- Forces preemption of goroutines that have run > 10 ms (since Go 1.14, via async signal-based preemption).
- Triggers GC when needed.
- Runs forced timers.

Without it, a long-running CPU loop could starve the netpoller and `time.After` could fire late.

---

### Q27. What is `runtime.Pinner` (Go 1.21+)?

**Model answer.** A type that pins Go objects so their address is stable across GC cycles — required when you pass a Go pointer to C and the C code stores or returns it through another pointer. Unlike `cgo.Handle`, `Pinner` preserves the actual address; unlike `runtime.KeepAlive`, it survives across GC cycles for as long as the pinner is alive. Implementation in `runtime/mgcpinner.go`.

---

### Q28. Why does `runtime.Stack(buf, all=true)` stop the world?

**Model answer.** Walking all goroutine stacks requires that none of them are executing arbitrary code that mutates the stack while the walker reads it. The runtime acquires `stwMu` and calls `stopTheWorld("runtime.Stack")` before iterating `allgs`. This is why dumping all goroutines is expensive in production.

---

### Q29. What is the relationship between `runtime.LockOSThread` and signal masks?

**Model answer.** On Linux, signal masks are per-thread. `LockOSThread` lets you `pthread_sigmask` or `unix.Pselect` reliably because your goroutine stays on the thread whose mask you set. Without `LockOSThread`, the goroutine might migrate to a different M with a different signal mask between syscalls.

---

### Q30. How does the GC's STW interact with goroutines stuck in syscalls?

**Model answer.** Goroutines in `_Gsyscall` state do not need to be stopped for STW — the runtime knows their P is detached. Goroutines in `_Grunning` must reach a safepoint (function prologue or async-preempt signal) before STW can proceed. If a goroutine is in `_Gwaiting` (on a mutex or channel), it is already idle.

---

## Staff

### Q31. Design: how would you implement a per-goroutine cache that avoids `sync.Pool`'s eviction surprises?

**Model answer.** Use `runtime.LockOSThread` plus thread-local-style storage in a Go-managed slice indexed by `getg().goid` — but `goid` is not stable in all Go versions, so use `runtime.procPin` and key off P-id with a length-`GOMAXPROCS` slice. Trade-off: prevents migration, can starve other goroutines on that thread; only suitable for short-lived ops.

---

### Q32. Why does the stdlib not expose a "wait for any of N channels with timeout" without `select`?

**Model answer.** `select` is implemented in the runtime (`runtime/select.go`) using a custom protocol over sudogs. Exposing a public API would either require duplicating that logic or reifying every internal detail. Since `select` already supports all the cases, no public alternative is provided.

---

### Q33. How does the netpoller handle the "thundering herd" of waiters?

**Model answer.** Per-fd, only goroutines that are actually parked on read or write are tracked (`pollDesc.rg`, `pollDesc.wg`). Edge-triggered epoll means the runtime gets one notification per state transition; it wakes exactly one reader (or all, depending on the pollDesc state). For accept on a listening socket, multiple parked accepters share the wait; the netpoller wakes one.

---

### Q34. When does `runtime.Goexit` cause subtle bugs?

**Model answer.** Inside a goroutine that holds a `sync.Mutex` without `defer mu.Unlock()`. `Goexit` runs deferred calls, so a deferred unlock is safe, but a manual unlock at the end of the function will be skipped, leaving the mutex held forever. Same for `WaitGroup.Done` — you must defer it.

---

### Q35. Why is `runtime.MemStats` expensive to read?

**Model answer.** Reading consistent MemStats requires `stopTheWorld` (or `forEachP` since Go 1.18 for some fields). The runtime briefly halts mutators, snapshots per-P statistics into the global struct, then resumes. For lightweight observation, use the `runtime/metrics` package (Go 1.16+), which is designed for low overhead.

---

## Common Wrong Answers to Watch For

- "`runtime.Gosched` blocks the goroutine until a condition is met." (No — it just yields; the goroutine stays runnable.)
- "`LockOSThread` is needed for any cgo call." (No — only when the C library has thread-local state.)
- "`SetFinalizer` is like `defer`." (No — timing is non-deterministic and order is unpredictable.)
- "`runtime.NumGoroutine` returns the goroutines on the current P." (No — it returns the global total.)
- "`runtime.GC()` blocks all goroutines." (No — most GC work is concurrent; only STW phases pause.)
- "`runtime.Stack` is cheap because it just walks one stack." (No — with `all=true` it stops the world.)
- "Notes can be reused without `noteclear`." (No — they are one-shot.)
- "`procPin` is a public stable API." (No — it is accessed via `go:linkname` and may break across versions.)

## Cheat Sheet

| Primitive | Stdlib consumer | What it does |
|-----------|----------------|--------------|
| `Gosched` | benchmarks, busy-wait loops | Yields the current goroutine |
| `LockOSThread` | `runtime/cgo`, `os/signal`, `syscall` | Pins G to current M |
| `SetFinalizer` | `os.File`, `net.Conn`, `crypto/tls` | Schedules GC cleanup callback |
| `NumGoroutine` | `expvar`, `net/http/pprof` | Total live goroutines |
| `Goexit` | `testing.T.FailNow` | Terminate G after defers |
| `GC` | tests, benchmarks | Force a GC cycle |
| `Stack` | crash dumps, pprof | Dump goroutine stacks |
| `procPin` | `sync.Pool`, `sync.Map` | Disable preemption + return P id |
| `note*` | runtime mutex slow path | One-shot signal |
| `semacquire`/`semrelease` | `sync.Mutex`, `sync.WaitGroup`, `sync.Cond` | Goroutine semaphore |
| `gopark`/`goready` | channels, network, timers | Park / wake goroutine |
| `Pinner` (1.21+) | cgo with retained pointers | Pin memory across GC |
