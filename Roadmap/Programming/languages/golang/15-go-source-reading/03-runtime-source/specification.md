# Runtime Source — Specification

## 1. There is no spec; the source is the spec

The Go runtime — the body of code in `src/runtime/` that implements goroutines, channels, the scheduler, the garbage collector, the memory allocator, `panic`/`recover`, `defer`, the timer wheel, finalizers, signal handling, and the cgo bridge — has no separate specification document. Unlike the Go *language*, which is pinned by *The Go Programming Language Specification* (https://go.dev/ref/spec), the runtime's internal behaviour is not formally specified anywhere. The source code itself is the authoritative reference, and the behaviour it exhibits at any given release is what the runtime *is* at that release.

This is deliberate. The Go team has consistently refused to write a runtime specification because doing so would commit them to implementation choices that they want to revisit. The garbage collector was rewritten twice between 1.5 and 1.8; the scheduler grew async preemption in 1.14; the timer subsystem was sharded per-P in 1.21; maps were rebuilt on top of Swiss tables in 1.24. None of these changes broke a published specification because no specification existed to break.

What *does* exist is a network of constraining documents — the language spec, the memory model, the Go 1 compatibility promise, the public `runtime` package godoc, the proposal archive, and a handful of design documents in the `golang/go` wiki and the `go/design` directory. Together these constrain what the runtime is allowed to do without constituting a specification of *how* it does it. A senior reader of the runtime source learns to navigate this network as fluently as the source itself.

The practical consequence: when source reading produces a question of the form "is this behaviour guaranteed?", the answer is found in the language spec or the memory model, not in the runtime source. When the question is "how does this implementation work today?", only the source answers, and the answer may be different in the next release.

The Go team has stated this position explicitly. In the 2018 "Toward Go 2" articulation (https://go.dev/blog/toward-go2) and in periodic responses on the issue tracker, runtime maintainers reject requests to specify scheduler timing, GC pause guarantees, channel performance characteristics, or map iteration costs. The refusal is principled — committing to a specification freezes the implementation — and pragmatic — past commitments (the `panic(nil)` behaviour before 1.21, the goroutine stack starting size before 1.4) have all become drags on later improvements.

---

## 2. Language spec sections that bind the runtime

The Go language specification (https://go.dev/ref/spec) does not describe the runtime, but several sections describe behaviour that the runtime must implement. These are the contract surface between language and runtime:

| Section | URL fragment | Runtime obligation |
|---------|--------------|-------------------|
| **Go statements** | `#Go_statements` | `go f()` starts a new goroutine; function value and arguments evaluated in calling goroutine; runtime owns scheduling thereafter. |
| **Channel types** | `#Channel_types` | Send and receive semantics, capacity, close behaviour, nil-channel semantics (block forever), direction restrictions. |
| **Send statements** | `#Send_statements` | Send on closed channel panics; send on nil channel blocks. |
| **Receive operator** | `#Receive_operator` | Receive from closed channel returns zero value with `ok=false`; receive from nil channel blocks. |
| **Select statements** | `#Select_statements` | Random selection among ready cases; default case semantics; nil-channel cases never selected. |
| **Handling panics** | `#Handling_panics` | `panic` unwinds the stack running deferred calls; `recover` only effective in directly-deferred function. |
| **Defer statements** | `#Defer_statements` | LIFO execution order; arguments evaluated at defer time; runs even on panic. |
| **Program initialization** | `#Program_initialization` | `init` functions run after all imported packages' inits; single goroutine; before `main`. |
| **For statements with range clause** | `#For_statements` | Map iteration order is unspecified (runtime randomises); loop variable scoping changed in 1.22. |
| **Map types** | `#Map_types` | Concurrent map access without synchronization is undefined; runtime *may* detect and crash (and does, via `mapaccess` race checks). |

Each of these is a contract the runtime must satisfy. The implementation in `chan.go`, `panic.go`, `map.go`, `proc.go` is free to change as long as it continues to satisfy the spec's surface behaviour.

The spec deliberately under-specifies. Map iteration order is "not specified and is not guaranteed to be the same from one iteration to the next" — the runtime exploits this by introducing entropy at iteration start so that programs which accidentally depend on order fail loudly. Select's "uniform pseudo-random selection" is a runtime implementation choice that the spec elevated to a guarantee in Go 1.0 and has held ever since.

Two cases worth reading carefully:

- **`init` ordering.** The spec mandates that imported package inits run before the importer's inits, that multiple inits within a package run in source-file order (and within a file, in declaration order), and that all inits complete before `main`. The runtime executes these on a single goroutine (`runtime.main` in `proc.go`) before user code starts; the ordering is verified by the linker, not the runtime, but the runtime is responsible for making the linker-emitted init list run in a sequence consistent with the spec. Cross-package init ordering changes between releases when import graphs change, but the rules above hold.
- **Defer semantics under panic.** The spec promises that deferred functions run during panic unwinding in LIFO order, that a deferred call to `recover` stops the panic and returns the panic value, and that `recover` outside a deferred function returns nil. The runtime implements this in `panic.go` (`gopanic`, `gorecover`); the implementation has been rewritten three times (open-coded defers in 1.14, defer ranking changes in 1.18, runtime defer record reuse) without changing the observable semantics.

---

## 3. The Go memory model

The Go memory model (https://go.dev/ref/mem) is the second constraining document. It defines the happens-before relation across goroutines and pins the synchronization guarantees that the runtime must provide:

| Synchronization primitive | Memory model guarantee |
|--------------------------|------------------------|
| **Channel send / receive** | A send on a channel happens before the corresponding receive completes. The k-th receive on a channel with capacity C happens before the (k+C)-th send. |
| **Channel close** | A close happens before a receive that returns the zero value because the channel is closed. |
| **Mutex Lock / Unlock** | For any `sync.Mutex` or `sync.RWMutex`, the n-th call to `Unlock` happens before the (n+1)-th call to `Lock` returns. |
| **sync.Once** | The single call of `f()` from `once.Do(f)` happens before any subsequent call to `once.Do(f)` returns. |
| **WaitGroup** | A call to `wg.Done` happens before any call to `wg.Wait` that it unblocks returns. |
| **Atomic operations** | Atomics on a single variable are sequentially consistent (since Go 1.19); they synchronize like a mutex. |
| **Goroutine creation** | The `go` statement that starts a new goroutine happens before the goroutine's execution begins. |
| **Goroutine destruction** | The exit of a goroutine is not guaranteed to happen before any event in the program. |

The runtime's job is to make these guarantees true at the machine level — write barriers, atomic instructions, memory fences on weakly-ordered architectures (ARM64, RISC-V, PPC64) — without breaking them when adding optimizations. Every change to the scheduler or GC is reviewed against the memory model. The hybrid write barrier (1.8) and the per-P run queue (since 1.1) were designed to preserve happens-before while reducing synchronization cost.

The 2022 revision of the memory model (https://go.dev/blog/compatibility) added explicit guarantees for `sync/atomic` package operations and a "no thin-air values" rule, codifying behaviour the runtime had already provided informally.

The memory model is intentionally weak in places the runtime exploits:

- Reads and writes of single machine-word values are *not* guaranteed to be atomic in the absence of explicit `sync/atomic` use; the runtime assumes torn reads are possible and uses atomics or locks where atomicity matters.
- The goroutine that calls `os.Exit` may not run any deferred functions and may interleave arbitrarily with other goroutines' final operations; the runtime treats process exit as a hard cut rather than a synchronization point.
- The memory model does not specify *when* a finalizer runs, only that it runs at some point after the object becomes unreachable; the runtime is therefore free to delay, batch, or skip finalizers (the last under `runtime.SetFinalizer(obj, nil)` cancellation, never silently).

---

## 4. The Go 1 compatibility promise

The Go 1 compatibility document (https://go.dev/doc/go1compat) is the third constraining document. It states that Go programs that compile against the Go 1 specification will continue to compile and run correctly across future Go 1.x releases, with limited exceptions for security fixes and bugs.

For the runtime, the compatibility promise has two halves:

| Surface | Stability |
|---------|-----------|
| **Exported `runtime` package API** | Stable. Functions like `runtime.GOMAXPROCS`, `runtime.NumGoroutine`, `runtime.GC`, `runtime.SetFinalizer`, `runtime.Caller`, `runtime.Stack` continue to work across releases. Signatures may not change incompatibly. |
| **Internal runtime behaviour** | Not stable. The scheduler may grow new policies. The GC may use a different algorithm. Map representation may change. Channel implementation may be rewritten. Programs that depend on internals (timing, ordering, layout) may break. |

This split is the practical license for the runtime team to rewrite internals at will. The exported surface — roughly forty functions and a handful of types in `runtime/runtime.go`, `runtime/debug/`, and `runtime/pprof/` — is the contract. Everything under those signatures is implementation, and the implementation has changed dramatically across releases without breaking a single program that stayed within the contract.

Programs that used `//go:linkname` to call unexported runtime functions, or that relied on goroutine stack growth being exactly 8 KB, or that assumed map iteration order was deterministic, are explicitly outside the promise. The 1.24 `linkname` restriction (see section 6) tightened the boundary further.

Practical reading of the promise:

- A library that calls `runtime.NumGoroutine` will work in every Go 1.x release; the function name, signature, and documented contract are stable.
- A library that reads `unsafe.Sizeof(runtime.G{})` (via `linkname` shenanigans) is outside the promise and broke when `g` grew a new field in 1.14, 1.18, 1.21, and 1.24.
- A program that depends on a tight loop blocking GC indefinitely worked through Go 1.13 and broke in 1.14 when async preemption shipped. The "break" was not a compatibility violation because the program was depending on absence of preemption, which the spec never guaranteed.

---

## 5. The `runtime` package public docs

The godoc for the `runtime` package (https://pkg.go.dev/runtime) is the closest thing to a runtime specification that exists. It documents the exported API — what each function does, what its guarantees are, what side effects to expect.

Notable documented contracts:

| Function | Contract |
|----------|----------|
| `runtime.GOMAXPROCS(n int) int` | Sets the maximum number of OSthreads executing Go code simultaneously; returns previous value; n<=0 leaves unchanged. |
| `runtime.NumGoroutine() int` | Returns count of currently existing goroutines; snapshot, may be stale by the time caller reads it. |
| `runtime.GC()` | Runs a blocking garbage collection; may run concurrent phases; safe to call but rarely necessary. |
| `runtime.SetFinalizer(obj, fn)` | Sets finalizer; fn runs in its own goroutine eventually after obj is unreachable; no ordering guarantee; obj must be pointer; not for resource management. |
| `runtime.Goexit()` | Terminates calling goroutine; deferred functions run; no effect on other goroutines. |
| `runtime.Gosched()` | Yields the processor; current goroutine suspended; scheduler picks next runnable. |
| `runtime.LockOSThread()` | Wires goroutine to current OS thread until matching Unlock; required for cgo callers that need thread-local state. |
| `runtime.Stack(buf, all)` | Writes stack trace to buf; if all, writes traces for every goroutine. |
| `runtime.MemStats` struct | Exposed memory statistics; fields documented; values are snapshots. |

The godoc for `runtime/debug` (`SetGCPercent`, `SetMemoryLimit`, `FreeOSMemory`, `Stack`) and `runtime/pprof` (`StartCPUProfile`, `WriteHeapProfile`) extends this contract surface. Everything in these packages is covered by the Go 1 promise; the internal helpers in `runtime/internal/` and unexported identifiers in `runtime` are not.

A nuance worth flagging: several documented contracts in `runtime` are *aspirational* — they describe what callers should expect, not what the runtime literally guarantees. `runtime.SetFinalizer` documents that "the finalizer is scheduled to run at some arbitrary time after the program can no longer reach the object"; the word "arbitrary" is the runtime's reserved right to never run the finalizer at all if the program exits first. Programs that treat finalizers as a resource-cleanup mechanism are misreading the contract; finalizers are best-effort, not deterministic.

Similarly, `runtime.GC` is documented to run "a garbage collection". It does not promise that the collection is fully concurrent, that pauses will be below any specific bound, or that the heap will shrink afterwards. A program that calls `runtime.GC` and then asserts that memory usage dropped is depending on implementation, not contract.

---

## 6. The five important `//go:` pragmas

The runtime source uses compiler pragmas to control code generation. Understanding the five most-used pragmas is required to read the source without misreading it:

| Pragma | Meaning | Where seen |
|--------|---------|------------|
| **`//go:nosplit`** | The function must not check for stack growth; runs on whatever stack it has. Required for functions called during stack growth itself, signal handlers, and the morestack path. Violating it (calling a non-nosplit function from a nosplit one with insufficient stack) corrupts memory. | `runtime/stubs.go`, `runtime/asm_*.s`, write barrier helpers. |
| **`//go:nowritebarrier`** | The function must not contain any write barrier. The compiler errors if the function would emit one. Used in GC code that runs while write barriers are disabled. | `runtime/mgcmark.go`, `runtime/mgcsweep.go`. |
| **`//go:systemstack`** | The function must run on the per-M system stack (g0), not on a goroutine stack. The compiler emits a stack switch at every call site. Used for scheduler internals, GC root scanning, and signal handling. | `runtime/proc.go`, `runtime/mgc.go`. |
| **`//go:linkname`** | Makes a local function name refer to another package's unexported symbol; or exposes a local symbol to another package by alternate name. The classic escape hatch for accessing runtime internals. Restricted in 1.23+ to listed standard-library packages. | `runtime/stubs.go`, `time/sleep.go` (linking to `runtime.timeSleep`), `sync.runtime_*` helpers. |
| **`//go:notinheap`** | The annotated type must never be allocated on the heap; only on the stack, in globals, or in manually-managed memory. Used for runtime-internal structures that must not be GC-scanned. | `runtime/mheap.go` (`mspan`, `mcentral`), `runtime/mfixalloc.go`. |

Other pragmas seen in the source: `//go:noinline`, `//go:noescape`, `//go:norace`, `//go:nocheckptr`, `//go:uintptrescapes`. Each has a precise effect on code generation; the runtime uses them deliberately and any reader who treats them as decoration will misread the surrounding code.

The 1.23 release added the `//go:linkname` restriction proposal (https://go.dev/issue/67401), which limits which packages may link to runtime internals. The runtime team retains the right to rename or remove unexported symbols; the explicit allowlist documents the dependency.

Reading pragma-heavy code requires holding two models at once: what the function does at the Go level, and what the pragma forbids the compiler from doing around the call. A `//go:nosplit` function calling another `//go:nosplit` function is fine; calling a normal Go function from a `//go:nosplit` context risks a stack overflow that the compiler will not catch beyond a small budget (`StackLimit`, currently 800 bytes). The runtime's CI includes a `nosplit` analyzer that walks call graphs to enforce this; readers should trust it but understand the rule.

---

## 7. The "internals can change" rule, with examples

The runtime team exercises the "internals are not stable" provision of the compatibility promise regularly. Each of these changes rewrote core runtime structures without breaking the published API:

| Release | Change | Proposal / commit |
|---------|--------|--------------------|
| **1.5 (2015)** | Concurrent mark-and-sweep GC replaces stop-the-world collector; sub-millisecond pauses become the goal. | https://go.dev/blog/go15gc |
| **1.8 (2017)** | Hybrid write barrier replaces Dijkstra-style barrier; stack rescanning eliminated; pause times drop to ~100 microseconds. | https://go.dev/issue/17503 |
| **1.14 (2020)** | Asynchronous preemption via signals; tight loops no longer block the scheduler indefinitely. | https://go.dev/issue/24543 |
| **1.18 (2022)** | Generics; runtime gains `runtime/internal/sys` adjustments and itab caching changes. | https://go.dev/issue/43651 |
| **1.19 (2022)** | Soft memory limit (`GOMEMLIMIT`); GC tunes itself against a memory budget rather than only a heap-growth ratio; typed atomics in `sync/atomic`. | https://go.dev/issue/48409 |
| **1.21 (2023)** | Per-P timer heaps replace the central timer wheel; timer operations no longer contend on a global lock. | https://go.dev/issue/56295 |
| **1.22 (2024)** | Method-aware `net/http.ServeMux` rewrite; loop variable scoping change (compiler, but runtime-adjacent). | https://go.dev/issue/61410 |
| **1.24 (2025)** | Swiss-table-based map implementation replaces the historical bucketed-hash map; iteration order, growth thresholds, memory layout all changed. | https://go.dev/issue/54766 |

Each rewrite passed the compatibility test because the published behaviour — `m[k]` returns the right value, `<-ch` blocks correctly, `defer` runs in LIFO order — was preserved. Tools that scraped goroutine stack dumps, profilers that hardcoded offsets into runtime structures, and debuggers that read `mspan` fields directly all had to be updated. Programs that stayed inside the public API did not.

The reading consequence: a source file checked out at `master` may differ substantially from the same file at the most recent release tag. A senior reader always notes the Go version when citing runtime behaviour. "The scheduler does X" is meaningless without "as of Go 1.23"; the next release may do Y. The `go version` of the toolchain and the source tag of the standard library are the same thing, but only at release boundaries — between releases, `master` diverges from any tagged version.

---

## 8. Authoritative source files map

The runtime source lives in `src/runtime/` of the Go repository (https://github.com/golang/go/tree/master/src/runtime). The files a senior reader returns to repeatedly:

| File | Contents |
|------|----------|
| **`runtime2.go`** | Core type definitions: `g` (goroutine), `m` (OS thread / machine), `p` (processor / scheduling context), `sudog` (waiter on channel/lock), `mutex`, `note`, `gobuf`, `stack`. The data model of the runtime. |
| **`proc.go`** | The scheduler: `schedule`, `findrunnable`, `execute`, `goschedImpl`, work-stealing, GMP transitions, parking and unparking. The largest single runtime file. |
| **`mgc.go`** | Garbage collector entry points and orchestration: `gcStart`, `gcMarkTermination`, `gcSweep`, phase transitions, GC pacer integration. |
| **`mgcmark.go`** | Mark phase implementation: root scanning, work queues, mark workers, write-barrier-buffer drain. |
| **`mgcsweep.go`** | Sweep phase: span sweeping, free-list rebuilding, background sweeper goroutine. |
| **`mgcpacer.go`** | The GC pacer: heap-growth controller, assist credit, trigger calculation. |
| **`malloc.go`** | Allocator entry points: `mallocgc`, size class selection, mcache fast path, large-object path. |
| **`mheap.go`** | Heap data structures: `mheap`, `mspan`, span allocation, page allocator (`mpagealloc.go` since 1.14). |
| **`mcache.go`** / **`mcentral.go`** | Per-P allocation caches and central span lists; the middle tiers of the allocator. |
| **`chan.go`** | Channel implementation: `hchan` struct, `chansend`, `chanrecv`, `closechan`, `selectgo` (with `select.go`). |
| **`select.go`** | `selectgo`: the runtime support for `select` statements; case ordering, lock acquisition, random selection. |
| **`panic.go`** | `panic`, `recover`, `gopanic`, `gorecover`, deferred function chain walking, `_panic` and `_defer` structs. |
| **`map.go`** / **`map_swiss.go`** | Map implementation; from 1.24 Swiss tables live in `internal/runtime/maps/`. |
| **`time.go`** | Timer wheel; per-P timer heaps since 1.21; `addtimer`, `deltimer`, `runtimer`. |
| **`signal_unix.go`** / **`signal_windows.go`** | Signal handling; preemption signals (`SIGURG` since 1.14), crash signal forwarding. |
| **`asm_amd64.s`** / **`asm_arm64.s`** | Architecture-specific assembly: `gogo`, `mcall`, `morestack`, `systemstack`, syscall trampolines. |
| **`stack.go`** | Stack growth: `morestack` handler, stack scanning during GC, stack shrinking. |
| **`cgocall.go`** | The cgo bridge: Go-to-C and C-to-Go transitions, `LockOSThread` integration. |
| **`netpoll.go`** | The network poller: integrates with kqueue/epoll/IOCP; the runtime-side of non-blocking I/O. |
| **`trace.go`** / **`traceback.go`** | Execution tracer; stack unwinding for panics, profiling, and tracebacks. |
| **`mbarrier.go`** | Write barriers: hybrid barrier implementation; buffered write-barrier flushing. |
| **`runtime-gdb.py`** | GDB pretty-printers for runtime types; useful as documentation of struct layout. |

A first-pass reading touches `runtime2.go`, then `proc.go`, then `chan.go` and `panic.go`. A second pass goes through the GC stack (`mgc.go`, `mgcmark.go`, `mgcpacer.go`, `mbarrier.go`). A third pass covers the allocator (`malloc.go`, `mheap.go`, `mcache.go`).

Supporting files less central but worth knowing:

| File | Contents |
|------|----------|
| **`HACKING.md`** | Conventions, vocabulary, the GMP state machine in prose. The single highest-leverage runtime document; read once front to back. |
| **`mprof.go`** | Heap and goroutine profile collection backing `runtime/pprof`. |
| **`mfinal.go`** | Finalizer registration and execution; the goroutine that runs finalizers. |
| **`mgcwork.go`** | The GC work queue (work buffers, dispatcher). |
| **`stkframe.go`** | Stack frame walking used by GC, traceback, and the race detector. |
| **`os_linux.go` / `os_darwin.go` / `os_windows.go`** | Per-OS implementations of thread creation, signal masks, futex/semaphore wrappers, page allocation. |
| **`mem_linux.go` / `mem_darwin.go`** | Per-OS memory mapping (`sysAlloc`, `sysFree`, `sysReserve`, `sysMap`); the surface the allocator calls. |
| **`error.go`** | Runtime error types (`runtime.Error`, `runtimeError`, `TypeAssertionError`); the source of panic messages users see. |
| **`iface.go`** | Interface conversion machinery (`getitab`, type assertions, `convT*` helpers); used on every interface boxing. |
| **`map_fast32.go` / `map_fast64.go` / `map_faststr.go`** | Specialized map paths for common key types; replaced by the Swiss-table implementation in 1.24. |

The pre-1.24 map files are still in the tree for legacy build-tags and serve as a study in how a runtime subsystem ages out of relevance gradually.

---

## 9. GODEBUG knobs for runtime reading

`GODEBUG` is the environment variable that toggles runtime instrumentation and behavioural switches. The reading-relevant settings:

| Setting | Effect |
|---------|--------|
| **`gctrace=1`** | Prints a one-line summary per GC cycle: phase wall times, heap sizes before/after, goal, CPU fraction. The cleanest external view of GC behaviour. |
| **`schedtrace=N`** | Every N milliseconds, prints scheduler state: number of Ps, Ms, Gs, run queue lengths, idle Ps. Best knob for observing scheduler dynamics from outside. |
| **`scheddetail=1`** | With `schedtrace`, expands the trace to per-P and per-M lines; high-volume output but the only way to see work-stealing in real time. |
| **`asyncpreemptoff=1`** | Disables 1.14 async preemption; useful for confirming whether a hang is preemption-related and for reading code paths as they existed before 1.14. |
| **`gccheckmark=1`** | Enables full-stop GC mark to verify concurrent marking found everything; very slow; used by runtime developers to catch missed pointers. |
| **`gcstoptheworld=1` / `=2`** | Forces stop-the-world GC (=1) or stop-the-world without parallel sweep (=2); turns off concurrent collection for diagnostic purposes. |
| **`madvdontneed=1`** | Uses `MADV_DONTNEED` for returning memory to the OS instead of `MADV_FREE`; reverses a 1.12 change that hurt some monitoring tools. |
| **`panicnil=1`** | Restores pre-1.21 behaviour where `panic(nil)` produced an unrecoverable nil panic; the 1.21 default raises a runtime error instead. |
| **`tracefpunwindoff=1`** | Disables frame-pointer-based unwinding in the execution tracer; falls back to gopclntab walking. |
| **`invalidptr=1`** | Crashes on detection of an invalid pointer in a GC-scannable location; otherwise silently continues. |
| **`allocfreetrace=1`** | Traces every allocation and free; produces enormous output; for runtime debugging only. |

The full table lives at https://pkg.go.dev/runtime#hdr-Environment_Variables. New knobs are added per release; the `GODEBUG` history file `src/runtime/HACKING.md` and the release notes track them.

Two structural points about GODEBUG worth knowing while reading the source:

- Each setting is parsed once at program start by `parsedebugvars` in `runtime1.go`; runtime code reads the resulting struct (`debug.gctrace`, `debug.schedtrace`) rather than re-parsing the environment. Adding a new knob means adding a field to that struct.
- Since 1.21, `GODEBUG` also gates *behavioural* defaults that change between releases. A program built with Go 1.21 honours `panicnil=1` (restoring old behaviour); a program built with Go 1.20 ignores it because the new behaviour does not exist there. The `go.mod` `go` directive influences which defaults apply, via `runtime/internal/godebug`.

---

## 10. Environment variables

The runtime reads a small set of environment variables at process startup:

| Variable | Default | Purpose |
|----------|---------|---------|
| **`GOGC`** | `100` | Heap growth percentage that triggers GC; `100` means GC when heap doubles since last live size. `off` disables GC; high values reduce GC CPU at memory cost. |
| **`GOMEMLIMIT`** | `math.MaxInt64` | Soft memory limit in bytes; GC runs more aggressively as memory approaches the limit; `off` or omitted disables; added 1.19. |
| **`GOMAXPROCS`** | `runtime.NumCPU()` | Maximum simultaneously executing goroutines; cap on the number of Ps. Runtime-adjustable via `runtime.GOMAXPROCS`. |
| **`GODEBUG`** | empty | Comma-separated knobs; see section 9. |
| **`GOTRACEBACK`** | `single` | Traceback verbosity on crash: `none`, `single`, `all`, `system`, `crash`. Controls how much stack is printed. |
| **`GOROOT`** | install path | Root of the Go installation; consulted by the runtime when formatting tracebacks that reference standard-library source files. |
| **`GOOS` / `GOARCH`** | build-time | Reported by `runtime.GOOS` and `runtime.GOARCH`; not read at runtime but baked in. |

Beyond these, `cgo` adds `CGO_*` variables, and the linker honours `GOFLAGS` and `GO_LDSO`. The runtime proper reads only the seven above.

Reading the env-var parsing in `runtime/proc.go` (`schedinit` and friends) is short and instructive: the runtime calls `gogetenv` (its own copy of `os.Getenv` that does not allocate) at startup, parses each known variable, applies bounds, and stores the result in package-level globals. Any later read by runtime code goes to the global, not the environment. Setting `GOGC` after startup via `os.Setenv` has no effect; the supported path is `debug.SetGCPercent`.

---

## 11. Notable proposals as architecture-shaping changes

The proposal archive (https://github.com/golang/proposal) is the design record of major runtime changes. The proposals every runtime reader should know:

| Proposal | Title | Outcome |
|----------|-------|---------|
| **#24543** | Non-cooperative goroutine preemption | Async preemption via `SIGURG`; landed in 1.14. Before this, a tight loop with no function calls could block the scheduler. |
| **#48409** | Soft memory limit | `GOMEMLIMIT`; landed in 1.19. Lets services bound memory without disabling GC. |
| **#51317** | Memory arenas (experimental) | Manual memory regions for batched allocation/free; experimental in 1.20–1.22; not stabilised; lessons fed into other allocation work. |
| **#54766** | Swiss tables for map | Rebuilt map on Swiss-table layout; landed in 1.24. Faster lookups, different memory behaviour, no API change. |
| **#56295** | Per-P timer heaps | Replaced central timer wheel with one heap per P; landed in 1.21. Eliminated scheduler-wide timer lock contention. |
| **#11193** | Goroutine-local storage | Rejected; the absence of GLS is a design choice the runtime maintains. |
| **#36365** | Cooperative goroutine cancellation | Rejected in favour of `context.Context`; the runtime does not own cancellation. |
| **#37116** | Hard memory limit (rejected variant) | The original "hard limit" form was rejected; the soft-limit shape of #48409 was the workable design. |
| **#43930** | Profile-guided optimization | Runtime-adjacent; PGO landed 1.20; affects inlining and indirectly the runtime's interaction with compiled code. |
| **#44313** | Generics implementation strategy | Affected runtime via `itab` shape, method-set caching, and `reflect` changes; landed with 1.18. |

Each proposal contains the design rationale, the rejected alternatives, and the implementation plan. Reading the proposal for a feature before reading the code that implements it cuts source-reading time roughly in half because the proposal explains *why* the chosen shape exists.

The proposal archive is also where one finds the design documents that the runtime team treats as more durable than the code. `design/17503-eliminate-rescan.md` (the hybrid write barrier) and `design/24543-non-cooperative-preemption.md` (async preemption) are detailed enough to substitute for a textbook chapter on their respective subsystems. The corresponding source files in `src/runtime/` are the implementation of these documents; reading them in the reverse order — code first, design after — works, but takes longer and risks confusing implementation choices for fundamental design.

---

## 12. Source code conventions

The runtime source has internal conventions that differ from idiomatic application Go. A reader who applies application-level expectations will misread the code:

| Convention | Detail |
|-----------|--------|
| **Capital-letter constants** | Runtime constants are spelled in all-caps with underscores (`_Gidle`, `_Grunnable`, `_Grunning`, `_MaxGcproc`); leading underscore signals "runtime-internal, not exported even though it would be by Go's rules". |
| **`_G` / `_P` / `_M` prefix** | State enums prefix with the entity letter: `_Grunning` (goroutine state), `_Pidle` (processor state), `_Mspinning` (M state). The prefix is namespacing inside `package runtime`. |
| **Struct field ordering for cache padding** | Hot structs (`p`, `m`, `g`) order fields by access frequency and cache-line boundaries; explicit `pad cachelinepadsize` fields prevent false sharing. The ordering is load-bearing and must not be reshuffled for aesthetics. |
| **Pointer-bitmap-tracked types** | Runtime-internal types that hold pointers but live outside the heap (`mspan`, `mcentral`) use `//go:notinheap` and manage their own pointer tracking. |
| **Atomic types since 1.19** | The runtime migrated hot fields to `atomic.Uint32`, `atomic.Uint64`, `atomic.Pointer[T]`. Older code paths still use `atomic.Load32(&field)` against a `uint32` field; both forms appear in the same file. |
| **Assembly for hot paths** | Trampolines, save/restore of register state, syscall entry, and `gogo`/`mcall` are written in Plan 9 assembly (`asm_*.s`). The assembly is the source of truth; the Go wrappers are stubs. |
| **`gp := getg()` idiom** | Functions that need the current goroutine call `getg()` once at the top; the variable is named `gp` consistently across the runtime. |
| **`mp := acquirem(); ...; releasem(mp)` idiom** | Code that must not be preempted between two statements pins to the current M. The acquire/release pair is the runtime's equivalent of an application's lock. |
| **`throw` for unrecoverable** | Runtime-internal "this should never happen" calls `throw(msg)`, which produces a runtime fatal error and core dump; not recoverable, distinct from `panic`. |
| **`print` and `println` (lowercase)** | Builtin functions defined in `print.go`; used by the runtime when `fmt` is not safe to call (during GC, signal handlers, early init). Do not confuse with `fmt.Print`. |

The runtime's `HACKING.md` (https://github.com/golang/go/blob/master/src/runtime/HACKING.md) documents many of these conventions explicitly and should be read once end-to-end before any sustained source dive.

A consequence worth internalising: most runtime functions are *not* meant to be called from arbitrary contexts. They expect to be on a specific stack (g0 or a user goroutine), to be running with a specific M state (spinning, idle, syscall), or to be invoked only while holding a specific lock (`sched.lock`, `mheap_.lock`). The function's preconditions are documented in the comment above the function, sometimes in a `// runtime/HACKING.md` cross-reference, sometimes only in the precondition asserted by a `throw` inside the function body. A reader who skips comments will misread the code; the comments are not decoration but the contract that the body assumes.

---

## 13. Reading order recommendation

A senior path through the runtime source, in ten steps:

1. **Read `HACKING.md` once.** Conventions, state machine vocabulary, the meaning of `getg`, `acquirem`, `systemstack`. https://github.com/golang/go/blob/master/src/runtime/HACKING.md
2. **Read `runtime2.go` cover to cover.** Get the data model in your head: `g`, `m`, `p`, `sudog`, `stack`, the state enums.
3. **Read `proc.go`'s `schedule`, `findrunnable`, `execute`, `park_m`, `goready`.** This is the scheduler's hot loop.
4. **Read `chan.go`.** A small, complete subsystem; `chansend`, `chanrecv`, `closechan`, the `sudog`-queue dance. Excellent first deep dive.
5. **Read `panic.go`.** `gopanic`, `gorecover`, defer chain walking, `runtime.Goexit`.
6. **Read the GC entry points.** `mgc.go` `gcStart` and the phase transitions; `mgcpacer.go` to understand the trigger.
7. **Read the allocator fast path.** `malloc.go` `mallocgc`; trace one allocation from the mcache through to mheap.
8. **Read `time.go` (with 1.21+ per-P heaps).** Smaller than the scheduler, larger than channels; teaches how the runtime composes lock-free per-P state with a global fallback.
9. **Read `signal_unix.go` plus `asm_*.s` preemption paths.** The hardest material; understand how `SIGURG` becomes a goroutine state transition.
10. **Read one cgo path end-to-end.** `cgocall.go` plus the generated `_cgo_gotypes.go`; this is the boundary between runtime and external code and exercises every previous chapter.

After step 10, the rest of the runtime is variations on themes already encountered.

Two reading aids that pay back tenfold their setup cost:

- **Build a local Go tree and tag-switch.** `git clone https://github.com/golang/go && cd go && git checkout go1.20.14`; then compare `proc.go` against `master`. Diffing two releases of the same file is the fastest way to learn what changed and why.
- **Wire up `dlv` against a tiny program.** A six-line program that creates a goroutine and waits, stepped through under Delve with `runtime.*` breakpoints, makes the GMP transitions concrete in a way that source alone cannot. The `runtime` package is `optimize=false` aware; `go build -gcflags 'all=-N -l'` makes runtime frames visible to the debugger.

---

## 14. Bug reporting and the proposal process

Runtime issues are reported at https://github.com/golang/go/issues with the `runtime` label. The triage workflow:

| Label | Meaning |
|-------|---------|
| **`NeedsInvestigation`** | Reproducer present, behaviour not yet explained. |
| **`NeedsFix`** | Cause known, fix not yet written. |
| **`NeedsDecision`** | Behaviour is by design or a change requires policy decision; awaiting team discussion. |
| **`WaitingForInfo`** | More information needed from reporter. |
| **`Proposal`** | Behaviour change that affects users; requires going through the proposal process. |

Behaviour changes — adding a `GODEBUG` setting, changing default `GOGC`, modifying scheduler heuristics that affect observable timing — typically require a proposal. The proposal process is documented at https://github.com/golang/proposal/blob/master/README.md:

1. File an issue under the `Proposal` label with a short problem statement.
2. The proposal review committee (a rotating subset of the Go team) triages weekly; minutes appear in https://github.com/golang/go/issues with the `proposal-minutes` label.
3. For non-trivial changes, a design document under `golang/proposal/design/` is written.
4. After discussion, the committee accepts, declines, or requests revisions.
5. Accepted proposals are implemented under the original issue and linked from the release notes.

Runtime-specific bugs that may be security-sensitive — race detector defeats, memory corruption, signal-handler reentrancy — go through https://go.dev/security/policy rather than the public tracker.

A senior reporter for a runtime issue includes:

| Element | Purpose |
|---------|---------|
| **`go version`** output | Pins the toolchain; runtime behaviour differs between releases. |
| **`go env`** output | Pins `GOOS`, `GOARCH`, `GOMAXPROCS`, `GODEBUG`, `GOGC`, `GOMEMLIMIT`. |
| **Minimal reproducer** | Standalone program; runs without external services; demonstrates the bug deterministically or with a documented probability. |
| **Observed vs expected** | What the program did, what the spec or godoc says it should have done; the gap is the bug. |
| **Stack traces** | Full goroutine dump from `SIGQUIT` (`GOTRACEBACK=all`) or programmatic `runtime.Stack`; large dumps go in a gist or attachment. |
| **`gctrace=1` / `schedtrace=1000` output** | When the bug is suspected to involve GC or scheduling, the trace output is the runtime's own self-report. |

Runtime maintainers prioritise reproducers and traces over prose descriptions. A perfect description without a reproducer often languishes; a reproducer without prose is fixed quickly.

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| **G** | Goroutine; a unit of concurrent execution; struct `g` in `runtime2.go`; carries stack, state, scheduling info. |
| **M** | Machine; an OS thread running Go code; struct `m`; binds to a P to execute Gs. |
| **P** | Processor; a scheduling context that holds a run queue of Gs; `GOMAXPROCS` sets the count. |
| **GMP** | The scheduler's three-entity model; G needs P needs M to run; the runtime's central abstraction. |
| **sudog** | A goroutine *waiting* on a channel, mutex, or other rendezvous; allocated from a per-P cache; freed when the wait completes. |
| **systemstack** | The per-M g0 stack used for scheduler internals and signal handling; switching to it is the `//go:systemstack` pragma's job. |
| **morestack** | The assembly handler called when a function's prologue detects insufficient stack; grows the goroutine stack and resumes. |
| **gogo / mcall** | Low-level context switch primitives; `gogo(buf)` resumes a saved register set; `mcall(fn)` switches to g0 and calls fn. |
| **write barrier** | A compiler-inserted call before a heap pointer write; informs the GC of the new edge; runtime side lives in `mbarrier.go`. |
| **mspan** | A contiguous run of heap pages owned by the allocator; the unit of allocation in `mheap`. |
| **mcache** | Per-P allocator cache; holds free objects for hot size classes; refilled from `mcentral`. |
| **mcentral** | Process-wide central cache of spans by size class; bridges `mcache` and `mheap`. |
| **netpoller** | The runtime's epoll/kqueue/IOCP integration; parks goroutines waiting on file descriptors and wakes them on readiness. |
| **GODEBUG knob** | An environment-variable-controlled runtime switch; documented per release; the user-facing edge of runtime tuning. |
| **Pragma** | A `//go:` directive that the compiler honours; controls inlining, escape analysis, stack splitting, link names. |
| **Proposal** | A documented behaviour change reviewed by the Go proposal committee; the formal mechanism for non-trivial runtime evolution. |
| **Hybrid write barrier** | The 1.8 write-barrier design that shaded both the overwritten pointer and the new pointer; eliminated the stack rescan and dropped GC pauses to ~100us. |
| **Async preemption** | The 1.14 mechanism that delivers `SIGURG` to a running goroutine and rewrites its program counter so the next safe point yields to the scheduler. |
| **Swiss table** | The 1.24 map implementation; a flat probe table with SIMD-friendly metadata; replaced the bucketed-hash design. |
| **Per-P timer heap** | The 1.21 timer structure where each P owns its own min-heap; replaces the central timer wheel. |
| **`g0`** | The system stack per M; runs scheduler code, signal handlers, and anything marked `//go:systemstack`. |
| **`throw`** | The runtime's "fatal, not recoverable" exit; produces a crash with a traceback; used for assertions inside the runtime itself. |
| **PGO** | Profile-guided optimization; landed 1.20; affects inlining decisions in the compiler and indirectly runtime performance. |

The runtime source rewards readers who hold three references open simultaneously: the language spec, the memory model, and the proposal that introduced the subsystem under study. The source itself is precise but terse; the surrounding documents supply the contract and the rationale that make the precision useful.

A final perspective. The runtime is a moving target precisely because it has no specification. Each Go release rewrites some part of it; each rewrite improves performance or simplifies a previously delicate invariant; each is invisible to programs that stay inside the published API. The senior reader internalises this — the source is what the runtime is *today*; the contract is what the language promises *forever* — and reads accordingly. Source citations come with version tags. Behavioural claims come with spec or memory-model references. Performance numbers come with the toolchain version that produced them. Without these qualifications, a runtime claim ages out as soon as the next release ships, and the reader who made the claim becomes the source of a subtle bug somewhere downstream.
