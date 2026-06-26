# Interpreters — Interview Questions

> **Topic:** [Interpreters](README.md)

---

## Introduction

These questions probe whether a candidate understands what it means to *implement* a language by executing it rather than compiling it to native code — the full spectrum from a tree-walking `eval` to a bytecode VM with threaded dispatch, inline caches, and a path to a JIT. A strong candidate moves fluently between levels: they can write `eval(node, env)` on a whiteboard, explain why CPython stores locals in an array and not a dict, describe the branch-prediction reason computed goto beats a `switch`, reason about closures via upvalues, and place CPython, Lua, V8, Ruby, and the BEAM correctly on the spectrum. A weaker candidate knows the words ("interpreter," "bytecode," "JIT") but cannot explain *why* one design is faster than another or *what the CPU is actually doing*.

The questions are grouped: **Conceptual / Foundational** (the model and the dispatch core), **Implementation-Specific** (CPython, Ruby, Lua, JS engines, the BEAM), **Tricky / Trap** (where the textbook answer is wrong), and **System / Design**. Use the answers as a rubric, not a script.

## Table of Contents

- [Conceptual / Foundational](#conceptual--foundational)
- [Implementation-Specific](#implementation-specific)
- [Tricky / Trap Questions](#tricky--trap-questions)
- [System / Design Scenarios](#system--design-scenarios)
- [Cheat Sheet](#cheat-sheet)
- [Further Reading](#further-reading)

---

## Conceptual / Foundational

## Question 1

**What is the difference between a compiler and an interpreter, and where does the line blur?**

A compiler translates a program into another form (usually machine code) ahead of time, to be run later; an interpreter executes the program directly by reading and acting on it. The line blurs constantly. CPython "compiles" to bytecode and then interprets it. Subroutine-threaded bytecode is essentially a list of calls — close to compiled code. A JIT compiles at runtime, so the same engine both interprets (cold code) and compiles (hot code). Partial evaluation can turn an interpreter *into* a compiler. The honest answer is that "interpret vs compile" is a spectrum measured by *how much work is pre-resolved and specialized, and when* — not a binary.

## Question 2

**Describe a tree-walking interpreter. Write the core of `eval`.**

After parsing source into an AST, a tree-walking interpreter executes the program by recursively evaluating nodes:

```text
eval(node, env):
  Number(n)        -> n
  Var(name)        -> env[name]
  BinOp(op, l, r)  -> apply(op, eval(l, env), eval(r, env))
  Assign(name, e)  -> env[name] = eval(e, env)
  If(c, t, e)      -> if truthy(eval(c, env)): exec(t) else exec(e)
  While(c, body)   -> while truthy(eval(c, env)): exec(body)
```

The key shape: evaluate children first (post-order), then combine. Control flow uses the *host* language's own control flow. Variables live in an environment (a hash map) passed into `eval`. It is the simplest interpreter to build and the slowest to run.

## Question 3

**Why is a tree-walking interpreter slow?**

Two dominant costs, paid per node, every time: **type dispatch** (checking "what kind of node is this?" on each visit) and **pointer-chasing** (following references to child nodes scattered across the heap, which thrashes the CPU cache). Plus, variable access is a string-hash lookup in a map. None of this work is amortized — it repeats on every execution. A bytecode VM fixes all three: flat contiguous code (cache-friendly), integer dispatch (one switch), and locals resolved to array slots at compile time.

## Question 4

**What is bytecode, and what does the interpreter loop do with it?**

Bytecode is a flat array of small numeric instructions (opcodes plus operands), produced by compiling the AST once. The interpreter loop runs a **fetch–decode–execute** cycle: read the opcode at the instruction pointer (fetch), determine which handler it is (decode), run that handler — push/pop the operand stack, touch locals — (execute), and repeat. It is a CPU implemented in software: the IP is the program counter, opcodes are the instruction set, the operand stack and locals array are its memory.

## Question 5

**Stack-based vs register-based bytecode VMs — trade-offs?**

A stack-based VM (CPython, JVM, YARV, WebAssembly) holds operands on an operand stack; instructions are small with few operands (`ADD` pops two, pushes one) and are easy to generate, but you execute many push/pop instructions. A register-based VM (Lua 5+, Dalvik, the BEAM) holds operands in numbered virtual registers; instructions name their operands (`ADD r0, r1, r2`), so `a = b + c` is one instruction instead of four — fewer dispatches and less memory traffic, at the cost of a more complex compiler that must allocate registers. Lua's register design is a major reason for its speed.

## Question 6

**Why do real interpreters store local variables in an array instead of a hash map?**

Because the compiler knows all the locals of a function up front, it assigns each an integer **slot** at compile time. A variable read becomes `LOAD_LOCAL slot` → `locals[slot]`, a single array index — no string hashing, no map probe. The tree-walker's `env["x"]` hashed the string and probed a map on *every* access. Moving name resolution from runtime to compile time is one of the highest-leverage tricks in interpreter design. This is exactly why, in CPython, locals (`LOAD_FAST`, an array index) are faster than globals (`LOAD_GLOBAL`, a dict lookup).

## Question 7

**How is control flow implemented in a bytecode VM?**

With **jumps** that set the instruction pointer. An `if` compiles to a conditional jump (`JUMP_IF_FALSE`) that skips the untaken branch; a `while` is a backward `JUMP` around a condition test. Because forward jump targets are unknown when the jump is emitted, the compiler writes a placeholder and **backpatches** the target once it is reached. There is no tree, so the host's `if`/`while` no longer apply — the VM manipulates the IP directly.

## Question 8

**What is the dispatch problem, and why does a `switch` loop mispredict?**

Dispatch is the per-instruction overhead of selecting and jumping to the handler for the current opcode. A `switch`-based loop has *one* indirect-branch site that jumps to ~100 different targets depending on the opcode. The CPU's branch-target predictor keeps history per branch *site*; with one site and a chaotic target sequence, it mispredicts constantly, and each misprediction flushes the pipeline (tens of cycles). On dispatch-bound interpreters, this misprediction cost dominates — often more than the actual computation.

## Question 9

**How does threaded code / computed goto fix dispatch?**

Threaded code gives *each opcode handler its own dispatch site* instead of routing everyone back through one central switch. With GCC/Clang computed goto (`&&label` to take a label's address, `goto *table[op]` to jump), each handler ends by jumping directly to the next handler. Now there are ~100 branch sites, one per opcode, and the predictor can learn per-site patterns — and bytecode is full of correlations (a compare is usually followed by a conditional jump). Mispredictions drop sharply; typical gains are 15–50% on dispatch-bound code. CPython exposes this as `USE_COMPUTED_GOTOS`.

## Question 10

**Name the members of the threaded-code family.**

**Direct/token threading** (computed goto: bytecode holds tokens, a table maps token→handler address, `goto *`), **indirect threading** (bytecode holds pointers into a pointer table — one extra indirection), and **subroutine threading** (each opcode is a real `call` to a handler subroutine, exploiting the CPU's accurate return-address predictor; this blurs toward a JIT). The term originates in Forth implementations.

## Question 11

**What are superinstructions and stack caching?**

A **superinstruction** fuses a common opcode sequence (e.g. `LOAD_FAST; LOAD_FAST; BINARY_ADD`) into one opcode, paying the dispatch cost once instead of three times — discovered by profiling hot sequences. **Stack caching** keeps the top one or two operand-stack entries in CPU registers instead of memory, so back-to-back instructions hand off through a register rather than a memory store+load — a meaningful win because stack VMs touch the top-of-stack constantly.

## Question 12

**What is an inline cache and why does it matter for dynamic languages?**

Dynamic languages do expensive lookups ("which method is `x.foo`?", "where is property `name` on this object?"). At a given call site, the answer is usually the same shape repeatedly. An **inline cache** memoizes the resolution at the call site: do the slow lookup once, remember (shape → slot/method), and on subsequent hits skip the lookup. Monomorphic sites (one shape) are fastest; polymorphic sites keep a few; megamorphic sites fall back to the slow path. Inline caches plus hidden classes are the foundation of fast dynamic dispatch (V8) and of CPython's adaptive specialization.

## Question 13

**How are closures implemented? What is an upvalue?**

A closure is a function plus the variables it captured from enclosing scopes. The simple representation is an **environment chain** — each scope links to its parent, and lookups walk outward (correct but slow). Lua's **upvalue** mechanism is the production answer: a captured local is referenced through an upvalue object. While the enclosing function still runs, the upvalue is "open" and points directly at the live stack slot (so the closure and the parent share the variable). When that function returns, the upvalue is "closed" — the value is copied into the upvalue object so the closure keeps working after the frame is gone.

## Question 14

**How does an interpreter implement exceptions?**

The guest exception must unwind the *interpreter's* call stack. Two common designs: a **handler stack** (push try/catch handlers as you enter them; on throw, pop frames until a matching handler is found, restoring the operand stack height and IP), or **exception tables** (per-function metadata mapping IP ranges to handler offsets — the JVM's approach — so the normal path pays nothing and only the throw path consults the table). Critically, unwinding must restore the operand stack, not just the IP, and run any `finally`/cleanup along the way.

## Question 15

**What is tail-call optimization in an interpreter, and why does it matter?**

A call in tail position (the function's last action) does not need its current frame anymore. **Proper tail calls** reuse the current frame — overwrite the arguments and jump to the callee's start without pushing a new frame — so tail-recursive guest code runs in constant stack space. Without TCO, deep guest recursion overflows the *host* interpreter's stack. Scheme mandates proper tail calls; Lua provides them. Some languages (Python) deliberately omit TCO, partly to keep stack traces intact.

## Question 16

**Describe the interpreter-to-JIT path.**

Interpreting starts fast and runs slow; native compilation is the reverse. Tiered execution gets both: start interpreting, attach an execution counter to each function/loop, and when it crosses a threshold, JIT-compile it to native code; future runs use the compiled version. The interpreter is *not* discarded — it runs cold code, serves as the baseline, and is the **deopt** target when the JIT's speculative assumptions (drawn from inline-cache feedback) prove wrong. **OSR** (on-stack replacement) lets a long-running loop switch to JITed code mid-execution.

---

## Implementation-Specific

## Question 17

**(CPython) Walk through what happens when CPython runs `x = a + b`.**

The source is compiled to bytecode (viewable with `dis`): roughly `LOAD_FAST a; LOAD_FAST b; BINARY_OP +; STORE_FAST x`. `LOAD_FAST` pushes a local from the frame's *array* (not a dict). The eval loop in `ceval.c` (`_PyEval_EvalFrameDefault`) dispatches each opcode via a `switch` or computed goto. Since 3.11, `BINARY_OP` is **adaptively specialized**: after seeing ints repeatedly, the site quickens to `BINARY_OP_ADD_INT` with an embedded inline cache, de-specializing if a non-int appears. The whole thing runs under the **GIL**, so only one thread executes bytecode at a time.

## Question 18

**(CPython) Why does the GIL exist, and what does PEP 703 change?**

The GIL exists primarily because CPython uses **reference counting**: every `PyObject` has a refcount mutated on essentially every access, and making those mutations thread-safe individually would be prohibitively expensive. The GIL serializes bytecode execution so refcounts and internal interpreter state stay consistent without per-object locking. The cost: CPU-bound Python cannot use multiple cores. **PEP 703** (free-threaded build, experimental in 3.13) removes the GIL using biased reference counting and fine-grained locking, enabling true parallelism — but it puts new thread-safety burdens on C extensions that assumed a single GIL.

## Question 19

**(CPython) What is the adaptive specializing interpreter (PEP 659)?**

Introduced in Python 3.11, it rewrites generic opcodes into type-specialized ones at runtime. `BINARY_OP`, `LOAD_ATTR`, `CALL`, etc. start generic; once a site's observed types stabilize, the interpreter "quickens" the opcode in place to a specialized form (e.g. `LOAD_ATTR_INSTANCE_VALUE`) with an inline-cache slot embedded in the bytecode, skipping the slow general path. If the assumption is later violated, the opcode de-specializes back to generic. It is the classic superinstruction + inline cache idea, automated — and a big part of the 3.11+ speedups.

## Question 20

**(Ruby) What changed when Ruby went from 1.8 to 1.9?**

Ruby 1.8 was a **tree-walking** interpreter (slow); Ruby 1.9 replaced it with **YARV** (Yet Another Ruby VM), a **stack-based bytecode** virtual machine. This is the `junior.md → middle.md` transition happening in a mainstream language, and it produced a large measured speedup for the same reasons: flat cache-friendly code, integer dispatch, and pre-resolved variable access instead of re-walking the AST. MRI still has a **GVL** (its GIL-equivalent). More recently, **YJIT** (a basic-block-versioning JIT from Shopify) compiles hot YARV bytecode to native code, keeping the interpreter as baseline.

## Question 21

**(Lua) Why is Lua's interpreter so fast?**

A confluence of careful choices: a **register-based VM** (`a = b + c` is one instruction, not four), a compact instruction encoding, **tagged/NaN-boxed values** so numbers and immediates fit in one word with no heap allocation, **upvalues** for efficient closures, an incremental GC tuned to avoid long pauses, and — crucially — an exceptionally **small core that stays resident in the CPU cache**. Lua proves how fast a *plain interpreter* (no JIT) can be when value representation, dispatch, and code size are all optimized together. LuaJIT then adds trace compilation on top.

## Question 22

**(JS engines) How does V8 Ignition fit with TurboFan, and what is deopt?**

**Ignition** is V8's register-based bytecode **interpreter** — the baseline. It starts fast, uses little memory, and collects **type feedback** in per-function *feedback vectors*. Hot functions are promoted to the optimizing JITs (**Maglev**, then **TurboFan**), which *speculate* using that feedback (e.g. "this property is always at offset 3," "this is always a Smi"). When a speculation is violated at runtime, V8 **deoptimizes**: it throws away the optimized code and resumes execution in Ignition at the exact equivalent bytecode state. Inline caches and **hidden classes (maps)** make dynamic property access fast. This is the canonical "baseline interpreter + accelerator + deopt escape hatch" architecture.

## Question 23

**(JS engines) What are hidden classes / maps and why do they exist?**

JavaScript objects are dynamic bags of properties; a naive implementation looks up each property by hashing its name. Hidden classes (V8 calls them maps; the idea comes from Self's maps) give objects with the same *shape* (same properties in the same order) a shared descriptor that records each property's fixed offset. A property access then checks the object's hidden class (cheap pointer compare via an inline cache) and reads a known offset — turning a hash lookup into a memory load. Adding properties in inconsistent orders creates many hidden classes and degrades to the slow path, which is why "monomorphic" code is faster.

## Question 24

**(BEAM) How is the BEAM different from CPython or V8?**

The BEAM (Erlang/Elixir) is a **register-based** bytecode VM optimized for **massive concurrency and fault tolerance**, not single-thread throughput. It runs millions of lightweight **processes**, each with its *own* small heap, so there is no shared-memory GIL problem and GC is **per-process and low-pause** (collecting one process never stops the others). Scheduling is **preemptive via reduction counting**: each process runs a budget of reductions (roughly function calls) before the scheduler switches, giving soft-real-time fairness without OS threads per process. It demonstrates that interpreter design includes the *concurrency and scheduling architecture*, not just the dispatch loop.

## Question 25

**(General) How do tagged pointers and NaN-boxing represent values in one word?**

**Tagged pointers**: heap pointers are aligned, so their low bits are zero and can encode a tag distinguishing "pointer" from "immediate small int" (V8's Smi, OCaml's tagged ints). Small ints, `nil`, booleans live inline — no allocation. **NaN-boxing**: IEEE-754 doubles have a huge space of NaN bit-patterns; you store pointers and integers *inside* those unused NaN payloads, so a 64-bit word is either a real double or (encoded in a NaN) a pointer/int/immediate (LuaJIT, JavaScriptCore, SpiderMonkey). Both eliminate heap allocation for the common values, which is one of the largest single performance levers an interpreter has.

---

## Tricky / Trap Questions

## Question 26

**A candidate says "I'll just compute operator precedence in `eval` so `2 + 3 * 4` works." What's wrong?**

Precedence is the *parser's* job — it is baked into the *shape* of the AST. By the time `eval` runs, the tree already encodes that `*` binds tighter than `+`; the evaluator just walks what it is given. If `2 + 3 * 4` evaluates to `20`, the *parser* built the wrong tree, and "fixing" precedence in `eval` would be patching the wrong layer. A candidate who reaches into the evaluator for precedence does not understand the parse/evaluate separation.

## Question 27

**"CPython's GIL makes my multithreaded code thread-safe." True or false?**

False, in two ways. First, the GIL serializes *bytecode*, but `x += 1` is several bytecodes; a thread switch between them still loses updates — compound operations are not atomic, so you still need locks. Second, the GIL provides no *parallelism* for CPU-bound work — it actively prevents threads from running Python on multiple cores. The GIL guarantees internal interpreter consistency (refcounts), not the correctness or performance of your concurrent Python logic.

## Question 28

**"Bytecode is always faster than tree-walking." Is it?**

Not always *net* faster. Bytecode adds a compile phase; for a program that runs once and briefly, the compile cost can exceed the interpretation savings. And a naive bytecode VM with a slow value representation (heap-allocating every int) can lose to a tree-walker that happens to avoid allocation. The general claim "bytecode beats tree-walking on hot, repeated execution" is true; the universal "always faster" is wrong. As always: measure on the real workload.

## Question 29

**"Computed goto is just a portable micro-optimization." Push back.**

Computed goto (`&&label`) is a **GCC/Clang extension** — it is *not* standard C and is unavailable on MSVC. It also interacts poorly with some sanitizers/coverage tools, and it makes the eval loop harder to debug. So it is portable across GCC/Clang but not across all toolchains, which is why real VMs (CPython) keep a `switch` fallback compilable behind a feature macro. And it is not "micro" — it can buy 15–50% on dispatch-bound interpreters by fixing branch misprediction.

## Question 30

**An inline cache "works" in tests but production returns wrong method resolutions. What's the bug class?**

A missing or incorrect **cache invalidation**. An inline cache memoizes (shape → method/slot); if the object's shape, the class hierarchy, or a monkey-patched method changes and the cache is not invalidated, the site keeps returning the stale, now-wrong resolution. This is a *correctness* bug, not a performance one, and it is silent — it passes any test that does not mutate shapes after the cache fills. Inline caches must be designed with invalidation from day one and tested against shape transitions.

## Question 31

**"Locals are faster than globals in Python because globals are slower to type." Correct the reasoning.**

The typing has nothing to do with it. Locals are faster because they are resolved to integer **array slots** at compile time and accessed via `LOAD_FAST` (`frame->localsplus[i]` — an array index). Globals are accessed via `LOAD_GLOBAL`, which does a **dictionary lookup** (hash the name, probe the module's globals dict, possibly fall through to builtins). One is an array index; the other is a hash-map lookup. The performance gap is name-resolution-at-compile-time vs name-resolution-at-runtime.

## Question 32

**A guest function recurses 10 million times and crashes with a stack overflow, but the same logic written as a loop is fine. Why, and what would fix it?**

The recursion grows the *host* interpreter's call stack one frame per guest call; 10 million frames overflow it. The loop reuses one frame. The fix is **proper tail-call optimization**: if the recursive call is in tail position, the interpreter reuses the current frame instead of pushing a new one, running the recursion in constant stack space (as Scheme and Lua do). If the call is *not* in tail position, TCO cannot help and the algorithm itself must be made iterative or the stack deepened.

## Question 33

**"My deopt-capable JIT is faster, so I can delete the interpreter." Why is that wrong?**

You cannot. The interpreter is the **correctness reference** and the **deopt landing zone**: when the JIT's speculation fails (a Smi turns into a float, a property's shape changes), the engine must abandon the optimized code and resume in the interpreter at the exact bytecode state. Without the interpreter, there is nowhere to bail to. It also handles cold code that is not worth compiling. The interpreter and JIT are partners, not stages you discard.

## Question 34

**A program's bytecode runs correctly under `switch` dispatch but crashes under computed goto. Likely cause?**

A hole in the **dispatch table**: an opcode without a corresponding label entry (uninitialized table slot) makes `goto *table[op]` jump to garbage. With `switch`, a missing case at worst hits `default`; with computed goto, it jumps to whatever happened to be in the slot. The fix is to *generate* the dispatch table from the opcode list so every opcode has an entry, and to assert coverage at startup.

## Question 35

**"NaN-boxing is free real estate — use it everywhere." What breaks this?**

NaN-boxing assumes a **tracing GC** (so values can be scanned uniformly) and makes platform assumptions about pointer width and canonical NaN payloads. A refcounting-everything VM like classic CPython cannot benefit as directly because its values are full heap objects with refcounts. NaN-boxing also adds bit-twiddling complexity to every opcode and can collide with hardware that produces unexpected NaN bit-patterns. It is a powerful technique, not a universal one — its constraints couple to your GC and target platforms.

---

## System / Design Scenarios

## Question 36

**Design the architecture for a new embeddable scripting language. What do you choose and why?**

Start with the *requirements*: embeddability and small footprint suggest a Lua-like design — a compact **register-based bytecode VM**, **tagged or NaN-boxed values** (no heap allocation for numbers), **upvalues** for closures, and an **incremental GC** to avoid pausing the host. Build a **tree-walker first** to nail semantics and serve as a test oracle, then the bytecode compiler + VM. Use a `switch` dispatch initially (portable, debuggable) and add computed goto behind a feature macro once profiling shows dispatch dominates. Defer a JIT until there is evidence of hot numeric workloads. Design line tables and frame introspection in from the start so the language is debuggable.

## Question 37

**You profiled your bytecode VM and the eval loop is the bottleneck. What's your optimization order?**

Confirm dispatch (not GC or a slow built-in) is the actual cost. Then, roughly in order of effort/payoff: (1) switch to **computed-goto threading** for branch-prediction wins; (2) fix **value representation** if you are heap-allocating numbers — tagged/NaN-boxing often dwarfs dispatch gains; (3) add **stack caching** for top-of-stack; (4) profile opcode bigrams and add **superinstructions** for the hottest sequences; (5) add **inline caches** for dynamic lookups; (6) only then consider a **JIT** for hot code. Re-measure after each step — the biggest win is frequently value representation, not dispatch tricks.

## Question 38

**Design a REPL for your interpreted language. What's subtle?**

A REPL is `read → parse → eval → print` in a loop with the **environment kept alive** between lines, so `x = 5` is visible to later lines. Subtleties: distinguishing a complete input from a partial one (continue reading on an open brace/paren); printing expression results but not statement results; preserving and surfacing errors without killing the session; and deciding whether each line is its own compilation unit (which complicates slot allocation for locals) or shares a persistent top-level frame. Good REPLs also keep history, support multi-line editing, and offer introspection (`dir`, completion) by reading the live environment.

## Question 39

**A team must speed up an existing tree-walking interpreter without a multi-year rewrite. What are the incremental options?**

In increasing effort: (1) **cache parse results** so re-runs skip lexing/parsing; (2) replace **string-keyed environments with slot arrays** by adding a resolution pass that assigns locals to indices — a large win for cheap effort; (3) memoize hot subexpressions or constant-fold; (4) compile the AST to a simple **bytecode** and run a switch loop (the real fix, but bigger); (5) consider **meta-tracing (RPython)** or **partial evaluation (Truffle)** to *derive* a JIT from the existing interpreter rather than hand-writing one. The slot-array change and the move to bytecode usually give the best return per unit of effort.

## Question 40

**Design how your interpreter cooperates with a garbage collector.**

Use a uniform tagged `Value` word so every frame/stack slot is trivially scannable. Insert **safepoints** — typically a poll near the top of the dispatch loop (the "eval breaker") — so GC only runs when the operand stack and frames are in a consistent state, never mid-instruction with a raw pointer exposed. For a precise collector, maintain **root/stack maps** so the GC knows which slots hold references. For a generational or concurrent collector, run a **write barrier** on every pointer-storing opcode so cross-generation references are tracked. If instead you choose **reference counting** (CPython-style), accept the implied GIL (or build a free-threading scheme) and add a cycle collector for reference cycles.

## Question 41

**When would you choose meta-tracing or partial evaluation over hand-writing a JIT?**

When you want JIT-level performance but cannot afford to build and maintain a bespoke optimizing backend. **Meta-tracing (PyPy/RPython)**: you write the interpreter in RPython and get a tracing JIT derived from it automatically — best when you control the interpreter and want one language fast. **Partial evaluation (Truffle/GraalVM)**: you write a self-optimizing AST interpreter and Graal specializes it into native code — best when you want *many* languages on one high-performance framework (TruffleRuby, GraalPy, JS, R). You hand-write a JIT only when you need maximal control, a specific target, or the derived approaches' warmup/footprint is unacceptable.

## Question 42

**Design low-overhead profiling for a production interpreter.**

Avoid in-loop trace hooks (CPython's `settrace`/`setprofile`) — they fire on every line/call and can slow the interpreter several-fold. Instead use an **out-of-process sampling profiler** (py-spy, Austin model) that periodically reads the target's frame objects via its memory, reconstructing stacks from the line tables without instrumenting the dispatch loop. This adds near-zero overhead to the running process. For richer data, add cheap, samplable counters (per-opcode or per-function execution counts) that a JIT-style tier would already maintain, and surface them through a side channel rather than the hot path.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                 INTERPRETERS — INTERVIEW MUST-KNOW               │
├──────────────────────────────────────────────────────────────────┤
│ SPECTRUM (build-fast -> run-fast):                                │
│   tree-walk  ->  bytecode VM  ->  + threaded dispatch  ->  + IC   │
│             ->  + JIT (tiered, deopt)                            │
├──────────────────────────────────────────────────────────────────┤
│ TREE-WALK: recursive eval(node, env); slow (dispatch + ptr-chase) │
│ BYTECODE : compile once -> fetch-decode-execute loop; flat, fast  │
│ STACK VM (CPython,JVM,YARV) vs REGISTER VM (Lua,BEAM,Dalvik)      │
│ LOCALS = ARRAY SLOT (LOAD_FAST), not a dict  -> name resolved     │
│          at compile time. Globals = dict lookup (slower).         │
├──────────────────────────────────────────────────────────────────┤
│ DISPATCH: switch = 1 branch site -> mispredicts heavily.          │
│   computed goto (&&label) = 1 site/opcode -> predictable, +15-50% │
│   superinstructions (fuse) | stack caching (TOS in reg)          │
│   inline caches (memoize lookup per site; mono/poly/mega)        │
├──────────────────────────────────────────────────────────────────┤
│ closures = env chain OR upvalues (Lua: open/closed)               │
│ exceptions = handler stack OR exception table (JVM)               │
│ tail calls = reuse frame -> constant-space recursion (Scheme/Lua) │
├──────────────────────────────────────────────────────────────────┤
│ REAL VMs:                                                         │
│   CPython: stack VM, GIL (refcount!), adaptive specialize PEP659  │
│   Lua: register VM, NaN-box, tiny+fast                            │
│   V8 Ignition + TurboFan/Maglev, feedback, hidden classes, deopt  │
│   Ruby: 1.8 tree-walk -> 1.9 YARV; GVL; YJIT                      │
│   BEAM: register VM, per-process heaps, reduction scheduling      │
├──────────────────────────────────────────────────────────────────┤
│ VALUE REP = biggest perf lever: tagged ptr / NaN-box -> no alloc  │
│ DERIVE A JIT: meta-tracing (PyPy) | partial eval (GraalVM/Truffle)│
└──────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Tree-walker and bytecode VM (closures, NaN-boxing, GC) in full. https://craftinginterpreters.com/
- *The Structure and Performance of Efficient Interpreters* — Ertl & Gregg. The definitive dispatch/threading study.
- *The Implementation of Lua 5.0* — Ierusalimschy et al. Register VM, tagged values, upvalues. https://www.lua.org/doc/jucs05.pdf
- CPython: `Python/ceval.c`, the `dis` module, PEP 659 (adaptive interpreter), PEP 703 (free-threading), PEP 744 (JIT).
- V8 blog: Ignition, TurboFan, Maglev, deoptimization, and hidden classes.
- *Ruby Under a Microscope* — Pat Shaughnessy (YARV); Shopify's YJIT papers.
- *The BEAM Book* — the Erlang VM's process and scheduling model.
- *Smalltalk-80* (the "Blue Book") — the origin of bytecode VMs and inline caches.
- *Tracing the Meta-Level: PyPy's Tracing JIT* (Bolz et al.) and *Practical Partial Evaluation...* (Würthinger et al., Truffle/Graal).
- *Writing An Interpreter In Go* / *Writing A Compiler In Go* — Thorsten Ball. Hands-on tree-walker then bytecode VM.
