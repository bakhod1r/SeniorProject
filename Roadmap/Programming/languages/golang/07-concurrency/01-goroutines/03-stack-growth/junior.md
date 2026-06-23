# Goroutine Stack Growth — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why is a goroutine cheap? What is its stack, where does it live, and what happens when it runs out of room?"

A **stack** is the strip of memory a function uses while it is running. Every local variable, every saved return address, every nested function call lives in the stack. When the function returns, its slice of the stack vanishes; when it calls another function, a new slice is pushed on top.

For an ordinary OS thread, the stack is *fixed* — the kernel reserves a chunk (typically 1 to 8 MB on Linux) when the thread is created, and that chunk lives untouched until the thread dies. A million threads, then, would need a million stacks, each holding a megabyte of mostly-empty space. The math is hostile: a million threads is at least a terabyte of address space. This is why classical thread-per-request servers cap out around 10,000 connections.

A **goroutine** plays a different game. The Go runtime gives each new goroutine a stack of only **2 KB** (since Go 1.4). A million goroutines now fits in roughly 2 GB. That's the headline benefit.

How does 2 KB work for arbitrary functions that may, deep inside, allocate 10 KB arrays or recurse 500 levels deep? The runtime **grows the stack on demand**. When the goroutine is about to overflow its current stack, a small check (inserted by the compiler at the start of almost every function) detects the situation, calls into the runtime, the runtime allocates a *bigger* stack (typically double the current size), copies the old frames into it, fixes any pointers that referred to the old stack, and returns to running the function. The goroutine never notices.

After reading this file you will:

- Know what a stack is and why each goroutine has its own
- Understand that a goroutine starts with ~2 KB and grows up to 1 GB
- Understand the copy-and-grow mechanism in a single sentence
- Recognise the stack-overflow panic and what to do about it
- Have a feel for when recursion becomes dangerous in Go
- Know that the stack can also *shrink* during garbage collection
- Know that the maximum stack size is configurable via `runtime/debug.SetMaxStack`

You do not yet need to know the assembly check, the role of `morestack`, the segregated stack pool, or stack-pointer fix-up. Those belong to the middle and professional levels.

---

## Prerequisites

- **Required:** Go 1.18 or newer (1.21+ recommended). Check with `go version`.
- **Required:** Comfort reading and writing simple Go programs with functions and recursion.
- **Required:** Familiarity with the goroutine basics covered in [01-overview](../01-overview/) — you know how to spawn one with `go f()` and you have heard the phrase "2 KB stack."
- **Helpful:** Some sense of how a stack works in any language (C, Python, JavaScript). The shape is the same; only the implementation differs.
- **Helpful:** Awareness of pprof (`net/http/pprof`) — we will mention it but not require it at this level.

If you can write a recursive Fibonacci function in Go and explain in words what happens when it calls itself, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Stack** | A region of memory used to hold function-call frames, local variables, and return addresses. Each goroutine has its own. |
| **Stack frame** | The slice of the stack belonging to one active function call. Holds that call's locals, arguments, and saved registers. |
| **Stack grow** | The runtime's act of allocating a larger stack, copying the live frames into it, and resuming. Triggered when the current stack is about to overflow. |
| **Stack shrink** | The runtime's act of replacing a too-large stack with a smaller one, freeing memory. Happens during garbage collection, not during normal execution. |
| **Initial stack size** | 2 KB since Go 1.4. Was 8 KB in Go 1.2, 4 KB in Go 1.3. |
| **Maximum stack size** | 1 GB on 64-bit (250 MB on 32-bit) by default. Settable via `runtime/debug.SetMaxStack`. Exceeding it causes a fatal panic. |
| **`morestack`** | The internal runtime function called by the compiler-inserted prologue check when a stack is about to overflow. Triggers `newstack`. |
| **`newstack`** | The function that actually performs growth: allocates a bigger stack, copies frames, fixes pointers, swaps stacks. |
| **Stack guard** | A sentinel pointer (`g.stackguard0`) that the prologue compares the stack pointer against. If the SP would dip below it, growth is needed. |
| **`runtime: goroutine stack exceeds 1000000000-byte limit`** | The fatal message printed when stack growth exceeds the configured maximum. Almost always caused by unbounded recursion. |
| **Copy-and-grow** | The Go runtime's strategy since 1.3: allocate a new stack, copy. Older strategy was *segmented stacks*: link a new stack to the old one. Replaced because of the "hot split" problem. |
| **Segmented stack** | The pre-1.3 strategy: when the stack overflowed, a new segment was allocated and linked to the previous one. Cheap on overflow, but a function that crossed a segment boundary in a loop paid a "hot split" cost. |
| **Hot split** | The pathological case where a function repeatedly crosses a segment boundary — each crossing triggered a segment alloc/free — and ran orders of magnitude slower. Solved by switching to copying stacks. |

