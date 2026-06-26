# Stack vs Heap — Junior Level
> **Topic:** [Stack vs Heap](README.md)
> **Focus:** What the two memory regions are, how the call stack works, and why where a value lives matters.

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

When your program runs, it needs places to put data: the number you just read, the user object you fetched, the temporary string you are building. Two of those places have names you will hear constantly: the **stack** and the **heap**.

They are not different kinds of hardware. Both live in the same RAM. The difference is *how the program organizes and reclaims* that RAM. The stack is a small, fast, automatically-managed scratchpad tied to function calls. The heap is a large, flexible pool you ask for explicitly (or that your language asks for on your behalf) and that outlives any single function.

Understanding which one your data lives in explains a surprising number of real bugs and performance questions: why some allocations are "free," why a program crashes on deep recursion, why a pointer to a local variable is a landmine in C, and why "just make a new object" sometimes shows up in a profiler.

## Prerequisites

- You can read a function in at least one language (Go, C, Java, or Python).
- You know what a **variable**, a **function call**, and a **return value** are.
- You have heard the words **pointer** or **reference**, even if fuzzily.
- You know that RAM is a big array of bytes, each with a numeric **address**.

No assembly knowledge is required. We will introduce the few low-level terms you need as we go.

## Glossary

- **Stack:** A region of memory that grows and shrinks automatically as functions are called and return. Last-in, first-out (LIFO).
- **Heap:** A region of memory for data whose lifetime is not tied to a single function call. Managed explicitly (C) or by a garbage collector (Go, Java, Python).
- **Stack frame (activation record):** The slice of the stack belonging to one function call. Holds that call's parameters, local variables, return address, and saved registers.
- **Stack pointer (SP):** A CPU register that points at the current top of the stack.
- **Allocation:** Reserving memory to hold a value.
- **Deallocation / freeing:** Releasing memory so it can be reused.
- **Lifetime:** The span of time during which a piece of data is valid to use.
- **Pointer / reference:** A value that holds the address of some other data, rather than the data itself.
- **Local variable:** A variable declared inside a function, visible only there.

## Core Concepts

### Two regions, one job: hold your data

Every running program has a layout in memory. A simplified picture:

```
high addresses
┌──────────────────────────┐
│   Stack (grows DOWN ↓)    │   ← function calls live here
│                          │
│            ⋮             │
│                          │
│   Heap (grows UP ↑)      │   ← new/malloc'd objects live here
├──────────────────────────┤
│   Global / static data   │
├──────────────────────────┤
│   Program code           │
└──────────────────────────┘
low addresses
```

The two regions grow toward each other from opposite ends. This is a layout convention, not a law of physics, but it is what almost every system you will touch does.

### The stack follows your function calls

The stack exists to make function calls work. Here is the key idea: **every time you call a function, the program pushes a new frame onto the stack. Every time a function returns, that frame is popped off.**

A frame holds everything a single call needs:

- The **parameters** passed in.
- The function's **local variables**.
- The **return address** — where to jump back to when this function finishes.
- Sometimes **saved registers** the function must restore before returning.

Because calls finish in the reverse order they started (the function you called most recently returns first), the stack is **LIFO**: last in, first out. That is exactly why it is called a stack — like a stack of plates.

Trace this:

```
main() calls greet()        → push greet's frame
greet() calls format()      → push format's frame
format() returns            → pop format's frame
greet() returns             → pop greet's frame
```

When `format()` returns, its locals vanish instantly. Nobody had to "clean them up." Moving the stack pointer back *is* the cleanup.

### Stack allocation is almost free

How does the program reserve space for a function's locals? It just moves the stack pointer. To give a frame 64 bytes, the CPU subtracts 64 from the stack pointer (the stack grows down, so reserving means subtracting). To release them, it adds 64 back. That is one arithmetic instruction.

There is no searching, no bookkeeping, no list of free blocks. This is why people say stack allocation is "nearly free."

### The heap is for data that outlives a function

Sometimes a value must live longer than the function that created it. Say you build a list of users and return it to your caller. If that list lived on the current frame, it would be destroyed the instant you returned — useless. So it goes on the **heap** instead.

Heap memory is requested explicitly or implicitly:

- In **C**, you call `malloc(size)` and later `free(ptr)`.
- In **Go, Java, Python**, you create an object (`new`, `make`, `[]`, a class instance) and a **garbage collector** later reclaims it when nothing points to it anymore.

The heap's superpower is **arbitrary lifetime**: data lives until you (or the GC) decide it is done, independent of any function's start and end.

Its cost is that *somebody has to keep track*. The allocator must find a free chunk of the right size, hand it out, and later remember the chunk is free again. That bookkeeping is why heap allocation is meaningfully slower than bumping the stack pointer.

### Lifetime is the real distinction

Beginners often think "small = stack, big = heap" or "primitive = stack, object = heap." Those are rough rules of thumb, but the *real* rule is **lifetime**:

- If a value's life begins and ends inside one function call → it can live on the **stack**.
- If a value must survive past the function that made it → it must live on the **heap**.

Hold on to that. Almost everything else follows from it.

## Real-World Analogies

**The whiteboard vs the filing cabinet.** The stack is a whiteboard next to your desk. When you start a task you write your scratch notes; when you finish, you wipe that section clean and the space is instantly reusable. The heap is a filing cabinet down the hall. You can store a folder there and it stays until someone explicitly throws it away — even after you have left the room. Fast scratch work goes on the whiteboard; anything that must outlive your current task goes in the cabinet.

