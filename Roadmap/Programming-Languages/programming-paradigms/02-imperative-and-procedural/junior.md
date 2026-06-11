# Imperative & Procedural — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Imperative & Procedural
> *A program is a list of commands that change the machine's memory, one step at a time — this is the paradigm hiding inside almost every line of code you've ever written.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Statements Change State](#core-concept-1--statements-change-state)
5. [Core Concept 2 — Control Flow: Sequence, Selection, Iteration](#core-concept-2--control-flow-sequence-selection-iteration)
6. [Core Concept 3 — Statements vs Expressions](#core-concept-3--statements-vs-expressions)
7. [Core Concept 4 — Procedures: Naming a Block of Steps](#core-concept-4--procedures-naming-a-block-of-steps)
8. [Core Concept 5 — The Call Stack, Gently](#core-concept-5--the-call-stack-gently)
9. [Why It's Called "Imperative"](#why-its-called-imperative)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

You have almost certainly written imperative code today. If you've ever written this:

```python
total = 0
for n in numbers:
    total += n
print(total)
```

…you wrote four **commands** and the computer obeyed them **in order**: make a box called `total` holding `0`; then, repeatedly, change that box; then print it. That is the **imperative paradigm** in one sentence:

> **A program is a sequence of statements that change the program's state, with control flow you write explicitly.**

The word *imperative* comes from grammar — the *imperative mood* is the commanding voice: "Do this. Then do that." That's exactly what this code is: a list of orders. The **procedural** paradigm is one step up — it's imperative code organized into named, reusable blocks of steps called **procedures** (what most languages now call functions).

Why does this matter when you already write it instinctively? Because imperative is the **substrate** — the ground floor that almost every other paradigm is built on top of. A SQL engine is imperative C underneath. A functional `map` runs an imperative loop you never see. Your CPU itself only understands imperative instructions: load, add, store, jump. Understanding this paradigm clearly means understanding what your code *actually does to the machine* — which is the foundation for everything in this roadmap.

> **The mindset shift:** stop seeing your loops and assignments as "just how you write code," and start seeing them as one specific paradigm — *commands that mutate state over time* — with its own strengths (total control, predictable performance) and its own dangers (every variable can change under you).

---

## Prerequisites

- **Required:** You can write variables, `if` statements, and loops in at least one language. Examples use **Python**, **C**, and a little **Go**.
- **Required:** You've written a loop that builds up a result (a sum, a counter, a filtered list).
- **Helpful:** You've called a function you wrote yourself and passed it an argument.
- **Helpful:** You've read [01 — Overview & Taxonomy](../01-overview-and-taxonomy/junior.md), which places this paradigm on the imperative ↔ declarative spectrum.
- **Not required:** Any assembly, hardware, or compiler knowledge — we build the small amount we need from scratch.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Imperative** | A paradigm where the program is a sequence of **statements** that change state. You write *how*, step by step. |
| **Procedural** | Imperative code organized into named **procedures** (subroutines/functions) that you call and reuse. |
| **Statement** | A command that *does something* — assign, branch, loop, call. It changes state; it doesn't (usually) produce a value. |
| **Expression** | A piece of code that *produces a value* — `2 + 2`, `x * y`, `f(3)`. |
| **State** | All the data the program can read and change as it runs — the current values of every variable. |
| **Variable** | A named, mutable **cell** in memory. The name stays; the value inside can change. |
| **Assignment** | Putting a new value into a variable's cell (`x = 5`). The core imperative operation. |
| **Control flow** | The order in which statements run — straight through, branching, or looping. |
| **Mutation** | Changing a value that already exists (overwriting a variable, editing a list in place). |
| **Procedure / subroutine / function** | A named, reusable block of statements you can call with arguments. |
| **Call stack** | The runtime's record of which procedures are currently running and where to return. |
| **Side effect** | Any change a statement makes to the world outside computing a value — writing a variable, printing, touching a file. |

> The two words to lock in now: **statement** (a command that changes state) and **state** (the current value of everything). Imperative programming is the art of arranging statements so that state ends up the way you want.

---

## Core Concept 1 — Statements Change State

Think of your program's memory as a wall of labeled boxes. Each **variable** is one box: the label is the name, and inside is the current value. **State** is the contents of all the boxes right now.

An imperative program runs by executing **statements**, and the most important kind of statement is **assignment** — it opens a box and puts a new value in:

```python
score = 0        # box "score" now holds 0
score = score + 10   # read the box (0), add 10, put 10 back
score = score + 5    # read the box (10), add 5, put 15 back
print(score)         # 15
```

Read that middle line carefully, because it is the heart of the paradigm and it confuses every beginner once:

```python
score = score + 10
```

This is **not** the math equation "score equals score plus 10" (which would be nonsense). It's a **command**: *take the current value out of the box, add 10, and put the result back into the same box.* The `=` is not "equals" — it's "becomes." Many languages would honestly write it `score := score + 10` ("score becomes score+10") to avoid the confusion.

That single idea — **a named box whose contents you can overwrite** — is what makes code imperative. The value of `score` *depends on when you look*. Before line 2 it's `0`; after, it's `10`. **State changes over time**, and the whole program is a script for changing it.

```
TIME →
        score
  start:  ?        (box exists, no value yet)
  line1:  0        score = 0
  line2:  10       score = score + 10
  line3:  15       score = score + 5
```

This "value depends on when you look" property is exactly what makes imperative code powerful (you can accumulate, count, and update in place) *and* exactly what makes it tricky (to know what `score` is, you have to know everything that happened before).

---

## Core Concept 2 — Control Flow: Sequence, Selection, Iteration

If a program were *only* a list of statements run top to bottom, it could do very little. The power comes from **control flow** — deciding *which* statements run and *how many times*. There are exactly three building blocks, and remarkably, every imperative program is built from just these three:

### 1. Sequence — do this, then that

The default. Statements run in the order they're written, top to bottom.

```c
int x = 2;        // first
int y = x + 3;    // then  (y is 5, because x is already 2)
int z = y * 10;   // then  (z is 50)
```

Order matters absolutely. Swap line 1 and line 2 and `y` reads `x` before it has a value. Sequence is *time made visible*: earlier lines have already changed state by the time later lines run.

### 2. Selection — choose a path (`if` / `else` / `switch`)

Run some statements only when a condition holds.

```python
if temperature > 30:
    status = "hot"
elif temperature < 10:
    status = "cold"
else:
    status = "mild"
```

The program **branches**: it picks exactly one path based on the current state, then continues. Selection is how a program makes decisions.

### 3. Iteration — repeat (`while` / `for`)

Run a block of statements over and over, usually until a condition stops being true.

```python
# while: repeat as long as a condition holds
n = 5
factorial = 1
while n > 1:
    factorial = factorial * n   # change state...
    n = n - 1                   # ...and move toward stopping
print(factorial)                # 120
```

```python
# for: repeat once per item, the everyday workhorse
total = 0
for n in [4, 8, 15, 16, 23, 42]:
    total += n
print(total)   # 108
```

A loop has three jobs you must always get right: **initialize** state before it (`total = 0`), **change** state inside it (`total += n`), and **make progress toward stopping** (`n = n - 1`, or running out of items). Forget the third and the loop runs forever.

> **The big claim:** *sequence, selection, and iteration are enough to express any computation.* This is the **structured programming** result — you'll meet it formally in [`middle.md`](middle.md). For now, the takeaway is that these three control-flow shapes are the complete toolkit. Everything else (`break`, `continue`, early `return`) is convenience layered on top.

```
CONTROL FLOW = the three shapes

  SEQUENCE        SELECTION           ITERATION
  ┌───┐           ┌───┐               ┌───┐
  │ A │           │ ? │──no──┐      ┌►│ ? │──no──► out
  └─┬─┘           └─┬─┘      │      │ └─┬─┘
  ┌─▼─┐           yes│       │      │ yes│
  │ B │           ┌──▼─┐  ┌──▼─┐    │  ┌─▼─┐
  └─┬─┘           │ X  │  │ Y  │    └──┤ B │
  ┌─▼─┐           └────┘  └────┘       └───┘
  │ C │
  └───┘
```

---

## Core Concept 3 — Statements vs Expressions

This distinction is small but it sharpens everything else. Two kinds of code fragments:

- An **expression** *produces a value*. You can ask "what does it evaluate to?" — `2 + 2` → `4`, `len(name)` → `5`, `x > 0` → `True`.
- A **statement** *does something* — it changes state or controls flow. You ask "what does it *do*?", not "what is it?"

```python
# expressions — each HAS a value
3 * 4              # 12
"hi" + " there"    # "hi there"
n % 2 == 0         # True or False

# statements — each DOES something
x = 12             # assignment: change state (no value)
if n % 2 == 0:     # selection: choose a path
    print("even")  # call: produce a side effect (printing)
while n > 0:       # iteration: repeat
    n -= 1
```

Imperative languages are **statement-centric**: a program is fundamentally a list of statements, and expressions appear *inside* them (the condition of an `if`, the right-hand side of an `=`). This is the deep contrast with the functional paradigm, which is **expression-centric** — there, a program is one big expression that evaluates to a value, and "doing something" (mutating, printing) is the exception rather than the rule.

> **Quick test:** can you put it on the right of an `=`? `x = (3 * 4)` works → `3 * 4` is an expression. `x = (if y: ...)` is illegal in Python → `if` is a statement. (Some languages blur this line — Rust and Kotlin make `if` an expression — but the imperative *mindset* is statements-do, expressions-are.)

---

## Core Concept 4 — Procedures: Naming a Block of Steps

So far everything has been one long script. That doesn't scale: copy-pasting the same five lines in ten places is a maintenance nightmare. The fix is the **procedure** — a named block of statements you define once and **call** by name as many times as you like. This is the move from *imperative* to *procedural*.

```c
// C — a procedure that does steps, takes input, returns a result
int max(int a, int b) {
    if (a > b)
        return a;
    return b;
}

int main(void) {
    int big = max(7, 3);     // CALL max with 7 and 3 → big is 7
    int bigger = max(big, 9); // CALL it again, reusing the same steps → 9
    return 0;
}
```

Three things a procedure gives you:

1. **Reuse** — write the steps once, call them everywhere. `max` is defined once and used twice.
2. **Naming** — `max(7, 3)` reads as its *intent*. The reader doesn't need to see the `if` inside; the name tells the story. This is abstraction: hiding *how* behind a *what*.
3. **Parameters** — the procedure works on whatever you pass it. `a` and `b` are **parameters** (the names in the definition); `7` and `3` are **arguments** (the actual values you pass at the call).

```python
# Python — same idea: package steps, give them a name, reuse them
def greet(name, times):
    for _ in range(times):
        print(f"Hello, {name}!")

greet("Ada", 2)   # the three lines of logic, reused with new arguments
greet("Linus", 1)
```

> **Procedural = imperative + organization.** The statements and state are the same; the win is structure. Instead of one 500-line script, you get fifty 10-line procedures with clear names — far easier to read, test, and change. This is the same instinct behind the entire [Clean Code → Functions](../../code-craft/clean-code/) discipline.

A note on vocabulary: historically a **procedure** did steps without returning a value, and a **function** returned one (like math). Today almost everyone says **function** for both. When this roadmap says "procedural," it means *imperative code organized into named, callable, parameterized blocks* — regardless of whether they return anything.

---

## Core Concept 5 — The Call Stack, Gently

When `main` calls `max`, the computer has to remember something: *where was I, so I can come back?* It does this with the **call stack** — a stack of "I-was-here" notes, one per running procedure.

Walk through it slowly:

```python
def square(x):
    return x * x

def sum_of_squares(a, b):
    return square(a) + square(b)   # calls square twice

result = sum_of_squares(3, 4)      # → 25
```

Here's what the stack does, step by step:

```
1. main calls sum_of_squares(3,4)
   STACK:  [ sum_of_squares: a=3, b=4 ]          ← top is what's running now

2. sum_of_squares calls square(3)
   STACK:  [ sum_of_squares ]
           [ square: x=3       ]  ← pushed on top

3. square(3) returns 9 → its note is popped off
   STACK:  [ sum_of_squares ]     ← back to where we were, now we have 9

4. sum_of_squares calls square(4)
   STACK:  [ sum_of_squares ]
           [ square: x=4       ]  ← pushed again

5. square(4) returns 16 → popped
   STACK:  [ sum_of_squares ]     ← now compute 9 + 16 = 25

6. sum_of_squares returns 25 → popped
   STACK:  [ ]                    ← back in main, result = 25
```

Each note on the stack is called a **stack frame** (or "activation record"). A frame holds that call's own local variables and parameters, plus the return address ("come back to *here*"). Three things to take away now:

- **Calls push; returns pop.** The stack grows when you call a procedure and shrinks when it returns. Last in, first out — exactly like a stack of plates.
- **Each call gets its own frame.** When `square` runs twice, each call has its *own* `x`. They don't interfere. This is why local variables are private to each call.
- **The stack is finite.** If procedures keep calling without returning — most commonly infinite recursion — the stack grows until it runs out of room: **stack overflow**. That's literally what the famous error (and the famous website) is named after.

You don't manage the stack by hand — the language runtime does it automatically on every call and return. But knowing it's there explains local-variable privacy, recursion, stack traces in error messages, and the `RecursionError` / `StackOverflowError` you'll eventually hit. The full mechanics — frames, registers, the heap — are in [`middle.md`](middle.md).

---

## Why It's Called "Imperative"

A short detour that makes the name click. Computers built on the **von Neumann architecture** (which is essentially all of them) work like this: a program is a list of **instructions** sitting in memory, and the CPU has a **program counter** that points at "the instruction I'm running now." The CPU repeats one simple loop forever:

```
1. fetch the instruction the program counter points to
2. execute it (load a value, add, store a result, or jump elsewhere)
3. advance the program counter to the next instruction
4. go to step 1
```

Look at what those instructions *are*: load a value into a register, add two registers, store a register back to memory, jump to another instruction. That's **assignment, sequence, and control flow** — the exact building blocks of imperative programming. The paradigm is called imperative because it *mirrors the machine*: your `x = x + 1` compiles down to "load x, add 1, store x," and your `while` compiles down to a conditional **jump** back to an earlier instruction.

```
your code            roughly becomes (pseudo-assembly)
─────────            ─────────────────────────────────
x = x + 1            LOAD  r1, x
                     ADD   r1, 1
                     STORE x, r1

while x > 0:         loop: LOAD  r1, x
    x = x - 1              JLE   r1, 0, done    ; jump out if x <= 0
                          ...body...
                          JMP   loop           ; jump back up
                     done: ...
```

This is the deep reason imperative is the *substrate*: it's the paradigm closest to what the hardware actually does, so everything else is ultimately translated into it. When [01 — Overview & Taxonomy](../01-overview-and-taxonomy/junior.md) said "declarative is hidden imperative," *this* is what's hidden underneath.

---

## Real-World Examples

| Thing you've used | The imperative/procedural shape inside it |
|---|---|
| A `for` loop summing a list | The textbook imperative pattern: init, mutate, repeat |
| A game's update loop moving sprites every frame | Mutate position/velocity state 60×/second — imperative to the core |
| A function you wrote with parameters and a `return` | A procedure: named, reusable, parameterized steps |
| A C program controlling a microcontroller | Procedural C is *the* language of embedded and drivers |
| A shell script (`bash`) | Imperative top-to-bottom: do this command, then that |
| An installer's progress bar updating | State (`percent_done`) mutated step by step |
| The inside of almost every method, in any language | Even OOP and FP code is imperative *inside* a method/function body |

The last row is the key insight: **imperative isn't a niche style you opt into — it's what's inside the bodies.** You can write object-oriented code (objects calling methods) or functional code (`map`/`filter`), but step inside any single method and you'll usually find imperative statements: assignments, `if`s, loops. The paradigm you "live in" is imperative far more often than you realize.

---

## Mental Models

- **The recipe.** An imperative program is a cooking recipe: a numbered list of steps performed in order, each changing the state of the dish ("now the bowl contains flour; now it contains flour *and* eggs"). The bowl is your program's memory; each step mutates it.
- **Boxes you overwrite.** A variable is a labeled box. Assignment opens the box and replaces what's inside. To know what's in a box *now*, you have to replay every step that touched it. That replaying is the cost of mutable state — and the reason imperative bugs can be hard to find.
- **The conveyor belt with a program counter.** The CPU is a worker reading one instruction card at a time off a belt, doing it, then sliding to the next card — unless a card says "jump back to card 7." Loops and `if`s are just those jump-cards.
- **Procedures are labeled sub-recipes.** "Make the sauce" is a named sub-recipe you can call from many dishes without rewriting it. Calling it = pausing the main recipe, doing the sub-recipe, then resuming exactly where you left off. The "where you left off" bookmark is the call stack.

---

## Common Mistakes

- **Reading `=` as "equals" instead of "becomes."** `x = x + 1` is not a contradiction; it's the command "put `x+1` back into `x`." Mis-reading this is the root of most beginner confusion about loops and counters.
- **Forgetting to make a loop progress toward stopping.** Every loop needs something that changes each pass and eventually fails the condition. Forget it and you get an infinite loop (`while x > 0:` with nothing decrementing `x`).
- **Reading a variable before it has a value.** Because order is everything in imperative code, using `y` on a line *above* where `y` is assigned is a real bug (in C, undefined behavior; in Python, a `NameError`).
- **Confusing parameters with arguments.** *Parameters* are the names in the definition (`def f(a, b)`); *arguments* are the values you pass (`f(7, 3)`). Mixing the words up is harmless; misunderstanding that each call binds its own copy is not.
- **Assuming a function's local variables are shared between calls.** Each call gets its own stack frame and its own locals. Two calls to `square` don't share `x`. Expecting them to is a classic confusion.
- **Mutating shared state without realizing it.** When two parts of the program both change the same variable (or the same list), a change in one place silently affects the other. This is the central hazard of the paradigm, and it's covered in depth in [`senior.md`](senior.md).

---

## Test Yourself

1. In your own words: what *is* an imperative program? Use the words "statement" and "state."
2. What does `count = count + 1` actually command the computer to do? Why is it not a math equation?
3. Name the three control-flow building blocks. What does each one let you do?
4. What's the difference between a **statement** and an **expression**? Give one example of each.
5. What does turning imperative code into procedural code buy you? Name two benefits.
6. When `f` calls `g`, what gets pushed onto the call stack, and what happens to it when `g` returns?
7. Why is this paradigm called "imperative," and why is it considered the *substrate* most other paradigms rest on?

> Try each before reading on. If #6 is fuzzy, re-walk the [call-stack trace](#core-concept-5--the-call-stack-gently); if #4 is fuzzy, re-read [Statements vs Expressions](#core-concept-3--statements-vs-expressions).

---

## Cheat Sheet

```
IMPERATIVE = a program is a SEQUENCE OF STATEMENTS that change STATE.
PROCEDURAL = imperative code organized into named, reusable PROCEDURES.

THE CORE OPERATION:
  assignment   x = expr     "put expr's value INTO box x"   ( = means "becomes")
  state        = the current contents of all the boxes
  mutation     = overwriting a box that already has a value

CONTROL FLOW — exactly three shapes (enough for any program):
  sequence     do A, then B, then C        (order matters!)
  selection    if / elif / else            (choose a path)
  iteration    while / for                 (repeat: init → change → progress to stop)

STATEMENT vs EXPRESSION:
  expression   produces a VALUE     2+2, len(x), n>0
  statement    DOES something       x=5, if..., while..., f()

PROCEDURES:
  define once   def f(a, b): ...     a,b = PARAMETERS
  call many     f(7, 3)              7,3 = ARGUMENTS
  buys you      reuse + naming(abstraction) + parameterization

CALL STACK:
  call → push a frame (locals + return address);  return → pop it
  each call gets its OWN frame & locals;  too many calls → stack overflow

WHY "IMPERATIVE": it mirrors the CPU — load, add, store, jump.
  → it's the SUBSTRATE: declarative/FP/OOP all compile down to it.
```

---

## Summary

The **imperative paradigm** says a program is a **sequence of statements that change state**. Its core operation is **assignment** — overwriting a named box (a variable), where `=` means "becomes," not "equals." State is the current value of everything, and because state changes over time, a variable's value depends on *when* you look at it. **Control flow** — which statements run and how often — is built from exactly three shapes: **sequence**, **selection** (`if`), and **iteration** (`while`/`for`), and those three alone can express any computation. **Statements** *do* things; **expressions** *are* values — and imperative languages are statement-centric, the deep contrast with the expression-centric functional style. The **procedural** paradigm organizes imperative code into named, parameterized, reusable **procedures**, bought with the help of the **call stack** that remembers where to return. Finally, imperative is called imperative because it *mirrors the CPU's own loop* of load–add–store–jump — which is exactly why it's the **substrate** that declarative, functional, and object-oriented code all ultimately compile down to. Next: [`middle.md`](middle.md) — structured programming, scope and lifetime, stack frames in detail, and how loops become jumps.

---

## Further Reading

- **Structured Programming** — Dahl, Dijkstra, Hoare (1972) — the book that argued sequence/selection/iteration are all you need, and that `goto` should go.
- **Structure and Interpretation of Computer Programs** (SICP), Ch. 1–3 — builds procedures, state, and the substitution/environment model from the ground up.
- **The C Programming Language** — Kernighan & Ritchie — the canonical procedural-language book; small, precise, and still the clearest tour of statements, functions, and the machine model.
- **Code: The Hidden Language of Computer Hardware and Software** — Charles Petzold — builds the von Neumann machine from relays up, so "imperative mirrors the hardware" becomes concrete.

---

## Related Topics

- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/junior.md) — where this paradigm sits on the imperative ↔ declarative spectrum.
- [03 — Declarative Programming](../03-declarative-programming/) — the opposite end: say *what*, not *how*; it's imperative hidden behind an engine.
- [10 — Data-Oriented Programming](../10-data-oriented-programming/) — imperative pushed toward cache-friendly data layout.
- [17 — Multiparadigm in Practice](../17-multiparadigm-in-practice/) — how real languages wrap imperative cores in OO and FP.
- [Functional Programming](../../code-craft/functional-programming/) — the expression-centric, mutation-avoiding contrast to everything here.
- [Language Internals → Memory Management](../../language-internals/memory-management/) — the stack and heap your procedures and variables actually live in.