---

## Core Concepts

### Each goroutine has its own stack

When you write `go f()`, the runtime does (roughly):

1. Allocate a `g` struct (the goroutine descriptor).
2. Allocate a 2 KB stack for it.
3. Set up the stack so that, when scheduled, the goroutine begins executing `f`.
4. Push the goroutine onto a runqueue.

The stack is just a slab of memory in the heap of the Go process. It is *not* mapped specially with the kernel. From the kernel's perspective, it is anonymous memory like any other heap allocation.

### The 2 KB initial stack is enough — for most functions

Most functions use only a few hundred bytes of stack. `fmt.Println` uses around 200 bytes. A typical HTTP handler that calls 5 levels of helpers uses maybe 1 KB. The 2 KB starting size handles the vast majority of goroutines without ever needing to grow.

When the goroutine *does* need more, it grows; that growth is amortised cheap.

### The compiler inserts a "do I have enough stack?" check at the start of every function

When the Go compiler emits the prologue of a function, it inserts a small assembly sequence that looks roughly like:

```
CMPQ SP, (g_stackguard0(R14))   ; compare stack pointer to guard
JLE  morestack                  ; if too low, jump to growth path
```

This check is fast — two or three instructions on a 64-bit CPU. It runs at the entry of nearly every function call. If the stack has room, the function proceeds normally. If not, control jumps to `runtime.morestack`, which orchestrates growth.

(Tiny leaf functions with no frame may skip the check. The compiler decides via the `//go:nosplit` directive or static analysis.)

### Copy-and-grow in one paragraph

When growth is needed, the runtime:

