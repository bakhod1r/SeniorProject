# Escape Analysis — Junior Level

> **Topic:** [Escape Analysis](README.md)
> **Focus:** What escape analysis is, why "stack vs heap" is a decision the compiler makes for you, and the intuition for when a value escapes.

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
10. [Best Practices](#best-practices)
11. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
12. [Summary](#summary)

---

## Introduction

Every value your program creates has to live *somewhere* in memory. Two of the most important places are the **stack** and the **heap**. The stack is fast, automatic, and freed for you when a function returns. The heap is more flexible but costs more — something (a garbage collector or an allocator/`free` call) has to track it and clean it up later.

**Escape analysis** is the compiler optimization that answers one question for each value you allocate:

> *Does this value need to outlive the function that created it?*

If the answer is **no**, the value "does not escape," and the compiler can keep it on the stack — cheap, fast, zero garbage-collection cost. If the answer is **yes** (or "I can't prove otherwise"), the value "escapes to the heap," and it gets the more expensive treatment.

The beautiful part: in languages like Go and Java, **you don't write `malloc` or `new` on the stack vs heap explicitly**. You just create values, and the compiler decides placement for you based on how the value is used. Escape analysis is the brain behind that decision.

---

## Prerequisites

- You know what a **function call** is and that local variables exist while the function runs.
- You have a rough idea of **the stack** (where local variables and call frames live) and **the heap** (a larger pool of memory managed separately).
- You've heard of a **garbage collector (GC)** — a background process that reclaims heap memory no longer in use. (Go and Java both have one.)
- Basic familiarity with **pointers / references** — a value that "points to" another value somewhere in memory.

You do *not* need to know how a compiler is built. We stay at the level of intuition and observable behavior.

---

## Glossary

- **Stack:** Memory tied to a function call. Allocating is nearly free (move a pointer); it's reclaimed automatically when the function returns. Each goroutine/thread has its own.
- **Heap:** A shared memory pool for values whose lifetime isn't tied to a single function call. More expensive to allocate and must be reclaimed later (by GC or manual `free`).
- **Allocation:** Reserving memory to hold a value.
- **Escape:** When a value must live on the heap because it could be reachable *after* the function that created it returns.
- **Does not escape:** The value's lifetime fits entirely inside the function — safe to keep on the stack.
- **Garbage Collector (GC):** Background system that finds and frees heap memory no longer reachable.
- **Pointer / Reference:** A value holding the address of another value.

---

## Core Concepts

### 1. Stack is cheap, heap is expensive

Allocating on the stack is essentially free: the function already has a frame, and the variable lives in it. When the function returns, the whole frame disappears — no cleanup work, no GC.

Allocating on the heap costs more in three ways:
1. The allocator must find space.
2. The GC must later track and reclaim it.
3. More heap traffic means the GC runs more often, which can pause or slow your program.

So **fewer heap allocations → less GC work → smoother, faster programs.** Escape analysis is one of the main tools that keeps allocations off the heap.

### 2. The rule: a value escapes if it can outlive its function

The compiler's job is to be *safe*. A value can only stay on the stack if the compiler can **prove** it won't be used after the function returns. The moment a value might "leak out," it must go to the heap.

Common ways a value escapes:

- **It's returned** as a pointer/reference to the caller.
- **It's stored in something that outlives the function** — a global variable, a field of a long-lived object, a slice/map that survives.
- **Its address is taken and handed to something that keeps it.**
- **It's captured by a closure** (an inner function) that outlives the current call.
- **It's passed to a function the compiler can't see into** (so it conservatively assumes the worst).

If none of these happen, the value does not escape.

### 3. "I can't prove it's safe" means "escape"

Escape analysis is **conservative**. When the compiler is unsure — for example, you call a method through an interface and it can't tell which concrete code runs — it assumes the value escapes. Being conservative keeps your program correct; the cost is a few extra heap allocations.

---

## Real-World Analogies

**The scratch-paper analogy.** Imagine you're doing a calculation. If you need a number only for the next few steps, you jot it on scratch paper and throw it away when you're done — that's the **stack**. But if you compute a result someone else will pick up later (you leave it in the shared inbox), you can't throw it away when you finish — it has to go somewhere durable — that's the **heap**. Escape analysis is you deciding: "Is this just for me right now (scratch), or will someone need it after I leave (inbox)?"

**The hotel room analogy.** A stack value is like a hotel room you check out of when you leave — housekeeping resets it automatically. A heap value is like a storage unit you rent: it stays until *someone* decides to clear it out. If you'll need your stuff after you leave the hotel, you can't leave it in the room; it must go to storage. "Does it escape?" = "Will I need this after checkout?"

---

## Mental Models

- **"Lifetime fits the function" → stack.** Picture the function as a box. If the value never leaves the box, it lives in the box (stack). If a thread of reachability leads *out* of the box, the value must live in the shared house (heap).

- **Escape = a reference leaking outward.** Track where references to a value can travel. If any path leads to something that outlives the function, it escapes.

- **The compiler is a cautious lawyer.** It will only allow stack placement if it can *prove* there's no way the value outlives the call. Doubt = heap.

---

## Code Examples

> Go is the easiest language to *see* escape analysis, because the compiler will literally print its decisions. We use it for the examples; the ideas are the same in Java and other languages.

### Example 1 — A value that does NOT escape

```go
package main

func sumLocal() int {
    x := 10        // local int
    y := 20        // local int
    return x + y   // we return the VALUE, not a pointer
}
```

Here `x` and `y` are used only inside `sumLocal`. We return their *sum* (a copy of a number), not a reference to them. Nothing leaks out. The compiler keeps them on the stack. **No heap allocation.**

### Example 2 — A value that DOES escape

```go
package main

type User struct {
    Name string
}

func newUser(name string) *User {
    u := User{Name: name} // local struct
    return &u             // we return a POINTER to it
}
```

We return `&u` — a pointer to a local variable. The caller will use that pointer *after* `newUser` returns, so `u` must outlive the function. It **escapes to the heap**.

> Note: In some languages (C/C++), returning the address of a local is a **bug** (dangling pointer). In Go and Java this is safe — the compiler simply *promotes* the value to the heap so it stays alive. Escape analysis is what makes this safe automatically.

### Example 3 — See the decision yourself

Run Go's compiler with a flag that prints escape decisions:

```bash
go build -gcflags='-m' main.go
```

For the code above you'll see lines like:

```
./main.go:10:2: moved to heap: u
```

`moved to heap: u` is the compiler telling you `u` escaped. For Example 1 you'll see no such message — those values stayed on the stack.

---

## Pros & Cons

**Pros**
- **Free performance.** You write natural code; the compiler removes heap allocations where it safely can.
- **Less GC pressure** automatically, which means fewer/shorter GC pauses.
- **Safety + speed together.** You can return pointers to locals without worrying about dangling references; the analysis handles it.

**Cons**
- **You can't fully control or rely on it.** A small code change can flip a value from stack to heap unexpectedly.
- **It's conservative.** When the compiler is unsure, it heap-allocates even if you "know" it's safe.
- **Invisible by default.** You only see what happened if you ask the compiler (e.g., `-gcflags=-m`).

---

## Use Cases

- **Hot loops** that create many small temporary values — keeping them on the stack avoids flooding the GC.
- **Constructors / factory functions** that build a small value and return it — knowing whether it escapes tells you the allocation cost.
- **Performance-sensitive services** (web servers, data pipelines) where reducing allocations measurably improves latency.

---

## Best Practices

- **Write clear code first; measure later.** Don't contort code to avoid escapes until profiling shows allocations matter.
- **Prefer returning values over pointers for small data.** A small struct returned by value often stays on the stack; returning a pointer frequently forces a heap allocation.
- **Learn to read the compiler's report** (`go build -gcflags=-m`). It's the only reliable source of truth about what escaped.
- **Don't assume — verify.** "This should stay on the stack" is a guess until the tool confirms it.

---

## Edge Cases & Pitfalls

- **Returning a pointer almost always escapes.** If a function returns `&something`, expect a heap allocation.
- **Passing to "print" functions escapes.** In Go, `fmt.Println(x)` often forces `x` to the heap because of how those functions accept arbitrary types. You'll learn why in the middle tier (it's called "boxing").
- **Closures can capture and leak.** If an inner function uses a local variable and that inner function outlives the call, the variable escapes.
- **"Stack allocation" is not guaranteed by the language.** Go and Java *do not promise* a given value stays on the stack. It's an optimization, not a contract. Never write code whose **correctness** depends on stack placement.

---

## Summary

- Values live on the **stack** (cheap, auto-freed) or the **heap** (flexible, GC-managed, more expensive).
- **Escape analysis** is the compiler optimization that decides which, by asking: *can this value outlive the function that made it?*
- **No → stack** (no GC cost). **Yes / unsure → heap.**
- Values escape mainly by being **returned as pointers, stored somewhere long-lived, captured by closures, or passed to code the compiler can't analyze**.
- In Go you can *see* the decisions with `go build -gcflags='-m'` (look for `moved to heap` / `escapes to heap` / `does not escape`).
- It's a powerful, free optimization — but **conservative and not guaranteed**, so understand it, but never rely on it for correctness.
