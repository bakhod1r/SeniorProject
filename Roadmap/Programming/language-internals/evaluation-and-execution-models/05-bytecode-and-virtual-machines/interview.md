# Bytecode & Virtual Machines — Interview Questions

> **Topic:** [Bytecode & Virtual Machines](README.md)
> **Focus:** Conceptual foundations, language-specific bytecode (JVM / CPython / CLR / Lua / Wasm), tricky traps, and open-ended design questions.

---

## How to use this file

Questions are grouped by category. Each has a concise model answer and, where it helps, the *follow-up* an interviewer is likely to push on. Read the question, answer out loud or on paper, *then* check. The goal is to explain — not recite. Categories:

- **Conceptual** — the model and its mechanics.
- **Language-Specific** — JVM bytecode/`.class`, CPython `.pyc`/`dis`, CLR CIL, Lua, WebAssembly.
- **Tricky-Trap** — common misconceptions and "gotcha" questions.
- **Design** — open-ended; reason about trade-offs.

---

## Conceptual

## Question 1

**What is bytecode, and how is it different from machine code and from source?**

Source is human-readable text. Machine code is the raw, processor-specific bytes a *physical* CPU executes. **Bytecode sits between them: a compact, portable instruction set for an *abstract* (imaginary) machine.** A compiler lowers source to bytecode *once*; a virtual machine then executes that bytecode — interpreting it or JIT-compiling it to machine code at runtime. The key properties: bytecode is *portable* (same on every platform; only the VM is platform-specific), *compact*, pre-parsed (so faster than re-interpreting source), and *checkable* (can be verified before running).

## Question 2

**Why use bytecode at all instead of just interpreting source or compiling straight to native?**

Interpreting source means re-parsing on every run (slow). Compiling straight to native means the compiler must target every CPU and the artifact runs on only one. Bytecode splits compilation into two phases: front-end (source → bytecode, done once, does the parsing/name-resolution/desugaring) and execution (VM runs bytecode every time). You get portability (one artifact, many platforms), speed over re-interpreting source, compactness, and a verifiable, language-neutral target that a JIT can later turn into native code. *Follow-up:* "Then why is Go fast without bytecode?" — Go AOT-compiles to native and accepts losing portability of a single artifact and the JIT's profile-guided speculation; different trade-off, not a strictly better one.

## Question 3

**Describe the fetch-decode-execute loop.**

The VM keeps a program counter (PC) into the bytecode. Each iteration: **fetch** the opcode at the PC and advance it; **decode** which operation it is (and read any inline operands); **execute** the matching action (manipulate the operand stack, locals, PC); repeat until halt/return. That loop *is* the virtual machine — a CPU implemented in software. Everything else (GC, JIT, verifier) is supporting machinery.

## Question 4

**Stack-based vs register-based VM — explain the difference and the trade-off.**

A **stack machine** takes operands from / pushes results to an implicit *operand stack* (`LOAD a; LOAD b; ADD`). A **register machine** names operands explicitly as numbered virtual registers (`ADD r2, r0, r1`). Trade-off: stack VMs emit *more, smaller* instructions with trivial codegen but pay more *dispatch* overhead; register VMs emit *fewer, larger* instructions, dispatch less, and are easier to JIT (operands/dataflow are explicit) but need register allocation in codegen. Lua 5 switched stack→register and got faster *as an interpreter* because it executes fewer instructions. The JVM stays stack-based because its bytecode is a compact, verifiable *transport format* and a JIT recovers the speed anyway.

## Question 5

**What is the operand stack, what are local-variable slots, and what is the constant pool? How do they differ?**

The **operand stack** holds *temporary* values during expression evaluation (pushed/popped constantly). **Local variable slots** are numbered storage for a function's named locals (`LOAD slot_n` / `STORE slot_n`), persistent across the function call. The **constant pool** is a side table of literals (numbers, strings, names, symbolic references); instructions refer to entries by *index* rather than embedding values inline, keeping instructions small and uniform. All three are per-frame except the constant pool, which is per-class/module.

## Question 6

**How does control flow (if/while/&&) appear in bytecode?**

