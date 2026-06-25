# Interpretation, Compilation, JIT, AOT — Hands-On Tasks

> **Topic:** [Interpretation, Compilation, JIT, AOT](README.md)

---

## Introduction

You cannot feel the difference between a tree-walker and a bytecode VM, between a
cold JIT and a warm one, or between AOT startup and JIT peak, by reading about
them. You have to build the small versions and *measure*. These tasks take you
from a 50-line interpreter to a profile-guided "compile-on-hot" loop, and every
one ends with a number you can defend.

How to use this file: implement first, measure second, read the hints only after
you have a result that surprises you. Use a real timer (`perf_counter`,
`System.nanoTime`, `performance.now`) and always warm up before you measure a
JIT. Tick the self-check boxes when you can *explain* the number to someone else,
not when the program merely runs.

---

## Table of Contents

1. [Warm-Up](#warm-up)
2. [Core](#core)
3. [Advanced](#advanced)
4. [Capstone](#capstone)
5. [Self-Assessment](#self-assessment)

---

## Warm-Up

### Task 1 — Disassemble three runtimes

Take the one-liner `def f(n): return n*n + 1`.

1. In Python, run `import dis; dis.dis(f)` and read the bytecode.
2. In Java, compile `int f(int n){ return n*n + 1; }` and run `javap -c` on the class.
3. In a browser, paste the JS equivalent into the console with `%DisassembleFunction` (Node `--allow-natives-syntax`) — or just observe that you *can't* see native code easily, and ask why.

**Self-check:**
- [ ] I can point to the multiply, the add, and the return in each listing.
- [ ] I can explain why the Python listing has explicit `LOAD_FAST`/`BINARY_*` opcodes but the Java JIT'd version eventually has none of them.

<details><summary>Hint</summary>

Python stays as bytecode and is interpreted; `javap` shows JVM *bytecode*, which is
itself later JIT-compiled by HotSpot into native code you don't see in `javap`.
The "I can't see it" for JS is the point: the native code is generated at runtime
and thrown away on deopt.
</details>

### Task 2 — Tree-walker for arithmetic

Write a tree-walking interpreter for `+ - * /` and integer literals over a parsed
AST (you may hand-build the AST; parsing is not the point). Evaluate
`(2 + 3) * (4 + 5)`.

**Self-check:**
- [ ] My `eval(node)` recurses on children and dispatches on node type.
- [ ] I can state the per-node overhead (a virtual call / type switch per AST node, every time).

---

## Core

### Task 3 — Same language, bytecode VM

Compile the *same* AST from Task 2 to a tiny stack bytecode (`PUSH`, `ADD`,
`SUB`, `MUL`, `DIV`) and write a fetch-decode-execute loop over a `list`/array of
instructions. Run the same expression a million times in a loop with both the
tree-walker and the bytecode VM. Record the ratio.

**Self-check:**
- [ ] The bytecode VM is measurably faster.
- [ ] I can explain *why* (no pointer-chasing over AST nodes; linear instruction stream; better cache behaviour; cheaper dispatch).

<details><summary>Hint</summary>

Expect somewhere between 2× and 10× depending on language. The win is mostly
"flatten the tree into a linear stream and stop re-walking it." If your ratio is
~1×, you probably allocate inside the hot loop — hoist it out.
</details>

### Task 4 — Watch a JIT warm up

In Java (or Node), put a compute-heavy function in a loop and time *each
iteration block* of, say, 100k calls. Print the per-block time for the first 30
blocks.

**Self-check:**
- [ ] The first blocks are slow, then there's a step-change as the method gets compiled.
- [ ] I can identify roughly which block the C2/TurboFan compile kicked in.
- [ ] Adding `-XX:+PrintCompilation` (Java) shows the method being compiled at that moment.

<details><summary>Hint</summary>

HotSpot's default compile threshold is in the thousands of invocations; you'll
see the interpreter → C1 → C2 staircase. On Node, `--trace-opt --trace-deopt`
prints the same story for TurboFan.
</details>

### Task 5 — Force a deoptimization

Write a JS function that does integer math, call it 100k times with integers (so
it gets optimized assuming integers), then call it once with a string or a float
that breaks the speculation. Run with `--trace-deopt`.

**Self-check:**
- [ ] I see a `deoptimizing` log line at the moment the type assumption breaks.
- [ ] I can explain what "on-stack replacement" and "bailout to the interpreter" mean here.

---

## Advanced

### Task 6 — Dispatch overhead: switch vs computed-goto

Implement the bytecode loop from Task 3 twice in C: once with a `switch` on the
opcode, once with a computed-goto / direct-threaded dispatch table
(`&&label` GCC extension). Benchmark a long instruction stream.

**Self-check:**
- [ ] I measured a difference (often 10–30%) and can explain it via branch prediction (one shared indirect branch in `switch` vs one per opcode in threading).
- [ ] I understand why interpreter authors care about this single line of code.

### Task 7 — AOT vs JIT: startup and peak

Take one CPU-bound program. Run it (a) on the JVM normally, and (b) compiled with
GraalVM `native-image` (or a .NET app with NativeAOT). Measure two things: **time
to first output** (startup) and **steady-state throughput** after warmup.

**Self-check:**
- [ ] AOT starts much faster and uses less memory.
- [ ] JIT reaches equal-or-higher *peak* throughput after warmup.
- [ ] I can state which one I'd pick for (1) a CLI tool, (2) a long-running server, (3) a serverless function — and why.

<details><summary>Hint</summary>

This is the whole tradeoff in two numbers: AOT trades away runtime adaptive
specialization (and breaks closed-world assumptions like reflection) for instant
startup and low memory. Serverless cold-starts are exactly why AOT for managed
languages came back.
</details>

### Task 8 — Profile-guided constant

Write a function with a branch whose outcome is 99% one-way. Compile it with PGO
(`-fprofile-generate` then `-fprofile-use`, or `pgo` in Go/.NET) and inspect
whether the hot path got laid out first / the cold path got outlined.

**Self-check:**
- [ ] I can see (in the asm or in the timing) that the compiler used the profile.
- [ ] I understand that a JIT gets this profile *for free* at runtime, while AOT needs a training run.

---

## Capstone

### Task 9 — A "compile-on-hot" mini-runtime

Build a toy runtime for the arithmetic language that:

1. Starts every function as a **tree-walker**.
2. Counts invocations per function.
3. After a function crosses a threshold `N`, **compiles** it to the bytecode form
   (Task 3) and switches future calls to the faster path.
4. Logs each "tier-up" event: `function <id> promoted after <N> calls`.

Then add **one speculation**: assume all operands are small integers, compile a
specialized path that skips type checks, and **deoptimize** (fall back to the
tree-walker) the first time a non-integer appears — logging the bailout.

**Self-check:**
- [ ] My runtime demonstrates the interpreter → compiled staircase on a real workload.
- [ ] My deopt path is correct: the program produces the *right* answer even when speculation fails, just slower.
- [ ] I can map every piece of my toy to its real-world counterpart (HotSpot tiers, OSR, deopt, profile counters).

<details><summary>Hint</summary>

Keep the "compiler" trivial — flattening the AST to bytecode *is* a compiler for
this purpose. The lesson is the control structure (count → tier-up → specialize →
guard → deopt), which is exactly what HotSpot, V8, and SpiderMonkey do at vastly
larger scale.
</details>

---

## Self-Assessment

You have internalised this topic when you can:

- [ ] Place any runtime on the interpret→bytecode→baseline-JIT→optimizing-JIT→AOT spectrum and justify it.
- [ ] Explain warmup, OSR, and deoptimization from having *watched* them, not read them.
- [ ] Predict, for a new workload, whether AOT or JIT wins — and on which metric (startup, memory, peak).
- [ ] Explain why "the interpreter is slow" is mostly about dispatch and pointer-chasing, and what a bytecode VM does about it.
