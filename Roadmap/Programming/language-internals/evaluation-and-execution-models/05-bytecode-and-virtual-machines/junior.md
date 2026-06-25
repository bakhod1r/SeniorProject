# Bytecode & Virtual Machines — Junior Level

> **Topic:** [Bytecode & Virtual Machines](README.md)
> **Focus:** What is this `.pyc` / `.class` file, and what runs it? The idea of a small, portable instruction set executed by a software CPU.

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

> Focus: **What is bytecode, and what is the "virtual machine" that runs it?**

When you write Python or Java, your source code never runs on the CPU directly. The CPU only understands *machine code* — raw bytes specific to your processor (x86-64, ARM64, …). Between your readable source and that processor-specific machine code, most modern languages insert a middle layer: **bytecode**.

**Bytecode** is a compact, simple instruction set for an *imaginary* CPU — a CPU that does not physically exist. Your compiler translates source into these imaginary instructions, and then a program called a **virtual machine (VM)** reads those instructions one at a time and *does what each one says*. The VM is, in effect, a CPU written in software.

A tiny example. The Python expression `1 + 2` does not compile to "an add instruction for your Intel chip." It compiles to something like:

```
LOAD_CONST   1
LOAD_CONST   2
BINARY_ADD
```

Three made-up instructions, executed by CPython's VM. The VM loop reads `LOAD_CONST`, pushes `1`, reads the next, pushes `2`, reads `BINARY_ADD`, pops both and pushes `3`. No Intel, no ARM — just a loop in C deciding what each opcode means.

In one sentence: **bytecode is the assembly language of a make-believe processor, and the virtual machine is the program that pretends to be that processor.**

> 🎓 **Why this matters for a junior:** Almost every language you'll touch professionally — Python, Java, C#, JavaScript (V8), Ruby, Lua, Erlang — compiles to bytecode and runs on a VM. Understanding this one idea explains *why* Java is "write once, run anywhere," *why* there's a `__pycache__/` folder full of `.pyc` files, *why* you can decompile a `.class` file, and *why* "compiled" languages like Go feel different from "interpreted" ones like Python. It's the single concept that demystifies how high-level code actually executes.