As **jumps** that modify the PC. There is no `if` or `while` opcode (except Wasm's structured control flow). An `if/else` becomes a conditional branch over the `then` block plus an unconditional `goto` past the `else`. A loop is a conditional exit branch plus a backward `goto` to the top. Short-circuit `a && b` compiles so that a false `a` *jumps past* evaluating `b`. *Follow-up — backpatching:* a single-pass compiler emits a *forward* jump before it knows the target, leaving a placeholder, then overwrites it once the target is generated; backward jumps (loops) need no patching since the target already exists.

## Question 7

**Walk `a + b * c` to stack bytecode by hand.**

Operator precedence makes `b * c` evaluate first:

```
LOAD a        stack: [a]
LOAD b        stack: [a, b]
LOAD c        stack: [a, b, c]
MUL           stack: [a, b*c]
ADD           stack: [a + b*c]
```

The bytecode *encodes precedence as evaluation order*; the VM itself knows nothing about precedence — the compiler resolved it. (This is exactly what `javap -c` shows as `iload/iload/iload/imul/iadd` and `dis` as `LOAD_FAST×3 / BINARY_OP(*) / BINARY_OP(+)`.)

## Question 8

**What is a stack effect, and why does the operand stack need to "balance"?**

A stack effect is how many values an instruction pops and pushes (`ADD` = pop 2, push 1, net −1). The stack must **balance**: at any point where control flow merges (loop top, join after an `if`), the stack must have the *same depth and types* on all incoming paths, and a method must not under/overflow it. The compiler computes the maximum depth (`max_stack`) to pre-size the frame, and the JVM verifier *rejects* bytecode whose stack doesn't balance — otherwise an instruction could pop a value that isn't there.

## Question 9

**Compare interpreter dispatch techniques: switch, direct/computed-goto threading, tail-call threading.**

- **Switch:** `while{ switch(op) }`. Portable, but a single shared indirect branch the CPU branch-predictor mispredicts almost every iteration.
- **Computed-goto / token threading** (GCC/Clang `&&label`, `goto *table[op]`): each handler ends by jumping straight to the next, so there's a *separate* indirect branch per opcode that predicts far better. Typically 1.5–2.5× faster.
- **Tail-call threading:** each handler is a function ending in a guaranteed tail call (`musttail`) to the next; becomes a jump, gives each handler its own register allocation, and is more portable than computed goto.

The common thread: every technique is a *branch-prediction* optimization. The interpreter's enemy is the mispredicted indirect branch, not the arithmetic.

## Question 10

**What are superinstructions and stack caching?**

**Superinstructions** fuse a frequent *sequence* of opcodes (e.g. `LOAD; LOAD; ADD`) into one opcode, cutting the number of dispatches. **Stack caching** keeps the top one or two operand-stack entries in CPU registers instead of memory, so chains of operations avoid load/store round-trips. Both reduce per-instruction cost; superinstructions attack dispatch count, stack caching attacks memory traffic. CPython's adaptive specializing interpreter is a runtime form of this idea.

## Question 11

**What does bytecode verification do, and why does it exist?**

Before running bytecode it doesn't trust, the JVM **verifier** statically proves: **type safety** (every instruction gets operands of the type it expects), **stack balance** (no under/overflow; consistent depth/types at merges), **legal control flow** (jumps land on valid instruction boundaries, within the method), and **initialization** (objects constructed and locals written before use). It exists so untrusted bytecode (applets, plugins, generated code) *cannot* break the VM's memory safety. Native machine code has no such gate. *Follow-up — stack-map frames:* since Java 6 the compiler emits type snapshots at branch targets so verification is a single linear pass instead of an iterative dataflow fixpoint.

## Question 12

**What is lazy linking / symbolic resolution?**

A compiled class refers to other classes/methods/fields *by name* — **symbolic references** in the constant pool — because their memory locations are unknown at compile time. The VM **resolves** a reference (loads the class if needed, checks access, finds the concrete method/slot) **lazily**, the first time that reference is actually executed, then **caches** the result (inline cache / rewritten pool entry) so later uses are fast. This enables fast startup (no eager loading of the whole transitive closure) and independent compilation. A consequence: a `NoSuchMethodError` can appear at *first call*, not at load.

## Question 13

**Why is bytecode the natural handoff point to a JIT?**

Because it's already parsed, name-resolved, and desugared (the JIT starts from simple regular instructions, not text); compact and uniform (fast to read into the JIT's IR); verified (the JIT can trust stack-balance/type invariants instead of re-checking); carries natural profile attachment points (each offset can hang counters and type feedback); and is language-neutral (one JIT serves Java, Kotlin, Scala, Clojure). A tiered VM interprets first to gather a profile, then JIT-compiles hot methods/loops using that profile, with OSR to swap in compiled code mid-loop and deopt back when speculation fails.

