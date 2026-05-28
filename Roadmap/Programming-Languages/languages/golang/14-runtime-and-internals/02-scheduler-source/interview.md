# Go Scheduler — Interview

## 1. How to use this file

Twenty-six questions on the Go scheduler in the order interviewers tend to ask them — junior to staff — followed by a "what NOT to say" pitfalls list and a five-minute prep checklist. Each question opens with `### Q:` and a one-line answer, then expands into the prose you'd actually deliver in the room. References point at real files in the Go runtime source — `src/runtime/proc.go`, `src/runtime/runtime2.go`, `src/runtime/preempt.go`, `src/runtime/sys_*.go` — because the scheduler interview reward is concrete knowledge of the implementation, not abstract handwaving. Read top to bottom on first pass; on revision skim the level you're weakest at. Type out the small code examples once; the muscle memory of "what does `go f()` lower to" is the difference between sounding fluent and sounding rehearsed.

The signal interviewers grade on: can you name G/M/P without hesitation, walk through `findRunnable`'s priority order, explain async preemption's safety constraints, and pick the right scheduler primitive (`Gosched`, `LockOSThread`, `GOMAXPROCS`) for a real problem without forcing one of them into a place it doesn't fit?

---

## 2. Junior

### Q: What does the Go scheduler do?

**A:** It multiplexes many goroutines onto a small pool of OS threads, deciding which goroutine each thread runs at any moment.

The scheduler's job is to keep CPU cores busy with runnable Go code while keeping idle goroutines off the threads they don't need. When you write `go f()`, you're not asking for an OS thread; you're asking for a *goroutine* — a small (2 KB initial stack) runtime object that the scheduler will eventually pair with a thread. The runtime maintains a pool of OS threads (sized roughly to `GOMAXPROCS`), and on each thread runs a tiny dispatch loop in `runtime.schedule` (`src/runtime/proc.go`) that picks the next runnable goroutine, executes it until it yields or blocks, then picks the next one. That loop, plus the data structures it consults, *is* the scheduler. Everything else — work stealing, sysmon, preemption — is mechanism that keeps the loop fed and fair.

---

### Q: What are G, M, and P?

**A:** G is a goroutine, M is an OS thread (machine), P is a logical processor that holds the resources needed to run Go code.

The triple is defined in `src/runtime/runtime2.go`. A **G** (`type g struct`) holds the goroutine's stack, program counter, scheduling status, and per-goroutine state. An **M** (`type m struct`) is a kernel thread the runtime owns; it has its own little stack (`g0`) for runtime work and a pointer to the G it's currently running. A **P** (`type p struct`) is the bridge: it owns a local runqueue of runnable Gs (`runq [256]guintptr`), an mcache for fast allocation, and a handful of other per-CPU resources. To execute Go code, an M must be *attached to* a P; the count of Ps is fixed by `GOMAXPROCS`, so at most that many Gs can be running concurrently. Ms come and go (the runtime can spin up more, e.g., for blocking syscalls), but Ps are stable. The mental model: G = work item, M = worker, P = workstation with tools. A worker (M) sits down at a workstation (P) to do a work item (G).

```go
// Stripped from src/runtime/runtime2.go:
type g struct {
    stack       stack    // [stack.lo, stack.hi)
    sched       gobuf    // saved PC, SP, BP
    atomicstatus atomic.Uint32 // _Grunnable, _Grunning, _Gwaiting, ...
    m           *m       // current M, or nil if not running
    // ... plus ~80 more fields
}
type m struct {
    g0       *g           // goroutine for system stack
    curg     *g           // current user G
    p        puintptr     // attached P, or 0
    nextp    puintptr     // hand-off slot
    spinning bool
    // ...
}
type p struct {
    id          int32
    status      uint32       // _Pidle, _Prunning, _Psyscall, ...
    runqhead    uint32
    runqtail    uint32
    runq        [256]guintptr
    runnext     guintptr     // single G "next up" slot
    mcache      *mcache
    // ...
}
```

Reading those three structs once gives you more intuition about the scheduler than any blog post — every concept in the rest of this document maps to a field.

---

### Q: What does `go f()` actually trigger?

**A:** It calls `runtime.newproc`, which allocates (or reuses) a G, pushes it onto the current P's local runqueue, and returns — `f` runs later, not now.

The compiler lowers `go f(x, y)` into a call to `runtime.newproc(fn, &args)` in `src/runtime/proc.go`. `newproc` does roughly: (1) grab a free G from the P's local cache (`gFree`) or allocate one if none is available; (2) copy the arguments onto the new G's stack; (3) set the G's PC to a stub that will eventually call `f`; (4) push the G onto `P.runnext` if that slot is empty (the LIFO "freshest" slot), otherwise onto the P's local runq (FIFO); (5) if the runtime thinks no M is currently looking for work, call `wakep` to wake or start a spinning M. Then it returns to the caller — `f` has not been run; it's been *scheduled*. This is why `go f(); fmt.Println("done")` may print "done" before `f` does anything. The whole sequence is roughly 100 ns on modern hardware, which is what makes goroutines cheap enough to spawn millions of.

```go
// What the compiler does to `go f(x, y)`:
runtime.newproc(unsafe.Sizeof(args), &funcval{fn: f}, x, y)
// Inside newproc (paraphrased from src/runtime/proc.go):
//   newg := gfget(_p_) // grab from local free list
//   if newg == nil { newg = malg(stackSize) }
//   memmove(args -> newg.sched.sp)
//   newg.sched.pc = funcPC(goexit) // returns to goexit when done
//   runqput(_p_, newg, true)       // true => use runnext slot
//   if atomic.Load(&sched.nmspinning) == 0 { wakep() }
```

The `runnext` slot deserves a beat: it's a single-G "freshest" slot per P, separate from the 256-slot ring. When `go f()` puts a G into `runnext`, the next dispatch picks that G *first*, before the ring. The idea is producer-consumer locality: if goroutine A spawns B and then yields, scheduling B next is cache-warm. Without `runnext`, B would land at the tail of the ring and could wait for many other Gs to run first.

---

### Q: What's `GOMAXPROCS`?

**A:** The maximum number of Ps — and therefore the maximum number of Gs that can run Go code simultaneously.

Set via the `GOMAXPROCS` env var or `runtime.GOMAXPROCS(n)`. Since Go 1.5 the default is `runtime.NumCPU()` (the number of logical CPUs the OS reports). Setting it lower than the CPU count caps parallelism — useful when you want to share a box with other processes. Setting it higher than the CPU count is almost always wrong: more Ps than cores means Ps sit idle while their Ms wait for CPU time. The common confusion: `GOMAXPROCS` is the count of Ps, not the count of Ms. The runtime can have many more Ms than Ps — blocking syscalls, cgo calls, and `LockOSThread` goroutines each pin an M, and the scheduler will spin up replacement Ms so the Ps stay busy. In a container, the right value is whatever Linux scheduling will actually give you; `uber-go/automaxprocs` reads cgroup CPU quotas and sets `GOMAXPROCS` accordingly — without it, Go on a 64-core host with a 2-CPU cgroup quota will spin up 64 Ps and thrash.

```go
import _ "go.uber.org/automaxprocs" // sets GOMAXPROCS from cgroup at init
```

