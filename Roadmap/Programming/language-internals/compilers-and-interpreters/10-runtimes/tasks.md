# Runtimes (Language Runtime Support) — Hands-On Tasks

> **Topic:** [Runtimes (Language Runtime Support)](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I have heard
the word runtime" to "I can read what the compiler emits against a runtime,
reason about GC and scheduling costs, and reproduce the async-to-state-machine
transform by hand." Every task is small enough to fit into one or two focused
sessions, and they build on one another. The point is rarely the code you
type — it is the *runtime artifact* the code reveals: an allocation call, a
write barrier, a stack copy, a state machine, a cold start.

How to use this file: read the task, do the work, run it (under a profiler,
disassembler, or `GODEBUG`/tracer whenever possible), and only then check the
hints. Mark the self-check boxes when you can *explain the result to someone
else*, not when the program merely compiles. The sample solutions are
intentionally sparse — they appear only where the canonical answer is more
instructive than your first attempt would be.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)
- [Related Topics](#related-topics)

---

## Warm-Up

These tasks make the runtime *visible*. They are short, but each one surfaces a
service the compiler emitted against — and that you usually never see.

### Task 1: Weigh the runtime

**Problem.** Write the same "hello world" in three languages — Go, C, and Rust
— compile each to a native binary, and record the binary sizes. Then explain
the spread.

**Constraints.**
- Compile release/optimized builds (e.g. `go build`, `cc -O2`, `cargo build --release`).
- For C, note whether `libc` is dynamically or statically linked.
- Strip symbols (`strip`) and record sizes again.

**Hints (try without first).**
- The Go binary will be ~1–2 MB; the C binary ~16 KB; Rust somewhere between.
- The Go size is the statically-linked runtime (GC + scheduler + reflection).
- The C binary is small because `libc` lives outside it (dynamic link). Try
  `cc -static` and watch the C binary balloon — that's libc baked in.

**Self-check.**
- [ ] You can attribute the Go binary's size to specific runtime subsystems.
- [ ] You can explain why static vs dynamic linking changes the C size so much.
- [ ] You can state the deployment trade-off the Go choice buys.

---

### Task 2: Prove code runs before `main`

**Problem.** Write a program with a static initializer (a package-level
variable initialized by a function call and/or an `init()` in Go; a global
constructor in C++) that prints a message, and confirm it runs *before* `main`.

**Constraints.**
- The initializer must do observable work (print, or set a timestamp).
- `main` must also print, so you can see the order.

**Hints (try without first).**
- In Go, package-level `var x = f()` and `init()` run during bootstrap.
- The print from the initializer appears *before* the print in `main`.
- Now make the initializer slow (e.g. `time.Sleep(500ms)` or build a big
  table). Time the program — that latency is paid before `main`.

**Self-check.**
- [ ] You observed initializer output before `main` output.
- [ ] You can explain why heavy static init hurts startup/cold-start latency.
- [ ] You know how to make such work lazy instead.

---

### Task 3: Find the hidden allocation call

**Problem.** In Go, write two functions: one that returns a value (`int` or a
small struct *by value*) and one that returns a pointer to a local. Use the
compiler to show which one allocates on the heap.

**Constraints.**
- Use `go build -gcflags='-m'` (add a second `-m` for more detail).
- Make the functions `//go:noinline` so inlining doesn't hide the result.

**Hints (try without first).**
- The compiler prints `moved to heap` / `escapes to heap` for the pointer case.
- The by-value case stays on the stack: no runtime allocation, no GC work.
- This is **escape analysis** deciding stack vs heap — and thus whether the
  compiler emits an allocator call at all.

**Self-check.**
- [ ] You can point at the exact line the compiler says escapes.
- [ ] You can rewrite an escaping function to keep its value on the stack.
- [ ] You can explain the GC consequence of each choice.

---

### Task 4: A million goroutines

**Problem.** Spawn 1, 10,000, 100,000, and 1,000,000 goroutines (each doing a
trivial amount of work), and measure memory and creation time for each count.

**Constraints.**
- Use `sync.WaitGroup` to join them.
- Measure memory with `runtime.ReadMemStats` and time with `time.Now()`.

**Hints (try without first).**
- A million goroutines is fine; a million OS threads would not be.
- Per-goroutine memory is small (KB-scale) because stacks start at 8 KB and
  grow only on demand.
- Now try the same with OS threads in C (`pthread_create`) and find the count
  at which it fails — contrast the limits.

**Self-check.**
- [ ] You can state the approximate per-goroutine memory cost you measured.
- [ ] You can explain why goroutines scale where OS threads don't (M:N +
      growable stacks).

