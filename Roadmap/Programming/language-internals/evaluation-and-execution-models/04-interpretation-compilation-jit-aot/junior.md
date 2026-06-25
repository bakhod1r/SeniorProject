# Interpretation, Compilation, JIT, AOT — Junior Level

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)
> **Focus:** What actually happens to your source code between "save file" and "CPU runs it" — and the four big strategies (interpret, compile, JIT, AOT) for getting there.

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

> Focus: **How does a CPU end up running the program you typed?** And **why are there four different answers to that question instead of one?**

When you write `print("hello")` in Python, or `fmt.Println("hello")` in Go, you are writing text. The CPU does not understand text. It understands **machine code** — raw numbers that mean "add these two registers," "jump to this address," "load from memory." Somewhere between your text file and the running CPU, something has to bridge that gap. **That bridge is the subject of this whole topic.**

There are, broadly, four strategies for crossing the bridge:

1. **Interpretation** — a program (the *interpreter*) reads your code and *does what it says*, step by step, while your program runs. Python, Ruby, and classic JavaScript started here.
2. **Compilation (ahead-of-time / AOT)** — a program (the *compiler*) translates *all* your code into machine code *before* you run it, producing a standalone executable. C, C++, Rust, and Go work this way.
3. **JIT (Just-In-Time) compilation** — a hybrid. The program *starts* interpreting, watches which parts run a lot ("hot" code), and *compiles those parts to machine code while the program is running.* Java's HotSpot JVM and JavaScript's V8 do this.
4. **Bytecode interpretation** — a middle ground used by almost everyone. Your source is first compiled into a compact intermediate form called **bytecode**, and *that* is interpreted. CPython does exactly this: it compiles `.py` into `.pyc` bytecode, then interprets the bytecode.

In one sentence: **interpretation reads and acts as it goes; compilation translates everything up front; a JIT does both — interpret first, then compile the hot parts on the fly; and AOT is just "compile everything before running."**

> 🎓 **Why this matters for a junior:** You will constantly hear "Python is slow," "Java is slow to start but fast once warmed up," "Go produces a single binary," "use a JIT for peak performance." None of those statements make sense until you understand these four strategies. They explain *why* your CLI tool starts instantly but your Java service takes ten seconds to warm up, *why* a Python loop is 50× slower than the same loop in C, and *why* serverless functions love AOT.

This page covers the four strategies, what bytecode is, the difference between "compile to machine code" and "compile to bytecode," what a JIT actually does and why it can be *faster* than AOT, and a tour of how the languages you use fit into this picture. The deeper levels go into dispatch techniques, tiered compilation, deoptimization, and the engineering trade-offs.

---

## Prerequisites

What you should know before reading this:

- **Required:** You can write and run a simple program in at least one language (Python, JavaScript, Java, Go, or C).
- **Required:** You know the difference between *source code* (the text you write) and *running a program* (what happens after).
- **Required:** A vague idea that a CPU executes "instructions."
- **Helpful but not required:** You have seen a `.pyc`, `.class`, or `.exe` file and wondered what it is.
- **Helpful but not required:** You have noticed that some languages need a "compile step" (`go build`, `javac`) and some don't (`python script.py`).

You do **not** need to know:

- How a JIT decides what to compile (that's `middle.md` and `senior.md`).
- What a register allocator or SSA form is (that's `professional.md`).
- Assembly language. We will show *what* machine code is, not how to write it.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Source code** | The human-readable text you write: `.py`, `.js`, `.java`, `.go`, `.c`. |
| **Machine code** | Raw binary instructions a specific CPU executes directly. Architecture-specific (x86-64 ≠ ARM64). |
| **Interpreter** | A program that reads your code (or bytecode) and performs its actions directly, without producing a standalone executable. |
| **Compiler** | A program that translates source code into another form — usually machine code or bytecode. |
| **AOT (Ahead-Of-Time)** | Compiling the whole program to machine code *before* you run it. The classic meaning of "compiled language." |
| **JIT (Just-In-Time)** | Compiling parts of the program to machine code *while the program is running.* |
| **Bytecode** | A compact, CPU-independent instruction set designed to be interpreted (or JIT-compiled). Examples: Python bytecode, Java bytecode, .NET IL/CIL. |
| **Virtual machine (VM)** | The runtime that executes bytecode. The JVM, the CPython VM, the .NET CLR. (Not the same as a "virtual machine" like VirtualBox.) |
| **AST (Abstract Syntax Tree)** | A tree representation of your code's structure. `2 + 3 * 4` becomes a tree with `+` at the top. |
| **Tree-walking interpreter** | An interpreter that executes by walking the AST node by node. The simplest, slowest kind. |
| **Bytecode interpreter** | An interpreter that executes a flat list of bytecode instructions in a loop. Faster than tree-walking. |
| **Warmup** | The period at the start of a JIT'd program where it runs *slowly* (interpreting) before the JIT compiles the hot code. |
| **Hot code** | Code that runs many times — a loop body, a frequently called function. The JIT focuses here. |
| **Native code / native binary** | Machine code for the actual hardware, as opposed to bytecode for a VM. |
| **Profile** | Information collected *while the program runs* about what's actually happening — which branches are taken, which types appear. JITs use profiles; AOT compilers usually can't. |
| **Startup time** | How long from launch to "doing useful work." AOT wins here; JIT loses (warmup). |
| **Peak performance** | How fast the program runs *after* it's fully warmed up. A good JIT can beat or match AOT here. |

---

## Core Concepts

### 1. The CPU only speaks machine code

Your CPU has a fixed instruction set: a finite list of operations encoded as numbers. `0x48 0x01 0xC3` on x86-64 means "add the `rax` register into `rbx`." That's it. Every program, no matter the language, must *eventually* become a stream of these instructions for the CPU to execute. The four strategies are simply **four different times and ways to produce those instructions.**

### 2. Interpretation: do it as you read it

A pure interpreter never produces machine code for *your* program. Instead, the interpreter *itself* is machine code (someone compiled the Python interpreter from C), and it reads your program as data and acts on it.

Think of it like this. To run `x = 2 + 3`, a tree-walking interpreter:

```text
1. Sees the "assignment" node.
2. Evaluates the right side: a "+" node.
3. Evaluates "+"'s children: the numbers 2 and 3.
4. Adds them → 5.
5. Stores 5 into the variable x.
```

The interpreter does steps 1–5 *every time it runs that line.* If that line is in a loop running a million times, it re-does all that bookkeeping a million times. **That bookkeeping overhead is why interpreters are slow.**

### 3. Compilation (AOT): translate everything first

An AOT compiler reads your *entire* program once, translates it all into machine code, and writes out an executable file. When you run that file, the CPU executes your code *directly* — no interpreter in the loop, no per-line bookkeeping. `x = 2 + 3` becomes a couple of machine instructions, and a million-iteration loop is a million iterations of those instructions, nothing more.

This is why C and Go are fast and why they start instantly: by the time you run them, *all the translation work is already done.* The cost is paid once, at build time, by the developer — not every time, at runtime, by the user.

### 4. Bytecode: the popular middle ground

Pure tree-walking is slow. Full AOT to machine code ties you to one CPU and one OS. So most "interpreted" languages do something in between: they **compile your source to bytecode** — a flat, compact, CPU-independent instruction set — and then **interpret the bytecode.**

CPython does this automatically. When you `import mymodule`, Python compiles `mymodule.py` to bytecode and caches it as `mymodule.pyc`. The bytecode looks like:

```text
LOAD_CONST    2
LOAD_CONST    3
BINARY_ADD
STORE_NAME    x
```

This is *much* faster to interpret than walking a tree, because each instruction is simple and the dispatch is a tight loop. **CPython is not "interpreted" in the naïve sense — it is "compiled to bytecode, then the bytecode is interpreted."** Keep that phrase; it dissolves a lot of confusion.

### 5. JIT: interpret first, then compile the hot parts

Here's the clever one. A JIT-based runtime (like Java's HotSpot or JavaScript's V8) *starts* by interpreting bytecode — so startup is reasonably quick and nothing is wasted compiling code that only runs once. But it **watches** which functions and loops run a lot. When a piece of code crosses a "this is hot" threshold, the JIT **compiles that specific code into machine code, right then, while the program is running**, and from then on the program runs that part at native speed.

Why bother, if AOT already gives you native code? Two reasons:

- **You don't pay to compile code that never gets hot.** Most code in a big app runs rarely; compiling all of it (as AOT must) wastes effort. A JIT only compiles what matters.
- **The JIT knows things the AOT compiler couldn't.** It has watched the program run. It *knows* this loop variable is always an integer, that this `if` is almost never taken, that this method is always called on the same type. It can compile *specialized* machine code based on *real runtime behavior.* An AOT compiler has to be conservative because it can't see the future. This is the deep reason a great JIT can sometimes beat AOT at peak performance.

The price of a JIT is **warmup**: at the start, the program runs slowly (interpreting) and *also* spends CPU compiling. Only after warmup does it hit peak speed.

### 6. The spectrum, not the binary

It is tempting to file languages into "compiled" vs "interpreted." That's wrong. It's a **spectrum**:

```text
SLOWER startup-to-peak translation ......... FASTER

Pure tree-walking interpreter
   │
Bytecode interpreter (CPython, Ruby)
   │
Bytecode interpreter + JIT (Java HotSpot, JS V8, .NET, PyPy)
   │
AOT to native (C, C++, Rust, Go)
```

And the categories blur: Java compiles to bytecode (a compile step!) *and* interprets it *and* JITs it. Go is AOT but ships a runtime with a garbage collector. .NET can be JIT'd *or* AOT'd. The four strategies are *ingredients*, and real languages mix them.

### 7. AOT for "managed" languages, and why it came back

For decades, "AOT" meant C/C++/Rust/Go. But recently, languages that traditionally used a JIT (Java, C#) added AOT options: **GraalVM native-image** for Java, **.NET NativeAOT** for C#. Why? Because JIT warmup and memory overhead are *terrible* for short-lived programs:

- A **command-line tool** runs for 50 milliseconds and exits. With a JIT, it never warms up — it pays all the startup cost and gets none of the peak benefit. AOT makes it start instantly.
- A **serverless function** (AWS Lambda, etc.) spins up a fresh process per request burst. JIT warmup happens *on every cold start*, adding latency the user feels. AOT eliminates the warmup entirely.

So AOT "came back" for managed languages, driven by CLIs and serverless cold-starts. The trade-off: AOT gives up the JIT's runtime adaptive specialization, and it struggles with features like reflection (more on that at higher levels).

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Interpreter** | A live interpreter at the UN, translating a speech sentence-by-sentence *as it's being given*. Flexible, immediate, but adds delay to every sentence. |
| **AOT compiler** | A professional translator who takes the whole book, translates it over weeks, and hands you a finished translated book. Slow up front; instant to read afterward. |
| **Bytecode** | Translating a Japanese novel into Esperanto first — a simpler, regular intermediate language — so that translating from Esperanto to any other language is easier. |
| **JIT** | A simultaneous interpreter who, realizing the speaker keeps repeating the same paragraph, writes out a polished translation of *that paragraph* and just reads it aloud each time it recurs. |
| **Warmup** | The first few minutes of that interpreter's shift — rough and slow — before they've found their rhythm and pre-written the common phrases. |
| **Profile-guided optimization** | The JIT-interpreter noticing "this speaker always says 'um' before a number" and optimizing for that exact habit. |
| **Hot code** | The chorus of a song — sung many times, so worth memorizing perfectly. The verses (cold code) you can sight-read. |
| **Deoptimization** | The interpreter confidently pre-translated a sentence assuming a topic, then the speaker veers off — so they throw away the pre-written version and go back to translating live. |
| **Native binary** | A book printed in the reader's own native language. No translator needed at all. |

---

## Mental Models

### The "Translation Timing" Model

The single most useful idea: **all four strategies do the same job — turn source into something the CPU runs — they just do it at different *times*.**

```text
            BUILD TIME            │            RUN TIME
─────────────────────────────────┼──────────────────────────────
Interpreter:    (nothing)        │  translate + run, line by line, every time
Bytecode:    source → bytecode   │  interpret bytecode every time
JIT:         source → bytecode   │  interpret, then compile hot parts mid-run
AOT:    source → machine code    │  just run the machine code
```

Shift the translation work *left* (toward build time) and you get fast startup and no runtime overhead, but you lose runtime knowledge. Shift it *right* (toward run time) and you gain flexibility and runtime knowledge, but you pay for it while the user is waiting.

### The "Who Pays, and When" Model

Every strategy answers: *who pays the translation cost, and when?*

- **AOT:** the developer pays once, at build time. Users pay nothing.
- **Interpreter:** users pay a little, continuously, every time a line runs.
- **JIT:** users pay a lot up front (warmup), then nothing (peak).

This model instantly explains language choice. Short-lived program with many users (a CLI)? Don't make users pay warmup — use AOT. Long-running server processing millions of requests? Pay warmup once, reap peak speed forever — JIT is great.

### The "Interpreter is Just a Big Loop" Model

A bytecode interpreter is, at its heart, this loop:

```text
while True:
    instruction = bytecode[program_counter]
    program_counter += 1
    do_what_instruction_says(instruction)   # a giant switch statement
```

Hold this picture. The "do what it says" is a `switch` over every possible instruction. The overhead of *fetching* the next instruction and *jumping* to the right case — done millions of times — is the interpreter's tax. Compiling to machine code removes that loop entirely: the instructions *become* the program.

---

## Code Examples

We'll use one tiny program — *add the numbers 1 to N* — and look at how different strategies treat it. You can run all of these.

### See bytecode in Python (the "compiled to bytecode" reality)

Python compiles your function to bytecode. You can *look* at it:

```python
import dis

def add_to_n(n):
    total = 0
    for i in range(n):
        total += i
    return total

dis.dis(add_to_n)
```

Output (abbreviated) — this is the bytecode CPython *interprets*:

```text
  total = 0
        LOAD_CONST    0 (0)
        STORE_FAST    total

  for i in range(n):
        LOAD_GLOBAL   range
        LOAD_FAST     n
        CALL          1
        GET_ITER
   >>   FOR_ITER      ...

  total += i
        LOAD_FAST     total
        LOAD_FAST     i
        BINARY_OP     +
        STORE_FAST    total
```

Every loop iteration, CPython's interpreter loop fetches and dispatches each of those instructions. That fetch-decode-dispatch overhead, repeated `n` times, is why this Python loop is far slower than the same loop in C.

### See the AOT machine code in C

The same logic in C, AOT-compiled, becomes machine instructions with *no interpreter:*

```c
long add_to_n(long n) {
    long total = 0;
    for (long i = 0; i < n; i++) {
        total += i;
    }
    return total;
}
```

Compile and disassemble:

```bash
gcc -O2 -c add.c -o add.o
objdump -d add.o
```

The loop body is a handful of instructions (a compare, an add, a jump) that the CPU runs directly. No fetch-decode-dispatch of bytecode. This is the "translation already done at build time" payoff.

### Watch a JIT warm up in Java

```java
public class Warmup {
    static long addToN(long n) {
        long total = 0;
        for (long i = 0; i < n; i++) total += i;
        return total;
    }

    public static void main(String[] args) {
        for (int round = 0; round < 8; round++) {
            long start = System.nanoTime();
            long result = 0;
            for (int rep = 0; rep < 1000; rep++) result += addToN(1_000_000);
            long ms = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("round %d: %d ms%n", round, ms);
        }
    }
}
```

Run it. You'll typically see something like:

```text
round 0: 14 ms      <- interpreting, slow
round 1: 11 ms
round 2: 4 ms       <- C1 (baseline JIT) kicked in
round 3: 2 ms
round 4: 1 ms       <- C2 (optimizing JIT) kicked in, fully warmed up
round 5: 1 ms
round 6: 1 ms
round 7: 1 ms
```

The first rounds are slow (the JVM is interpreting bytecode). As `addToN` gets hot, HotSpot compiles it — first with a quick baseline compiler, then with the heavy optimizing compiler — and the time drops by ~10×. **That drop is warmup made visible.** A C or Go version would be at "round 7 speed" from the very first run.

### The Go version: AOT, no warmup

```go
package main

import (
	"fmt"
	"time"
)

func addToN(n int64) int64 {
	var total int64
	for i := int64(0); i < n; i++ {
		total += i
	}
	return total
}

func main() {
	for round := 0; round < 4; round++ {
		start := time.Now()
		var result int64
		for rep := 0; rep < 1000; rep++ {
			result += addToN(1_000_000)
		}
		fmt.Printf("round %d: %v\n", round, time.Since(start))
	}
}
```

Build with `go build` and run. Every round is roughly the same speed — *there is no warmup*, because `go build` already produced native machine code. This is the AOT trade-off in one program: instant peak speed, no adaptivity.

---

## Pros & Cons

| Strategy | Pros | Cons |
|----------|------|------|
| **Pure interpreter (tree-walking)** | Simplest to build; flexible; instant "edit and run"; trivially portable. | Slowest execution; re-does work every time a line runs. |
| **Bytecode interpreter** | Much faster than tree-walking; still portable; fast startup; small memory. | Still has per-instruction dispatch overhead; far from native speed. |
| **JIT** | Highest peak performance; adapts to real runtime behavior; only compiles hot code. | Warmup cost; high memory use (compiler + compiled code in RAM); slow startup; complex; generating code at runtime is a security surface. |
| **AOT to native** | Fastest startup; lowest memory; no warmup; single distributable binary; predictable performance. | No runtime adaptation; longer build times; binary tied to one CPU/OS; managed-language AOT breaks reflection and other dynamic features. |

---

## Use Cases

**Reach for an interpreter / bytecode VM when:**

- You're scripting, prototyping, or doing data analysis where developer speed beats execution speed (Python notebooks, shell-like glue).
- Edit-run cycles matter more than raw throughput.
- Portability across machines without recompiling is valuable.

**Reach for a JIT when:**

- The program is **long-running**: a web server, a database, a big-data job that runs for minutes or hours. Warmup is a one-time cost amortized over a long life.
- You want peak throughput *and* the convenience of a managed runtime (GC, portability).
- This is why Java and modern JS engines dominate long-lived servers.

**Reach for AOT when:**

- The program is **short-lived** or **starts often**: CLI tools, serverless functions, desktop apps that must feel instant.
- You need a **single self-contained binary** to ship (Go's killer feature).
- Low and predictable memory matters (embedded, containers with tight limits).
- Cold-start latency is user-visible (serverless) — AOT removes warmup entirely.

---

## Coding Patterns

### Pattern 1: "Warm up before you measure" (for JIT languages)

Never benchmark the *first* run of JIT'd code — you'll measure the interpreter, not the compiled code. Run the hot path enough to trigger compilation, *then* measure.

```text
// pseudocode
for i in 1..10000: hotFunction()   // warmup — discard these timings
measure: for i in 1..10000: hotFunction()   // now measure
```

(In Java, use the JMH benchmarking framework, which does this correctly for you.)

### Pattern 2: Pick the strategy to fit the lifetime

Before choosing a language/runtime for a component, ask: *how long does this process live, and how often does it start?*

```text
Lives milliseconds, starts constantly (CLI, lambda) → AOT
Lives hours, starts rarely (server, daemon)        → JIT is fine, often best
One-off script, dev convenience first              → interpreter
```

### Pattern 3: Cache the bytecode

If your runtime compiles source to bytecode (Python), let it cache the `.pyc` so it doesn't recompile every launch. This is automatic in CPython; just don't delete `__pycache__` or run with flags that disable it in production.

### Pattern 4: For AOT of managed languages, declare your dynamic surface

When using GraalVM native-image or .NET NativeAOT, anything reflective (loading a class by name at runtime, deserializing arbitrary types) must be declared in a config file, because the AOT compiler removes code it can't see being used. The pattern: enumerate your reflection/serialization needs up front.

---

## Best Practices

- **Stop saying "compiled vs interpreted."** Say what the runtime actually does: "compiled to bytecode then JIT'd," "AOT to native," "tree-walked." Precision prevents confusion.
- **Match the strategy to the workload's lifetime.** Short-lived → AOT; long-lived → JIT is great. This single rule resolves most "which is faster?" arguments.
- **Don't micro-optimize an interpreter the way you'd optimize native code.** In an interpreted language, the win usually comes from *doing fewer interpreted operations* (vectorize with NumPy, push loops into C), not from clever arithmetic tricks.
- **Account for warmup in JIT'd services.** Send synthetic warmup traffic before a new instance takes real load, so users don't hit the slow interpreting phase.
- **Let the bytecode cache work.** Don't fight your runtime's caching of compiled artifacts.
- **Benchmark realistically.** Measure startup *and* steady-state separately — they're different numbers with different winners.

---

## Edge Cases & Pitfalls

- **"Python is compiled" surprises people — and it's true.** Python *does* compile to bytecode. It just interprets that bytecode instead of running it natively. The `.pyc` files are the evidence. Knowing this stops the false belief that "interpreted = no compile step."
- **Benchmarking JIT code cold.** Timing the first call of a Java/JS function measures the interpreter and the warmup, not the optimized code. Beginners conclude "Java is slow" from a benchmark that never warmed up.
- **Assuming AOT is always faster than JIT.** At *startup*, yes. At *peak*, a good JIT can match or beat AOT because it specializes on real runtime data the AOT compiler couldn't see.
- **Expecting reflection to work under AOT.** GraalVM native-image and .NET NativeAOT operate under a "closed-world" assumption: they need to see all reachable code at build time. Code that loads classes dynamically can break unless you configure it.
- **Confusing "VM" with "virtual machine."** The JVM and CPython VM are *language* virtual machines that execute bytecode — not hardware virtualization like VirtualBox or VMware. Same word, different thing.
- **Thinking the JIT compiles your whole program.** It doesn't. It compiles only the *hot* parts. Cold code stays interpreted forever — which is fine, because it barely runs.
- **Forgetting that AOT binaries are platform-specific.** A Go binary built for Linux x86-64 won't run on macOS ARM64. You must build per target. Bytecode (a `.jar`, a `.pyc`) is portable; native binaries are not.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│           HOW SOURCE BECOMES SOMETHING THE CPU RUNS               │
├──────────────────────────────────────────────────────────────────┤
│  INTERPRET   read code, do what it says, line by line, every time │
│  BYTECODE    source → bytecode, then interpret the bytecode       │
│  JIT         interpret first; compile HOT parts to native mid-run │
│  AOT         compile ALL to native machine code before running    │
├──────────────────────────────────────────────────────────────────┤
│  Translation timing:                                              │
│    AOT ........... build time (developer pays once)               │
│    Interpret ..... run time, continuously (user pays a little)    │
│    JIT ........... run time, up front (user pays warmup, then 0)  │
├──────────────────────────────────────────────────────────────────┤
│  Startup speed:   AOT  >  bytecode  >  JIT   (AOT wins)           │
│  Peak speed:      JIT  ≈  AOT  >>  interpret (JIT/AOT win)        │
│  Memory:          AOT  <  bytecode  <  JIT   (AOT lightest)       │
├──────────────────────────────────────────────────────────────────┤
│  Where languages sit:                                             │
│    CPython, Ruby     bytecode interpreter                         │
│    Java (HotSpot)    bytecode + tiered JIT                        │
│    JavaScript (V8)   bytecode + tiered JIT                        │
│    C, C++, Rust, Go  AOT to native                                │
│    Java GraalVM /                                                 │
│    C# NativeAOT      AOT of a normally-JIT'd language             │
├──────────────────────────────────────────────────────────────────┤
│  Rules of thumb:                                                  │
│    short-lived / starts often (CLI, serverless)  → AOT            │
│    long-lived server / daemon                     → JIT           │
│    scripting, prototyping                         → interpreter   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- The CPU only runs **machine code**. Every strategy is about *when* and *how* your source becomes machine code (or gets executed without ever fully becoming it).
- **Interpretation** reads your code and acts on it as it runs, paying overhead every time. A **tree-walking** interpreter is the simplest and slowest; a **bytecode** interpreter (CPython, Ruby) is much faster.
- **AOT compilation** (C, C++, Rust, Go) translates everything to native code *before* running. Result: instant startup, low memory, no warmup, a single binary — but no runtime adaptivity and a platform-specific binary.
- **JIT compilation** (Java HotSpot, JavaScript V8) interprets first, then compiles the *hot* code to native *while running*, using **profiles** of real behavior. Result: top peak performance and adaptivity — at the cost of **warmup**, memory, and complexity.
- It is a **spectrum, not a binary.** Most real languages mix ingredients: Python compiles to bytecode *then* interprets; Java compiles to bytecode *and* interprets *and* JITs; .NET can JIT or AOT.
- **Who pays, and when** is the key trade-off: AOT charges the developer at build time; interpreters charge users a little continuously; JITs charge users a lot up front (warmup), then nothing.
- **AOT for managed languages** (GraalVM native-image, .NET NativeAOT) came back because of CLI tools and serverless cold-starts, where JIT warmup is a dealbreaker — at the cost of breaking reflection and runtime specialization.
- A junior's takeaway: stop saying "compiled vs interpreted"; instead, ask *when does translation happen, and does the program live long enough to make warmup worth it?*

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Builds a tree-walking interpreter *and* a bytecode VM from scratch. The single best introduction to this whole topic. Free online at https://craftinginterpreters.com/
- *Python documentation — the `dis` module.* Disassemble your own functions and see the bytecode. https://docs.python.org/3/library/dis.html
- *The Java HotSpot Performance Engine Architecture* — Oracle whitepaper. The classic explanation of tiered JIT.
- *Understanding V8's Bytecode* — Franziska Hinkelmann. A clear blog post on how V8 turns JS into bytecode and beyond.
- *GraalVM Native Image* documentation — https://www.graalvm.org/latest/reference-manual/native-image/ — for how a JIT'd language gets AOT-compiled.
- *A Crash Course in Just-In-Time (JIT) Compilation* — Eli Bendersky's blog. Builds a tiny JIT in a few hundred lines.
- *The Go Programming Language* — Donovan & Kernighan. For the AOT, single-binary philosophy in practice.
