# Interpreters — Tasks & Exercises

> **Topic:** [Interpreters](README.md)
> **Focus:** Build a real language by executing it: a tree-walking interpreter first, then a bytecode VM — plus the dispatch, closure, and specialization techniques that make it fast.

---

## Table of Contents

1. [How to Use These Tasks](#how-to-use-these-tasks)
2. [Warm-Up Exercises](#warm-up-exercises)
3. [Core Exercises — Tree-Walking](#core-exercises--tree-walking)
4. [Core Exercises — Bytecode](#core-exercises--bytecode)
5. [Advanced Exercises — Dispatch & Performance](#advanced-exercises--dispatch--performance)
6. [Advanced Exercises — Real Semantics](#advanced-exercises--real-semantics)
7. [Capstone Project](#capstone-project)
8. [Reading-Real-VMs Exercises](#reading-real-vms-exercises)
9. [Self-Assessment Checklist](#self-assessment-checklist)
10. [Hints](#hints)
11. [Sparse Solutions](#sparse-solutions)

---

## How to Use These Tasks

Work top to bottom — the tasks build a single language, twice: first as a tree-walker, then as a bytecode VM, so you feel the difference in your own code. Each task has a **goal**, a concrete **self-check** you can run to know you succeeded, and most have a **hint** (see [Hints](#hints)) and a **sparse solution** (see [Sparse Solutions](#sparse-solutions)) — *try the task before reading either*.

Pick one host language and stick with it (Python, JavaScript, Go, or C all work; C is best for the performance tasks because computed goto and value representation are visible there). You may use a parser library or hand-write a tiny parser; the focus is **execution**, not parsing. Where a task needs an AST and you have no parser, hand-build the AST as data — that is a legitimate way to isolate the evaluator.

The **capstone** is the point of the whole page: implement the same language as a tree-walker *and* a bytecode VM, prove they agree on a test suite, and measure the speedup.

---

## Warm-Up Exercises

### Task 1: Evaluate an arithmetic AST by hand

**Goal:** Internalize post-order evaluation before writing any code.

On paper, draw the AST for `2 + 3 * 4 - 10 / 2` (respecting precedence), then trace `eval` over it, writing the value returned at every node, bottom-up.

**Self-check:** Your final answer is `9`. The `*` node returns `12`, the `/` node returns `5`, the `+` returns `14`, and the `-` returns `9`. If you got `20`-ish, you built the tree with the wrong precedence — the bug is in the *tree shape*, not in evaluation.

---

### Task 2: Classify nodes as expression or statement

**Goal:** Cement the expression/statement distinction.

For each, label it `expr` or `stmt`: `x + 1`, `x = 5`, `print(x)`, `f(2, 3)`, `if c { ... }`, `x`, `while c { ... }`, `-y`.

**Self-check:** Expressions (produce a value): `x + 1`, `f(2,3)`, `x`, `-y`. Statements (perform an action): `x = 5`, `print(x)`, `if`, `while`. (`x = 5` is a statement in most languages; in some it is an expression too — note which your target language chooses.)

---

### Task 3: Predict tree-walk vs bytecode overhead

**Goal:** Reason about *why* one is slow before measuring.

For evaluating `x` (a single local read) one million times, list every operation a tree-walker performs per read, then every operation a bytecode VM with slot-based locals performs per read.

**Self-check:** Tree-walker: dispatch on node type → it's a `Var` → hash the string `"x"` → probe the environment map → return. Bytecode VM: fetch `LOAD_FAST` → `locals[slot]` (one array index) → push. The string hash and map probe disappear; that's the core of the speedup.

---

## Core Exercises — Tree-Walking

### Task 4: Build a calculator tree-walker

**Goal:** Write `eval(node, env)` for numbers, `+ - * /`, and parentheses (parentheses are handled by tree shape, so no special node needed).

**Self-check:** `eval` of the AST for `(2 + 3) * 4` returns `20`; `eval` of `2 + 3 * 4` returns `14`. Division by zero raises a clear error, not a crash.

> Hint: [H1](#h1). Sparse solution: [S1](#s1).

---

### Task 5: Add variables and assignment

**Goal:** Add a `Var` node (reads from the environment) and an `Assign` node (writes to it). Thread the environment through `eval` as a parameter — no globals.

**Self-check:** Running `x = 2 + 3; y = x * 4; print(y)` prints `20`. Reading an undefined variable `z` raises a clear `undefined variable 'z'` error rather than returning null/None.

> Hint: [H2](#h2).

---

### Task 6: Add control flow (`if`, `while`)

**Goal:** Add `If` and `While` nodes. Implement them using your *host* language's own `if`/`while` inside `eval`. Define a single `truthy()` helper.

**Self-check:** This guest program prints `0 1 2 3 4` (one per line):
```
i = 0
while i < 5 { print(i); i = i + 1 }
```
The `if` only executes the taken branch — verify by putting a `print` with a side effect in each branch and confirming only one fires.

> Hint: [H3](#h3). Sparse solution: [S2](#s2).

---

### Task 7: Add functions and a call stack

**Goal:** Add function definitions and calls. On a call, create a *new* environment for the callee's locals/parameters; on return, discard it. Implement recursion (e.g. factorial).

**Self-check:** `factorial(5)` returns `120`. A function's local variable does not leak into the caller's scope. Mutual recursion (`isEven`/`isOdd`) works.

> Hint: [H4](#h4).

---

### Task 8: Build a REPL

**Goal:** Wrap your interpreter in a Read–Eval–Print Loop that keeps the environment alive across lines.

**Self-check:** Typing `x = 10` then on the next line `print(x + 5)` prints `15`. An error on one line (e.g. `1/0`) prints a message but does *not* kill the session — the next line still works.

> Hint: [H5](#h5).

---

## Core Exercises — Bytecode

### Task 9: Design your opcode set

**Goal:** Before coding, write down the opcodes for a stack-based VM covering everything from Tasks 4–6: `CONST`, `LOAD_LOCAL`, `STORE_LOCAL`, `ADD/SUB/MUL/DIV`, comparisons, `PRINT`, `JUMP`, `JUMP_IF_FALSE`, `HALT`. Note which carry an operand.

**Self-check:** Every opcode has a documented stack effect (how many it pops, how many it pushes). `ADD` pops 2 pushes 1; `CONST i` pops 0 pushes 1 and has operand `i`; `JUMP_IF_FALSE t` pops 1 pushes 0 and has operand `t`.

---

### Task 10: Write the bytecode compiler

**Goal:** Compile your AST to bytecode. Resolve each local to an integer **slot** at compile time; build a deduplicated **constant pool**; emit expressions in post-order.

**Self-check:** Compiling `x = 2 + 3 * 4` emits (in order) `CONST(2); CONST(3); CONST(4); MUL; ADD; STORE_LOCAL(0)`. The constant pool has `[2,3,4]` (or `[2,3,4]` deduped if values repeat) and `x` maps to slot `0`.

> Hint: [H6](#h6). Sparse solution: [S3](#s3).

---

### Task 11: Write the VM (fetch–decode–execute loop)

**Goal:** Implement the `switch`-based loop with an operand stack, a locals array, and an instruction pointer. Run the bytecode from Task 10.

**Self-check:** Running compiled `x = 2 + 3 * 4; print(x)` prints `14`. At `HALT`, the operand stack is empty (no leaked values). Feeding bytecode for `(2+3)*(4+5)` prints `45`.

> Hint: [H7](#h7). Sparse solution: [S4](#s4).

---

### Task 12: Compile control flow with backpatching

**Goal:** Compile `if` and `while` to `JUMP`/`JUMP_IF_FALSE`. Emit forward jumps with placeholder targets and **backpatch** them once the target is known.

**Self-check:** The `while i < 5` loop from Task 6, compiled and run on the VM, prints `0 1 2 3 4`. Disassembling it shows a backward `JUMP` to the condition and a forward `JUMP_IF_FALSE` patched to the instruction after the loop.

> Hint: [H8](#h8).

---

### Task 13: Write a disassembler

**Goal:** Print bytecode in readable form: offset, opcode name, operand, and (for jumps) the absolute target.

**Self-check:** Disassembling `print(2 * 3 + 4)` yields a readable listing ending in `PRINT` then `HALT`, with each instruction at the correct byte offset (operands advance the offset). You can trace the VM purely from this listing.

> Hint: [H9](#h9).

---

## Advanced Exercises — Dispatch & Performance

### Task 14: Switch vs computed-goto dispatch (C)

**Goal:** Implement the VM loop two ways — a portable `switch` and a computed-goto (`&&label`, GCC/Clang) version behind an `#ifdef` — sharing the same bytecode.

**Self-check:** Both produce identical output on your test suite. On a dispatch-heavy benchmark (a tight arithmetic loop running ~100M opcodes), the computed-goto build is measurably faster (commonly 15–40%). If it isn't, your benchmark is likely bound by something other than dispatch (allocation, I/O) — find out what.

> Hint: [H10](#h10). Sparse solution: [S5](#s5).

---

### Task 15: Add superinstructions

**Goal:** Instrument the VM to count opcode *bigrams* (adjacent pairs) at runtime on a representative program. Add a superinstruction for the hottest pair (e.g. `LOAD_LOCAL; LOAD_LOCAL` → `LOAD2`, or `LOAD_LOCAL; ADD`). Have the compiler emit it.

**Self-check:** The fused program produces identical results and executes *fewer* dispatches (count them). On a loop dominated by that pair, you observe a speedup. Re-profiling reveals the next-hottest bigram.

> Hint: [H11](#h11).

---

### Task 16: Stack caching (top-of-stack in a register)

**Goal:** Keep the top operand-stack entry in a local variable (which the compiler keeps in a register) rather than always in the stack array. Specialize the relevant handlers.

**Self-check:** Output is unchanged. On an arithmetic-heavy benchmark you measure fewer memory accesses (or a speedup). A correctness test with deep expressions still passes — verify your "0 cached" vs "1 cached" state transitions are right.

> Hint: [H12](#h12).

---

### Task 17: Benchmark tree-walker vs bytecode

**Goal:** Run the *same* program (a loop summing 1..N for large N) through your tree-walker and your bytecode VM. Chart runtime as N grows.

**Self-check:** The bytecode VM is dramatically faster (often an order of magnitude) and the gap *widens* with N. You can articulate the two main reasons (no per-node type dispatch/pointer-chasing; slot-based locals instead of hashed lookups).

---

## Advanced Exercises — Real Semantics

### Task 18: Implement closures with upvalues

**Goal:** Add first-class functions that capture enclosing variables. Implement **upvalues** with open/closed semantics: an open upvalue points at the live stack slot; on the enclosing function's return, close it (copy the value into the upvalue object).

**Self-check:** A counter factory works:
```
makeCounter() { c = 0; return fn() { c = c + 1; return c } }
counter = makeCounter()
print(counter())  // 1
print(counter())  // 2
```
Two separate counters do not share state. The captured `c` survives after `makeCounter` returns (proving the upvalue was closed correctly).

> Hint: [H13](#h13). Sparse solution: [S6](#s6).

---

### Task 19: Implement exceptions

**Goal:** Add `try`/`catch`/`throw`. On `throw`, unwind the interpreter's frames until a matching handler is found, restoring the operand stack height and IP. Run `finally`/cleanup on the way out.

**Self-check:** A `throw` inside a nested function is caught by an outer `try`. The operand stack is not corrupted after catching (a subsequent expression evaluates correctly). A `finally` block runs whether or not an exception occurred.

> Hint: [H14](#h14).

---

### Task 20: Implement proper tail calls

**Goal:** Detect tail position at compile time and emit a `TAIL_CALL` that *reuses* the current frame instead of pushing a new one.

**Self-check:** A tail-recursive countdown from 10,000,000 to 0 runs in constant host-stack space (no stack overflow). The same function written *without* tail position (e.g. `return 1 + recurse(...)`) *does* overflow — confirming TCO only applies to true tail calls.

> Hint: [H15](#h15).

---

### Task 21: Add an inline cache for a lookup

**Goal:** Give your language objects with named fields. At each field-access site, cache (shape → slot). On a hit, skip the lookup; on a miss, do the slow lookup and refill. Implement **invalidation** when an object's shape changes.

**Self-check:** Repeated access to the same field on same-shaped objects hits the cache. Accessing a differently-shaped object misses and refills correctly. Crucially: after mutating an object's shape, a stale cache does *not* return the wrong slot — write a test that would fail if you skipped invalidation.

> Hint: [H16](#h16).

---

### Task 22: Add a JIT trigger (stub)

**Goal:** Attach an execution counter to each function. Past a threshold, call a `compile(fn)` step. The "compile" can be a stub that merely specializes the bytecode (e.g. swaps generic `ADD` for `ADD_INT` when the function only does int math) — the point is the *tiering architecture*, not real codegen.

**Self-check:** A cold function runs interpreted; after crossing the threshold, subsequent calls run the specialized path and produce identical results. You can explain why the interpreter must remain as the deopt target if the specialization's assumption (ints only) is later violated.

> Hint: [H17](#h17).

---

## Capstone Project

### Task 23: One language, two interpreters — tree-walker then bytecode VM

**Goal:** Implement a small but real language **twice** and prove they agree.

**The language** (call it whatever you like) must support: integers and booleans; `+ - * /` and comparisons; variables and assignment; `if`/`else`; `while`; first-class functions with parameters, return, recursion, and **closures**; `print`; and clear runtime errors (undefined variable, division by zero, type errors).

**Build it in stages:**
1. **Tree-walker.** Parse (or hand-build AST) → `eval(node, env)` with environments, function frames, and closures. This is your *reference semantics*.
2. **Bytecode VM.** A compiler (AST → bytecode, slot-based locals, constant pool, backpatched jumps) and a fetch–decode–execute VM (operand stack, frames, upvalues for closures).
3. **A shared test suite.** A set of guest programs with expected outputs (FizzBuzz, factorial, a closure counter, a recursive Fibonacci, an error case).
4. **A differential test.** Run every program through *both* interpreters and assert identical output (and identical errors). This is the heart of the capstone: the bytecode VM must match the tree-walker bit-for-bit.
5. **A benchmark.** Run a heavy loop through both; report the speedup.

**Self-check (acceptance criteria):**
- Every program in the suite produces identical output under both interpreters.
- FizzBuzz, factorial, recursive Fibonacci, and a closure counter all work in *your* language.
- The closure counter proves correct capture (two counters are independent; the captured variable survives the enclosing function's return).
- Error cases (undefined variable, divide by zero) produce equivalent, clear errors in both.
- The bytecode VM is measurably faster than the tree-walker on the benchmark, and you can explain *why* in terms of dispatch and locals representation.
- A disassembler can print any function's bytecode readably.

**Stretch goals:** add computed-goto dispatch (Task 14); add proper tail calls (Task 20); add an inline cache (Task 21); add a JIT trigger stub (Task 22); add a REPL (Task 8) over the bytecode VM.

> Hint: [H18](#h18). Sparse solution: [S7](#s7).

---

## Reading-Real-VMs Exercises

### Task 24: Read CPython bytecode for real

**Goal:** Use Python's built-in tools to see this page's concepts in the language you use daily.

```python
import dis
def hot(n):
    total = 0
    for i in range(n):
        total = total + i
    return total
dis.dis(hot)
```

**Self-check:** You can identify: `LOAD_FAST`/`STORE_FAST` (locals as array slots), the loop's `FOR_ITER` and its jump target, and the `BINARY_OP` that 3.11+ specializes. Compare `LOAD_FAST` (a local) with `LOAD_GLOBAL` (introduce a global and re-disassemble) and explain why the local is faster.

---

### Task 25: Compare stack vs register encoding

**Goal:** For `a = b + c`, write the stack-based bytecode (your VM) and the register-based bytecode (Lua-style `ADD A B C`). Count instructions and dispatches for each.

**Self-check:** Stack: four instructions (`LOAD b; LOAD c; ADD; STORE a`), four dispatches. Register: one instruction (`ADD a, b, c`), one dispatch. You can explain why Lua's register design reduces dispatch and push/pop traffic — and the compiler cost it adds.

---

### Task 26: Trace a deopt

**Goal:** In your Task 22 specialized VM (or conceptually for V8/CPython), construct a case where a specialized `ADD_INT` opcode meets a non-int operand. Trace what must happen.

**Self-check:** You can describe: the guard check fails → the site de-specializes (revert to generic `ADD`) → execution resumes correctly at the same logical point. You can explain why this requires the exact interpreter state to be reconstructable, and why a JIT needs the same mechanism (deopt) but at native-code granularity.

---

## Self-Assessment Checklist

You understand interpreters at a senior+ level when you can:

- [ ] Write `eval(node, env)` for a small language from memory, including `if`/`while`/functions/closures.
- [ ] Explain the two concrete reasons tree-walking is slow (per-node dispatch + pointer-chasing) and why bytecode fixes them.
- [ ] Compile an AST to stack bytecode by hand, including backpatched jumps.
- [ ] Implement the fetch–decode–execute loop and keep the operand-stack effect of every opcode exact.
- [ ] Explain why locals are an array slot and globals are a dict lookup, and tie it to CPython's `LOAD_FAST`/`LOAD_GLOBAL`.
- [ ] Explain why `switch` dispatch mispredicts and how computed-goto threading fixes it (in terms of branch sites).
- [ ] Describe superinstructions, stack caching, and inline caching, and when each pays off.
- [ ] Implement closures with open/closed upvalues and prove correct capture after the enclosing frame returns.
- [ ] Explain exception unwinding (handler stack vs exception table) and proper tail calls (frame reuse).
- [ ] Place CPython, Lua, V8, Ruby, and the BEAM on the interpreter spectrum and explain each one's key design choice.
- [ ] Explain value representation (tagged/NaN-boxing) as the biggest single performance lever, and how it couples to the GC.
- [ ] Sketch the interpreter-to-JIT tiering architecture, including why the interpreter remains as the deopt target.
- [ ] **Build the capstone: one language as both a tree-walker and a bytecode VM, differentially tested to agree.**

---

## Hints

### H1
Use one `eval` function that dispatches on node type. For `BinOp`, evaluate `left` and `right` *first* (recursively), then apply the operator. Parentheses need no node — the parser already nested the tree correctly.

### H2
Pass `env` (a dict/map) as a parameter to every `eval` call. `Var` does `env[name]` with a presence check; `Assign` does `env[name] = eval(expr, env)`. Never read or write a module-level global for this.

### H3
`If`: `if truthy(eval(cond, env)): exec(then) else: exec(else)`. `While`: a host `while` loop around `exec(body)`. Put truthiness in one `truthy(v)` helper so `if` and `while` agree on what "true" means.

### H4
A call creates a fresh environment for the callee, binds parameters into it, evaluates the body, and returns. For lexical scope/closures later, the callee's environment should link to the function's *defining* environment, not the caller's. Use a host exception or a sentinel to implement `return` (it unwinds to the call site).

### H5
Loop: read a line, parse it, `eval` it with a persistent `env`, print the result if it's an expression. Wrap the `eval` in a try/except so an error prints a message and `continue`s instead of crashing the loop.

### H6
Maintain `self.slots` (name → int) and `self.constants` (deduped list). `compile_expr(BinOp)` recurses into children then emits the op opcode (post-order). `compile_stmt(Assign)` compiles the expression then emits `STORE_LOCAL slot`.

### H7
The loop: `op = code[ip]; ip += 1; switch(op)`. For opcodes with an operand, read `code[ip]` then `ip += 1`. `ADD`: `b = pop(); a = pop(); push(a + b)`. End on `HALT`. Assert the stack is empty (or has exactly the expected result) at `HALT` during testing.

### H8
Emit `JUMP_IF_FALSE` with a placeholder operand (e.g. `0`), record the operand's index, compile the branch/body, then overwrite the placeholder with the current code length. For `while`, also emit a backward `JUMP` to the saved loop-start offset.

### H9
Keep a name table (`opcode → "NAME"`) and a set of opcodes that have operands. Walk the code: if the op has an operand, print `offset NAME operand` and advance by 2; else print `offset NAME` and advance by 1. For jumps, the operand *is* the absolute target.

### H10
Build a `static void* table[]` of label addresses indexed by opcode. Define `DISPATCH()` as `goto *table[code[ip++]]`. Each handler ends with `DISPATCH()` instead of `break`. Keep the `switch` version behind `#ifdef` so you can A/B them and so non-GCC compilers still build.

### H11
Add a `prev_op` variable and a 2D count array; increment `counts[prev_op][op]` each iteration. Dump the top pairs after a representative run. For the winner, add an opcode whose handler does both operations, and teach the compiler to emit it when it sees the pair.

### H12
Hold `Value tos` as a local. Instructions that would push now write `tos` (after spilling the old `tos` to the array); instructions that pop read `tos` first. Track whether `tos` is "valid." Start simple: cache only the single top entry.

### H13
Represent a closure as `{function, upvalues[]}`. Compile variable captures to upvalue references. Keep a VM-wide list of *open* upvalues pointing into the stack; on a frame's return, walk it and `close` (copy value out, redirect pointer to the closure's own storage) any upvalue above the returning frame's base.

### H14
Maintain a stack of active handlers (each records: catch IP, frame, operand-stack height). `throw` pops handlers until one matches, restores that handler's frame + stack height + IP, and jumps to the catch. Run `finally` blocks encountered during unwinding (they can be modeled as handlers that re-raise after running).

### H15
A call is in tail position if its result is immediately returned. Detect this in the compiler and emit `TAIL_CALL`. The handler overwrites the current frame's slots with the new arguments and jumps to the callee's start *without* pushing a frame — so the host stack does not grow.

### H16
At each access site, store a small cache: `(cached_shape, cached_slot)`. On access: if `obj.shape == cached_shape`, use `cached_slot` directly; else do the full lookup and overwrite the cache. When any operation changes an object's shape, you must invalidate caches keyed on the old shape — the simplest correct approach is to make shape a versioned/unique object so a changed shape never compares equal to a stale cached one.

### H17
Each function carries `call_count` and an optional `compiled` pointer. In the call path: `count++`; if `compiled`, run it; else if `count > THRESHOLD`, `compiled = compile(fn)` then run it; else interpret. For the stub "compiler," specialize opcodes based on observed behavior and keep a guard so a violated assumption falls back to the generic interpreter.

### H18
Build incrementally and keep both interpreters behind a *common interface* (`run(program) -> output`). Write the test suite *first* (programs + expected outputs) so the differential test is your safety net while you build the bytecode path. Reuse the AST and parser across both backends. Implement closures the same way conceptually in both (defining-environment link in the tree-walker; upvalues in the VM) and test capture explicitly.

---

## Sparse Solutions

These are skeletons, not full programs — fill in the gaps.

### S1
Calculator tree-walker core:
```python
def eval_node(node, env):
    if node.kind == "num":   return node.value
    if node.kind == "binop":
        a = eval_node(node.left, env)
        b = eval_node(node.right, env)
        if node.op == "/" and b == 0:
            raise ZeroDivisionError("division by zero")
        return {"+": a+b, "-": a-b, "*": a*b, "/": a/b}[node.op]
    raise TypeError(f"unknown node {node.kind}")
```

### S2
Control flow (added to `eval_node`):
```python
def truthy(v): return v not in (0, False, None)

# if:
if node.kind == "if":
    if truthy(eval_node(node.cond, env)):
        for s in node.then_body: eval_node(s, env)
    elif node.else_body:
        for s in node.else_body: eval_node(s, env)
    return None
# while:
if node.kind == "while":
    while truthy(eval_node(node.cond, env)):
        for s in node.body: eval_node(s, env)
    return None
```

### S3
Compiler skeleton (slots + constant pool + post-order):
```python
class Compiler:
    def __init__(self): self.code, self.consts, self.slots = [], [], {}
    def k(self, v):
        if v in self.consts: return self.consts.index(v)
        self.consts.append(v); return len(self.consts)-1
    def slot(self, name):
        if name not in self.slots: self.slots[name] = len(self.slots)
        return self.slots[name]
    def expr(self, n):
        if n.kind == "num":  self.code += [CONST, self.k(n.value)]
        elif n.kind == "var": self.code += [LOAD_LOCAL, self.slot(n.name)]
        elif n.kind == "binop":
            self.expr(n.left); self.expr(n.right)
            self.code.append({"+":ADD,"-":SUB,"*":MUL,"/":DIV}[n.op])
    def stmt(self, n):
        if n.kind == "assign":
            self.expr(n.expr); self.code += [STORE_LOCAL, self.slot(n.name)]
        elif n.kind == "print":
            self.expr(n.expr); self.code.append(PRINT)
```

### S4
VM loop skeleton:
```python
def run(code, consts, nslots):
    stack, locals_, ip = [], [None]*nslots, 0
    while True:
        op = code[ip]; ip += 1
        if op == CONST:       stack.append(consts[code[ip]]); ip += 1
        elif op == LOAD_LOCAL:  stack.append(locals_[code[ip]]); ip += 1
        elif op == STORE_LOCAL: locals_[code[ip]] = stack.pop(); ip += 1
        elif op == ADD: b=stack.pop(); a=stack.pop(); stack.append(a+b)
        elif op == MUL: b=stack.pop(); a=stack.pop(); stack.append(a*b)
        elif op == PRINT: print(stack.pop())
        elif op == JUMP: ip = code[ip]
        elif op == JUMP_IF_FALSE:
            t = code[ip]; ip += 1
            if not stack.pop(): ip = t
        elif op == HALT: return
        else: raise RuntimeError(f"bad op {op}")
```

### S5
Computed-goto dispatch in C (skeleton):
```c
static void *table[] = { [CONST]=&&L_const, [ADD]=&&L_add, [HALT]=&&L_halt /*...*/ };
#define NEXT() goto *table[code[ip++]]
NEXT();
L_const: push(consts[code[ip++]]); NEXT();
L_add:   { Value b=pop(), a=pop(); push(a+b); } NEXT();
L_halt:  return pop();
```

### S6
Upvalue close-on-return (skeleton):
```c
typedef struct Upvalue { Value *loc; Value closed; struct Upvalue *next; } Upvalue;

void close_upvalues(VM *vm, Value *from) {
    while (vm->open && vm->open->loc >= from) {
        Upvalue *u = vm->open;
        u->closed = *u->loc;   // copy live value out of the dying frame
        u->loc = &u->closed;   // redirect to closure-owned storage
        vm->open = u->next;
    }
}
// On function return: close_upvalues(vm, frame_base); then pop the frame.
```

### S7
Capstone harness (differential test):
```python
PROGRAMS = [
    ("fizzbuzz",  FIZZBUZZ_SRC,  EXPECTED_FIZZBUZZ),
    ("factorial", FACT_SRC,      "120\n"),
    ("counter",   COUNTER_SRC,   "1\n2\n"),
    ("fib",       FIB_SRC,       "55\n"),
]

def run_treewalk(src): ...   # parse -> eval -> capture stdout
def run_bytecode(src): ...   # parse -> compile -> VM -> capture stdout

for name, src, expected in PROGRAMS:
    tw = run_treewalk(src)
    bc = run_bytecode(src)
    assert tw == expected, f"{name}: tree-walker wrong: {tw!r}"
    assert bc == expected, f"{name}: bytecode wrong: {bc!r}"
    assert tw == bc,       f"{name}: interpreters DISAGREE: {tw!r} vs {bc!r}"
print("all programs agree across both interpreters")
```
The final `assert tw == bc` is the capstone's whole point: your two implementations of the same language must be observationally identical.

---