---

## Core

These tasks make you reason about the compiler/runtime *contract* — barriers,
safepoints, stacks, and scheduling — with measurements.

### Task 5: Force a stack copy

**Problem.** Write a deeply recursive Go function whose frames are large (e.g.
each frame holds a multi-KB local array). Run it and confirm the runtime grew
(copied) the goroutine's stack.

**Constraints.**
- The recursion depth × frame size must exceed the initial 8 KB stack many
  times over.
- Print something at the base case so the compiler can't optimize it all away.

**Hints (try without first).**
- Each function prologue checks the stack guard; on overflow it calls
  `runtime.morestack`, which allocates a bigger stack and **copies** the old one.
- You can observe growth indirectly with `GODEBUG=...` stack traces or by
  reasoning about `StackInuse` from `ReadMemStats` before/after.
- Ask yourself: how does the runtime fix up pointers into the moved stack?
  (Answer: compiler-emitted stack maps.)

**Self-check.**
- [ ] You can explain what the prologue check does and when it calls `morestack`.
- [ ] You can explain why copying stacks requires stack maps.
- [ ] You can describe the cost of pathological deep recursion (repeated copies).

---

### Task 6: Watch the garbage collector

**Problem.** Write a Go program that allocates heavily in a loop (e.g. creates
short-lived slices/maps), and run it with `GODEBUG=gctrace=1`. Then reduce its
allocation rate and observe the change in GC activity.

**Constraints.**
- Version A: allocate a fresh buffer every iteration.
- Version B: reuse one buffer (or a `sync.Pool`).
- Compare GC frequency and the pause information in the gctrace output.

**Hints (try without first).**
- `gctrace=1` prints a line per GC cycle: heap sizes, and stop-the-world times.
- Version B should trigger far fewer GC cycles — fewer allocations means less
  for the GC to do.
- Try changing `GOGC` (e.g. `GOGC=200`) and observe fewer, larger collections.

**Self-check.**
- [ ] You can read a `gctrace` line and identify the stop-the-world phases.
- [ ] You can show that reducing allocations reduces GC work.
- [ ] You can explain the `GOGC` memory-vs-frequency trade-off.

---

### Task 7: See the write barrier in the disassembly

**Problem.** Write a Go function that stores a pointer into a heap object's
field, and inspect the generated assembly to find the **write barrier** code.

**Constraints.**
- Use `go build -gcflags='-S'` (or `go tool objdump`) on the function.
- The field write must be a *pointer* into the heap (not an integer).

**Hints (try without first).**
- Look for a load of `runtime.writeBarrier` and a conditional branch around a
  call to `runtime.gcWriteBarrier`.
- The fast path (GC not marking) is a load + a predicted-not-taken branch, then
  the plain store.
- Now write a function that stores an `int` instead of a pointer — confirm
  there is **no** barrier (only pointer writes need it).

**Self-check.**
- [ ] You can point at the barrier check in the assembly.
- [ ] You can explain why only heap *pointer* stores get a barrier.
- [ ] You can explain the tri-color invariant the barrier protects.

---

### Task 8: Starve a cooperative scheduler

**Problem.** On a Go version *before* 1.14 (or by reasoning about it), construct
a goroutine with a tight `for {}` loop and no function calls while
`GOMAXPROCS=1`, and explain why other goroutines could starve. Then explain
what Go 1.14 changed.

**Constraints.**
- Set `runtime.GOMAXPROCS(1)`.
- The hot loop must contain no function calls, allocations, or channel ops.

**Hints (try without first).**
- Pre-1.14 preemption was *cooperative* — it only happened at call safepoints,
  which the tight loop never reaches.
- Go 1.14 added *asynchronous* preemption via signals (`SIGURG`), so the
  scheduler can interrupt even a call-free loop.
- This still relies on the compiler having emitted register maps so the signal
  point is safe to stop at.

**Self-check.**
- [ ] You can explain the difference between cooperative and asynchronous
      preemption.
- [ ] You can explain why a call-free loop defeated cooperative preemption.
- [ ] You can explain what compiler metadata makes async preemption safe.

---

## Advanced

