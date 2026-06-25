# Bytecode & Virtual Machines — Hands-On Tasks

> **Topic:** [Bytecode & Virtual Machines](README.md)

---

## Introduction

These exercises take you from "I can read `dis` output" to "I built a stack VM with a compiler, control flow, function calls, and a tiny verifier." Every task is sized for one or two focused sessions, and they build on one another — the capstone reuses everything before it.

How to use this file: read the task, write code, *run it*, and only then check the hints. The self-check boxes are for when you can *explain* the result to someone else, not when the program merely runs. Solutions are sparse and appear only where the canonical answer teaches more than your first attempt would. Wherever the task says "disassemble," actually run `dis.dis` / `javap -c` — reading real bytecode is half the learning.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone: Build a Stack VM](#capstone-build-a-stack-vm)

---

## Warm-Up

These rebuild the mental model with real tools before you write any VM code.

### Task 1: Disassemble an expression and trace the stack

**Problem.** Write `def f(a, b, c): return a + b * c` and run `dis.dis(f)`. Then, on paper, trace the operand stack instruction by instruction for `a=2, b=3, c=4`. Predict the result before running `f(2,3,4)`.

**Constraints.**
- Use real `dis` output, not a guess.
- Write the stack contents after *every* instruction.

**Hints (try first).**
- `*` binds tighter than `+`, so `b*c` is computed before the add — the bytecode order reflects this.
- The final value left on the stack is what `RETURN_VALUE` returns.

**Self-check.**
- [ ] Your hand-traced stack matches the actual result (14).
- [ ] You can point to where in the bytecode operator precedence is "encoded."
- [ ] You can name what `LOAD_FAST` does and why it's "fast."

---

### Task 2: Same expression, two languages

**Problem.** Compile `int compute(int a,int b,int c){ return a + b*c; }` in Java and run `javap -c`. Compare the opcode sequence to Task 1's Python.

**Constraints.**
- Note *why* the JVM uses `iload_1/iload_2/iload_3` and not `iload_0`.
- Identify the typed opcodes (`imul`, `iadd`, `ireturn`).

**Hints.**
- Slot 0 is `this` for an instance method, so `a,b,c` are slots 1,2,3.
- The shape is identical to Python's; the difference is *typing* (`imul` vs untyped `BINARY_OP`).

**Self-check.**
- [ ] You can explain why JVM opcodes are typed and CPython's mostly aren't.
- [ ] You can map each Java opcode to its Python counterpart.

---

### Task 3: Find the jumps

**Problem.** Disassemble a function with an `if/else` and a function with a `while` loop (in Python or Java). Identify every jump, label it forward or backward, and mark which one is the loop's back-edge.

**Hints.**
- The loop has exactly one *backward* jump (`goto`/`JMP` to the condition) — that's the back-edge.
- `if/else` has a *forward* conditional branch over the `then`, and a forward `goto` past the `else`.
- The forward jumps were *backpatched* by the compiler.

**Self-check.**
- [ ] You found the back-edge and can state its target offset.
- [ ] You can explain why forward jumps needed backpatching and the back-edge didn't.

---

### Task 4: Inspect a `.pyc`

**Problem.** Find a `.pyc` in `__pycache__/`. Print `importlib.util.MAGIC_NUMBER`. Then `compile()` a small source string to a code object and inspect `co_consts`, `co_varnames`, and `co_code.hex()`.

**Hints.**
- The first bytes of a `.pyc` are the magic number (version-tied), not bytecode.
- `co_consts` *is* the constant pool; `co_code` is the raw bytecode bytes.

**Self-check.**
- [ ] You can explain why a 3.11 `.pyc` won't load in 3.12.
- [ ] You located the constant pool and the bytecode bytes in a code object.

---

## Core

These are short programs. Each introduces a VM primitive you'll reuse in the capstone.

### Task 5: A 5-opcode arithmetic VM

**Problem.** Implement a stack VM with exactly `PUSH, ADD, SUB, MUL, PRINT, HALT`. Run a program that computes and prints `(2 + 3) * 4 - 5`.

**Constraints.**
- Bytecode is a flat list of integers (opcode then inline operands).
- One `while` loop with a dispatch on the opcode.

**Hints.**
- `(2+3)*4-5` in postfix: `2 3 + 4 * 5 -` → `PUSH 2, PUSH 3, ADD, PUSH 4, MUL, PUSH 5, SUB, PRINT, HALT`.
- Pop order matters for non-commutative ops: for `SUB`, `b = pop(); a = pop(); push(a - b)`.

**Self-check.**
- [ ] Result is 15.
- [ ] You can explain why pop order matters for `SUB` and `DIV` but not `ADD`/`MUL`.

**Sparse solution (the dispatch core):**

```python
PUSH, ADD, SUB, MUL, PRINT, HALT = range(6)
def run(code):
    s, pc = [], 0
    while True:
        op = code[pc]; pc += 1
        if   op == PUSH:  s.append(code[pc]); pc += 1
        elif op == ADD:   b=s.pop(); a=s.pop(); s.append(a+b)
        elif op == SUB:   b=s.pop(); a=s.pop(); s.append(a-b)
        elif op == MUL:   b=s.pop(); a=s.pop(); s.append(a*b)
        elif op == PRINT: print(s[-1])
        elif op == HALT:  return
```

---

### Task 6: Add locals (slots)

**Problem.** Extend Task 5 with `LOAD slot` and `STORE slot` and a `locals` array. Run: `x = 10; y = 20; print(x + y * 2)`.

**Hints.**
- `STORE n` pops the stack into `locals[n]`; `LOAD n` pushes `locals[n]`.
- Pre-size `locals` (or grow it) for the number of slots you use.

**Self-check.**
- [ ] Result is 50.
- [ ] You can articulate the difference between the operand stack (temporaries) and the locals array (named variables).

---

### Task 7: Add control flow (jumps)

**Problem.** Add `JMP target`, `JMP_IF_FALSE target`, and a comparison `LT`. Write bytecode *by hand* for: `i = 0; while i < 5: print(i); i = i + 1`.

**Constraints.**
- Jump targets are absolute offsets into the code array.
- Do *not* peek at the answer until you've drawn the offsets yourself.

**Hints.**
- The loop top is a fixed offset; the exit `JMP_IF_FALSE` targets the offset *after* the loop body.
- The back-edge `JMP` targets the loop top.
- Getting offsets wrong by one lands you mid-instruction — that's the classic bug.

**Self-check.**
- [ ] Prints 0,1,2,3,4.
- [ ] You can explain why hand-computing offsets is error-prone (and why a real compiler backpatches instead).

---

### Task 8: Measure dispatch cost

**Problem.** Take your VM and a tight loop program (e.g. sum 0..1,000,000). Time it. Then add a `LOAD_LOAD_ADD` **superinstruction** that fuses `LOAD; LOAD; ADD`, rewrite the loop to use it, and time again.

**Hints.**
- The win comes from fewer trips through the dispatch loop, not faster arithmetic.
- In Python the absolute numbers are dominated by Python itself; the *relative* improvement is the lesson.

**Self-check.**
- [ ] The superinstruction version is measurably faster, and you can explain *why* (fewer dispatches).
- [ ] You can describe how a real VM would *detect* the hot sequence to fuse (profiling/quickening).

---

## Advanced

### Task 9: Write a compiler with backpatching

**Problem.** Stop hand-writing offsets. Write a small compiler from a tiny AST (or a postfix/Polish source) to your bytecode, with proper **backpatching** for forward jumps. Compile and run an `if/else` and a `while`.

**Constraints.**
- Implement `emit_jump(op) -> hole` and `patch_jump(hole)` (fill the placeholder with the current code length).
- Backward jumps (loop back-edge) are emitted directly with the known target.

**Hints.**
- Emit the conditional branch with a placeholder target; remember the index; after generating the branch body, patch the placeholder to the current position.
- Track a running **stack depth** as you emit; if it ever goes negative or differs across a merge, your codegen is wrong.

**Self-check.**
- [ ] Generated bytecode runs correctly for nested `if` and a `while`.
- [ ] Your `patch_jump` correctly fills forward jumps; backward jumps need no patching.
- [ ] Your running stack-depth tracker matches `max_stack`.

**Sparse solution (the backpatch pair):**

```python
def emit_jump(code, op):
    code.append(op); code.append(0xFFFF)   # placeholder operand
    return len(code) - 1                    # index of the hole

def patch_jump(code, hole):
    code[hole] = len(code)                  # fill with current position
```

---

### Task 10: Add function calls and a call stack

**Problem.** Add `CALL addr, argc` and `RET`. Each call pushes a **frame** (return address, its own locals, its own operand-stack base) onto a call stack. Implement a recursive `factorial(n)` in your bytecode.

**Hints.**
- A frame needs at least: return PC, a locals array, and where this frame's operand stack begins.
- `CALL` saves the current PC, sets up the new frame, and jumps to the function's entry.
- `RET` pops the frame, restores the saved PC, and leaves the return value on the caller's operand stack.

**Self-check.**
- [ ] `factorial(5)` returns 120.
- [ ] You can now clearly distinguish the **call stack** (one frame per call) from the **operand stack** (per-frame temporaries).
- [ ] Deep recursion grows the call stack; you can explain where a stack-overflow would come from.

---

### Task 11: A tiny verifier

**Problem.** Before running a program, write a checker that *statically* rejects bytecode that (a) underflows the operand stack, (b) leaves an inconsistent stack depth where two control-flow paths merge, or (c) has a jump target that isn't a valid instruction boundary.

**Constraints.**
- Compute the stack depth at each instruction by simulating *stack effects* (not values), following both branches of conditional jumps.
- Reject (don't run) any program that fails a check.

**Hints.**
- Track depth per instruction; at a merge point, the depth must match on all incoming paths — otherwise reject (this is the JVM verifier's core rule, simplified).
- Validate that every jump operand lands on the start of an instruction, not mid-instruction.

**Self-check.**
- [ ] Your verifier rejects a program that does `ADD` on an empty stack.
- [ ] It rejects an `if` whose two branches leave different stack depths at the join.
- [ ] You can explain why this static check is the foundation for running *untrusted* bytecode.

---

### Task 12: Add metering (fuel)

**Problem.** Make your VM safe against runaway untrusted code: give `run(code, fuel)` a fuel budget, decrement it per instruction (or per a cost table), and raise `OutOfFuel` when it hits zero. Prove `while True: pass`-style bytecode is now bounded.

**Hints.**
- Memory safety doesn't stop infinite loops — *only* metering does.
- A per-opcode cost table (cheap ops cost 1, expensive ops more) mirrors real systems (EVM gas, Wasm fuel, BEAM reductions).

**Self-check.**
- [ ] An infinite-loop program halts with `OutOfFuel` instead of hanging.
- [ ] You can name three real systems that meter execution and the unit each uses.

---

### Task 13: Compare your bytecode to register-based

**Problem.** Take the expression `x = a + b * c`. Write it (a) in your stack bytecode and (b) in a hypothetical register form (`MUL r3, r1, r2; ADD r4, r0, r3; ...`). Count instructions and dispatches for each.

**Self-check.**
- [ ] The register form has fewer instructions/dispatches; the stack form has smaller, simpler instructions.
- [ ] You can state precisely *why* Lua 5 switched stack→register, in terms of this count.

---

## Capstone: Build a Stack VM

**Goal.** Implement a complete (toy) stack virtual machine and a compiler for a small language, integrating everything above. This is the exercise that converts "I understand bytecode" into "I have built a bytecode VM."

**Required features.**

1. **A bytecode format** with a magic number and a version byte (so you can reject garbage/wrong-version input cleanly).
2. **A stack machine core:** operand stack, local slots, program counter, fetch-decode-execute loop.
3. **Opcodes:** `PUSH/LOAD_CONST`, `LOAD/STORE` (locals), arithmetic + comparison, `JMP`/`JMP_IF_FALSE` (control flow), `CALL`/`RET` (functions with frames), `PRINT`, `HALT`.
4. **A constant pool** (numbers/strings referenced by index, not inlined).
5. **A compiler** from a small source language (at minimum: variables, arithmetic, `if/else`, `while`, function definitions and calls) to your bytecode, using **backpatching** for forward jumps.
6. **A disassembler** that prints your bytecode in readable form (like `dis`/`javap -c`), resolving jump targets and constant-pool indices.
7. **A verifier** (from Task 11) that runs before execution and rejects unbalanced/under-flowing/illegally-jumping bytecode.
8. **Fuel metering** (from Task 12) so untrusted programs are bounded.

**Test program (your language must compile and run this).**

```
fn fib(n) {
    if n < 2 { return n; }
    return fib(n - 1) + fib(n - 2);
}
print fib(10);     // expect 55
```

**Stretch goals (pick any).**

- **Computed-goto dispatch** if you write the core in C — measure the speedup vs a `switch` (expect 1.5–2.5×).
- **A superinstruction** for your hottest opcode pair; measure the gain.
- **Stack caching:** keep the top-of-stack in a variable/register instead of the stack array.
- **Adaptive specialization:** rewrite a generic `ADD` into an int-specialized `ADD_INT` with a guard and a deopt path back to the generic op.
- **Serialize/deserialize** your bytecode to a file (magic + version + constant pool + code) and load it back — you've now built a `.pyc`/`.class` analog.
- **Hot reload:** swap a function's bytecode at runtime while the program runs.

**Self-check (you've truly finished when):**

- [ ] `fib(10)` prints 55, and the recursion grows a real call stack of frames.
- [ ] Your disassembler output is readable and resolves jump targets and pool indices.
- [ ] Your verifier *rejects* a deliberately corrupted program (bad stack balance, illegal jump) *before* running it.
- [ ] An infinite-loop program is stopped by fuel, not by hanging your process.
- [ ] You can explain, for *each* design choice you made, the trade-off behind it (stack vs register, fixed vs variable width, typed vs untyped, where the constant pool helps, why verification precedes execution).
- [ ] You can disassemble your own compiler's output and trace any expression's stack by hand — and the trace matches the run.

**Why this capstone matters.** Once you've built this, every production VM (CPython, the JVM, the CLR, a Wasm engine) reads as *the same machine you built* — just with hundreds of opcodes, a real verifier, a GC, and a JIT bolted on. The structure is identical. That recognition is the entire point of the topic.

---

## Related Topics

- The **JIT-compilation** topic continues directly from the capstone: your bytecode is the input a JIT would compile to native code.
- The **garbage-collection** topic is the other major subsystem a real VM needs that this capstone omits.
- The **parsing / AST** topics sit *before* the compiler stage you built here (source text → AST → your bytecode).
