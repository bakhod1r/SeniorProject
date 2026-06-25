# Stack Management & Unwinding — Professional Level

> **Topic:** [Stack Management & Unwinding](README.md)
> **Focus:** Stacks that move and grow — guard-page overflow detection, Go's copying goroutine stacks and stack maps, green-thread/coroutine stacks, GC root scanning, async logical stacks, and getting reliable profiles across a fleet.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)

---

## Introduction

> Focus: **What changes when a stack can grow, move, or belong to a million lightweight threads — and how do runtimes detect overflow, relocate live pointers, scan roots, and rebuild a logical stack after async hands the natural one away?**

Up to now the stack has been a fixed, OS-allocated region per thread, and unwinding meant walking it for backtraces, profiling, or exceptions. At the professional level the stack stops being a simple fixed block. A modern runtime may run *millions* of concurrent tasks — goroutines, green threads, coroutines, async futures — and giving each a full OS thread stack (often 8 MB of reserved address space) does not scale. So runtimes invent **small, growable stacks**. Go's goroutines start at a few kilobytes and *grow on demand*; the way Go grows them — **copying the whole stack to a larger block and relocating every pointer into it** — is one of the most instructive pieces of runtime engineering there is. It requires **stack maps**: precise metadata saying which slots at a given safepoint hold pointers, so the runtime can rewrite them after the move. That same precise-pointer metadata is what a **garbage collector** uses to scan stack roots.

Three other professional realities round this out. **Stack overflow** isn't a clean error at this layer — it's a **guard-page fault**: the kernel places an inaccessible page just past the stack, and touching it raises `SIGSEGV`, which the runtime must catch and translate into a stack-overflow report. **Async/await loses the natural call stack**: when a coroutine suspends, its caller chain unwinds back to the event loop, so a crash inside an awaited continuation has a backtrace that ends at the executor, not at the logical caller — and runtimes spend real effort reconstructing a *logical* async stack. And finally, **profiling a fleet** of FPO binaries is a recurring operational headache that's driving the whole industry back to `-fno-omit-frame-pointer`.

In one sentence: **at scale the stack becomes a managed, relocatable, precisely-described resource — and managing it well means knowing how growth, copying, pointer relocation, guard pages, root scanning, and async continuation chains actually work.**

> 🎓 **Why this matters for a professional:** These are the problems behind real incidents: a service that OOMs because a million goroutines each grew their stack; a `perf` profile that's useless because the binary omitted frame pointers; a "stack overflow" segfault that's actually unbounded recursion on user input; an async crash whose backtrace tells you nothing about the request that triggered it. Owning the runtime layer means owning these.

This page covers: guard pages and `SIGSEGV`-based overflow detection, thread stack-size limits, segmented vs contiguous copying stacks (and the "hot split" problem that made Go switch), stack maps and pointer relocation, GC root scanning, green-thread/coroutine stacks, async logical-stack reconstruction, tail-call frame reuse, and fleet-scale profilability.

---

## Prerequisites

- **Required:** The senior file — CFI/`.eh_frame`, two-phase unwinding, stack maps as a CFI cousin, FP vs DWARF vs LBR walking.
- **Required:** The middle file — frame layout, FPO, calling conventions.
- **Required:** Working knowledge of at least one runtime with lightweight tasks (Go goroutines, async/await, fibers).
- **Helpful:** Familiarity with virtual memory (pages, `mmap`, page faults, `SIGSEGV`).
- **Helpful:** A mental model of a tracing garbage collector and what "roots" are.

You do **not** need:

- Deep GC algorithm internals (covered in the garbage-collection topic; only the stack-root-scanning interface matters here).
- Scheduler implementation details beyond "tasks suspend and resume."

---

## Glossary

