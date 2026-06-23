# Goroutine Stack Growth — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Stack Growth Check in Detail](#the-stack-growth-check-in-detail)
3. [How Copy-and-Grow Works](#how-copy-and-grow-works)
4. [Stack Shrinking During GC](#stack-shrinking-during-gc)
5. [Cost Analysis of Growth](#cost-analysis-of-growth)
6. [Segmented Stacks — History and Why They Were Replaced](#segmented-stacks--history-and-why-they-were-replaced)
7. [`runtime/debug.SetMaxStack` in Practice](#runtimedebugsetmaxstack-in-practice)
8. [Observing Stack Behaviour](#observing-stack-behaviour)
9. [The Stack Pool](#the-stack-pool)
10. [Stack-Related GODEBUG Knobs](#stack-related-godebug-knobs)
11. [When Stack Growth Hurts Performance](#when-stack-growth-hurts-performance)
12. [Stacks vs Heap — Escape Analysis Refresher](#stacks-vs-heap--escape-analysis-refresher)
13. [Summary](#summary)

---

## Introduction

At the junior level you learned that goroutines start with 2 KB and grow on demand. At the middle level you need to know *how* — concretely enough that you can read a Go assembly dump, recognise the prologue check, explain why growth is amortised cheap, and reason about cost on a hot path.

This file covers:

- The instructions the compiler inserts at every function entry
- What the runtime does when the check fails
- How the runtime decides when to shrink
- Why doubling is the right growth rule
- The historical segmented-stack approach and its "hot split" failure
- The knobs (`SetMaxStack`, `GODEBUG`) and how to measure stack behaviour in production

References point to the Go 1.22 runtime; behaviour is stable across recent versions.

---

## The Stack Growth Check in Detail

Every Go function (except those marked `//go:nosplit` or inlined) emits a check at the prologue. On `amd64`, the check looks like this in the compiler's intermediate representation:

```
TEXT main.f(SB)
    MOVQ (TLS), CX            ; CX = current G
    CMPQ SP, 16(CX)           ; compare SP to g.stackguard0
    JLS  morestack_noctxt     ; jump if SP is below the guard
    SUBQ $framesize, SP       ; allocate this function's frame
    ; ... body ...
    ADDQ $framesize, SP
    RET
```

On `arm64` and other architectures the sequence is similar; the principle is identical. The compiler picks the precise form based on architecture-specific calling conventions.

### What is `g.stackguard0`?

Every goroutine has a `g` struct (defined in `runtime/runtime2.go`):

```go
type g struct {
    stack       stack    // [lo, hi) — actual stack memory bounds
    stackguard0 uintptr  // tripwire for stack growth
    stackguard1 uintptr  // tripwire for system-stack growth (C-like)
    // ... many other fields
}

type stack struct {
    lo uintptr // low address
    hi uintptr // high address
}
```

`stackguard0` is set to `g.stack.lo + StackGuard` where `StackGuard` is around 928 bytes (varies by architecture). This is the threshold below which the prologue triggers growth.

The runtime uses `stackguard0` (not `stack.lo` directly) so it can *temporarily lower the guard above SP* to force a preemption — async preemption signals the goroutine by setting `stackguard0` to `^uintptr(0)`, guaranteeing the next prologue check fails and jumps into the scheduler. Stack growth and preemption share the same mechanism.

### Frame size vs single SP check

The check only compares SP to the guard — it does not know how big this function's frame is. If a function's frame is so large it would underflow the guard *plus* the frame, the compiler inserts a slightly more elaborate check (`large frame`), comparing `SP - framesize` instead. This is rare; most functions have small frames.

### Functions that skip the check

- **Inlined functions.** The caller's prologue already ran; no need for a second one.
- **`//go:nosplit` functions.** The runtime relies on a static guarantee that they fit within a small budget (~928 bytes of remaining stack). Used inside the runtime, signal handlers, GC code. Misuse panics.
- **Leaf functions with no locals.** Some tiny functions with frame size 0 may skip the check. The compiler decides.

### Cost of the check

On modern x86-64, the three-instruction sequence is typically 1 cycle when branch prediction succeeds. Branch prediction usually succeeds because the guard rarely fires. So the average overhead is sub-nanosecond per call.

You can see the check generated for any function with:

```
go tool compile -S yourfile.go | head -50
```

The lines `CMPQ SP, 16(R14)` and `JLS morestack_noctxt` are the check.

---

## How Copy-and-Grow Works

When the prologue check fails, control transfers to `runtime.morestack_noctxt` (assembly, `runtime/asm_amd64.s`). It saves the caller's PC and SP into the `g` and then calls `runtime.newstack` (Go code, `runtime/stack.go`).

### The `newstack` procedure

Pseudocode of the essential steps:

```go
func newstack() {
    gp := getg().m.curg
    // 1. Compute desired new size: double the current, or cap at max.
    oldsize := gp.stack.hi - gp.stack.lo
    newsize := oldsize * 2
    if newsize > maxstacksize {
        // print "runtime: goroutine stack exceeds N-byte limit"
        throw("stack overflow")
    }

    // 2. Allocate a fresh stack from the stack pool.
    newstack := stackalloc(uint32(newsize))

    // 3. Copy frames from the old stack into the new one.
    copystack(gp, newstack)

    // 4. Free the old stack (return to pool).
    stackfree(gp.stack)

    // 5. Switch the goroutine to the new stack.
    gp.stack = newstack
    gp.stackguard0 = newstack.lo + _StackGuard

    // 6. Return to the goroutine; the prologue check now passes.
    gogo(&gp.sched)
}
```

### `copystack` — the heart of the move

`copystack` does two passes over the old stack:

1. **Adjust pointers in registers / saved state** — the `gobuf` (saved SP, PC, BP) is updated to point into the new stack.
2. **For each frame on the stack:**
   - Copy the bytes from old SP to new SP.
   - Use the function's *stack map* to identify pointers within the frame.
   - For each pointer that points into the old stack range, add the offset between new and old base.

The runtime's *stack map* is a bitmap emitted by the compiler describing which slots in each frame contain pointers. Without these maps, the runtime could not safely move stacks.

### The `delta` and pointer fix-up

If the old stack was at `[old_lo, old_hi)` and the new stack is at `[new_lo, new_hi)`, the runtime adjusts every found pointer `p` where `old_lo <= p < old_hi` to `p + (new_lo - old_lo)`. This includes:

- Local pointer variables inside frames.
- Pointers in defer records.
- Pointers in the goroutine's saved state.

### What is *not* fixed

- Pointers stored in *heap* objects that happen to point into the old stack. Go does not normally produce such pointers — escape analysis pushes anything that might escape to the heap. But `unsafe.Pointer` can break this invariant; that is one reason `unsafe` is unsafe.

### Why one copy is fine

After the copy, the old stack is gone. No outstanding references point to it (assuming no unsafe shenanigans). The new stack is the only one in play. Subsequent function calls don't know the goroutine moved.

---

## Stack Shrinking During GC

Stack growth handles the "I need more" case. The mirror operation — shrinking — runs during garbage collection.

### When shrinking happens

During each GC cycle, when the runtime scans a goroutine's stack to find pointers, it also measures how much of the stack is "in use" — i.e., how far below `g.stack.hi` does the current SP reach. If

```
in_use < stack_size / 4
```

then the runtime allocates a new stack half the size, copies the live frames into it (using `copystack` — the same mechanism as growth), and frees the old one.

### Why 1/4 and not 1/2?

Hysteresis. If we shrank as soon as usage dropped below half, then any function that grew the stack back to the old size would re-trigger a copy. The 1/4 threshold ensures we don't oscillate.

### Shrink limit

The runtime never shrinks below the *initial* size (2 KB). A goroutine that grew to 16 KB and is now using only 128 bytes will shrink down to 2 KB and stop.

### What this means for long-lived services

A web server with a goroutine pool that occasionally handles a deep request gets its stacks "right-sized" over the course of a few GC cycles. The peak does not persist forever.

If you observe `runtime.MemStats.StackSys` rising while goroutine count is stable, force a `runtime.GC()` and check again. If StackSys drops, you were holding peak stacks; if it doesn't, you have a leak or live deep recursion.

### Code reference

`runtime/stack.go`: `shrinkstack(gp *g)`:

```go
func shrinkstack(gp *g) {
    // ... bail-out conditions: dead G, locked G, stack already at minimum ...
    oldsize := gp.stack.hi - gp.stack.lo
    newsize := oldsize / 2
    if newsize < _FixedStack {
        return
    }
    avail := gp.stack.hi - gp.stack.lo
    if used := gp.stack.hi - gp.sched.sp + _StackLimit; used >= avail/4 {
        return
    }
    copystack(gp, stackalloc(uint32(newsize)))
}
```

---

## Cost Analysis of Growth

### The amortised argument

Doubling stack size on overflow is the same growth rule used by `slice append` and `std::vector::push_back`. The analysis is:

Let `N` be the maximum stack size ever reached. The total work done across all growths is

```
2 + 4 + 8 + ... + N = 2N
```

bytes copied. Each push (function call) is "charged" at most a few bytes of copy work on average — O(1) amortised.

In Go specifically, the work per growth is `O(stack_size)` for the copy plus `O(num_frames)` for pointer fix-ups. For a 16 KB stack with 30 frames, that's ~16 KB memcpy plus a couple of microseconds of bitmap-driven fix-up. Doubling means a goroutine that reaches 64 KB has done ~5 growths (2 → 4 → 8 → 16 → 32 → 64) and copied ~126 KB total — a one-time cost over the goroutine's lifetime, amortised to fractions of a nanosecond per function call.

### When the amortisation breaks down

The amortised argument assumes you don't *shrink and re-grow* repeatedly. The 1/4 hysteresis prevents normal code from doing this. But if you have:

```go
func handler() {
    deepRecursion()  // grows stack to 64 KB
    // function returns, stack drops to 2 KB usage
}
```

and you call `handler()` in a loop on the same goroutine, the stack stays at 64 KB allocated. Subsequent calls do not re-grow. Cost is paid once per goroutine.

But if every iteration spawns a *new* goroutine:

```go
for i := 0; i < 1_000_000; i++ {
    go handler()
}
```

each goroutine starts at 2 KB and grows. You pay the growth cost a million times. That is when growth shows up in pprof.

### When you see `morestack` in pprof

The function `runtime.morestack_noctxt` (sometimes `runtime.morestack`) appearing in CPU profiles is the canonical "your hot path is growing stacks" signal. Common causes:

- Large local arrays in hot functions.
- Deep recursion in hot paths.
- Many short-lived goroutines doing nontrivial work.
- `defer` in tight loops (each defer adds to the frame).

The fix is usually one of:

- Move large locals to the heap (via `sync.Pool`).
- Convert recursion to iteration.
- Reuse goroutines (worker pool) instead of spawning per task.

---

## Segmented Stacks — History and Why They Were Replaced

Go 1.0 through 1.2 (2012–2013) used **segmented stacks**, not copying stacks. The mechanism:

- Each goroutine started with a stack segment of ~8 KB.
- When that segment was about to overflow, the runtime allocated a new segment, linked it to the old one as a "next" pointer, and set SP into the new segment.
- When a function returned and SP came back to the segment boundary, the runtime freed the new segment.

This sounds elegant. The trouble was *the hot split*.

### The hot split problem

Consider:

```go
func a() {
    for i := 0; i < N; i++ {
        b()  // each call crosses a segment boundary
    }
}
```

If `a`'s frame just fits in segment 1 but `b`'s frame requires segment 2, every call to `b` allocates a new segment and every return frees it. Allocation and freeing dominate the loop. The pathological slow-down was 10–100×.

Even small variations in code could trigger it. The boundary was non-obvious; you wouldn't know your function was on the wrong side of a segment until you profiled.

### The 1.3 fix

Go 1.3 (2014) replaced segmented stacks with copying stacks. Now the stack is always contiguous; growth copies once and the new stack is large enough that subsequent calls don't trigger more growth. No more hot split, at the cost of more expensive single growth events.

Go 1.4 then reduced the initial stack from 8 KB to 4 KB, then to 2 KB, because contiguous stacks made the initial size matter less — growth is amortised cheap.

### Pre-1.3 code

If you read very old Go source or talk to engineers who used Go in 2012, you may hear references to "split stacks" or "segmented stacks." This is what they mean. The technique is mostly historical now, but worth knowing because:

- It explains why Go 1.3 was a milestone release.
- It is the same trick rustc still uses (with caveats) for its "split-stack" feature on some platforms.
- It clarifies why `//go:nosplit` is named that way — it predates copying stacks.

---

## `runtime/debug.SetMaxStack` in Practice

The runtime's stack-growth ceiling is, by default, 1 GB on 64-bit systems and 250 MB on 32-bit. You can change it:

```go
import "runtime/debug"

func init() {
    debug.SetMaxStack(64 * 1024 * 1024) // 64 MB
}
```

### When to lower the limit

- **Safety in services that recurse on untrusted input.** A 1 GB limit means an attacker can extract 1 GB of memory before the process dies. Lowering to 16 or 64 MB makes the failure mode fast and obvious.
- **Tests** of recursive code — fail loudly at 1 MB instead of slowly at 1 GB.

### When to raise it

Almost never. If you find yourself wanting to raise the limit, you almost certainly have a bug. Rewrite the recursion as iteration.

The one exception is heavy scientific computing or compilers that genuinely need huge stacks. Even then, a redesign with explicit data structures is usually possible.

### Effect on existing goroutines

`SetMaxStack` affects only growth decisions made *after* the call. Goroutines that have already grown beyond the new limit continue to run with their existing stacks; they simply cannot grow further.

### Return value

`SetMaxStack(n)` returns the previous limit, allowing temporary lowering:

```go
old := debug.SetMaxStack(16 * 1024 * 1024)
defer debug.SetMaxStack(old)
// ... run risky code ...
```

---

## Observing Stack Behaviour

### `runtime.MemStats`

```go
var m runtime.MemStats
runtime.ReadMemStats(&m)
fmt.Printf("StackInuse: %d\n", m.StackInuse)
fmt.Printf("StackSys:   %d\n", m.StackSys)
```

- **StackInuse** — bytes of stacks currently in use by goroutines.
- **StackSys** — bytes obtained from the OS for stacks. Includes the stack pool.

`StackSys - StackInuse` is the free pool. If both grow without bound while goroutine count is stable, you have a leak.

### `runtime.Stack`

```go
buf := make([]byte, 1<<16)
n := runtime.Stack(buf, true)  // true = all goroutines
fmt.Println(string(buf[:n]))
```

Prints text tracebacks of all goroutines. Each traceback includes the function name and source line for every frame. Not stack-size data, but tells you what the stacks contain.

### pprof goroutine profile

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Shows where goroutines are blocked or running. Useful for finding leaks.

### pprof allocs / heap

Stack allocations are *not* shown in heap profiles. The stack pool's memory shows up as `runtime/debug.allocStack` if visible at all.

### `GODEBUG=gctrace=1`

```
gc 1 @0.005s 1%: 0.005+0.36+0.001 ms clock, 0.040+0.10/0.32/0.69+0.011 ms cpu, 4->4->1 MB, 5 MB goal, 8 P
```

Each GC line shows heap stats but not stack stats directly. Compare `StackInuse` before and after GC to see shrink effects.

### `GODEBUG=schedtrace=1000`

Every 1000 ms, prints scheduler stats. Doesn't include stack stats but is useful alongside.

### Live introspection via `expvar`

```go
import "expvar"

expvar.Publish("stack_inuse", expvar.Func(func() any {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return m.StackInuse
}))
```

Exposes the stack-in-use metric on `/debug/vars`.

---

## The Stack Pool

The runtime maintains a per-`P` cache of free stacks plus a global pool. From `runtime/stack.go`:

```go
// Per-P stack cache (in struct p)
type p struct {
    // ...
    mcache *mcache
}

// Global stack pool
var stackpool [_NumStackOrders]struct {
    item stackpoolItem
    _    [...]byte  // pad
}
```

Stack sizes are bucketed into "orders": 2 KB, 4 KB, 8 KB, … up to 32 KB. Sizes above 32 KB are allocated directly from the heap allocator (`mheap_.allocManual`).

### Allocation flow

`stackalloc(size)`:

1. If size <= 32 KB, look up the appropriate order.
2. Check the per-P cache for a free stack of that size.
3. If empty, refill from the global pool.
4. If the global pool is empty, allocate a fresh span from the heap.
5. Return the stack to the caller.

### Free flow

`stackfree(stack)`:

1. If size <= 32 KB, return to the per-P cache.
2. If the cache is full, flush some back to the global pool.
3. If size > 32 KB, return directly to the heap allocator for eventual reuse.

### Why bucketed pools?

Reuse: a goroutine that exits leaves behind a 2 KB stack that the runtime can immediately give to the next goroutine. This is why creating a goroutine is so fast — typically no allocation, just a pool pop.

### Memory pressure on the pool

If your service spikes to 1M goroutines and then quiesces, the stack pool will hold ~1M × 2 KB = 2 GB of unused stack memory. This is by design — the runtime expects you to spawn many goroutines again. After a long idle period, the GC's scavenger returns the pages to the OS.

If you need that memory back fast, call `debug.FreeOSMemory()`.

---

## Stack-Related GODEBUG Knobs

| Knob | Effect |
|---|---|
| `GODEBUG=stackalloc=1` | Print each stack allocation (very chatty). |
| `GODEBUG=stackdebug=N` | Verbose stack-growth tracing for `N=1`, `2`, `3`. |
| `GODEBUG=gctrace=1` | GC trace; stack shrinking happens during GC. |
| `GODEBUG=allocfreetrace=1` | Trace every allocation/free including stacks. |
| `GOTRACEBACK=all` | On panic, print all goroutine stacks. |
| `GOTRACEBACK=system` | Include runtime-internal frames in traces. |

Most are runtime-debug aids; not for production. They are not part of the Go compatibility promise and may change.

### `stackdebug` example

```
GODEBUG=stackdebug=1 ./your-program
```

prints lines like

```
runtime: newstack newsize=4096 from sp=0xc0000a4f88
runtime: copystack gp=0xc00008e000 to 0xc0000a4000
```

useful for verifying growth is happening (or *not* happening when you think it should be).

---

## When Stack Growth Hurts Performance

### Symptom 1 — `morestack_noctxt` in CPU profile

Top of pprof CPU profile shows the runtime growth path eating cycles. Causes:

- Large local arrays.
- Recursion in a hot path.
- Many short-lived goroutines.

Fixes:

- Heap-allocate large buffers (`sync.Pool`).
- Iterative algorithms.
- Worker pools.

### Symptom 2 — High `StackSys`, low `StackInuse`

The runtime has obtained a lot of stack memory but only a small fraction is in use. Caused by a spike in goroutine count that has since subsided. Not necessarily a problem; the pool may be reused. If memory pressure is real, `debug.FreeOSMemory()` releases scavenged pages.

### Symptom 3 — Per-goroutine memory higher than expected

If you measured `StackInuse / num_goroutines` and got 16 KB instead of 2 KB, individual goroutines have grown. Find them with `runtime.Stack(buf, true)` and look at the depth.

### Symptom 4 — Latency tail

Stack growth is a synchronous, copying operation. A 64 KB stack copy takes a few microseconds. For latency-sensitive services with 99.9-percentile budgets, that copy can show up as a tail-latency outlier. Mitigation:

- Pre-grow stacks deliberately: call a function that recurses to your expected depth in a warmup phase, before serving real traffic.

  ```go
  func warmup() {
      // grow main goroutine's stack to ~64 KB
      var pad [60 * 1024]byte
      _ = pad
  }
  ```

  Doesn't help per-request goroutines, but is a known trick for long-lived workers.

---

## Stacks vs Heap — Escape Analysis Refresher

A Go variable lives on the stack if the compiler proves it does not escape its function's frame. It lives on the heap otherwise.

```go
func f() *int {
    x := 42
    return &x  // x escapes: returned address outlives function
}
```

`x` lives on the heap; `f` returns its address.

Why this matters for stack growth:

- **Variables that don't escape live on the stack.** They contribute to frame size, which contributes to growth pressure.
- **Variables that escape live on the heap.** Allocated via the heap allocator (`runtime.newobject`). Stack growth does not move them; pointer fix-up does not affect them.

If you want to *reduce* stack growth, you can sometimes encourage escape by:

- Returning pointers to large structures.
- Storing them in package-level variables.
- Passing them through interfaces (forces escape in many cases).

Conversely, if you want to *avoid heap pressure*, keep variables non-escaping. There is a tension: large non-escaping locals trigger stack growth, while heap allocation triggers GC work.

Check what escapes:

```
go build -gcflags="-m=2" yourfile.go
```

Look for `escapes to heap` annotations.

---

## Summary

At the middle level, "goroutines have growable stacks" becomes:

- Every Go function (except `//go:nosplit` ones) has a tiny prologue check comparing SP to `g.stackguard0`.
- On failure, `morestack` → `newstack` → allocate, `copystack`, switch.
- Growth is *doubling*: 2 → 4 → 8 → … KB.
- Shrinking happens during GC when in-use < 1/4 of allocated.
- The max is 1 GB on 64-bit; `runtime/debug.SetMaxStack` adjusts.
- Stacks live in segregated pools per-P plus a global pool, with bucket sizes up to 32 KB.
- The historical alternative was segmented stacks (1.0–1.2), abandoned because of the hot-split problem.
- Cost is amortised O(1) per call but each individual growth is O(stack size).
- `morestack_noctxt` in pprof is the canonical "you're growing stacks on a hot path" signal.

The senior level discusses architectural consequences — when to use deep recursion, how the stack model interacts with parser design, and the implications for cgo and signal handlers.

The professional level walks the runtime source for `morestack`, `newstack`, `stackalloc`, and `copystack`, including pointer fix-up via stack maps.