---

## Language-Specific

## Question 14

**JVM: what's inside a `.class` file?**

In order: the magic number `0xCAFEBABE`, minor/major version, the **constant pool** (strings, class/method/field symbolic references, numeric literals), access flags, this/super class indices, interfaces, fields, **methods** (each with a `Code` attribute containing `max_stack`, `max_locals`, the bytecode bytes, an exception table, and debug attributes like `LineNumberTable` and `StackMapTable`), and class-level attributes. The constant pool is the spine — almost everything references it by 1-based index.

## Question 15

**JVM: why are there separate `iadd`, `ladd`, `fadd`, `dadd` opcodes? And why `iload_1` instead of `iload 1`?**

JVM bytecode is **typed**: distinct opcodes per primitive type make verification and JIT straightforward (the verifier knows the operand types from the opcode alone), at the cost of a larger opcode set. `iload_1` is a single-byte *specialized* opcode for "load int local 1" — among the most common operations — versus the two-byte general `iload <index>`. It's an opcode-budget decision: spend single bytes on the hottest ops. *Follow-up:* `long`/`double` occupy *two* stack and *two* local slots.

## Question 16

**JVM: what is `invokedynamic`, and why was it added?**

`invokedynamic` is a deliberately *open-ended* call instruction: instead of binding to a fixed method, its first execution runs a user-supplied **bootstrap method** that *links* the call site to a target (a `CallSite`/`MethodHandle`), which is then cached. It was added (JSR-292) originally for dynamic languages on the JVM, then reused to implement Java 8 **lambdas** and Java 9 **string concatenation** — adding major language features *without minting new opcodes*. It's the canonical example of designing an opcode for *evolution*.

## Question 17

**CPython: what is `dis`, and what does it show?**

`dis` is the standard-library **disassembler**. `dis.dis(fn)` prints the function's bytecode as readable instructions — opcodes like `LOAD_FAST`, `BINARY_OP`, `POP_JUMP_FORWARD_IF_FALSE`, `RETURN_VALUE` — with their arguments and jump targets. It's the canonical way to see *exactly* what Python compiled your code to. *Follow-up:* exact opcode names change across Python versions (e.g. `BINARY_ADD` → `BINARY_OP` in 3.11); learn the *shape*, not the spelling. `dis.dis(fn, adaptive=True)` (3.11+) can reveal *specialized* opcodes after warmup.

## Question 18

**CPython: what is a `.pyc` file and why does it exist? Why won't a 3.11 `.pyc` load in 3.12?**

A `.pyc` (in `__pycache__/`) caches a module's compiled bytecode so re-importing an unchanged module skips re-parsing/re-compiling — a startup optimization. Its header has a **magic number tied to the interpreter version**, plus a source hash or timestamp and size. A 3.12 interpreter sees the 3.11 magic mismatch and *recompiles from source* rather than loading incompatible bytecode. CPython **deliberately does not keep bytecode stable across minor versions** — it freely changes opcodes to optimize each release, trading cross-version portability for optimization freedom. *Follow-up:* this is the opposite philosophy from the JVM, whose old bytecode runs forever.

## Question 19

**CPython: is Python "interpreted" or "compiled"?**

Both, depending on what you mean. Python **compiles** each module to **bytecode** (the thing in `.pyc`), then an **interpreter** (the CPython VM loop, a stack machine) executes that bytecode. So "Python interprets source line by line" is wrong — it interprets *bytecode*. As of 3.11+ it also adaptively *specializes* hot opcodes, and 3.13+ ships an experimental copy-and-patch **JIT** for hot code.

## Question 20