**A stack of cafeteria trays.** You can only take the top tray and only add to the top. That is LIFO. The most recently added tray is the first one removed — exactly how function frames behave.

**Coat check.** The heap is a coat-check counter. You hand over your coat (data), get a ticket (a pointer), and walk away. The coat persists independently of where you go. You can pass the ticket to a friend. But if you lose the ticket and never reclaim the coat, it sits there forever — that is a **memory leak**.

## Mental Models

- **The stack is a tape measure.** Pull it out (call a function), push it back in (return). The number on the tape is the stack pointer. Nothing is ever "deleted"; the pointer just moves.
- **A pointer is a home address, not the house.** Passing a pointer is like texting someone an address. Cheap to send. But if the house gets demolished (the data is freed or the frame popped) and you visit the address, you find rubble. That is a **dangling pointer**.
- **The heap is shared; the stack is private.** Each thread has its *own* stack. The heap is shared across all threads, which is exactly why heap access sometimes needs locks and stack access never does.

## Code Examples

### Go — a value that escapes to the heap

```go
package main

import "fmt"

// stays on the stack: x lives and dies inside this function
func sumLocal() int {
    x := 41   // local, used here, then gone
    return x + 1
}

// escapes to the heap: the caller keeps a pointer to p,
// so p must outlive newUser, so Go puts it on the heap.
func newUser(name string) *string {
    p := name
    return &p   // returning the address of a local
}

func main() {
    fmt.Println(sumLocal())       // 42
    fmt.Println(*newUser("ada"))  // ada
}
```

In Go, returning `&p` is *safe*. The compiler notices the pointer outlives the function and quietly moves `p` to the heap. You can see this decision with `go build -gcflags=-m`.

### C — the same pattern is a bug

```c
#include <stdio.h>

int* broken(void) {
    int x = 42;
    return &x;     // BUG: x lives on broken's frame, which is gone after return
}

int main(void) {
    int *p = broken();   // p points at reclaimed stack memory
    printf("%d\n", *p);  // undefined behavior: garbage, crash, or "works" by luck
}
```

C does *not* rescue you. The frame holding `x` is popped on return, and `p` points into reclaimed memory. To return data that outlives the function in C, you must put it on the heap with `malloc` and free it later.

### Python — names are references to heap objects

```python
def make_list():
    data = [1, 2, 3]   # the list object lives on the heap
    return data        # we return a reference; the object survives

nums = make_list()
print(nums)            # [1, 2, 3] — perfectly fine
```

In Python you almost never think about stack vs heap directly: essentially every object lives on the heap, and variable names are just references to it. There is no `&x` footgun here.

## Pros & Cons

**Stack**

- Pros: Extremely fast allocation (move a pointer); automatic cleanup on return; great cache locality; no fragmentation; thread-private, so no locking.
- Cons: Limited size (often ~1–8 MB per thread); lifetime is tied to scope, so you cannot keep data past the function; deep recursion or huge locals can overflow it.

**Heap**

- Pros: Flexible, arbitrary lifetime; can hold large data; can be shared across functions and threads; size limited only by available memory.
- Cons: Slower to allocate and free; needs bookkeeping (an allocator or GC); can fragment over time; bugs like leaks, use-after-free, and double-free live here.

## Use Cases

- **Stack:** loop counters, function parameters, small fixed-size structs, temporary values, anything whose life ends when the function returns.
- **Heap:** objects returned to callers, data structures that grow at runtime (lists, maps, trees), anything shared between threads, anything too large to safely fit in a frame (e.g., a 10 MB buffer).

## Best Practices

- **Prefer the stack when you can.** It is faster and self-cleaning. Many languages do this automatically; do not fight them by allocating on the heap "just in case."
- **In C, never return the address of a local.** If the data must outlive the function, `malloc` it (and document who frees it).
- **Match every `free` to exactly one `malloc`.** Freeing twice or never are both bugs.
- **Don't put huge arrays on the stack.** A `char buf[10*1024*1024]` local can overflow the stack instantly. Heap-allocate large buffers.
- **In managed languages, let the runtime decide.** Trust Go's escape analysis and Java's/Python's heap model; optimize only when a profiler points you there.

## Edge Cases & Pitfalls

- **Dangling pointer:** keeping a pointer to data that has been freed or to a popped stack frame. Reading it is undefined behavior.
- **Stack overflow:** the stack runs out of room — usually from infinite or very deep recursion, or a giant local array. The program crashes (often with a `SIGSEGV` or `StackOverflowError`).
- **Memory leak:** heap data that is never freed and never collected because something still (mistakenly) references it, or the pointer was lost. Memory usage grows until the process dies.
- **"It works on my machine":** dangling-pointer code in C may *appear* to work because the reclaimed memory has not been overwritten yet. That is luck, not correctness.

## Summary

- Both stack and heap live in RAM; the difference is **how memory is organized and reclaimed**.
- The **stack** holds function call frames (parameters, locals, return address). It is LIFO, grows downward, and allocation is nearly free because it just moves a pointer. Cleanup happens automatically on return.
- The **heap** holds data with arbitrary lifetime. It is flexible but slower, requires bookkeeping (a manual allocator or a garbage collector), and is where leaks and use-after-free bugs live.
- The real distinction is **lifetime**: data confined to one call can live on the stack; data that must outlive its creating function must live on the heap.
- In C you must manage this yourself, and returning a pointer to a local is a classic bug. Managed languages (Go, Java, Python) decide for you and prevent that whole class of mistakes.