1. Allocates a new stack, usually double the current size (2 KB → 4 KB → 8 KB → 16 KB …).
2. Walks the old stack frame by frame and copies the bytes into the new stack.
3. Walks the same frames a second time and adjusts every pointer that pointed into the old stack so it now points into the new stack. This is possible because the compiler emits *stack maps* describing where every pointer lives in every frame.
4. Frees the old stack (returns it to the runtime's pool).
5. Restores execution with the goroutine's stack pointer now inside the new stack.

The goroutine, from its own perspective, just called a function that took a little longer than usual. Nothing about its variables or logic changes.

### The stack can shrink, but only during GC

If a goroutine grew its stack to 64 KB to handle a deeply recursive parse, then settled into using only the bottom 2 KB, the runtime can shrink the stack back down. This happens during garbage collection, when the runtime scans the goroutine's stack anyway. If the in-use stack is less than 1/4 of the allocated stack, the runtime allocates a smaller stack and copies the live frames over.

This is why a long-lived service does not "remember" its peak stack forever; periodic GC cycles bring stacks back to size.

### There is a hard maximum: 1 GB

By default, a single goroutine cannot have more than 1 GB of stack on 64-bit systems (250 MB on 32-bit). Hit this limit and Go prints:

```
runtime: goroutine stack exceeds 1000000000-byte limit
fatal error: stack overflow
```

This message is almost always caused by *unbounded recursion* — a function that calls itself without a base case, or with a base case that never matches. Real algorithms hit the limit too: parsing a 1 GB JSON document with a naive recursive descent parser can blow the stack on adversarial inputs.

You can change the limit with `runtime/debug.SetMaxStack(bytes)`. Raising it is rarely the right answer; rewriting recursion as iteration usually is.

### The stack is private to one goroutine

No other goroutine reads or writes another's stack. There is no API to do so, and the runtime depends on this isolation for the copy-and-grow trick to be safe. If you need to share data between goroutines, the data must live on the **heap**, not on a stack.

This connects to the famous Go saying: "do not communicate by sharing memory; share memory by communicating." Stacks are private; channels carry copies.

---

## Real-World Analogies

### The stack is like a notebook each cook brings to the kitchen

Each cook (goroutine) carries a small notebook (2 KB stack) for jotting current orders. Most of the time, a few pages suffice. If a complicated order needs many pages, the cook quietly swaps to a bigger notebook, copies the open pages, and keeps writing — the customer never notices.

### Threads are like reserved hotel rooms; goroutines are like backpackers

A thread books a full hotel room in advance — large, expensive, mostly empty. A goroutine carries a backpack and unrolls space as needed. A thousand backpackers fit in the same square footage as one luxury suite.

### Copy-and-grow vs segmented stacks is moving house vs adding extensions

Copy-and-grow is moving to a bigger house when the old one fills up. One disruptive move, then settled. Segmented stacks are adding a porch, then a garage, then a shed — cheap individually, but if you keep walking between rooms, every doorway has friction. The "hot split" problem is the third hour of cooking dinner while running between four buildings.

### The stack-growth check is a doorman

Every time a function enters, a doorman checks "do you have headroom for what you're about to do?" If yes, walk in. If no, step aside while the larger stack is set up. The doorman is fast and cheap — but they are present at every door.

---

## Mental Models

### The "elastic balloon" model

Imagine the stack as a balloon that the goroutine inflates as it pushes function calls in. When it has more breath (deeper recursion), the balloon stretches. When it exhales (returns), the balloon shrinks back — but the *allocated capacity* of the balloon stays where its peak was, until GC notices it can deflate the rubber.

### The "double when full" rule

The runtime's growth rule is simple: when full, double. 2 → 4 → 8 → 16 → 32 → … KB. This is the standard amortised-O(1) growth strategy that vectors and hash tables use. Total cost of N pushes is O(N), not O(N²), because each byte is copied at most a logarithmic number of times.

### The "stack vs heap" model

A Go variable lives on the stack if the compiler can prove its lifetime does not exceed its enclosing function. Otherwise, the compiler *escapes* it to the heap. You see the decisions with `go build -gcflags="-m"`. Stack growth is cheap, but values on the stack are gone the moment the function returns. Values on the heap survive until GC collects them.

### The "snapshot moves" model

When a stack grows, every existing frame is copied byte-for-byte to a new address. Pointers to those frames are updated. The illusion is that the goroutine has been frozen, transplanted, and unfrozen. From inside, time passed and a function call completed.

---

## Pros & Cons

### Pros of small + growable goroutine stacks

- **Density.** A million goroutines fit in a few GB of address space. With fixed 8 MB stacks (Linux thread default), a million threads would need 8 TB.
- **No upfront commitment.** A goroutine that does shallow work uses very little memory.
- **Amortised O(1) growth.** Doubling is mathematically efficient; rare growths pay for many cheap calls.
- **Shrink during GC.** Long-lived services don't accumulate peak-size stacks.
- **Compiler-managed.** You don't pass stack sizes around or guess thread parameters.

### Cons / costs

- **Every function pays a tiny prologue check.** A few cycles per call. Inlined or `//go:nosplit` functions skip it.
- **Pointer fix-up is non-trivial.** The compiler must emit stack maps; this affects every function with locals that contain pointers.
- **Growth requires copying.** The copy itself is O(stack size). For a 64 KB stack, that is a memcpy plus pointer adjustments — fast but not free.
- **Deep recursion is more dangerous than in C.** A 64-bit machine with `ulimit` set to 8 MB will run a 100,000-deep recursion in C; Go will also handle it, but copies the stack ~17 times along the way, and may eventually hit the 1 GB limit.
- **Stack-pointer arithmetic in cgo is awkward.** C code sees the M's system stack (`g0`), not the goroutine stack, because the goroutine stack may move at any time. This complicates passing Go pointers to C.

---

## Use Cases

The stack-growth mechanism is invisible to most code. You benefit without thinking about it. You start to *notice* it when:

- You are running ten thousand or more goroutines and need to keep memory in check (high-concurrency network servers).
- You have deeply recursive code (compilers, parsers, tree walkers, search algorithms).
- You see a stack-overflow panic in production logs and need to diagnose unbounded recursion.
- You profile a hot path and notice that `runtime.morestack_noctxt` shows up in pprof CPU profiles — indicating growth is happening on a hot path.
- You are writing cgo bindings and the asymmetry between Go stacks and C stacks matters.
- You are tuning a service for minimum memory footprint and want to understand what each goroutine costs.

---

## Code Examples

### Example 1 — Observing the initial stack size

You cannot directly query the stack size from a goroutine, but you can observe its memory effect.

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var before, after runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&before)

    const N = 10_000
    done := make(chan struct{})
    for i := 0; i < N; i++ {
        go func() {
            <-done
        }()
    }

    runtime.ReadMemStats(&after)
    perGoroutine := (after.StackInuse - before.StackInuse) / N
    fmt.Printf("approximate stack per goroutine: %d bytes\n", perGoroutine)

    close(done)
}
```

On a fresh Go 1.21+ install this prints something close to 2048 bytes per goroutine — the initial 2 KB stack — plus a small constant overhead.

### Example 2 — Forcing growth with recursion

```go
package main