**CLR: what is CIL, and how does it relate to the JVM?**

CIL (Common Intermediate Language, formerly MSIL) is .NET's bytecode — the target for C#, F#, VB.NET, etc. Like the JVM it's a **stack-based**, **verifiable** bytecode stored in assemblies (`.dll`/`.exe`) with metadata and a typed instruction set, normally JIT-compiled to native by the CLR (with AOT options like ReadyToRun/NativeAOT). Key differences from the JVM: CIL has first-class support for **value types** (structs) and **generics are reified** (preserved at runtime, not erased), and it was designed multi-language from the start. *Follow-up:* you can inspect it with `ildasm` or ILSpy.

## Question 21

**Lua: why is Lua 5's VM register-based, and what changed from Lua 4?**

Lua 4 used a **stack-based** VM; **Lua 5.0 switched to a register-based** VM (fixed-width 32-bit instructions, a per-function register window). The motivation was *interpreter speed without a JIT*: register-based code executes **fewer instructions** for the same work (operands are named in one instruction instead of pushed/popped), so it dispatches less — a measurable speedup, documented in "The Implementation of Lua 5.0." Lua is embedded everywhere (games, Redis, nginx, Roblox) and must be fast as a plain interpreter, which makes the register design pay off. (LuaJIT later added a tracing JIT on top.)

## Question 22

**WebAssembly: why is it fast to validate and JIT?**

By deliberate design. **Structured control flow** (`block`/`loop`/`if`/`br` to *enclosing* labels only — no arbitrary gotos) plus **explicit function/type signatures** and a simple type system make **validation single-pass, linear-time, and total** — a streaming validator can accept/reject a module *while it downloads*, with no dataflow fixpoint or stack-map machinery. The same regularity and explicit typing make it map cleanly to machine code, so a baseline compiler can JIT in one pass and tier up. Compare the JVM verifier, which is complex enough to have needed stack-map frames to get linear.

## Question 23

**WebAssembly: what is linear memory, and how does Wasm sandbox untrusted code?**

**Linear memory** is a single, contiguous, byte-addressable, bounds-checked memory region (a resizable `ArrayBuffer`) — the *only* memory a module can read or write. It cannot reach host memory or other modules. Combined with **capability-based** access (a module can call *only* the functions/memory/table explicitly imported into it — no ambient filesystem/network/clock) and **traps** (out-of-bounds, divide-by-zero, etc. cause a clean defined abort, never memory corruption or UB), this makes it safe to run fully untrusted Wasm. Resource exhaustion is handled separately by **fuel/epoch** metering.

## Question 24

**BEAM: what makes the Erlang VM unusual at the bytecode/VM level?**

It's **register-based** and built around concurrency and fault tolerance: it counts **reductions** (each process runs ~2000 units of work, then is preempted) to give **fair, preemptive, soft-real-time scheduling** of millions of lightweight processes on a handful of OS threads. Processes share *no* mutable memory (messages are copied), enabling tiny per-process GC. It also supports **hot code loading** — swapping in a new module version while the old one runs. These are non-functional requirements (fairness, isolation, uptime) driving VM design.

---

## Tricky-Trap

## Question 25

**Trap: "Compiled languages are fast and interpreted languages are slow — Java is compiled, Python is interpreted."** What's wrong with this?

The framing conflates several things. Both Java *and* Python **compile to bytecode**; the difference is what runs it. Java's bytecode is run by a JVM with a world-class JIT (often near-native speed); CPython mostly interprets (with growing specialization/JIT). "Compiled" ≠ "native machine code" — a `.class` and a `.pyc` are both *compiled*, just to bytecode. Speed comes from the *execution strategy* (interpret vs JIT vs AOT), not from the binary label "compiled/interpreted."

## Question 26

**Trap: Is the operand stack the same as the call stack?**

No — a very common confusion. The **call stack** holds one *frame* per active function call. Each frame contains its **own** operand stack (for expression temporaries) plus its local-variable slots. So the operand stack is a small thing *inside* each call frame; "the stack" colloquially usually means the call stack.

## Question 27

**Trap: Does fewer source lines (or fewer bytecodes) mean faster code?**