These tasks reach the senior lowerings — the async state-machine transform,
unwinding, and runtime cost in production.

### Task 9: Hand-compile async to a state machine

**Problem.** Take an `async` function with **two** suspension points (in Rust,
C#, or as pseudocode) and write, by hand, the state machine the compiler would
generate: the discriminant (states) and the fields saved in each state.

**Constraints.**
- The function must have at least one local that is **live across** a
  suspension point (so it must be saved) and one that is **not** (so it isn't).
- Show the `poll`/`MoveNext` method as a `match`/`switch` on the discriminant.

**Hints (try without first).**
- The discriminant records *which `.await` we suspended at* (the resume point).
- A state's fields are exactly the locals live across that suspension point —
  use liveness reasoning to decide which.
- Suspension = `return Pending`; resumption = the next `poll` jumps to the
  right state. No call stack is saved — only the flat struct.

**Sample solution (sketch).**
For `async { let a = x().await; let b = a + 1; let c = y().await; b + c }`:
the live-across-await analysis shows `b` must be saved across the second await
(it's used after), but `a` is not (consumed into `b` before the await). States:
`Start`, `AwaitingX{}`, `AwaitingY{ b }`, `Done`. The `poll` loop matches on the
state, calls the inner future's `poll`, returns `Pending` on `Pending`, and on
the final `Ready` returns `b + c`. The key insight to articulate: **the saved
fields are determined by liveness, not by source order.**

**Self-check.**
- [ ] Your saved fields match exactly the locals live across each await.
- [ ] You can explain why this is "stackless" and how it differs from a goroutine.
- [ ] You can explain when the future becomes self-referential and why `Pin`
      exists.

---

### Task 10: Block the executor (and fix it)

**Problem.** In an async runtime (Rust + Tokio, or C# tasks, or Node), write an
async task that does *blocking* work (a synchronous sleep / blocking file read /
holding a non-async mutex across `.await`) and demonstrate that it stalls other
concurrent tasks. Then fix it.

**Constraints.**
- Run several concurrent tasks; one does the blocking work, others do quick work.
- Measure how the blocking task delays the others.

**Hints (try without first).**
- `.await` suspends the *task*; blocking work blocks the *thread* the executor
  is running on, stalling every task on that thread.
- Fixes: use the runtime's async sleep/IO, an async-aware mutex, or offload the
  blocking work to a dedicated blocking pool (`spawn_blocking` in Tokio).
- This is the stackless-land mirror of the "tight loop never yields" problem.

**Self-check.**
- [ ] You can explain the difference between suspending a task and blocking a
      thread.
- [ ] You can name the correct fix for each kind of blocking work.

---

### Task 11: Measure a cold start and attack it

**Problem.** Build the same small service two ways — a JIT-hosted runtime
(JVM or .NET default) and an AOT/thin one (GraalVM native-image, .NET
NativeAOT, or Go) — and measure the time from process start to first request
served. Then attribute the budget and apply one lever.

**Constraints.**
- Measure *true cold start* (fresh process), not warm latency.
- Attribute the budget into bootstrap / static init / (JIT warm-up) / first request.

**Hints (try without first).**
- JIT-hosted: bootstrap + class loading + warm-up dominate; expect hundreds of ms.
- AOT/thin: tens of ms — no JIT warm-up, smaller runtime.
- Apply a lever and re-measure: AOT (skip warm-up), lazy init (shrink static
  init), or a snapshot (skip bootstrap, e.g. SnapStart/CRaC if available).

**Self-check.**
- [ ] You can break the cold-start time into named line items.
- [ ] You can quantify the improvement from one lever.
- [ ] You can state which runtime profile fits a serverless workload and why.

---

### Task 12: Crash an FFI call, then pin it

**Problem.** In a managed runtime with a moving/compacting GC (.NET is easiest),
pass a managed array to a native function via a raw pointer **without** pinning,
under GC pressure, and observe the corruption. Then fix it with pinning.

**Constraints.**
- Trigger GC during/around the native call (allocate heavily on another thread).
- Version A: pass `AddrOfPinnedObject`-style pointer without keeping it pinned.
- Version B: pin with `fixed` or `GCHandle.Alloc(..., Pinned)`.

**Hints (try without first).**
- The moving GC can relocate the array mid-call, dangling the native pointer.
- Pinning keeps the object alive **and** immovable for the call's duration.
- Note the cost of long pins: they fragment the heap and impede compaction —
  keep pins as short as possible.

**Self-check.**
- [ ] You can explain why this only manifests under GC pressure ("under load").
- [ ] You can explain what pinning protects and its downside.
- [ ] You can generalize this to the "interop = invariant matching" idea.

---

## Capstone

### Task 13: Build a tiny embeddable runtime host

**Problem.** Embed a scripting runtime (Lua via its C API, or V8) into a host
program. The host must: create the runtime instance, register at least one
native "host function" callable from scripts, run an untrusted-ish script, and
tear the instance down — all with a memory cap and a way to terminate a runaway
script.

**Constraints.**
- One runtime instance = one sandbox (own heap/GC).
- Expose only the host functions you explicitly register (capability allowlist).
- Enforce a memory limit and a CPU/time watchdog.

**Hints (try without first).**
- Lua: `luaL_newstate` / `lua_register` / `luaL_dostring` / `lua_close`; use a
  custom allocator to cap memory and a debug hook to count instructions.
- V8: an `Isolate` with `max_old_generation_size`, a `Context`, a `HandleScope`,
  and `TerminateExecution` from a watchdog thread.
- Concurrency = multiple instances, not threads sharing one (these are
  single-threaded per instance).

**Self-check.**
- [ ] The host owns lifecycle and resources; the runtime owns only its sandbox.
- [ ] A script can call only the functions you exposed (and nothing else).
- [ ] A runaway script is terminated and an over-memory script is capped.
- [ ] You can explain why this is the edge-compute multi-tenancy model.

---

### Task 14: Write a one-page runtime comparison

**Problem.** Produce a one-page table comparing five runtimes — **Go**, the
**JVM**, the **CLR**, **V8/Node**, and the **BEAM** — across: memory model
(shared vs per-process heap), GC style, scheduling model, JIT vs AOT, startup
cost, and "what the compiler emits to cooperate." Then write two paragraphs:
which workload each is best for, and why.

**Constraints.**
- Every cell must be a concrete claim you can defend (no "fast"/"slow" without a
  mechanism).
- The "compiler emits" column must list real artifacts (barriers, stack maps,
  safepoints, state machines, etc.).

**Hints (try without first).**
- BEAM is the outlier: per-process heaps, per-process GC (no global STW),
  reduction-based preemption.
- Go: G-M-P, M:N, growable copying stacks, async preemption, defer-chain panic.
- JVM/CLR: bytecode → JIT → deopt; fat, warm-up tax; AOT options exist.
- V8: Isolate-per-sandbox; Node = V8 + libuv event loop.

**Self-check.**
- [ ] Every cell is defensible with a mechanism, not an adjective.
- [ ] Your workload recommendations follow from the table, not vibes.
- [ ] You can explain "you pay for a runtime" using your own table.

---

### Task 15: Reduce a service's runtime cost end-to-end

**Problem.** Take a real (or realistic) Go or JVM service and reduce its
**runtime cost** along two axes: allocation/GC pressure (steady-state) and
startup/cold-start. Document the before/after with measurements.

**Constraints.**
- For GC: profile allocations, eliminate the top offenders (escape analysis,
  pooling, preallocation), and show reduced GC activity and improved p99.
- For startup: move heavy static init to lazy init and/or apply AOT/snapshot,
  and show reduced time-to-first-request.
- Every change must be backed by a before/after measurement.

**Hints (try without first).**
- Use the heap profiler (pprof / async-profiler), `gctrace`/GC logs, and a
  cold-start timer.
- Don't tune knobs (`GOGC`, heap size) before reducing allocation rate — fix the
  cause first, then trade memory for frequency.
- Measure p99, not p50 — GC and safepoint effects live in the tail.

**Self-check.**
- [ ] You reduced allocation rate and showed a measurable GC/p99 improvement.
- [ ] You reduced time-to-first-request with a named lever.
- [ ] You can explain every change in terms of what the runtime does and what
      the compiler emits.

---

## Related Topics

- [Runtimes (Language Runtime Support)](README.md) — the hub for this topic.
- The **memory-management** section: the GC algorithms, barriers, and pinning
  these tasks exercise.
- The **runtime-systems** section: scheduler and stack-management internals from
  the runtime's own perspective.
- The **foreign-function-interface-and-interop** section: the FFI/pinning
  boundary in Task 12 and the embedding boundary in Task 13.