import (
    "fmt"
    "runtime"
)

func recurse(depth int) {
    if depth == 0 {
        return
    }
    var local [256]byte // make each frame ~256 bytes
    _ = local
    recurse(depth - 1)
}

func main() {
    fmt.Println("before:", runtime.NumGoroutine())
    recurse(1000)
    fmt.Println("ok — survived 1000 recursive calls")
}
```

This recursion forces the main goroutine's stack to grow several times. The program runs fine because Go grows the stack as needed.

### Example 3 — Triggering a stack overflow

```go
package main

func recurse() {
    recurse()
}

func main() {
    recurse()
}
```

Run this and you will see:

```
runtime: goroutine stack exceeds 1000000000-byte limit
runtime: sp=0xc02009c378 stack=[0xc02009c000, 0xc04009c000]
fatal error: stack overflow
```

The runtime grew the stack repeatedly until it hit 1 GB, then gave up.

### Example 4 — Setting a smaller maximum

```go
package main

import (
    "fmt"
    "runtime/debug"
)

func recurse(n int) {
    var local [1024]byte
    _ = local
    recurse(n + 1)
}

func main() {
    debug.SetMaxStack(1 * 1024 * 1024) // 1 MB
    defer func() {
        if r := recover(); r != nil {
            fmt.Println("recovered:", r)
        }
    }()
    recurse(0)
}
```

`SetMaxStack` lowers the ceiling. The recursion now fails faster (at 1 MB rather than 1 GB), which is useful in tests to fail loudly before exhausting machine memory.

### Example 5 — Iterative replacement of a recursive walk

Before — recursive:

```go
func walk(n *node, visit func(*node)) {
    if n == nil {
        return
    }
    visit(n)
    walk(n.left, visit)
    walk(n.right, visit)
}
```

After — iterative with an explicit stack on the heap:

```go
func walk(root *node, visit func(*node)) {
    if root == nil {
        return
    }
    stack := []*node{root}
    for len(stack) > 0 {
        n := stack[len(stack)-1]
        stack = stack[:len(stack)-1]
        visit(n)
        if n.right != nil { stack = append(stack, n.right) }
        if n.left != nil  { stack = append(stack, n.left) }
    }
}
```

The iterative version uses a *slice* on the heap as its stack, never grows the goroutine stack past a few KB, and handles arbitrarily deep trees without risk of stack overflow.

### Example 6 — Observing stack stats with `runtime.MemStats`

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    fmt.Printf("StackInuse:  %d KB\n", m.StackInuse/1024)
    fmt.Printf("StackSys:    %d KB\n", m.StackSys/1024)
}
```

- `StackInuse` — bytes of stack actually in use right now.
- `StackSys` — bytes the runtime has obtained from the OS for stacks (includes the pool of free stacks).

The difference between them is the stack pool — fresh-but-unallocated stacks waiting for new goroutines.

---

## Coding Patterns

### Pattern 1 — Prefer iteration for unbounded depth

If your recursion depth depends on input size (parser, tree walker, search), write it iteratively with an explicit slice as the stack. Goroutine stacks can grow, but a 1 GB JSON document plus an attacker who controls its nesting is not a fight you want.

### Pattern 2 — Tail-call-style transforms

Go does not guarantee tail-call optimisation. The compiler may inline some tail calls, but cannot be relied upon. Convert tail recursion to loops by hand:

```go
// Recursive
func sum(n int) int {
    if n == 0 { return 0 }
    return n + sum(n-1)
}

// Iterative
func sum(n int) int {
    total := 0
    for ; n > 0; n-- {
        total += n
    }
    return total
}
```

### Pattern 3 — Bound input depth

If you must recurse, validate input depth up front:

```go
const maxDepth = 1000

func parse(input string, depth int) error {
    if depth > maxDepth {
        return errors.New("input nesting too deep")
    }
    // ...
    return parse(rest, depth+1)
}
```

This protects you from adversarial input that triggers the 1 GB limit and crashes the process.

### Pattern 4 — Use a sync.Pool for large scratch buffers, not stack frames

If a function needs a 16 KB scratch buffer, prefer:

```go
var pool = sync.Pool{New: func() any { return make([]byte, 16*1024) }}

func process(input []byte) {
    buf := pool.Get().([]byte)
    defer pool.Put(buf)
    // use buf
}
```

over `var buf [16 * 1024]byte` inside the function. A 16 KB local triggers stack growth on every call from a fresh goroutine.

---