This page covers: what bytecode is and why languages use it, the **stack machine** model (the most common kind of VM), reading real bytecode with Python's `dis` and Java's `javap`, the **fetch-decode-execute loop** at the heart of every VM, and the `.pyc` / `.class` files where bytecode lives. Deeper topics — register VMs, verification, JIT handoff, designing your own opcodes — are in `middle.md`, `senior.md`, and `professional.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a basic program in at least one of: Python, Java, C#, or JavaScript.
- **Required:** The idea that source code is "compiled" or "run" — even if vaguely.
- **Required:** What a *function*, a *variable*, and an *array* are.
- **Helpful but not required:** A loose sense that the CPU executes "instructions."
- **Helpful but not required:** Having seen a *stack* data structure (push / pop). We'll re-explain it.

You do **not** need to know:

- Assembly language or machine code (we explain just enough).
- How a compiler parses source into a syntax tree (that's an earlier topic).
- How a JIT compiler works (that's `senior.md` and `professional.md`).
- Anything about register allocation, type systems, or the JVM verifier yet.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Machine code** | The raw bytes a *physical* CPU executes. Specific to a processor family (x86-64, ARM64). |
| **Bytecode** | Instructions for a *virtual* (imaginary) CPU. Compact, portable, not tied to any physical processor. |
| **Opcode** | "Operation code." A single instruction — one number telling the VM *what to do* (e.g. "add", "load", "jump"). |
| **Operand** | The *data* an opcode works on (e.g. *which* constant to load, *how far* to jump). |
| **Virtual machine (VM)** | A program that reads bytecode and executes each instruction. A CPU implemented in software. |
| **Interpreter loop** | The core of a VM: a loop that fetches the next opcode, decodes it, and runs the matching action. |
| **Stack machine** | A VM design where instructions operate on an **operand stack** (push/pop) rather than named registers. |
| **Operand stack** | A temporary stack the VM pushes values onto and pops them off as it computes. |
| **Local variable slot** | A numbered storage slot for a function's local variables, separate from the operand stack. |
| **Constant pool** | A table of literal values (numbers, strings, names) that instructions refer to *by index* instead of inlining. |
| **Disassembler** | A tool that turns raw bytecode bytes back into human-readable instruction names (`dis`, `javap -c`). |
| **`.pyc` file** | A cached file holding the compiled bytecode of a Python module (inside `__pycache__/`). |
| **`.class` file** | The file holding the compiled bytecode of one Java class. |
| **JIT (just-in-time) compiler** | A part of some VMs that translates hot bytecode into real machine code *while the program runs* (covered later). |
| **Portable** | Runs unchanged on any machine that has a VM, regardless of CPU or OS. |

---

## Core Concepts

### 1. Why have bytecode at all? The two-step compile

A pure interpreter could read your source text and execute it directly, re-parsing every line each time it runs. That's slow: parsing is expensive and you'd redo it on every loop iteration. A pure compiler could translate source straight to machine code — fast, but the result only runs on *one* kind of CPU, and the compiler has to know every processor.

Bytecode splits the difference into **two steps**:

1. **Compile** source → bytecode, *once*. The hard work (parsing, name resolution, turning expressions into instructions) happens here.
2. **Execute** bytecode on a VM, *every time you run*. This is fast because the bytecode is already simple and pre-digested.

The payoff:

- **Portability.** The bytecode is the same on every machine. Only the VM is platform-specific. Ship one `.jar`, run it on Windows, macOS, Linux, a phone — anywhere with a JVM.
- **Compactness.** Bytecode is dense. A whole method fits in a handful of bytes.
- **Speed vs. a tree-walker.** Executing a flat list of simple opcodes is much faster than re-walking a syntax tree.
- **Safety (later).** Bytecode can be *checked* before it runs (the JVM verifier — see `middle.md`).

### 2. The stack machine: the most common VM design

Most famous VMs — the JVM, CPython, the .NET CLR, WebAssembly — are **stack machines**. The defining feature: instructions don't name where their inputs come from. They pop inputs off an **operand stack** and push results back.

Think of the operand stack as a scratchpad. To compute `2 + 3`:

```
PUSH 2        stack: [2]
PUSH 3        stack: [2, 3]
ADD           pops 3 and 2, pushes 5 → stack: [5]
```

The `ADD` instruction is tiny — it carries *no operands at all*. It just says "take the top two, add them, put the result back." Every arithmetic op works this way. This makes the instruction set small and the compiler simple: to compile an expression, you walk it and emit pushes and operations in the right order.

### 3. Local variables live in numbered slots

The operand stack is for *temporary* values mid-calculation. Your actual variables (`x`, `total`, `i`) live in a separate place: **local variable slots**, numbered `0, 1, 2, …`. Two instructions move values between the slots and the stack:

- `LOAD slot_n` — push the value in slot *n* onto the stack.
- `STORE slot_n` — pop the top of the stack into slot *n*.

So `x = a + b` (where `a`, `b`, `x` are slots 0, 1, 2) becomes:

```
LOAD 0        push a
LOAD 1        push b
ADD           pop both, push a+b
STORE 2       pop result into x
```

### 4. The constant pool: refer to literals by number

Instructions are kept small. Instead of embedding the string `"hello"` or the number `3.14159` directly inside an instruction, the compiler puts those literals in a side-table — the **constant pool** — and the instruction just carries an *index* into it.

```
LOAD_CONST 0    # pool[0] is the string "hello"
LOAD_CONST 1    # pool[1] is the number 42
```

This keeps the instruction stream uniform and dense, and lets the same literal be shared by many instructions without repeating it.

### 5. The interpreter loop: fetch, decode, execute

The whole VM is, at its heart, one loop:

1. **Fetch** the next opcode (read the byte at the "program counter," then advance it).
2. **Decode** it (figure out which operation this byte means).
3. **Execute** the matching action (do the add, the push, the jump…).
4. Go back to step 1.

In pseudo-code:

```
pc = 0
while true:
    op = code[pc]; pc += 1
    switch op:
        case PUSH:  operand = code[pc]; pc += 1; stack.push(operand)
        case ADD:   b = stack.pop(); a = stack.pop(); stack.push(a + b)
        case LOAD:  slot = code[pc]; pc += 1; stack.push(locals[slot])
        case STORE: slot = code[pc]; pc += 1; locals[slot] = stack.pop()
        case RETURN: return stack.pop()
        ...
