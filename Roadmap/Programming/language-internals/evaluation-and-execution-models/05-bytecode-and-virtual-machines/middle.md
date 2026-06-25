# Bytecode & Virtual Machines — Middle Level

> **Topic:** [Bytecode & Virtual Machines](README.md)
> **Focus:** Stack VMs vs register VMs, the anatomy of an instruction, jumps and backpatching, and what really lives in a `.class` / `.pyc` file.

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
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **The two great VM architectures (stack vs register), how a single instruction is laid out, how control flow (jumps) is encoded, and what a real bytecode file contains.**

At the junior level, "bytecode" meant a flat list of simple opcodes run by a software CPU, and "stack machine" was the only model. That's the most common design, but it isn't the only one — and the choice between **stack-based** and **register-based** VMs is one of the central engineering decisions in language implementation. It shapes instruction count, instruction size, decode cost, and how easy the bytecode is to JIT-compile later.

This level answers four practical questions:

1. **Stack vs register** — what's the difference, and what does each buy you? (Lua 5 famously switched from a stack VM to a register VM for speed.)
2. **Anatomy of an instruction** — how is one opcode physically encoded? Fixed vs variable width, inline operands vs constant-pool indices.
3. **Control flow** — `if`, loops, and `&&` all compile to *jumps*. How are jump targets encoded when you don't yet know where the target is? (Answer: **backpatching**.)
4. **The file format** — what's actually inside a `.class` or `.pyc`? Magic numbers, the constant pool, method tables, line-number tables.

In one sentence: **this page is where bytecode stops being a black box and becomes a format you could read with a hex editor and a spec.**

> 🎓 **Why this matters at this level:** Once you can read a constant pool, follow a jump offset, and explain why Lua picked register over stack, you can debug "why is my disassembly weird," reason about code size, and understand performance discussions that previously sounded like magic. This is also the knowledge you need before `senior.md`'s interpreter-dispatch and verification material makes sense.

---

## Prerequisites

- **Required:** Everything in `junior.md` — what bytecode is, the operand stack, local slots, the constant pool, the fetch-decode-execute loop, reading `dis` / `javap` output.
- **Required:** Comfort tracing a stack machine evaluating an expression by hand.
- **Required:** Basic understanding of `if`/`while` and boolean short-circuiting (`&&`, `||`).
- **Helpful:** Having seen hexadecimal and byte-level thinking (offsets, widths).
- **Helpful:** A loose idea of what a CPU register is.