## Clean Code

- Keep functions small. A 50-line function with 10 nested calls plus a 4 KB local array is the recipe for stack growth on every invocation.
- Don't create large local arrays. Anything over a few KB belongs on the heap (via `make` or `new`).
- Don't recurse "because it reads better" if the depth depends on user input.
- Comment any deliberate use of recursion that you have verified bounded: `// max depth = 64 (AST nesting limit)`.

---

## Product Use / Feature

The stack-growth mechanism is the reason you can write a Go web server that handles 100,000 simultaneous connections on a 4-core box with 2 GB of RAM. Take that away and Go is, performance-wise, just another threaded language.

Real product impacts:

- **High-concurrency network servers** (chat, proxies, gateways) ride on the small-stack assumption.
- **In-memory caches** that spawn one goroutine per key (e.g., to expire items) work because each goroutine costs ~2 KB, not ~1 MB.
- **Job queues** that spawn a goroutine per task accept high task counts without OOM.
- **Crawlers** spawning a goroutine per fetch can fan out to 10,000 hosts without breaking memory.

The cost shows up in:

- Stack-overflow panics under adversarial input (parsers, regex engines).
- pprof profiles showing `morestack` on hot paths.
- High `runtime.MemStats.StackSys` in services that briefly spiked goroutine counts.

---

## Error Handling

A stack overflow is **not** a recoverable panic. The runtime prints `fatal error: stack overflow` and terminates the process. You cannot `recover()` it. The reasoning: a goroutine that has run out of stack has no headroom to run a deferred function or a panic-recovery handler.

If your goroutine might recurse into untrusted input, your defence is:

1. Validate input depth before recursing.
2. Cap `debug.SetMaxStack` so the process dies fast under abuse rather than slowly bleeding memory.
3. Convert to iteration where possible.

Note: there are *other* fatal-error panics (`fatal error: concurrent map writes`, `all goroutines are asleep - deadlock!`) that are also unrecoverable. Stack overflow joins that family.

---

## Security Considerations

A maliciously deep input can trigger stack overflow as a denial-of-service. Examples in real CVEs:

- **JSON / YAML / XML parsers** that recurse on nested structures. A 1 MB document of `[[[[[...]]]]]` can blow the stack of a naive parser. Production parsers cap depth.
- **Regex engines** with backtracking. Pathological patterns can recurse millions of times. Go's `regexp` package uses RE2 (no backtracking) and is safe.
- **Recursive descent compilers** parsing untrusted source. Code that nests parentheses millions of levels deep.
- **Protocol decoders** that recurse on length-prefixed nested fields.

Defence:

- Cap nesting depth in your parsers.
- Use libraries known to handle depth (e.g., `encoding/json` caps at 10,000 nesting levels by default).
- Reject input over a size threshold before parsing.

---

## Performance Tips

- **Don't put large arrays on the stack.** `var buf [16384]byte` causes a stack growth on every call. Use `make([]byte, 16384)` or `sync.Pool`.
- **Avoid recursion in hot paths.** Each call pays the prologue check and may trigger growth. For trees and lists, iterate.
- **Inline aggressively.** Inlined functions don't pay prologue costs. The compiler usually decides; you can request `//go:inline` via small refactors. Compile with `-gcflags="-m"` to see what's inlined.
- **Watch `runtime.MemStats.StackInuse`.** If it grows unboundedly while goroutine count is stable, individual goroutines are growing. Find them with pprof.
- **Don't fight the runtime.** Resist the urge to call `runtime.GC()` to "shrink the stack." Let it happen on schedule.

---

## Best Practices

- Trust the runtime for typical workloads. Don't optimise stack size until pprof says you should.
- Cap recursion depth in any code that touches untrusted input.
- Prefer slices on the heap as your explicit stack for unbounded traversals.
- Test with adversarial input (deeply nested JSON, long-named directories, etc.) to verify your parsers and walkers don't blow the stack.
- Document any deliberate recursion with a comment stating the maximum expected depth.

---

## Edge Cases & Pitfalls

### A `//go:nosplit` function bypasses the stack check

The compiler allows annotating a function with `//go:nosplit` to skip the stack-growth check. This is used inside the runtime for functions that must run without growing the stack (signal handlers, GC code). Misusing it in user code can crash the program — a deeper-than-tiny chain of nosplit functions can blow the (statically reserved) "nosplit" headroom and trigger a runtime panic.

Junior advice: do not use `//go:nosplit`. It is a runtime internal.

### Goroutine startup itself can grow

