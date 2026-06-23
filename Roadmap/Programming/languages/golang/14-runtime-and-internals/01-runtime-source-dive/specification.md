# Runtime Source Dive — Specification

## 1. Introduction

The Go language has a formal specification — the document at `https://go.dev/ref/spec` — that describes syntax, type rules, and the semantics of every language construct. The Go *runtime* does not. There is no document titled "The Go Runtime Specification". The closest thing to a runtime spec is the source code at `src/runtime/` in the Go repository (`https://github.com/golang/go/tree/master/src/runtime`), the godoc page at `https://pkg.go.dev/runtime`, and a constellation of design documents, GODEBUG knobs, and language-spec clauses that, together, define the contract between user code and the runtime.

This is unusual. Most language runtimes have either no spec (Python's CPython implementation defines the behaviour of "Python") or a heavyweight one (the JVM specification, ECMA-262 for JavaScript). Go sits in between: the language spec is precise about what `go f()` *means* but silent about *how* the goroutine is scheduled; the runtime source is precise about scheduling but is "the implementation" rather than "the contract". The contract is implicit, and the senior Go programmer's job is to know which behaviours are guaranteed and which are accidents of the current implementation.

The documents that, collectively, function as the runtime spec:

- **The Go language spec** (`https://go.dev/ref/spec`) — defines the language-visible semantics of constructs the runtime implements: `go`, channel send and receive, `close`, `select`, `defer`, `panic`, `recover`.
- **The `runtime` package godoc** (`https://pkg.go.dev/runtime`) — defines the public API surface and the meaning of the exported functions: `GOMAXPROCS`, `GC`, `ReadMemStats`, `Gosched`, and roughly thirty others.
- **The Go memory model** (`https://go.dev/ref/mem`) — defines the happens-before guarantees across goroutines: which writes are visible to which reads after a channel send, a mutex release, or an atomic store.
- **Design documents** (`https://go.googlesource.com/proposal/+/master/design/`) — the proposals that introduced major runtime changes: the work-stealing scheduler, goroutine preemption, the soft memory limit. These are not normative but they are how the team communicates intent.
- **GODEBUG documentation** (`https://pkg.go.dev/runtime#hdr-Environment_Variables`) — the environment knobs that change runtime behaviour at process start; the set of knobs and their meanings are the closest the runtime has to a configuration spec.
- **Release notes** (`https://go.dev/doc/devel/release`) — record runtime changes between versions; many runtime behaviours have changed silently across releases and the notes are often the only record.

The unwritten rule that makes the runtime usable without a formal spec: the public API in `runtime`'s godoc is covered by Go 1's compatibility promise; the source-level implementation details are not. A program that calls `runtime.GOMAXPROCS` will keep working; a program that depends on the exact scheduling order of two goroutines may not. The remainder of this specification walks the documents that *do* exist and explains where the contract lives in each.

A second observation worth making upfront: the runtime is not a black box, and reading its source is a senior-Go skill rather than an exotic activity. The runtime is written in Go (with thin platform-specific assembly), the source tree is roughly 200,000 lines, and the file naming is consistent enough that a `grep` for a runtime function name typically lands within ten lines of the implementation. The Go team explicitly designs the runtime to be readable by its users, on the grounds that the runtime is the substrate of every Go program and treating it as inaccessible compounds bugs. The cultural expectation in the Go community is that an engineer triaging a difficult bug will, at some point, open the runtime source and read it. This specification is the map for that reading.

---

## 2. The Go language spec passages that touch the runtime

The language spec uses the word "runtime" sparingly but defers a great deal of behaviour to it. The clauses below are the places where the spec hands off to the runtime, with a note on where the implementation lives.

### 2.1 Go statements

From the spec: "A go statement starts the execution of a function call as an independent concurrent thread of control, or goroutine, within the same address space."

The clause says nothing about scheduling, stack size, OS thread binding, or preemption. All of that is the runtime's responsibility. The implementation lives in `runtime/proc.go`; the entry point is `runtime.newproc`, which the compiler emits in place of every `go f(args)` statement. The created goroutine is queued onto a P's local run queue; the scheduler picks it up when an M becomes available. None of this is in the language spec; all of it is in `proc.go`.

### 2.2 Channel send

From the spec: "A send on an unbuffered channel can proceed if a receiver is ready. A send on a buffered channel can proceed if there is room in the buffer. A send on a closed channel proceeds by causing a run-time panic. A send on a nil channel blocks forever."

The spec defines *what* happens; the runtime defines *how*. `runtime/chan.go` contains `chansend` and `chansend1`; the compiler lowers `ch <- v` to a call into one of them. The synchronisation primitives (the channel's `lock` field, the `sudog` wait queue, the goroutine parking logic) are not mentioned in the spec; they are the runtime's choice and have changed across releases.

### 2.3 Channel receive

From the spec: "A receive on a nil channel blocks forever. A receive on a closed channel proceeds by yielding the zero value of the channel's element type after any previously sent values have been received."

Implemented in `runtime/chan.go`'s `chanrecv` and `chanrecv1`. The compiler emits a single call for `v := <-ch` and a two-value variant `v, ok := <-ch` whose `ok` discriminates "received a value" from "channel closed and drained".

### 2.4 Close

From the spec: "The close built-in function closes a channel, which must be either bidirectional or send-only. It should be executed only by the sender, never the receiver, and has the effect of shutting down the channel after the last sent value is received. After the last value has been received from a closed channel `c`, any receive from `c` will succeed without blocking, returning the zero value for the channel element."

The "should be executed only by the sender" is a discipline, not a spec rule — the language permits a receiver to call `close`. The runtime check is in `runtime.closechan` (`runtime/chan.go`); double-close panics with `"close of closed channel"`, and close-of-nil panics with `"close of nil channel"`. Both are runtime panics, recoverable in principle, undesirable in practice.

### 2.5 Select statements

From the spec: "A 'select' statement chooses which of a set of possible send or receive operations will proceed. ... If one or more of the communications can proceed, a single one that can proceed is chosen via a uniform pseudo-random selection."

The pseudo-random selection is a runtime contract — `runtime/select.go` shuffles the case order before testing each — and is observable: a `select` with two always-ready cases will, over many iterations, choose each roughly half the time. This is a behaviour user code can depend on; it appears in the spec precisely because it would otherwise be an implementation detail. The compiler generates a call to `runtime.selectgo` per `select` statement; the case slice and the random seed are arguments.

A worked example illustrates why the spec wording matters:

```go
ch1 := make(chan int, 1); ch1 <- 1
ch2 := make(chan int, 1); ch2 <- 2

for i := 0; i < 1_000_000; i++ {
    select {
    case <-ch1:
        ch1 <- 1
    case <-ch2:
        ch2 <- 2
    }
}
```

Both cases are always ready. The spec guarantees a uniform random choice, so over a million iterations each case fires roughly 500,000 times. If the runtime were to favour case order, the loop would starve `ch2`. The spec language exists to forbid that.

### 2.6 Defer, panic, recover

From the spec: a `defer` statement schedules a function call to run when the surrounding function returns; `panic` begins unwinding; `recover` inside a deferred call captures the panic value and stops unwinding.

The runtime implementation is in `runtime/panic.go`. Deferred calls are stored in a per-goroutine linked list (`g._defer`); since Go 1.14 the common case uses open-coded defers (the compiler inlines the defer record into the stack frame), and a fallback path uses heap-allocated defer records. `runtime.gopanic` runs deferred functions in LIFO order; `runtime.gorecover` checks the goroutine's panic state and clears it. The spec defines the visible semantics; the runtime defines the cost model, which has improved by an order of magnitude across the 1.13 → 1.14 boundary.

### 2.7 Map operations

The spec defines `m[k]`, `m[k] = v`, `delete(m, k)`, `for k, v := range m`, and `len(m)` but does not specify the underlying data structure. `runtime/map.go` implements the open-addressed hash map with overflow buckets; `runtime/map_swiss.go` (under development) is the next-generation Swiss-table implementation. User code cannot depend on iteration order — the spec explicitly randomises it, enforced in `mapiterinit` — but can rely on the asymptotic complexity.

The iteration-order randomisation is itself a runtime contract worth highlighting. Early Go (pre-1.0) had deterministic map iteration; the Go team observed that programs accidentally depended on that order and broke when the implementation changed. The 1.0 runtime introduced an explicit randomisation pass that visits buckets starting from a random offset, specifically to prevent such accidental dependencies. The randomisation is not cryptographic; it does not defend against hash-flooding attacks (a separate seed in the hash function does that). It exists solely to keep iteration order in user code's mental model where it belongs: undefined.

### 2.8 Slices, append, copy

The spec defines `append`'s semantics ("appends elements to a slice; if the slice has sufficient capacity, the destination is resliced; otherwise, a new underlying array will be allocated") but not the growth strategy. The runtime's `growslice` (`runtime/slice.go`) doubles the capacity for small slices and grows by roughly 1.25x for large slices; the exact threshold and ratios are runtime choices and have shifted across releases.

---

## 3. The `runtime` package public API

The `runtime` package exports roughly thirty functions and a handful of types. The public surface is covered by Go 1 compatibility; anything not exported can change at any release. The functions most worth knowing:

| Function | Purpose |
|----------|---------|
| `GOMAXPROCS(n int) int` | Sets and returns the maximum number of OS threads that can execute user-level Go code simultaneously (the number of P's). Defaults to `NumCPU()`. |
| `NumCPU() int` | Returns the number of logical CPUs available to the current process; consults `sched_getaffinity` on Linux and the equivalent elsewhere. |
| `NumGoroutine() int` | Returns the number of goroutines that currently exist. Includes runtime goroutines (GC workers, finalizers) in some Go versions, excludes them in others — read the release notes if you depend on the exact value. |
| `Gosched()` | Yields the processor, allowing other goroutines to run. The current goroutine is moved to the back of its P's run queue. Useful in tight CPU-bound loops where a long-running goroutine should let others make progress. |
| `Goexit()` | Terminates the calling goroutine after running its deferred functions. Other goroutines are unaffected. If `Goexit` is called from the main goroutine and no other goroutines exist, the program crashes with "no goroutines (main called runtime.Goexit) - deadlock!". |
| `LockOSThread()` / `UnlockOSThread()` | Pins the current goroutine to the OS thread it is currently running on. Required by code that interacts with thread-local state (cgo, signal handling, locked GUI threads). Must be paired carefully; an unpinned-while-Locked goroutine can corrupt the thread's state. |
| `GC()` | Triggers a garbage collection and blocks until it completes. Rarely useful in production; common in benchmarks and tests. |
| `ReadMemStats(m *MemStats)` | Populates a `MemStats` with current heap and GC statistics. Stops the world briefly; not free to call. |
| `SetFinalizer(obj any, finalizer any)` | Associates a finalizer with an object; the runtime calls the finalizer some time after the object becomes unreachable, on a dedicated goroutine. Finalizers are unreliable — they may not run before program exit, may delay garbage collection, and impose ordering constraints. Use only for closing OS resources of last resort. |
| `KeepAlive(x any)` | Tells the compiler that `x` must be considered live until after the `KeepAlive` call. Required when interacting with C code through `unsafe.Pointer` and the GC might otherwise collect a backing buffer the C code is still reading. |
| `Caller(skip int)` | Returns the file, line, and program counter of the function `skip` frames up the call stack; `skip == 0` means the caller of `Caller`. Used by logging libraries to attach call-site information. |
| `Callers(skip int, pc []uintptr) int` | Like `Caller` but fills a buffer of PCs; cheaper when many frames are needed. |
| `Stack(buf []byte, all bool) int` | Formats the current goroutine's stack trace into `buf`; if `all` is true, includes every goroutine's stack. The bedrock of post-mortem debugging. |
| `SetBlockProfileRate(rate int)` | Configures the runtime's blocking-event profiler; rate is the average number of nanoseconds between recorded events. Zero disables. |
| `SetMutexProfileFraction(rate int) int` | Configures the contended-mutex profiler; one in `rate` contended mutex events is recorded. Zero disables. |
| `Version() string` | Returns the Go runtime version (`"go1.22.3"`). Used by tooling that adapts to runtime version. |
| `GOOS` / `GOARCH` (constants) | The target OS and architecture; set at compile time. |

The `MemStats` struct has fifty-plus fields. The ones worth knowing are: `Alloc` and `HeapAlloc` (bytes of allocated, in-use heap memory), `TotalAlloc` (cumulative bytes allocated, never decreases), `Sys` (total bytes obtained from the OS), `NumGC` (number of completed GC cycles), `PauseTotalNs` (cumulative GC stop-the-world pause), and `GCCPUFraction` (fraction of CPU spent in GC since program start). The full set is documented at `https://pkg.go.dev/runtime#MemStats`.

---

## 4. The Go memory model

The Go memory model (`https://go.dev/ref/mem`) is a separate document from the language spec. It defines the happens-before relation that governs which memory writes are visible to which reads across goroutines. The 2022 revision (concurrent with Go 1.19) clarified the model's atomic-operation semantics and is the current canonical text.

The core relations:

- **Within a single goroutine**, the program-text order is the happens-before order; this is the obvious case and the one programmers reason about by default.
- **Channel send happens before the corresponding receive completes.** Every write performed by goroutine A before sending on a channel is visible to goroutine B after receiving from that channel. This is the workhorse synchronisation primitive.
- **A receive from a closed channel happens after the close.** Closing a channel synchronises with every receive that observes the close (returning the zero value).
- **The `k`-th send on a channel with capacity `C` happens before the `k+C`-th receive completes.** Buffered channels still synchronise, but with the offset induced by the buffer.
- **`sync.Mutex.Unlock` happens before the next `Lock` returns.** Standard mutex semantics; the implementation lives in `runtime/lock_*.go` and `sync/mutex.go`.
- **`sync.Once.Do(f)` happens before any other call to `Do(f)` returns.** The function `f` runs exactly once; every goroutine that calls `Do` sees the writes performed by the executing goroutine.
- **Atomic operations on the same variable are totally ordered.** `sync/atomic` operations participate in a sequentially consistent ordering across all goroutines. Reads observe writes in a globally consistent order.

A small example:

```go
var data string
var ready = make(chan struct{})

func producer() {
    data = "hello"      // (1)
    close(ready)        // (2)
}

func consumer() {
    <-ready             // (3)
    fmt.Println(data)   // (4)
}
```

The memory model guarantees that (1) happens before (2), (2) happens before (3) returns (because closing synchronises with the receive that observes the close), and (3) happens before (4) by program order. Therefore (4) prints `"hello"` — never the empty string. Without the channel synchronisation, (4) could legally print either value, depending on cache state and reordering.

The Go memory model does *not* guarantee:

- That goroutines run in any particular order.
- That `runtime.Gosched` synchronises with anything (it does not).
- That `time.Sleep` synchronises with anything (it does not).
- That `fmt.Println` is a memory barrier (it is not, although it incidentally uses one through its internal mutex).

The 2022 revision (Russ Cox's "Updating the Go Memory Model") tightened three points worth knowing. First, it gave `sync/atomic` operations sequentially consistent semantics — they now behave as if all atomic operations across the program execute in a single global order. Earlier versions of the model were less precise and left some weak-ordering interpretations open; modern code can rely on the stronger guarantee. Second, the revision documented that compilers may not introduce data races into a program that the source did not contain (the "no fabrication" rule that languages like C++ also adopted). Third, it clarified that `panic` and `recover` interact with the memory model only through the normal goroutine and mutex synchronisation; there is no implicit barrier on panic.

The documents the senior programmer reads in this area: the memory model itself (`https://go.dev/ref/mem`), Russ Cox's "Hardware Memory Models" essay series (`https://research.swtch.com/hwmm`), and the `sync` and `sync/atomic` package godoc. The single best practical exercise is to take a small concurrent program that exhibits a race and walk through which happens-before edge is missing; the model makes intuitive after about three such exercises.

---

## 5. GODEBUG knobs that affect runtime behaviour

The `GODEBUG` environment variable lets a program enable or alter runtime instrumentation and behaviour at process start. The full list is at `https://pkg.go.dev/runtime#hdr-Environment_Variables`; the most useful in production debugging:

| Knob | Effect |
|------|--------|
| `gctrace=1` | Prints a one-line summary to stderr at the end of every GC cycle: cycle number, elapsed wall time, CPU time, heap before/after, stop-the-world pause. The bedrock of GC observability. |
| `schedtrace=1000` | Every 1000 milliseconds, prints scheduler state to stderr: number of P's, goroutines in run queue, GC state. Useful for diagnosing scheduling stalls. |
| `scheddetail=1` | Combined with `schedtrace`, prints per-P and per-M detail: which goroutine each M is running, each P's local run queue. Verbose; useful only when triaging a specific scheduler bug. |
| `allocfreetrace=1` | Logs every allocation and free; orders of magnitude of overhead. Use only on tiny test programs. |
| `efence=1` | Allocates each object on a new page and unmaps it on free, so use-after-free crashes immediately with SIGSEGV instead of corrupting another object. Catastrophic memory overhead; only useful when chasing a known memory-safety bug. |
| `gccheckmark=1` | At the end of every GC cycle, runs a non-concurrent stop-the-world mark and compares against the concurrent result. Detects bugs in the concurrent collector itself. Used by the Go team during development. |
| `madvdontneed=1` | On Linux, returns freed memory to the OS via `MADV_DONTNEED` rather than `MADV_FREE`. Changes the visible RSS behaviour; the underlying memory is the same. Useful when monitoring tools misreport RSS. |
| `cgocheck=2` | Performs aggressive verification of Go pointer rules at every cgo call. Halves cgo throughput; finds violations that the default `cgocheck=1` misses. |
| `panicnil=1` | Restores pre-Go-1.21 behaviour where `panic(nil)` was legal; current default makes it a runtime error. |
| `tlsmaxrsasize=...` | (Not a runtime knob but illustrative — many GODEBUG settings come from the `crypto/tls` and `net` packages; the umbrella is the same.) |

The discipline: turn on `gctrace=1` first in any GC-related investigation; turn on `schedtrace=1000` first in any scheduling-related investigation. Both are cheap, both produce immediately legible output, and both will guide you to the next, more expensive knob.

The `gctrace=1` output line is worth memorising. A representative example:

```
gc 14 @0.453s 3%: 0.018+1.7+0.005 ms clock, 0.072+0.42/1.6/2.1+0.022 ms cpu, 4->5->2 MB, 5 MB goal, 8 P
```

Reading left to right: cycle number 14, started 0.453 seconds into the program, 3% of CPU since program start spent in GC. The three time triples are stop-the-world phases plus concurrent mark; the `4->5->2 MB` is heap-before, heap-after-mark, heap-after-sweep; `5 MB goal` is the trigger the controller is targeting; `8 P` is `GOMAXPROCS`. Engineers fluent in this format can diagnose GC issues by eye from production logs.

---

## 6. Build-time flags and runtime hooks

A handful of environment variables and build flags configure the runtime at process start and stay constant for the life of the process. They are the most stable part of the contract.

| Variable | Effect |
|----------|--------|
| `GOGC` | Sets the GC trigger as a percentage of the previous heap size. Default 100 means "trigger when the heap doubles". Lower values (e.g. 50) collect more aggressively, reducing memory at the cost of CPU; higher values (e.g. 200) reduce CPU at the cost of memory. The runtime variable is `gcController.gcPercent`. `GOGC=off` disables GC entirely. |
| `GOMEMLIMIT` | (Go 1.19+) Sets a soft memory limit in bytes. The runtime targets total memory use below this value, triggering GC more aggressively as the heap approaches the limit. Critical for containerised deployments where exceeding the cgroup memory limit causes the OOM killer to fire. The runtime variable is `gcController.memoryLimit`. |
| `GOTRACEBACK` | Controls the verbosity of the stack trace printed on unhandled panic. `none` prints nothing; `single` (default) prints the panicking goroutine; `all` prints every goroutine; `system` adds runtime-internal frames; `crash` triggers an OS-level crash that produces a core dump. |
| `GOMAXPROCS` | Equivalent to calling `runtime.GOMAXPROCS` at process start. Sets the number of P's. The Go runtime since 1.5 defaults this to `runtime.NumCPU()`, which on Linux respects `sched_getaffinity` but does *not* respect cgroup CPU quotas; the `automaxprocs` library (`go.uber.org/automaxprocs`) is the de facto fix for containerised workloads. |
| `GODEBUG` | The umbrella knob covered in §5; multiple comma-separated settings are allowed. |
| `GOTRACE` | Older alias for some `GODEBUG` settings; deprecated in favour of `GODEBUG`. |

A pair of variables that have changed defaults across releases and merit attention: `GOGC` has been 100 since Go 1.0 and is unlikely to change, but `GOMEMLIMIT` is opt-in (default `math.MaxInt64`, i.e. effectively unlimited) and is the single biggest deployment change for containerised Go programs since the introduction of the concurrent GC. Setting `GOMEMLIMIT` to ~90% of the cgroup memory limit is the modern best practice; without it, Go programs can be OOM-killed even when the heap is far below the configured `GOGC` trigger, because the GC was not aware of the external limit.

The build-time tool flags worth knowing:

- **`-race`** — enables the race detector, which instruments every memory access. ~5x to 10x overhead; required for any concurrency test.
- **`-msan`** — memory sanitiser (Linux/amd64 only); detects use of uninitialised memory in C code reached via cgo.
- **`-asan`** — address sanitiser; detects buffer overruns in C code reached via cgo.
- **`-gcflags="all=-m"`** — prints escape-analysis decisions for every function; the canonical tool for understanding why a value heap-allocates.
- **`-ldflags="-X main.Version=..."`** — injects a value into a package-level string variable at link time; the standard way to embed a build version.

---

## 7. Source code layout: file-by-file authoritative reference

The `runtime/` directory in the Go source tree has ~250 `.go` files plus assembly. The files below are the ones a senior Go programmer should be able to navigate without a map. Paths are relative to `src/runtime/` in `https://github.com/golang/go`. A useful entry point before diving in is to clone the Go repository at the exact version your program is built against (`go version` reports it; `git checkout go1.22.3` selects it); reading the runtime source for a different version than the one in production is a common cause of misleading conclusions.

| File | Authoritative for |
|------|-------------------|
| `proc.go` | The goroutine scheduler: `newproc`, `schedule`, `findrunnable`, `execute`, work-stealing logic, P/M lifecycle. |
| `runtime2.go` | The core runtime data structures: `g` (goroutine), `m` (OS thread), `p` (processor), `sched` (global scheduler state), `sudog` (channel waiter). |
| `chan.go` | Channel send, receive, close, length, capacity. `hchan` struct definition. |
| `select.go` | The `select` statement implementation: `selectgo`, case shuffling, blocking and unblocking. |
| `map.go` | The hash-map implementation: `hmap` struct, `mapaccess`, `mapassign`, `mapdelete`, `mapiterinit`. |
| `map_swiss.go` | The Swiss-table map implementation under development as of recent Go versions. |
| `slice.go` | `growslice` and the slice-copy fast paths. |
| `mheap.go` | The heap arena allocator: span allocation, large-object handling, address space reservation. |
| `mcache.go` | Per-P allocation cache; the fastest allocation path for small objects. |
| `mcentral.go` | Per-size-class central free lists; the mid-tier between mcache and mheap. |
| `malloc.go` | The top-level allocator: `mallocgc`, the dispatcher that chooses between mcache, mcentral, and mheap. |
| `mgc.go` | The garbage collector's main loop: GC phases, the controller, write-barrier coordination. |
| `mgcmark.go` | The marker: scanning stacks, scanning heap objects, the tricolor invariant. |
| `mgcsweep.go` | The sweeper: reclaiming spans, returning memory to mcentral. |
| `mgcwork.go` | Per-P GC work queues, the work-stealing logic specific to the marker. |
| `panic.go` | `gopanic`, `gorecover`, defer record management. Open-coded defer support. |
| `stack.go` | Goroutine stack growth: `morestack`, `newstack`, stack copying. |
| `signal_unix.go` | Signal handling on Unix; how the runtime intercepts SIGSEGV, SIGBUS, SIGPIPE. |
| `os_linux.go`, `os_darwin.go`, etc. | OS-specific entry points: `osinit`, thread creation, futex implementation on Linux. |
| `cgo.go`, `cgocall.go` | The cgo runtime support: `cgocall`, `cgocallback`, the boundary between Go and C stacks. |
| `traceback.go` | Stack trace formatting; the implementation of `runtime.Stack` and panic output. |
| `symtab.go` | Symbol table lookup; the implementation of `runtime.Caller` and `runtime.Callers`. |
| `trace.go` | Execution tracer (`runtime/trace`) integration; emits events for `go tool trace`. |
| `time.go` | Timer wheel for `time.Timer`, `time.Sleep`, `time.AfterFunc`. |
| `lock_futex.go`, `lock_sema.go` | Low-level locks used inside the runtime itself; chosen per-platform. |
| `netpoll.go`, `netpoll_epoll.go`, `netpoll_kqueue.go` | The network poller: how the runtime parks goroutines waiting on I/O and wakes them when the OS reports readiness. |
| `preempt.go` | Asynchronous preemption (Go 1.14+); how the runtime interrupts a running goroutine at a safe point. |
| `mbarrier.go` | The write barrier: the GC's mechanism for tracking pointer updates during concurrent marking. |
| `memmove_*.s` | Architecture-specific assembly for `memmove`; the most performance-critical primitive in the runtime. |
| `asm_amd64.s`, `asm_arm64.s` | Architecture-specific runtime assembly: function preamble, stack growth check, system calls, atomic primitives. |

A working pattern: when investigating a runtime question, `grep` the `runtime/` directory for the function name from the godoc; the implementation is almost always in the file the table names. The runtime source comments are the second source of truth — they explain *why* a path exists in addition to *what* it does. The comments at the top of `proc.go`, `mgc.go`, and `mheap.go` are particularly dense and reward a careful read; each one is effectively a design doc embedded in the source.

The runtime's internal subpackages are also worth knowing. `internal/runtime/atomic` holds the architecture-specific atomic primitives the runtime uses internally (distinct from `sync/atomic`, which is for user code). `internal/runtime/sys` carries machine-specific constants. `internal/abi` describes the calling convention between Go-compiled code and runtime entry points. None of these are user-callable but reading them clarifies the shape of the runtime as a system.

---

## 8. Design doc index

The Go team's design documents are at `https://go.googlesource.com/proposal/+/master/design/`. The runtime-relevant ones, with the year of acceptance:

| Doc | Year | Subject |
|-----|------|---------|
| Vyukov, "Scalable Go Scheduler" | 2012 | The work-stealing scheduler with per-P run queues that replaced the original single-global-queue scheduler. The foundational design doc for Go's current scheduler. |
| Vyukov, "Concurrent Garbage Collector" | 2014 | The tricolor mark-and-sweep concurrent collector introduced in Go 1.5; the architectural foundation of every GC change since. |
| "Goroutine Preemption" (Austin Clements et al.) | 2018 | The Go 1.14 transition from cooperative preemption at function-call boundaries to asynchronous preemption via signals. Resolved long-standing latency tails for CPU-bound goroutines. |
| "Per-P Workqueues for the Garbage Collector" | 2016 | The GC's adoption of per-P work queues mirroring the scheduler's design. |
| "Cooperative Preemption" | 2017 | Pre-1.14 preemption: the safe-point insertion at function preambles; superseded by asynchronous preemption but explains the legacy. |
| "Tracking Soft Memory Limit" | 2021 | The `GOMEMLIMIT` proposal; introduced the soft memory limit mechanism in Go 1.19. |
| "Eager Stack Shrinking" | 2018 | The mechanism for returning goroutine stack memory after a stack-grown goroutine deactivates. |
| "Non-Cooperative Goroutine Preemption" | 2019 | Background on signal-based preemption: the safe-point identification, the signal handler design, the trade-offs with cgo and assembly code. |
| "ARM64 Register ABI" | 2021 | The shift from stack-based to register-based calling conventions on ARM64; the runtime impact and the per-architecture rollout. |
| "Internal Register-Based Calling Convention" | 2020 | The amd64 register ABI predecessor; affects every assembly function in the runtime. |
| "Loopvar Experiment" | 2023 | The per-iteration loop variable semantics that became default in Go 1.22; mostly a compiler change but the goroutine-leak bugs it fixes are runtime-visible. |
| "Profile-Guided Optimization" | 2023 | PGO support added in Go 1.21; the runtime tracing format that feeds the compiler. |

The proposals are not normative — they describe intent before implementation — but they are the most readable explanations of *why* the runtime works the way it does. A bug report referencing one of these designs lands well; a bug report that misunderstands the design lands poorly.

A pattern worth noting in the design-doc corpus: nearly every major runtime change is preceded by a design doc that explains the failure modes of the current implementation, the alternatives the team considered, and the trade-offs the chosen design accepts. The "Goroutine Preemption" doc, for instance, lists three rejected alternatives (insert more safe points, instrument loop back-edges, use a userland timer) and explains why signal-based preemption won. Reading the rejected alternatives is often more instructive than reading the accepted design, because it surfaces the constraints the runtime operates under: the GC's safe-point requirements, cgo's calling-convention constraints, the need to support every supported OS and architecture with a single mechanism.

---

## 9. The runtime package's `//go:` pragmas reference

The runtime source uses a set of compiler pragmas to control compilation, escape analysis, and stack layout. These are enforced by the compiler and the runtime, not by the language spec; they are documented in `cmd/compile/internal/...` and in the source files where they appear. User code can use a small subset; most are reserved for the runtime and standard library.

| Pragma | Meaning |
|--------|---------|
| `//go:linkname localname importpath.remotename` | Aliases a local name to a symbol in another package, bypassing the unexported-name rule. Used by the runtime to expose `runtime.nanotime` to `time`, by `reflect` to call into runtime internals. Requires `import _ "unsafe"` in the calling file. Considered semi-public — the standard library uses it extensively, but it is brittle across releases. |
| `//go:noescape` | Tells the compiler that the function does not let its arguments escape to the heap. Allows the compiler to keep arguments on the stack despite the function being implemented in assembly (which escape analysis cannot see into). Misuse causes use-after-free bugs that are nearly impossible to debug. |
| `//go:nosplit` | Tells the compiler not to insert a stack-growth check at the function's preamble. Used for runtime functions that run on the goroutine system stack or in contexts where stack growth is impossible (signal handlers, the scheduler itself). Misuse causes stack overflow with no diagnostic. |
| `//go:nowritebarrier` | Forbids write barriers in the function body. Used in the GC itself, where write barriers would recurse into the collector. The compiler errors if the function contains a write that would generate a barrier. |
| `//go:nowritebarrierrec` | Recursive variant: forbids write barriers transitively, through any function this one calls. Stronger guarantee, harder to satisfy. |
| `//go:systemstack` | The function must execute on the goroutine's system stack (g0's stack), not the user stack. Used for runtime primitives that must not be preempted or stack-grown. |
| `//go:notinheap` | The type must not be allocated on the GC heap. Used for runtime-internal types (m, p, g) that must have stable addresses outside the GC's purview. Available as `runtime/internal/sys` since Go 1.17. |
| `//go:noinline` | Forbids inlining of the function. Used in benchmarks (to make the function appear in profiles), in runtime code where the call boundary matters, and in test scaffolding. The only pragma routinely usable in user code without consequence. |
| `//go:norace` | The function is not instrumented by the race detector. Used in runtime code that manipulates shared state with custom synchronisation the race detector cannot understand. |
| `//go:uintptrescapes` | Treats `uintptr` arguments as if they were pointers for escape analysis purposes. Used for syscall wrappers where a `uintptr` value is a thinly-veiled pointer the GC must keep alive. |

A user-code rule of thumb: of these pragmas, only `//go:noinline` is safe in production code without explicit need. Every other pragma in this list exists because the runtime needs it; using one in application code is a strong signal of misunderstanding.

The historical context matters here. Several pragmas — `//go:linkname` in particular — leaked into widespread use through libraries that needed access to runtime internals that the public API did not expose. The `gopkg.in/yaml.v3` package, for instance, used `//go:linkname` to access an unexported reflect function; the `runtime` team eventually pushed back, declaring that uncontrolled `//go:linkname` use was a compatibility risk. As of Go 1.23, the toolchain emits a warning when `//go:linkname` is used to target a name the runtime team has not explicitly allowed, and the long-term plan is to restrict it to a published allowlist. The trajectory is clear: the pragmas exist to let the runtime escape its own rules, not to let user code do so.

---

## 10. Compatibility guarantee

Go 1's compatibility promise (`https://go.dev/doc/go1compat`) applies to the language spec, the standard library's exported API, and the build tool. It explicitly does *not* apply to:

- The exact behaviour of the garbage collector (timing, pause distribution, memory return policy).
- The exact behaviour of the scheduler (goroutine ordering, preemption points, P-to-M assignment).
- The exact contents of `runtime.MemStats` (fields can be added; existing fields' definitions can be refined).
- Unexported types and functions in the `runtime` package and elsewhere; `//go:linkname` access into them is at the user's risk.
- The format of crash dumps and stack traces (improved across releases).
- The set and behaviour of GODEBUG knobs (knobs are added and retired regularly).

What *is* covered for the runtime package:

- The exported function signatures: `GOMAXPROCS`, `GC`, `ReadMemStats`, etc., remain callable across releases.
- The documented semantics of those functions: `GOMAXPROCS(0)` continues to return the current setting without changing it; `Goexit` continues to terminate the current goroutine.
- The `MemStats` struct's existence and the meaning of documented fields (although new fields can appear and the underlying values can shift as the collector evolves).
- The signals the runtime traps (SIGSEGV, SIGBUS, SIGPIPE, SIGTERM handling).

The practical rule: code that uses the `runtime` package via its godoc API will keep working; code that imports `unsafe`, uses `//go:linkname`, or depends on the exact bytes of a `MemStats` field is on its own.

---

## 11. Where to file a runtime bug

The Go project's issue tracker is at `https://github.com/golang/go/issues`. Runtime bugs are labelled `compiler/runtime` (the boundary between compiler-emitted code and runtime functions is fuzzy enough that the labels are combined). The triage flow:

- A new issue starts unlabelled; the triage team adds the area label within a day.
- An issue is assigned to a milestone (`Go1.NN`) when accepted; the milestone reflects when the fix is targeted, not when it will land.
- An issue tagged `NeedsInvestigation` requires the reporter to provide more information; one tagged `NeedsDecision` is awaiting a design decision from the team.
- A reproducer that runs on the playground (`https://go.dev/play/`) is the gold standard. A reproducer that requires custom infrastructure is acceptable but slower to triage. A "this happens in production sometimes" report without a reproducer is the slowest path.

The runtime-bug-specific advice:

- Include `go version`, `GOOS`, `GOARCH`, `GOMAXPROCS`, and a snippet of `GODEBUG=gctrace=1` output if the bug is GC-related.
- For race-detector findings, include the full race report (the four-line header and both stack traces).
- For deadlocks, include the goroutine dump (`SIGQUIT` on Linux/macOS, or `kill -ABRT <pid>` in containers).
- For performance regressions, include the `go test -bench` output from both the working and broken versions.

A senior Go programmer's quiet superpower is filing a bug well. Bugs filed with a runnable reproducer, a `git bisect` to the offending commit, and a clear "expected vs actual" land in the next minor release; bugs filed as "the runtime is slow" land nowhere.

There is also a culture of "if in doubt, ask first" in the Go community. The `golang-dev` mailing list and the `#performance` channel on the Gophers Slack are appropriate forums for "is this expected runtime behaviour?" questions before filing an issue. The triage team appreciates pre-filtered reports; the community appreciates being asked. The path from "I see something odd" to "I have an accepted issue with a milestone" is short when the report is high-quality and long when it is not.

---

## 12. Summary

The Go runtime has no formal specification document. The contract between user code and the runtime is the union of:

- The language spec's clauses on `go`, channels, `select`, `defer`, `panic`, and `recover`.
- The `runtime` package's godoc-documented API.
- The Go memory model.
- The set of GODEBUG knobs and their documented effects.
- The set of build-time environment variables (`GOGC`, `GOMEMLIMIT`, `GOTRACEBACK`).
- The Go 1 compatibility promise, which scopes what is guaranteed across releases.

The source code is the implementation, not the contract. A program that depends on `runtime/proc.go`'s exact scheduling order will eventually break; a program that depends on the godoc-documented behaviour of `runtime.GOMAXPROCS` will not.

The senior skill is knowing which document defines which behaviour and where the load-bearing implementations live. When a bug appears in channel synchronisation, the path is: spec to confirm semantics, memory model to confirm happens-before, `runtime/chan.go` to read the implementation, `GODEBUG=schedtrace=1000` to observe runtime behaviour, design doc to understand intent. When a bug appears in GC pause distribution, the path is: `MemStats` to measure, `GODEBUG=gctrace=1` to trace, `runtime/mgc.go` to read the controller, the "Concurrent Garbage Collector" design doc to understand the architecture, the release notes to find the regression.

The runtime is "the source code is the spec, but here is the constellation of documents that define the contract". Senior skill is moving fluently across that constellation — language spec, godoc, memory model, GODEBUG, design docs, source code, release notes, and the issue tracker — and knowing which document answers which kind of question.

---

## 13. Glossary

| Term | Meaning |
|------|---------|
| **G** | A goroutine; the runtime's `g` struct carries the goroutine's stack, program counter, scheduling state, and per-goroutine local storage. Defined in `runtime/runtime2.go`. |
| **M** | An OS thread (machine); the runtime's `m` struct binds a Go goroutine to a kernel thread. Created on demand up to a configurable limit (`runtime.SetMaxThreads`). |
| **P** | A logical processor; the runtime's `p` struct is the resource that an M must hold to execute Go code. The number of P's is `GOMAXPROCS`; each P owns a local run queue. |
| **GMP model** | The three-tuple of G's, M's, and P's that constitutes the Go scheduler's design. Documented in the "Scalable Go Scheduler" doc; implemented in `proc.go`. |
| **Goroutine** | A lightweight concurrent function execution; spec-defined as the result of a `go` statement; runtime-implemented as a G scheduled onto a P running on an M. |
| **Sudog** | A "pseudo-goroutine" record used as a wait-queue entry in channels and other primitives; allows one G to wait on multiple primitives. Defined in `runtime/runtime2.go`. |
| **Safe point** | A point in a goroutine's execution at which the runtime can safely interrupt it for GC, preemption, or stack scanning. Inserted by the compiler at function preambles and loop back-edges; signal-based preemption adds asynchronous safe points. |
| **Write barrier** | A small instruction sequence the compiler inserts before every pointer write during a GC cycle, recording the change so the concurrent marker maintains the tricolor invariant. Defined in `runtime/mbarrier.go`. |
| **STW (stop-the-world)** | A phase in which all goroutines are paused so the runtime can perform an operation that requires global consistency: phase transitions of the GC, scheduler shutdown, stack shrinking. Modern STW pauses are sub-millisecond; older Go versions had multi-millisecond pauses. |
| **System stack** | The runtime-private stack each M holds (the g0 stack), used for runtime code that cannot run on a user goroutine's growable stack. |
| **//go:linkname** | A compiler pragma that bypasses the unexported-name rule by aliasing a local name to a symbol in another package. The primary mechanism by which the standard library accesses runtime internals. |
| **Memory model** | The document at `https://go.dev/ref/mem` defining the happens-before relation that governs cross-goroutine memory visibility. Separate from the language spec. |
| **GODEBUG** | An environment variable that enables runtime instrumentation and alters runtime behaviour; the closest thing to a runtime configuration spec. Documented in the `runtime` package godoc. |
| **Go 1 compatibility** | The promise that Go programs written against the documented public API of the language and standard library will continue to compile and run across Go 1.x releases. Covers the `runtime` package's exported API but not the source-level implementation. |