You do **not** yet need: interpreter dispatch techniques (direct threading, computed goto), JIT internals, or the formal verifier — those are `senior.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Stack-based VM** | Instructions take inputs from / push results to an implicit operand stack. JVM, CPython, CLR, Wasm. |
| **Register-based VM** | Instructions name their operands explicitly as numbered "virtual registers." Lua 5, Dalvik, BEAM. |
| **Virtual register** | A numbered slot in a register VM — not a hardware register; just an index into the frame's value array. |
| **Instruction width** | The size in bytes of one encoded instruction. *Fixed-width* (every instr same size) or *variable-width*. |
| **Inline operand** | An operand stored in the bytes immediately following the opcode (e.g. a jump offset, a slot index). |
| **Pool index** | An operand that's an *index into the constant pool*, not the value itself. |
| **Program counter (PC)** | The "where am I" pointer into the bytecode. Incremented as instructions are fetched; modified by jumps. |
| **Jump / branch** | An instruction that sets the PC to a target, instead of falling through to the next instruction. |
| **Conditional branch** | A jump taken only if a condition holds (`if_icmplt`, `POP_JUMP_IF_FALSE`). |
| **Jump offset** | How a target is encoded: often *relative* (target = PC + N), sometimes *absolute*. |
| **Backpatching** | Emitting a jump before its target address is known, leaving a placeholder, and filling it in once the target is reached. |
| **Stack effect** | How many values an instruction pops and pushes. `ADD` is (−2, +1) = net −1. Must stay consistent. |
| **Maximum stack depth** | The largest the operand stack ever grows in a method. Stored in the `.class` so the VM can pre-size frames. |
| **Magic number** | A fixed signature at the start of a file identifying its format. `.class` starts with `0xCAFEBABE`. |
| **Symbolic reference** | A name (class/method/field) in the constant pool, resolved to a concrete address lazily at runtime. |
| **Line-number table** | Debug metadata mapping bytecode offsets back to source lines (for stack traces). |

---

## Core Concepts

### 1. Stack-based vs register-based: the central trade-off

Both designs are virtual machines. The difference is *where instructions get their operands*.

**Stack machine.** Operands are implicit — on the operand stack.

```
; compute  x = a + b   (a,b,x are locals 0,1,2)
LOAD 0
LOAD 1
ADD
STORE 2
```

Four instructions. Each is tiny (often 1 byte + maybe a small operand). The instruction stream is long but the instructions are simple.

**Register machine.** Operands are explicit — instructions name source and destination "registers" (numbered local slots).

```
; same computation
ADD r2, r0, r1     ; r2 = r0 + r1
```

*One* instruction. But it's bigger — it carries three register numbers. The instruction stream is short but each instruction is wide.

The trade-off, precisely:

| Aspect | Stack VM | Register VM |
|--------|----------|-------------|
| **Instructions per operation** | More (lots of explicit push/pop) | Fewer (operands named in one instr) |
| **Instruction size** | Small (few/no operands) | Larger (multiple operand fields) |
| **Total code size** | Often comparable; more instrs, smaller each | Often comparable; fewer instrs, bigger each |
| **Dispatch count** | **Higher** — each instr is a trip through the loop | **Lower** — fewer trips through the loop |
| **Codegen complexity** | **Simpler** — emit push/op/pop, no register allocation | **Harder** — must assign virtual registers (a mini register-allocation problem) |
| **JIT-ability** | Fine, but the JIT must reconstruct dataflow from stack pushes/pops | **Easier** — operands and dataflow are explicit |
| **Examples** | JVM, CPython, CLR, Wasm | Lua 5, Dalvik (Android), BEAM-style |

The headline insight: **dispatch is expensive.** Every time the interpreter loop fetches and decodes an instruction, it pays overhead (a branch the CPU may mispredict — see `senior.md`). Register VMs do fewer, fatter instructions, so they dispatch less often. That's exactly why **Lua 5.0 switched from a stack VM to a register VM** and got measurably faster — fewer instructions executed for the same work. Dalvik (the original Android VM) chose register-based for the same reason, *and* because explicit operands are friendlier to ahead-of-time and JIT compilation.

The counter-argument for stack VMs: **simplicity and density.** Codegen is trivial (walk the expression tree, emit pushes and ops), the encoding is compact, and the format is uniform — which makes verification and portability easier. The JVM and Wasm chose stack precisely because the *bytecode is a transport format* meant to be small, verifiable, and easy to generate, with the real performance recovered later by a JIT.

### 2. Anatomy of an instruction

An instruction is **opcode + zero or more operands**. The design choices:

**Fixed-width vs variable-width.**
- *Fixed-width* (e.g. Lua, Dalvik): every instruction is the same size (Lua uses 32-bit words). Decoding is trivial — `pc += 4` always — and the PC math is simple. Costs some space when an instruction needs fewer bits than the fixed width allows.
- *Variable-width* (e.g. the JVM, Wasm, CPython historically): the opcode is one byte; how many operand bytes follow depends on the opcode. Denser, but decoding must know each opcode's length, and PC advancement varies.

**Where do operands come from?**
- *Inline*: bytes right after the opcode. A jump offset, a local-slot number, a small integer. `bipush 100` carries the byte `100` inline.
- *Constant-pool index*: the operand is an *index*; the real value (a string, a large number, a method reference) lives in the constant pool. `ldc #7` means "load constant pool entry 7."