If you `go f()` and `f` immediately calls a deep chain, the initial 2 KB may be too small. The first function call grows the stack to 4 KB, then 8 KB, etc. You see the cost as a slight startup spike.

### Large struct returns can trigger growth

Returning a large struct (`type Big [10000]byte`) by value pushes thousands of bytes onto the stack of the caller. The compiler may put such a value on the heap automatically (escape analysis), but if it doesn't, the caller's stack grows.

### Cgo runs on a different stack

When you call `C.foo()`, the runtime switches to the M's *system stack* (`g0`), which is allocated by the OS at thread creation and **does not grow**. A C function that recurses deeply will hit a real fixed stack limit (typically 8 MB on Linux). The Go stack-growth mechanism does not protect cgo.

### Signal handlers run on a separate stack

When a signal is delivered (e.g., `SIGSEGV`, `SIGPROF`), the runtime switches to the M's `gsignal` stack — separate from both `g0` and the user G's stack. This is also fixed-size and non-growing.

---

## Common Mistakes

### Mistake 1 — Treating stack overflow as recoverable

```go
defer func() {
    if r := recover(); r != nil {
        // recovered
    }
}()
recurseForever()
```

Stack overflow is not a panic in the recoverable sense. The defer never runs. The process dies.

### Mistake 2 — Putting large arrays on the stack to "save GC time"

```go
func handle() {
    var buf [65536]byte
    use(buf[:])
}
```

You "save" one allocation but pay for a stack growth on every invocation. Use `sync.Pool` for buffers over a few KB.

### Mistake 3 — Assuming tail-call optimisation

```go
func loop(n int) {
    if n == 0 { return }
    loop(n - 1)
}
```

Go does **not** guarantee TCO. `loop(1_000_000_000)` grows the stack until it overflows. Write a `for` loop.

### Mistake 4 — Recursing on untrusted input without depth limits

```go
func parse(data []byte) (*node, error) {
    // recursive descent, no depth check
}
```

A user submits a 1 MB document of `[[[[...]]]]`. Your service crashes. Always cap depth.

### Mistake 5 — Confusing `SetMaxStack` with thread stack size

`debug.SetMaxStack` controls the per-goroutine *Go* stack cap. It has nothing to do with the OS thread (M) stack, which is fixed.

---

## Common Misconceptions

- **"Each goroutine has a 2 KB stack forever."** False. Goroutines grow up to 1 GB. The 2 KB is just the *initial* size.
- **"Stack size = max stack size."** False. Stacks grow; the max is a cap, rarely reached.
- **"Goroutines have unlimited stack."** False. The default cap is 1 GB. Unbounded recursion will crash.
- **"Growth is O(1)."** Amortised yes; each individual growth is O(stack size) due to the copy. The amortised analysis is the same as a doubling array.
- **"Stacks never shrink."** False since Go 1.2. They shrink during GC when usage drops below 1/4.
- **"Stack is on the system thread."** False for goroutines. The goroutine stack lives in the heap of the Go process. The M (system thread) has its own separate `g0` stack.
- **"You can read another goroutine's stack."** Only via `runtime.Stack` for traces. There is no API to inspect another goroutine's variables.
- **"`//go:nosplit` makes a function faster."** It skips the prologue check, saving 2-3 cycles. Almost never worth the safety cost.
- **"Tail calls are optimised."** Not guaranteed by Go. Test with a known-deep input.

---

## Tricky Points

### Stack maps depend on the compiler knowing every pointer

The runtime's pointer fix-up during growth depends on stack maps emitted by the compiler. If you do unsafe.Pointer arithmetic that hides a pointer from the compiler, the runtime cannot fix it up, and your program can crash after a stack grow. This is one of the cases where `unsafe` is genuinely unsafe.

### Stack growth can happen at *almost* any function call

It cannot happen mid-instruction or inside a `//go:nosplit` function, but at any normal function-call boundary, the stack may move. Pointers into the stack (e.g., `&local`) may change addresses. Pointers obtained before a call may be invalid for arithmetic comparisons after.

In practice, you should not hold raw stack addresses across calls. Use slices and channels instead.

### `defer` adds stack pressure

Each `defer` allocates a defer record on the stack (or heap, depending on Go version). Heavy use of `defer` in tight loops triples stack pressure. Modern Go versions (1.13+) have an "open-coded" defer that is much cheaper.

### Map and slice headers are tiny on the stack; the backing arrays are on the heap

`var s []int = make([]int, 1<<20)` puts a slice header (24 bytes on 64-bit) on your stack but allocates the million-element backing array on the heap. The same holds for `map`, `chan`, and `string`. Stack growth is rarely caused by Go's built-in container types.