No reliable relationship. Bytecode count is a poor proxy for runtime: the JIT, inline caches, branch prediction, memory effects, and superinstructions dominate. Two functions with very different bytecode counts can run identically once JIT-compiled. Always *measure* wall-clock on representative input; never "optimize for fewer opcodes" by eye.

## Question 28

**Trap: Bytecode is binary, so shipping `.class` files hides my source code, right?**

No. Bytecode retains enormous structure (names, types, method signatures, line tables), so `.class` files **decompile** back to near-original source trivially (JD, CFR, Fernflower). Shipping bytecode protects nothing; if you need to deter reverse engineering you need an obfuscator, and even then it's only a speed bump.

## Question 29

**Trap: A VM and an emulator are the same thing.** True or false?

Mostly false, in this context. A language VM executes a *designed-from-scratch, imaginary* instruction set (JVM bytecode, CIL, Wasm) that no physical chip runs. An **emulator** reproduces the behavior of a *real, different* CPU/system (running SNES games on a PC). Related machinery (both have fetch-decode-execute), different purpose: abstraction-and-portability vs. faithful reproduction of real hardware.

## Question 30

**Trap: If untrusted bytecode is memory-safe (verified/sandboxed), it's safe to run.** What's missing?

Memory safety (isolation) is necessary but not sufficient. Memory-safe code can still **loop forever** or **allocate until OOM**, DoSing the host. You also need **confinement** (capabilities — it can only call what you grant; no ambient filesystem/network) and **resource metering** (gas/fuel/reductions to bound CPU, caps on memory). Safe ≠ bounded. Consensus VMs additionally need **determinism**.

## Question 31

**Trap: `goto` doesn't exist in Java, so JVM bytecode has no gotos.** Right?

Wrong — at the bytecode level there *is* a `goto` opcode, and it's how every loop is implemented (the backward branch to the loop condition). The *source language* Java has no `goto` statement, but `for`/`while`/`break`/`continue` all compile to `goto`/conditional-branch bytecode. Source-level and bytecode-level control flow are different layers.

## Question 32

**Trap: If two threads each execute one Python bytecode, are they atomic with respect to each other?**

Roughly, *individual* bytecodes are atomic with respect to the GIL (the interpreter holds the GIL while executing one bytecode and may release it at instruction boundaries). But a `+=` is *multiple* bytecodes (`LOAD`, `BINARY_OP`, `STORE`), so it is **not** atomic — two threads can interleave and lose updates. The trap is assuming "one statement" or "one operation" equals "one atomic bytecode." It usually doesn't.

---

## Design

## Question 33

**Design: You're building a small embeddable scripting language. Stack-based or register-based VM? Justify.**