Go 1.25 (proposal `runtime: automatic GOMAXPROCS from cgroup`) is moving this into the standard runtime — eventually you won't need the third-party import. But until then, on any container deployment, `automaxprocs` is the difference between "service runs fine" and "tail latencies are mysteriously bad and the scheduler thrashes between Ps".

---

### Q: What's `runtime.Gosched()`?

**A:** A cooperative yield — the current goroutine is put back on the global runqueue and the M picks something else to run.

`Gosched` (`src/runtime/proc.go`, see `goschedImpl`) is the "I'm not done but I'll let someone else go first" call. The current G's status flips from `_Grunning` to `_Grunnable`, it's placed on the global runq (not the local one — so it doesn't get re-picked immediately), and `schedule()` is called to find the next G. It's the cheapest possible yield: no syscall, no preemption signal, just a few struct writes and a function call.

```go
for i := 0; i < 1_000_000; i++ {
    doABit(i)
    if i%10_000 == 0 {
        runtime.Gosched() // give other goroutines a chance
    }
}
```

In modern Go (1.14+) you almost never need this — async preemption interrupts long-running goroutines at ~10 ms boundaries automatically. The use cases left are (a) inside `//go:nosplit` code that preemption can't touch, (b) tight loops that must yield faster than 10 ms for fairness, and (c) testing scheduler behaviour deterministically. Calling it inside ordinary application code is usually a smell — it suggests you're trying to fix a scheduling problem you should be solving with channels or a worker pool.

---

## 3. Middle

### Q: What's work-stealing?

**A:** When a P's local runqueue is empty, it steals half the runnable Gs from another P's local queue instead of going idle.

The scheduler in `src/runtime/proc.go` (`runqsteal`, `stealWork`) implements this. When `findRunnable` can't find work in the local runq, globq, or netpoll, the P picks a random victim P and tries to steal half of its local runq into its own. The "half" is important: stealing one G at a time means the victim is constantly being raided; stealing the whole queue means the next steal finds nothing. Half is the empirical sweet spot used by most modern work-stealing schedulers (Cilk, Tokio, Go). The randomization (`stealOrder`) avoids hot-spotting: if every P stole from P0 first, P0 would be slammed and most steals would fail. Work stealing is what lets Go scale to many cores without a central runqueue bottleneck — each P operates on its local queue at L1 cache speeds, and the global queue (and stealing) only kicks in when local work runs out.

Three subtleties worth knowing. (1) The stealing P also tries to steal the victim's `runnext` slot if its main runq is empty — but only after a small delay (a few microseconds) to avoid stealing a G that was just spawned and is about to run. (2) Steals are CAS-based on the victim's runq head/tail atomics — the owner P doesn't have to lock anything. Contention is per-P, not global. (3) The "random walk" tries up to `2*GOMAXPROCS` victims before giving up; some are tried twice deliberately, on the chance that the second visit succeeds because the victim just acquired new work.

---

### Q: Why both local runqs and a global runq?

**A:** Local runqs make the common case lock-free and cache-friendly; the global runq is the slow-path overflow and the place where "fair" scheduling decisions happen.

The local runq (`p.runq`) is a fixed-size 256-slot ring buffer that the owning P pushes and pops from without any locking (the work-stealing access from other Ps uses atomics on head/tail). It's where `newproc` puts freshly spawned Gs and where the scheduler pulls from on every dispatch — by far the hot path. The global runq (`sched.runq`) is a linked list protected by `sched.lock`. Three things go there: (a) overflow when a local runq is full (push half to global), (b) Gs woken from `Gosched()` so they don't immediately get re-picked, (c) Gs created when there's no P available. The scheduler reads the global runq every 61st iteration of the dispatch loop (look for `schedtick%61 == 0` in `findRunnable`), which prevents starvation: if some G has been stuck on the global queue while every P is happily chewing on local work, it will still get picked up within a bounded number of dispatches. The two-tier design is the same idea as a CPU cache hierarchy — fast local for hot data, slower shared for the long tail.

Why 61 specifically? It's a prime, so the global-runq check doesn't synchronize with any other periodic event in the runtime (GC trigger, sysmon poll). Prime intervals are a common scheduler trick to avoid resonance — if two periodic events have a common multiple, they'll fire together and cause cache contention spikes. Pick a prime, and the worst case is amortized.

---

### Q: What is `sysmon`?

**A:** A special background thread that runs without a P, monitoring the runtime for goroutines that need help — preemption candidates, blocked netpoll events, scheduler stalls.

`sysmon` (`src/runtime/proc.go`, function `sysmon`) is started during runtime init and runs forever in its own M. It doesn't hold a P, doesn't run Go code, and doesn't show up in `runtime.NumGoroutine()`. Its loop sleeps for a variable period (20 µs to 10 ms, adapting to recent activity) and then checks: (1) any goroutine running on a P for more than 10 ms? Send it a preemption signal. (2) Any netpoll events ready? Push the corresponding Gs onto a runq. (3) Any goroutine stuck in a syscall for too long? Hand its P off to another M so the P doesn't sit idle. (4) GC pacing — does the assist ratio need adjustment? Sysmon is the runtime's *liveness watchdog*: without it, a tight CPU-bound goroutine on every P could starve the whole program, blocked syscalls would freeze Ps, and the netpoller would never get drained. Notably, sysmon is not subject to `GOMAXPROCS` — it always runs.

The adaptive sleep is interesting: if recent activity is high (lots of preemptions, lots of netpoll wakes), sysmon sleeps short (20 µs); if the system is quiet, it sleeps up to 10 ms. The 10 ms ceiling is what defines the preemption interval — a goroutine can run for at most ~10 ms uninterrupted before sysmon notices and fires SIGURG. That number isn't tunable from Go code; it's hard-coded in `forcePreemptNS = 10 * 1000 * 1000`. The 10 ms figure is a balance: short enough that GC pauses don't get long, long enough that the per-G preemption overhead is negligible for normal workloads.

---

### Q: How does the scheduler know to wake another M?

**A:** When a P has runnable work but no M is actively looking for work, `wakep` is called to either resume a parked M or start a new one.

The flag is `sched.nmspinning` — the count of Ms currently "spinning" (executing `findRunnable` looking for work) plus Ms that are about to spin. When `newproc` (or a runqput, or a netpoll wake) puts a G on a runq, the runtime checks: if `nmspinning == 0` and there are idle Ps, call `wakep` (`src/runtime/proc.go`). `wakep` finds an idle M (via the global `sched.midle` list) or creates a new one with `newm`, and signals it to wake up and start hunting for work. The "spinning M" concept matters because of a tricky race: between "I just put a G on the runq" and "some other M might already be looking", you can't safely skip waking — you might be the only one. The `nmspinning` counter is the synchronization: a spinning M is committed to finding work or de-spinning *and* re-checking the runqs once more before parking. The protocol (see Dmitry Vyukov's design note linked from `proc.go`) is delicate; getting it wrong causes either lost wakeups (Gs sit on runqs while Ps idle) or thundering herd (every G wakes every M).

The actual wake mechanism on Linux is a futex (`pthread_cond_signal` under the hood for parked Ms) — the M is blocked in `futexsleep`, wakeup does `futexwakeup`, the kernel scheduler picks up the thread. The full cost of waking a parked M is ~5–10 µs of wall-clock latency including context-switch. The whole reason spinning Ms exist is to avoid that cost on every G wakeup; if a spinning M is already running `findRunnable`, the newly-runnable G is picked up almost instantly.