```

That `switch` *is* the virtual machine. Everything else is bookkeeping.

### 6. Where the bytecode is stored

You can usually *see* the bytecode on disk:

- **Python** writes compiled modules to `__pycache__/<name>.cpython-XY.pyc`. Next time you import that module, if the source hasn't changed, Python skips recompiling and loads the cached bytecode. That's why imports are fast the second time.
- **Java** writes one `.class` file per class. A `.jar` is just a zip of `.class` files plus metadata.
- **C#** compiles to **CIL** (Common Intermediate Language) inside a `.dll` or `.exe` assembly.

---

## Real-World Analogies

**1. A recipe vs. cooking it.** Source code is a recipe written in flowery prose ("gently fold the egg whites"). Bytecode is the same recipe rewritten as a numbered checklist of dead-simple steps ("1. crack egg. 2. separate white. 3. whisk 40 times."). The VM is the cook who does exactly what each numbered step says, in order. Any cook in any kitchen can follow the checklist — it's *portable*.

**2. A player piano.** The bytecode is the punched paper roll: a strip of holes encoding "press this key now." The VM is the piano mechanism that reads the roll and strikes the keys. The same roll plays on any compatible player piano, regardless of where it was made. The roll doesn't *know* how the piano works internally — it just describes the notes.

**3. IKEA instructions.** The assembly booklet is a sequence of tiny, unambiguous steps with no prose. You (the VM) execute them one at a time using only the parts in front of you (the operand stack = the parts laid out on the floor). The same booklet works in every country; only *you*, the assembler, are local.

**4. A stack of plates (the operand stack).** You can only add or remove plates from the *top*. `ADD` is like: take the top two plates, combine them somehow, put one plate back. You never reach into the middle.

---

## Mental Models

**Model 1: The VM is a software CPU.** A real CPU has registers, a program counter, and a fetch-decode-execute loop in silicon. A VM has an operand stack, a program counter, and a fetch-decode-execute loop in C. The only difference is hardware vs. software. Everything you intuit about "the CPU runs instructions one by one" applies to the VM too — just slower and safer.

**Model 2: Bytecode is "pre-chewed" source.** The compiler did the thinking once (parsing, figuring out what `+` means here, assigning variable slots). The VM never has to think about syntax again — it only obeys flat, simple commands. This is why running bytecode is faster than re-interpreting source.

**Model 3: Two stacks, don't confuse them.** There's the **operand stack** (per function call, holds mid-expression temporaries — pushed and popped constantly). And there's the **call stack** (one frame per active function call, each frame containing its *own* operand stack and local slots). When a junior says "the stack," they usually mean the call stack; the VM's operand stack is a smaller thing *inside* each frame.

**Model 4: Opcode = verb, operand = noun.** `LOAD_CONST 5` reads as "verb LOAD_CONST, applied to noun #5." Some verbs need no noun (`ADD`, `RETURN`); they act purely on whatever's on the stack.

---

## Code Examples

### Example 1: Reading Python bytecode with `dis`

Python ships a disassembler in the standard library. Let's see real bytecode.

```python
import dis

def add(a, b, c):
    return a + b * c

dis.dis(add)
```

Output (Python 3.11, lightly annotated — exact format varies by version):

```
  RESUME              0
  LOAD_FAST           a          # push local a
  LOAD_FAST           b          # push local b
  LOAD_FAST           c          # push local c
  BINARY_OP           5 (*)      # pop c, b → push b*c
  BINARY_OP           0 (+)      # pop (b*c), a → push a+(b*c)
  RETURN_VALUE                   # pop and return