**Typed vs untyped opcodes.**
- The JVM is *typed*: `iadd` (int), `ladd` (long), `fadd` (float), `dadd` (double) are four distinct opcodes. This makes verification and JIT straightforward but multiplies the opcode count.
- CPython is largely *untyped*: `BINARY_OP` dispatches on the runtime types of the operands (because Python is dynamically typed — the bytecode *can't* know the types ahead of time).

**CPython 3.6+ uses fixed 2-byte instructions.** Since 3.6, every CPython instruction is exactly `(opcode, arg)` — 2 bytes — with `EXTENDED_ARG` prefixes for arguments larger than 255. So even the "variable-width" JVM and "wordcode" CPython make different choices.

### 3. Stack effect and maximum stack depth

Every instruction has a **stack effect**: how many values it pops and pushes.

```
LOAD_CONST   ( 0 pop, 1 push )  →  +1
ADD          ( 2 pop, 1 push )  →  −1
POP          ( 1 pop, 0 push )  →  −1
STORE slot   ( 1 pop, 0 push )  →  −1
```

Two consequences:

1. **The stack must balance.** A well-formed method ends with the operand stack at a predictable depth (often empty after a `return`). If you emit code where a branch leaves the stack at depth 2 and the fall-through leaves it at depth 1, you've produced *invalid* bytecode. The JVM verifier (see `senior.md`) rejects exactly this.
2. **The compiler computes the maximum depth** the stack ever reaches and records it (`max_stack` in a `.class`). The VM uses it to pre-allocate each call frame's operand-stack space — no resizing needed at runtime.

### 4. Control flow is just jumps

There is no `if` opcode and no `while` opcode. High-level control flow compiles into **conditional and unconditional jumps** that modify the program counter.

`if (a < b) { X } else { Y }` becomes roughly:

```
        load a
        load b
        if_icmpge ELSE   ; if a >= b, jump to ELSE
        ... X ...
        goto END
ELSE:   ... Y ...
END:    ...
```

A `while` loop is a conditional branch at the top and an unconditional `goto` back to it. Short-circuit `a && b` compiles so that if `a` is false, you *jump past* the evaluation of `b` entirely — that's literally what "short-circuit" means at the bytecode level.

**WebAssembly is the exception that proves the rule.** Wasm has **structured control flow** — `block`, `loop`, `if`/`else`, `br`/`br_if` that can only branch to *enclosing* labels. There are no arbitrary `goto`s to numeric offsets. This restriction makes Wasm bytecode *much* faster to validate and compile (the control-flow structure is given, not reconstructed). We return to why this matters in `senior.md` and `professional.md`.

### 5. Backpatching: emitting a jump before you know the target

When a single-pass compiler emits a forward jump (`if a < b: goto ELSE`), it hits a problem: it doesn't yet know *where* `ELSE` is — it hasn't generated that code. **Backpatching** is the standard fix:

1. Emit the jump opcode with a **placeholder** offset (e.g. `0xFFFF` or `0`).
2. Remember the position of that placeholder.
3. Keep generating code.
4. When you finally reach the target, compute the real offset and **go back and overwrite** the placeholder.

```
emit  JUMP_IF_FALSE, 0xFFFF     ; placeholder
hole = position_of_placeholder
... emit the "then" branch ...
target = current_position
patch(hole, target - hole)      ; fill in the real (relative) offset
```

Backward jumps (loops) don't need backpatching — the target already exists when you emit the jump. Only *forward* jumps do. This is a small but essential technique; you'll implement it in the `tasks.md` capstone the moment you add `if` to your VM.

### 6. What's actually in a `.class` file

A `.class` file (one Java class) has a strict layout. From the front:

```
magic            0xCAFEBABE        ; identifies "this is a class file"
minor_version    u2
major_version    u2                ; e.g. 65 = Java 21
constant_pool_count u2
constant_pool[]                    ; strings, class/method/field refs, numbers
access_flags     u2                ; public/final/abstract...
this_class, super_class            ; indices into the constant pool
interfaces[]
fields[]
methods[]                          ; each method: name, descriptor, and a Code attribute
attributes[]
```

Each method's **Code attribute** contains `max_stack`, `max_locals`, the actual bytecode bytes, an exception table, and optional debug attributes (`LineNumberTable`, `LocalVariableTable`). The **constant pool** is the spine: almost everything is an *index* into it, including class names, method signatures, and string literals.

A **`.pyc`** file is simpler: a small header (magic number identifying the Python version, a bit-field of flags, a source hash or timestamp, source size) followed by a *marshalled* code object. That code object recursively contains the bytecode bytes, the constant tuple (`co_consts`), the local/var names, line-number info, and nested code objects for inner functions. `import marshal; marshal.loads(...)` can read it.

---

## Real-World Analogies

**1. Stack vs register = postfix calculator vs spreadsheet.** A stack VM is like an old HP RPN calculator: you key `2 ENTER 3 +`, and operands live on an implicit stack. A register VM is like a spreadsheet formula `C1 = A1 + B1`: every operand is *named*. The RPN version needs more keystrokes (more instructions); the spreadsheet names everything in one formula (fewer, bigger instructions).

**2. Backpatching = leaving a blank in a form letter.** You write "...as we discussed on ____, your order will ship..." and fill in the date once you know it. The jump offset is the blank; you come back and fill it.

**3. The constant pool = a footnotes section.** Rather than repeating "the Free Software Foundation, 51 Franklin Street..." inline every time, the text says "see footnote 3," and the address lives once in the footnotes. Instructions cite pool entry numbers the same way.

**4. Magic number = a file's secret handshake.** `0xCAFEBABE` at the start of a `.class` is the JVM checking the handshake before trusting the rest. Wrong handshake → "this isn't a class file."

---

## Mental Models

**Model 1: Dispatch is the tax; instruction count is the bill.** Every instruction executed pays a fixed dispatch tax in the interpreter loop. Stack VMs run more instructions (higher total tax) but each is simpler. Register VMs run fewer instructions (lower total tax) but each does more decoding. The whole stack-vs-register debate is an argument about which bill is smaller for real programs.

**Model 2: Bytecode is a *protocol*, not a *program for the CPU*.** Especially for the JVM and Wasm, bytecode is a *transport and verification format* — designed to be compact, safe to ship, and easy to validate — with actual performance delivered later by interpretation + JIT. Judging bytecode purely by "how fast does the interpreter run it" misses the point of why it was designed that way.

**Model 3: Control flow = PC arithmetic.** There is no structured `if` at the bytecode level (except Wasm). Everything is "conditionally or unconditionally set the program counter." Once you internalize that, disassembly of loops and branches stops being confusing — find the targets, follow the arrows.

**Model 4: The constant pool is a layer of indirection you can flatten in your head.** Whenever you see `#7` or an index operand, mentally substitute the pool entry. The bytecode reads as if the value were inline.

---

## Code Examples

### Example 1: See a forward jump and its offset (Python)

```python
import dis

def f(a, b):
    if a < b:
        return 1
    return 2

dis.dis(f)
```

Output (3.11-ish, annotated):

```
  LOAD_FAST                a
  LOAD_FAST                b
  COMPARE_OP               '<'
  POP_JUMP_FORWARD_IF_FALSE  to L1   ; conditional branch — jumps over the 'then'
  LOAD_CONST               1
  RETURN_VALUE
L1:
  LOAD_CONST               2
  RETURN_VALUE
```

The conditional branch carries the target as an operand. That target was *backpatched* by the compiler: when it emitted `POP_JUMP_FORWARD_IF_FALSE`, it didn't yet know where `L1` would land — it filled the offset in after generating the `then` branch.

### Example 2: A loop is a backward jump (Java)

```java
int sum(int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += i;
    return s;
}
```

`javap -c` (trimmed):

```
 0: iconst_0
 1: istore_2          // s = 0
 2: iconst_0
 3: istore_3          // i = 0
 4: iload_3
 5: iload_1
 6: if_icmpge 19      // if i >= n, exit loop  (forward jump)
 9: iload_2
10: iload_3
11: iadd
12: istore_2          // s += i
13: iinc 3, 1         // i++
16: goto 4            // back to the condition  (BACKWARD jump)
19: iload_2
20: ireturn
```

`goto 4` is the loop's back-edge. `if_icmpge 19` is the exit. Note `iinc` — a specialized "increment local in place" instruction, no operand stack involved. VMs add such specializations because `i++` is so common.

### Example 3: Inspect a `.pyc` header and code object

```python
import dis, marshal, importlib.util

# Compile some source to a code object
src = "def g(x): return x + 1\n"
code = compile(src, "<demo>", "exec")

# The bytecode bytes themselves:
print(code.co_consts)            # nested code object for g + constants
g_code = [c for c in code.co_consts if hasattr(c, "co_code")][0]
print("constants:", g_code.co_consts)   # (None, 1)
print("varnames:", g_code.co_varnames)  # ('x',)
print("raw bytes:", g_code.co_code.hex())
dis.dis(g_code)
```

You can see the constant pool (`co_consts`), the local names (`co_varnames`), and the raw bytecode bytes — the same things that get marshalled into a `.pyc`.

### Example 4: A stack VM with jumps (toy, with backpatching at compile time)

```python
PUSH, LOAD, STORE, LT, JMP_IF_FALSE, JMP, ADD, PRINT, HALT = range(9)

# Program: i=0; while i<3: print(i); i=i+1
# locals: i = slot 0
LOOP = 4
program = [
    PUSH, 0, STORE, 0,        # i = 0
    # LOOP (offset 4):
    LOAD, 0, PUSH, 3, LT,     # push (i < 3)
    JMP_IF_FALSE, 28,         # if false, jump to HALT (offset backpatched to 28)
    LOAD, 0, PRINT,           # print i
    LOAD, 0, PUSH, 1, ADD, STORE, 0,  # i = i + 1
    JMP, 4,                   # back to LOOP
    # offset 28:
    HALT,
]

def run(code):
    stack, locals_, pc = [], [0], 0
    while True:
        op = code[pc]; pc += 1
        if op == PUSH:  stack.append(code[pc]); pc += 1
        elif op == LOAD:  stack.append(locals_[code[pc]]); pc += 1
        elif op == STORE: locals_[code[pc]] = stack.pop(); pc += 1
        elif op == ADD:   b=stack.pop(); a=stack.pop(); stack.append(a+b)
        elif op == LT:    b=stack.pop(); a=stack.pop(); stack.append(a<b)
        elif op == JMP:   pc = code[pc]
        elif op == JMP_IF_FALSE:
            target = code[pc]; pc += 1
            if not stack.pop(): pc = target
        elif op == PRINT: print(locals_[0])
        elif op == HALT:  return

run(program)   # prints 0, 1, 2
```

This is the same shape as the junior VM, now with control flow. Notice the jump targets are *absolute offsets into `code`* — the kind of value backpatching fills in when you build a compiler for this VM (the capstone in `tasks.md`).

---

## Pros & Cons

**Stack-based VMs**

| Pros | Cons |
|------|------|
| Trivial codegen (no register allocation) | More instructions ⇒ more dispatch overhead |
| Compact, uniform encoding | Dataflow is implicit ⇒ JIT must reconstruct it |
| Easy to verify and port | Pure-interpreter speed is lower |

**Register-based VMs**

| Pros | Cons |
|------|------|
| Fewer instructions ⇒ less dispatch | Codegen must allocate virtual registers |
| Explicit operands ⇒ easier, faster JIT | Larger instructions; wider encoding |
| Often faster as a plain interpreter (Lua's win) | More complex toolchain |

---

## Use Cases

- **Stack VM, chosen for portability + verifiability:** JVM and WebAssembly. The bytecode is a *transport format*; speed comes from the JIT.
- **Register VM, chosen for interpreter speed:** Lua 5 (embedded, must be fast *without* a JIT). Dalvik (Android), chosen for register-based to suit AOT/JIT and constrained devices.
- **Dynamic-typing stack VM:** CPython — untyped opcodes because types aren't known until runtime.
- **Concurrency-first VM:** the BEAM (Erlang/Elixir) — register-based, with reduction-counting for fair scheduling of millions of processes.
- **You designing a VM:** if you have no JIT and want speed, lean register. If you want the simplest correct implementation and a clean verifiable format, lean stack.

---

## Coding Patterns

### Pattern 1: Compute stack effects to validate your codegen

When emitting bytecode, track a running depth: `depth += pushes - pops` per instruction. If it ever goes negative, or differs between two paths that merge, your codegen is buggy. The maximum value is your `max_stack`.

### Pattern 2: Backpatch forward jumps; emit backward jumps directly

```python
def emit_jump(code, op):
    code.append(op); code.append(0xFFFF)   # placeholder
    return len(code) - 1                    # index of the hole

def patch_jump(code, hole):
    code[hole] = len(code)                  # fill with current position
```

This two-function pair is the whole technique. Use it for every `if`, `else`, and short-circuit operator.

### Pattern 3: Read disassembly by following the arrows

To understand a loop in someone else's bytecode: find the backward `goto`/`JMP` (the loop body boundary) and the conditional branch that exits it. Sketch the arrows. Control flow becomes a small graph.

---

## Best Practices

1. **Pick stack vs register on purpose.** Decide based on whether you'll JIT (register favors it), how much you care about interpreter speed (register), and how simple you need the compiler (stack). Don't cargo-cult.

2. **Keep the encoding regular.** Whatever width scheme you pick, be consistent — irregular encodings make both your decoder and any future JIT harder. Wasm and Lua's regularity is a feature.

3. **Store `max_stack` / `max_locals`.** Pre-sizing frames avoids runtime resizing and lets a verifier check stack balance cheaply.

4. **Always backpatch — never guess offsets.** Hand-computing forward offsets is bug-prone. Emit a placeholder and patch.

5. **Put a magic number and a version in your format.** Even a toy format benefits from a 4-byte magic and a version byte: it turns "mysterious crash on garbage input" into "clean 'not my format / wrong version' error."

---

## Edge Cases & Pitfalls

- **Stack imbalance across branches.** If your `then` branch leaves one extra value on the stack and your `else` doesn't, the merge point has an ambiguous stack height. Real VMs reject this; your toy VM will silently corrupt. Track depth on *both* paths.

- **Relative vs absolute jump offsets.** The JVM uses offsets *relative to the branch instruction's own address*; CPython has used both relative and absolute over versions. Mixing them up produces jumps that land in the middle of an instruction.

- **Jumping into the middle of an instruction.** In a variable-width encoding, a wrong offset can land mid-instruction, and the VM will decode garbage. Fixed-width VMs (Lua) are immune to *this* particular bug.

- **`EXTENDED_ARG` in CPython.** Arguments larger than 255 are prefixed with one or more `EXTENDED_ARG` instructions that supply the high bytes. Naively reading 2 bytes per instruction without handling this corrupts large operands (long jumps, big constant indices).

- **Constant-pool index 0 is special in the JVM.** Pool indices are 1-based; entry 0 is reserved. Off-by-one here is a classic bug when writing a class-file parser.

- **`long`/`double` take two JVM stack slots.** They occupy two operand-stack and two local-variable slots. Forgetting this throws off all your slot arithmetic.

---

## Common Mistakes

1. **Assuming register VMs are always faster.** They reduce dispatch but complicate codegen and don't help once a good JIT exists (the JVM is stack-based and screamingly fast). "Faster" depends on *interpreter vs JIT* and on the workload.

2. **Treating the operand stack and call stack as the same thing.** Each call frame contains its *own* operand stack. Confusing them makes disassembly incomprehensible.

3. **Hand-computing jump offsets.** Always backpatch.

4. **Reading a `.pyc` as if the first bytes were bytecode.** They're a header (magic, flags, hash/timestamp, size). The bytecode is inside the marshalled code object.

5. **Thinking `if`/`while` have dedicated opcodes.** They compile to branches. (Except Wasm's structured control flow — and even there, branches target *labels*, not raw offsets.)

---

## Test Yourself

1. State the stack-vs-register trade-off in terms of *instruction count* and *instruction size*. Why did Lua 5 switch to register-based?
2. Why does reducing dispatch count matter, and which design dispatches less?
3. What is a stack effect, and why must the operand stack "balance" across branches?
4. Explain backpatching. Which jumps need it — forward, backward, or both?
5. What is the magic number of a `.class` file, and what is a magic number *for*?
6. What does the JVM constant pool hold, and why do instructions use indices into it?
7. How does WebAssembly's control flow differ from the JVM's, and why does that make Wasm faster to validate?
8. Why do `long` and `double` occupy two slots on the JVM?

---

## Cheat Sheet

```
STACK VM   operands implicit (operand stack) → more, smaller instrs → simple codegen
REGISTER VM operands named  (virtual regs)   → fewer, bigger instrs → easier JIT
  Lua5 / Dalvik / BEAM = register   |   JVM / CPython / CLR / Wasm = stack

INSTRUCTION = opcode [+ operands]
  width:    fixed (Lua, 32-bit) vs variable (JVM)   | CPython = 2-byte wordcode
  operands: inline (jump offset, slot) | constant-pool INDEX (string, big num, ref)
  typed (iadd/ladd/fadd JVM) vs untyped (BINARY_OP CPython, types at runtime)

STACK EFFECT  pops vs pushes; ADD = (−2,+1). Stack MUST balance across merges.
MAX_STACK     largest depth a method reaches; stored to pre-size frames.

CONTROL FLOW = jumps (set the PC). No 'if'/'while' opcodes.
  forward jump → BACKPATCH (emit placeholder, fill later)
  backward jump (loops) → emit directly, target already known
  Wasm = STRUCTURED control flow (block/loop/if/br) → fast to validate

.class  CAFEBABE | versions | constant_pool | methods{ Code: max_stack, bytecode }
.pyc    magic(version) | flags | hash/mtime | size | marshalled code object
```

---

## Summary

- VMs come in two architectures: **stack-based** (implicit operand stack — JVM, CPython, CLR, Wasm) and **register-based** (explicit numbered operands — Lua 5, Dalvik, BEAM). The trade-off is *more/smaller instructions and simple codegen* (stack) vs *fewer/bigger instructions, easier JIT, less dispatch* (register). Dispatch overhead is why Lua 5 switched to register-based.
- An **instruction** is an opcode plus operands, encoded fixed- or variable-width, with operands either inline or as **constant-pool indices**, and opcodes either typed (JVM) or untyped (CPython).
- Every instruction has a **stack effect**; the operand stack must **balance**, and the compiler records **max_stack**.
- **Control flow is jumps** that modify the program counter. **Forward jumps require backpatching**; backward jumps (loops) don't. WebAssembly's **structured control flow** is the deliberate exception, making it fast to validate.
- Real files have structure: `.class` starts with `0xCAFEBABE` and is spined by a **constant pool**; `.pyc` is a small version header plus a marshalled code object.

`senior.md` goes into the interpreter loop's *dispatch techniques* (switch, direct/computed-goto threading, superinstructions, stack caching), **bytecode verification** (the JVM verifier and why it exists for untrusted code), and lazy linking / symbol resolution.

---

## Further Reading

- "The Implementation of Lua 5.0" (Ierusalimschy, de Figueiredo, Celes) — the canonical paper on the register-VM switch and *why*.
- *The Java Virtual Machine Specification* — the class-file format chapter and the instruction-set chapter.
- *Crafting Interpreters* (Nystrom) — chapters on compiling expressions, jumping back and forth (backpatching), and the bytecode chunk format.
- CPython internals: the `dis` module docs, `Include/opcode.h`, and `Python/compile.c` for how branches are emitted and patched.
- The WebAssembly specification's "Structured Control Flow" and "Validation" sections.