---

### Q: What happens on a syscall — does it block the whole thread?

**A:** Yes, the M blocks, but the P is handed off to another M so other goroutines keep running.

When a goroutine enters a blocking syscall (network read on a non-pollable fd, file IO, cgo call), the runtime calls `entersyscall` (`src/runtime/proc.go`). This (a) marks the G as `_Gsyscall`, (b) detaches the P from the M but leaves the M+G pair in kernel-space, and (c) records the P as available for handoff. Sysmon notices the orphaned P and, if it's been sitting more than ~20 µs, calls `handoffp` to attach a fresh M to it so the P's runqueue keeps draining. When the syscall returns, `exitsyscall` runs: the M tries to grab back its old P (fast path); if that fails (another M took it), the G is put on the global runq and the M parks itself in the idle pool. The clever bit: for *non-blocking* syscalls (netpoll-aware fds), the runtime doesn't do the M+P split at all — the goroutine is parked, the M continues running other goroutines on the same P, and the netpoller will wake the goroutine when the fd is ready. That's why Go services can handle 100k+ connections on a handful of threads.

```go
// Conceptually, every syscall is bracketed:
runtime.entersyscall()
n, err := syscall.Read(fd, buf) // M+G in kernel, P released
runtime.exitsyscall()
```

The 20 µs handoff threshold matters: short syscalls (most filesystem reads on a hot cache, most `getpid`-style trivial calls) finish before sysmon notices, the M reattaches its own P, and no extra Ms get spun up. Only *long* blocking calls cause M creation. This is why a service that does many fast syscalls doesn't bloat the M count, but one doing many slow `getaddrinfo` calls (cgo, no netpoll) can balloon Ms into the hundreds.

---

### Q: What's a "spinning" M?

**A:** An M that's actively looking for work — running `findRunnable` in a busy-wait loop — instead of parking when no work is immediately available.

The runtime keeps up to `GOMAXPROCS / 2` (roughly) Ms spinning at any time when there's a P available and the system isn't fully utilized. Spinning means: the M holds a P, runs `findRunnable`, and if it finds nothing (no local, no global, no netpoll, no stealable), it loops back and tries again — for a short while — before parking. The cost is real CPU burn; the benefit is responsiveness. Without spinning, every wakeup would require an OS thread context-switch (futex wake → wake the M → schedule it → resume), which on Linux is ~1–10 µs. With spinning, a freshly-runnable goroutine is picked up *immediately* — the spinning M sees it on the next `findRunnable` iteration. The trade-off is intentional: burn a few % of CPU on speculative spins to keep tail latency low for goroutine wakeups. Tunable knob? Not directly — the spinning count is managed by the runtime based on `sched.nmspinning` accounting. If you see high CPU on an otherwise-idle program, spinning Ms are often the culprit, and it's usually working as intended.

One pathology to watch for: in extremely-idle services (a sidecar that wakes once per minute), spinning Ms can drive measurable CPU usage on a battery-constrained host. There's no first-class "disable spinning" knob, but reducing `GOMAXPROCS` reduces the max spinning count proportionally. Most server workloads should leave this alone; mobile/embedded Go (e.g., gomobile) is where it sometimes matters.

---

### Q: Why does Go scale to millions of goroutines but Java can't easily scale to millions of threads?

**A:** Goroutines are runtime-managed user-space objects with tiny growable stacks (2 KB) and cooperative scheduling; OS threads are kernel objects with megabyte-sized stacks and preemptive scheduling.

Four concrete differences. (1) **Stack size**: a Java thread on Linux defaults to 1 MB of reserved VM (commit-on-touch but still address-space and TLB pressure). A Go goroutine starts at 2 KB and grows via `morestack` (`src/runtime/stack.go`); idle goroutines stay tiny. A million Java threads is a terabyte of virtual address space; a million goroutines is 2 GB and most of it isn't even touched. (2) **Creation cost**: an OS thread requires a `clone` syscall (~10 µs); a goroutine is a struct allocation (~100 ns). (3) **Context-switch cost**: a thread context-switch is a kernel transition with register save/restore and TLB effects (~1–5 µs). A goroutine switch is a `gogo` assembly stub that saves a few registers (~100–200 ns). (4) **Scheduling locus**: the OS scheduler doesn't know your application semantics — it'll happily preempt a thread mid-critical-section. The Go scheduler runs in-process and can coordinate with the runtime's GC, netpoller, and channel operations. JVM virtual threads (Project Loom, Java 21+) close most of this gap by giving Java its own user-space scheduler on top of carrier threads — confirmation that the goroutine model is the right one, not a Go quirk.

Quick numbers to memorize:

| Operation | OS thread | Goroutine |
|---|---|---|
| Creation | ~10 µs (clone) | ~100 ns (struct alloc) |
| Context switch | ~1–5 µs (kernel) | ~100–200 ns (gogo stub) |
| Initial stack | ~1 MB reserved | 2 KB growable |
| Max practical count | ~10k–100k | 1M+ |
| Scheduler awareness | None (general-purpose) | GC, netpoll, channels |

The 100x advantage on each axis multiplies. A typical Go service runs ~10k goroutines on ~8 OS threads; the equivalent in Java pre-Loom would be 10k OS threads, which the kernel scheduler would not handle gracefully.

---

## 4. Senior

### Q: Walk me through `findRunnable` in priority order.

**A:** Local runqueue → global runqueue (with starvation guard) → netpoll → work stealing → idle steal of timers/GC → park.

`findRunnable` (`src/runtime/proc.go`, ~400 lines) is the heart of the scheduler. The priority order, simplified:

1. **GC mark workers**: if GC is running and this P should help, return a fractional mark worker first.
2. **Schedtick fairness**: every 61st call, pull one G from the *global* runq first. Prevents starvation of globq-resident goroutines when locals are perpetually busy.
3. **Local runqueue**: `runqget(_p_)` — grabs from `runnext` (LIFO slot for the most recently spawned G, optimizes producer-consumer hand-off) or from the local FIFO ring. This is the hot path; most dispatches end here.
4. **Global runqueue**: if local is empty, take a chunk from global (capped to balance with local).
5. **Netpoll (non-blocking)**: check if any network-ready Gs are queued; if so, return one.
6. **Work stealing**: random walk over other Ps, attempt `runqsteal` (steal half their runq). Try up to 4 rounds.
7. **GC idle worker**: if GC could use help and no other work exists, take an idle-mode mark job.
8. **Final globq + netpoll check** with locks held — race-condition close-out before parking.
9. **Stop the M**: park into the idle pool, decrement `nmspinning`. The M will be woken when work appears.

The ordering encodes the scheduler's value system: cache locality first (local runq, recent G), then fairness (globq tick), then external events (netpoll), then load balancing (steal), then park. Every step's failure path falls into the next. The function reads like a state machine because it is one — and reading it once is the single best way to understand how the scheduler actually thinks. Open `proc.go`, search for `func findRunnable`, and trace through it.