```

Notice the *order*: it pushes `a`, then `b`, then `c`, multiplies `b*c` first (because `*` binds tighter than `+`), then adds. The bytecode *encodes operator precedence* by the order of operations — the VM itself knows nothing about precedence. The compiler already figured it out.

`LOAD_FAST` is Python's fast path for function locals (they live in numbered slots). The numbers after `BINARY_OP` are operands selecting *which* binary operation.

### Example 2: Reading Java bytecode with `javap`

```java
public class Calc {
    int compute(int a, int b, int c) {
        return a + b * c;
    }
}
```

Compile and disassemble:

```
javac Calc.java
javap -c Calc
```

Output (the `compute` method):

```
int compute(int, int, int);
  Code:
     0: iload_1      // push local 1 (a)  — slot 0 is 'this'
     1: iload_2      // push local 2 (b)
     2: iload_3      // push local 3 (c)
     3: imul         // pop c,b → push b*c
     4: iadd         // pop (b*c),a → push a+(b*c)
     5: ireturn      // return the int on top
```

Same stack-machine shape as Python, but the opcodes are **typed**: `iload`/`imul`/`iadd`/`ireturn` are the *integer* versions. There are parallel families for `long` (`l`), `float` (`f`), `double` (`d`). Slot 0 is `this` because `compute` is an instance method, so `a`, `b`, `c` are slots 1, 2, 3 — hence `iload_1`, `iload_2`, `iload_3`.

### Example 3: Tracing the stack by hand

Take `a + b * c` with `a=2, b=3, c=4`. Expected result: `2 + 3*4 = 14`. Walk the JVM bytecode and track the operand stack:

```
iload_1   push a(2)        stack: [2]
iload_2   push b(3)        stack: [2, 3]
iload_3   push c(4)        stack: [2, 3, 4]
imul      3*4=12           stack: [2, 12]
iadd      2+12=14          stack: [14]
ireturn   return 14        stack: []
```

Do this on paper a few times. Once the stack movements feel obvious, you understand how a stack machine evaluates *any* expression.

### Example 4: A 30-line stack VM you can read

Here is a complete (toy) stack VM in Python. It runs one program: compute `2 + 3 * 4`.

```python
# Opcodes
PUSH, ADD, MUL, PRINT, HALT = range(5)

program = [
    PUSH, 2,
    PUSH, 3,
    PUSH, 4,
    MUL,        # 3*4 = 12
    ADD,        # 2+12 = 14
    PRINT,
    HALT,
]

def run(code):
    stack = []
    pc = 0
    while True:
        op = code[pc]; pc += 1
        if op == PUSH:
            stack.append(code[pc]); pc += 1
        elif op == ADD:
            b = stack.pop(); a = stack.pop(); stack.append(a + b)
        elif op == MUL:
            b = stack.pop(); a = stack.pop(); stack.append(a * b)
        elif op == PRINT:
            print(stack[-1])
        elif op == HALT:
            return

