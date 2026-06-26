# Tracing Garbage Collection — Junior Level

> **Topic:** [Tracing Garbage Collection](README.md)
> **Focus:** What "garbage" means, how a collector decides what is alive by following pointers from roots, and the basic mark-sweep cycle.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
- [Real-World Analogies](#real-world-analogies)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Pros & Cons](#pros--cons)
- [Use Cases](#use-cases)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

When your program allocates an object — a slice, a struct, a list, a closure — that memory has to be returned to the system eventually, or the program slowly eats all available RAM and dies. In languages like C you do this by hand with `free()`. In languages like Go, Java, Python, JavaScript, and C# a **garbage collector (GC)** does it for you automatically.

A **tracing garbage collector** answers one question: *which objects can the program still reach?* Anything it can reach is kept. Everything else is garbage and its memory is reclaimed. The word "tracing" means the collector literally **traces** pointers from a set of starting points, hopping object-to-object, marking everything it finds.

This tier explains the foundation: what "reachable" means, why that is a safe definition of "alive", and how the simplest tracing algorithm — **mark-sweep** — actually works. You do not need to know the fancy collectors yet. You need to understand the core idea so deeply that every later algorithm is "the same idea, but faster".

## Prerequisites

- **Pointers / references.** You should know that a variable can *hold* an object or *point to* one. Two variables can point to the same object.
- **The stack and the heap.** Local variables and call frames live on the **stack**; dynamically allocated objects live on the **heap**. The GC manages the heap.
- **Basic graph intuition.** Objects with pointers between them form a graph: objects are nodes, pointers are edges.

## Glossary

- **Object:** A chunk of heap memory the program allocated (a struct, array, list node, string buffer, etc.).
- **Reference / pointer:** A value that tells you where an object lives in memory.
- **Root:** A reference the program can use *directly*, without going through another object — local variables on the stack, CPU registers, and global variables.
- **Reachable / live:** An object you can get to by starting at a root and following pointers. Live objects must be kept.
- **Garbage / dead / unreachable:** An object you *cannot* reach from any root. The program can never touch it again, so it is safe to reclaim.
- **Mark:** The phase that finds and flags all reachable objects.
- **Sweep:** The phase that walks the heap and frees everything not marked.
- **Free list:** A list of reclaimed memory slots the allocator can reuse.
- **GC cycle:** One full run of the collector: mark, then sweep.

## Core Concepts

### Reachability is the definition of "alive"

The collector cannot read your mind. It does not know whether you *intend* to use an object again. It uses a simpler, mechanical rule that is provably safe:

> **An object is alive if and only if the program can reach it by following pointers from a root.**

Why is this safe? Because to *use* an object, your code must eventually hold a reference to it. References come from somewhere — a local variable, a field of another reachable object, a global. If there is no chain of pointers from any root to an object, no line of code you could possibly execute will ever touch it again. It is genuinely dead.

The flip side is important and sometimes surprising: **reachable does not mean "needed".** If you keep a pointer to a huge object in a global variable but never use it, the GC will faithfully keep it forever. That is a *memory leak in a garbage-collected language* — the collector is doing exactly what you told it.

### Roots: where tracing starts

Roots are the entry points into the object graph. They are the references the running program can touch right now without dereferencing anything:

- **The call stack:** every active function's local variables and parameters that hold references.
- **CPU registers:** values currently held in registers (a local variable may live in a register, not memory).
- **Global / static variables:** package-level variables in Go, `static` fields in Java, module globals in Python.

The collector scans all of these to build the starting set, then traces outward.

### Tracing: the graph walk

Starting from the roots, the collector visits every reachable object exactly once, following each pointer it finds:

1. Put all root-referenced objects in a "to visit" set.
2. Take one object out. Mark it. Look at every pointer field it contains.
3. For each pointer, the object it points to is reachable too — add it to "to visit" (if not already marked).
4. Repeat until "to visit" is empty.

This is just **breadth-first or depth-first search over the object graph**. When it finishes, everything marked is live; everything else is garbage.

### Mark-sweep: the simplest tracing collector

**Mark-sweep** has two phases:

1. **Mark.** Trace from roots, setting a "mark bit" on every reachable object.
2. **Sweep.** Walk the entire heap linearly. Any object whose mark bit is *not* set is garbage — reclaim it (add its space to a free list). Clear the mark bits of survivors so the next cycle starts fresh.

That is the whole algorithm. Allocation later pulls free slots off the free list. When the free list runs low, you run another GC cycle.

### Tracing vs reference counting

There is a second family of automatic memory management: **reference counting (refcount)**. Each object stores a count of how many references point to it. When the count drops to zero, the object is freed immediately. CPython uses this as its primary mechanism.

| | **Tracing GC** | **Reference Counting** |
|---|---|---|
| When work happens | In batches (GC cycles) | Continuously, on every assignment |
| Cycles (A→B→A) | Collected correctly | **Leaks** unless a backup collector exists |
| Pause behavior | Can pause the program | Spread out, but can cascade |
| Bookkeeping cost | Lower per-pointer | A count update on every reference change |

The killer weakness of plain reference counting: **reference cycles**. If A points to B and B points back to A, each has count 1 even after the program drops them, so they are never freed. Tracing GC has no such problem — if A and B are not reachable from a root, neither gets marked, so both are collected. This is the main reason tracing collectors dominate.

## Real-World Analogies

**The flashlight in a dark warehouse.** You stand at the doors (the roots) and shine flashlights down every aisle, following the beams as far as they reach. Every box the light touches gets a chalk mark. When you are done, the cleanup crew throws out every box *without* a chalk mark — those boxes are in corners no light reached, so no one can get to them anyway.

**Party guests and the host.** The host (a root) knows some guests directly. Those guests introduce friends, who introduce more friends. Anyone connected to the host through a chain of introductions belongs at the party (live). A person nobody can introduce you to through any chain is a gate-crasher with no way back to the host — they get escorted out (collected).

## Mental Models

- **The object graph.** Picture the heap as a graph: objects are dots, pointers are arrows. Roots are special dots pinned to the edge of the page. Live = "connected to a pinned dot by arrows". Garbage = "floating island, disconnected from every pinned dot".

- **Reachability, not usefulness.** The GC keeps what is *connected*, not what is *useful*. A forgotten reference in a global cache keeps a graveyard of objects alive.

- **Mark = paint, sweep = vacuum.** Mark paints the survivors. Sweep vacuums up everything unpainted, then wipes the paint off so next time starts clean.

## Code Examples

A tiny mark-sweep, in pseudocode-flavored Go. This is deliberately naive (real collectors are far more careful), but it captures the whole idea.

```go
type Object struct {
    marked   bool
    children []*Object // pointers this object holds
}

var roots []*Object // stack vars, globals, etc.
var heap  []*Object // every object ever allocated

// MARK: trace from roots, set the mark bit on everything reachable.
func mark() {
    var worklist []*Object
    for _, r := range roots {
        worklist = append(worklist, r)
    }
    for len(worklist) > 0 {
        obj := worklist[len(worklist)-1]
        worklist = worklist[:len(worklist)-1]

        if obj == nil || obj.marked {
            continue // skip nil and already-visited (handles cycles!)
        }
        obj.marked = true
        for _, child := range obj.children {
            worklist = append(worklist, child)
        }
    }
}

// SWEEP: free the unmarked, un-mark the survivors for next time.
func sweep() {
    survivors := heap[:0]
    for _, obj := range heap {
        if obj.marked {
            obj.marked = false   // reset for the next cycle
            survivors = append(survivors, obj)
        } else {
            free(obj)            // reclaim: real GC adds to a free list
        }
    }
    heap = survivors
}

func collect() {
    mark()
    sweep()
}
```

Notice the `obj.marked` check in `mark()`: it is what makes cycles safe. If A and B point to each other, the second time we reach an already-marked object we just stop. Reference counting cannot do this for free.

## Pros & Cons

**Pros**
- **No manual `free`.** Whole classes of bugs disappear: no use-after-free, no double-free, far fewer leaks.
- **Collects cycles.** Unlike plain reference counting.
- **Simpler code.** You allocate and forget.

**Cons**
- **Pauses.** The simplest collectors stop your program while they run ("stop-the-world").
- **Throughput cost.** Tracing the whole live set takes CPU that could run your code.
- **Memory headroom.** A GC heap needs spare room so collection does not run constantly — it uses more RAM than tight manual management.
- **Less control.** You do not decide exactly when memory is freed.

## Use Cases

Tracing GC is the default in most modern application languages — Go, Java, C#, JavaScript, Python (alongside refcounting), Ruby, Kotlin, Scala. You will meet it any time you write a web service, a CLI tool, a mobile app, or a script in these languages. You do *not* meet it in C, C++, Rust, or Zig, which manage memory manually or via ownership/lifetimes instead.

## Best Practices

- **Drop references you no longer need.** Set a long-lived field to `nil`/`null` when done with a big object, especially in caches, slices, and maps. The GC can only reclaim what becomes unreachable.
- **Beware accidental retention.** A slice that still backs a giant array, a closure that captures a big struct, or a map that never deletes entries can keep memory alive forever.
- **Do not fight the GC early.** Write clear code first. Profiling, tuning, and worrying about pauses come later (and at higher tiers).
- **Understand "reachable ≠ needed".** Most "GC leaks" are really *you* holding a reference you forgot about.

## Edge Cases & Pitfalls

- **The forgotten global.** Anything reachable from a global lives forever. Unbounded global maps/caches are the #1 cause of leaks in GC languages.
- **Cycles only matter for refcounting.** New learners often worry tracing GC can't handle `A↔B`. It can — that is one of its strengths.
- **Finalizers are not destructors.** Some languages let you run code when an object is collected, but *when* (or whether) that happens is unpredictable. Never rely on a finalizer to release files, locks, or sockets.
- **Memory is not freed instantly.** An object becomes collectable the moment it is unreachable, but it is not reclaimed until the next GC cycle decides to run.

## Summary

A tracing garbage collector keeps an object alive if and only if the program can **reach** it by following pointers from a **root** (stack, registers, globals). It **marks** everything reachable, then **sweeps** away everything unmarked. This naturally collects reference cycles, which is why it dominates over plain reference counting. The cost is pauses, CPU overhead, and extra memory headroom. The single most important practical idea: *reachable is not the same as needed* — the way to "help" the GC is to stop holding references you no longer use.