Two details senior interviewers like hearing. (a) **The pre-park double-check**: just before parking, the M re-checks the runqs *with locks held* to close the race where a G was made runnable while the M was deciding to park. Without that check, you'd lose wakeups under load. (b) **`nmspinning` accounting**: when the M de-spins (transitions from spinning to running a G, or to parking), it decrements `nmspinning`. If after decrement the count hits zero *and* there's work somewhere, it must wake another M before parking. That dance is what prevents "all Ms parked while a G is runnable" — the worst possible scheduler bug.

---

### Q: What's preemption in Go pre-1.14 vs post-1.14?

**A:** Pre-1.14 was *cooperative* — a goroutine could only be preempted at function call boundaries (specifically, at the stack-growth check). Post-1.14 added *asynchronous* preemption using OS signals.

**Pre-1.14 (cooperative)**: the compiler inserts a check at the start of every function: "is this G's `stackguard0` set to a preempt sentinel?" If yes, jump into `runtime.morestack_noctxt`, which can route into the scheduler. Sysmon sets the sentinel on a G that's been running > 10 ms. Effect: a function that called other functions yielded politely; a tight loop with no function calls (`for { x++ }`) could run forever, blocking GC and starving every other goroutine on that P. This bit a *lot* of people — GC could stall for seconds because a single goroutine refused to hit a preempt point.

**Post-1.14 (asynchronous)**: the runtime sends a SIGURG signal to the target M (`src/runtime/preempt.go`, `runtime.preemptM`). The signal handler examines the interrupted goroutine's PC and, if it's at a *safe point* (no unprotected pointer-spills, no critical runtime sections), modifies the saved register state to redirect execution to `runtime.asyncPreempt`, which yields. The G is paused mid-instruction without its consent. The safety analysis is what made this hard: the compiler now emits "safe-point" tables (PCDATA/FUNCDATA) describing which instructions are safe to interrupt; the signal handler consults them. The benefit: that `for { x++ }` loop is now preemptable. GC pauses are bounded. Fairness is real.

```go
// Pre-1.14, this could pin the M forever:
for {
    x++
}
// Post-1.14, this gets interrupted every ~10ms by SIGURG.
```

The interview signal: knowing the date (1.14, March 2020), the mechanism (SIGURG), and the cost (signal-safe code paths, complicated safe-point analysis) shows you've read the proposal, not just the changelog. The original design proposal is "Proposal: Non-cooperative goroutine preemption" by Austin Clements (https://github.com/golang/proposal/blob/master/design/24543-non-cooperative-preemption.md) — worth reading once if you want to sound deeply prepared.

---

### Q: When does `runtime.LockOSThread` make sense in production?

**A:** When the goroutine *must* stay on a specific OS thread for the duration of some operation — typically because a thread-local resource is bound to that kernel thread.

`LockOSThread` (`src/runtime/proc.go`) pins the current G to its current M for the rest of the G's life (or until `UnlockOSThread`). The M can't be reassigned to another G; the G can't be migrated to another M. Use cases.

1. **Cgo with thread-locals**: any C library that uses `pthread_setspecific`, `errno`, OpenGL contexts (GL is famously per-thread), or similar TLS needs the goroutine to stay put. Without `LockOSThread`, a cgo call could enter on thread A, the goroutine could be paused and resumed on thread B, and the next cgo call would see a different TLS.
2. **Linux namespaces and `setns`**: namespace state on Linux is per-thread. The `runc` container runtime locks the OS thread before calling `setns` to switch namespaces, does its work, and exits — it never unlocks because the thread state is now permanently weird, so the runtime should kill the thread when the G exits.
3. **Signal masks**: if you've set a custom signal mask on a thread, you'd better stay on that thread.
4. **`main`**: the `main` goroutine is implicitly locked on most platforms because the runtime's signal handling relies on it being on the initial thread.

Cost: that M is no longer available to run other goroutines. If you have 10k goroutines all locked, you have 10k Ms — and 10k kernel threads — which trashes the cheap-goroutine premise. Use sparingly. If you use it, document *why* on the function, because the next reader won't guess.

```go
func setNamespaceAndDoWork(nsPath string) error {
    runtime.LockOSThread()
    // No defer Unlock — the thread's NS state is permanently changed.
    // When this goroutine exits, the runtime will terminate the M.
    if err := setns(nsPath); err != nil {
        return err
    }
    return doWorkInNamespace()
}
```

One trap: pairing `LockOSThread` with `defer UnlockOSThread()` is correct only if the thread state is *restorable*. For namespace switches, signal-mask changes, or anything where the thread is now "tainted", you must NOT unlock — let the runtime destroy the M when the G exits. The `runc` codebase has comments explicitly calling this out.

---

### Q: How would you debug "my goroutine isn't getting scheduled"?

**A:** First confirm it actually isn't (vs running and producing no output), then check P availability, blocking syscalls, GC stalls, and finally read the goroutine's state from a stack dump.

The diagnostic ladder:

1. **Confirm the symptom.** Add a log line at goroutine entry. Is it never logging, or is it running and the result you expected isn't appearing? Plenty of "scheduler bugs" turn out to be channel deadlocks or wrong-handler routing.
2. **Get a goroutine dump.** `SIGQUIT` to the process (or `pprof.Lookup("goroutine").WriteTo(os.Stdout, 2)`), look at the target G's state: `runnable` (waiting for a P), `select`/`chan receive`/`IO wait` (blocked on something specific), `running` (it *is* running — your problem is elsewhere). The state names map directly to scheduler internals.
3. **Check P utilization.** `GODEBUG=schedtrace=1000` prints scheduler stats per second: number of Ms, Ps, runqueue sizes, idle counts. If runqueues are full but idle Ps are zero, you're CPU-bound and waiting your turn — set `GOMAXPROCS` higher if cores are available.
4. **Check for syscall starvation.** If many goroutines are in `syscall` state and sysmon hasn't handed off Ps, you may be hitting cgo or blocking-IO contention. `GODEBUG=scheddetail=1` prints per-P and per-M detail including syscall-blocked counts.
5. **Look for STW pauses.** `GODEBUG=gctrace=1` shows GC pauses. A 100ms STW will look like "my goroutine didn't run for 100ms" if you weren't watching.
6. **Look for `LockOSThread` leaks.** Run `go tool pprof` on the goroutine profile; if you see many Gs locked to threads, your M pool is bloated and idle Ps can't get an M.

The escalation: if all of that comes up clean, instrument with `runtime/trace` (execution tracer) and visualize in `go tool trace`. The tracer shows every G's transitions in microsecond resolution — you'll see exactly where the missing dispatch is.

```
SCHED 1003ms: gomaxprocs=8 idleprocs=2 threads=15 spinningthreads=1 idlethreads=4 runqueue=12 [3 0 5 1 2 0 0 1]
```

Reading that line: 8 Ps, 2 idle, 15 Ms total (with 4 parked), global runq has 12 Gs waiting, per-P local runq depths in the bracket. If idleprocs is high while runqueue is non-zero, you have a wakeup bug or contention on `sched.lock`. If runqueue is zero but per-P depths are deep, you have load imbalance — work-stealing should be fixing this, so investigate why it isn't (maybe Gs are pinned via `LockOSThread`).

---

### Q: Why does `GOMAXPROCS=1` not eliminate races?

**A:** Because the Go memory model is about *happens-before* across goroutines, not about parallelism. Even with one P, the scheduler can interleave goroutines at any preemption point, and the compiler/CPU can still reorder memory operations within a single goroutine.

