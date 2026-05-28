# Scheduler Source — Specification

## 1. Intro

The Go scheduler has no language-level specification. The [Go Language Specification](https://go.dev/ref/spec) describes goroutines as "an independent concurrent thread of control, or goroutine, within the same address space" and defines the semantics of the `go` statement, but it says nothing about how those goroutines are mapped onto operating-system threads, how they are preempted, how their stacks grow, or how the run queues are organised. Those decisions live in the runtime, and the runtime's source code is the only authoritative description of them.

This is a deliberate stance. The Go authors have repeatedly stated — in design docs, in the [Go 1 compatibility promise](https://go.dev/doc/go1compat), and in release notes — that the scheduler is an implementation detail of the runtime, free to change between releases. The cooperative-preemption scheme of Go 1.0–1.13 was replaced by asynchronous signal-based preemption in Go 1.14; the work-stealing strategy was tuned several times; the netpoller integration was rewritten; the `GOMAXPROCS` default changed; and the scheduler became NUMA-aware in stages. None of these changes broke the language specification, because the specification never made any promises about how scheduling worked.

What does exist, alongside the source, is a small canon of seminal design documents that govern the scheduler's evolution. Dmitry Vyukov's 2012 "Scalable Go Scheduler Design Doc" describes the G/M/P model that has been the architectural backbone since Go 1.1. Austin Clements's 2017 design doc on non-cooperative goroutine preemption describes the signal-based preemption that landed in Go 1.14. The Go memory model (formalised in 2014 and revised in 2022) describes the happens-before guarantees that the scheduler and the synchronisation primitives must uphold. Together with the source files in the `runtime` package and a small set of `GODEBUG` knobs that let an operator observe the scheduler at runtime, these documents form the de facto specification.

This file is a map of that canon: where to find each document, what it commits the runtime to, which source files implement it, and which `GODEBUG` flags expose its behaviour. Treat it as the table of contents for serious scheduler study, not as a substitute for reading the source itself.

A note on terminology. Where this document says "scheduler" it usually means the **goroutine scheduler** — the code that decides which runnable goroutine an OS thread runs next. The Go runtime contains other schedulers (the GC pacer is itself a sort of scheduler over the GC's worker goroutines, the timer scheduler in `runtime/time.go` orders pending timers, the netpoller is a readiness scheduler over file descriptors), and they interact closely with the goroutine scheduler, but they are not its core. The seam between them lives in `findRunnable()` and `runqsteal()` in `runtime/proc.go`, which is where every other source of work feeds back into the goroutine queue.

---

## 2. Vyukov's 2012 design doc

The architectural foundation of the modern Go scheduler is Dmitry Vyukov's design doc:

- **Title:** Scalable Go Scheduler Design Doc
- **Author:** Dmitry Vyukov, Google
- **Date:** 2 May 2012
- **Canonical link:** [https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit](https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit)
- **Implementation:** Go 1.1 (May 2013) and refined through every subsequent release.

The document is twelve pages, written before Go 1.1 shipped, and it diagnoses the limitations of the original single-global-runqueue scheduler that Go 1.0 inherited from the early Plan-9–derived runtime. The old scheduler used one mutex-guarded run queue protecting all runnable goroutines; on a multi-core host it serialised every scheduling decision and capped throughput around four cores.

Vyukov proposed the **G/M/P model** that remains the runtime's core data layout:

| Abbreviation | Meaning |
|--------------|---------|
| **G** | Goroutine — a stack, instruction pointer, and the metadata for a unit of concurrent execution. |
| **M** | Machine — an OS thread; the actual kernel-scheduled entity that executes goroutine code. |
| **P** | Processor — a logical scheduling context that owns a local run queue and the machinery needed to run goroutines; an M must hold a P to execute Go code. |

The number of P values is fixed at `GOMAXPROCS`. The number of M values is bounded loosely (default cap ~10,000) and grows on demand when an M blocks in a syscall. Each P owns a **local run queue** of bounded size (256 entries); a **global run queue** holds the overflow. When a P's local queue is empty, the scheduler tries — in this exact order — to refill it from:

1. The local queue itself (already empty by hypothesis).
2. The global run queue (taking a small batch).
3. The network poller (`netpoll`) for I/O-ready goroutines.
4. **Work stealing** from a random victim P's local queue (taking half).

Work stealing is the central performance claim of the document. By stealing half of a victim's queue rather than one element, the algorithm amortises the lock cost of the steal across many subsequent local-queue pops. The local queues themselves use a lock-free single-producer/multi-consumer ring buffer (Chase–Lev deque variant) so that the owning P's pushes do not contend with stealers' pops.

The model has held up. Every Go release since 1.1 has used the same G/M/P decomposition; subsequent work has tuned the steal distribution, added NUMA hints, integrated the network poller more tightly, and changed the preemption mechanism — but the three-letter taxonomy is stable. The document is the single most important text for understanding why the runtime looks the way it does.

A short tour of the data structures the doc commits to, with file references for verification in the source:

| Element | Field/function | Location |
|---------|----------------|----------|
| **Global runqueue** | `schedt.runq` (a linked list of `g` pointers via `g.schedlink`) | `runtime/runtime2.go`, `runtime/proc.go:globrunqput`/`globrunqget` |
| **Local runqueue** | `p.runq [256]guintptr` plus `p.runqhead`/`p.runqtail` (atomic indices into a ring buffer) | `runtime/runtime2.go`, `runtime/proc.go:runqput`/`runqget` |
| **Runnext slot** | `p.runnext` — a single-slot "fast path" that holds the most-recently-created goroutine on a given P; gives newly-spawned children low-latency dispatch on the same P as the parent | `runtime/runtime2.go`, `runtime/proc.go:runqput` |
| **Stealing** | `runqsteal` takes half of the victim's ring | `runtime/proc.go:runqsteal` |
| **Idle Ps** | `schedt.pidle` linked list, with atomic count `npidle` | `runtime/proc.go:pidleput`/`pidleget` |
| **Idle Ms** | `schedt.midle` linked list, with atomic count `nmidle` | `runtime/proc.go:mput`/`mget` |
| **Spinning Ms** | Ms that are actively searching for work via stealing; counted separately from idle Ms to bound contention on the victim queues | `runtime/proc.go:findRunnable`, see comments on `nmspinning` |

The "spinning M" notion is a refinement on the original 2012 doc, added in Go 1.4–1.5. A spinning M is one that has no P-assigned work but is actively probing run queues; the runtime caps the number of spinning Ms at roughly `GOMAXPROCS / 2` so the global steal contention does not collapse throughput on highly-parallel hosts. The relevant variable is `sched.nmspinning`; the relevant policy is `wakep` in `runtime/proc.go`, which is called whenever new work appears.

A companion read is the Vyukov video [Go Scheduler: Implementing Language with Lightweight Concurrency](https://www.youtube.com/watch?v=-K11rY57K7k) (Hydra 2019), which is the same material updated to reflect the changes between 2012 and 2019, including async preemption and the GC integration.

The 2012 doc itself is worth re-reading after the source. On a first pass it reads as a high-level proposal; on a second pass, with `runtime/proc.go` in mind, the connections between the doc's three or four key claims and the field layouts in `runtime2.go` become precise. The doc, for instance, asserts that "we never block on the local run queue lock" — the corresponding code is the lock-free push/pop in `runqput` and `runqget`, with a single CAS protecting the head/tail indices. The doc asserts "stealing victims are chosen randomly" — the corresponding code is the `fastrandn(uint32(gomaxprocs))` call in `findRunnable`. The doc asserts "we never starve" — the corresponding code is the periodic poll of the global run queue (every 61 schedule ticks, the magic number `schedtick%61 == 0`) that prevents a P with a busy local queue from monopolising its own goroutines forever. These small concretenesses are the connective tissue between design doc and implementation, and they are why reading both is worth more than reading either alone.

What the 2012 doc does *not* cover: the netpoller integration (added later), the GC integration (added in stages with Go 1.5 concurrent GC), async preemption (Go 1.14), the timer scheduler refactor (Go 1.10, Go 1.14, Go 1.23), or the container-aware `GOMAXPROCS` (Go 1.25). Each of those is its own design document, and section 10 lists the proposals that introduced them. The 2012 doc remains correct about the architecture; the later docs describe additions, not replacements.

---

## 3. Cooperative preemption and Go 1.14

Until Go 1.14 (February 2020), the scheduler was **cooperative**: a goroutine was preempted only at safe points the compiler had inserted — function prologues, channel operations, syscall returns. A tight loop with no function calls (`for { i++ }`) could run forever without yielding, blocking the GC's stop-the-world phase indefinitely, starving other goroutines on the same P, and producing the notorious "Go program hangs forever" bug reports.

The fix landed via proposal:

- **Proposal:** [#24543 — Non-cooperative goroutine preemption](https://github.com/golang/go/issues/24543)
- **Design doc:** [Non-cooperative goroutine preemption](https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md) (Austin Clements, March 2018; revised through 2019)
- **Implementation:** Go 1.14 (February 2020)
- **Source:** `runtime/preempt.go`, `runtime/signal_unix.go`, `runtime/signal_*.go`

The mechanism, in summary:

1. The scheduler, the GC, or the stack scanner decides goroutine *G* should be preempted.
2. The runtime sends a signal (`SIGURG`, chosen because it is otherwise rare) to the M currently executing *G*.
3. The signal handler examines the M's saved register state. If the program counter is at a **safe point** (the compiler emits a side table listing which instructions are safe), the handler rewrites the saved PC to enter the preemption stub `asyncPreempt`. On return from the signal handler, the M jumps into the stub instead of resuming where it was.
4. `asyncPreempt` (in `runtime/preempt_*.s`) saves the full register state to the goroutine's stack and calls back into the scheduler's `gopreempt_m` path, which parks *G* on the local run queue and schedules another goroutine.

Safe points are constrained: the PC must be at an instruction the GC and stack scanner can fully describe — argument registers must match a known frame layout, no half-executed write barriers, no in-flight cgo call. The compiler's safe-point analysis was a major Go 1.14 contribution; the table it emits is consumed by `findfunc` and `pcdatavalue` in `runtime/symtab.go`.

The discipline is conservative. If the PC is not at a safe point, the signal handler does nothing and the runtime tries again on the next preemption attempt (typically 10 ms later). For pathological code that runs unbounded NEON or AVX loops, the wait can be longer; the runtime accepts the latency because async-preempting in an unsafe spot would corrupt the stack scan.

The change had measurable consequences:

- The "tight loop hangs the GC" bug is gone in Go 1.14+; programs that exhibited it now run correctly.
- Scheduler latency tails (p99 goroutine-to-CPU latency) dropped significantly under load.
- A new escape hatch — `GODEBUG=asyncpreemptoff=1` — exists for code that triggers signal-related bugs (notably some CGO use cases and CPU profilers).

Recommended reading order for the cooperative-to-async transition: the Vyukov 2012 doc first, then [Austin Clements's design doc](https://go.googlesource.com/proposal/+/master/design/24543-non-cooperative-preemption.md), then the [Go 1.14 release notes](https://go.dev/doc/go1.14#runtime), then the source files listed above. Skipping the design doc and jumping straight to the source is a known way to spend a weekend lost in `runtime/preempt.go`.

A useful supplementary reading is the older 2014 design doc [Goroutine preemption with safe-points](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit), which proposed an earlier cooperative-with-extra-safepoints approach that was eventually rejected in favour of the signal-based scheme. The rejection reasoning — that compiler-inserted polls would inflate code size, lengthen tight loops, and still miss runaway loops generated by tools like assembly templates — is the most concise explanation of why the async approach won.

A second observation worth surfacing: async preemption changed the latency distribution of the runtime, not the average. Programs that already cooperated (most well-written Go code) saw little difference in average throughput; programs that did not cooperate saw their p99 latencies drop from "unbounded" to "bounded by the preemption interval". The release notes for Go 1.14 are clear on this trade-off and worth re-reading after spending time in the source.

---

## 4. The Go memory model and the scheduler

The scheduler does not exist in a vacuum; it interacts with the Go memory model, which specifies the visibility guarantees one goroutine has into another's writes. The memory model is the contract every synchronisation primitive — `chan`, `sync.Mutex`, `sync.WaitGroup`, `sync/atomic` — must implement, and the scheduler's job is partly to make those guarantees hold across goroutine migrations between Ms.

- **Canonical document:** [The Go Memory Model](https://go.dev/ref/mem) (revised major edition, 2022)
- **Author of the 2022 revision:** Russ Cox
- **Older version:** the pre-2022 document; less precise about atomics and weak ordering.

The 2022 revision is the version to read. It states:

> The Go memory model specifies the conditions under which reads of a variable in one goroutine can be guaranteed to observe values produced by writes to the same variable in a different goroutine.

The key happens-before edges the scheduler must preserve:

- **Goroutine creation.** `go f()` happens-before the first instruction of `f`. Anything the spawning goroutine wrote before the `go` statement is visible to `f`.
- **Channel send/receive.** A send on a channel happens-before the corresponding receive completes. For an unbuffered channel, the receive happens-before the send completes. For a buffered channel, the *k*th receive happens-before the (*k*+*C*)th send completes (where *C* is the buffer capacity).
- **Mutex.** For any `sync.Mutex` or `sync.RWMutex`, `n < m` calls to `Unlock` happens-before the *m*th `Lock` returns.
- **`sync/atomic`.** Atomic operations are sequentially consistent with respect to each other (as of the 2022 revision; older versions were less explicit).
- **`sync.Once`.** The single execution of the function `f()` passed to `Do(f)` happens-before any return from `Do(f)`.

The scheduler upholds these guarantees by issuing the right memory barriers when a goroutine is parked, migrated between Ms, or resumed. The relevant primitive is the **semaphore** in `runtime/sema.go`, used by `sync.Mutex.Lock` when the mutex is contended; it parks the goroutine on a treap-organised wait queue and the corresponding `Unlock` wakes one waiter. The scheduler's `goready` and `goyield` paths include the barriers required for the happens-before edge to hold across the parking transition.

For deeper study, two complementary readings:

- Russ Cox, [Updating the Go Memory Model](https://research.swtch.com/gomm) — three-part blog series (2021) that walks through the 2022 revision in detail.
- The C++ memory model (cppreference's `std::memory_order` page) — useful contrast; Go chose sequential consistency for atomics where C++ exposes the full barrier vocabulary, which simplifies the Go programmer's life at a small performance cost.

The practical consequence for scheduler code: the runtime is free to reschedule a goroutine onto a different M between any two source statements, and a correctly-written program cannot observe that migration. The scheduler ensures that any memory operation made visible on the source M before parking is visible on the destination M before resuming. This is implemented via the OS-level synchronisation primitives in `lock_futex.go` and `lock_sema.go`, which include the full-fence semantics required by the model. Code that observes a stale value across a goroutine yield has either invoked undefined behaviour through a data race or has found a runtime bug; the race detector exists to surface the former case, and bug reports for the latter are taken seriously by the runtime team.

---

## 5. `runtime` package API related to scheduling

A small set of functions in [`runtime`](https://pkg.go.dev/runtime) directly observe or steer the scheduler. They are the only stable, exported surface; everything else is an implementation detail.

**`runtime.GOMAXPROCS(n int) int`.** Sets the number of OS threads that can execute Go code simultaneously — that is, the number of P values. Returns the previous value. Calling `GOMAXPROCS(0)` returns the current value without changing it. The default is the value reported by `runtime.NumCPU()`. Changes take effect immediately; existing Ms with surplus Ps are parked. The function is safe to call concurrently with other goroutines; the documented stable API since Go 1.0.

**`runtime.NumGoroutine() int`.** Returns the number of goroutines that currently exist. Includes runnable, running, blocked, and parked goroutines; excludes those that have exited and been reaped. Useful as a coarse smoke test in tests (`if runtime.NumGoroutine() > before { t.Fatal("leak") }`); for production observability prefer pprof's goroutine profile, which gives a per-stack histogram rather than a single number.

**`runtime.NumCPU() int`.** Returns the number of logical CPUs available to the calling process at the time the binary was started. On Linux this respects `taskset` and CPU affinity but does *not* respect cgroup quotas — a container with a CPU quota of 0.5 cores still sees the full host CPU count. This is the source of the `automaxprocs` library described in section 7.

**`runtime.Gosched()`.** Voluntary yield: the calling goroutine is parked at the back of the global run queue and another goroutine runs. Returns when the scheduler picks the caller again. Useful in tight loops that would otherwise monopolise a P; since Go 1.14's async preemption, far less necessary than it used to be. The runtime guarantees forward progress without it; calling `Gosched` is now a hint, not a correctness requirement.

**`runtime.Goexit()`.** Terminates the calling goroutine after running all deferred functions, including those higher up the call stack. Distinct from `return` in that it unwinds through every frame; distinct from `panic` in that it does not produce a stack trace and cannot be caught by `recover`. Used by `testing.T.FailNow` to abort a test from a helper without panicking. If called from the main goroutine, the program terminates after other goroutines finish.

**`runtime.LockOSThread()`.** Pins the calling goroutine to its current M. The goroutine will not migrate to another M; the M will not run any other goroutine until `UnlockOSThread` is called the same number of times. Required for code that depends on OS-thread-local state — OpenGL contexts, some `setuid`/`setgid` patterns, Windows COM apartments, locale state in C libraries. The runtime forks new Ms when locked goroutines block the available pool; overuse can balloon thread count.

**`runtime.UnlockOSThread()`.** Reverses one `LockOSThread`. The lock is recursive: *n* locks need *n* unlocks. Once fully unlocked, the goroutine becomes schedulable on any M again and the M returns to the pool.

**`runtime.GC()`.** Triggers a synchronous garbage collection. Not a scheduler function strictly, but the GC and the scheduler share the stop-the-world machinery, so `runtime.GC()` is the most direct way to force a scheduler-wide quiescent point. Used in tests that need a deterministic point at which finalisers have run; should not appear in production code.

**`runtime.SetFinalizer(obj, fn)`.** Registers a function to be called when the garbage collector identifies `obj` as unreachable. The finalizer runs on a dedicated goroutine, not the goroutine that called `SetFinalizer`; ordering between finalizers is unspecified. The interaction with the scheduler is that the finalizer goroutine is created and scheduled by the GC's sweeping phase, which means finalizer execution latency is bounded by GC cycle latency, not by the scheduler's normal latency budget.

**`runtime/debug.SetMaxThreads(n int) int`.** Sets the upper limit on the number of M values the runtime may create. Default is 10,000. Useful for processes that may otherwise leak threads through unbounded blocking syscalls; raising the limit when a legitimate workload exceeds it is documented as preferable to the runtime's own crash-on-limit behaviour. Returns the previous limit.

The package also exposes `runtime.Caller`, `runtime.Stack`, and the `runtime/pprof` and `runtime/trace` subpackages, all of which let you observe scheduling decisions after the fact. They are not direct scheduler controls and are documented separately.

A subtle gotcha: `runtime.NumCPU()` and `runtime.NumGoroutine()` are cheap (a single atomic read each); `runtime.Stack(buf, all)` with `all=true` is expensive (it stops the world to enumerate every goroutine's stack). Reach for the cheap calls freely in dev metrics; reserve `Stack(_, true)` for one-off diagnostics, never for a periodic exporter.

---

## 6. `GODEBUG` knobs for the scheduler

The `GODEBUG` environment variable is the runtime's documented observability surface. Each comma-separated `key=value` flag toggles or tunes a debug feature. The complete authoritative list is in [`runtime/extern.go`](https://github.com/golang/go/blob/master/src/runtime/extern.go) and the [runtime package documentation](https://pkg.go.dev/runtime#hdr-Environment_Variables).

| Flag | Description | Example output |
|------|-------------|----------------|
| `schedtrace=N` | Every *N* milliseconds, emit a one-line summary of scheduler state: `SCHED Nms: gomaxprocs=8 idleprocs=2 threads=12 spinningthreads=1 needspinning=0 idlethreads=4 runqueue=3 [0 1 0 2 0 0 1 0]`. The bracketed list is the per-P local-queue depth. Cheap, leave on in dev. | `SCHED 1004ms: gomaxprocs=8 idleprocs=2 threads=12 idlethreads=4 runqueue=0 [0 0 0 0 0 0 0 0]` |
| `scheddetail=1` | Combined with `schedtrace`, emits a multi-line dump per interval covering every M, every P, and (in some builds) every G. Much more expensive; one-pager per tick at scale. Use sparingly when investigating a specific scheduler stall. | Multi-line dump of `M0: p=0 curg=1 mallocing=0...`, `P0: status=1 schedtick=...`, `G1: status=4(...) m=0 lockedm=-1` etc. |
| `inittrace=1` | Logs initialisation order: `init pkg/foo @0.123 ms, 0.045 ms clock, 8192 bytes, 12 allocs`. Surfaces packages whose `init()` does slow work (DNS lookups, file I/O, registry queries) that delays binary startup. Output to stderr at process startup. | `init internal/cpu @0.05 ms, 0.04 ms clock, 1024 bytes, 12 allocs` |
| `asyncpreemptoff=1` | Disables async preemption (the Go 1.14 mechanism described in section 3). The scheduler reverts to cooperative behaviour. Workaround for code that interacts badly with `SIGURG` delivery — some CGO patterns, older versions of the Go race detector, code using OS signal handlers that fight with the runtime's. Performance and GC latency tend to regress; use only with a documented reason. | (no scheduler-specific output; see GC and preempt behaviour) |
| `gcstoptheworld=1` | Forces the GC to do a single stop-the-world collection rather than the concurrent collection that has been the default since Go 1.5. Useful for diagnosing GC-correctness bugs versus concurrent-marking bugs; never appropriate in production. `gcstoptheworld=2` also disables concurrent sweeping. | Affects GC tracing output (set `gctrace=1` to observe). |
| `gctrace=1` | Per-cycle GC report (not strictly a scheduler knob, but the scheduler and GC are tightly coupled): `gc N @t.tts: A%/B%/C% Dms: heap-summary`. Useful for understanding when scheduling latency is GC-induced versus scheduler-induced. | `gc 1 @0.123s 0%: 0.012+0.34+0.005 ms clock, 0.1+0/0.2/0.5+0 ms cpu, 4->4->2 MB, 5 MB goal, 8 P` |
| `tracebackancestors=N` | When a goroutine panics, include the stacks of up to *N* ancestor goroutines. Helps locate "where was this goroutine spawned" without an explicit stack-on-spawn library. Off by default; cost is bounded per spawn. | Adds `created by main.spawnWorker in goroutine 1` chains to panic output. |
| `panicnil=1` | Restore pre-Go-1.21 behaviour of allowing `panic(nil)` (rather than upgrading it to a runtime error). Pure compatibility; no scheduler relevance beyond preserving old test code. | `panic: ` (empty) on `panic(nil)` |

Multiple flags combine: `GODEBUG=schedtrace=1000,scheddetail=1,inittrace=1`. The runtime parses the value once at startup and again every time `GODEBUG` is mutated via `os.Setenv` — though most flags read the value only at startup.

Additional scheduler-adjacent `GODEBUG` flags worth knowing:

| Flag | Description |
|------|-------------|
| `madvdontneed=0/1` | Controls whether the runtime returns freed memory to the OS via `MADV_DONTNEED` (cheap, page-level) or `MADV_FREE` (cheaper but observable as higher RSS). Affects memory-pressure interactions with the scheduler under memory limits. |
| `cgocheck=0/1/2` | Runtime checking of CGO pointer rules. Higher values catch more bugs but cost more on every cgo crossing; relevant to scheduler latency because cgo crossings already park-and-resume a P. |
| `invalidptr=0/1` | Whether the runtime aborts on a detected invalid pointer. Cheap; leave on. |
| `tracebackshift=N` | How aggressively the runtime trims stack frames in panic traces; tuning aid for noisy traces from deep call stacks. |
| `dontfreezetheworld=1` | Disables the scheduler's freeze of all goroutines during fatal-error reporting; useful when investigating a crash whose stack walk itself crashes. |
| `runtimecontentionstacks=1` | Enables capturing of contention stacks for mutex/blocking profile reports; lets `runtime/pprof`'s mutex profile attribute contention to the contending goroutine's stack, not just the holding goroutine's. |

For long-form scheduler analysis, prefer the `runtime/trace` package and the [`go tool trace`](https://pkg.go.dev/cmd/trace) viewer over `schedtrace`. The trace captures every goroutine transition, every system-call boundary, and every GC event; `schedtrace` is a sampled summary by comparison.

A typical investigation cadence:

1. Reproduce the issue under a steady load.
2. Enable `GODEBUG=schedtrace=1000` and watch the run-queue depth and idle-P count over time. If `runqueue` grows unboundedly while `idleprocs > 0`, the scheduler is finding work but failing to dispatch it (rare); if `runqueue` stays small while `idlethreads > 0`, the bottleneck is elsewhere (often I/O or GC).
3. If `schedtrace` is not specific enough, switch to `runtime/trace`: collect 10–30 seconds of trace and load it into `go tool trace`. The "Goroutine analysis" view shows time spent in each state (running, runnable, syscall, GC) and is the fastest way to identify which scheduler interaction dominates the latency budget.
4. Cross-reference with `GODEBUG=gctrace=1` output to rule out GC pauses as the source of perceived scheduler latency.
5. Only after the trace narrows the suspect to a specific code path, read `runtime/proc.go` for the relevant function (`schedule`, `findRunnable`, `runqsteal`, `gopreempt_m`, etc.) and the design doc that motivates it.

Skipping straight to source reading without a trace in hand is a known way to produce confident but wrong conclusions about scheduler behaviour.

---

## 7. `GOMAXPROCS`

`GOMAXPROCS` is the single most consequential scheduler knob. Its semantics are:

- The value sets the number of P values, which is the maximum number of Go-code-executing OS threads at any instant.
- M values may exist in excess of `GOMAXPROCS` — an M that blocks in a syscall releases its P, and a new M may be created to keep `GOMAXPROCS` worth of Ms running Go code. The runtime caps the total M count loosely (~10,000) to prevent runaway thread creation.
- The default is the value of `runtime.NumCPU()` at process startup. `runtime.NumCPU()` reads `/proc/cpuinfo`-equivalent state and is *not* container-quota-aware.
- The environment variable `GOMAXPROCS=N` and the function `runtime.GOMAXPROCS(N)` both set the value. Environment wins at startup; the function call wins thereafter.

The **container caveat** is the most common production gotcha. A Go binary running in a Docker container with `--cpus=2` on a 32-core host will see `runtime.NumCPU() == 32` and set `GOMAXPROCS=32`. The Linux kernel will throttle the process to 2 cores worth of CPU time via cgroup CFS quotas; the runtime, ignorant of the throttling, schedules as if it had 32 cores. The symptom is severe scheduler latency under load: with 32 Ps competing for 2 cores of wall-clock CPU, every preemption boundary becomes a wait point.

The fix is the `uber-go/automaxprocs` library:

- **Package:** [`go.uber.org/automaxprocs`](https://pkg.go.dev/go.uber.org/automaxprocs)
- **Author:** Uber
- **Usage:** import `_ "go.uber.org/automaxprocs"`; its `init()` reads the cgroup CPU quota from `/sys/fs/cgroup/cpu.max` (cgroup v2) or `/sys/fs/cgroup/cpu/cpu.cfs_quota_us` (cgroup v1) and calls `runtime.GOMAXPROCS` with `quota/period`, rounded.

Go 1.25 (August 2025) integrated equivalent behaviour into the runtime itself: `GOMAXPROCS` now defaults to the cgroup quota when one is set. Code that already imports `automaxprocs` will continue to work; new projects on Go 1.25+ can rely on the default. The [Go 1.25 release notes](https://go.dev/doc/go1.25#runtime) cover the change in detail.

A second related discussion is whether `GOMAXPROCS` should match physical cores or hyperthreaded logical cores. The runtime treats logical cores as Ps by default, which is correct for most workloads. CPU-bound numerical code that fits in L1/L2 cache sometimes benefits from `GOMAXPROCS=N_physical` to avoid SMT contention; benchmark before changing.

A third consideration: the relationship between `GOMAXPROCS` and the number of `M` (OS thread) values is loose. `GOMAXPROCS` caps the number of Ms running Go code at any instant; it does not cap total Ms. An M that blocks in a syscall — `read()` on a socket without netpoll integration, a CGO call, a `os.File` operation on a file system that the netpoller does not cover — releases its P, and the runtime creates a fresh M (if none is idle) to keep `GOMAXPROCS` cores busy with Go code. The blocked M continues to exist until the syscall returns, at which point it tries to reacquire a P and, if none is free, parks itself in the idle-M list. A program that issues many concurrent blocking syscalls (think `cgo` calls into a library that does its own I/O) can accumulate hundreds or thousands of Ms; the runtime caps this at 10,000 by default to prevent runaway thread creation. The cap is configurable via [`debug.SetMaxThreads`](https://pkg.go.dev/runtime/debug#SetMaxThreads).

---

## 8. Authoritative source files for the scheduler

The scheduler implementation is in [`src/runtime`](https://github.com/golang/go/tree/master/src/runtime) in the main Go repository. The files below are the ones a serious reader visits first; the package contains many others (GC, memory allocator, channels, maps, panic/recover, profiling) that interact with the scheduler but are not its core.

| File | Role |
|------|------|
| [`runtime/proc.go`](https://github.com/golang/go/blob/master/src/runtime/proc.go) | The scheduler itself. ~6,500 lines. Contains `schedule()`, `findRunnable()`, `execute()`, `goexit0()`, `newproc()`, `park_m()`, `goready()`, `gopreempt_m()`, the work-stealing routines, and the G/M/P transition functions. If you read one file, read this one. |
| [`runtime/runtime2.go`](https://github.com/golang/go/blob/master/src/runtime/runtime2.go) | Type definitions for `g`, `m`, `p`, `schedt`, `gobuf`, `stack`, and the constants that govern queue sizes and state machines. Read alongside `proc.go`; you cannot understand the scheduler without the type layouts. |
| [`runtime/asm_*.s`](https://github.com/golang/go/tree/master/src/runtime) | Architecture-specific assembly. `asm_amd64.s`, `asm_arm64.s`, `asm_386.s`, `asm_arm.s`, `asm_riscv64.s`, etc. Contains `gogo` (jump into a goroutine's saved register state), `mcall` (switch to the M's `g0` stack for scheduler code), `morestack` (the stack-growth trampoline), `jmpdefer` (deferred-call trampoline). One assembly file per architecture; all implement the same Go-level contract. |
| [`runtime/signal_*.go`](https://github.com/golang/go/tree/master/src/runtime) | Signal handling per OS: `signal_unix.go`, `signal_linux_amd64.go`, `signal_darwin.go`, `signal_windows.go`. Contains the signal handler that implements async preemption (`SIGURG`) and the dispatch for fatal signals. |
| [`runtime/lock_*.go`](https://github.com/golang/go/tree/master/src/runtime) | OS-specific low-level locks: `lock_futex.go` (Linux), `lock_sema.go` (Darwin, Windows, BSDs), `lock_js.go` (WASM). The runtime's own mutex (`mutex`), distinct from the user-facing `sync.Mutex`. |
| [`runtime/sema.go`](https://github.com/golang/go/blob/master/src/runtime/sema.go) | The semaphore primitive that `sync.Mutex`, `sync.WaitGroup`, `sync.RWMutex`, and `sync.Cond` are built on. A treap-organised wait queue keyed by the address of the synchronisation variable; `semacquire` and `semrelease` park and unpark goroutines on the queue. |
| [`runtime/netpoll.go`](https://github.com/golang/go/blob/master/src/runtime/netpoll.go) | The portable interface to the OS's I/O readiness mechanism: `netpollopen`, `netpollclose`, `netpollready`, `netpoll`. The scheduler consults the netpoller in `findRunnable` to surface goroutines that are blocked on file descriptors. |
| [`runtime/netpoll_epoll.go`](https://github.com/golang/go/blob/master/src/runtime/netpoll_epoll.go), [`netpoll_kqueue.go`](https://github.com/golang/go/blob/master/src/runtime/netpoll_kqueue.go), [`netpoll_iocp.go`](https://github.com/golang/go/blob/master/src/runtime/netpoll_windows.go) | OS-specific implementations of the netpoller: epoll on Linux, kqueue on Darwin/BSD, IOCP on Windows. |
| [`runtime/preempt.go`](https://github.com/golang/go/blob/master/src/runtime/preempt.go) | The async-preemption logic added in Go 1.14: `preemptone`, `suspendG`, `resumeG`, the safe-point check, the signal-handler integration. Read with `signal_unix.go` and the Clements design doc. |
| [`runtime/stack.go`](https://github.com/golang/go/blob/master/src/runtime/stack.go) | Stack growth: `newstack`, `morestack`, the stack guard check, the copyable-stack mechanism (the runtime moves stacks when they grow, fixing up pointers via the GC's bitmap data). Stacks start at 2 KB and grow on demand. |
| [`runtime/chan.go`](https://github.com/golang/go/blob/master/src/runtime/chan.go) | Channel send/receive/close. The scheduler integration is in `chansend`/`chanrecv` which park the sending or receiving goroutine on a `sudog` wait list and unpark via `goready`. |
| [`runtime/mgc.go`](https://github.com/golang/go/blob/master/src/runtime/mgc.go), [`mgcmark.go`](https://github.com/golang/go/blob/master/src/runtime/mgcmark.go), [`mgcsweep.go`](https://github.com/golang/go/blob/master/src/runtime/mgcsweep.go) | The garbage collector. The scheduler and GC share state (`stopTheWorld`, `startTheWorld`, write barriers); reading the GC files clarifies many seemingly-arbitrary scheduler decisions. |
| [`runtime/trace.go`](https://github.com/golang/go/blob/master/src/runtime/trace.go) | The event tracer that backs `runtime/trace`. Every goroutine transition emits an event; the file documents the event schema consumed by `go tool trace`. |
| [`runtime/extern.go`](https://github.com/golang/go/blob/master/src/runtime/extern.go) | Doc comments for the public `runtime` package, including the canonical `GODEBUG` knob list. Read this whenever the [pkg.go.dev page](https://pkg.go.dev/runtime) is unclear. |

The file count and total line count of `runtime/` exceeds 80,000 lines as of Go 1.22. Only a small fraction is the scheduler proper; the bulk is the GC, the memory allocator, the cgo bridge, and the platform shims.

A second tier of files that interact with the scheduler but are not its core, listed for completeness:

| File | Role |
|------|------|
| [`runtime/time.go`](https://github.com/golang/go/blob/master/src/runtime/time.go) | The timer scheduler; `time.Sleep`, `time.After`, and `time.Timer` are all implemented here. Each P owns a heap of pending timers; the scheduler consults this heap in `findRunnable` and `checkTimers` to surface expired timers as runnable goroutines. Rewritten in Go 1.14 and again in Go 1.23 for lower latency and better cache behaviour. |
| [`runtime/select.go`](https://github.com/golang/go/blob/master/src/runtime/select.go) | The `select` statement's runtime. Builds a list of `sudog` entries, parks the goroutine on all involved channels, and unparks on the first ready case. Scheduler-adjacent because `select` is the most common reason a goroutine parks on multiple wait lists at once. |
| [`runtime/mprof.go`](https://github.com/golang/go/blob/master/src/runtime/mprof.go) | The block, mutex, and goroutine profilers. The goroutine profile in particular is the primary source of "where are my goroutines parked" information in production diagnostics. |
| [`runtime/cgocall.go`](https://github.com/golang/go/blob/master/src/runtime/cgocall.go) | The CGO bridge; calls from Go into C and from C into Go. The scheduler-relevant part is the protocol for handing off and reacquiring a P when crossing the language boundary, plus the locked-M dance required for C code that depends on thread-local state. |
| [`runtime/os_*.go`](https://github.com/golang/go/tree/master/src/runtime) | OS-specific initialisation, signal setup, and thread creation. `os_linux.go`, `os_darwin.go`, `os_windows.go`, `os_freebsd.go`, etc. Read when investigating a problem that appears only on a specific platform. |
| [`runtime/symtab.go`](https://github.com/golang/go/blob/master/src/runtime/symtab.go) | Function and PC metadata; the side tables that the GC, the stack scanner, and async preemption all consult. The safe-point information for preemption is keyed by PC into tables defined here. |
| [`runtime/mheap.go`](https://github.com/golang/go/blob/master/src/runtime/mheap.go) | The page allocator; the layer below the size-class allocator (`mcache`/`mcentral`) that the scheduler interacts with when a goroutine allocates. Not strictly scheduler code but the lock structure here affects scheduler contention. |
| [`runtime/mfinal.go`](https://github.com/golang/go/blob/master/src/runtime/mfinal.go) | Finalizers; the scheduler interaction is the dedicated finalizer goroutine created by the GC. |

---

## 9. Compatibility

Scheduler implementation details are explicitly *not* part of the [Go 1 compatibility promise](https://go.dev/doc/go1compat). The relevant clause:

> The first introductory paragraph of the document notes that the Go project is committed to compatibility for code written to the Go 1 specification… This document is about the compatibility of programs written to that specification. It does not cover the runtime [...] which may change in incompatible ways. Of course, such changes are intended to be invisible to running programs.

This has been exercised more than once:

- The G/M/P model itself replaced the global-runqueue scheduler in Go 1.1.
- Async preemption replaced cooperative preemption in Go 1.14.
- The scheduler became aware of cgroup CPU quotas in Go 1.25.
- Numerous tuning changes to work-stealing distribution, spin loops, and timer integration have shipped between minor releases.

None of these counted as compatibility breaks because no program could legitimately *depend* on the previous behaviour. A test that hangs because of cooperative preemption is a bug; a test that relies on a specific `GOMAXPROCS` default is fragile; a benchmark that measures absolute scheduler throughput is necessarily release-specific.

The practical implications for code:

- Do not write code that depends on a specific goroutine yielding to a specific other goroutine.
- Do not write code that assumes a specific number of OS threads exist for a given `GOMAXPROCS`.
- Do not write code that depends on a specific scheduling algorithm; the runtime can change which goroutine runs next on any release.
- Use `sync` and `chan` for synchronisation, not `runtime.Gosched` or timing-based heuristics.

What *is* stable: the public `runtime` package API (`GOMAXPROCS`, `NumGoroutine`, `Gosched`, etc.); the documented `GODEBUG` flags (older flags are kept working when new ones are added); the trace event schema (versioned and backward-compatible across releases since Go 1.21).

A useful framing: the scheduler's *behaviour at the boundary* — what `GOMAXPROCS` does, what `LockOSThread` guarantees, what `Gosched` observably affects — is stable. The scheduler's *internal mechanisms* — how it picks the next goroutine, how it steals work, how often it polls the netpoller, how it interleaves with the GC — are not. Code that depends on the first set is portable across releases; code that depends on the second set is fragile by design.

The compatibility document also notes that `GODEBUG` flags are subject to a softer guarantee: flags are documented and stable within a release line, and obsoleted flags are kept as no-ops for at least one major release after removal. New flags appear regularly (recent additions: `panicnil`, `randautoseed`, `tlskyber`); old flags do not disappear without warning. Operators relying on a specific flag for production debugging can do so safely across minor releases.

---

## 10. Notable scheduler-related proposals

- **[Proposal #24543: Non-cooperative goroutine preemption](https://github.com/golang/go/issues/24543).** Austin Clements, 2018; implemented Go 1.14. Replaced cooperative-only preemption with signal-based async preemption. The single most important scheduler change after the original G/M/P move. See section 3.
- **[Proposal #7237: New `runtime/race` API](https://github.com/golang/go/issues/7237).** Dmitry Vyukov, 2014. Standardised the race-detector's hooks into the runtime. The race detector instruments load and store sites and uses scheduler hooks (`racegostart`, `racegoend`) to track happens-before across goroutine boundaries. It is the single largest consumer of the scheduler's introspection surface and is a useful read for understanding the scheduler from the outside.
- **Issues around `runtime.LockOSThread`.** A cluster of issues — [#20458](https://github.com/golang/go/issues/20458), [#28361](https://github.com/golang/go/issues/28361), [#42190](https://github.com/golang/go/issues/42190), and others — concerns interactions between `LockOSThread`, `cgo`, the GC's stack scanner, and OS-level thread-local state. The discipline that emerged: a goroutine that calls `LockOSThread` and then exits without calling `UnlockOSThread` causes the OS thread to be terminated rather than returned to the pool, which is now the documented behaviour. Code that needs to ensure the M continues to live should call `UnlockOSThread` before goroutine exit.
- **[Soft memory limit (`GOMEMLIMIT`)](https://github.com/golang/go/issues/48409).** Michael Knyszek et al., implemented Go 1.19. Adds a soft memory limit to the GC pacer; when the limit is approached, the GC runs more aggressively and the scheduler may park goroutines longer to limit allocation rate. Scheduler integration is indirect — the GC sets pacing parameters that change when the scheduler enters GC-assist work in `gcAssistAlloc` — but the user-visible behaviour is that latency under memory pressure is more predictable.
- **[Proposal #51071: Container-aware `GOMAXPROCS`](https://github.com/golang/go/issues/51071).** Discussion that began in 2022 and resulted in the Go 1.25 cgroup-aware default. The thread is required reading if you maintain server-side Go code; it captures the trade-offs and edge cases (cpu-shares vs cpu-quota, hot reload of quota, cgroup v1 vs v2) that motivated the design.
- **[Proposal #36365: `runtime.PinThread`](https://github.com/golang/go/issues/36365).** Discussion of finer-grained thread pinning than `LockOSThread`. Not yet accepted; documents the design space if you ever need to pin a goroutine to a specific OS thread for reasons beyond what `LockOSThread` covers.
- **[Proposal #18802: Cooperative cancellation across goroutines](https://github.com/golang/go/issues/18802).** Discussion that fed into the `context` package's role as the cooperative-cancellation mechanism. Closed in favour of the existing `context.Context` shape.
- **[Proposal #6705: Concurrent garbage collection](https://github.com/golang/go/issues/6705).** Predates the modern issue tracker but is preserved; the foundation of Go's concurrent tri-colour mark-sweep collector that landed in Go 1.5. Scheduler-relevant because the concurrent GC required the scheduler to coordinate goroutine pause/resume around write-barrier transitions, and the GC's "mark assist" mechanism requires the scheduler to steal time from allocating goroutines to keep the GC keeping up.
- **[Proposal #43977: New trace format](https://github.com/golang/go/issues/43977).** Michael Knyszek, 2021; implemented in stages through Go 1.21 and Go 1.22. Reworked the `runtime/trace` event format to support partial captures, streaming, and significantly lower overhead. The new format is what `go tool trace` consumes today; the old format is supported for backward compatibility.
- **[Proposal #57175: Per-G memory limit (proposal phase)](https://github.com/golang/go/issues/57175).** Active discussion as of 2024 about whether individual goroutines should be subject to memory limits independently of the process-wide `GOMEMLIMIT`. Not yet accepted; the thread is informative about the trade-offs between scheduler complexity and runtime resource management.

---

## 11. Reading order for the source

A recommended path through the runtime, for a reader who has already read the Vyukov 2012 doc and the Go memory model:

1. **`runtime/runtime2.go`** — the type definitions. Skim until you can name what each field of `g`, `m`, `p`, and `schedt` is for; do not try to memorise.
2. **`runtime/proc.go`**, starting with `schedule()`. Follow its calls into `findRunnable()` and trace what happens when each refill source (local queue, global queue, netpoller, work-stealing) succeeds or fails. Skip the GC-related branches on first reading.
3. **`runtime/asm_amd64.s`** (or your architecture). Read just `gogo`, `mcall`, and `morestack`. The assembly is short and the comments are unusually clear; understanding these three primitives is essential to grasping how a goroutine switch actually happens.
4. **`runtime/sema.go`** — the semaphore that backs `sync.Mutex`. Read `semacquire` and `semrelease`; trace one acquire–release cycle.
5. **`runtime/chan.go`** — `chansend` and `chanrecv`. Note how the scheduler is invoked when a send or receive blocks (`goparkunlock`) and when a counterpart arrives (`goready`).
6. **`runtime/preempt.go`** — paired with the Clements design doc. Read `preemptone`, then trace `asyncPreempt` from the signal handler in `signal_unix.go` through to `preemptStop` in `proc.go`.
7. **`runtime/netpoll.go`** plus the per-OS file for your platform — read `netpoll(delay)` and follow how `findRunnable` consumes its results.
8. **`runtime/stack.go`** — `newstack` and the stack-growth path. Last because the mechanics are intricate and the rest of the system mostly does not care.
9. **`runtime/trace.go`** — only after the rest makes sense; useful as a cross-reference for what events the runtime exposes.

Allow several focused sessions. The first read is for shape; the second for detail; the third is when actual changes can be proposed. Reading the source while running `go tool trace` on a representative workload accelerates the process considerably, because the trace gives concrete examples of every transition the source describes.

A pragmatic supplement: read the [Go runtime test suite](https://github.com/golang/go/tree/master/src/runtime/testdata) alongside the source. The tests are the runtime authors' executable documentation of the scheduler's intended behaviour, and they cover edge cases (locked OS threads, racing preemption, GC during steal, syscall storms) that the comments do not always spell out. Test names like `TestPreemptionAfterSyscall` and `TestLockOSThreadAvoidsStatePollution` are particularly informative.

A second supplement: the [Go runtime issue tracker](https://github.com/golang/go/issues?q=is%3Aissue+area%3Aruntime) is a long-running discussion of scheduler edge cases. Reading closed issues from the past three or four releases will turn up the same handful of recurring topics — preemption interaction with CGO, `LockOSThread` semantics, `GOMAXPROCS` defaults under containerisation, timer scheduling latency — and the maintainers' final reasoning on each. This is the closest the project has to an evolving FAQ.

---

## 12. Bug reporting

The Go project tracks bugs on GitHub:

- **Repository:** [github.com/golang/go](https://github.com/golang/go)
- **Issue tracker:** [github.com/golang/go/issues](https://github.com/golang/go/issues)
- **Label for runtime bugs:** `compiler/runtime` and the more specific `area:runtime` and historical `runtime` labels.
- **Triage and release process:** [Go project contribution guide](https://go.dev/doc/contribute) and the [Proposing Changes](https://github.com/golang/proposal) repository for substantive design changes.

A useful scheduler bug report contains:

- The output of `go version` and the value of `runtime.GOOS`/`runtime.GOARCH`.
- A minimal program that reproduces the issue (`go.dev/play` link if it can be reproduced there).
- The output of `GODEBUG=schedtrace=1000,scheddetail=1` during the misbehaviour, ideally with a corresponding `runtime/trace` capture.
- The value of `GOMAXPROCS` (and, if running in a container, the cgroup CPU quota).
- Whether `GODEBUG=asyncpreemptoff=1` changes the symptom.
- For suspected races, the output of `go run -race`.

The maintainers triage hundreds of runtime issues a year; reports with reproductions are addressed quickly, reports without are typically closed as "needs more info" within a week or two. The labels [`NeedsFix`](https://github.com/golang/go/issues?q=is%3Aissue+label%3ANeedsFix+area%3Aruntime) and [`Performance`](https://github.com/golang/go/issues?q=is%3Aissue+label%3APerformance+area%3Aruntime) are good places to browse the current state of known runtime issues; reading recently-closed issues is one of the most effective ways to understand what the runtime team currently considers in-scope and out-of-scope.

Substantive scheduler changes go through the [proposal process](https://github.com/golang/proposal): a design document is written, reviewed by the Go team, posted for community comment, accepted or rejected on the issue tracker. The proposal directory itself ([go.googlesource.com/proposal](https://go.googlesource.com/proposal)) contains the design docs for every accepted proposal back to Go 1.5, including the cooperative-preemption replacement (`24543-non-cooperative-preemption.md`), the soft memory limit (`48409-soft-memory-limit.md`), and the loopvar semantic change (`60078-loopvar.md`). Reading these alongside the code they motivated is the most efficient way to internalise both the runtime's current state and the reasoning behind it.

For changes that do not warrant a full proposal — bug fixes, small optimisations, documentation improvements — the standard Go contribution workflow applies: file an issue, await triage, submit a CL via [gerrit](https://go-review.googlesource.com/), iterate with the maintainers on review, get the CL merged. The CL process is described in the [Go contribution guide](https://go.dev/doc/contribute) and the practical mechanics are not unique to the runtime. The reviews on runtime CLs are unusually rigorous; Austin Clements, Michael Knyszek, Cherry Mui, and Michael Pratt are the most active reviewers for scheduler-touching changes and their comments are themselves a useful corpus for understanding the runtime's design constraints.

For day-to-day scheduler questions that do not warrant a bug report, the Go community on the [`gophers` Slack workspace](https://invite.slack.golangbridge.org/) (`#runtime` channel) and the [golang-nuts mailing list](https://groups.google.com/g/golang-nuts) are appropriate venues; the runtime maintainers are reachable in both. Stack Overflow's `[go-runtime]` tag is searchable but quality varies; treat its answers as starting points, not citations.

The scheduler has no specification document; the source is the spec. The path to fluency is to read Vyukov, read Clements, read the memory model, then read `runtime/proc.go` with `go tool trace` open in a second window. Everything else follows from there.

---

## 13. Glossary

| Term | Meaning |
|------|---------|
| **G** | Goroutine; the runtime's struct for a unit of concurrent execution. Holds a stack, saved register state (`gobuf`), and metadata. The `g` type is defined in `runtime/runtime2.go`. |
| **M** | Machine; the runtime's struct for an OS thread. Holds the thread's `g0` (the scheduler stack), the current G being executed, and the P (if any) that licenses it to run Go code. |
| **P** | Processor; a logical scheduling context. Holds a local run queue, timer state, GC assist credit, and the bookkeeping needed to execute Go code. The number of Ps is `GOMAXPROCS`. |
| **g0** | The scheduler's own stack on each M; used for runtime code that must not run on a user goroutine's stack (scheduler decisions, GC mark work, signal handling). |
| **Run queue** | An ordered list of runnable goroutines. Each P has a bounded local run queue (256 entries); the scheduler keeps a global run queue for overflow and for goroutines created when no P is available. |
| **Work stealing** | The technique by which an idle P refills its local run queue from the local queue of a busy P. Takes half the victim's queue per steal. |
| **Cooperative preemption** | The Go 1.0–1.13 preemption model: goroutines yielded only at compiler-inserted safe points (function prologues, channel ops, syscall returns). |
| **Async preemption** | The Go 1.14+ preemption model: the runtime signals a running M (`SIGURG`) and the signal handler reroutes the goroutine into a preemption stub at the next safe instruction. |
| **Safe point** | An instruction at which the GC and stack scanner can fully describe the goroutine's state; the set of safe points is emitted by the compiler as a side table consumed by the runtime. |
| **Netpoller** | The OS-specific I/O readiness interface inside the runtime; provides `netpoll(delay)` that returns goroutines blocked on file descriptors that are now ready. |
| **`gopark` / `goready`** | The two primitives that park (deschedule) and unpark (mark runnable) a goroutine. Every blocking operation eventually calls one of them. |
| **`sudog`** | The "secondary G"; a small struct linking a goroutine into a wait list (channel buffer, semaphore queue, mutex queue). The G itself is not on the wait list; a `sudog` references it. |
| **Stack copying** | The mechanism by which a growing goroutine stack is moved to a larger memory region with pointer fixups derived from the GC's bitmap data; allows stacks to start at 2 KB and grow on demand. |
| **GMP** | Shorthand for the G/M/P model; the architectural backbone of the scheduler. |
| **`GOMAXPROCS`** | The runtime variable and environment variable controlling the number of P values; equivalent to the maximum parallelism of Go code in the process. |
| **`schedtrace`** | The `GODEBUG` flag that emits a per-interval summary of scheduler state to stderr; the lightest-weight scheduler observability tool. |
| **`runtime/trace`** | The full event tracer; captures every goroutine transition, syscall, GC event, and user task into a binary trace consumed by `go tool trace`. |