Depends on the constraints. If you have *no JIT* and want speed as a plain interpreter, **register-based** (Lua's reasoning) — fewer instructions, less dispatch — at the cost of harder codegen (register allocation). If you want the *simplest correct implementation*, a clean verifiable format, and you might JIT later (where the JIT reconstructs dataflow), **stack-based** is fine and easier to build. State the assumption (JIT? interpreter-only? footprint?) and decide from it. A strong answer also notes you could prototype stack-based for simplicity and switch to register-based if profiling shows dispatch is the bottleneck.

## Question 34

**Design: You have a single-byte opcode field (256 codes). How do you avoid running out, and how do you plan for growth?**

(1) **Allocate by frequency** — give single-byte opcodes to the hottest operations (fast-path locals, common arithmetic), push rare ops elsewhere. (2) **Reserve an escape prefix** byte that means "the real opcode is on a second page," so you can grow past 256 without a format break. (3) **Reserve a block of unused opcodes now** for future hot ops. (4) Consider **superinstructions** for the truly hot sequences. The cost of prefixes is density/decode speed, so keep the prefixed page for rare ops. Above all: a magic number and explicit version field so you can evolve safely.

## Question 35

**Design: How do you design a bytecode you can safely JIT later?**

Make the encoding **regular** (uniform decode, easy to lift into an IR), keep operands/types **explicit** (or attach type-feedback hooks for dynamic typing), keep **bytecode offsets stable** so you can hang profile counters/type feedback at each site, and ensure every specializable opcode has a **deopt-safe generic form** so the JIT can speculate and fall back. Verify the bytecode so the JIT can trust structural invariants. Register-based or at least dataflow-recoverable bytecode helps. Retrofitting these onto an ad-hoc format is painful — design for it up front.

## Question 36

**Design: You must run fully untrusted user code (a plugin marketplace). What's your architecture?**

Three independent guarantees: **isolation** (memory-safe sandbox — verified bytecode with no raw host pointers; strongly consider embedding an existing hardened runtime like a Wasm engine or a V8 isolate rather than rolling your own), **confinement** (capability-based — the plugin can call *only* the host functions you explicitly inject; deny-by-default, no ambient filesystem/network/clock), and **metering** (fuel/gas/epoch interruption to bound CPU, hard caps on memory). Treat the validator as the security boundary — fuzz it. If reproducibility matters, exclude nondeterministic operations. Strongly prefer an existing VM (Wasm/WASI) so you inherit a hardened JIT, GC, and sandbox.

## Question 37

**Design: Should your bytecode be stable across versions? Argue both sides.**

**Stable (JVM model):** old artifacts run forever; great for a public platform where third parties produce and persist bytecode; evolution must be *additive* (never remove/repurpose opcodes; `invokedynamic`-style open hooks; skippable unknown sections). **Unstable (CPython model):** you can aggressively change opcodes to optimize each release; fine when *you* control compilation and recompile from source (keyed `.pyc` cache). The wrong answer is to have *no* policy — that breaks persisted artifacts and external producers unpredictably. Decide deliberately and publish the promise; if external parties produce your bytecode, you almost certainly want stability.

## Question 38

**Design: A blockchain smart-contract VM has a constraint ordinary VMs don't. What is it, and what does it force?**

**Determinism** — every node must produce *bit-identical* results executing the same bytecode, or the chain forks. This forces: no nondeterministic opcodes (no wall-clock, no nondeterministic float behavior, defined map/iteration order), a precise, agreed **gas cost** for every operation (and the costs must reflect real resource use, or attackers exploit underpriced ops — the EVM has repriced via hard forks after DoS attacks), hard determinism in memory/allocation behavior, and gas-metered halting so a malicious contract can't run forever. It's the most adversarial bytecode environment: every node is mutually distrusting and the code is fully untrusted.

## Question 39

**Design: Walk me through building the minimum VM to run `if`/`while`. What components do you need?**

You need: a **bytecode array** + **program counter**; an **operand stack** and **local slots**; opcodes for `PUSH`/`LOAD`/`STORE`, arithmetic/comparison, an **unconditional jump** (`JMP target`) and a **conditional jump** (`JMP_IF_FALSE target`), plus `HALT`/`RETURN`; and a fetch-decode-execute loop. For the *compiler*, you need **backpatching** for forward jumps (emit a placeholder target for the `if`/loop-exit branch, fill it once you know where it lands) — backward jumps for loops need no patching. That's the whole skeleton; everything else (functions, GC, verification, JIT) is layered on top. This is the `tasks.md` capstone.

## Question 40

**Design: How would you decide between building your own VM vs targeting an existing one (JVM, Wasm, V8)?**

Default to **targeting an existing VM**: you inherit a hardened JIT, GC, verifier, debugger, profiler, and security model — enormous, hard-to-replicate value. Build your own only when you have a strong, specific reason: your language semantics don't fit the host's object model (e.g. you need guaranteed tail calls the JVM lacks, or value semantics it erases), you need a tiny footprint the host can't meet (embedded/IoT), you need a security/metering model the host doesn't offer, or the bytecode *is* the product (a deterministic consensus VM). Quantify the cost: a production VM is years of work and an ongoing security liability (the verifier alone).

---

## Closing note

Strong candidates do three things consistently: (1) distinguish *layers* (source vs bytecode vs native; operand stack vs call stack; source control flow vs jump bytecode), (2) explain *why* a design exists by tracing it to a requirement (Wasm's structured control flow → fast validation; Lua's register VM → interpreter speed; `invokedynamic` → additive evolution), and (3) reason about *trade-offs* out loud rather than reciting one "right" answer — especially for the design questions, where stating your assumptions is most of the score.
