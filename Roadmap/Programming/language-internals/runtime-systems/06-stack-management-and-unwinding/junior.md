# Stack Management & Unwinding — Junior Level

> **Topic:** [Stack Management & Unwinding](README.md)
> **Focus:** What a call stack actually is, what one stack frame contains, and how a program "returns" — the mechanics behind every function call you have ever written.

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

> Focus: **What is the call stack, and what happens — byte by byte — when one function calls another and then returns?**

Every time you write `foo()`, the CPU does some bookkeeping you never see. It needs to remember *where to come back to* when `foo` finishes. It needs somewhere to put `foo`'s local variables. And when `foo` returns, all of that has to be cleaned up so the program continues exactly where it left off. The data structure that makes this work is the **call stack**, and the chunk of it that belongs to one function call is a **stack frame** (sometimes called an *activation record*).

The stack is one of the two big regions of memory your program uses. The other is the **heap**. The heap is where long-lived, dynamically-sized things live (the objects you `new` or `malloc`). The stack is where the *short-lived, call-scoped* things live: the return address, the function's local variables, and saved CPU registers. The key property of the stack is in its name — it grows and shrinks like a stack of plates. The most recently called function is always "on top," and it must finish (be popped) before the one below it resumes.

In one sentence: **the call stack is the program's memory of "how did I get here, and where do I go back to."**

> 🎓 **Why this matters for a junior:** The two error messages that will haunt your early career are `StackOverflowError` / `stack overflow` (infinite recursion) and the stack trace printed when something crashes. Both are this topic. A stack trace *is* a snapshot of the call stack, read from top to bottom. Once you understand what a frame is, a backtrace stops being noise and becomes a precise map of exactly how your program reached the line that blew up.

This page covers: what a stack frame contains (return address, saved frame pointer, locals), how `call` and `return` work at the machine level, what the **stack pointer** and **frame pointer** are, what a stack trace really shows you, and what "stack overflow" means. The next level (`middle.md`) covers calling conventions, the red zone, and frame-pointer omission; `senior.md` covers unwind tables (DWARF CFI) and exception unwinding; `professional.md` covers growable stacks (Go), guard pages, and profiling.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and call a function in at least one language.
- **Required:** What a *local variable* is and that it disappears when the function returns.
- **Required:** A rough idea that a program lives in *memory* made of numbered addresses.
- **Helpful but not required:** What a *pointer* is (a value that holds an address).
- **Helpful but not required:** Having seen a stack trace from a crash or exception.

You do **not** need to know:

