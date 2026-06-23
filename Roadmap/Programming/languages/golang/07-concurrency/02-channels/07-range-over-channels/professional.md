# Range Over Channels — Professional Level (Internals)

> Focus: "How does the compiler turn `for v := range ch` into machine code? What runtime calls back the loop? Where is the cost?"

## Table of Contents

1. [Compiler Lowering Overview](#compiler-lowering-overview)
2. [The `chanrecv2` Runtime Call](#the-chanrecv2-runtime-call)
3. [Walk Through the Lowered AST](#walk-through-the-lowered-ast)
4. [Generated Assembly Comparison](#generated-assembly-comparison)
5. [Channel Internals That Affect Range](#channel-internals-that-affect-range)
6. [Cost Model: Receive in a Range Loop](#cost-model-receive-in-a-range-loop)
7. [Range and Goroutine Parking](#range-and-goroutine-parking)
8. [Range and the Scheduler](#range-and-the-scheduler)
9. [Range with Generic Element Types](#range-with-generic-element-types)
10. [How Go 1.23 Range-Over-Func is Lowered Differently](#how-go-123-range-over-func-is-lowered-differently)
11. [Reading Runtime Source for Range Behaviour](#reading-runtime-source-for-range-behaviour)

---

## Compiler Lowering Overview

`for v := range ch` is one of the simplest cases of the compiler's range expansion. The frontend (specifically `cmd/compile/internal/walk/range.go`) detects a `for ... range` over a channel and rewrites it as a `for` loop calling the runtime's two-value receive primitive.

Symbolically:

```go
for v := range ch {
    body(v)
}
```

becomes (post-walk, roughly):

```go
{
    chanT := ch
    for {
        var v T
        var ok bool
        ok = runtime.chanrecv2(chanT, &v)
        if !ok {
            break
        }
        body(v)
    }
}
```

(The actual emitted code is slightly different — `chanrecv2` returns the `ok` bool, and the receive into `v` is by pointer. See [The `chanrecv2` Runtime Call](#the-chanrecv2-runtime-call) below.)

This rewrite happens before the SSA pass; the SSA optimiser sees a normal `for`/`if` structure. From SSA's perspective, the loop is no different from one written by hand. No special intrinsic, no special calling convention.

### Why `chanrecv2`?

The runtime exposes three receive helpers:

- `chanrecv1(c *hchan, ep unsafe.Pointer)` — single-value, no `ok`. Used by `v := <-ch`.
- `chanrecv2(c *hchan, ep unsafe.Pointer) (received bool)` — two-value. Used by `v, ok := <-ch` and `range`.
- Both call the common `chanrecv(c, ep, block bool)` internal function.

`range` uses `chanrecv2` because it needs the `ok` to decide whether to exit the loop. The runtime call signature is well-defined and stable.

---

## The `chanrecv2` Runtime Call

The runtime code (paraphrased, lightly simplified, from `runtime/chan.go`):

```go
func chanrecv2(c *hchan, elem unsafe.Pointer) (received bool) {
    _, received = chanrecv(c, elem, true)
    return
}
```

It delegates to `chanrecv`:

```go
func chanrecv(c *hchan, ep unsafe.Pointer, block bool) (selected, received bool) {
    // Fast path: closed and empty -> return zero value, ok=false
    // Fast path: buffer has data -> copy from buffer, advance, return true
    // Slow path: no data, channel open -> park goroutine, sleep
    //          another goroutine sends -> wake up, copy value, return true
    //          channel closed while parked -> wake up, return false (ok=false)
}
```

The function does one of three things:

1. **Fast path A — closed and empty:** Returns immediately with `received == false`. `range` sees `ok == false` and exits.
2. **Fast path B — value available:** Copies the value from the channel's circular buffer (or directly from a waiting sender) into `*ep`. Returns `received == true`.
3. **Slow path — block:** Adds the goroutine to the channel's recv queue, parks it (calls `gopark`), and the scheduler runs another goroutine. When a sender arrives or `close` is called, the goroutine is woken and either gets a value or gets `ok == false`.

This is the entire "magic" behind `range`. Every iteration is one call to `chanrecv2`. The runtime knows how to park, schedule, wake, and copy. The compiler emits a simple loop around it.

### Memory layout: how `v` is written

The `elem` argument is a pointer to the destination variable `v` in the caller's stack frame. `chanrecv` uses `typedmemmove(c.elemtype, ep, src)` to copy the element by its type, ensuring write barriers for GC if the element contains pointers.

This is why the destination is *always a fresh `v`* in the loop iteration: the compiler allocates one variable per range, and `chanrecv2` writes into it on every iteration. (In Go 1.22+, this is the semantics for *all* `for` loops — fresh variable per iteration.)

---

## Walk Through the Lowered AST

The compiler stage `walk/range.go` contains the function `walkRangeChan` (name varies by Go version) which does the rewrite. Approximate output:

Input AST:

```
ORANGE
├── X: ch
├── Key: v
└── Body: [body block]
```

Output AST after walk:

```
OFOR
├── Init: (nothing — declarations are above)
├── Cond: ohv (Ntest)
├── Post: (nothing)
└── Body:
    ├── ASSIGN: ohv = chanrecv2(ch, &v)
    ├── IF !ohv:
    │   └── BREAK
    └── [original body]
```

Where `ohv` is a fresh boolean introduced by the compiler.

The `chanrecv2` call uses a pointer to `v`, which is allocated in the loop's frame. The body uses `v` directly.

### What the user does not see

- No explicit `v := <-ch` shows in the AST after walk — the compiler emits a direct call to `chanrecv2`.
- No `for` test in the loop header; the test is inside the body (via `if !ok { break }`).
- The compiler may inline the body if it is small, eliminating the call boundary entirely.

For small bodies and simple element types, the inliner can produce code where the entire loop is a few dozen machine instructions, dominated by `chanrecv2`'s assembly.

---

## Generated Assembly Comparison

For:

```go
func sum(ch <-chan int) int {
    s := 0
    for v := range ch {
        s += v
    }
    return s
}
```

The amd64 disassembly (Go 1.22, roughly, with comments):

```
sum:
    SUBQ    $40, SP        ; allocate frame
    MOVQ    BP, 32(SP)
    LEAQ    32(SP), BP
    MOVQ    ch+48(SP), AX  ; load channel
    XORL    BX, BX         ; s = 0
    MOVQ    BX, 24(SP)
loop:
    MOVQ    AX, 0(SP)      ; arg 1: ch
    LEAQ    8(SP), CX      ; arg 2: &v
    MOVQ    CX, 8(SP)
    CALL    runtime.chanrecv2(SB)
    MOVB    AL, dx         ; ok
    TESTB   DL, DL
    JEQ     done
    MOVQ    8(SP), CX      ; v
    ADDQ    CX, 24(SP)     ; s += v
    JMP     loop
done:
    MOVQ    24(SP), AX     ; return s
    MOVQ    32(SP), BP
    ADDQ    $40, SP
    RET
```

The loop body is small and dominated by the `CALL chanrecv2`. The compiler does not (cannot) inline `chanrecv2` — it is a complex runtime function with locking and parking. So each iteration crosses the call boundary.

For comparison, the desugared manual form:

```go
for {
    v, ok := <-ch
    if !ok { break }
    s += v
}
```

generates identical or near-identical assembly. The runtime call is the same; the wrapping is the same. Confirm by compiling both with `go build -gcflags='-S'` and diffing.

---

## Channel Internals That Affect Range

The `hchan` struct (from `runtime/chan.go`):

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex
}
```

`chanrecv` operates on `hchan` under `c.lock`. Each `range` iteration acquires this lock. For high-frequency, contended channels, the lock can become the bottleneck — though for most workloads, the cost is dominated by the work inside the loop body.

### Receive fast paths

1. **Closed-and-empty:** `c.closed != 0 && c.qcount == 0` → return `ok = false` without parking. No lock needed in the very first check (it's a quick read, then a re-check under the lock).
2. **Direct from sender:** A goroutine is waiting on `sendq`. The receiver picks it up, copies the element directly from the sender's stack, wakes the sender. No buffer touched.
3. **From buffer:** `c.qcount > 0`. Receiver copies the element from `c.buf[c.recvx]`, advances `recvx`, decrements `qcount`, and if a sender is waiting on `sendq` for buffer space, wakes it.

### Slow path: park

If none of the above apply (channel open, empty buffer, no waiting senders), the receiver:

1. Adds itself to `c.recvq` as a `sudog` (the runtime's "I am waiting on this primitive" data structure).
2. Calls `gopark`, which removes the goroutine from the runnable queue and runs `goparkunlock` on the channel's lock.
3. Sleeps until another goroutine wakes it (via `goready`) — typically a sender or a `close` call.

When woken, the value (if any) is already in the goroutine's `*ep` (the sender copied it directly into the receiver's stack via `sendDirect`). The goroutine returns from `chanrecv2` with `ok == true` (or `false` if it was woken by `close`).

### Why this matters for `range`

A `range` loop alternates between fast-path receives and slow-path parks. In steady state, with a fast producer, the fast path dominates; per iteration cost is dozens of nanoseconds. In bursty workloads, the parking and waking add microseconds per burst.

If a `range` consumer is processing in nanoseconds and the producer is slow, the consumer parks on every iteration. The cost per item is dominated by scheduler park/wake cost, not channel logic.

---

## Cost Model: Receive in a Range Loop

Empirical numbers, modern x86_64, Go 1.22, GOMAXPROCS unchanged:

| Scenario | Per-iteration cost |
|---|---|
| Fast path receive, no contention | 30–70 ns |
| Fast path receive, 4-way contention on the channel | 100–250 ns |
| Receive after park (cross-goroutine wake) | 1–3 µs |
| Receive after park, cross-core wake | 3–10 µs |

These are receive costs alone. The body of the loop is extra.

For a `range` consumer to be efficient:

- The body should do enough work to justify the receive (typically >100 ns).
- Buffer the channel to avoid park/wake on every value.
- For very hot paths (millions of values/sec), consider batching: send slices of N values, not one value at a time.

### Batching example

Instead of:

```go
ch := make(chan int)
for v := range ch {
    process(v)
}
```

Use:

```go
ch := make(chan []int, 16)
for batch := range ch {
    for _, v := range batch {
        process(v)
    }
}
```

The number of channel operations drops by a factor of batch size. For high-throughput workloads, this can be a 10–50× speedup.

---

## Range and Goroutine Parking

When `chanrecv2` parks the goroutine:

1. The goroutine's `g` struct is removed from `runqueue` of the current P (processor).
2. A new `sudog` is allocated (or reused from a pool) and linked into `c.recvq`.
3. `gopark` transfers control to the scheduler (`schedule()`).
4. The scheduler picks another goroutine to run on this M.
5. When a sender arrives or `close` is called, the runtime walks `c.recvq`, picks the first sudog, copies the element into the receiver's stack, and calls `goready`.
6. `goready` re-adds the goroutine to a runqueue (the P that woke it, with stealing rules).
7. Eventually the scheduler picks it up; the goroutine resumes inside `chanrecv2`, returns to the `range` loop.

Each park is a context switch from the goroutine's view. The cost is dominated by scheduler bookkeeping, sudog allocation (when not pooled), and the cache effects of running a different goroutine in between.

### sudog pooling

The runtime pools sudogs per P. Most `range` iterations that park do not allocate a fresh sudog — they reuse one from a per-P cache. This keeps the per-park allocation cost low (sub-100ns) in steady state.

### Effects on the scheduler

A `range` consumer that parks frequently keeps the scheduler busy. If you have many such consumers, the scheduler's runqueues churn with park/ready events. For workloads at 10M+ events/sec, scheduler overhead can become measurable. Profile with `go tool trace` to confirm.

---

## Range and the Scheduler

The Go scheduler treats a `range`-blocked goroutine no differently from one blocked on a `Mutex` or a `time.Sleep`. The goroutine is "waiting"; it does not occupy a P; it does not show up in `runtime.NumGoroutine` differently from any other goroutine.

What changes the scheduler's behaviour is the wake event:

- **Sender on the same P:** The sender's `chansend` finds the recv waiter, copies the value, and *may* hand off the P to the receiver immediately (the "direct hand-off" optimisation). This avoids one schedule cycle.
- **Sender on a different P:** The receiver becomes runnable on the P it parked on (or, with work stealing, another P that finds it).
- **Close call:** All waiters in `recvq` are woken with `ok == false`. The runtime walks the queue once.

A clever `range` design plays to these strengths: a producer/consumer where both run on the same P pays no scheduler hop per value; a fan-out across cores does.

### NUMA considerations

On NUMA hardware, parking and waking across nodes is expensive. If a `range` consumer always parks because its producer is on another node, you pay cross-socket cache misses on every wake. Pin producer and consumer to the same NUMA node if you can; the throughput improvement can be 2–4×.

---

## Range with Generic Element Types

Go 1.18+ added generics. A generic `range` looks identical:

```go
func consume[T any](ch <-chan T) {
    for v := range ch {
        process(v)
    }
}
```

Internally, the compiler stenciling generates a specific copy of `consume` per instantiation type — or, more commonly, uses GC-shape stenciling: one copy per "shape" (size, alignment, pointer/non-pointer). For most types, this is fine; the `chanrecv2` call is the same.

The element type is stored in the `hchan`'s `elemtype` field; `chanrecv` uses it to copy correctly. So the runtime side does not change with generics — only the type-checking side does.

### Caveat: interface conversions

If a generic function calls `chanrecv2` for a type `T` that ends up being an interface, the call boxes the value (allocates on the heap if the dynamic type does not fit in the interface header). This is the same cost as `v := <-ch` for an interface channel, but worth noting when profiling.

---

## How Go 1.23 Range-Over-Func is Lowered Differently

Go 1.23's `range func` is a fundamentally different rewrite. For `iter.Seq[T]`:

```go
for v := range seq {
    body(v)
}
```

where `seq` has type `func(yield func(T) bool)`, the compiler rewrites to (roughly):

```go
seq(func(v T) bool {
    body(v)
    return true // or false if body has `break` etc.
})
```

The `body` becomes a callback passed to the iterator. The iterator pulls values; each value goes through the callback; if the callback returns `false`, the iterator returns.

Compared to channel `range`:

- No runtime call per value (no `chanrecv2`).
- No locking, no parking, no scheduler involvement.
- Pure function call per value (~5 ns).
- Single-goroutine; no concurrency.
- No leak risk: when the loop exits, the iterator returns; no goroutine is left hanging.

For purely sequential iteration over a generator, range-over-func is faster and safer. For concurrent producer/consumer, channels are still required (range-over-func cannot bridge goroutines without a channel).

### How they relate

A useful adapter:

```go
func Chan[T any](ch <-chan T) iter.Seq[T] {
    return func(yield func(T) bool) {
        for v := range ch {
            if !yield(v) { return }
        }
    }
}

// Usage:
for v := range Chan(ch) {
    if early { break } // iterator returns cleanly
}
```

The iterator's `return` does not affect the goroutine that owns the channel — the producer keeps producing. So this adapter does not prevent the standard channel-range leak; you still need cancellation on the producer side. The adapter only changes how the *consumer* expresses the loop.

For truly leak-safe iteration over a producer-controlled stream, the producer must respect a context that gets cancelled when the consumer is done.

---

## Reading Runtime Source for Range Behaviour

The relevant files in the Go source tree (rooted at the Go installation `src/`):

- `runtime/chan.go` — `hchan`, `chanrecv`, `chanrecv1`, `chanrecv2`, `closechan`. Read this top to bottom once. It is dense but readable.
- `runtime/select.go` — `selectgo`. Compares to `chanrecv` to understand `select`'s extra cost.
- `cmd/compile/internal/walk/range.go` — the compile-time lowering. Look for `walkRangeChan` (or the per-version equivalent). It mechanically rewrites the AST.
- `runtime/proc.go` — `gopark`, `goready`. The park/wake primitives that channels use.
- `runtime/runtime2.go` — `g`, `m`, `p`, `sudog`. The data structures that make goroutines, machines, processors, and waiters.

Time investment: a half-day of reading the channel runtime and compiler lowering gives you a working mental model of *every* channel operation in Go, not just `range`. The investment compounds.

### Suggested exercise

Pick a simple `range` program, compile with `-gcflags='-S'`, find the `chanrecv2` call in the output, single-step through it with `dlv`. Watch the slow path: a `gopark` call, the scheduler running other goroutines, and the eventual `goready` on a `chansend`. You will see the runtime do its job once and understand it forever.

---

## Putting It Together

The professional view of `range` over channels:

- It is one of the simplest cases of compiler range lowering: a `for` loop calling `chanrecv2` until `ok == false`.
- The runtime cost per iteration is `chanrecv2`'s cost: 30–70 ns fast path, 1–10 µs slow path (park/wake).
- The slow path drives down to `gopark`, `goready`, and the scheduler. Understanding park/wake is understanding most of Go's concurrency cost.
- Channels are mutex-protected internally. Contention shows up as longer fast-path receives.
- Go 1.23's range-over-func is a separate rewrite to a callback; it does not use channels at all.
- For high-throughput consumers, batch values into slices or larger structs to amortise the channel cost.
- The cost model is empirical: profile, do not guess.

This is the runtime substrate that makes `for v := range ch` work. Above it sits the cooperative-concurrency design of Go; below it sits the OS scheduler. `range` is two lines of source that the compiler turns into a single, well-understood loop calling a single, well-understood runtime function — and that, ultimately, is what makes it both fast and predictable.