A common newbie belief: "if only one goroutine runs at a time, the writes can't race." Wrong on two counts.

(1) **Interleaving**: with one P, goroutines still interleave — they just don't run *simultaneously*. Goroutine A reads `x` (sees 0), gets preempted, goroutine B writes `x = 1`, A resumes and writes `x = A's_old_x + 1 = 1`. The increment is lost. The race detector flags this regardless of `GOMAXPROCS` because the *happens-before* graph has no ordering between A's operations and B's writes — it's a data race by definition.

(2) **Memory model**: the Go memory model (https://go.dev/ref/mem) guarantees that if there's no synchronization, the compiler and CPU may reorder reads/writes within a goroutine. `GOMAXPROCS=1` doesn't suppress reordering — only `sync` primitives, channels, and atomics do. A goroutine that writes `data` then `ready=true` without synchronization may have those two writes reordered such that another goroutine sees `ready==true` before `data` is initialized.

```go
// GOMAXPROCS=1 doesn't save you:
var x, y int
go func() { x = 1; y = 1 }()
// Another goroutine might see y==1 but x==0.
```

The fix is the same with one P as with many: use channels, mutexes, or atomics. `GOMAXPROCS=1` is a *latency-reduction* hack for some legacy workloads, not a concurrency-correctness primitive. The race detector knows this; trust it.

---

### Q: How does cgo interact with the scheduler?

**A:** Entering C marks the G as "in syscall" so the P can be handed off; returning from C reattaches a P (or parks the M if none available). Plus the cgo call itself crosses an ABI boundary that's significantly more expensive than a Go function call.

The mechanics, in order. (1) A cgo call (`C.foo()`) goes through a compiler-generated stub that calls `runtime.cgocall` (`src/runtime/cgocall.go`). (2) `cgocall` calls `entersyscall` — same path as a blocking syscall — so the P can be released to another M if the C call blocks. (3) The call switches from the G's stack to the M's `g0` system stack (C code expects a "normal" megabyte-sized stack; goroutine stacks are too small). (4) C code runs. (5) On return, `exitsyscall` reattaches a P (preferably the same one) or parks the M if no P is free, and switches back to the G stack.

Two consequences. **Cost**: each cgo call is ~100–200 ns of pure overhead on top of whatever C does. For tight loops, this dominates — calling `C.malloc` a million times is much slower than allocating in Go a million times, not because C is slow but because the boundary is fat. **Blocking C**: if the C code blocks (a slow `getaddrinfo`, a synchronous network call in a C library), it pins an M for the duration. Many concurrent blocking cgo calls = many Ms = thread bloat. If the C call does TLS work (errno, pthread_setspecific), you also need `LockOSThread` to ensure subsequent cgo calls see the same TLS state. The senior-level mental model: cgo is "a syscall plus a function call", priced accordingly.

There's also the *reverse* direction: C code calling back into Go (cgo callback). This is the expensive path — the C thread has to acquire a P (possibly creating an M for it via `needm` / `dropm`), switch to a G's stack, run the Go callback, and tear it back down. Each callback is ~1 µs of overhead. The reason: the C thread isn't an M to start with — the runtime has to *adopt* it temporarily. Workloads that hammer C→Go callbacks (some image decoders, some database drivers) can spend more time in the boundary than in the work itself.

---

### Q: What's the cost of `runtime.Gosched` — when is it justified?

**A:** A few hundred nanoseconds of scheduler work (push to global runq, find next G, switch). Justified when you're in a long-running CPU loop where async preemption isn't sufficient — almost always inside `//go:nosplit` runtime code or very latency-sensitive paths.

Specifically, `Gosched` costs: marking the G runnable, pushing it to the global runq, calling `mcall(gosched_m)` to switch to the M's `g0`, calling `schedule()` to find the next G, and `gogo` to it. On modern hardware that's 200–500 ns. Compare to a channel send/receive (~100 ns), a mutex lock/unlock (~20 ns uncontended), and an async preemption interrupt (~5 µs but happens out-of-band, so the running goroutine's wall-clock cost is only the resumed-state savings).

When is `Gosched` justified?

1. **`//go:nosplit` or `//go:nocheckptr` code** that async preemption can't touch — runtime code that needs to manually yield. Application code shouldn't see this.
2. **Latency-sensitive tight loops in 1.13 or older** (pre-async-preemption) — calling `Gosched()` every N iterations ensures fairness. Largely obsolete on modern Go.
3. **Test code that needs to deterministically force a context switch** — e.g., a test for "did goroutine B observe goroutine A's write?" might `Gosched` to give B a chance.
4. **Backpressure patterns where you explicitly want to deprioritize the current G** — uncommon, usually a sign you should use a queue depth limit instead.

What it's *not* for: speeding up other goroutines (the scheduler will do that). Yielding the CPU to "be nice" (async preemption handles fairness). Fixing perceived starvation (if you're seeing starvation, find the root cause — usually a missing channel buffer or wrong worker pool size).

A pattern worth recognizing: spinlocks. Some libraries spin on a flag with `runtime.Gosched()` inside the loop, hoping the writer will get a turn:

```go
for atomic.LoadInt32(&ready) == 0 {
    runtime.Gosched() // not a real fix
}
```

This is *worse* than just blocking on a channel. The yield doesn't guarantee the writer runs next; it just gives up the current slice. Under load, this pattern produces 10–100x higher latency than a proper `chan struct{}` or `sync.Cond`. Reach for `Gosched` only when the alternative is genuinely worse, not as a "make my busy-wait less rude" knob.

---

### Q: How does Go's scheduler compare to Tokio or Erlang BEAM?

**A:** All three are M:N user-space schedulers, but they differ in preemption model, isolation, and what counts as "blocking".

**Go scheduler**: M:N (goroutines onto OS threads via Ps), work-stealing, asynchronous preemption via SIGURG since 1.14, shared address space, goroutines communicate via channels (sync primitives optional). Strength: lightweight blocking IO via netpoller integration. Weakness: cgo is expensive; one bad goroutine can OOM the process.

**Tokio (Rust)**: M:N async tasks onto OS threads, work-stealing scheduler in `tokio::runtime`, *cooperative only* — there is no preemption equivalent. A task that fails to `.await` will hog its worker thread until it returns. The compiler enforces a `Send + 'static` discipline so tasks are safe to migrate. Strength: zero-cost abstractions, predictable latency for well-behaved tasks. Weakness: a single CPU-bound future blocks the worker; you must explicitly `spawn_blocking` or `yield_now().await`. The post-1.14 Go scheduler's async preemption is exactly what Tokio doesn't have.

