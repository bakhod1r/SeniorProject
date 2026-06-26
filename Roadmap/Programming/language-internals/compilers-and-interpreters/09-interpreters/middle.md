# Interpreters — Middle Level

> **Topic:** [Interpreters](README.md)
> **Focus:** Why production languages don't walk trees. Compiling the AST to **bytecode** and running a fast fetch–decode–execute loop, with locals stored as an array instead of a hash map.

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

> Focus: **Why is a tree-walking interpreter slow, and how does compiling to bytecode fix it?** And: **why do real interpreters store local variables in an array, not a dictionary?**

The tree-walker from `junior.md` is correct and clear, but every time it evaluates a node it pays for two expensive things: a **type dispatch** ("what kind of node is this?") and **pointer-chasing** (following references to children that may be scattered across the heap, blowing the CPU cache). Run that over a loop a million times and you feel it.

Production dynamic languages — **CPython, Ruby's YARV, Lua, the JVM** — solve this the same way. Instead of interpreting the tree directly, they first **compile the AST into bytecode**: a flat, linear array of small numeric instructions (opcodes) such as `LOAD_CONST`, `ADD`, `STORE_FAST`, `JUMP_IF_FALSE`. Then a single tight loop — the **interpreter loop**, also called the *dispatch loop* or *eval loop* — repeatedly fetches the next opcode, decodes it, and executes it. This is the **fetch–decode–execute** cycle, the same shape as a physical CPU, implemented in software.

Bytecode is dramatically faster than tree-walking for several reasons at once: instructions are packed contiguously (cache-friendly), each is a small integer dispatched by one `switch` (no node-type guessing), constants and locals are pre-resolved to *indices* (no string hash lookups), and the structure is linear so the CPU's branch predictor and prefetcher can work. Typical speedups over a naive tree-walker are large — often an order of magnitude.

This is the level where you stop building toys and start understanding how the languages you use every day actually run.

> 🎓 **Why this matters for a mid-level engineer:** When you read CPython's `ceval.c`, profile a slow Python loop, disassemble a function with `dis`, or wonder why "locals are faster than globals," you are looking at exactly the machinery on this page. Understanding the compile-to-bytecode-then-loop architecture lets you reason about interpreter performance instead of treating it as a black box.

This page covers: the **stack-based VM** model and its bytecode, compiling expressions and control flow to bytecode, the fetch–decode–execute loop, why **locals-as-array beats locals-as-hashmap**, the **constant pool**, jumps for control flow, and a complete working compiler + VM. The next level (`senior.md`) goes deep on **dispatch techniques** — computed goto, threaded code, superinstructions — and the path from interpreter to JIT.

---

## Prerequisites

What you should know before reading this:

- **Required:** Comfort with the tree-walking interpreter from `junior.md` — AST, `eval`, environments.
- **Required:** Understanding of a stack data structure (push/pop) and an array indexed by integer.
- **Required:** Basic idea of a `switch`/`match` statement dispatching on an integer.
- **Helpful but not required:** Having seen assembly language or any CPU instruction set — bytecode is a software version of the same idea.
- **Helpful but not required:** Having run Python's `dis.dis(fn)` or read about the JVM. We will recreate that machinery.

You do **not** need to know:

- Computed goto, threaded code, or other dispatch optimizations (that is `senior.md`).
- JIT compilation, garbage collection internals, or register-allocation (later levels and prose).
- How to write a parser — we still assume the AST exists.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Bytecode** | A flat sequence of small numeric instructions (opcodes, plus operands) that an interpreter loop executes. |
| **Opcode** | A single bytecode instruction's identity, e.g. `ADD`, `LOAD_CONST`, `JUMP`. Usually one byte (hence the name). |
| **Operand** | Data attached to an opcode, e.g. the index of the constant to load. |
| **Compiler (to bytecode)** | The stage that translates the AST into bytecode. Distinct from a native-code compiler. |
| **Virtual Machine (VM)** | The component that executes bytecode: the loop plus the stack, locals, and state it operates on. |
| **Interpreter loop / dispatch loop / eval loop** | The `while` loop that fetches, decodes, and executes each opcode. The heart of the VM. |
| **Fetch–decode–execute** | The three-step cycle: read the next opcode, figure out what it is, perform it. |
| **Instruction pointer (IP) / program counter (PC)** | The index of the next bytecode instruction to execute. |
| **Operand stack** | A stack the VM pushes/pops values on while evaluating expressions (in a stack-based VM). |
| **Stack-based VM** | A VM that holds intermediate values on an operand stack. CPython and the JVM are stack-based. |
| **Register-based VM** | A VM that holds intermediate values in numbered virtual registers. Lua 5+ is register-based. |
| **Constant pool** | A table of literal values (numbers, strings) referenced by index from bytecode. |
| **Locals (slot) array** | An array holding a function's local variables, indexed by integer slot — not by name. |
| **Slot** | The integer index of a local variable in the locals array, resolved at compile time. |
| **Jump / branch** | A bytecode instruction that sets the IP to a target, implementing `if`/`while`/`goto`. |
| **Disassembler** | A tool that prints bytecode in human-readable form (e.g. Python's `dis`). |

---

## Core Concepts

### 1. The two-phase architecture: compile, then run

A bytecode interpreter splits execution into two phases:

```text
  Phase 1 (once):   AST  ──[compiler]──►  bytecode + constant pool
  Phase 2 (run):    bytecode  ──[VM loop]──►  result
```

The compiler walks the AST *once* and emits a flat instruction list. The VM then runs that list — possibly many times (e.g. a function called in a loop) — without ever touching the tree again. All the per-node dispatch and name resolution that the tree-walker repeated on every execution is done **once, up front**.

### 2. Bytecode is a flat array of small instructions

Where the tree-walker had `BinOp("+", Number(2), BinOp("*", Number(3), Number(4)))`, the bytecode compiler emits a *linear* sequence. For a **stack-based VM**, `2 + 3 * 4` compiles to:

```text
  CONST  0      # push constant[0] = 2
  CONST  1      # push constant[1] = 3
  CONST  2      # push constant[2] = 4
  MUL           # pop 4, pop 3, push 12
  ADD           # pop 12, pop 2, push 14
```

Notice this is **post-order traversal flattened**: operands are pushed, then the operator pops them and pushes the result. The tree's shape became an instruction order. The constants `2, 3, 4` live in a **constant pool**; the bytecode refers to them by index, not by re-parsing.

### 3. The operand stack does the bookkeeping

In a stack-based VM, intermediate values live on an **operand stack**. Each instruction has a known effect on the stack:

| Opcode | Effect on stack |
|--------|-----------------|
| `CONST i` | push `constant_pool[i]` |
| `ADD` | pop b, pop a, push (a + b) |
| `MUL` | pop b, pop a, push (a * b) |
| `LOAD_LOCAL s` | push `locals[s]` |
| `STORE_LOCAL s` | pop value, store into `locals[s]` |
| `PRINT` | pop value, print it |

The stack is why bytecode can be flat: it remembers "the values computed so far" without needing a tree to hold them. After running the five instructions above, the stack holds a single value, `14` — the result.

### 4. The fetch–decode–execute loop

The VM is one loop. It keeps an **instruction pointer** (IP) into the bytecode and repeats:

```text
  loop:
    opcode = bytecode[IP]      # FETCH
    IP += 1
    switch (opcode):           # DECODE
      case CONST:   push(constants[bytecode[IP]]); IP += 1     # EXECUTE
      case ADD:     b = pop(); a = pop(); push(a + b)
      case MUL:     b = pop(); a = pop(); push(a * b)
      case JUMP:    IP = bytecode[IP]
      case HALT:    return pop()
      ...
```

That is the entire engine. CPython's `ceval.c`, Lua's `lvm.c`, and the JVM's interpreter are all elaborations of this loop. The naive version uses a `switch`; `senior.md` shows the faster dispatch techniques (computed goto, threaded code) that replace it.

### 5. Why locals are an array, not a dictionary

This is the single most important performance idea on this page. In the tree-walker, a variable read was `env["x"]` — a **hash of the string `"x"`, then a lookup**. That is expensive and happens on *every* access.

A bytecode compiler does better. While compiling a function, it knows *all* the local variable names. It assigns each one an integer **slot**: `x → 0`, `y → 1`, `z → 2`. Then `x` compiles to `LOAD_LOCAL 0`, which at runtime is just `push(locals[0])` — a single array index, no hashing, no string comparison.

```text
  Tree-walker:   read x  ->  hash "x"  ->  probe hashmap  ->  value   (slow)
  Bytecode VM:   read x  ->  LOAD_LOCAL 0  ->  locals[0]   ->  value   (fast)
```

This is exactly why, in CPython, **local variables are faster than global variables**: locals use `LOAD_FAST` (an array index), while globals use `LOAD_GLOBAL` (a dictionary lookup). The name resolution moved from *runtime* to *compile time*. This is one of the highest-leverage tricks in interpreter design.

### 6. Control flow becomes jumps

The tree-walker implemented `if`/`while` with the host's own `if`/`while`. The bytecode VM has no tree, so it uses **jumps** that move the IP. An `if` compiles to a conditional jump that skips the unwanted branch:

```text
  if cond { A } else { B }

  <compile cond>          # leaves a boolean on the stack
  JUMP_IF_FALSE  L_else    # if top is false, jump to else
  <compile A>
  JUMP           L_end
L_else:
  <compile B>
L_end:
  ...
```

A `while` is a backward jump:

```text
L_start:
  <compile cond>
  JUMP_IF_FALSE  L_end
  <compile body>
  JUMP           L_start    # loop back
L_end:
```

The compiler emits placeholder jump targets and **patches** them once the target offset is known (called *backpatching*). This is how every loop and branch in a bytecode language is implemented.

### 7. Stack-based vs register-based VMs

There are two main bytecode styles:

- **Stack-based** (CPython, JVM, Ruby YARV, WebAssembly): operands live on an operand stack. Instructions are small and have few/no operands (`ADD` takes its inputs from the stack). Easy to generate; more instructions executed per operation (lots of push/pop).
- **Register-based** (Lua 5+, Dalvik, Android's old VM): operands live in numbered virtual registers. Instructions name their operands (`ADD r3, r1, r2` means `r3 = r1 + r2`). Fewer, fatter instructions; less push/pop traffic; harder to generate but often faster.

Lua 5's switch to a register-based VM is a famous reason for its renowned speed: `a = b + c` is one `ADD` instruction reading two registers and writing one, instead of `LOAD b; LOAD c; ADD; STORE a` (four instructions) on a stack machine. We explore the trade-offs further in `senior.md`; the deep treatment of bytecode design lives in the eval-and-execution material elsewhere in this roadmap.

### 8. Disassembly: reading the bytecode you produced

Every serious bytecode VM ships a **disassembler** so humans can inspect the compiled form. Python's is built in:

```python
import dis
def f(x):
    return x + 1
dis.dis(f)
#   LOAD_FAST   0 (x)
#   LOAD_CONST  1 (1)
#   BINARY_ADD
#   RETURN_VALUE
```

`LOAD_FAST 0` is exactly the locals-array access from concept 5. Writing a disassembler for your own VM is the best debugging tool you can build — it turns an opaque byte array back into readable instructions.

---

## Real-World Analogies

| Concept | Real-world thing |
|---------|------------------|
| **Tree-walking vs bytecode** | Cooking by repeatedly re-reading a recursive recipe outline vs. first writing a flat numbered checklist, then following it fast. |
| **Bytecode** | A flat to-do list of tiny, unambiguous steps, in order. |
| **Operand stack** | A spike on a diner counter where you stack order tickets; you work off the top. |
| **Fetch–decode–execute** | An assembly-line worker: grab the next part (fetch), read its label (decode), bolt it on (execute), repeat. |
| **Instruction pointer** | Your finger tracking which line of the checklist you are on. |
| **Constant pool** | A glossary at the back of the manual; the steps say "see term #3" instead of repeating the definition. |
| **Locals as array (slots)** | Numbered lockers vs. a coat-check where you describe your coat in words every time. Numbered is instant. |
| **Jump** | "Go to step 12" on the checklist, instead of doing the steps in between. |
| **Register vs stack VM** | A workbench with labeled trays (registers) vs. a single stack of parts you must keep pushing and popping. |
| **Disassembler** | Translating the numbered checklist back into plain English so a human can review it. |

---

## Mental Models

### The "Software CPU" Model

A bytecode VM is a CPU written in software. It has an instruction pointer (like a real PC), instructions (opcodes), an arithmetic unit (the `ADD`/`MUL` cases), memory (the locals array and constant pool), and a fetch–decode–execute loop. Once you see the VM as "a CPU I built," every concept maps onto something you already know about hardware. The bytecode is its machine code.

### The "Flatten the Tree" Model

Bytecode is the AST, flattened into a line via post-order traversal, with the operand stack standing in for the tree structure. To compile any expression node, compile its children first (emitting their instructions), then emit the operator instruction — the same post-order discipline as the tree-walker, except now you *emit instructions* instead of *computing values*. The stack at runtime re-creates the nesting the tree used to express.

### The "Resolve Once, Run Many" Model

The big win of bytecode is *moving work from runtime to compile time*. String names become integer slots and pool indices. Tree structure becomes a flat array. Branch decisions become jump offsets. The compiler pays these costs **once**; the loop then runs cheap, pre-resolved instructions **many** times. Whenever you wonder "why is this faster?", the answer is usually "because that work was done ahead of time, not on every iteration."

---

## Code Examples

We will build a complete **compiler + stack-based VM** for the same calculator-with-variables language from `junior.md`. The compiler turns an AST into bytecode; the VM runs it.

### Python — bytecode compiler and VM

```python
# ---------- Opcodes ----------
CONST       = 0   # operand: index into constant pool;  push constants[i]
LOAD_LOCAL  = 1   # operand: slot;                       push locals[slot]
STORE_LOCAL = 2   # operand: slot;                       locals[slot] = pop()
ADD         = 3
SUB         = 4
MUL         = 5
DIV         = 6
PRINT       = 7
JUMP        = 8   # operand: target IP
JUMP_IF_FALSE = 9 # operand: target IP;  pops condition
HALT        = 10

# ---------- AST (same shapes as junior.md) ----------
class Num:    
    def __init__(self, v): self.v = v
class Var:    
    def __init__(self, name): self.name = name
class BinOp:  
    def __init__(self, op, l, r): self.op, self.l, self.r = op, l, r
class Assign: 
    def __init__(self, name, expr): self.name, self.expr = name, expr
class Print:  
    def __init__(self, expr): self.expr = expr


# ---------- Compiler: AST -> bytecode ----------
class Compiler:
    def __init__(self):
        self.code = []         # flat list of ints (opcodes + operands)
        self.constants = []    # constant pool
        self.slots = {}        # name -> integer slot  (resolved at compile time!)

    def const_index(self, value):
        if value in self.constants:
            return self.constants.index(value)
        self.constants.append(value)
        return len(self.constants) - 1

    def slot_for(self, name):
        if name not in self.slots:
            self.slots[name] = len(self.slots)   # assign next slot
        return self.slots[name]

    def emit(self, *bytes_):
        self.code.extend(bytes_)

    def compile_expr(self, node):
        if isinstance(node, Num):
            self.emit(CONST, self.const_index(node.v))
        elif isinstance(node, Var):
            self.emit(LOAD_LOCAL, self.slot_for(node.name))
        elif isinstance(node, BinOp):
            self.compile_expr(node.l)        # children first (post-order)
            self.compile_expr(node.r)
            self.emit({'+': ADD, '-': SUB, '*': MUL, '/': DIV}[node.op])
        else:
            raise TypeError(f"cannot compile expr {node}")

    def compile_stmt(self, node):
        if isinstance(node, Assign):
            self.compile_expr(node.expr)
            self.emit(STORE_LOCAL, self.slot_for(node.name))
        elif isinstance(node, Print):
            self.compile_expr(node.expr)
            self.emit(PRINT)
        else:
            raise TypeError(f"cannot compile stmt {node}")

    def compile_program(self, statements):
        for s in statements:
            self.compile_stmt(s)
        self.emit(HALT)
        return self.code, self.constants, len(self.slots)


# ---------- VM: run the bytecode ----------
def run(code, constants, num_slots):
    stack = []
    locals_ = [None] * num_slots
    ip = 0
    while True:
        op = code[ip]; ip += 1                 # FETCH
        if op == CONST:                         # DECODE + EXECUTE
            stack.append(constants[code[ip]]); ip += 1
        elif op == LOAD_LOCAL:
            stack.append(locals_[code[ip]]); ip += 1
        elif op == STORE_LOCAL:
            locals_[code[ip]] = stack.pop(); ip += 1
        elif op == ADD:
            b = stack.pop(); a = stack.pop(); stack.append(a + b)
        elif op == SUB:
            b = stack.pop(); a = stack.pop(); stack.append(a - b)
        elif op == MUL:
            b = stack.pop(); a = stack.pop(); stack.append(a * b)
        elif op == DIV:
            b = stack.pop(); a = stack.pop()
            if b == 0: raise ZeroDivisionError("division by zero")
            stack.append(a / b)
        elif op == PRINT:
            print(stack.pop())
        elif op == JUMP:
            ip = code[ip]
        elif op == JUMP_IF_FALSE:
            target = code[ip]; ip += 1
            if not stack.pop():
                ip = target
        elif op == HALT:
            return
        else:
            raise RuntimeError(f"bad opcode {op}")


# ---------- Run: x = 2 + 3 * 4; print(x) ----------
program = [
    Assign("x", BinOp('+', Num(2), BinOp('*', Num(3), Num(4)))),
    Print(Var("x")),
]
code, constants, nslots = Compiler().compile_program(program)
run(code, constants, nslots)   # prints: 14
```

The variable `x` was resolved to slot `0` at compile time. At runtime, `LOAD_LOCAL 0` is a bare array index — no string, no hash. That is the whole point.

### Disassembling our own bytecode

A disassembler makes the byte array readable — invaluable for debugging:

```python
NAMES = {0:"CONST",1:"LOAD_LOCAL",2:"STORE_LOCAL",3:"ADD",4:"SUB",
         5:"MUL",6:"DIV",7:"PRINT",8:"JUMP",9:"JUMP_IF_FALSE",10:"HALT"}
HAS_OPERAND = {0,1,2,8,9}

def disassemble(code):
    ip = 0
    while ip < len(code):
        op = code[ip]
        if op in HAS_OPERAND:
            print(f"{ip:4} {NAMES[op]:14} {code[ip+1]}")
            ip += 2
        else:
            print(f"{ip:4} {NAMES[op]}")
            ip += 1

# For x = 2 + 3 * 4; print(x):
#   0 CONST          0
#   2 CONST          1
#   4 CONST          2
#   6 MUL
#   7 ADD
#   8 STORE_LOCAL    0
#  10 LOAD_LOCAL     0
#  12 PRINT
#  13 HALT
```

### Compiling control flow with backpatching

`if`/`while` need jumps whose targets are not known until later. The compiler emits a placeholder, remembers its position, then patches it:

```python
def compile_while(self, cond, body):
    loop_start = len(self.code)
    self.compile_expr(cond)
    self.emit(JUMP_IF_FALSE, 0)        # placeholder target
    exit_patch = len(self.code) - 1    # remember where the operand is
    for s in body:
        self.compile_stmt(s)
    self.emit(JUMP, loop_start)        # jump back to re-test condition
    self.code[exit_patch] = len(self.code)   # backpatch the exit target
```

This is exactly how real compilers emit loops: forward jumps are patched once the destination is reached.

### A register-style instruction, for contrast

To see the stack-vs-register difference, here is how `x = b + c` looks in each style:

```text
  Stack-based (CPython-like):        Register-based (Lua-like):
    LOAD_LOCAL  1   (b)                ADD  r0, r1, r2   ; r0 = r1 + r2
    LOAD_LOCAL  2   (c)                                  ; (x in r0, b in r1, c in r2)
    ADD
    STORE_LOCAL 0   (x)
```

The register VM does it in **one** instruction instead of four, with no push/pop traffic — at the cost of a more complex compiler that must allocate registers. This is a core reason Lua is so fast.

---

## Pros & Cons

| Aspect | Pros | Cons |
|--------|------|------|
| **Runtime speed** | Often ~10× faster than a naive tree-walker: cache-friendly flat code, integer dispatch, pre-resolved names. | Still far slower than native code; the dispatch loop overhead remains (addressed by JIT later). |
| **Build complexity** | Architecture is well understood; the loop is simple. | Two phases (compiler + VM) instead of one; more code than a tree-walker. |
| **Variable access** | Locals as array slots = O(1), no hashing. CPython's `LOAD_FAST`. | Requires a compile-time pass to assign slots; closures/upvalues add complexity (see `senior.md`). |
| **Portability** | Bytecode is platform-independent; ship `.pyc`/`.class` files. | Bytecode format becomes a compatibility surface you must version. |
| **Tooling** | Disassembler, bytecode caching, profilers at opcode granularity. | More moving parts to debug; a compiler bug and a VM bug look similar. |
| **Startup** | Cache compiled bytecode to skip recompilation (Python's `__pycache__`). | First-run compile cost; cold start pays for the compile phase. |
| **Optimization** | Bytecode is a clean target for peephole optimization, superinstructions, and eventually a JIT. | Optimizing the bytecode is a whole sub-discipline. |

---

## Use Cases

A bytecode interpreter is the right tool when:

- **You are building a production dynamic language** where runtime speed matters but you do not want the complexity/portability cost of native compilation. This is where CPython, Ruby, Lua, and the JVM live.
- **You want portable, cacheable compiled artifacts** (`.pyc`, `.class`, Lua chunks) that load fast and run anywhere the VM runs.
- **You have hot loops** that a tree-walker would choke on, but a full JIT is overkill or too complex.
- **You want a clean platform for further optimization** (peephole passes, superinstructions, inline caches, and eventually a JIT) — bytecode is the standard substrate.

It is the **wrong** tool (or not yet needed) when:

- You are prototyping or teaching — start with a tree-walker (`junior.md`); bytecode is premature.
- The language runs so briefly that the compile phase dominates and the speedup never pays off.
- You need near-native performance on numeric kernels — you will ultimately want a JIT (`senior.md`/`professional.md`) or ahead-of-time compilation.

---

## Coding Patterns

### Pattern 1: Two-pass shape — compile to bytecode, then loop

Keep the compiler (AST → bytecode) and the VM (bytecode → result) cleanly separated. The compiler is recursive and post-order; the VM is one flat loop. Do not interleave them.

### Pattern 2: Constant pool with deduplication

Store literals once in a pool and reference by index. Deduplicate so `2 + 2` reuses one entry. Bytecode carries small integer indices, not big values.

```python
def const_index(self, value):
    if value in self.constants: return self.constants.index(value)
    self.constants.append(value); return len(self.constants) - 1
```

### Pattern 3: Resolve names to slots at compile time

Walk the function once, assign each local an integer slot, and compile reads/writes to `LOAD_LOCAL slot` / `STORE_LOCAL slot`. Never hash a variable name at runtime in the hot path.

### Pattern 4: Emit-placeholder-then-backpatch for jumps

For forward branches, emit the jump with a dummy target, record the operand's position, and overwrite it once you know the destination. This is the standard way to compile `if`, `while`, `break`, and `&&`/`||`.

### Pattern 5: A `case` per opcode, smallest possible bodies

Keep each opcode's handler tiny and side-effect-focused. The smaller and more uniform the cases, the better the loop performs and the easier `senior.md`'s computed-goto rewrite becomes.

### Pattern 6: Build the disassembler alongside the compiler

A disassembler is your eyes inside the VM. Write it early; it makes every "why is my output wrong?" question a five-second read of the instruction stream.

---

## Best Practices

- **Keep the operand stack discipline exact.** Every opcode must leave the stack at the height its compiler assumed. A push/pop imbalance is the most common VM bug; assert stack depth in debug builds.
- **Resolve everything you can at compile time.** Slots, constant indices, jump targets — anything moved out of the loop is a permanent win on every iteration.
- **Make `HALT`/return explicit.** End every code stream with a terminating opcode so the loop has a defined exit, rather than running off the end of the array.
- **Validate opcodes in debug, trust them in release.** A `default: error` case catches compiler bugs during development; you can drop the check in optimized builds.
- **Cache compiled bytecode** if compilation is non-trivial and programs run repeatedly (Python's `__pycache__` is the model).
- **Test the compiler and VM separately.** Snapshot-test the bytecode the compiler emits, and unit-test the VM on hand-written bytecode. Bugs localize instantly.
- **Measure before micro-optimizing the loop.** The big win is *being* a bytecode VM at all; exotic dispatch (`senior.md`) is a second-order gain — profile first.

---

## Edge Cases & Pitfalls

- **Stack imbalance.** If an opcode pops the wrong number of values, or a branch skips a push, the stack drifts and later instructions read garbage. Track expected stack depth per instruction.
- **Jump targets off by one.** Forgetting that the operand follows the opcode (so the next instruction is at `ip+2`, not `ip+1`) corrupts all your jump math. Be precise about operand widths.
- **Forgetting to backpatch.** A placeholder jump target left as `0` sends control to the start of the program. Always patch before finishing compilation.
- **Sharing one constant pool index for different values.** Deduplication must compare values correctly; using `==` where you need identity (or vice versa) merges or splits constants wrongly.
- **Slot collisions across scopes.** A naive slot allocator that reuses indices across nested blocks/functions corrupts variables. Each function frame needs its own locals array (closures/upvalues are `senior.md`).
- **Integer vs float operand confusion in the loop.** Reading an operand byte as a value, or a value as an operand, produces wild results. Keep a clear map of which opcodes have operands.
- **Running off the end of the bytecode.** Without a terminating `HALT`/`RETURN`, the IP increments past the array and crashes (or worse, reads stale memory in a low-level VM).
- **Tail of a `JUMP_IF_FALSE` mispredicted.** Conditional jumps are where branch prediction hurts; this is *correct* but slow, and is exactly what `senior.md`'s dispatch techniques attack.

---

## Test Yourself

1. Compile `(1 + 2) * (3 + 4)` to stack bytecode by hand. List the opcodes in order and show the operand stack after each one.
2. Why is `LOAD_FAST 0` faster than the tree-walker's `env["x"]`? Name the two runtime costs that disappear.
3. In CPython, locals use `LOAD_FAST` and globals use `LOAD_GLOBAL`. Based on this page, explain in one sentence why locals are faster.
4. Hand-write the bytecode for `while x { x = x - 1 }` using `JUMP` and `JUMP_IF_FALSE`. Where are the two jump targets, and which one is patched after the body is compiled?
5. Convert the stack-based bytecode for `a = b + c` into register-based form. How many instructions does each use? Why might the register version be faster?
6. Add a `NEG` opcode to the example VM (unary minus). What does it pop and push, and where in the compiler do you emit it?
7. Run the disassembler on `print(2 * 3 + 4)`. Predict the output before reading it, then verify by tracing the VM.
8. The VM's stack ends a program non-empty. Name two compiler bugs that could cause this and how you would detect them.

---

## Cheat Sheet

```text
┌──────────────────────────────────────────────────────────────────┐
│                    BYTECODE INTERPRETER                           │
├──────────────────────────────────────────────────────────────────┤
│ TWO PHASES:                                                       │
│   compile:  AST  ->  bytecode + constant pool   (once)            │
│   run:      bytecode  ->  result                (the VM loop)     │
├──────────────────────────────────────────────────────────────────┤
│ THE LOOP (fetch-decode-execute):                                  │
│   while true:                                                     │
│     op = code[ip]; ip++          # FETCH                          │
│     switch op:                   # DECODE                         │
│       CONST i       -> push(constants[i])      # EXECUTE          │
│       ADD           -> b=pop; a=pop; push(a+b)                    │
│       LOAD_LOCAL s  -> push(locals[s])                            │
│       STORE_LOCAL s -> locals[s] = pop                            │
│       JUMP t        -> ip = t                                     │
│       JUMP_IF_FALSE t-> if !pop: ip = t                           │
│       HALT          -> return                                     │
├──────────────────────────────────────────────────────────────────┤
│ KEY WINS over tree-walking:                                       │
│   * flat array  = cache-friendly (no pointer chasing)            │
│   * integer dispatch = one switch (no node-type guessing)        │
│   * locals = ARRAY slot, not hashmap  (CPython LOAD_FAST)        │
│   * constants pre-pooled, names pre-resolved (compile-time work) │
├──────────────────────────────────────────────────────────────────┤
│ STACK-BASED (CPython,JVM,YARV): operands on operand stack         │
│ REGISTER-BASED (Lua 5+, Dalvik): operands in numbered registers   │
│   -> register VM: fewer, fatter instructions (often faster)      │
├──────────────────────────────────────────────────────────────────┤
│ Control flow = JUMPs that move the IP (backpatch forward jumps)   │
│ Next: faster DISPATCH (computed goto, threading) -> senior.md     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Summary

- Production interpreters do not walk trees at runtime — they **compile the AST to bytecode** once, then run a tight **fetch–decode–execute loop** over that flat instruction array. CPython, Ruby's YARV, Lua, and the JVM all work this way.
- Bytecode is faster than tree-walking because it is **cache-friendly** (flat, contiguous), uses **integer dispatch** (one `switch`, no node-type guessing), and has **pre-resolved** constants and variable slots (work moved from runtime to compile time).
- In a **stack-based VM**, intermediate values live on an **operand stack**; instructions push and pop. `2 + 3 * 4` flattens (post-order) to `CONST; CONST; CONST; MUL; ADD`.
- **Locals are stored in an array, indexed by integer slot — not in a hash map.** This is why CPython's local-variable access (`LOAD_FAST`) is faster than global access (`LOAD_GLOBAL`): the name was resolved to a slot at compile time.
- **Control flow** uses **jumps** that move the instruction pointer; forward jumps are **backpatched** once their target is known.
- **Register-based VMs** (Lua 5+) use numbered registers instead of a stack, executing fewer, fatter instructions — a key reason for Lua's speed.
- A **disassembler** (like Python's `dis`) turns the opaque byte array back into readable instructions and is the most valuable debugging tool you can build.
- Build a tree-walker first (`junior.md`), then move to bytecode when speed demands it. The next step beyond bytecode is faster **dispatch** and the path to a **JIT** — covered in `senior.md`.

---

## What You Can Build

- **A bytecode compiler + VM for your junior-level language.** Reuse the AST; emit bytecode; run it. Compare runtime against the tree-walker on a hot loop.
- **A disassembler** for your VM that prints labeled instructions with operands and jump targets — your in-house `dis`.
- **A stack-machine calculator** that compiles infix expressions to RPN-style bytecode and executes them.
- **A bytecode optimizer (peephole pass).** Fold constant arithmetic (`CONST 2; CONST 3; ADD` → `CONST 5`) and remove redundant loads. Measure the speedup.
- **A side-by-side benchmark harness.** Run the same program through the tree-walker and the bytecode VM; chart the speedup as loop iteration count grows.
- **A mini Python-bytecode reader.** Use `dis` and `marshal` to load a `.pyc` and walk its real opcodes — see the concepts on this page in the language you use daily.

---

## Further Reading

- *Crafting Interpreters* — Robert Nystrom. Part III ("A Bytecode Virtual Machine") builds exactly this architecture in C, with a stack-based VM. The single best resource for this level. https://craftinginterpreters.com/
- *Writing A Compiler In Go* — Thorsten Ball. The sequel to his interpreter book; compiles the Monkey AST to bytecode and runs it on a stack VM.
- *The Implementation of Lua 5.0* — Ierusalimschy, de Figueiredo, Celes. The classic paper on why Lua's register-based VM is fast. https://www.lua.org/doc/jucs05.pdf
- CPython source: `Python/ceval.c` (the eval loop) and the `dis` module documentation. https://docs.python.org/3/library/dis.html
- *The Java Virtual Machine Specification* — the canonical stack-based bytecode VM, formally specified.
- *Virtual Machines* — Iain Craig. A book-length treatment of VM design, stack vs register, and dispatch.
