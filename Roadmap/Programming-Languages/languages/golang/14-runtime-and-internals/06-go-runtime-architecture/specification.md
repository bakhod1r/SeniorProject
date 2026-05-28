# Go Runtime Architecture — Specification

## 1. Introduction

The Go runtime has no single specification document. Unlike the language itself — which is pinned by [The Go Programming Language Specification](https://go.dev/ref/spec) — the runtime is the sum of several normative artefacts plus an open-ended body of implementation. The architecture is what falls out when you combine them.

The authoritative pieces are:

| Source | URL | Scope |
|--------|-----|-------|
| The Go language specification | https://go.dev/ref/spec | Constrains observable language semantics that the runtime must implement: goroutine creation, channel send/receive, panic/recover, defer ordering, package init order, map iteration randomisation. |
| The Go memory model | https://go.dev/ref/mem | Defines happens-before across goroutines; constrains what reorderings the runtime and compiler may perform; revised 2022 to align with C/C++ and Java memory models. |
| The Go 1 compatibility promise | https://go.dev/doc/go1compat | Pins which APIs and behaviours may not change; explicitly excludes internal layouts, allocator size classes, GC pause distributions, scheduler decisions. |
| The `runtime` package documentation | https://pkg.go.dev/runtime | The public surface of the runtime treated as a stable API; exported functions and their documented semantics are within the compatibility promise. |
| Accepted design proposals | https://github.com/golang/proposal | Each architecturally significant change ships with a written proposal; the merged set is the closest thing to an evolving runtime spec. |
| Release notes | https://go.dev/doc/devel/release | Per-release record of runtime changes, including those allowed under the compatibility promise's exceptions. |

A senior engineer treats these six sources as the "specification" of the runtime. The runtime source code in `src/runtime/` is the implementation; what is spec'd is what the documents above commit to, and what is implementation detail is everything else.

The distinction matters because Go's runtime evolves continuously while preserving program correctness. Between Go 1.0 and the current release, the scheduler has been redesigned three times, the GC has been rewritten from stop-the-world to concurrent tricolor, stack management has moved from segmented to contiguous to copyable, the memory model has been formalised twice, and the calling convention has shifted from stack-based to register-based. Programs from 2012 still compile and run on the modern runtime. The reason is the compatibility surface above — every change is checked against it, and changes that would break the surface either get a `GODEBUG` opt-out or never ship.

This document maps each source to its role, lists the architecturally significant proposals that shape the modern runtime, and identifies the source files where the contract is realised. It is meant as a reference: a senior engineer encountering an unfamiliar runtime behaviour should be able to locate the document that pins it (or confirm that no document does), the proposal that introduced it, and the source file that implements it.

---

## 2. The Go language specification

The language spec at [go.dev/ref/spec](https://go.dev/ref/spec) is a single HTML document maintained in the [golang/go](https://github.com/golang/go) repository under [doc/go_spec.html](https://github.com/golang/go/blob/master/doc/go_spec.html). It defines syntax, types, and statement semantics; it also pins several behaviours that the runtime is obliged to implement.

| Spec section | Runtime obligation |
|--------------|--------------------|
| [Go statements](https://go.dev/ref/spec#Go_statements) | `go f()` evaluates `f` and its arguments in the calling goroutine, then schedules a new goroutine to invoke `f`. Termination of the new goroutine does not wait for it. |
| [Channels](https://go.dev/ref/spec#Channel_types) | Buffered and unbuffered semantics, send/receive blocking rules, the receive-from-closed-channel returning the zero value, and the `nil` channel blocking forever. |
| [Select statements](https://go.dev/ref/spec#Select_statements) | Uniform pseudo-random choice among ready cases; default case fires only when no others are ready. |
| [Handling panics](https://go.dev/ref/spec#Handling_panics) | Deferred functions run in LIFO order during panic unwinding; `recover` returns the panic value only when called directly from a deferred function. |
| [Package initialization](https://go.dev/ref/spec#Package_initialization) | Variables initialised in dependency order; `init` functions run after variables; main package `init` runs last; multiple `init` per file allowed and run in source order. |
| [Map types](https://go.dev/ref/spec#Map_types) | Iteration order is not specified and must vary between iterations; this requirement forces the runtime to randomise iteration. |
| [Goroutines](https://go.dev/ref/spec#Run_time_panics) | Run-time panics are themselves spec'd: nil dereference, integer divide by zero, out-of-bounds index, type assertion failure on a non-comma-ok assertion. |

The spec does not constrain how goroutines are scheduled (the M:N scheduler, work stealing, preemption strategy), how memory is allocated (size classes, the page heap, the central cache), or how GC runs (concurrent, tricolor, write barrier choice). Those are implementation, and the runtime team is free to change them in any release.

The spec is intentionally terse on the runtime. A reading exercise: open [the spec](https://go.dev/ref/spec) and search for the words "scheduler", "garbage", and "thread". The first appears twice (in the "Go statements" section, both times as "scheduler"); the second appears once (under "Order of evaluation", noting that garbage collection may run concurrently); the third does not appear in any normative sense. This minimalism is deliberate — it gives the runtime team room to evolve the implementation without ratifying the change in the spec. The cost is that engineers reading the spec for runtime behaviour find very little; the runtime contract is encoded in the `runtime` package documentation, not in the spec.

---

## 3. The Go memory model

The Go memory model lives at [go.dev/ref/mem](https://go.dev/ref/mem) and was substantially rewritten in 2022 (Go 1.19 era) to align with modern hardware memory models. The rewrite is summarised in Russ Cox's article [Updating the Go Memory Model](https://research.swtch.com/gomm).

Key commitments:

| Commitment | Where defined |
|------------|---------------|
| Happens-before is the program order within a single goroutine, extended across goroutines by synchronisation events. | [memory model: happens before](https://go.dev/ref/mem#happens-before) |
| Channel sends happen before the corresponding receive completes; unbuffered receive happens before the send completes. | [channel communication](https://go.dev/ref/mem#chan) |
| `sync.Mutex` unlock happens before any subsequent lock acquisition; `sync.Once.Do(f)` ensures `f`'s completion happens before any other `Do` returns. | [mutex / once](https://go.dev/ref/mem#locks) |
| Goroutine creation happens before the goroutine begins executing; goroutine completion does not happen before any event (no implicit join). | [goroutine creation/destruction](https://go.dev/ref/mem#go) |
| `sync/atomic` operations are sequentially consistent; an atomic read sees the latest atomic write per happens-before. | [atomic values](https://go.dev/ref/mem#atomic) |
| Data races have undefined behaviour: any read concurrent with a non-atomic write to the same location is a race; the runtime is not obliged to produce sensible results. | [memory model: introduction](https://go.dev/ref/mem) |

The 2022 revision tightened the prior "happens-before is partial" wording, declared atomics sequentially consistent (matching C++ `seq_cst`), and gave compilers explicit licence to optimise across non-synchronising boundaries.

The memory model is what makes `sync` and `sync/atomic` substitutable for low-level memory fences. A program that synchronises exclusively through `sync.Mutex`, `sync.RWMutex`, `sync.Once`, channels, and `sync/atomic` types is race-free and observably sequentially consistent at synchronisation points. A program that uses unsynchronised reads and writes — even of word-sized types — has undefined behaviour, *not* "torn reads" or "stale values"; the spec gives the compiler licence to assume races never happen. The race detector (`-race`) is the only correct way to verify the absence of races; code review is insufficient, and benchmarks that "happen to work" prove nothing.

A related subtlety: `sync/atomic` provides the synchronisation primitives, but it does not promise any specific instruction sequence on any architecture. `atomic.LoadInt64` on amd64 is a plain `MOV`; on 32-bit arm it requires a `LDREXD`/`STREXD` pair; the same Go code compiles to whatever the architecture needs to deliver seq-cst semantics. The model is the contract; the codegen is implementation.

---

## 4. The Go 1 compatibility promise

[go.dev/doc/go1compat](https://go.dev/doc/go1compat) is the contract between the Go team and users. It pins:

- **Exported signatures** in the standard library (including `runtime`, `sync`, `sync/atomic`).
- **Documented semantics** of those exported APIs.
- **Compilation behaviour**: programs that build under Go 1.x continue to build under all subsequent 1.y minor releases.

It explicitly excludes:

| Excluded from compatibility | Why |
|-----------------------------|-----|
| Internal package layouts (`internal/` subtrees) | Not part of the public surface. |
| Allocator size classes, page heap geometry | Implementation detail; tuned per release. |
| GC pause-time distributions | Improved over time; no specific numbers are promised. |
| Scheduler decisions and preemption granularity | Changed substantially in 1.14 (async preemption) and 1.21 (per-P timers); no commitment to specific scheduling order. |
| Stack growth thresholds, contiguous stacks vs segmented | The 1.3-era transition from segmented to contiguous stacks broke no Go 1 programs but changed every stack-trace tool. |
| `runtime/debug` output format, `runtime/pprof` profile shapes | Profile *file format* is stable (pprof.proto); per-sample composition can change. |
| Bug fixes that change observable but undocumented behaviour | Section 5: "If we made a mistake... we reserve the right to fix it." |

Section 8 of the promise also explicitly excludes the runtime/cgo, runtime/debug, runtime/pprof, runtime/race, runtime/trace, and unsafe packages from full guarantee — they are exempted "to a greater extent than the rest of the standard library" because they expose implementation surface that must evolve with the runtime.

The Go 1 promise interacts with the runtime via two specific seams. The first is the *exported runtime API*: every function in [pkg.go.dev/runtime](https://pkg.go.dev/runtime) has a documented signature that is pinned, and a documented behaviour that is pinned to the extent the documentation is specific. `GC()` triggering a GC is pinned; the exact pacing behaviour that follows is not. The second seam is the *exported behaviour of the language*: panic ordering, defer LIFO, init ordering, channel close semantics — these are pinned by the language spec, not by the runtime package, but they are implemented by the runtime and the runtime cannot change them without breaking the language.

What this means in practice is that a runtime change must answer two compatibility questions: does it change any `runtime` package signature or documented behaviour, and does it change any language-spec-pinned behaviour? If both answers are no, the change is fair game. If either is yes, the change needs a proposal, a GODEBUG knob for opt-out, or both.

---

## 5. The `runtime` package documentation

[pkg.go.dev/runtime](https://pkg.go.dev/runtime) is treated as the spec for the runtime's public surface. Every exported identifier is in scope; the doc comment is normative within the bounds of the Go 1 promise.

Architecturally significant exported APIs:

| Symbol | Role |
|--------|------|
| `runtime.GOMAXPROCS(n)` | Sets the maximum number of OS threads simultaneously executing Go code (the `P` count in the GMP model). |
| `runtime.NumGoroutine()` | Returns the current goroutine count; used in leak detection. |
| `runtime.Gosched()` | Yields the current goroutine and re-queues it; rarely needed since 1.14 preemption. |
| `runtime.GC()` | Triggers a synchronous full GC cycle; documented as a debugging tool, not a production primitive. |
| `runtime.ReadMemStats(*MemStats)` | Snapshot of heap, GC, and allocator statistics; the canonical introspection API. |
| `runtime.SetFinalizer(obj, fn)` | Registers a finalizer; the deprecation path runs through `runtime.AddCleanup` in 1.24. |
| `runtime.AddCleanup(obj, fn, arg)` | The replacement for `SetFinalizer` (1.24, proposal 65395); composable, multiple cleanups per object. |
| `runtime.Pinner` | Pins a Go object so cgo can hold a pointer to it across calls (1.21, proposal 36365). |
| `runtime.SetMemoryLimit` (via `debug.SetMemoryLimit`) | Soft memory limit knob (1.19, proposal 48409). |
| `runtime.Stack(buf, all)` | Captures a goroutine stack dump; the substrate of every Go panic and crash report. |
| `runtime.Caller`, `runtime.Callers`, `runtime.CallersFrames` | Call-stack introspection; the substrate of logging and tracing libraries. |
| `runtime.LockOSThread` / `UnlockOSThread` | Pin a goroutine to its OS thread; required for OS APIs with thread-affinity (OpenGL, locale, signal masks). |

The `runtime/debug`, `runtime/trace`, `runtime/pprof`, `runtime/metrics`, `runtime/cgo`, and `runtime/race` subpackages provide additional surface; `runtime/metrics` (1.16+) is the modern structured-metrics interface intended to replace ad-hoc `MemStats` inspection.

A senior reading of the `runtime` package recognises three layers in its surface:

| Layer | Examples | Stability |
|-------|----------|-----------|
| **Tuning** | `GOMAXPROCS`, `SetMutexProfileFraction`, `SetBlockProfileRate`, `SetCPUProfileRate`, `debug.SetGCPercent`, `debug.SetMemoryLimit`. | Stable signatures; semantics deliberately coarse so they can be re-tuned. |
| **Introspection** | `NumGoroutine`, `ReadMemStats`, `Stack`, `Callers`, `metrics.Read`. | Stable signatures; the *meaning* of fields can evolve (e.g., new `MemStats` fields added). |
| **Coordination** | `LockOSThread`, `Goexit`, `AddCleanup`, `Pinner`. | Stable signatures; semantics pinned by the explicit documentation. |

Tuning APIs are blunt instruments: they exist so programs can express coarse policy (max parallelism, profile sample rate) without committing the runtime to specific internal mechanics. Introspection APIs are debugging tools: their output evolves as the runtime evolves, and code that parses them is signing up for maintenance. Coordination APIs are sharp tools: each has subtle semantics (`LockOSThread` pins for the goroutine's lifetime, not the function's; `Pinner` pins until `Unpin`; `AddCleanup` does not run on goroutines blocked in syscalls) that production code must respect.

---

## 6. Architecturally significant proposals

Each Go release lists accepted proposals at [github.com/golang/proposal](https://github.com/golang/proposal). The ones below reshape the runtime architecture; senior engineers should be able to name each by number.

| Proposal | Release | Title | Impact |
|----------|---------|-------|--------|
| [24543](https://github.com/golang/go/issues/24543) | 1.14 | Non-cooperative goroutine preemption | Replaces cooperative preemption at function-prologue safe points with asynchronous, signal-driven preemption; fixes tight-loop starvation; foundation for predictable scheduling. |
| [48409](https://github.com/golang/go/issues/48409) | 1.19 | Soft memory limit (`GOMEMLIMIT`) | GC adapts pacing to keep total memory below a configured limit; replaces ad-hoc `GOGC` tuning for memory-constrained services. |
| [51317](https://github.com/golang/go/issues/51317) | 1.20 (experimental, paused) | `arena` package | Region-based allocation for short-lived bulk objects; on indefinite hold pending API redesign. |
| [36365](https://github.com/golang/go/issues/36365) | 1.21 | `runtime.Pinner` | Lets cgo safely hold pointers to Go objects across calls without the prior `cgo.Handle` indirection. |
| [56295](https://github.com/golang/go/issues/56295) | 1.21 | Per-P timer heaps | Replaces the single global timer bucket with per-P heaps; eliminates timer contention at high goroutine counts. |
| [65395](https://github.com/golang/go/issues/65395) | 1.24 | `runtime.AddCleanup` | Composable replacement for `SetFinalizer`; multiple cleanups per object; clearer semantics around resurrection. |
| [54766](https://github.com/golang/go/issues/54766) | 1.24 | Swiss tables for maps | Map implementation replaced with Swiss-table-style probing; improves cache behaviour and shrinks per-entry overhead. |
| [44167](https://github.com/golang/go/issues/44167) | 1.17 | Register-based calling convention | ABI0 → ABIInternal; arguments and results passed in registers on amd64/arm64; faster call sites, smaller binaries. |
| [16734](https://github.com/golang/go/issues/16734) | 1.5 (historic) | Concurrent tricolor GC | The 2015 redesign that made GC pauses sub-millisecond and laid the architecture every subsequent change builds on. |

Discussion of accepted-but-not-yet-spec'd proposals lives at [go.dev/s/proposals](https://go.dev/s/proposals); the README under [github.com/golang/proposal](https://github.com/golang/proposal/blob/master/README.md) lists active design docs.

Each accepted proposal in the list above ships with a design document under `design/<number>-<slug>.md` in the proposal repo. The document is the closest thing to a per-feature spec: it states the motivation, the API change (if any), the implementation sketch, the compatibility implications, and the testing plan. A senior engineer reading a runtime change in a release note traces it back to the design doc, not to the implementing CL, for the architectural rationale.

Proposal 24543 in particular reshapes how every other proposal is understood. Before 1.14, preemption was cooperative at function-prologue safe points only; a tight loop without a function call could starve the scheduler indefinitely. After 1.14, the runtime sends `SIGURG` to an `M` to suspend its `G` at any safe point (any instruction with a valid stack map). This change is the prerequisite for predictable GC scheduling, for accurate `runtime/trace` timestamps, and for the soft memory limit's responsiveness — every later proposal assumes async preemption works.

Proposal 48409 (`GOMEMLIMIT`) is similarly foundational for the modern memory-management story. Before 1.19, programs operating under a hard memory limit (a container cgroup, a kubelet eviction threshold) had to either tune `GOGC` aggressively (high CPU cost, frequent collections) or accept OOM kills under load spikes. After 1.19, `GOMEMLIMIT=4GiB` instructs the runtime to begin pacing GC more aggressively as the heap approaches the limit, trading CPU for memory headroom. The setting is *soft* in the sense that the runtime does not refuse to allocate above it — Go programs cannot fail allocations — but the GC will burn arbitrary CPU to stay below. The interaction with `GOGC` is documented in [The Go Memory Limit blog post](https://go.dev/doc/gc-guide#Memory_limit) and is required reading for anyone tuning a containerised Go service.

Proposal 56295 (per-P timer heaps) eliminates a long-standing contention point: prior to 1.21, all timers lived in a single global heap protected by a mutex, and high-goroutine-count programs with many `time.After` or `context.WithTimeout` calls spent measurable time contending on it. After 1.21, each `P` has its own timer heap; timer scheduling is local, and the runtime steals timers across `P`s only when one runs out of local work. The change is invisible at the API level and visible only in profiles.

---

## 7. Build system contract

`go build` is the boundary between source and runtime. The contract:

| Element | Mechanism |
|---------|-----------|
| Compiler invocation | `cmd/compile` lowers Go to SSA, then to machine code per `GOARCH`; runtime is compiled alongside user code as a normal package. |
| Linker | `cmd/link` resolves runtime symbols, embeds DWARF, sets up the `rt0` entry. |
| Build tags | Files compiled conditionally per OS, architecture, or custom tag; `runtime/os_linux.go` builds only on Linux. |
| Cgo | `go build` invokes the host C compiler for cgo translation; runtime cgo bridges live in `runtime/cgo/`. |
| `purego` tag | When set, certain packages (e.g., `golang.org/x/sys/cpu`, some crypto) use pure-Go fallbacks instead of assembly; lets users opt out of platform-specific asm without dropping cgo. |
| `nosystem` / `nosys` tags | Used in experimental WASI/wasip1 builds to elide syscall dependencies. |
| `-tags` flag | User-supplied; controls `//go:build` constraints across the program including any runtime-influencing dependency. |
| `-buildmode` | `exe`, `pie`, `c-archive`, `c-shared`, `shared`, `plugin`; affects how the runtime is initialised and whether it owns `main`. |
| `-race` | Instruments memory accesses; links `runtime/race`; enabled program runs ~5x slower with full happens-before checking. |
| `-asan`, `-msan` | Address/memory sanitiser builds; require cgo and the platform sanitiser runtime. |
| `GOEXPERIMENT` env var | Enables in-tree experiments (`arenas`, `loopvar`, `swissmap`, `aliastypeparams`); the staging area for proposals before they become defaults. |

The `go build` invocation is itself reproducible: identical inputs produce identical outputs given the same toolchain version, recorded in `runtime.Version()` and the build info embedded by `runtime/debug.ReadBuildInfo`.

The runtime is compiled per build, not shipped as a precompiled archive. This has two consequences:

- **The runtime sees the same toolchain version as the user code.** There is no skew between "runtime version" and "compiler version"; an upgrade is atomic.
- **Build tags affect the runtime too.** `GOEXPERIMENT=swissmap` changes which `runtime/map_*.go` files are compiled in; `-race` adds `runtime/race` and instrumentation hooks. The same binary built with different tags has a structurally different runtime.

`GOEXPERIMENT` deserves separate attention. The list of in-tree experiments is enumerated in [`src/internal/goexperiment`](https://github.com/golang/go/tree/master/src/internal/goexperiment); each experiment is a boolean that flips a `//go:build` constraint across runtime and compiler. Past experiments include `regabi` (the register ABI, default in 1.17), `loopvar` (per-iteration loop variable scoping, default in 1.22), and `swissmap` (Swiss tables for maps, default in 1.24). `GOEXPERIMENT` is the staging environment between proposal acceptance and default-on; the lifecycle is "proposed → experimental → default → flag removed".

---

## 8. Runtime initialisation order

The init sequence from process entry to user `main`:

1. **OS loader** transfers control to `_rt0_<GOARCH>_<GOOS>` (e.g., `_rt0_amd64_linux`) in `runtime/rt0_<goos>_<goarch>.s`.
2. **`runtime.rt0_go`** (assembly) sets up the initial g0 stack, parses argv/envp, calls `runtime.args`, `runtime.osinit`, `runtime.schedinit`.
3. **`runtime.schedinit`** initialises the scheduler: allocates `m0`, sets `GOMAXPROCS`, calls `procresize`, initialises the GC, sets up the memory allocator, parses `GODEBUG`.
4. **`runtime.main`** is scheduled as goroutine 1; the bootstrap thread enters the scheduler and starts running it.
5. **`runtime.main`** runs package init in topological order: imports first, then the importing package; within a package, variable initialisers in dependency order, then `init` functions in source-file order.
6. **`main.main`** is invoked after all init returns.
7. On main return, `runtime.exit(0)` flushes profiles, runs registered atexit hooks, and calls the OS exit syscall.

The init contract is fixed by [the language spec](https://go.dev/ref/spec#Package_initialization); the architecture below it (g0, m0, P bootstrap) is implementation. The relevant source files are [`runtime/proc.go`](https://github.com/golang/go/blob/master/src/runtime/proc.go) (`schedinit`, `main`) and [`runtime/rt0_*.s`](https://github.com/golang/go/tree/master/src/runtime).

Two architectural details about init worth pinning:

- **Goroutines spawned during init.** A package's `init` may `go f()`; the new goroutine is scheduled normally but cannot make progress past synchronisation with another package's symbols until that package's init has run. The runtime does not enforce this — the spec does, by virtue of dependency-ordered init — and the consequence is that `init` should generally not block on goroutines it spawns. The convention is "register, do not run" in init.
- **`runtime.GOROOT()` and build info.** The init sequence populates `runtime/debug.ReadBuildInfo()` from data embedded by `cmd/link`; this includes module versions, VCS revision, and build flags. The data is available from any `init`, which is why telemetry libraries register early and capture build info before user code runs.

---

## 9. GODEBUG knobs

`GODEBUG` is a comma-separated list of `key=value` pairs interpreted by the runtime. The current set is documented at [pkg.go.dev/runtime#hdr-Environment_Variables](https://pkg.go.dev/runtime#hdr-Environment_Variables) and grows per release.

| Knob | Effect |
|------|--------|
| `gctrace=1` | Emit one line per GC cycle to stderr with heap sizes, pause times, and CPU usage. |
| `schedtrace=1000` | Emit scheduler summary every 1000 ms: goroutine count, P state, work-stealing stats. |
| `scheddetail=1` | When combined with `schedtrace`, dump every M, P, and G individually. |
| `asyncpreemptoff=1` | Disable async preemption (1.14+); reverts to cooperative-only; useful for diagnosing crashes that change behaviour under preemption signals. |
| `panicnil=1` | Restore pre-1.21 behaviour where `panic(nil)` did not become a `runtime.PanicNilError`. |
| `allocfreetrace=1` | Print stack trace for every allocation and free; extremely slow; debugging-only. |
| `gccheckmark=1` | Run a stop-the-world recheck phase after concurrent GC to detect missed marks. |
| `clobberfree=1` | Overwrite freed memory with garbage; surfaces use-after-free in pure-Go code. |
| `cgocheck=1` (default) / `2` | Validate cgo pointer passing; `2` enables expensive deep checks. |
| `madvdontneed=1` | On Linux, use `MADV_DONTNEED` instead of `MADV_FREE`; returns RSS to the OS faster at the cost of more page faults. |
| `tracebackancestors=N` | Include the creation stacks of the first N goroutine ancestors in panics; helps trace which goroutine spawned the crashing one. |
| `invalidptr=1` (default) | Crash on invalid pointers in GC scan rather than silently ignoring; rarely disabled. |
| `panicprint=1` | Print extra goroutine state when panicking. |
| `tarinsecurepath`, `httplaxcontentlength`, ... | Per-release compatibility toggles documented per the [GODEBUG compatibility policy](https://go.dev/doc/godebug). |

The compatibility policy at [go.dev/doc/godebug](https://go.dev/doc/godebug) commits to keeping each compatibility-flavoured `GODEBUG` knob working for two releases after the default changes.

The distinction worth internalising: `GODEBUG` knobs fall into three categories. **Diagnostic** knobs (`gctrace`, `schedtrace`, `allocfreetrace`) produce output but do not change behaviour. **Behavioural** knobs (`asyncpreemptoff`, `madvdontneed`, `clobberfree`) change runtime behaviour and are debugging or workaround tools. **Compatibility** knobs (`panicnil`, `tarinsecurepath`, `httplaxcontentlength`) restore prior behaviour after the default has changed, and are subject to the two-release deprecation window. A senior engineer reading `GODEBUG=...` in a production config recognises which category each entry belongs to and treats compatibility knobs as technical debt with a deadline.

---

## 10. Environment variables

| Variable | Purpose | Documented at |
|----------|---------|---------------|
| `GOMAXPROCS` | Cap on simultaneously executing Go-code threads (number of `P`s). Default: `runtime.NumCPU()`. | [pkg.go.dev/runtime#GOMAXPROCS](https://pkg.go.dev/runtime#GOMAXPROCS) |
| `GOGC` | GC target percentage relative to live heap; default 100 means "trigger when heap doubles". | [pkg.go.dev/runtime#hdr-Environment_Variables](https://pkg.go.dev/runtime#hdr-Environment_Variables) |
| `GOMEMLIMIT` | Soft memory limit in bytes (suffix `KiB`, `MiB`, `GiB`); GC pacing keeps total memory below this. | [proposal 48409](https://github.com/golang/go/issues/48409) |
| `GOTRACEBACK` | Verbosity of panic traceback: `none`, `single` (default), `all`, `system`, `crash`, `wer`. | [pkg.go.dev/runtime#hdr-Environment_Variables](https://pkg.go.dev/runtime#hdr-Environment_Variables) |
| `GODEBUG` | The knob bag described in section 9. | [go.dev/doc/godebug](https://go.dev/doc/godebug) |
| `GOROOT`, `GOPATH` | Toolchain and workspace roots; affect build, not runtime, but readable via `runtime.GOROOT()`. | [go.dev/ref/mod](https://go.dev/ref/mod) |
| `GORACE` | Configures the race detector (e.g., `halt_on_error=1`); read by `runtime/race`. | [go.dev/doc/articles/race_detector](https://go.dev/doc/articles/race_detector) |

`GOMAXPROCS`, `GOGC`, `GOMEMLIMIT`, and `GOTRACEBACK` are read at process start and again whenever the corresponding `runtime` setter is called.

The relationship between `GOGC` and `GOMEMLIMIT` is the most-misunderstood piece of runtime tuning. The pair forms an *or* — GC triggers when either bound is reached. `GOGC=100` means "trigger when live heap doubles since last GC"; `GOMEMLIMIT=4GiB` means "do not let total memory exceed 4 GiB, regardless of `GOGC`". With both set, the runtime runs whichever cycle would happen sooner. The common production pattern since 1.19 is `GOGC=off` (or a very high value) plus a tight `GOMEMLIMIT`: ignore the heap-doubling trigger entirely, and let the memory ceiling dictate pacing. This produces lower CPU under steady load and tighter memory bounds, at the cost of more variable per-cycle pause time when the ceiling is approached.

`GOMAXPROCS` also has subtle interaction with container limits. Until automatic CPU-quota detection (still not landed at time of writing), `GOMAXPROCS` defaulted to host CPU count, not container quota. Programs running under cgroup-limited Kubernetes pods would oversubscribe the scheduler and burn CPU on context switches. The community workaround is [`uber-go/automaxprocs`](https://github.com/uber-go/automaxprocs), which reads the cgroup quota at init and calls `runtime.GOMAXPROCS` accordingly. The same library is the canonical reference for "what does the runtime see vs what is actually available".

---

## 11. Authoritative source files

The runtime is in [github.com/golang/go/tree/master/src/runtime](https://github.com/golang/go/tree/master/src/runtime). The directory is a single Go package by name (`package runtime`), but it spans hundreds of files split by subsystem, OS, and architecture. The architecturally significant files:

| File | Role |
|------|------|
| [`runtime/runtime2.go`](https://github.com/golang/go/blob/master/src/runtime/runtime2.go) | Type definitions for `g`, `m`, `p`, `schedt`, `sudog`, `gobuf`, `stack`, the core scheduler state. |
| [`runtime/proc.go`](https://github.com/golang/go/blob/master/src/runtime/proc.go) | Scheduler: `schedule`, `findrunnable`, `execute`, `goexit`, work stealing, M/P lifecycle, preemption. |
| [`runtime/mgc.go`](https://github.com/golang/go/blob/master/src/runtime/mgc.go) | Garbage collector: mark phase, sweep phase, GC pacing, write barrier. |
| [`runtime/malloc.go`](https://github.com/golang/go/blob/master/src/runtime/malloc.go) | Allocator entry points: `mallocgc`, size class selection, mcache/mcentral/mheap dispatch. |
| [`runtime/mheap.go`](https://github.com/golang/go/blob/master/src/runtime/mheap.go) | Page heap: large allocations, arena management. |
| [`runtime/mcache.go`, `mcentral.go`](https://github.com/golang/go/blob/master/src/runtime/mcache.go) | Per-P cache and central free lists. |
| [`runtime/chan.go`](https://github.com/golang/go/blob/master/src/runtime/chan.go) | Channel send/receive/close; the `hchan` struct. |
| [`runtime/select.go`](https://github.com/golang/go/blob/master/src/runtime/select.go) | `select` implementation; random ordering of ready cases. |
| [`runtime/netpoll.go`](https://github.com/golang/go/blob/master/src/runtime/netpoll.go) | Network poller abstraction; per-OS backed by `netpoll_epoll.go`, `netpoll_kqueue.go`, `netpoll_windows.go`. |
| [`runtime/signal_unix.go`](https://github.com/golang/go/blob/master/src/runtime/signal_unix.go) | Signal handling, async preemption signal (`SIGURG`), crash signal mapping. |
| [`runtime/cgocall.go`, `runtime/cgo/`](https://github.com/golang/go/blob/master/src/runtime/cgocall.go) | The Go↔C boundary; `cgocall`, `cgocallback`, thread-state transitions. |
| [`runtime/asm_amd64.s`, `asm_arm64.s`, ...](https://github.com/golang/go/tree/master/src/runtime) | Architecture entry points, `morestack`, `gogo` (context switch), `systemstack`. |
| [`runtime/rt0_<goos>_<goarch>.s`](https://github.com/golang/go/tree/master/src/runtime) | Per-platform process entry; transfers control to `rt0_go`. |
| [`runtime/stack.go`](https://github.com/golang/go/blob/master/src/runtime/stack.go) | Stack allocation, growth (`morestack`), shrinking, stack scanning during GC. |
| [`runtime/panic.go`](https://github.com/golang/go/blob/master/src/runtime/panic.go) | `panic`, `recover`, defer chain, stack unwinding. |
| [`runtime/time.go`](https://github.com/golang/go/blob/master/src/runtime/time.go) | Timer implementation; per-P heaps since proposal 56295. |
| [`runtime/map.go`, `runtime/map_swiss.go`](https://github.com/golang/go/blob/master/src/runtime/map.go) | Map implementation; Swiss table variant under `GOEXPERIMENT=swissmap` pre-1.24, default in 1.24. |
| [`runtime/symtab.go`, `runtime/traceback.go`](https://github.com/golang/go/blob/master/src/runtime/symtab.go) | Symbol tables, PC→function resolution, stack traceback generation. |

A reading order for a new senior contributor: `runtime2.go` (types) → `proc.go` (scheduler) → `malloc.go` (allocator) → `mgc.go` (GC) → `chan.go` (channels) → `panic.go` (defer/recover) → `cgocall.go` (cgo boundary).

The assembly files deserve specific attention. [`runtime/asm_amd64.s`](https://github.com/golang/go/blob/master/src/runtime/asm_amd64.s) holds the most-touched runtime primitives: `gogo` (the G-to-G context switch, conceptually `setjmp`/`longjmp` between goroutine states), `mcall` (switch from G to g0 stack), `systemstack` (run a function on the system stack), `morestack_noctxt` (the stack-growth trampoline emitted at every function prologue). These four primitives plus their per-architecture variants are the substrate of the entire scheduler. Modifications to them are exceedingly rare and require sign-off from the runtime maintainer set.

The runtime also exposes a small Go-side compiler-runtime ABI in [`runtime/stubs.go`](https://github.com/golang/go/blob/master/src/runtime/stubs.go): functions like `getg`, `goexit`, `morestack`, `gcWriteBarrier` are declared in Go but implemented in assembly. The compiler emits calls to these by name; renaming them is a compiler-runtime coordinated change.

A few file conventions worth knowing when navigating the source tree:

| Pattern | Meaning |
|---------|---------|
| `*_amd64.go`, `*_arm64.go`, ... | Architecture-specific Go; built only for the named GOARCH. |
| `*_linux.go`, `*_darwin.go`, `*_windows.go`, ... | OS-specific Go; built only for the named GOOS. |
| `*_unix.go` | Built on all Unix-flavoured OSes (Linux, BSDs, macOS, Solaris). |
| `*_test.go` | Standard Go tests; runtime tests use a special build mode because the runtime cannot import normal testing infrastructure. |
| `export_test.go` | Bridges unexported runtime identifiers to test files; an internal-test pattern used across the standard library. |
| `*.s` | Plan 9 assembly; per `_<goarch>` suffix. |
| `*.h` | Plan 9 headers, used by the assembly files. |

Files prefixed with `m` historically denoted memory subsystem (`mheap`, `mcache`, `mcentral`, `mgc`, `malloc`) — a convention from the original C runtime that survived the 1.5 Go translation.

The runtime cannot use most of the standard library. It cannot import `fmt` (allocates), `sync` (circular), `errors` (allocates), or most of `os` (calls runtime). It has its own primitives in [`runtime/print.go`](https://github.com/golang/go/blob/master/src/runtime/print.go) (`print`, `println` without allocation), its own locks in [`runtime/lock_*.go`](https://github.com/golang/go/blob/master/src/runtime), and its own atomic operations in [`runtime/internal/atomic`](https://github.com/golang/go/tree/master/src/runtime/internal/atomic). This self-containment is what lets the runtime bootstrap itself before any user code runs, and what makes it possible to debug the runtime without depending on the runtime.

---

## 12. Cross-platform contract

The runtime targets a defined set of GOOS/GOARCH pairs listed at [go.dev/doc/install/source#environment](https://go.dev/doc/install/source#environment) and enumerated in [`src/internal/syslist`](https://github.com/golang/go/tree/master/src/internal/syslist).

Per-OS files implement an internal abstraction. The expected surface:

| Function | Implemented in | Role |
|----------|----------------|------|
| `osinit` | `os_<goos>.go` | Discover CPU count; read OS-specific config. |
| `newosproc(*m)` | `os_<goos>.go` | Create an OS thread bound to the given `m`. |
| `semasleep`, `semawakeup` | `os_<goos>.go` | Park/unpark an `m`; backed by futex on Linux, port sets on macOS, NT objects on Windows. |
| `sysAlloc`, `sysFree`, `sysReserve`, `sysMap` | `mem_<goos>.go` | Virtual memory primitives wrapping `mmap`/`VirtualAlloc`. |
| `signalM`, `setsig`, `sigprocmask` | `signal_<goos>.go` | Signal delivery to a target `m`; varies sharply between Unix and Windows. |
| `netpollinit`, `netpollopen`, `netpoll` | `netpoll_<goos>.go` | OS-specific I/O multiplexing: epoll, kqueue, IOCP, solaris ports. |
| `nanotime`, `walltime` | `time_<goos>_<goarch>.s` or `.go` | Monotonic and wall clocks; preferred over `time.Now()` in hot paths. |

A port to a new OS implements every function in this surface; a port to a new architecture additionally rewrites `asm_<goarch>.s`, `rt0_*_<goarch>.s`, and the relevant `*_<goarch>.go` ABI files. The list of officially supported ports is the matrix at [go.dev/wiki/PortingPolicy](https://go.dev/wiki/PortingPolicy).

The wasm ports (`js/wasm`, `wasip1/wasm`) are worth noting separately. They run in single-threaded environments without true OS threads; the GMP model degenerates to one `M` and one `P`, and goroutine "preemption" is cooperative because there is no signal mechanism. The netpoll abstraction is satisfied by host-supplied event handlers (`syscall/js` callbacks for browser, WASI hostcalls for wasip1). The same Go source compiles to wasm without modification, but the runtime substrate is structurally different from the threaded ports.

The OS abstraction is internal: it is not part of the Go 1 promise, and the function set above has changed several times (the netpoll abstraction was introduced in 1.0, generalised across OSes by 1.5, extended for io_uring experiments in 1.20+).

Tiers of port support are enumerated at [go.dev/wiki/PortingPolicy](https://go.dev/wiki/PortingPolicy):

| Tier | Definition | Examples |
|------|------------|----------|
| First class | Builders run on every commit; release blocker on failure; full support. | `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64`. |
| Second class | Builders run; failures are non-blocking but tracked; community-maintained. | `freebsd/amd64`, `linux/riscv64`, `windows/arm64`, `wasip1/wasm`. |
| Third class | Experimental or unsupported; no builders; may be removed. | `plan9/*`, `solaris/amd64`, `aix/ppc64`. |

The cross-platform contract is asymmetric: a first-class port may not regress, a second-class port should not regress, a third-class port may break in any release. The matrix is reviewed each release cycle.

---

## 13. Compatibility scope summary

| Item | Status |
|------|--------|
| `runtime` exported function signatures | Spec'd; Go 1 promise applies. |
| `runtime` exported function documented behaviour | Spec'd; can change only under bug-fix or GODEBUG-flagged opt-in. |
| Language semantics (panic ordering, defer LIFO, init order) | Spec'd in the language specification. |
| Happens-before relationships | Spec'd in the memory model. |
| Goroutine scheduling order | Not spec'd; can change. |
| GC pause-time distribution | Not spec'd; improves over releases. |
| Allocator size classes, internal mcache shape | Not spec'd; implementation. |
| Map iteration order | Spec'd to be randomised; specific permutation is not. |
| Map underlying data structure (Swiss tables vs prior hmap) | Not spec'd; changed in 1.24 transparently. |
| Stack growth strategy (contiguous vs segmented) | Not spec'd; changed in 1.3 transparently. |
| Preemption mechanism (cooperative vs signal) | Not spec'd; changed in 1.14. |
| Timer heap layout | Not spec'd; per-P heaps introduced in 1.21. |
| Profile file format (pprof.proto) | Spec'd in [github.com/google/pprof](https://github.com/google/pprof). |
| Trace file format (`runtime/trace`) | Not formally spec'd; documented per release; the `internal/trace` reader is the reference. |
| `runtime.MemStats` field names | Spec'd; values' definitions evolve. |

Anything in the "not spec'd" column is fair game for a release-to-release change and has historically changed without breaking user code.

Three rules of thumb follow from the table:

1. **If a behaviour is critical to your program's correctness, find the document that promises it.** If no document promises it, do not rely on it. The most common variant of this mistake is depending on goroutine scheduling order — every release reshuffles it, and code that "works" only because of the current order will break.
2. **If a behaviour is critical to your program's performance, measure it on your target Go version, and re-measure on every upgrade.** Allocator size classes, GC pacing, scheduler heuristics all change; a `go.mod` toolchain bump is a perfectly normal reason to see a 10% throughput shift in either direction.
3. **If a behaviour is exposed only via `GODEBUG`, treat it as temporary.** Compatibility knobs sunset after two releases; behavioural knobs may be removed without notice; diagnostic knobs are stable but produce text formats that are themselves not part of the compatibility surface.

---

## 14. Bug reporting

The runtime issue tracker is [github.com/golang/go/issues](https://github.com/golang/go/issues); the `runtime` label filters runtime-area bugs at [issues?q=label:runtime](https://github.com/golang/go/issues?q=is%3Aissue+label%3Aruntime).

| Label | Scope |
|-------|-------|
| `runtime` | Anything in `src/runtime/`. |
| `compiler/runtime` | Issues at the compiler↔runtime boundary (calling convention, write barriers, stack maps). |
| `GarbageCollector` | GC-specific. |
| `Scheduler` | Goroutine scheduling, preemption, work stealing. |
| `Performance` | Often paired with one of the above. |
| `OS-Linux`, `OS-Darwin`, `OS-Windows` | Platform-specific. |
| `arch-amd64`, `arch-arm64`, `arch-riscv64`, etc. | Architecture-specific. |

The reporting template at [github.com/golang/go/blob/master/.github/ISSUE_TEMPLATE/01-bug.yml](https://github.com/golang/go/blob/master/.github/ISSUE_TEMPLATE/01-bug.yml) requires `go version`, `go env`, a minimal reproducer, and observed vs expected behaviour. Runtime crashes additionally benefit from `GOTRACEBACK=crash` output, a `GODEBUG=gctrace=1,schedtrace=1000` log if the bug is GC- or scheduler-related, and (where reproducible) a `runtime/trace` capture.

Security issues go to `security@golang.org` per [go.dev/security/policy](https://go.dev/security/policy), not the public tracker.

The runtime team triages new issues weekly; the cadence is documented at [go.dev/wiki/IssueTriage](https://go.dev/wiki/IssueTriage). Common runtime-area triage paths:

| Symptom | First-line diagnostic ask | Likely subsystem |
|---------|---------------------------|------------------|
| `fatal error: concurrent map writes` | Repro + `-race` build output. | User code, not runtime; ranges over maps without external synchronisation. |
| `runtime: out of memory` | `GOMEMLIMIT`, `GOGC` settings, `/debug/pprof/heap` snapshot, container memory limits. | Allocator/GC; possibly a leak in user code. |
| `fatal error: all goroutines are asleep - deadlock!` | Full goroutine dump (`SIGQUIT` or `panic(unbufferred)`). | User code; the runtime is reporting accurately. |
| Stalls under load, GC pause spikes | `GODEBUG=gctrace=1,schedtrace=1000` log, `runtime/trace` capture. | GC pacing, scheduler, or OS-thread starvation. |
| Crashes only with `-race` | `GORACE=halt_on_error=1` output and the offending stack pair. | Genuine data race or race detector bug; the latter is rare. |
| Crashes only with cgo | `cgocheck=2`, valgrind on the C side. | Pointer-passing rules at the cgo boundary. |
| Crashes on a specific OS/arch only | `go env`, OS kernel version, reproducer on first-class platforms for comparison. | OS abstraction or assembly port. |

A well-formed runtime bug report makes the responder's first hour productive: minimal reproducer, version, OS/arch, environment, and the diagnostic output that matches the symptom. Reports without these are routed back for more information; reports with all of them are typically reproduced within a release cycle.