**Erlang BEAM**: M:N processes onto schedulers (one per CPU core by default), preemptive at the *reduction* level (every process gets ~2000 "reductions" worth of work before being preempted), full process isolation (separate heaps, no shared memory — communicate by copying messages), per-process GC. Strength: failure isolation (crashed process doesn't affect others), uniform preemption (no `Gosched` needed), built-in distribution. Weakness: copy-on-send is expensive for large messages; no shared memory means some patterns Go does easily (shared cache, sync.Map) require process-based abstractions.

The conceptual hierarchy: BEAM is the strictest (isolated, preempted at fixed reduction counts), Go is in the middle (shared memory, async preemption), Tokio is the most permissive (shared memory, cooperative only). Each picks a point on the safety-vs-performance curve. The Go scheduler is, roughly, "Tokio plus async preemption plus channels plus netpoller integration" — and the latter three are why Go can write a high-concurrency network server without thinking about runtime architecture.

A useful summary table for the interview.

| Property | Go | Tokio | BEAM |
|---|---|---|---|
| Scheduling model | M:N with work-stealing | M:N with work-stealing | M:N with reduction counting |
| Preemption | Async (SIGURG) | Cooperative only | Preemptive at fixed reduction count |
| Stack | Growable 2 KB → 1 GB | Async state machine (no stack/task) | Per-process growable |
| Memory model | Shared memory + channels | Shared memory + channels | Isolated processes, message-copy |
| Failure isolation | Process-wide panic recovery | Same | Per-process supervisor trees |
| IO integration | Netpoller built into runtime | `tokio::net` on top of `mio`/`epoll` | Built-in async IO via ports |

---

## 5. Staff

### Q: Design a feature you'd add to the scheduler.

**A:** Goroutine-level priority, with bounded priority inversion handling.

Real concrete proposal: a third runq tier between local and global — a per-P *priority* runq that holds Gs marked high-priority, drained before the regular local runq. API: `runtime.SetPriority(g, high|normal|low)` (or, more conservatively, only `runtime.LockToHighPriority()` like `LockOSThread`). The use case: in a service handling both user requests (latency-sensitive) and background reconciliation (throughput-sensitive), today you either share workers (background steals CPU from foreground) or use separate processes (operational pain). Priority gives you "user requests preempt background work, background work runs in the gaps".

The hard problems — why this isn't in Go today. (1) **Priority inversion**: a low-priority goroutine holding a mutex that a high-priority goroutine needs causes the high-priority one to wait on the low-priority one. Mitigation: priority inheritance (the mutex temporarily promotes its holder). But Go mutexes aren't priority-aware, and retrofitting them touches every `sync` primitive. (2) **Starvation guarantees**: low-priority goroutines must still run *eventually*. Add a starvation-prevention sweep every N dispatches that forces a low-priority G to run regardless. (3) **Cross-P fairness**: stealing now needs priority awareness — a P with high-priority Gs in its priority queue shouldn't be stolen from preferentially. (4) **API minimalism**: Go's culture resists knobs; arguing for this requires demonstrating that the workloads can't be solved with existing primitives (channels, worker pools, separate processes).

The staff-level move in this kind of question isn't to invent the feature — it's to articulate the design constraints and why the existing scheduler doesn't have it. The answer above hits the canonical concerns (inversion, starvation, fairness, API conservatism). Note also: the Go team has explicitly rejected priority proposals multiple times on https://github.com/golang/go issues; citing that shows you've done your homework.

Alternative features worth proposing if the interviewer pushes back on priority: (a) **NUMA-aware steal victims** — bias the random steal walk toward Ps on the same socket. Modest win for ≥64-core machines, zero impact for the typical case. (b) **Per-G CPU budgets** for runaway-loop containment — fail a goroutine that uses more than its budget, similar to BEAM's reductions but without full preemption. (c) **Goroutine affinity hints** — `runtime.AffineToP(p)` for memory locality, useful in NUMA-heavy workloads. Each is small enough to be plausible and big enough to discuss; the discussion is what the interview rewards.

---

### Q: What's the relationship between the scheduler and the GC's STW?

**A:** STW (stop-the-world) is a scheduler-level operation: all Gs running mutator code must be paused before GC can do certain phases (mark setup, mark termination). The scheduler enforces this via preemption.

The interaction, phase by phase. (1) **STW start**: the runtime calls `stopTheWorld` (`src/runtime/proc.go`). This sets a global flag, then preempts every P. For each P, the scheduler either grabs it (if idle) or signals the running M to preempt at the next safe point (or asynchronously via SIGURG in 1.14+). Every G in `_Grunning` must transition to a safe state before STW is considered complete. (2) **Marker phase**: with the world stopped, root scanning happens. GC then transitions to *concurrent* mark, restarts the world, and the scheduler resumes normal operation while GC workers consume background CPU. (3) **STW finish (mark termination)**: another brief stop for mark termination. (4) **Sweep**: concurrent with mutators; no STW needed.

Why this couples to the scheduler so tightly: pausing a G safely requires knowing where its registers and stack are consistent — the GC needs to scan the stack for pointers, and a half-saved-state stack would give wrong answers. Pre-1.14, this is why GC pauses could be horrible: a tight CPU loop without preempt points meant STW couldn't start until that G hit a function call. Post-1.14, async preemption makes STW reliable: SIGURG can land anywhere safe, the G yields, GC proceeds. The 99th-percentile GC pause dropped from hundreds of ms to sub-ms in many workloads with this change — not because GC got faster, but because the scheduler got better at pausing.

The mental model: GC is the customer, scheduler is the staff that wrangles the goroutines into position. If the scheduler can't preempt, GC can't start. Async preemption was a GC win disguised as a scheduler change.

A second interaction: **assist credit**. During concurrent mark, the GC needs the mutator goroutines to "pay for" their allocations by helping with mark work (`gcAssistAlloc`). The scheduler doesn't directly drive this, but the assist mechanism shows up in `findRunnable` priority order — GC mark workers and fractional workers get scheduled ahead of normal Gs. This is why a service that suddenly allocates heavily can see all its handler goroutines stall: they're spending CPU on mark assists. Tuning `GOGC` (the GC pacing target) or pre-sizing slices and maps to reduce allocation often shows up as scheduler-related symptoms.

---

### Q: What are the failure modes of work-stealing at scale (e.g., 128 cores)?

**A:** Contention on shared state (sched.lock, mcache poisoning, atomic counter cache lines), false sharing, NUMA effects, and steal-failure storms.

Four concrete problems that emerge at high core counts.

1. **`sched.lock` contention**: the global runq, idle-M list, and idle-P list are all protected by `sched.lock`. At low core counts this is fine; at 128 cores, the moments where any P needs the global queue (every 61st dispatch, plus overflow, plus park/unpark) start to bottleneck on this single mutex. The runtime team has incrementally split this — separate locks for some sub-structures — but it remains a hot spot at extreme scale.

2. **Atomic counter cache-line bouncing**: `sched.nmspinning`, `sched.npidle`, GC's mark-work counters — these are global atomics updated by many Ps. On a 128-core machine, the cache line holding any of these ping-pongs between cores; the increment that should take 1 ns takes 100 ns under contention. Some have been padded to cache-line size; some haven't, because Go's runtime hasn't fully optimized for 128-core hosts (the assumption was 32–64 cores would be typical).

3. **NUMA**: a 128-core machine is usually 2 sockets with non-uniform memory access. Steal a G from a P on the other socket and your local cache misses are now cross-socket — 200 ns latency instead of 20 ns. The Go scheduler is NUMA-unaware; it picks steal victims randomly without considering socket locality. At scale this matters; in practice, most workloads don't notice because each goroutine's working set fits in L2 anyway.

4. **Steal-failure storms**: when many Ps run out of work simultaneously (e.g., right after a burst finishes), all of them start spinning and stealing from each other. Most steals fail because there's no work. The runtime sees high CPU (Ps are spinning) but accomplishes nothing useful — until the next work batch arrives, every P thrashes the others' atomics looking for nonexistent work.

What mitigates? (a) lower `GOMAXPROCS` to a sensible value — running 128 Ps on 128 cores assumes you actually have 128 cores of work; if not, scale down. (b) Avoid global state in the application: a global mutex stresses the scheduler indirectly because contended Gs end up on the global runq. (c) Profile with `go tool trace` and watch for "Ps idle while Gs ready" — that signals a contention bottleneck, not a workload problem. The honest answer in an interview: at 128 cores, the scheduler still works, but it's no longer the unambiguous strength it is at 8 cores. The runtime team is aware and incrementally improving (look at recent `runtime: ` commits in the Go repo).

A real-world anecdote that lands well: large Go services at companies running on 96+ vCPU machines (Cloudflare, Discord, etc.) have published profiles showing that beyond ~32 cores, performance scales sub-linearly per added core. The bottlenecks are usually either application-level contention or the scheduler's global structures. The standard remediation isn't "fix the scheduler" — it's "run two Go processes per machine pinned to separate NUMA sockets via taskset" — i.e., scale out at the process level instead of fighting the runtime's per-process limits.

---

### Q: When would you advocate for or against changing the scheduler's design?

**A:** Advocate when you have measurements showing a real workload's bottleneck is structural, and the change has a credible answer for inversion/starvation/safety; advocate against when the proposal is "let me tune my workload" disguised as runtime work.

The for case has shape: (1) a *named* workload pattern that the current design handles badly (e.g., "many bursty cgo calls on a 64-core box thrash M creation"), (2) reproducible benchmarks showing the bottleneck, (3) a design that names what it changes, what stays the same, and what edge cases now need new handling, (4) a willingness to maintain the new code path indefinitely (Go has very conservative deprecation; once it ships, it's forever).

The against case: (1) "I want priority because my workload feels wrong" — first prove existing primitives (worker pools, separate Go processes, taskset/cgroup CPU pinning, `GOMAXPROCS` tuning) genuinely don't solve it. (2) "We should switch to fully preemptive scheduling like BEAM" — the safety analysis for arbitrary preemption is enormous (every memory operation becomes a potential observation point, write barriers everywhere); the cost-benefit isn't there for Go's typical workloads. (3) "Let me expose a knob" — the Go culture is "no knobs by default"; every knob is a permanent API commitment that may interact badly with future scheduler changes. (4) Anything that breaks the goroutines-are-cheap invariant: making goroutines twice as expensive to spawn would invalidate huge amounts of Go code that assumes the inverse.

The staff insight: the scheduler is one of the most heavily-engineered components of the Go runtime, with subtle invariants that took years to get right. A proposal that doesn't reckon with what's already there will get a polite but firm rejection. The bar for change is justified-with-data, narrow in scope, and reversible.

Worth knowing what has shipped recently and what was rejected. **Shipped**: async preemption (1.14), `LockOSThread` semantics tightened around thread destruction (1.10), netpoll moved to edge-triggered epoll (1.5), G recycling via free lists (small G allocations are basically free). **Rejected/deferred**: explicit priority, cooperative-only mode flag, configurable preemption interval, scheduler events in the trace tooling beyond what's already there. The pattern: changes that improve correctness or reduce footguns ship; changes that add API surface or tunable behaviour have a much higher bar.

---

### Q: How is async preemption implemented and what are its safety constraints?

**A:** SIGURG signal sent to the target M; the signal handler examines the saved PC, consults compiler-generated safe-point tables, and either redirects to `asyncPreempt` or defers if the PC is in unsafe code.

The full pipeline (`src/runtime/preempt.go`, `src/runtime/signal_unix.go`).

1. **Trigger**: sysmon detects a G running > 10 ms on a P. It calls `preemptone(pp)` which sets `g.preempt = true` and `g.stackguard0 = stackPreempt` (cooperative trigger) *and* calls `preemptM(mp)` which sends SIGURG to the M.
2. **Signal arrives**: the runtime's signal handler (`sighandler`) catches SIGURG, recognizes it as a preemption signal, and examines the interrupted register state.
3. **Safe-point check**: the handler reads the saved PC and looks it up in PCDATA tables emitted by the compiler. These tables encode for each instruction: is this a safe point? Are there unprotected pointer-in-register hazards? Is this inside runtime code that must not be preempted (`//go:nosplit`, signal-handling code itself, mid-stack-growth)?
4. **Redirect or defer**: if safe, the handler rewrites the saved PC to point at `runtime.asyncPreempt`. When the signal returns, the CPU jumps to `asyncPreempt`, which saves the G's full state and calls `gopreempt_m`, which yields to the scheduler. If unsafe, the handler returns without modification; the next sysmon poll will try again.
5. **Resume**: the G is added to the runq normally; when scheduled again, `asyncPreempt` returns and execution continues from the originally interrupted PC.

The safety constraints are what made this hard:

- **`//go:nosplit` functions** must never be preempted because they assume their stack won't grow and they may be in the middle of a non-atomic-but-must-be-atomic operation (touching `g.stackguard0`, etc). Signal handler skips these.
- **Write barriers in progress**: GC write barriers update mark bits; mid-barrier preemption would leave the mark structure inconsistent. Compiler emits safe-point info that excludes mid-barrier instructions.
- **Stack frame consistency**: at function prologue/epilogue, register state isn't yet consistent with the frame; PCDATA marks these unsafe.
- **The signal-handler code itself** must be async-signal-safe — no mallocs, no locks, no operations that could deadlock if interrupted. The handler runs on the M's signal stack, not the G's stack, to avoid stack overflow.
- **Platform variance**: SIGURG is used on Linux/macOS because it's rarely used by applications; on Windows, async preemption uses `SuspendThread` + register modification — same idea, different mechanism.

The interview signal here is naming SIGURG specifically (people often get it wrong as SIGUSR1), explaining the safe-point table mechanism (not just "the signal handler decides"), and acknowledging that some code paths (`go:nosplit`) are still not preemptible. The fact that 1.14's async preemption took multiple Go releases to fully roll out — and is still being refined as of 1.22+ — is a hint at how delicate the safety analysis is.

```go
// The compiler emits PCDATA for every function that says,
// for each PC range, whether async preemption is safe.
// You can see this in objdump output:
//   PCDATA $0, $1   // _PCDATA_UnsafePoint = 1 means unsafe
//   ...
//   PCDATA $0, $-1  // safe again

//go:nosplit
func unpreemptibleHelper() {
    // No stack-growth check inserted.
    // Async preemption is suppressed for the duration of this call
    // because the signal handler treats nosplit code as unsafe.
}
```

If you write Go assembly or use `//go:nosplit`, you need to know that async preemption *won't* save you from a runaway loop in that code path. That's part of why those annotations are heavily reviewed — they're escape hatches from the runtime's safety net.

---

## 6. What NOT to say

These are the unforced errors that turn "this candidate read the docs" into "this candidate read the blog post and stopped". Avoid.

- **"M is just an OS thread."** Technically true, but treating M and OS thread as interchangeable misses the runtime's bookkeeping: each M has its own g0 (system stack), signal stack, TLS slot for `g`, a parked/spinning/running status, and a relationship to a P. Saying "M is the runtime's wrapper around an OS thread that holds the per-thread scheduler state" shows the layered understanding.

- **"Preemption is fully transparent — you never need to think about it."** Wrong twice. (a) `//go:nosplit` code is not preemptible, and the compiler will refuse to compile a `nosplit` function that exceeds the inlined stack budget — preemption interacts with stack growth. (b) cgo callbacks, signal handlers, and runtime internals have preemption disabled. If you're writing assembly, runtime internals, or low-level systems code, preemption is very much something you think about.

- **"`GOMAXPROCS` controls the number of threads."** No — it controls the number of *Ps*. The number of Ms can be much higher (one per blocking syscall, one per cgo call, one per locked goroutine, plus sysmon, plus the netpoller helper threads on some platforms). On a service doing 10k blocking cgo calls concurrently, you can have 10k+ Ms with `GOMAXPROCS=8`.

- **"Goroutines are threads, just lighter."** Wrong category. Goroutines are *user-space* objects scheduled by the Go runtime; threads are *kernel-space* objects scheduled by the OS. The runtime multiplexes Gs onto Ms. Saying "goroutines are like Java's virtual threads (Project Loom)" gets the analogy right.

- **"Channels are faster than mutexes."** Workload-dependent; usually false for the common case (uncontended mutex is ~20 ns, channel send is ~100 ns). The right answer is "channels are for ownership transfer and signaling; mutexes are for protecting shared state — pick by intent, not by speed".

- **"Work-stealing means random work goes to random Ps."** No — Gs are created on the current P (locality), and stealing only happens when a P runs out of local work. The "random" part is *which P to steal from*, not which P a G originally lands on.

- **"`runtime.Gosched()` solves starvation."** It might paper over a symptom; the root cause is almost always elsewhere (missing channel buffer, wrong worker count, an unbounded queue). Reaching for `Gosched` in application code is usually a hint to look harder.

- **"Async preemption means goroutines preempt each other."** Goroutines don't preempt each other — the *runtime* preempts a goroutine on behalf of sysmon's fairness logic. The preemption signal flows from sysmon → SIGURG → signal handler → scheduler, not from G to G.

- **"GC stops the world for a long time."** Misleading on modern Go. STW phases in 1.5+ are typically sub-millisecond; the rest of GC is concurrent. Saying "Go has a concurrent mark-sweep with brief stop-the-world phases at mark setup and mark termination" is correct.

- **"`LockOSThread` is for performance."** Almost never. It's for correctness when something thread-local must persist. Using it for performance (assuming pinning will help cache locality) usually backfires — you lose the scheduler's ability to load-balance.

---

- **"Goroutines have priority."** They don't. Every G is equal to the scheduler — no priorities, no nice-values, no per-G CPU caps. If you need priority, you build it yourself with separate worker pools or process boundaries.

- **"Channels are zero-cost."** They're not. A channel send is ~100 ns on the fast path, more under contention. Channels are *cheap enough* that you usually don't optimize them away, but in tight inner loops (a million sends per second), atomic counters or per-worker accumulators beat channels by an order of magnitude. The right answer is "channels for communication, atomics for counting".

- **"The scheduler is fully fair."** It's *bounded-unfair*: every G will eventually run (no starvation), but the order isn't FIFO and the latency between runnable and running can vary a lot under load. If you need bounded latency, measure it; don't assume the scheduler will give you what you didn't ask for.

---

## 7. Five-minute prep checklist

If you've got five minutes before the interview, run through this list and make sure you can say each line out loud confidently.

- **G/M/P**: G = goroutine (user-space coroutine with stack + state), M = OS thread the runtime owns, P = logical processor with local runq and mcache. Count: `GOMAXPROCS` Ps, dynamic number of Ms, up to millions of Gs.
- **`go f()` lowers to `runtime.newproc`** which allocates/reuses a G, copies args to its stack, pushes onto local runq (or `runnext` slot), maybe wakes an M.
- **Local runq** (256-slot ring, lock-free for owner) + **global runq** (linked list, `sched.lock`-protected) + **netpoller** (network-ready Gs).
- **`findRunnable` order**: local → globq-tick(61st) → local → globq → netpoll → steal from other Ps → idle steals → park.
- **Work stealing**: empty local runq → random victim P, steal half of theirs.
- **`sysmon`**: separate background M, no P, polls every 20µs–10ms, triggers preemption, drains netpoller, hands off Ps from blocked syscalls.
- **Async preemption (1.14+)**: SIGURG → signal handler → safe-point check → redirect to `runtime.asyncPreempt` → yield. Pre-1.14 was cooperative-only (function-prologue checks), so tight loops could starve GC.
- **Spinning M**: holds a P, loops in `findRunnable` instead of parking, keeps wakeup latency low at cost of CPU. Controlled by `sched.nmspinning`.
- **Syscall handling**: blocking syscall → `entersyscall` releases P, sysmon hands off P to another M; `exitsyscall` reattaches a P or parks the M.
- **Netpoll integration**: non-blocking IO uses the netpoller, doesn't pin an M, scales to 100k+ connections on a handful of Ms.
- **`GOMAXPROCS`**: count of Ps (parallelism cap), not threads. In containers, use `automaxprocs` or set explicitly to cgroup CPU quota.
- **`Gosched`**: cooperative yield, push current G to global runq, pick next. ~200-500 ns. Rarely needed in modern Go application code.
- **`LockOSThread`**: pin G to current M permanently. Use for cgo with TLS, OpenGL, Linux namespaces, signal masks. Cost: that M is no longer reusable.
- **STW + scheduler**: GC needs to pause all mutator Gs at safe points; async preemption is what makes STW reliably brief in 1.14+.
- **Compare to Tokio / BEAM**: Tokio = cooperative only (no preemption); BEAM = preemptive at reduction counts with full process isolation; Go = M:N + work-stealing + async preemption + shared memory.
- **Memory model + GOMAXPROCS=1**: races are about happens-before, not parallelism. One P doesn't suppress reordering or interleaving.
- **Race detector**: use it (`go test -race`, `go run -race`). Reports happens-before violations regardless of `GOMAXPROCS`.
- **Diagnostics**: `GODEBUG=schedtrace=1000` and `scheddetail=1` for live scheduler state; `runtime/trace` + `go tool trace` for visual timeline; `SIGQUIT` for full goroutine dump.
- **Key source files** to name: `src/runtime/proc.go` (scheduler core, `findRunnable`, `schedule`, `newproc`, `entersyscall`), `src/runtime/runtime2.go` (G/M/P struct definitions), `src/runtime/preempt.go` (async preemption), `src/runtime/netpoll*.go` (per-OS netpoller implementations), `src/runtime/sema.go` (semaphores for `sync` primitives).
- **Key proposal documents**: Dmitry Vyukov's original scheduler design note (referenced from `proc.go` comments), Austin Clements's non-cooperative preemption proposal (`golang/proposal/24543`).
- **Container gotcha**: `GOMAXPROCS` defaults to host CPU count, not cgroup quota. Use `uber-go/automaxprocs` or set explicitly until Go's runtime handles cgroups natively.

If you can deliver all of those without hesitation, you'll sound senior even on questions you haven't specifically prepared. The scheduler is small enough to fit in one head; the trick is knowing it from the source, not from a summary. The path to mastery: open `proc.go` in your editor, search for `func findRunnable`, and read top to bottom once. Then `func schedule`. Then `func newproc`. After those three functions, the rest of the scheduler will read like a familiar codebase, not a black box.