---

## Test

### Test 1 — Approximate the initial stack size

Use the program from Example 1. The result should be close to 2 KB.

### Test 2 — Verify that growth happens

```go
package main

import (
    "fmt"
    "runtime"
)

func deep(n int) {
    var pad [256]byte
    _ = pad
    if n > 0 {
        deep(n - 1)
    }
}

func main() {
    var m runtime.MemStats
    runtime.GC()
    runtime.ReadMemStats(&m)
    fmt.Println("before:", m.StackInuse)

    deep(200)

    runtime.GC()
    runtime.ReadMemStats(&m)
    fmt.Println("after:", m.StackInuse)
}
```

You should see `StackInuse` rise during recursion. After GC, if the stack is no longer in heavy use, it may shrink — but the timing is not deterministic.

### Test 3 — Reproduce a stack overflow

Run Example 3. Confirm the `fatal error: stack overflow` message.

### Test 4 — Show iterative replacement works

Write a recursive tree walker and an iterative one. Feed both a tree of depth 10,000. The recursive one will eventually overflow; the iterative one will not.

---

## Tricky Questions

**Q: A goroutine that has grown to 64 KB calls a function whose frame is 100 bytes. Does the runtime shrink the stack before the call?**
A: No. Growth happens immediately when needed; shrinking only happens during GC, and only if the *high-water mark* is below 1/4 of the allocated size. The 64 KB stack stays 64 KB for now.

**Q: Two goroutines call the same function. Goroutine A's stack is 2 KB; goroutine B's is 16 KB. Is the function called with different code?**
A: No. The same machine code runs in both cases. The prologue check reads `g.stackguard0` from each goroutine's own G struct, which carries that goroutine's current limits.

**Q: Can a stack grow during a system call?**
A: Not while the goroutine is parked in the syscall — there's no Go code running. Growth happens only at function-call boundaries in Go code. On the way *into* a syscall (e.g., `read`), the calling function may have already grown its stack before the syscall begins.