run(program)   # prints 14
```

That `while`/`if`-chain is a real (tiny) virtual machine. CPython's and the JVM's are the same shape — just with hundreds of opcodes, typed operations, function calls, and decades of optimization. Building one yourself is the capstone in `tasks.md`.

---

## Pros & Cons

**Pros of the bytecode + VM approach:**

| Benefit | Why it matters |
|---------|----------------|
| **Portability** | One compiled artifact runs anywhere a VM exists. The Java promise: "write once, run anywhere." |
| **Faster than a tree-walker** | Bytecode is pre-parsed and flat; no re-parsing per run or per loop iteration. |
| **Compact** | Dense byte-per-instruction encoding; whole programs ship small. |
| **Decouples language from hardware** | Compiler authors target the VM, not 12 different chips. |
| **Inspectable** | You can disassemble and *see* what your code compiled to (`dis`, `javap`). Great for learning and debugging. |
| **Safe to sandbox** | Bytecode can be checked and restricted before running (verification — covered later). |

**Cons / trade-offs:**

| Cost | Why it hurts |
|------|--------------|
| **Slower than native (without a JIT)** | Each instruction goes through the VM loop's fetch-decode overhead. |
| **You need a VM installed** | The user must have a JVM / Python / .NET runtime. (Native binaries don't.) |
| **Easy to decompile** | Bytecode keeps a lot of structure; `.class` files reverse-engineer cleanly. Bad for hiding source. |
| **An extra moving part** | Bugs and performance can depend on the VM, not just your code. |

---

## Use Cases

You're already using bytecode VMs constantly:

- **Java / Kotlin / Scala / Clojure** → JVM bytecode in `.class` files. The dominant enterprise platform.
- **Python** → CPython bytecode in `.pyc` files. The disassembler `dis` is in the stdlib.
- **C# / F# / VB.NET** → CIL on the .NET CLR.
- **JavaScript** → V8 (Chrome, Node) compiles JS to bytecode internally before JIT-ing hot code.
- **Lua** → a register-based VM, embedded in games, Redis, nginx, Roblox.
- **Erlang / Elixir** → the BEAM VM, built for massive concurrency and uptime.
- **WebAssembly (Wasm)** → a deliberately-designed portable bytecode that runs in browsers and on servers, near-native speed.
- **Ruby (YARV)**, **PHP (since 8, the Zend VM + JIT)**, **Smalltalk** — all bytecode VMs.

When *you* might design bytecode: a scripting language for your game or app, a rules/expression engine, a query evaluator, or a sandbox for running untrusted user logic safely.

---

## Coding Patterns

### Pattern 1: Disassemble to understand, not to optimize (yet)

When you're curious *how* a construct compiles, disassemble it.

```python
import dis
dis.dis(lambda x: x * 2 + 1)
```

This is a learning tool. Don't start "optimizing for fewer bytecodes" as a junior — that's almost always premature. Use `dis` to build intuition about what the language does under the hood.

### Pattern 2: Compare two ways of writing the same thing

```python
import dis
dis.dis(lambda lst: [x*2 for x in lst])   # list comprehension
print("---")
dis.dis(lambda lst: list(map(lambda x: x*2, lst)))  # map + lambda
```

Seeing the different bytecode makes the performance difference concrete instead of folklore.

### Pattern 3: Trust the `.pyc` cache, but know it exists

You normally never touch `.pyc` files — Python manages them. But knowing they're *there* explains: why the first import is slower, why deleting `__pycache__/` is harmless (it regenerates), and why a stale cache *almost* never bites you (Python checks source timestamps/hashes).

---

## Best Practices

1. **Disassemble to learn.** `dis.dis(fn)` and `javap -c Class` are the cheapest way to understand "what does this actually do." Do it often while learning.

2. **Don't micro-optimize bytecode counts.** Fewer bytecodes ≠ faster in any way you can reliably measure as a junior. The JIT and the VM internals dominate. Measure real time before believing anything.

3. **Let the VM manage its caches.** Don't commit `__pycache__/` or `.class` files to source control (they're build artifacts). Add them to `.gitignore`. They regenerate.

4. **Know which file is which.** `.pyc` = Python bytecode cache. `.class` = one Java class. `.jar` = zip of classes. `.dll`/`.exe` (managed) = .NET CIL assembly. `.wasm` = WebAssembly module.

5. **Keep source and bytecode in sync.** If you ever see "bizarre" behavior after editing, a stale cache is a rare-but-real suspect. Delete `__pycache__/` and re-run to rule it out.

---

## Edge Cases & Pitfalls

- **"Compiled" doesn't mean "machine code."** A `.pyc` or `.class` is *compiled* — to bytecode, not to native instructions. People conflate "compiled" with "fast native binary." Java and Python are both compiled-to-bytecode.

- **Bytecode is version-specific.** A `.pyc` built by Python 3.11 won't load in 3.12 (the bytecode format and opcode numbers change between versions). That's why `.pyc` filenames embed the version (`cpython-311`). The JVM is far more stable across versions by design.

- **Decompilation is easy.** A `.class` file decompiles back to near-original Java. If you thought shipping bytecode "hides" your source, it doesn't. (Obfuscators exist for this reason.)

- **The operand stack is not the call stack.** A classic confusion. The operand stack holds *expression temporaries*; the call stack holds *function frames*. Each frame has its own operand stack.

- **`dis` output changes between Python versions.** Don't memorize exact opcode names (`BINARY_ADD` became `BINARY_OP` in 3.11). Learn the *shape*, not the spelling.

- **A VM is not an emulator.** An emulator pretends to be *another real* CPU (e.g. running old console games). A VM here executes a *designed-from-scratch imaginary* instruction set. Related idea, different purpose.

---

## Common Mistakes

1. **Thinking Python "interprets source line by line."** It doesn't — it compiles each module to bytecode first, *then* the VM runs the bytecode. The "interpreter" interprets *bytecode*, not text.

2. **Assuming bytecode is unreadable binary gibberish.** It's structured and easy to disassemble. `javap -c` and `dis` show you exactly what's there.

3. **Believing fewer lines of source = fewer bytecodes = faster.** No reliable relationship. Measure.

4. **Confusing the JVM with the Java language.** The JVM runs *bytecode*, from any language that emits it — Kotlin, Scala, Clojure, Groovy all run on the JVM. The VM doesn't know or care what language produced the bytecode.

5. **Committing build artifacts.** `__pycache__/`, `*.class`, `*.pyc` belong in `.gitignore`.

---

## Test Yourself

1. In one sentence, what is the difference between *bytecode* and *machine code*?
2. What does a virtual machine's fetch-decode-execute loop do, step by step?
3. In a stack machine, where do the inputs to an `ADD` instruction come from, and where does the result go?
4. What is the constant pool for, and why don't instructions just embed literals directly?
5. Disassemble `a * b + c` (in your head, JVM-style). In what order do the multiply and add happen, and why?
6. Why is the first `import mymodule` sometimes slower than the second?
7. Why can a `.pyc` from Python 3.11 fail to load in 3.12?
8. Name three real languages whose VMs are stack machines.

*(Answers are throughout the page — the goal is to explain each out loud.)*

---

## Cheat Sheet

```
BYTECODE     = instructions for an imaginary CPU (compact, portable)
VM           = software CPU that runs bytecode (fetch → decode → execute)
STACK MACHINE= ops push/pop an OPERAND STACK (most VMs: JVM, CPython, CLR, Wasm)

