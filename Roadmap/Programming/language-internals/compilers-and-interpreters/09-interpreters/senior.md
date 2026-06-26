# Interpreters — Senior Level

> **Topic:** [Interpreters](README.md)
> **Focus:** The dispatch loop is where interpreter performance lives or dies. Switch vs threaded code vs computed goto, superinstructions, stack caching, inline caching, closures/upvalues, exceptions, tail calls — and the road to a JIT.

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
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [What You Can Build](#what-you-can-build)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **Once you have a bytecode VM, where does the time actually go — and what techniques shave it away?**

A bytecode interpreter (from `middle.md`) spends most of its time not doing arithmetic but doing **dispatch**: the per-instruction overhead of fetching the next opcode, decoding it, and branching to the code that handles it. For real workloads, dispatch can dominate — the actual `a + b` is one cheap machine instruction, but getting *to* that instruction (the loop branch, the `switch` jump, the branch misprediction) can cost several. Reduce dispatch overhead and the whole interpreter speeds up across the board.

This page is about the **interpreter loop as a performance artifact**. We will compare the standard **switch dispatch** (portable, but the loop's single indirect branch is mispredicted constantly), against **threaded code** techniques — **direct/token threading** using GCC's computed-goto (`&&label`) extension, **indirect threading**, and **subroutine threading** — that replace the centralized switch with one indirect jump *per opcode handler*, giving the CPU's branch predictor a separate history per opcode and routinely buying 20–50% on dispatch-bound interpreters. We will then cover the higher-level speedups that production VMs layer on: **superinstructions** (fusing common opcode sequences into one), **stack caching** (keeping the top-of-stack in a register), and **inline caching at the interpreter level** (memoizing the result of a slow lookup at the call site).

We will also handle the semantics a serious interpreter must implement well: **closures and upvalues** (capturing variables across scopes, with environment chains and the upvalue mechanism Lua pioneered), **exceptions** (unwinding the interpreter's own stack), and **tail calls** (turning recursion into iteration so deep recursion does not blow the host stack). Finally, the **interpreter-to-JIT path**: start interpreting, count how hot each function gets, and compile the hot ones — the architecture behind V8's Ignition + TurboFan, the JVM's interpreter + C1/C2, and PyPy.

> 🎓 **Why this matters for a senior:** This is the knowledge that lets you read and reason about real VMs — CPython's computed-goto eval loop, Lua's register VM, V8 Ignition, YARV, the BEAM — and make principled performance decisions instead of cargo-culting. It is also the foundation for understanding why "just interpret it" and "JIT it" are points on a spectrum, not a binary.

---

## Prerequisites

What you should know before reading this:

- **Required:** The bytecode VM architecture from `middle.md`: compile-to-bytecode, the fetch–decode–execute loop, stack vs register VMs, locals-as-slots.
- **Required:** A working mental model of CPU branch prediction and the cost of an indirect/mispredicted branch.
- **Required:** Comfort reading C, including function pointers and (ideally) GCC's labels-as-values extension.
- **Helpful but not required:** Exposure to closures in a language you use (JavaScript, Python, Lua, Scheme).
- **Helpful but not required:** Having profiled an interpreter and seen the eval loop dominate the flame graph.

You do **not** need to know:

- How to write a full optimizing JIT backend (that is runtime-systems territory; we cover the *path* to a JIT, not its codegen).
- Garbage collection internals (we reference GC integration as prose).
- Meta-tracing or partial evaluation in depth (introduced here, deepened in `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Dispatch** | The per-instruction work of selecting and jumping to the handler for the current opcode. |
| **Switch dispatch** | Dispatch via a `switch` on the opcode inside the loop. Portable; one heavily-mispredicted indirect branch. |
| **Threaded code** | A family of dispatch techniques where each opcode handler jumps directly to the next, avoiding a central loop. |
| **Direct threading / token threading** | Computed-goto dispatch: each handler ends with `goto *dispatch_table[next_opcode]`. Needs GCC's `&&label`. |
| **Indirect threading** | Bytecode holds indices; a table maps them to handler addresses. One extra indirection vs direct threading. |
| **Subroutine threading** | Each opcode is a real `call` to a handler subroutine; relies on the CPU's return-address predictor. |
| **Computed goto** | GCC/Clang extension: take a label's address (`&&label`) and `goto *ptr` to it. The basis of direct threading. |
| **Branch misprediction** | The CPU guessed the wrong target for an indirect branch and must flush the pipeline — the main cost a `switch` loop pays. |
| **Superinstruction** | A single opcode that fuses a common sequence (e.g. `LOAD_CONST` + `ADD`) to cut dispatch count. |
| **Stack caching** | Keeping the top one or two operand-stack entries in CPU registers instead of memory. |
| **Inline cache (IC)** | A per-call-site memo of a previously-resolved lookup (method, property, type) to skip the slow path next time. |
| **Closure** | A function value that captures variables from its enclosing scope. |
| **Upvalue** | A captured variable referenced by a closure; Lua's mechanism for sharing a local with an inner function. |
| **Environment chain** | A linked list of scopes searched outward for a variable; the slow-but-general closure representation. |
| **Tail call** | A call in tail position (the last action of a function); can reuse the current frame instead of growing the stack. |
| **TCO / proper tail calls** | Tail-Call Optimization: executing tail calls in constant stack space. |
| **Hot code** | Code executed often enough to be worth compiling; identified by counters or sampling. |
| **JIT** | Just-In-Time compiler: compiles bytecode (or traces) to native code at runtime. |
| **Meta-tracing** | Generating a JIT from an interpreter by tracing the interpreter's execution (PyPy/RPython). |

---

## Core Concepts

### 1. Where the time goes: the dispatch cost

In a tight bytecode loop, the operations are cheap; the *getting between them* is not. Each iteration of a `switch`-based loop does: read `code[ip]`, range-check (in some languages), compute the jump table entry, take an **indirect branch** to the handler, run the (often 1–3 instruction) handler, then branch back to the top of the loop. The two indirect branches — into the handler and back to the loop top — are the problem.

The killer is **branch misprediction**. A `switch` loop has *one* indirect branch site that jumps to ~100 different targets depending on the opcode. The CPU's branch-target predictor keeps a small history per branch *site*; with one site and a chaotic sequence of targets, it mispredicts constantly. Each misprediction flushes the pipeline — tens of cycles wasted. On dispatch-bound interpreters this is the single largest cost.

### 2. Threaded code: give each opcode its own branch

The fix is structural: instead of one central `switch` that everyone returns to, let **each opcode handler dispatch to the next one directly**. Now the indirect branch lives at the *end of each handler*, so there are ~100 branch sites, one per opcode. The predictor can learn per-site patterns — and bytecode has lots of them (a comparison is usually followed by a conditional jump; a load is often followed by an add). Correlated sequences become predictable, and mispredictions drop sharply.

This family is called **threaded code**. The most common variant uses **computed goto**.

### 3. Direct threading with computed goto (`&&label`)

GCC and Clang support *labels as values*: `&&label` yields a `void*` to that label, and `goto *ptr` jumps to it. With a dispatch table of handler addresses, you write:

```c
static void* table[] = { &&op_const, &&op_add, &&op_load, /* ... */ };

#define DISPATCH() goto *table[code[ip++]]

DISPATCH();              // start
op_const:  push(constants[code[ip++]]); DISPATCH();
op_add:    { Value b = pop(), a = pop(); push(a + b); } DISPATCH();
op_load:   push(locals[code[ip++]]);    DISPATCH();
// ...
```

There is **no central loop**. Each handler ends by jumping straight to the next handler. This is exactly the technique CPython enables with `USE_COMPUTED_GOTOS` in `ceval.c` — and it is why CPython's eval loop is written the way it is. Typical gains are 15–50% on dispatch-bound code, depending on architecture and workload.

### 4. The threaded-code family: direct, indirect, subroutine

- **Direct/token threading** (above): bytecode holds tokens (small ints); a table maps token → handler address; `goto *` jumps. Fastest portable software dispatch.
- **Indirect threading**: bytecode holds pointers into a table of pointers to handlers — one more indirection, historically used when you cannot take label addresses. Slightly slower, more flexible.
- **Subroutine threading**: each opcode compiles to a real `call handler` instruction. The win is the CPU's dedicated **return-address stack predictor**, which is very accurate. This blurs into "compiling bytecode to a list of calls" — a stepping stone toward a JIT.

A historical note: the term "threaded code" comes from Forth implementations, long before today's bytecode VMs; the ideas are old and battle-tested.

### 5. Superinstructions: fuse common sequences

Profiling real bytecode reveals that certain opcode *pairs* and *triples* dominate. `LOAD_FAST` followed by `LOAD_FAST` followed by `BINARY_ADD` is everywhere. A **superinstruction** is a single new opcode that does the work of a whole common sequence, paying the dispatch cost **once** instead of three times.

```text
  LOAD_FAST a; LOAD_FAST b; ADD     ->     ADD_LOCALS a, b
```

You discover hot sequences by profiling, then either hand-write superinstructions or generate them. This trades a larger opcode set (and a bigger dispatch table) for fewer dispatches. CPython's "adaptive specializing interpreter" (PEP 659, Python 3.11+) is a modern, automatic descendant of this idea: it rewrites generic opcodes into specialized ones at runtime based on observed types.

### 6. Stack caching: keep the top-of-stack in a register

In a stack-based VM, almost every instruction touches the **top of the operand stack** — and the stack lives in memory. **Stack caching** keeps the top one (or two) stack entries in CPU registers, so back-to-back instructions hand off through a register instead of a memory store + load. An `ADD` that takes `b` from the cached TOS register avoids a memory round-trip entirely. Implementations track which "stack state" they are in (0, 1, or 2 items cached) and specialize handlers per state. This is a meaningful win precisely because stack VMs touch TOS constantly.

### 7. Inline caching at the interpreter level

Dynamic languages do expensive lookups: "what method does `x.foo()` resolve to?", "where is property `name` on this object?". The answer usually does not change at a given call site — the same site sees the same object *shape* over and over. An **inline cache** memoizes the resolution *at the call site*: the first time, do the slow lookup and remember (shape → slot/method); next time, check the cached shape and, on a hit, skip the lookup. This is foundational to fast dynamic-language interpreters and to V8's hidden classes; at the interpreter level it lives in the bytecode (or a side table keyed by instruction). A *monomorphic* site (one shape) is fastest; *polymorphic* (a few shapes) keeps a small set; *megamorphic* falls back to the slow path.

### 8. Closures and upvalues: capturing variables across scopes

A **closure** is a function plus the variables it captured from enclosing scopes. The simple representation is an **environment chain**: each scope is a record with a pointer to its parent, and a variable lookup walks outward until found. Correct, but a runtime hash/linked-list walk — slow, the very thing `middle.md` worked to eliminate for locals.

Lua's **upvalue** mechanism is the elegant production answer. A captured local is referenced through an *upvalue* object. While the enclosing function is still running, the upvalue points directly at the live stack slot (an "open" upvalue). When that function returns, the value is "closed" — copied into the upvalue object so the closure keeps working after the stack frame is gone. This gives closures correct sharing semantics without a general environment-chain walk on every access. Understanding open/closed upvalues is a hallmark of someone who has actually implemented closures.

### 9. Exceptions: unwinding the interpreter's stack

The guest language's exceptions must unwind the *interpreter's* model of the call stack, not (only) the host's. Two common designs: (a) a **handler stack** — push try/catch handlers as you enter them; on throw, pop frames until you find a matching handler, restoring the operand stack and IP; or (b) **exception tables** — per-function metadata mapping IP ranges to handler offsets (the JVM's approach), so the normal path pays nothing and the throw path consults the table. The throw must correctly unwind operand stacks and run any `finally`/cleanup along the way. Getting stack restoration exactly right (operand stack height, locals, IP) is a classic source of subtle bugs.

### 10. Tail calls: recursion without stack growth

A call in **tail position** — the function's last action is to return the result of another call — does not need the current frame anymore. A **proper tail call** reuses the current frame: overwrite the arguments, jump to the callee's start, do *not* grow the stack. This turns tail-recursive guest code into iteration, so deep recursion runs in constant stack space (Scheme requires this; Lua provides it). Without TCO, deep guest recursion overflows the *host* stack — a real limitation of naive interpreters. Detecting tail position is a compile-time analysis; performing TCO is a special `TAIL_CALL` opcode (or a check in `CALL`) that reuses rather than pushes a frame.

### 11. The interpreter-to-JIT path

Interpreting is fast to start and slow to run; native compilation is the reverse. Production systems get both by **starting interpreted and JIT-compiling hot code**. Each function (or loop) carries a counter; when it crosses a threshold, a compiler turns its bytecode into native code, and future calls run the compiled version. This is **tiered execution**: V8 runs **Ignition** (bytecode interpreter) then **TurboFan** (optimizing JIT); the JVM runs an interpreter then **C1** then **C2**; CPython 3.13+ ships an experimental JIT atop its adaptive interpreter. The interpreter is not thrown away — it handles cold code, provides a baseline, and serves as the **deopt** target when the JIT's speculative assumptions (from inline caches) turn out wrong. The codegen details belong to runtime-systems; the *architecture* — interpret first, profile, compile the hot parts, deopt on surprise — is the senior interpreter-implementer's mental model.

### 12. Meta-tracing and partial evaluation (a gentle introduction)

Two research-grade ideas, now in production, let you get a JIT *without hand-writing one*:

- **Meta-tracing (PyPy/RPython):** you write an *interpreter* in RPython; the meta-tracing JIT observes the interpreter executing a hot guest loop and records the *trace of interpreter operations*, then compiles that trace. You get a JIT for your language essentially for free, derived from your interpreter.
- **Partial evaluation / Futamura projections (Truffle/GraalVM):** an AST interpreter, specialized against a specific program by a partial evaluator, *becomes* a compiler for that program — the first Futamura projection. Truffle does this: write a self-optimizing AST interpreter, and Graal partially-evaluates it into optimized native code.

Both turn the slogan "an interpreter plus a clever compiler equals a compiler" into engineering reality. We go deeper in `professional.md`; here the point is that your interpreter can be the *source* of a JIT, not merely a fallback for one.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Switch dispatch** | One central dispatcher who, after every task, calls you back to the desk for the next assignment — a bottleneck, and they keep guessing your next job wrong. |
| **Threaded code** | Each station knows directly which station comes next and hands the work straight over — no trip back to the dispatcher. |
| **Branch misprediction** | Pre-cooking the dish you guessed the customer wants; when they order something else, you throw it out and start over. |
| **Superinstruction** | A combo meal button: one press instead of ringing up burger, fries, and drink separately. |
| **Stack caching** | Keeping the tool you use constantly in your hand instead of putting it back in the drawer after every use. |
| **Inline cache** | A regular at a coffee shop: the barista remembers "the usual" and skips re-asking the whole order. |
| **Upvalue (open/closed)** | A shared scratchpad: while you are both at the desk you write on the same sheet; when one leaves, they take a photocopy so it still works. |
| **Exception unwinding** | Evacuating floors one by one until you reach a floor with a working exit (the matching handler). |
| **Tail call** | Passing a baton and leaving the track entirely, instead of running alongside the next runner. |
| **Interpreter→JIT** | A new hire follows the manual step-by-step (interpret); once a task is clearly routine, they memorize a fast shortcut (compile). |

---

## Mental Models

### The "Dispatch is the Tax" Model

Treat every instruction as: a small useful payload (the actual `ADD`) plus a *dispatch tax* (getting there and back). Tree-walking pays an enormous tax (type dispatch + pointer chase). Switch bytecode pays a moderate one (a mispredicted indirect branch). Threaded code pays less (predictable per-opcode branches). Superinstructions pay the tax *fewer times*. Stack caching reduces the payload's memory traffic. A JIT, ultimately, *eliminates* the tax by emitting straight-line native code. Every technique on this page is a different way to lower the same tax.

### The "Predictability is Performance" Model

The CPU is a prediction engine. A `switch` loop hides bytecode's natural sequence-correlations behind one branch site the predictor cannot untangle. Threaded code *exposes* those correlations to the predictor by giving each opcode its own branch. Inline caches exploit the predictability of call-site shapes. JITs exploit the predictability of types observed at runtime. The recurring senior insight: **interpreters are slow mostly because they defeat the CPU's predictors; the fast techniques are the ones that restore predictability.**

### The "Spectrum, Not a Switch" Model

There is no clean line between "interpreter" and "compiler." Subroutine threading is bytecode-as-a-list-of-calls. A template JIT is subroutine threading with the calls inlined. An optimizing JIT specializes further. Meta-tracing and partial evaluation *derive* a compiler from an interpreter. Hold the whole thing as one continuum of "how much do we pre-resolve and specialize, and when?" — and you will place any real system (CPython, V8, JVM, Lua, PyPy, GraalVM) on it correctly.

---

## Code Examples

### Switch dispatch vs computed-goto (direct threading) in C

The two loops below run identical bytecode. The first is portable; the second uses GCC's computed goto and is typically meaningfully faster on dispatch-bound code.

```c
// ---- Switch dispatch (portable) ----
Value run_switch(uint8_t *code, Value *constants, Value *locals) {
    Value stack[256]; int sp = 0; size_t ip = 0;
    for (;;) {
        uint8_t op = code[ip++];
        switch (op) {                                   // ONE indirect branch site
            case CONST: stack[sp++] = constants[code[ip++]]; break;
            case ADD:   { Value b = stack[--sp], a = stack[--sp];
                          stack[sp++] = a + b; } break;
            case LOAD:  stack[sp++] = locals[code[ip++]]; break;
            case STORE: locals[code[ip++]] = stack[--sp]; break;
            case JMPF:  { size_t t = code[ip++];
                          if (!stack[--sp]) ip = t; } break;
            case HALT:  return stack[--sp];
        }
        // loop back to the top -> the predictor must guess `op` again
    }
}
```

```c
// ---- Direct threading (computed goto, GCC/Clang) ----
Value run_threaded(uint8_t *code, Value *constants, Value *locals) {
    static void *table[] = {
        [CONST]=&&op_const, [ADD]=&&op_add, [LOAD]=&&op_load,
        [STORE]=&&op_store, [JMPF]=&&op_jmpf, [HALT]=&&op_halt,
    };
    Value stack[256]; int sp = 0; size_t ip = 0;
    #define DISPATCH() goto *table[code[ip++]]          // branch site PER handler
    DISPATCH();
op_const:  stack[sp++] = constants[code[ip++]];                  DISPATCH();
op_add:    { Value b = stack[--sp], a = stack[--sp];
             stack[sp++] = a + b; }                              DISPATCH();
op_load:   stack[sp++] = locals[code[ip++]];                    DISPATCH();
op_store:  locals[code[ip++]] = stack[--sp];                    DISPATCH();
op_jmpf:   { size_t t = code[ip++]; if (!stack[--sp]) ip = t; } DISPATCH();
op_halt:   return stack[--sp];
    #undef DISPATCH
}
```

The only structural change is *where the indirect branch lives*: one shared site (switch) vs one per opcode (threaded). That single change is what gives the branch predictor a fighting chance, and is exactly the option CPython exposes via `USE_COMPUTED_GOTOS`.

### A superinstruction

Profiling shows `LOAD a; LOAD b; ADD` dominates. Add a fused opcode:

```c
op_add_locals:  // operands: two slot indices
    { uint8_t a = code[ip++], b = code[ip++];
      stack[sp++] = locals[a] + locals[b]; }           DISPATCH();
```

The compiler emits `ADD_LOCALS a, b` wherever it sees that triple. Three dispatches collapse into one; the arithmetic is identical.

### Closures via upvalues (sketch)

```c
typedef struct Upvalue {
    Value *location;   // points into the live stack while "open"...
    Value  closed;     // ...or holds the captured value once "closed"
    struct Upvalue *next;
} Upvalue;

typedef struct Closure {
    Function *fn;
    Upvalue **upvalues;   // captured variables
    int upvalue_count;
} Closure;

// When the enclosing frame returns, close upvalues that point above the new top:
void close_upvalues(VM *vm, Value *last) {
    while (vm->open_upvalues && vm->open_upvalues->location >= last) {
        Upvalue *uv = vm->open_upvalues;
        uv->closed = *uv->location;   // copy the live value out of the dying frame
        uv->location = &uv->closed;   // redirect to the closure's own storage
        vm->open_upvalues = uv->next;
    }
}
```

Open upvalues alias the live stack slot (so the closure and the still-running parent share the same variable); closing copies the value so the closure outlives the frame. This is the Lua design Nystrom adapts in *Crafting Interpreters*.

### Tail-call handling

```c
op_tail_call:  // reuse the current frame instead of pushing a new one
    {
        Closure *callee = AS_CLOSURE(peek(arg_count));
        // overwrite current frame's slots with the new arguments, then:
        frame->closure = callee;
        frame->ip = callee->fn->code;     // jump to callee start, no stack growth
        // (slots/operand-stack adjusted to the new function's layout)
    }
    DISPATCH();
```

Because no frame is pushed, a guest function that tail-calls itself a million times uses *one* host frame, not a million. This is what makes Scheme-style loops-as-recursion run in constant space.

### Interpreter-to-JIT trigger (pseudocode)

```c
void call_function(VM *vm, Function *fn) {
    fn->call_count++;
    if (fn->jit_code) {
        run_native(fn->jit_code, vm);          // hot: run compiled code
    } else if (fn->call_count > JIT_THRESHOLD) {
        fn->jit_code = jit_compile(fn);        // crossed the line: compile it
        run_native(fn->jit_code, vm);
    } else {
        run_bytecode(vm, fn);                  // cold: interpret
    }
}
```

This counter-and-threshold is the skeleton of tiered execution in V8, the JVM, and PyPy — interpret until hot, then compile.

---

## Pros & Cons

| Technique | Pros | Cons |
|-----------|------|------|
| **Switch dispatch** | Portable, simple, debuggable; works in any language. | One mispredicted indirect branch dominates dispatch-bound loops. |
| **Computed goto / direct threading** | 15–50% faster dispatch; per-opcode branch prediction. | GCC/Clang only (not standard C/MSVC); larger function; harder to read. |
| **Subroutine threading** | Uses the accurate return-address predictor; a bridge to JIT. | More call overhead per op; stepping stone, not an endpoint. |
| **Superinstructions** | Fewer dispatches for hot sequences; big wins on common patterns. | Larger opcode set and dispatch table; must be profiled/maintained. |
| **Stack caching** | Cuts TOS memory traffic on every instruction in a stack VM. | Per-stack-state handler specialization; code-size and complexity cost. |
| **Inline caching** | Turns megamorphic lookups into near-direct accesses; essential for dynamic langs. | Adds per-site state, invalidation logic, deopt complexity. |
| **Closures via upvalues** | Correct, fast closure semantics without env-chain walks. | Open/close bookkeeping is subtle; easy to get lifetime bugs. |
| **Proper tail calls** | Constant-space recursion; enables functional idioms. | Complicates stack traces and debugging; some languages refuse it deliberately. |
| **Interpreter→JIT** | Best of both: fast startup + native peak speed. | Large engineering cost; deopt, OSR, and tiering are hard to get right. |

---

## Use Cases

These techniques are warranted when:

- **You ship a production interpreter and have profiled the eval loop as the bottleneck.** Computed goto, superinstructions, and stack caching pay off only when dispatch actually dominates — measure first.
- **You implement a dynamic language with method/property lookup on the hot path.** Inline caching is not optional for competitive performance.
- **Your language has first-class functions/closures.** Upvalues (or an equivalent) are required for correct, fast capture semantics.
- **Your language encourages recursion (functional style).** Proper tail calls prevent stack overflow and make the style viable.
- **You need both fast startup and high peak throughput.** The interpreter-to-JIT architecture is the standard answer for browsers, the JVM, and large-scale dynamic-language runtimes.

They are **overkill** when:

- The interpreter is a prototype, a config evaluator, or runs briefly — a clean switch-based VM (or even a tree-walker) is the right amount of engineering.
- Portability across compilers/platforms outweighs the last 20–40% of dispatch speed (computed goto ties you to GCC/Clang).
- You are early in the language's life — semantics and correctness should stabilize before you optimize dispatch.

---

## Coding Patterns

### Pattern 1: Macro-driven `DISPATCH()`

Hide the dispatch mechanism behind a `DISPATCH()` macro so you can switch between `switch` and computed-goto builds with one `#ifdef`. CPython does exactly this, supporting both portable and computed-goto builds from one source.

### Pattern 2: Profile, then fuse

Add instrumentation that counts opcode *bigrams/trigrams* at runtime. Pick the hottest sequences and introduce superinstructions for them. Re-profile to confirm the win and to find the next candidates.

### Pattern 3: TOS-in-register with stack-state specialization

Maintain the top-of-stack in a local variable the compiler will keep in a register; specialize handlers for the "0 cached / 1 cached" states. Even caching just the single top entry captures most of the benefit with manageable complexity.

### Pattern 4: Inline-cache slots in the bytecode

Reserve operand space (or a parallel array) at each lookup site to store the cached shape and resolved slot/method. On execution: compare shape; hit → fast path; miss → slow path + refill. Make invalidation explicit when shapes change.

### Pattern 5: Open/closed upvalue list per VM

Keep a linked list of open upvalues sorted by stack address. On every frame return, close the upvalues above the returning frame's base. Centralizing this keeps closure lifetime logic in one auditable place.

### Pattern 6: Counter-and-threshold tiering

Attach an execution counter to each function and loop. Cross a threshold → promote (compile). Keep the interpreter as the cold-path executor and the deopt target. Keep the promotion logic out of the steady-state hot path.

---

## Best Practices

- **Profile before optimizing dispatch.** Confirm the eval loop is the bottleneck (not GC, not allocation, not a slow built-in) before reaching for computed goto or superinstructions.
- **Keep the switch build working alongside the threaded build.** The portable `switch` version is your correctness oracle and your fallback on compilers without computed goto.
- **Make handlers uniform and short.** Predictable, small handlers help both the branch predictor and the instruction cache; they also make superinstruction fusion mechanical.
- **Centralize stack-effect accounting.** Every opcode's push/pop count must be exact; encode it in one table and assert it in debug builds. Stack drift is the dominant VM bug.
- **Design inline caches with invalidation from day one.** A cache without a correct invalidation story is a correctness bug waiting to happen when object shapes change.
- **Get upvalue lifetimes right before optimizing closures.** A closure that reads a freed stack slot is a use-after-free; prove correctness, then make it fast.
- **Treat the JIT as an accelerator of correct interpreter semantics.** The interpreter defines behavior; the JIT must match it bit-for-bit, including deopt. Differential-test JIT vs interpreter relentlessly.
- **Mind portability costs.** Computed goto, label addresses, and tail-call assumptions are compiler-specific. Document the requirements; gate them behind feature macros.

---

## Edge Cases & Pitfalls

- **Computed goto is non-standard.** MSVC lacks `&&label`; some sanitizers and coverage tools interact poorly with it. Always keep the `switch` fallback compilable.
- **The dispatch table must cover every opcode.** A hole (uninitialized table slot) jumps to garbage. Generate the table from the opcode list to keep them in sync.
- **Superinstructions multiply the opcode space.** Too many fused opcodes bloat the i-cache and the table, eroding the gain. Fuse only genuinely hot sequences.
- **Stack caching breaks naive debuggers and stack walkers.** The "real" TOS lives in a register, not memory; any tool reading the operand stack must account for the cached entry.
- **Inline cache invalidation bugs are silent.** A stale cache returns a wrong method/slot after a shape change — a correctness disaster that passes most tests. Invalidate aggressively; test shape transitions.
- **Upvalue closing order matters.** Close upvalues for *all* slots at or above the returning frame; missing one leaves a closure aliasing a dead slot. Off-by-one here is a use-after-free.
- **Tail-call optimization erases stack frames.** Great for space, painful for debugging — the call that "should" be in the backtrace is gone. Some languages (Python) refuse TCO partly for this reason.
- **Exception unwinding must restore the operand stack, not just the IP.** Jumping to a handler with a mis-sized operand stack corrupts subsequent execution. Record stack height per handler.
- **Deopt must be exact.** When a JITed function's speculation fails, control must resume in the interpreter at the precise bytecode state (locals, operand stack, IP). Any mismatch is a heisenbug.
- **`finally`/cleanup during unwinding.** Cleanup blocks must run on the throw path and can themselves throw — re-entrant unwinding is easy to get wrong.

---

## Test Yourself

1. Explain *why* a `switch`-based dispatch loop mispredicts so often, and *why* computed-goto threading reduces mispredictions. Reference the number of branch sites in each.
2. CPython's `ceval.c` can be built with `USE_COMPUTED_GOTOS`. What does that flag change structurally, and on what kinds of workloads would you expect the biggest win?
3. You profile your VM and find `LOAD_FAST; LOAD_FAST; COMPARE; POP_JUMP_IF_FALSE` is the hottest 4-gram. Design a superinstruction for it. How many dispatches do you save per occurrence?
4. Describe the difference between an *open* and a *closed* upvalue. What event triggers closing, and what bug occurs if you forget to close one?
5. Walk through how a guest-language exception unwinds the interpreter's stack. What state, besides the instruction pointer, must be restored at the handler?
6. A guest function tail-calls itself 10 million times. Without TCO, what happens? With proper tail calls, what happens, and why?
7. Why is an inline cache that lacks invalidation a *correctness* bug, not just a performance one? Give a concrete scenario with a changing object shape.
8. Sketch the counter-and-threshold logic that promotes a hot function from interpretation to JIT compilation. Why is the interpreter still needed after the JIT exists (name two reasons)?
9. In one sentence each, distinguish meta-tracing (PyPy) from partial evaluation (Truffle/GraalVM) as ways to obtain a JIT from an interpreter.
10. Stack caching keeps TOS in a register. Name one performance benefit and one tooling/debugging hazard it introduces.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│              INTERPRETER PERFORMANCE: DISPATCH & BEYOND           │
├──────────────────────────────────────────────────────────────────┤
│ DISPATCH = per-instruction tax of getting to the handler.         │
│   switch        : 1 indirect branch site -> heavy misprediction   │
│   threaded code : 1 branch site PER opcode -> predictable         │
│      direct/token : goto *table[op]  (GCC &&label, computed goto)  │
│      indirect     : extra pointer indirection                     │
│      subroutine   : call per op (uses return predictor; ~> JIT)   │
├──────────────────────────────────────────────────────────────────┤
│ HIGHER-LEVEL WINS:                                                │
│   superinstructions : fuse hot opcode sequences (1 dispatch)      │
│   stack caching     : keep top-of-stack in a register             │
│   inline caching    : memoize lookup per call site (mono/poly/    │
│                       mega); V8 hidden classes, CPython PEP 659    │
├──────────────────────────────────────────────────────────────────┤
│ SEMANTICS A REAL VM NEEDS:                                        │
│   closures   : env chain (simple) OR upvalues (Lua: open/closed)  │
│   exceptions : handler stack OR exception tables (JVM); unwind    │
│                operand stack + IP; run finally                    │
│   tail calls : reuse frame -> constant-space recursion (Scheme)   │
├──────────────────────────────────────────────────────────────────┤
│ INTERPRETER -> JIT (tiered): interpret cold, count, compile hot.  │
│   V8: Ignition + TurboFan | JVM: interp + C1/C2 | PyPy: meta-trace│
│   interpreter stays as baseline + DEOPT target for failed specs   │
│   derive-a-JIT: meta-tracing (PyPy) / partial eval (GraalVM)      │
├──────────────────────────────────────────────────────────────────┤
│ RULE: profile first. Most of these pay off only when the eval     │
│       loop is provably the bottleneck.                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- In a bytecode VM, **dispatch overhead** — getting to and from each opcode handler — often dominates runtime. The biggest cost is **branch misprediction** at the `switch` loop's single indirect branch.
- **Threaded code** spreads dispatch across one branch *per opcode*, restoring branch predictability. **Direct/token threading** via GCC's **computed goto** (`&&label`, `goto *table[op]`) is the standard fast technique — the same option CPython exposes as `USE_COMPUTED_GOTOS`. **Indirect** and **subroutine threading** are relatives; subroutine threading bridges toward a JIT.
- **Superinstructions** fuse hot opcode sequences to cut dispatch count; **stack caching** keeps the top-of-stack in a register; **inline caching** memoizes expensive lookups per call site (the basis of fast dynamic dispatch and V8's hidden classes; CPython 3.11+ specializes adaptively).
- A serious interpreter must also implement **closures** (environment chains, or Lua-style **open/closed upvalues**), **exceptions** (handler stacks or exception tables that unwind the operand stack and IP), and **tail calls** (frame reuse for constant-space recursion).
- The **interpreter-to-JIT path** is tiered execution: interpret cold code, count executions, compile hot code, and keep the interpreter as the baseline and the **deopt** target. V8 (Ignition+TurboFan), the JVM (interp+C1/C2), and PyPy all work this way.
- **Meta-tracing** (PyPy/RPython) and **partial evaluation / Futamura projections** (Truffle/GraalVM) *derive* a JIT from an interpreter — your interpreter can be the source of a compiler, not just a fallback for one.
- The senior throughline: **interpreters are slow mainly because they defeat the CPU's predictors; the fast techniques restore predictability — and "interpreter vs compiler" is a spectrum, not a binary.** Profile before optimizing.

---

## What You Can Build

- **A dual-build VM** with a `DISPATCH()` macro that compiles to either `switch` or computed-goto, plus a benchmark proving the dispatch speedup on your hardware.
- **An opcode-bigram profiler** that finds your hottest sequences, then a few **superinstructions** to fuse them — measure the win.
- **A stack-caching variant** of your VM that keeps TOS in a register, with handlers specialized per stack state.
- **A closures implementation with open/closed upvalues**, then a test that captures a loop variable and proves correct sharing after the enclosing function returns.
- **A proper-tail-call demo:** a guest program that tail-recurses 10 million times and runs in constant host stack space.
- **A toy inline cache** for a property/method lookup, with shape-based hits and explicit invalidation on shape change — then break it deliberately to see the silent-correctness failure mode.
- **A tiering harness:** add per-function counters and a stubbed "compile" step (even just specializing the bytecode) that fires past a threshold, to feel the interpret-then-promote architecture.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Chapters on the VM, closures/upvalues, and optimization build much of this page in C. https://craftinginterpreters.com/
- *The Structure and Performance of Efficient Interpreters* — M. Anton Ertl & David Gregg. The definitive measurement study of threaded code, superinstructions, and dispatch on real CPUs.
- *The Behavior of Efficient Virtual Machine Interpreters on Modern Architectures* — Ertl & Gregg. Why branch prediction makes threading win.
- *Stack Caching for Interpreters* — M. Anton Ertl. The original treatment of keeping TOS in registers.
- *The Implementation of Lua 5.0* — Ierusalimschy et al. Register VM and the upvalue design. https://www.lua.org/doc/jucs05.pdf
- *An Efficient Implementation of SELF* — Chambers, Ungar, Lee. The origin of inline caches and maps/hidden classes (the basis of V8's design).
- *Tracing the Meta-Level: PyPy's Tracing JIT Compiler* — Bolz, Cuni, Fijałkowski, Rigo. Meta-tracing explained.
- *One VM to Rule Them All* — Würthinger et al. (Truffle/GraalVM); partial evaluation of AST interpreters into native code.
- *Partial Evaluation and Automatic Program Generation* — Jones, Gomard, Sestoft. The Futamura projections, rigorously. (Free online.)
- CPython internals: PEP 659 ("Specializing Adaptive Interpreter") and `Python/ceval.c`.
