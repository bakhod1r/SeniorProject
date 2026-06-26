# Runtimes (Language Runtime Support) — Junior Level

> **Topic:** [Runtimes (Language Runtime Support)](README.md)
> **Focus:** Your compiled program is never alone on the CPU. What is the *runtime* it always runs on top of, and why does even "hello world" drag a whole support library along with it?

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
13. [Common Mistakes](#common-mistakes)
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [What You Can Build](#what-you-can-build)
19. [Further Reading](#further-reading)
20. [Related Topics](#related-topics)

---

## Introduction

> Focus: **When the compiler turns your source code into a program, what *else* gets bundled in so that the program can actually run?**

When you write a program in a high-level language, you write things like "allocate a list", "start a goroutine", "throw an exception", "print a string". None of those are CPU instructions. The CPU knows how to add registers, load and store bytes, jump, and compare. It does **not** know what a list is, what a goroutine is, or what "throw" means.

So who fills the gap? A piece of code called the **runtime** (sometimes "runtime system", "runtime library", or "runtime support"). The runtime is a body of support code — written mostly by the language's authors — that ships *with your program* (or sits behind it) and provides the services your source code assumes exist. When the compiler sees `make([]int, 10)` in Go, it does not emit the machine code to find free memory itself; it emits a **call to the runtime's allocator**. When you write `try/catch` in Java or C++, the compiler emits metadata and calls that the runtime uses to **unwind the stack** and find your handler.

In one sentence: **the runtime is the part of your running program that the compiler emitted *calls to* instead of *inlining*, because the work is too big, too shared, or too dynamic to bake into every line of code.**

> 🎓 **Why this matters for a junior:** The first time you compile a tiny Go or Rust program and see the binary is **2 MB** for a five-line program, you will wonder where all the size came from. The answer is: the runtime. The first time your program "starts slowly" before your `main` even runs, that is the runtime bootstrapping. Knowing the runtime exists — and what it does — turns these mysteries into things you can reason about.

This page covers: what a runtime *is*, the everyday services it provides (startup, memory, the standard library, error handling), the difference between a **"fat" runtime** (Go, Java) and a **"thin" runtime** (C, Rust), and what your compiler quietly emits to cooperate with it. Later tiers go deeper: `middle.md` covers the allocator, garbage collector cooperation, and the green-thread scheduler; `senior.md` covers safepoints, write barriers, async-to-state-machine lowering, and runtime startup; `professional.md` covers embedding runtimes, JIT hosting, and runtime cost in production.

---

## Prerequisites

What you should know before reading this:

- **Required:** You have written and compiled a program in at least one language (C, Go, Java, Python, JavaScript, or Rust) and run the resulting binary or script.
- **Required:** You know roughly what a **compiler** does — turns source code into machine code (or bytecode).
- **Required:** You know that programs use **memory** and that `malloc`/`new`/`make` "gets memory."
- **Helpful but not required:** A vague idea that there is an `OS` underneath your program that gives it memory and CPU time.
- **Helpful but not required:** You have seen the word `main` as the entry point of a program.

You do **not** need to know:

- How a garbage collector actually traces objects (that's `middle.md` and the memory-management section).
- How the Go scheduler multiplexes goroutines (that's `middle.md`/`senior.md`).
- How `async/await` becomes a state machine (that's `senior.md`).
- Anything about JIT compilation or embedding (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Runtime (runtime system)** | The support code that runs alongside your program to provide services the language assumes — memory management, startup, error handling, threading, type info. |
| **Runtime library** | The actual library of compiled functions that *is* the runtime — e.g. Go's `runtime` package, the C runtime (`libc` + `crt`), the JVM's native libraries. |
| **C runtime / CRT** | The minimal startup + library code (`crt0.o`, `libc`) that sets up a C program before `main` and provides `malloc`, `printf`, etc. |
| **`crt0` / `_start`** | The true entry point of a native program. It runs *before* `main`, sets up the stack and arguments, then calls `main`. |
| **Static initializer** | Code that runs at startup, before `main`, to initialize global/static data (e.g. C++ global constructors, Go package `init` functions). |
| **Allocator** | The runtime service that hands out heap memory. The compiler emits *calls* to it instead of inlining memory management. |
| **Garbage collector (GC)** | A runtime service that automatically reclaims memory no longer reachable, so you don't call `free`. |
| **Scheduler** | A runtime service that decides which lightweight task (goroutine, green thread, async task) runs on which OS thread, and when. |
| **Green thread / goroutine** | A lightweight thread managed by the *runtime*, not the OS. Many of them are multiplexed onto few OS threads. |
| **Standard library** | The batteries-included code that ships with the language (strings, collections, I/O). Partly "runtime", partly ordinary library. |
| **Fat runtime** | A large runtime baked into every binary (Go, Java, Erlang): GC + scheduler + reflection + more. |
| **Thin runtime** | A minimal runtime (C, Rust): startup glue and a small library, no GC, no scheduler. |
| **Bounds check** | A runtime check the compiler inserts before an array/slice access to ensure the index is valid (and panic/throw if not). |
| **Exception unwinding** | The runtime process of walking back up the call stack to find a handler for a thrown exception. |
| **Reflection / RTTI** | Runtime Type Information — metadata the compiler emits so the program can ask, at runtime, "what type is this value?" |
| **Bootstrap** | The runtime's own startup sequence: it initializes itself (heap, scheduler, GC) before your code runs. |

---

## Core Concepts

### 1. The Compiler Cannot Do Everything In-Line

Imagine the compiler had to translate `append(list, x)` into raw machine code every time. It would have to inline the whole logic of "is there room? if not, find a bigger block of memory, copy the old contents, free the old block, then write x." That is dozens of instructions, and it depends on a memory allocator that itself is hundreds of lines. Inlining that into every `append` call would make programs enormous and impossible to maintain.

Instead, the language authors write that logic **once**, compile it into the **runtime library**, and the compiler simply emits a **call**: `call runtime.growslice`. The same idea applies to almost every "high-level" feature:

| You write | Compiler emits | Provided by the runtime |
|-----------|----------------|--------------------------|
| `new T` / `make(...)` | a call to the allocator | memory management |
| array/slice index `a[i]` | a bounds check + load | bounds-check helper / panic |
| `go f()` (Go) | a call to spawn a goroutine | scheduler |
| `throw` / `panic` | unwind metadata + a call | exception/panic machinery |
| `typeof x` / `x.(T)` | a metadata lookup | reflection / RTTI |
| string concatenation | a call to a string helper | string runtime + GC |

So a useful first definition: **the runtime is everything the compiler decided to *call* rather than *inline*.**

### 2. Your Program Has a Hidden Entry Point

You think your program starts at `main`. It does not. The *real* entry point on a native platform is a runtime function — `_start` (provided by `crt0` for C) or the language runtime's bootstrap (Go's `runtime.rt0_go`). This code runs **before** `main` and does setup:

1. Sets up the stack and reads command-line arguments and environment variables.
2. Initializes the runtime's own data structures (the heap, the GC, the scheduler).
3. Runs **static initializers** — global constructors in C++, package `init` functions in Go, static blocks in Java.
4. *Then* calls your `main`.
5. After `main` returns, runs cleanup and exits the process.

This is why people say "your program runs *on top of* a runtime." There is always a layer underneath `main` that you did not write.

### 3. The Standard Library Is Partly Runtime

When you call `println` or `fmt.Println` or `System.out.println`, you are calling into the **standard library**, which is shipped with the language. Some of the standard library is ordinary code (string formatting), but a lot of it leans on **runtime services**: printing needs a heap-allocated buffer (allocator), reading a file needs the runtime's I/O layer, spawning a thread needs the scheduler. So in practice "standard library" and "runtime" blur together; the runtime is the *core* services, the standard library is the broader toolbox built on top.

### 4. Fat Runtime vs Thin Runtime

Languages sit on a spectrum based on **how much** runtime they carry:

- **Fat runtime (Go, Java, C#, Erlang/Elixir):** every program carries a big runtime: a **garbage collector**, a **scheduler** for lightweight threads, **reflection** metadata, and more. You get convenience (no manual memory management, cheap concurrency) at the cost of bigger binaries, slower startup, and less control.
- **Thin runtime (C, Rust):** the program carries almost nothing — just startup glue and a minimal library. No GC, no built-in scheduler. You get small binaries, fast startup, and total control, but you manage memory yourself (or with compile-time rules, as Rust does).

The slogan to remember: **"you pay for a runtime."** A fat runtime gives you superpowers, but those superpowers ship in every binary and run on every CPU cycle. Rust markets *"no runtime"* as a feature precisely because that makes it usable on tiny embedded chips and inside other languages' runtimes.

### 5. Why "Hello World" Is Big

A C "hello world" is tiny because the runtime (`libc`) is usually *shared* — it's already on the machine, and your program just links to it dynamically. A Go "hello world" is a few **megabytes** because Go **statically** bundles its entire runtime — the GC, the scheduler, the reflection tables, the goroutine machinery — into the binary. You are not paying for your five lines; you are paying for the *services* those five lines could use. The binary is big because the runtime is big, and Go chose to staple it in for self-contained deployment.

---

## Real-World Analogies

**The restaurant kitchen.** You (the source code) write an order: "one pasta, allocate a table for four, handle the complaint at table 7." You never cook, find tables, or resolve complaints yourself. The **kitchen and staff** (the runtime) do that. The compiler is the *waiter* who translates your order into instructions the kitchen understands and passes them along. A fancy restaurant with a huge back-of-house (fat runtime) can do amazing things but costs a lot to run; a food truck (thin runtime) does less but is cheap and starts instantly.

**The power grid behind the wall socket.** You plug in a device and it "just works." You don't generate electricity; the **grid** (runtime) does, invisibly. Your appliance (your code) only knows the socket interface (the runtime's API). A house wired to a full national grid (fat runtime) has endless power but huge infrastructure; a cabin with a small generator (thin runtime) is self-sufficient and minimal.

**The building's facilities team.** When you (a tenant) need heating, water, or the elevator, you don't run the boiler — the **building services** (runtime) do, and they were running *before* you moved in (startup/bootstrap) and keep running in the background (GC, scheduler). You signed a lease that includes these services whether you use them or not — exactly "you pay for a runtime."

---

## Mental Models

**Model 1 — The runtime is a permanent co-resident.** Picture your process as a shared apartment. Your `main` function is one roommate. The runtime is the *other* roommate who moved in first (startup), keeps the place running (GC, scheduler), and is always there even when you ignore them. You are never alone in the address space.

**Model 2 — The compiler is a diplomat between two worlds.** On one side: your high-level intentions. On the other: a runtime with a fixed set of services. The compiler's job is to translate your intentions into the right **calls** to the runtime, plus a little **cooperation glue** (bounds checks, type tags) so the two worlds agree. Most "magic" in a high-level language is just the compiler emitting the right runtime call.

**Model 3 — Two columns of code.** Every running program is two columns side by side: **your code** (what you wrote) and **runtime code** (what was provided). Profilers show this directly: when you see time spent in `runtime.mallocgc` or `GC` or `gcWriteBarrier`, that is the *right* column — the runtime — doing work *on behalf of* the left column.

**Model 4 — The "fat vs thin" dial.** Picture one dial labeled "how much does the runtime do for me?" Turn it up (Go, Java): more services, bigger binary, less control. Turn it down (C, Rust): fewer services, smaller binary, more control and responsibility. There is no free lunch; the dial just moves the work between you and the runtime.

---

## Code Examples

The point of these examples is not the code you write, but the **runtime calls hiding behind it.**

### Example 1 — Allocation is a runtime call (Go)

```go
package main

func makeThings() []int {
    s := make([]int, 0, 4) // compiler emits: call runtime.makeslice
    for i := 0; i < 100; i++ {
        s = append(s, i)   // when capacity runs out: call runtime.growslice
    }
    return s
}

func main() {
    _ = makeThings()
}
```

You wrote `make` and `append`. The compiler turned them into **calls into the Go runtime**, which finds memory (allocator) and, when needed, grows the backing array. You never see `runtime.makeslice` in your source, but it is what actually runs. The garbage collector — also part of the runtime — will later reclaim this slice when nothing points to it.

### Example 2 — Spawning a lightweight task is a runtime call (Go)

```go
package main

import "fmt"

func main() {
    done := make(chan bool)
    go func() {              // compiler emits: call runtime.newproc (create a goroutine)
        fmt.Println("hi from a goroutine")
        done <- true
    }()
    <-done                   // channel ops are runtime calls too (the scheduler may park us)
}
```

`go func()` is not an OS-thread spawn. The compiler emits a call to the runtime's **scheduler**, which creates a tiny goroutine and later runs it on some OS thread. The whole multiplexing — many goroutines, few OS threads — is the runtime's job. You only wrote two characters: `go`.

### Example 3 — Bounds checks the compiler inserts (Go-ish pseudocode)

```text
You write:        x := a[i]

Compiler emits:   if i >= len(a) {        // bounds check inserted by the compiler
                      call runtime.panicIndex(i, len(a))   // runtime reports the error
                  }
                  x = load a[i]
```

You wrote one indexing expression. The compiler inserted a **safety check** and, if it fails, calls a **runtime helper** that produces the panic / `IndexOutOfBoundsException`. The check and the helper are both part of how the language stays memory-safe — and both involve the runtime.

### Example 4 — A thin-runtime language hands you control (C)

```c
#include <stdlib.h>

int main(void) {
    int *p = malloc(10 * sizeof(int)); // YOU call the allocator explicitly
    if (!p) return 1;
    // ... use p ...
    free(p);                           // YOU free it — no GC will do it for you
    return 0;
}
```

In C (a thin runtime), there is no GC. The runtime (`libc`) *offers* `malloc`/`free`, but **you** decide when to call them. The compiler does not insert allocation or freeing on your behalf. This is the trade: more control, more responsibility, a tiny runtime.

### Example 5 — Seeing the runtime in a binary's size

```text
$ cat > hello.go
package main
import "fmt"
func main() { fmt.Println("hello") }

$ go build hello.go
$ ls -lh hello
-rwxr-xr-x  1 you  1.8M  hello      # ~1.8 MB for five lines!

# Compare a C hello world (dynamically linked to a shared libc):
$ cc hello.c -o hello_c
$ ls -lh hello_c
-rwxr-xr-x  1 you   16K  hello_c    # ~16 KB — libc lives outside the binary
```

The Go binary is large because the **entire runtime** (GC, scheduler, reflection tables) is stapled inside. The C binary is small because its runtime (`libc`) is shared by the whole system and loaded separately. Same "hello world", very different runtime cost.

---

## Pros & Cons

### Pros of a (fat) runtime

| Benefit | Why it helps |
|---------|--------------|
| **Automatic memory management** | The GC frees memory for you — fewer leaks, no use-after-free. |
| **Cheap concurrency** | A scheduler gives you thousands of goroutines/green threads cheaply. |
| **Memory safety** | Bounds checks, type tags, and unwinding catch errors at runtime instead of corrupting memory. |
| **Reflection / dynamic features** | Runtime type info enables serialization, dependency injection, debuggers. |
| **Self-contained deployment** | A statically-bundled runtime means "ship one binary, run anywhere" (Go). |
| **Less boilerplate** | The compiler emits the plumbing; you write business logic. |

### Cons of a (fat) runtime

| Cost | Why it hurts |
|------|--------------|
| **Binary size** | The runtime ships in every binary (megabytes for "hello world" in Go). |
| **Startup cost** | The runtime must bootstrap (init heap, GC, scheduler) before `main` — bad for short-lived/serverless functions. |
| **Less control** | The GC may pause; the scheduler decides when things run. You can't always predict timing. |
| **Runtime overhead** | Bounds checks, write barriers, and GC cost CPU cycles on every run. |
| **Not embeddable everywhere** | A fat runtime can't run on tiny embedded chips or inside another language easily. |
| **Hidden cost** | "You pay for a runtime" even for features you never use. |

The thin-runtime side (C, Rust) flips this table: small binaries, fast startup, total control — but you manage memory yourself and write more plumbing.

---

## Use Cases

- **Choosing a language for a CLI tool that starts often:** A fat runtime's startup cost matters. Go is acceptable; a heavier JVM startup may not be.
- **Writing firmware for a microcontroller:** You need a thin runtime (C, Rust `no_std`). There is no room for a GC or scheduler.
- **Building a long-running web server:** A fat runtime pays off — the startup cost amortizes over days of uptime, and the scheduler + GC make concurrency easy.
- **Serverless / FaaS functions:** Startup ("cold start") is dominated by runtime bootstrap. This is *why* people care about runtime startup cost in serverless.
- **Understanding a big binary:** When a teammate asks "why is our Go binary 30 MB?", the answer starts with "the runtime."
- **Reading a profiler:** Seeing `runtime.mallocgc` or `gc` at the top of a flame graph tells you the runtime — not your code — is the bottleneck, and points you at allocation pressure.

---

## Coding Patterns

These are beginner-level habits that come directly from understanding the runtime.

### Pattern 1 — Reduce allocations to reduce runtime work

Every allocation is a runtime call and adds to GC pressure. Reusing memory means fewer runtime calls.

```go
// Allocates a new slice every call — more runtime + GC work.
func bad() []byte { return make([]byte, 1024) }

// Reuse a buffer — fewer allocations, less work for the runtime.
var buf = make([]byte, 1024)
func good() []byte { return buf } // (single-threaded use only)
```

### Pattern 2 — Let `defer`/RAII clean up so the runtime doesn't have to track it manually

```go
f, _ := os.Open("data.txt")
defer f.Close() // the runtime ensures Close runs when the function returns
```

### Pattern 3 — Prefer the standard library; it cooperates with the runtime correctly

Hand-rolling string building or concurrency is easy to get wrong. The standard library (e.g. `strings.Builder`, channels) is written by the people who wrote the runtime, so it cooperates with the GC and scheduler properly.

### Pattern 4 — In thin-runtime languages, pair every allocation with a free

```c
int *p = malloc(n);
if (!p) return;
/* ... */
free(p);   // no runtime will do this for you
```

---

## Best Practices

1. **Know whether your language has a fat or thin runtime.** It changes everything about memory, concurrency, and deployment.
2. **Don't fight the runtime.** If your language has a GC, use it; don't try to "outsmart" it with manual tricks until you measure a real problem.
3. **Measure before optimizing runtime overhead.** "The GC is slow" is rarely true until a profiler proves it. Look at the *right column* (runtime time) in a flame graph.
4. **Mind startup cost for short-lived programs.** A program that runs for 5 ms but spends 20 ms in runtime bootstrap is dominated by the runtime.
5. **Use the standard library for anything the runtime touches** — concurrency, I/O, allocation-heavy work. It's written to cooperate with the runtime.
6. **In thin-runtime languages, own your memory discipline.** Free what you allocate; the runtime won't.
7. **Treat binary size as a runtime question first.** Before stripping symbols, understand that the base size *is* the runtime.

---

## Edge Cases & Pitfalls

- **"My program is slow before it does anything."** That's runtime startup/bootstrap, plus static initializers running before `main`. Heavy global constructors or package `init` functions run *first*.
- **"Hello world is 2 MB."** Not a bug — the statically-linked runtime. (Go.)
- **"I never called `malloc` but the profiler shows allocation."** The compiler emitted allocation calls behind `make`, `append`, string concatenation, closures, and interface boxing.
- **"My `init`/static block has a side effect I didn't expect at startup."** Static initializers run during bootstrap, before `main`. Order can surprise you.
- **"I called `free` but the GC also reclaimed it" — wrong language model.** Don't mix manual free with a GC. In GC languages, you don't free; in C/C++, the runtime won't free for you.
- **"Why does my embedded target reject this language?"** Fat runtimes (GC, scheduler) often can't fit or aren't allowed on bare metal. You need a thin/`no_std` runtime.
- **A panic/exception you didn't catch crashes the process.** Unwinding is a runtime service; if no handler is found, the runtime terminates the program.

---

## Common Mistakes

| Mistake | Reality |
|---------|---------|
| "The compiler generates *all* the machine code my program runs." | No — a lot of what runs is the **runtime library**, called by your code. |
| "Programs start at `main`." | The runtime's `_start`/bootstrap runs *before* `main`. |
| "Big binary = bloated/badly written code." | Usually it's the **runtime** bundled in, not your code. |
| "GC means I never think about memory." | You still cause allocations; the runtime just reclaims them — reducing allocations still matters. |
| "C has no runtime." | C has a **thin** runtime (`crt` + `libc`). "No runtime" is relative. |
| "Rust has a GC because it's safe." | Rust has **no GC**; safety comes at compile time, keeping the runtime thin. |
| "Goroutines are OS threads." | They are **runtime-managed** green threads multiplexed onto OS threads by the scheduler. |

---

## Tricky Points

- **The runtime is not the OS.** The OS gives raw resources (memory pages, threads, CPU time). The runtime is *your language's* layer built on top of the OS, providing language-level services (GC, goroutines, exceptions). Both sit under your code, but they are different layers.
- **"Runtime" is overloaded.** It can mean (1) "the time when the program runs" (as in "runtime error"), or (2) "the runtime *system* / library". This page is about meaning (2). A "runtime error" is just an error that happens during meaning (1) — sometimes raised by meaning (2).
- **The standard library and the runtime overlap.** There's no sharp line. Core services (allocator, scheduler, GC) are clearly "runtime"; higher-level utilities are "standard library"; many things straddle both.
- **The compiler and runtime are co-designed.** They are a matched pair. The compiler emits exactly the calls and metadata *this* runtime expects. You usually can't mix one language's compiler with another's runtime.

---

## Test Yourself

1. In one sentence, what is a language runtime?
2. Name three services a fat runtime typically provides.
3. When you write `make([]int, 8)` in Go, what does the compiler actually emit, and who does the work?
4. Why is a Go "hello world" binary much bigger than a C one?
5. What runs *before* `main`, and what does it do?
6. Give one reason Rust's "no runtime" is a *feature* for embedded systems.
7. What is the difference between a "runtime error" and "the runtime system"?
8. Why does runtime startup cost matter especially for serverless functions?

> Answers: (1) The support code that runs with your program to provide language services (memory, startup, concurrency, errors). (2) e.g. garbage collection, scheduling of green threads, reflection/RTTI. (3) A call to the runtime's allocator (`runtime.makeslice`); the runtime finds the memory. (4) Go statically bundles its whole runtime into the binary; C links a shared `libc`. (5) The runtime's `_start`/bootstrap: sets up the stack/args, initializes the heap/GC/scheduler, runs static initializers, then calls `main`. (6) No GC/scheduler to ship means it fits on tiny chips and gives predictable timing. (7) A runtime error happens *while running*; the runtime system is the *library/services* layer. (8) The function may run for milliseconds but pay tens of milliseconds to bootstrap the runtime on each cold start.

---

## Cheat Sheet

```text
RUNTIME = code that runs WITH your program to provide language services.
         = what the compiler CALLS instead of INLINING.

The compiler emits CALLS to the runtime for:
  allocation (make/new)      -> runtime allocator (+ GC reclaims later)
  array index a[i]           -> bounds check + panic helper
  go f() / spawn task        -> scheduler
  throw / panic              -> unwind metadata + runtime handler search
  typeof / type assert       -> reflection / RTTI metadata

Real entry point is NOT main:
  _start / runtime bootstrap -> init heap/GC/scheduler -> static initializers -> main

FAT runtime (Go, Java, C#, Erlang): GC + scheduler + reflection, big binary, slower start, less control
THIN runtime (C, Rust):             minimal crt/libc, small binary, fast start, you manage memory

"You pay for a runtime" — it ships in every binary and runs on every cycle.
Big "hello world" binary = the statically-linked runtime, not your code.
```

---

## Summary

A **language runtime** is the body of support code your program runs on top of — the part the compiler emits *calls to* rather than inlining, because the work (memory management, concurrency, error handling, type info) is too big, too shared, or too dynamic to bake into every line. Your program never runs alone: a runtime bootstraps *before* `main`, provides services *during* `main`, and cleans up *after*.

Languages range from **fat runtimes** (Go, Java, C#, Erlang — GC, scheduler, reflection, all bundled in) to **thin runtimes** (C, Rust — minimal startup glue, no GC, no scheduler). The fat side buys convenience and safety at the cost of binary size, startup time, and control; the thin side buys smallness, speed, and control at the cost of doing the work yourself. The phrase to keep is **"you pay for a runtime"**: it explains why a five-line Go program is megabytes, why managed programs start slowly, and why Rust advertises "no runtime" as a feature for the smallest, most controlled environments. The next tiers open the box: the allocator and GC cooperation, the scheduler, and how the compiler lowers high-level features into runtime calls and state machines.

---

## What You Can Build

- **A "runtime spotter":** compile a tiny program in Go, C, and Rust, compare binary sizes, and write down *why* each differs.
- **An allocation tracer:** in Go, run a small program with `GODEBUG=allocfreetrace=1` (on a tiny example) or use `go build -gcflags=-m` to see what escapes to the heap (i.e., what becomes a runtime allocation).
- **A startup timer:** measure the time from process start to your first line of `main` versus total runtime, in two different languages, and explain the gap.
- **A "before main" demo:** write a program with a global constructor / package `init` that prints, and confirm it runs before `main`.

---

## Further Reading

- Your language's own runtime documentation (e.g. Go's `runtime` package docs, the JVM specification's overview, the .NET CLR overview).
- "What every programmer should know about the C runtime startup" — articles on `crt0`/`_start`.
- Introductory material on garbage collection (then continue in the memory-management section).
- Articles on "why is my Go binary so big" — they map directly onto runtime contents.

---

## Related Topics

- [Runtimes (Language Runtime Support)](README.md) — the hub for this topic.
- The **runtime-systems** section covers the runtime in depth from the *runtime's own* perspective; this page frames it from the *compiler's* perspective.
- The **memory-management** section covers the allocator and garbage collector that the compiler emits calls to.
- The **foreign-function-interface-and-interop** section covers calling C from a managed runtime.
