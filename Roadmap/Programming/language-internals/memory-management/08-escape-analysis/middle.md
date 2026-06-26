# Escape Analysis — Middle Level

> **Topic:** [Escape Analysis](README.md)
> **Focus:** The mechanisms — how the analysis actually decides, the concrete escape triggers in Go (with `-gcflags=-m`) and Java, and the specific code shapes that force heap allocation.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [How the Analysis Works](#how-the-analysis-works)
5. [The Escape Triggers (Catalog)](#the-escape-triggers-catalog)
6. [Reading Go's `-gcflags=-m` Output](#reading-gos--gcflags-m-output)
7. [Code Examples](#code-examples)
8. [Java / HotSpot Mechanisms](#java--hotspot-mechanisms)
9. [Mental Models](#mental-models)
10. [Pros & Cons](#pros--cons)
11. [Coding Patterns](#coding-patterns)
12. [Best Practices](#best-practices)
13. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
14. [Summary](#summary)

---

## Introduction

At the junior level, escape analysis was a yes/no question: *does this value outlive its function?* Now we open the hood. This tier is about **mechanism**: how the compiler reasons about reachability, the precise set of constructs that trigger an escape, and how to read the diagnostic output that tells you what happened.

The central insight: the compiler builds a model of **where references can flow**. If any reference to a value can flow to a place that outlives the allocating function (or a place the compiler can't analyze), the value escapes. Everything else is detail.

---

## Prerequisites

- Junior tier: stack vs heap cost, the basic escape rule, `moved to heap` / `does not escape`.
- Comfort reading Go and Java code: structs/objects, pointers/references, slices, maps, interfaces, closures.
- A working `go` toolchain to reproduce the `-gcflags=-m` output, and ideally a JDK for the Java sections.
- Rough understanding of **inlining** (the compiler pasting a small function's body into its caller).

---

## Glossary

- **Points-to / connection graph:** A graph the compiler builds where nodes are variables/allocations and edges mean "may reference." Escape analysis is reachability over this graph.
- **Escape to heap:** A reference reaches something outliving the function.
- **Escape to thread/global:** A reference becomes reachable by another thread/goroutine or a global — a stronger form that also affects whether locks can be removed.
- **Boxing / interface conversion:** Wrapping a concrete value in an interface (Go) or `Object`/wrapper type (Java). Often forces a heap allocation because the interface holds a pointer.
- **Scalar replacement:** Instead of allocating an object, the JIT replaces it with its individual fields held in registers/locals — heap allocation eliminated entirely.
- **Inlining:** Substituting a callee's body into the caller. Escape analysis is far more effective *after* inlining, because it can then see across the (former) call boundary.
- **`//go:noescape`:** A Go compiler directive asserting a function's pointer arguments do not escape (used for assembly/runtime functions).

---

## How the Analysis Works

### Reachability over a connection graph

Conceptually the compiler:

1. Creates a node for every allocation site and every variable that can hold a reference.
2. Adds **edges** for assignments: `a = b` means `a` may point to whatever `b` points to; `p = &x` means `p` points to `x`; storing into a field/slice element adds edges into that container.
3. Marks certain nodes as **escaping roots**: function return values, globals, parameters that are themselves stored somewhere escaping, arguments to un-analyzable functions, values captured by escaping closures.
4. **Propagates:** any allocation reachable (in the graph) from an escaping root is marked as escaping. Everything not reachable from a root stays on the stack.

This is a *may* analysis: it errs toward "escape." If two paths are possible and one escapes, the value escapes.

### Conservative by necessity

The compiler must remain correct under all execution paths, so it assumes the worst whenever it loses visibility:

- **Interface method calls** — it often can't tell which concrete implementation runs, so it assumes the argument may be stored.
- **Function values / pointers** — calling through a variable hides the callee.
- **Reflection** — can do arbitrary things; treated as fully opaque.
- **Calls to functions it didn't analyze** (no inlining, separate compilation boundaries it can't see through).

Each of these collapses the analysis to "assume escape."

### Inlining is the multiplier

Escape analysis in Go and Java runs *together with* inlining. When a small callee is inlined, its allocations become part of the caller's body, and the compiler can now prove they don't escape the (larger) combined function. The same value can be stack-allocated when the call is inlined and heap-allocated when it isn't. This is why "make hot functions inlinable" is a real performance lever.

---

## The Escape Triggers (Catalog)

A value escapes to the heap when **any** of these holds:

1. **Returned by reference.** `return &local` (Go) — the pointer outlives the frame.
2. **Stored in a field of an escaping object,** a global, or a long-lived container (slice/map that survives).
3. **Captured by a closure that outlives the call.** The captured variable's storage must live as long as the closure.
4. **Converted to an interface and then used in a way that stores it** — e.g., passed to `fmt.Println`, appended to an `[]interface{}`, put in a `map[string]any`.
5. **Address taken and passed to an un-analyzable callee** (interface method, function pointer, reflection, an un-inlined external function without `//go:noescape`).
6. **Too large for the stack / unknown size.** A value whose size isn't known at compile time (e.g., a slice backing array whose length is dynamic) typically goes to the heap. Very large values may too.
7. **Sent on a channel / shared across goroutines** (Go) — becomes reachable by another goroutine, so it escapes (and can no longer be a candidate for some single-thread optimizations).

If none apply and the compiler can prove it, the value stays on the stack (Go) or becomes a candidate for scalar replacement (Java).

---

## Reading Go's `-gcflags=-m` Output

```bash
go build -gcflags='-m' ./...     # escape + inlining decisions
go build -gcflags='-m -m' ./...  # more verbose: WHY a decision was made
```

The messages you care about:

| Message | Meaning |
|---|---|
| `does not escape` | The argument/value stayed on the stack. Good. |
| `escapes to heap` | A value flowed somewhere outliving the function. |
| `moved to heap: x` | A *named local* `x` was promoted to the heap (often because `&x` leaked). |
| `... escapes to heap: ... flow:` (with `-m -m`) | The chain of assignments explaining the escape. |
| `can inline f` / `inlining call to f` | Inlining decisions — relevant because they change escape results. |
| `leaking param: p` | Parameter `p` (or what it points to) escapes through the function. |
| `leaking param content: p` | The *contents* p points to escape, but not p itself. |

The single most useful flag combo is `-gcflags='-m -m'`: the doubled `-m` prints the **flow** — the assignment chain — so you can see *why* something escaped, not just *that* it did.

---

## Code Examples

### Example 1 — Pointer return forces heap

```go
type Point struct{ X, Y int }

func makePoint() *Point {
    p := Point{1, 2}
    return &p
}
```

```
$ go build -gcflags='-m' .
./main.go:4:2: moved to heap: p
```

`p` escapes because the returned pointer outlives `makePoint`.

### Example 2 — Same value, returned by VALUE, stays on stack

```go
func makePointVal() Point {
    p := Point{1, 2}
    return p          // copy of the struct, no pointer leaks
}
```

No `moved to heap` line. The caller gets a copy; `p`'s storage dies with the frame.

### Example 3 — Interface boxing (`fmt.Println`)

```go
func logIt(n int) {
    fmt.Println(n)    // n is converted to interface{} -> boxed
}
```

```
$ go build -gcflags='-m' .
./main.go:4:13: ... n escapes to heap
```

`fmt.Println` takes `...interface{}`. Converting `n` to `interface{}` requires a pointer to the value, and because `Println` (via the un-analyzable `fmt` path) may keep it, `n` escapes. This is why `fmt.Println` in a hot loop allocates.

### Example 4 — "Does not escape" parameter

```go
func sum(p *Point) int {
    return p.X + p.Y  // we only READ through p; never store it
}
```

```
$ go build -gcflags='-m' .
./main.go:2:10: p does not escape
```

The pointer is only dereferenced and read. Nothing about `p` is stored, so the *caller's* value pointed to by `p` need not be heap-allocated on account of `sum`.

### Example 5 — Closure capture

```go
func counter() func() int {
    n := 0
    return func() int { n++; return n }  // closure outlives counter()
}
```

```
$ go build -gcflags='-m' .
./main.go:2:2: moved to heap: n
```

`n` is captured by a closure that's returned, so `n` must live on the heap.

### Example 6 — Slice that escapes via append to a surviving slice

```go
var sink [][]byte

func keep(b []byte) {
    sink = append(sink, b)  // b's backing array is now reachable from a global
}
```

The backing array referenced by `b` escapes because it becomes reachable from the package-level `sink`.

---

## Java / HotSpot Mechanisms

Java's escape analysis is conceptually the same question, but the *payoff* and *timing* differ.

### When it runs

Java escape analysis happens in the **JIT (C2 / the optimizing tier)**, **not** at `javac` time and **not** in the interpreter. So:

- It only fires for **hot** methods that got JIT-compiled.
- It depends heavily on **inlining** — the JIT inlines the allocation site and the methods using the object, *then* analyzes escape across the merged code.
- Cold or rarely-run code keeps allocating normally.

Enabled by default; the relevant flags are `-XX:+DoEscapeAnalysis` (on by default) and `-XX:+EliminateAllocations`.

### What it enables (three optimizations)

1. **Scalar replacement (the big one).** If an object doesn't escape, the JIT can skip allocating it and instead keep each field in a register or local. The object effectively never exists.

   ```java
   // The Point object below typically never reaches the heap when this is hot.
   int dist2(int x, int y) {
       Point p = new Point(x, y); // no-escape
       return p.x * p.x + p.y * p.y;
   }
   ```

   After inlining `Point`'s constructor and field access, `p.x`/`p.y` become plain locals; `new Point` is eliminated.

2. **Stack allocation.** A weaker form (HotSpot mostly relies on scalar replacement rather than true stack allocation of whole objects, but the concept applies).

3. **Lock elision (`-XX:+EliminateLocks`).** If a synchronized object never escapes the thread, no other thread can contend on its monitor, so the JIT removes the locking entirely. Classic example: a method that builds a string with an internally-`synchronized` `StringBuffer` that never escapes — the locks become no-ops.

### How to see it

```
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations ...
java -XX:+PrintCompilation ...
```

(See the professional tier for a full workflow with JITWatch and async-profiler.)

---

## Mental Models

- **"Follow the reference."** Trace every reference to the value. If one reaches a return, a field of something that lives on, a global, a closure, or a function you can't see into — escape. Otherwise — stack/scalar.

- **"Interface = pointer = suspicion."** Whenever a concrete value is widened to an interface (Go) or an `Object`/wrapper (Java), be suspicious: the abstraction holds a reference and often defeats the analysis.

- **"Inlining unlocks the analysis."** Escape decisions are downstream of inlining. If you want stack allocation, you want the surrounding calls inlined.

---

## Pros & Cons

**Pros**
- Removes allocations *for free* in idiomatic code, especially after inlining.
- In Java, can eliminate not just allocation but **synchronization** (lock elision).
- Diagnosable: both Go and HotSpot can show you the decisions.

**Cons**
- **Fragile across edits and across the inlining boundary.** Add a `fmt.Println`, pass a value to an interface, or grow a function past the inlining budget and it flips.
- **Java's version needs warmup** — it doesn't help until the method is JIT-compiled and inlined.
- **Megamorphic / virtual calls defeat it** when the target can't be devirtualized.

---

## Coding Patterns

- **Return values, not pointers, for small structs** in hot code (Go) — avoids forcing the callee's result onto the heap.
- **Keep hot functions small enough to inline** so the analysis can see through the call.
- **Avoid widening to `interface{}` / `any` in hot paths.** Use concrete types; reserve interfaces for boundaries.
- **Reuse buffers** (e.g., `sync.Pool`, preallocated slices) when a value genuinely must escape and is created repeatedly.

---

## Best Practices

- **Diagnose before optimizing.** Run `go build -gcflags='-m -m'` (or HotSpot's allocation-elimination logging) and read the actual decisions.
- **Optimize the proven hot path only.** Most escapes don't matter; profile first.
- **Treat stack placement as an optimization, never a guarantee.** Don't write code whose correctness assumes it.
- **Watch the inlining budget** — large functions stop being inlined, which can silently move allocations to the heap.

---

## Edge Cases & Pitfalls

- **`fmt`/logging in hot loops** is a top allocation source via boxing. Move it out of the loop or use typed, non-boxing logging.
- **Returning an interface** (Go) almost always escapes the underlying value, because the interface header carries a pointer the caller keeps.
- **`leaking param content` vs `leaking param`** are different: the former means only what the pointer *points at* escapes, the latter the pointer itself.
- **Goroutine capture** (`go func(){ use(x) }()`) makes `x` escape to the heap *and* marks it thread-shared.
- **Java cold start:** benchmarking a method once will show allocations because the JIT hasn't compiled it yet — always warm up before concluding "escape analysis isn't working."

---

## Summary

- The analysis is **reachability over a connection graph**: a value escapes if any reference to it can reach something outliving the function (return, field, global, closure, channel) or something the compiler can't analyze (interface, function pointer, reflection).
- It is **conservative** — unknown means escape — and **strongly coupled to inlining**.
- In **Go**, see decisions with `go build -gcflags='-m -m'`: `moved to heap`, `escapes to heap`, `does not escape`, `leaking param`. Top triggers: pointer returns, interface boxing (`fmt.Println`), closures, channel sends.
- In **Java/HotSpot**, escape analysis runs in the **JIT after inlining** and enables **scalar replacement**, limited stack allocation, and **lock elision** (`-XX:+DoEscapeAnalysis`, `-XX:+EliminateAllocations`, `-XX:+EliminateLocks`). It needs warmup.
- Use it as a *guide to write allocation-light hot paths*, not as a contract.