**Q: Why doesn't Go just allocate a 1 GB virtual stack upfront and let the OS lazily page it?**
A: This is what some thread libraries do. The downside is that the stack is fixed once allocated — no growth, no shrink. Go preferred growable stacks for two reasons: cheaper for small goroutines (no need to reserve address space), and shrinkable (you don't pay forever for a temporary peak). On 32-bit systems, the address-space approach also doesn't scale.

**Q: If a function's stack frame is exactly equal to the headroom, does it grow before or after entry?**
A: Before. The prologue check happens at function entry; if the frame would overflow, control jumps to `morestack` *before* the frame is laid out. The function then runs on the new, larger stack.

---

## Cheat Sheet

```
Initial stack:     2 KB   (since Go 1.4)
Growth strategy:   double on overflow (copy-and-grow)
Shrink trigger:    during GC, when in-use < 1/4 of allocated
Max stack:         1 GB on 64-bit, 250 MB on 32-bit  (settable)
Hard panic msg:    runtime: goroutine stack exceeds N-byte limit
                   fatal error: stack overflow  (unrecoverable)

Tools to set limits:
  runtime/debug.SetMaxStack(bytes)

Inspect:
  runtime.MemStats.StackInuse   — bytes currently used
  runtime.MemStats.StackSys     — bytes obtained from OS for stacks
  runtime.Stack(buf, all)        — text traceback
  pprof goroutine profile        — per-goroutine sample

History:
  Go 1.0–1.2  segmented stacks (hot-split problem)
  Go 1.3+     copying stacks
  Go 1.4      initial stack reduced 8 KB → 4 KB → 2 KB
```

---

## Self-Assessment Checklist

- [ ] I can explain in one sentence why goroutines are cheap.
- [ ] I can describe what happens when a goroutine's stack overflows the current allocation.
- [ ] I know the default maximum stack size and how to change it.
- [ ] I can identify the message a stack overflow prints and know it is unrecoverable.
- [ ] I know that stacks can shrink during GC.
- [ ] I can convert a recursive function to an iterative one with an explicit slice as stack.
- [ ] I know that `unsafe.Pointer` arithmetic across function calls is dangerous because of stack moves.
- [ ] I know the difference between a goroutine stack and an M's `g0` stack.
- [ ] I have read at least one piece of `runtime.MemStats` output and identified the stack fields.
- [ ] I have triggered a stack overflow in a test program at least once.

---

## Summary

A goroutine starts with a 2 KB stack and grows by doubling on demand, copying live frames into a new allocation each time. It shrinks during garbage collection if it's barely in use. The maximum is 1 GB on 64-bit systems; exceed it and the process dies with an unrecoverable `fatal error: stack overflow`. The growth mechanism is what makes a million goroutines fit on a normal laptop, and it is also why deep recursion on untrusted input is dangerous.

What this means for you, today:

- You can spawn goroutines liberally without thinking about per-goroutine memory.
- You should not put large arrays on the stack.
- You should bound any recursion that depends on input size.
- You can observe stack effects via `runtime.MemStats` and pprof.

Middle level dives into the prologue check, the copy mechanics, and the cost amortisation. Senior level discusses architectural implications. Professional level walks the runtime source.

---

## What You Can Build

With what you know now:

- A high-concurrency TCP echo server that accepts 50,000 simultaneous connections (one goroutine per connection).
- A web crawler that fans out 10,000 fetches in parallel, with each fetch handled by its own goroutine.
- A job queue that spawns one goroutine per task without worrying about thread costs.
- A test harness that asserts `runtime.MemStats.StackInuse` stays under a budget as a regression guard.
- An iterative tree walker that handles trees of arbitrary depth without recursion.
- A bounded-depth recursive parser that rejects adversarial input above N nesting.

---

## Further Reading

- **"Stack growing" in `runtime/HACKING.md`** — `https://github.com/golang/go/blob/master/src/runtime/HACKING.md`
- **"How Stacks Are Handled in Go"** — Ardan Labs blog
- **"Go's growing stacks"** — Dave Cheney, on the segmented-to-copying transition
- **`runtime/stack.go`** in the Go source tree — the canonical implementation
- **Go 1.3 release notes** — describes the move to contiguous stacks
- **Go 1.4 release notes** — initial stack size reduced to 2 KB
- **`runtime/debug` package documentation** — `SetMaxStack` and related knobs

---

## Related Topics

- [01-overview](../01-overview/) — Goroutine basics (the prerequisite)
- [02-vs-os-threads](../02-vs-os-threads/) — Why threads can't do this trick
- [04-runtime-management](../04-runtime-management/) — Scheduler, GC integration
- [Channels](../../02-channels/) — How goroutines coordinate without sharing stack memory
- [Memory model](../../../06-memory-model/) — Why pointer fix-up during growth is safe

---

## Diagrams & Visual Aids

### Stack growth — copy and grow

```
Before growth:
+---------------+ 0xc0000c0000  (top of 4 KB stack)
| frame: main   |
+---------------+
| frame: f      |
+---------------+
| frame: g      |   <-- SP about to underflow
+---------------+ 0xc0000bf000  (bottom, stackguard0)

After growth:
+---------------+ 0xc0000d2000  (top of 8 KB stack)
| frame: main   |
+---------------+
| frame: f      |
+---------------+
| frame: g      |
+---------------+
| (free space)  |
+---------------+
| (free space)  |
+---------------+ 0xc0000d0000  (bottom)
```

The runtime allocated a new 8 KB region, copied the three frames into it, fixed any pointers, and resumed execution with SP at the new top of `g`.

### Growth check in a function prologue (pseudo-x86)

```
CMPQ SP, 16(R14)         ; compare stack pointer to g.stackguard0
JLS  morestack_noctxt    ; if below, grow
SUBQ $frame_size, SP     ; lay down this function's frame
...                      ; function body
ADDQ $frame_size, SP
RET
```

R14 holds the G pointer (the goroutine descriptor). `16(R14)` is `g.stackguard0`.

### Stack size over the life of a goroutine

```
size
  ^
1 GB|        max (limit)
    |
 64K|     ___
    |    /   \
 16K|   /     \___
    |  /          \
  4K| /            \____   (shrunk during GC)
  2K|/
    +-------------------> time
    spawn       deep recursion       GC      return
```

### History of Go stacks

```
Go 1.0–1.2 — segmented stacks
   [seg1] -> [seg2] -> [seg3]
   each segment 8 KB, linked list, hot-split problem

Go 1.3+ — contiguous (copying) stacks
   [   one growing stack   ]
   doubled on overflow, copied each time
```

### Stack lifecycle states

```
+--------+   spawn   +---------+   call    +---------+   GC     +----------+
| (none) |---------->| 2 KB    |---------->| grown   |--------->| shrunk   |
+--------+           +---------+           +---------+          +----------+
                          |                     |                    |
                          v                     v                    v
                      goroutine          (may grow more)        (may grow)
                       returns
                          |
                          v
                     returned to pool
```