EXPRESSION a + b * c  →  push a; push b; push c; mul; add
LOCALS  live in numbered slots:  LOAD slot / STORE slot
LITERALS live in the CONSTANT POOL: LOAD_CONST index

TOOLS
  Python:  import dis; dis.dis(fn)
  Java:    javac X.java && javap -c X
  .NET:    ildasm / ilspy

FILES
  .pyc   Python bytecode cache   (__pycache__/)
  .class one Java class           (.jar = zip of these)
  .dll/.exe (managed) = .NET CIL
  .wasm  WebAssembly module

REMEMBER
  "compiled" ≠ "machine code" — .pyc/.class are compiled to BYTECODE
  operand stack ≠ call stack
  bytecode is version-specific and easy to decompile
```

---

## Summary

- **Bytecode** is a compact, portable instruction set for an *imaginary* CPU. The compiler translates source into it *once*.
- A **virtual machine** is a program that executes bytecode via a **fetch-decode-execute loop** — a CPU implemented in software.
- Most major VMs are **stack machines**: instructions push and pop an **operand stack**, local variables live in **numbered slots**, and literals live in a **constant pool** referenced by index.
- You can *see* real bytecode: `dis.dis(fn)` in Python, `javap -c` for Java. Tracing `a + b * c` by hand on the operand stack is the exercise that makes it click.
- Bytecode buys **portability** ("write once, run anywhere") and speed over re-interpreting source, at the cost of needing a VM and being easy to decompile.
- `.pyc`, `.class`, CIL assemblies, and `.wasm` are all just files holding bytecode.

The next level (`middle.md`) introduces **register-based VMs** (Lua, Dalvik) and the stack-vs-register trade-off, plus the anatomy of real instructions, the constant pool, and how jumps work.

---

## Further Reading

- Python: the standard-library `dis` module documentation, and the `Python/ceval.c` interpreter loop in CPython's source.
- Java: *The Java Virtual Machine Specification* (the chapter on the instruction set is surprisingly readable).
- *Crafting Interpreters* by Robert Nystrom — the second half builds a complete bytecode VM in C, and is the best gentle introduction in print.
- WebAssembly: the official `webassembly.org` "Getting Started" and the spec's overview of instructions.
- Try it yourself: run `javap -c` on any small class and `dis.dis` on any function you've written today.