| Term | Definition |
|------|-----------|
| **Guard page** | An inaccessible page placed just past the stack's end. Touching it faults, signaling overflow. |
| **Stack overflow (real)** | Growing the stack into the guard page → `SIGSEGV`/`#PF`; the runtime translates it to a stack-overflow error. |
| **Thread stack size** | The per-thread reserved/committed stack region size (e.g. `pthread` default ~8 MB on Linux; tunable via `ulimit -s`, `pthread_attr_setstacksize`). |
| **Growable stack** | A task stack that expands on demand instead of being a fixed block. |
| **Segmented stack** | Growth by allocating a *new, discontiguous* chunk and linking it. Go's old approach; abandoned. |
| **Contiguous / copying stack** | Growth by allocating a *bigger* block, copying the old stack in, and relocating pointers. Go's current approach. |
| **Hot split** | Pathology of segmented stacks: a call near a segment boundary repeatedly allocates/frees a segment in a hot loop, thrashing. |
| **Stack map** | Per-safepoint metadata listing which stack slots / registers hold live pointers at that PC. |
| **Safepoint** | A program point where the runtime metadata (stack maps) is valid and the GC/scheduler may safely act. |
| **Pointer relocation** | Rewriting every pointer that targets the stack after the stack moves to a new address. |
| **GC root** | A starting pointer for tracing: globals, registers, and **live stack slots**. |
| **Green thread / fiber / coroutine** | A user-scheduled lightweight task with its own (often small) stack, multiplexed onto OS threads. |
| **Async logical stack** | The reconstructed chain of awaiting callers in an async program, which the *physical* stack no longer reflects. |
| **Stackful vs stackless coroutine** | Stackful: each coroutine has a real switchable stack. Stackless: state machine; no separate stack (e.g. Rust/C# async). |
| **`split-stack` (`-fsplit-stack`)** | GCC/LLVM feature for segmented growable stacks at the native level. |
| **Tail-call elimination (TCE)** | Replacing the current frame with the callee's instead of stacking a new one; enables unbounded tail recursion. |

---

## Core Concepts

### 1. Guard Pages: Overflow Is a Page Fault

A thread's stack region ends in a **guard page** — one (or several) page(s) mapped with no access. As the stack grows toward lower addresses, the first instruction that reads or writes into the guard page triggers a hardware page fault → `SIGSEGV` on Linux, an access violation on Windows. The runtime installs a handler that recognizes "the faulting address is in/near the guard region of the current thread's stack" and reports **stack overflow** rather than a generic segfault.

Two subtleties bite professionals:

- **The guard page must be big enough to *catch* the overshoot.** A single function with a huge local array can skip *over* a one-page guard in one stack adjustment, writing into valid memory beyond the guard — silent corruption instead of a clean fault. Compilers emit **stack probes** (`-fstack-clash-protection`) that touch each page as the frame grows, guaranteeing the guard is hit. This is also a security feature (stack-clash attacks).
- **The overflow handler runs in a constrained context.** You can't grow the stack to handle the stack-overflow signal, so handlers use an **alternate signal stack** (`sigaltstack`). Without it, the overflow handler itself faults.

### 2. Thread Stack Size Is a Real Resource

Each OS thread reserves address space for its stack (Linux default ~8 MB, tunable via `ulimit -s` or `pthread_attr_setstacksize`; the reservation is mostly lazy/uncommitted until touched). This is fine for dozens of threads and ruinous for millions. The reservation alone (even uncommitted) consumes address space and bookkeeping. **This single fact is why runtimes with massive concurrency cannot use OS thread stacks per task** — and why growable user-space stacks exist.

### 3. Segmented vs Copying Growable Stacks — and the Hot Split

If you want a million goroutines, each stack must start tiny (Go: 8 KB historically, now ~2–8 KB) and grow only as needed. Two strategies:

- **Segmented stacks (Go ≤ 1.2, `-fsplit-stack`).** When a function's prologue detects the current segment is nearly full, it allocates a *new, separate* chunk and links it. The stack becomes a linked list of segments. Simple in principle — but it has the **hot split** pathology: imagine a function call that sits right at a segment boundary inside a hot loop. Each iteration grows (allocate a new segment), returns (free it), grows again — allocating and freeing a segment every iteration, a catastrophic, hard-to-predict slowdown. Performance became a cliff that depended on *exactly where* in the stack a hot call landed.

- **Contiguous copying stacks (Go ≥ 1.3).** When the stack is nearly full, the runtime allocates a **single larger contiguous block** (typically double the size), **copies the entire old stack into it**, fixes up pointers, frees the old block, and continues. Growth is amortized O(1) per byte (geometric doubling), and — crucially — there is *no boundary* for a hot call to straddle, so the hot-split cliff disappears. The cost is the copy itself and the requirement to **relocate pointers** (next concept).

Go's move from segmented to copying stacks (Go 1.3, 2014) is the canonical case study in this whole topic: the segmented design was *elegant* but had an unpredictable performance cliff, and the "just copy it" design was *simpler to reason about* and faster in practice.

### 4. Copying Means Relocating Every Pointer Into the Stack

When the stack moves to a new address, every pointer that pointed *into the old stack* is now dangling. The runtime must find and rewrite them all: pointers in stack slots that point to other stack slots, pointers stored in registers at the moment of the move, and (in Go specifically) interior pointers and pointers handed to other goroutines. This is only possible because the runtime has **precise stack maps**: at the safepoint where growth happens, it knows *exactly* which slots and registers hold pointers and which hold integers. It rewrites each by adding `(new_base − old_base)`.

This is why Go requires **precise** GC and stack maps, and why it imposes rules like "you can't take the address of a stack variable and stash it somewhere the runtime can't track" without the variable *escaping to the heap*. Go's escape analysis decides, at compile time, whether a value can live on the (movable) stack or must go on the heap precisely so that the set of stack-internal pointers is statically known and relocatable. **Stack copying and escape analysis are two sides of the same coin.**

### 5. The Same Stack Maps Scan GC Roots

A tracing garbage collector starts from **roots**: global variables, registers, and *every live pointer on every thread's stack*. To scan a stack root-set precisely (without conservatively treating any integer-that-looks-like-a-pointer as one), the GC reads the **stack map** at each frame's safepoint PC: "slot +16 is a pointer, slot +24 is an int, slot +32 is a pointer." It walks frames (via frame pointers, CFI, or runtime-specific frame info), and at each one consults the map. Conservative collectors (e.g. Boehm) skip the map and scan everything that *might* be a pointer — simpler, but they can retain garbage (false pointers) and *cannot move objects* (they daren't rewrite a maybe-pointer). Precise stack maps are what enable a *moving*, *compacting* collector. (Full GC mechanics live in the garbage-collection topic; here the point is that **root scanning is a stack-walking problem solved with stack maps**.)

### 6. Green-Thread / Coroutine Stacks

Lightweight concurrency comes in two flavors with very different stack stories:

- **Stackful** (Go goroutines, traditional fibers, `ucontext`): each task owns a real, switchable stack. A context switch saves/restores SP and registers and swaps stacks. These can suspend *anywhere* (deep in a call chain) because the whole physical stack is preserved. Cost: each task needs a stack (hence growable/small stacks matter).
- **Stackless** (Rust `async`, C#/JS `async`, Python coroutines): the compiler transforms an `async fn` into a **state machine**; suspension points become states, and locals that live across an `await` are stored in a heap-allocated future object, not on a stack. There's no separate task stack at all — when the future runs, it runs on the *caller's* (executor's) stack. This is extremely memory-efficient (no reserved stacks) but means a task can only suspend at explicit `await` points, and the *physical* stack at any moment reflects the executor, not the logical async caller chain.

### 7. Async Loses the Natural Stack — and Runtimes Rebuild a Logical One

In a stackless async program, when you `await`, your function returns to the executor; the chain of "who awaited whom" is *not* on the physical stack anymore — it's encoded in the linked futures/continuations on the heap. So a crash or a profile inside an async continuation shows a physical backtrace that bottoms out at the **event loop / poll function**, not at the request handler that logically initiated the work. This is the infamous "useless async stack trace."

Runtimes fight this with **async logical stacks**: by recording the chain of awaiting tasks (parent continuation pointers), they can splice together a *logical* backtrace that crosses suspension points — e.g. Rust's `tracing`/task-dump facilities, .NET's async stack-trace reconstruction, Node's `async_hooks`/async stack traces, Python's `asyncio` task stacks. The physical unwinder gives you one segment; the runtime stitches the rest from continuation metadata. Designing observable async systems means *deliberately* capturing this context (trace/span propagation) rather than relying on physical backtraces.

### 8. Tail-Call Elimination Reuses the Frame

A **tail call** — a call in the return position — can reuse the current frame instead of pushing a new one: the callee returns directly to *our* caller. This makes deep tail recursion run in O(1) stack space (essential in functional languages; mandated in Scheme, opportunistic in LLVM/`musttail`, and explicit in WebAssembly's tail-call proposal). The consequence for *this* topic: the eliminated frame is genuinely **not on the stack**, so backtraces and unwinding correctly skip it. This is correct, but it surprises debugging ("my caller vanished") and can make some stack-overflow bugs *disappear* when optimization kicks in — and reappear at `-O0`.

### 9. Fleet-Scale Profilability: Why Frame Pointers Came Back

Operationally, the dominant pain is the senior-level `[unknown]` flame graph multiplied across thousands of machines. DWARF-based sampling is expensive (it copies and interprets the stack at every sample) and fragile in signal handlers; LBR is shallow and hardware-specific. Frame-pointer walking is cheap, deep, and signal-safe — at a ~1–2% steady-state cost. For continuous, always-on, fleet-wide profiling (the modern norm), that trade flipped: **major distributions and large operators re-enabled `-fno-omit-frame-pointer` by default** (Fedora and others, early 2020s) because *being able to profile every machine all the time* is worth more than 1%. This is the practical climax of the whole topic: a decade-old optimization was reverted because *observability* became the dominant concern.

---

## Real-World Analogies

- **Copying stacks are "moving to a bigger apartment."** When you outgrow the studio, you don't bolt on a shed in another part of town (segmented — and now your stuff is scattered and you trip over the seam). You rent a bigger place and *move everything*, updating your address with everyone who has it (pointer relocation). More work up front, no awkward seams.

- **The hot split is a "revolving door at a doorway you keep crossing."** If your desk sits exactly on the threshold and you step in and out every second, you trigger the door (segment alloc/free) constantly. Move the whole room (copy to a contiguous block) and there's no threshold to straddle.

- **Stack maps are a "manifest of which boxes contain fragile items."** When the movers (GC / stack-copier) arrive, the manifest tells them precisely which slots are pointers (fragile, must be handled and re-labeled) versus plain integers (just data). Without the manifest they'd have to treat every box as maybe-fragile (conservative GC) and could never safely relabel anything (can't move objects).

- **Async logical stacks are a "package tracking number."** The physical truck (executor) only knows its current leg. To see the whole journey from origin (request handler) to here, you follow the tracking number (continuation chain), not the truck's odometer.

---

## Mental Models

- **"At scale, a stack is a managed object, not a fixed region."** It can grow, move, and be precisely described — like a heap object, but LIFO.

- **"Copying beats segmenting because it has no seam to thrash."** Geometric growth + no boundary = predictable performance; that predictability was worth the copy cost.

- **"You can only move a stack if you know exactly what's a pointer."** Stack maps + escape analysis make relocation possible. No precise pointer info → no moving (and no compacting GC).

- **"Root scanning and stack copying are the same walk with different verbs."** One reads pointers (scan); the other rewrites them (relocate). Both need the stack map.

- **"Stack overflow is a page fault wearing a costume."** The runtime catches `SIGSEGV` on the guard page and renames it.

- **"Async trades the physical stack for a heap-linked logical one."** Suspension severs the call chain; observability must be designed in, not inferred from a backtrace.

- **"Frame pointers came back because always-on profiling won the argument."** A 1% tax for fleet-wide observability.

---

## Code Examples

### Example 1: Watch a Go stack grow (and the runtime copy it)

```go
package main

import "fmt"

// Deep recursion forces the goroutine stack to grow repeatedly.
// Each growth copies the whole stack to a 2x block and relocates pointers.
func depth(n int, acc *int) int {
    var local [128]byte // pin some frame size so growth happens sooner
    _ = local
    if n == 0 {
        return *acc
    }
    *acc++
    return depth(n-1, acc)
}

func main() {
    acc := 0
    fmt.Println(depth(100000, &acc))
    // Run with: GODEBUG=gctrace=1 go run main.go     (see GC)
    // Inspect growth with the runtime/debug + pprof, or read runtime.morestack.
}
```

Each time a goroutine's prologue (`runtime.morestack`) sees the stack near full, the runtime doubles it, **copies**, and **relocates the `*acc` pointer** to point into the new stack location. The program is correct only because Go's stack maps let the runtime find and rewrite that pointer.

### Example 2: Demonstrate guard-page overflow vs a clean error

```go
// Go turns goroutine stack exhaustion into a clean fatal error,
// because it controls growth and can detect the limit (default 1 GB).
package main

func boom(n int) int { return boom(n + 1) } // unbounded recursion

func main() {
    boom(0)
    // fatal error: stack overflow
    // runtime: goroutine stack exceeds 1000000000-byte limit
}
```

```c
// C has no growable stack: unbounded recursion runs into the guard page
// and dies with a raw segfault — no nice message.
int boom(int n) { return boom(n + 1); }
int main(void) { return boom(0); } // Segmentation fault (core dumped)
```

Same root cause (unbounded recursion), radically different reporting: Go's managed stack gives a precise message; C's fixed stack gives a `SIGSEGV` from the guard page.

### Example 3: Set up an alternate signal stack to even *report* an overflow

```c
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>

static char altstack[SIGSTKSZ];

// Without sigaltstack, a SIGSEGV from stack overflow can't be handled —
// the handler itself needs stack space the overflowed thread doesn't have.
void install_overflow_handler(void (*h)(int, siginfo_t*, void*)) {
    stack_t ss = { .ss_sp = altstack, .ss_size = sizeof altstack, .ss_flags = 0 };
    sigaltstack(&ss, NULL);
    struct sigaction sa = {0};
    sa.sa_sigaction = h;
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK; // <-- run handler on altstack
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSEGV, &sa, NULL);
}
```

This is exactly how runtimes (and ASan, and crash reporters) manage to report a stack overflow instead of recursing the handler into oblivion.

### Example 4: The "useless" async backtrace, and fixing it with context

```python
import asyncio

async def deepest():
    raise ValueError("boom")          # crash inside an awaited coroutine

async def middle():
    await deepest()

async def handler():
    await middle()

asyncio.run(handler())
# The traceback DOES chain here because asyncio/Python rebuilds it.
# In many runtimes the *physical* stack at the throw would bottom out at
# the event loop's `poll`/`run` — the logical caller chain (handler->middle->
# deepest) lives in task/continuation metadata, not the physical stack.
```

The lesson: physical backtraces in async code are only as good as the runtime's logical-stack reconstruction. For production, propagate explicit trace/span context across `await`s rather than trusting the backtrace.

### Example 5: Make the fleet profilable

```bash
# The modern default for profilable production binaries:
gcc -O2 -fno-omit-frame-pointer -fasynchronous-unwind-tables svc.c -o svc
# now continuous profilers (perf, parca, pyroscope, async-profiler) get
# full, signal-safe, low-overhead call graphs across every host.

# Verify before you ship — flame graph should NOT be a sea of [unknown]:
perf record -g ./svc && perf report --stdio | head
```

---

## Pros & Cons

**Copying (contiguous) growable stacks:**

| Pro | Con |
|-----|-----|
| No hot-split cliff; predictable performance. | Growth copies the whole stack (latency spike at growth points). |
| Tiny initial stacks → millions of tasks feasible. | Requires precise stack maps + escape analysis + relocatable pointers. |
| Amortized O(1) growth (geometric doubling). | Forbids un-tracked interior pointers into the stack. |

**Stackless async (state machines):**

| Pro | Con |
|-----|-----|
| No per-task stack; extreme memory efficiency. | Loses the natural stack → logical-stack reconstruction needed. |
| Suspension is cheap (just save state). | Can only suspend at explicit `await` points. |
| Composes well; no stack-overflow from task depth. | Large futures can bloat; "self-referential future" complexity. |

**Frame pointers fleet-wide (`-fno-omit-frame-pointer`):**

| Pro | Con |
|-----|-----|
| Cheap, deep, signal-safe profiling everywhere, always. | ~1–2% steady-state CPU/code-size cost. |
| Reliable crash backtraces without DWARF. | One fewer general-purpose register. |

---

## Use Cases

- **Massive concurrency runtimes** (Go, Erlang/BEAM, Java virtual threads) — small growable/relocatable stacks make millions of tasks possible.
- **Moving/compacting garbage collectors** — precise stack maps for root scanning and object relocation.
- **Robust servers** — guard pages + `sigaltstack` to detect and survive (or cleanly report) stack overflow on untrusted input.
- **Async services** — logical-stack reconstruction and explicit trace context for debuggability.
- **Continuous/always-on profiling** — frame-pointer or eBPF-based fleet profiling (Parca, Pyroscope, Polar Signals, async-profiler).
- **Functional/recursive workloads** — tail-call elimination to keep deep recursion in bounded stack space.

---

## Coding Patterns

**Pattern: Bound recursion on untrusted input.** Unbounded recursion on user data (deeply nested JSON/XML, attacker-controlled depth) is a stack-overflow DoS. Convert to iteration with a heap stack, or enforce an explicit depth limit. This is true even in Go (1 GB goroutine limit is still a crash).

**Pattern: Keep large buffers off the (growable) stack.** A giant local array forces immediate stack growth (Go) or can jump the guard page (C). Heap-allocate big buffers; in Go this also avoids triggering early stack copies in hot paths.

**Pattern: Install an alternate signal stack in any process that catches `SIGSEGV`.** Crash reporters, sanitizers, and overflow-detecting servers all need `sigaltstack` + `SA_ONSTACK`, or the handler can't run when the stack is exhausted.

**Pattern: Propagate logical context across `await`.** Don't rely on async physical backtraces. Thread a trace/span/request ID through the call chain (or use the runtime's structured async-context facility) so you can reconstruct *who* triggered work.

**Pattern: Build production binaries for profilability by default.**

```bash
# A sane default trio for server binaries:
-O2 -fno-omit-frame-pointer -fasynchronous-unwind-tables
```

Decide once, fleet-wide; don't discover at 3 a.m. that you can't profile the hot host.

**Pattern: Be aware of escape analysis when you measure Go stack behavior.** `go build -gcflags=-m` shows what escapes to the heap (and thus can't be relocated as part of a stack). Unexpected escapes change allocation and GC pressure.

---

## Best Practices

1. **Treat unbounded recursion on input as a security bug.** Cap depth or iterate. Fuzz the depth.
2. **Always pair `SIGSEGV` handling with `sigaltstack`.** Otherwise you can't even report a stack overflow.
3. **Enable stack-clash protection** (`-fstack-clash-protection`) for code with large frames or hostile input, so big allocations can't skip the guard page.
4. **Default production builds to frame pointers + async unwind tables** for fleet-wide, low-overhead, signal-safe profiling.
5. **Don't trust async physical backtraces; design observability in.** Propagate trace context across suspension points.
6. **Mind escape analysis in copying-stack runtimes.** Know what lives on the (movable) stack vs the heap; keep large/long-lived data on the heap.
7. **Size OS-thread stacks deliberately.** For thread-pool-heavy native services, default 8 MB × N threads can exhaust address space; tune `pthread_attr_setstacksize` to real need.
8. **Verify profilability and backtraces in CI/staging**, not in an incident. A `[unknown]`-free flame graph is a shippable artifact check.

---

## Edge Cases & Pitfalls

- **Huge local frame jumps the guard page.** A single multi-MB local array can write *past* a one-page guard into valid memory — silent corruption, not a fault. Needs stack probes / clash protection.
- **Overflow handler without `sigaltstack` recurses.** The `SIGSEGV` handler needs stack the overflowed thread doesn't have; it faults again. Symptom: a process that vanishes with no crash report.
- **Pointer into a Go stack handed to C / stored opaquely.** If the runtime can't track it, a stack copy invalidates it. cgo rules forbid passing Go pointers to Go pointers across the boundary precisely because the stack can move. Violations are crashes that reproduce only under stack growth.
- **Conservative GC can't move objects.** If any "maybe pointer" might be an integer, you can't rewrite it, so you can't compact. Mixing conservative scanning with a moving collector is a design contradiction.
- **Async backtrace bottoms out at the executor.** Crash inside a continuation shows the event loop, not the logical caller. Without logical-stack reconstruction you can't tell which request failed.
- **Tail-call elimination removes frames from backtraces.** Correct, but it makes "where's my caller?" debugging confusing, and `-O0` vs `-O2` can change whether deep tail recursion overflows.
- **Stack growth at an inopportune time.** In Go, stack growth happens at function prologues (safepoints). Code that assumes addresses of stack locals are stable across a call that triggers growth is wrong — another reason such addresses must escape to the heap if shared.
- **`ulimit -s unlimited` masks bugs.** It doesn't make recursion safe; it just delays the crash and can cause the stack to collide with the heap/mmap region in confusing ways.
- **Mismatched stack size between thread creator and library.** A library that recurses deeply on a thread someone else created with a tiny stack overflows unexpectedly. Document stack-depth needs.

---

## Cheat Sheet

```text
STACK OVERFLOW = guard-page fault
  - guard page (no-access) past stack end; touching it -> SIGSEGV
  - big frame can JUMP the guard -> use stack probes (-fstack-clash-protection)
  - to even REPORT overflow: sigaltstack + SA_ONSTACK

GROWABLE STACKS
  segmented (Go<=1.2, -fsplit-stack): new linked chunk on growth
      -> HOT SPLIT: call at a boundary in a loop thrashes alloc/free
  copying  (Go>=1.3): alloc 2x contiguous block, COPY, RELOCATE pointers
      -> no seam, amortized O(1); needs precise stack maps + escape analysis

STACK MAPS
  per-safepoint: which slots/regs are pointers
  used to: (a) relocate pointers on stack copy
           (b) scan GC roots precisely (enables MOVING/compacting GC)
  conservative GC skips maps -> can't move objects, may retain garbage

GREEN THREADS / ASYNC
  stackful (goroutines, fibers): real switchable stack; suspend anywhere
  stackless (Rust/C#/JS async): state machine; locals-across-await on heap
  async LOSES physical stack -> rebuild LOGICAL stack from continuation chain
  -> design observability: propagate trace/span context across await

TAIL-CALL ELIMINATION
  reuses current frame -> bounded stack for tail recursion
  -> eliminated frame absent from backtrace (correct, but surprising)

FLEET PROFILING
  -fno-omit-frame-pointer + -fasynchronous-unwind-tables = cheap, deep,
     signal-safe call graphs everywhere (~1-2% cost; industry re-enabled it)

GOLDEN RULES
  - bound recursion on untrusted input (DoS)
  - big buffers -> heap, not stack
  - sigaltstack whenever you catch SIGSEGV
  - don't trust async physical backtraces
  - in copying-stack runtimes, untracked stack pointers die on growth
```

---

## Summary

At scale the stack stops being a fixed OS region and becomes a *managed* resource. **Stack overflow** is detected as a **guard-page fault** (`SIGSEGV`) — which a large frame can dangerously skip without **stack probes**, and which you can only *report* using an **alternate signal stack**. Per-thread stack reservations (~8 MB) make OS thread stacks unscalable for massive concurrency, so runtimes use **small growable stacks**. Go's history is the lesson: **segmented** growth was elegant but suffered the **hot-split** cliff, so Go switched to **contiguous copying** stacks — doubling and copying the whole stack on growth and **relocating every pointer** into it, which is only possible because Go has **precise stack maps** (and escape analysis to keep the pointer set statically known). Those same stack maps let a **garbage collector** scan stack **roots** precisely and, uniquely, *move* objects.

Lightweight concurrency splits into **stackful** tasks (real switchable stacks, suspend anywhere) and **stackless** async (state machines whose cross-`await` locals live on the heap). Stackless async **loses the natural call stack**, so runtimes reconstruct a **logical async stack** from continuation metadata — meaning observability must be designed in, not inferred from a physical backtrace. **Tail-call elimination** reuses frames (bounded tail recursion, but absent from traces). And operationally, the dominant story is that **frame pointers came back fleet-wide**: a ~1% tax bought cheap, deep, signal-safe, always-on profiling, reversing a decade-old optimization once observability became the priority. With the full picture — frames, conventions, unwind tables, exception unwinding, and now growable/relocatable stacks — you can reason about every stack-related incident a runtime can throw at you.

---

## Further Reading

- The Go runtime design docs and source (`runtime/stack.go`, `runtime.morestack`, `copystack`) — copying stacks, the 1.3 transition rationale, and stack maps.
- The Go blog / proposal history on segmented vs contiguous stacks (the hot-split write-up).
- GCC `-fsplit-stack` documentation; `-fstack-clash-protection`; the Stack Clash advisory (Qualys, 2017).
- Linux `sigaltstack(2)` and `sigaction(2)` man pages; how runtimes use them for overflow handling.
- The garbage-collection topic in this roadmap for precise vs conservative root scanning.
- Continuous-profiling docs: Linux `perf` frame-pointer/DWARF/LBR modes, async-profiler, Parca/Pyroscope; the Fedora/distro discussions on re-enabling frame pointers.
- Runtime async-context docs: Rust `tracing`/task-dumps, .NET async stack traces, Node `async_hooks`, Python `asyncio` task stacks.