- Assembly language (we will show a little, with full explanation).
- Calling conventions, the red zone, or shadow space (that's `middle.md`).
- DWARF unwind tables or exception unwinding (that's `senior.md`).
- Anything about garbage collection or growable goroutine stacks (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Call stack** | The region of memory that grows with each function call and shrinks with each return. One per thread. |
| **Stack frame** | The slice of the call stack belonging to *one* active function call. Also called an **activation record**. |
| **Activation record** | A formal synonym for stack frame: the record of one live "activation" of a function. |
| **Stack pointer (SP)** | A CPU register that always points at the *top* of the stack — the current frame's edge. On x86-64 it is `rsp`. |
| **Frame pointer (FP) / base pointer** | A CPU register that points at a *fixed* spot in the current frame, used as a stable anchor for finding locals and walking the stack. On x86-64 it is `rbp`. |
| **Return address** | The address of the instruction to resume at after the called function returns. Pushed onto the stack by the `call` instruction. |
| **Local variable** | A variable scoped to one function call. Usually stored in the function's stack frame (or in a register). |
| **Caller** | The function that does the calling. |
| **Callee** | The function being called. |
| **Push / Pop** | Adding a value on top of the stack / removing the top value. |
| **Stack growth direction** | On almost all mainstream CPUs the stack grows toward *lower* addresses: pushing *decreases* the stack pointer. |
| **Stack trace / backtrace** | A human-readable list of the active frames, from the innermost (where you are now) outward to `main`. |
| **Stack overflow** | The error you get when the stack grows past its allotted size — usually from runaway recursion. |
| **`call` instruction** | The CPU instruction that pushes the return address and jumps to a function. |
| **`ret` instruction** | The CPU instruction that pops the return address and jumps back to it. |
| **Prologue / Epilogue** | The few instructions at a function's start/end that set up and tear down its frame. |

---

## Core Concepts

### 1. The Stack Is a Stack

The "stack" in *call stack* is the same stack you meet in data structures: last-in, first-out. When `main` calls `a`, and `a` calls `b`, and `b` calls `c`, the stack looks like this (drawn with `main` at the bottom, the way most debuggers print it):

```text
    +---------------------+  <- top of stack (lowest address), current SP
    |  frame for c()      |   c is running right now
    +---------------------+
    |  frame for b()      |   b is paused, waiting for c to return
    +---------------------+
    |  frame for a()      |   a is paused, waiting for b
    +---------------------+
    |  frame for main()   |   main is paused, waiting for a
    +---------------------+  <- bottom of stack (highest address)
```

`c` must return before `b` resumes; `b` before `a`; `a` before `main`. You can never return into the *middle* of the stack — only the top frame is live. This is exactly why the most recent call is at the "top" of a stack trace.

### 2. What Is Inside One Frame

A single stack frame typically holds, from a junior's point of view, three things:

1. **The return address** — "when I'm done, jump back to *here* in my caller." Without this, the program could not find its way home.
2. **The saved frame pointer** — the previous frame's anchor, so we can restore it on return and so tools can walk the chain (more on this below).
3. **Local variables and temporaries** — the function's `int x`, its arrays, anything that doesn't fit in or got pushed out of registers.

```text
   higher addresses
   +------------------------+
   |  arguments / caller's  |
   |  stuff (above)         |
   +------------------------+
   |  return address        |  <- pushed by the `call` instruction
   +------------------------+
   |  saved frame pointer   |  <- the caller's FP, saved by the prologue
   +------------------------+  <- FP (rbp) points here
   |  local variable a      |
   |  local variable b      |
   |  ... temporaries ...   |
   +------------------------+  <- SP (rsp) points here (top)
   lower addresses
```

The exact layout depends on the platform's *calling convention*, which you'll meet in `middle.md`. For now the takeaway is: **a frame is just a small block of memory with a fixed structure, and the CPU has registers pointing at it.**

### 3. The Two Pointers: SP and FP

Two CPU registers track the stack:

- The **stack pointer** (`rsp` on x86-64) always points at the very top — the current edge. Every `push` decrements it; every `pop` increments it.
- The **frame pointer** (`rbp` on x86-64), when used, points at a *fixed* spot inside the current frame. Because the stack pointer moves around as the function pushes and pops temporaries, the frame pointer gives a *stable* reference: "local `x` is always `rbp - 8`, no matter what SP is doing."

The frame pointer also forms a **linked list**. Each frame saves the caller's frame pointer. So starting from the current `rbp`, you can follow the chain — `rbp` points at a slot that holds the *previous* `rbp`, which points at a slot holding the one before that — all the way down to `main`. Right next to each saved frame pointer sits the return address. **Following that chain is how a debugger draws a backtrace.** (In `middle.md` you'll learn that compilers sometimes drop the frame pointer to free up a register, which is why this simple chain-walk doesn't always work.)

### 4. `call` and `ret`

Two CPU instructions do the heavy lifting:

- `call foo` does two things atomically: it **pushes the return address** (the address of the instruction right after the `call`) onto the stack, then **jumps** to `foo`.
- `ret` does the reverse: it **pops the return address** off the stack into the program counter, so execution resumes in the caller.

Between them, the called function runs its **prologue** (set up its frame), its body, and its **epilogue** (tear the frame down), leaving the stack exactly as it found it so that `ret` lands cleanly.

### 5. A Stack Trace Is Just the Frame Chain, Printed

When your program crashes or you call something like Java's `Thread.dumpStack()` or Python's `traceback.print_stack()`, the runtime walks the live frames from the top down and prints, for each one, *which function it is* and *what source line it was at*. That's all a stack trace is: **the call stack, made readable.** The top line is where you are now; each line below is the caller that got you there.

---

## Real-World Analogies

- **A stack of nested phone calls.** You're on a call (`main`). Someone calls you about a question, so you put the first person on hold (`a`). While on that call, a third question comes up, so you put the second on hold too (`b`). You must finish the newest call before returning to the one you put on hold most recently. You can't pick up the *first* person while the third is still talking. That hold order *is* the call stack.

- **A pile of sticky notes.** Each function call slaps a sticky note on top of the pile saying "I was doing X, come back to line 42 when done" — that note is the return address. When the function finishes, it peels its note off. The pile only ever grows or shrinks at the top.

- **A trail of breadcrumbs.** The chain of saved frame pointers and return addresses is a breadcrumb trail leading from where you are now all the way back to `main`. A debugger follows the breadcrumbs to tell you how you got here. If someone omits the breadcrumbs to save space (frame-pointer omission), the debugger needs a *map* instead — that map is the unwind table you'll meet in `senior.md`.

- **Plates at a buffet.** You can only take from or add to the *top* of the plate stack. The plate at the bottom (`main`) is the last one you'll ever touch.

---

## Mental Models

- **"The stack is the program's short-term memory of how it got here."** The heap remembers *things*; the stack remembers *the path*.

- **"One frame = one promise to return."** Every frame on the stack is a function that hasn't finished yet and is owed a return.

- **"Top of stack = innermost call = where the action is."** When reading a crash, start at the top. That's the actual point of failure; everything below is context for *how* you got there.

- **"SP is the live edge; FP is the anchor."** SP moves constantly during a function; FP stays put so locals have stable addresses.

- **"Returning is just resetting two registers."** The epilogue restores the saved frame pointer and lets `ret` reset the program counter. The old frame isn't erased — it's just *abandoned* by moving SP back up, ready to be overwritten by the next call.

---

## Code Examples

### Example 1: Recursion makes the stack visible

```python
# Python — every recursive call adds a frame; the trace shows them all.
import traceback

def countdown(n):
    if n == 0:
        traceback.print_stack()   # print the live call stack right here
        return
    countdown(n - 1)

def main():
    countdown(3)

main()
```

The printed stack will list, top to bottom: `print_stack` is called from `countdown(0)`, which was called from `countdown(1)`, from `countdown(2)`, from `countdown(3)`, from `main`, from module top-level. **Each recursive call is one frame.** This is exactly why deep recursion eventually overflows the stack — every call adds a frame and nothing is popped until the base case is hit.

### Example 2: Watching a stack overflow happen

```python
# Python caps recursion to protect you (default ~1000 deep).
import sys

def recurse(n):
    return recurse(n + 1)   # no base case — infinite recursion

try:
    recurse(0)
except RecursionError as e:
    print("Hit the recursion limit:", e)
    print("Python's safety net stops you before the real OS stack overflows.")
    print("Current limit:", sys.getrecursionlimit())
```

Python raises a *clean* `RecursionError` because it counts frames itself. Lower-level languages have no such net: in C, infinite recursion runs the *real* OS stack into its guard page and the program dies with a `SIGSEGV` ("segmentation fault"). Same root cause, different report.

### Example 3: A frame holds locals — and they vanish on return

```c
#include <stdio.h>

int* dangerous(void) {
    int local = 42;
    return &local;   // BUG: returning a pointer into our own frame
}                    // <- frame is abandoned here; `local` is gone

int main(void) {
    int *p = dangerous();
    // *p now points into a frame that no longer exists.
    // The memory may still hold 42... or garbage... or the next call's data.
    printf("%d\n", *p);   // undefined behavior
    return 0;
}
```

This is one of the most important junior lessons about the stack: **local variables live in the frame, and the frame is gone the instant the function returns.** A pointer into a returned frame is a *dangling pointer*. The bytes might still read `42` right after the call (nothing has overwritten them yet), which makes this bug terrifyingly inconsistent.

### Example 4: Reading a real backtrace (the most useful skill here)

```text
Traceback (most recent call last):
  File "app.py", line 20, in <module>
    main()
  File "app.py", line 16, in main
    result = process(data)
  File "app.py", line 11, in process
    return transform(item)
  File "app.py", line 6, in transform
    return 100 / value       <-- the actual crash
ZeroDivisionError: division by zero
```

Read it from the **bottom**: the error (`ZeroDivisionError`) happened in `transform`, at line 6. `transform` was called by `process` (line 11), which was called by `main` (line 16), which was called by the top-level script (line 20). The chain of frames tells you the *exact path* the program took to reach the bug. (Note: Python prints oldest-first; many languages, including Java and Go, print innermost-first. Always check which end is the crash.)

### Example 5: A peek at the assembly (don't memorize — just see the shape)

```asm
; x86-64. A textbook function prologue and epilogue.
my_func:
    push  rbp           ; save the caller's frame pointer
    mov   rbp, rsp      ; set up OUR frame pointer
    sub   rsp, 16       ; reserve 16 bytes for local variables
    ; ... function body uses [rbp-8], [rbp-16] for locals ...
    mov   rsp, rbp      ; discard locals (epilogue)
    pop   rbp           ; restore caller's frame pointer
    ret                 ; pop return address, jump back to caller
```

This is the whole life of a frame in six lines. The first two instructions (the prologue) build the frame and chain the frame pointers together; the last three (the epilogue) tear it down and return. **Everything in this topic is variations on this pattern.**

---

## Pros & Cons

**Why the stack is great:**

| Strength | Why it matters |
|----------|----------------|
| **Extremely fast allocation** | Allocating a frame is just *subtracting from the stack pointer*. One instruction. No heap allocator, no bookkeeping. |
| **Automatic cleanup** | When a function returns, its whole frame is freed by *resetting one register*. No `free()`, no garbage collector needed. |
| **Great cache locality** | The top of the stack is touched constantly and stays hot in the CPU cache. |
| **Natural call tracking** | The structure *is* the record of how you got here — that's what gives you stack traces for free. |

**The trade-offs:**

| Weakness | Why it bites |
|----------|--------------|
| **Fixed (limited) size** | A thread's stack is typically capped (often ~1 MB / 8 MB). Blow past it and you overflow. |
| **No outliving the call** | Anything in a frame dies on return — you can't hand out pointers to it. |
| **LIFO only** | You can only free the top. Long-lived or out-of-order lifetimes must go on the heap. |
| **Recursion is bounded** | Deep or unbounded recursion overflows. The heap doesn't have this limit. |

---

## Use Cases

- **Function locals and arguments.** The overwhelmingly common case: small, call-scoped data lives in the frame and is free to allocate and free.
- **Recursion and tree/graph walks.** Each level of depth is one frame; the stack naturally tracks where you are.
- **Reading crashes and debugging.** Every exception, panic, or fault gives you a stack trace — knowing how to read it is the single highest-value debugging skill.
- **Understanding "why is this nil/null here?"** Following the frames in a debugger shows you exactly which caller passed the bad value.

---

## Coding Patterns

**Pattern: Return values, not pointers to locals.** If a function needs to produce data that outlives it, return the *value* (which gets copied into the caller's frame) or allocate on the heap and return that pointer — never return the address of a local.

```c
// BAD: pointer into a dead frame.
int* bad(void) { int x = 5; return &x; }

// GOOD: return the value (copied into the caller).
int good(void) { int x = 5; return x; }

// GOOD: heap-allocate if it must outlive the call (remember to free).
int* good_heap(void) { int *x = malloc(sizeof(int)); *x = 5; return x; }
```

**Pattern: Convert deep recursion to iteration when depth is unbounded.** If recursion depth depends on *input size* (a million-node linked list, a deeply nested JSON), you risk a stack overflow. Rewrite it as a loop with an explicit stack on the heap, which can grow far larger than the call stack.

**Pattern: Always look at the top frame first.** When triaging a crash, read the innermost frame — that's where it actually broke. Then walk outward to understand *why* the bad input arrived there.

---

## Best Practices

1. **Keep large data off the stack.** Don't put a giant array (e.g. `char buf[1_000_000]`) as a local — it can blow the stack in one shot. Heap-allocate big buffers.
2. **Bound your recursion.** If recursion depth scales with untrusted input, you have a denial-of-service waiting to happen. Add a depth limit or rewrite iteratively.
3. **Never hand out a pointer to a local.** It's the classic dangling-pointer bug. The frame dies on return.
4. **Learn to read backtraces fluently.** Practice on real crashes. Identify the crash frame, the caller chain, and the line numbers.
5. **Don't disable the safety nets carelessly.** Python's recursion limit and your language's stack-size defaults exist for a reason. Raise them deliberately, not reflexively.
6. **Prefer values and references with clear ownership.** Languages like Rust make the "no pointer to a dead frame" rule a *compile error* — lean on that.

---

## Edge Cases & Pitfalls

- **Returning a pointer/reference to a local.** The frame is gone; the pointer dangles. In C/C++ it's undefined behavior; in Rust the borrow checker rejects it at compile time. Always the same root cause.
- **Stack overflow from deep recursion.** No base case, or depth scaling with input. In managed languages you get a clean error (`StackOverflowError`, `RecursionError`); in C you usually get a raw segfault.
- **A huge local variable.** A multi-megabyte array declared as a local can overflow the stack on the *very first call*, before any recursion. Move it to the heap.
- **Misreading which end of the trace is the crash.** Python and Java/Go print in *opposite* orders. Find the actual error line first, then trace the callers.
- **Capturing a reference in a closure that outlives the frame.** In some languages a closure can accidentally capture a stack local; the runtime usually "boxes" it onto the heap to keep it alive, but in unsafe languages this is a real bug.
- **Assuming locals are zero-initialized.** A fresh frame is just *reused stack memory*. In C, an uninitialized local holds whatever the previous call left there — garbage. Always initialize.

---

## Cheat Sheet

```text
CALL STACK
  - One per thread. Grows DOWN (toward lower addresses) on x86-64/ARM.
  - LIFO: only the top frame is live; it must return before the one below resumes.

ONE FRAME CONTAINS
  - return address    (where to go back to; pushed by `call`)
  - saved frame ptr   (the caller's FP; forms a linked list)
  - local variables   (and spilled registers / temporaries)

KEY REGISTERS (x86-64)
  - rsp = stack pointer = top of stack (the live edge)
  - rbp = frame pointer = stable anchor for this frame

CALL / RETURN
  - `call foo`  -> push return address, jump to foo
  - prologue    -> push rbp; mov rbp, rsp; sub rsp, N
  - epilogue    -> mov rsp, rbp; pop rbp
  - `ret`       -> pop return address, jump back

STACK TRACE = the live frame chain, printed.
  - top line   = innermost = where you are / crashed
  - bottom     = outermost = main

GOLDEN RULES
  - locals die on return -> never return a pointer to one
  - big buffers + deep recursion -> use the heap, not the stack
  - read backtraces bottom-up or top-down? find the ERROR line first
```

---

## Summary

The **call stack** is the program's record of which functions are currently running and how to get back to each caller. Each active call owns one **stack frame** containing a **return address**, a **saved frame pointer**, and the function's **local variables**. The `call` instruction pushes the return address and jumps; the function's prologue builds its frame; its epilogue tears it down; `ret` pops the return address and resumes the caller. Two registers track everything: the **stack pointer** (`rsp`) marks the top, and the **frame pointer** (`rbp`) anchors the current frame and chains frames into a walkable list.

The most practical payoff is reading **stack traces**: a trace is just the live frame chain printed out, with the innermost (crash) frame at one end and `main` at the other. The most important rules are that locals **die when the function returns** (never hand out pointers to them) and that the stack has a **fixed size** (deep recursion or giant locals overflow it). With those mental models in place, you're ready for `middle.md`, where calling conventions, the red zone, shadow space, and frame-pointer omission explain *exactly* how frames are laid out and why stack walking sometimes needs help.

---

## Further Reading

- Your platform's debugger manual on `backtrace` / `bt` (GDB, LLDB) — practice on real programs.
- Documentation for `traceback` (Python), `Thread.getStackTrace` (Java), `runtime/debug.Stack` (Go).
- "How a function call works" introductions in any computer-architecture course (x86-64 `call`/`ret`).
- The next files in this topic: `middle.md` (calling conventions, red zone, FP omission), `senior.md` (unwind tables, exception unwinding), `professional.md` (growable stacks, guard pages, profiling).
