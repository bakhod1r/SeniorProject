# Imperative & Procedural — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Imperative & Procedural
> *The leap from "I can write loops" to "I understand what loops compile into, where my variables live, and why structured programming won."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Structured Programming: Taming the `goto`](#structured-programming-taming-the-goto)
4. [Scope and Lifetime](#scope-and-lifetime)
5. [The Call Stack and Stack Frames, in Detail](#the-call-stack-and-stack-frames-in-detail)
6. [Pass-by-Value vs Pass-by-Reference](#pass-by-value-vs-pass-by-reference)
7. [Side Effects: the Defining Trait](#side-effects-the-defining-trait)
8. [How Loops Become Jumps](#how-loops-become-jumps)
9. [Putting It Together: a Procedure End to End](#putting-it-together-a-procedure-end-to-end)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it actually work, and how do I use it well?**

At the junior level, imperative programming was "statements that change state, with sequence/selection/iteration." That's true, but it's the *surface*. This page goes one layer down to the machinery you must understand to write — and debug — non-trivial procedural code:

- **Why** we structure code with `if`/`while` instead of raw `goto` (and what was actually wrong with `goto`).
- **Where** your variables live, and for **how long** — scope and lifetime.
- **What a stack frame really contains**, and how parameters get there.
- The single most consequential question in procedural code: when you pass an argument, does the callee get a **copy** or the **original**? — pass-by-value vs pass-by-reference.
- **Side effects** — the property that defines this paradigm and causes most of its bugs.
- How your `for` loop becomes **conditional jumps** in the compiled output.

> **The mindset shift:** stop treating control flow and function calls as opaque magic that "just works," and start seeing the mechanism — a program counter jumping around, a stack growing and shrinking, copies versus aliases. This is the level at which you can *predict* what code does instead of running it to find out.

---

## Prerequisites

- **Required:** Comfort with [`junior.md`](junior.md) — statements vs expressions, the three control-flow shapes, procedures, and the basic call-stack picture.
- **Required:** You can write and call functions with parameters in at least two languages. Examples use **C**, **Python**, and **Go**.
- **Helpful:** You've hit a `StackOverflowError`/`RecursionError`, or been surprised that modifying a list inside a function changed it outside. Both get explained here.
- **Helpful:** Any exposure to pointers or references (C pointers, Java/Python object references).

---

## Structured Programming: Taming the `goto`

Early imperative code had one extra tool: **`goto`** — "jump to this labeled line, unconditionally, from anywhere." With `goto` plus `if`, you can build any control flow. But you can also build a *mess*: jumps leaping in and out of loops, into the middle of other blocks, backward and forward, until the flow of control looks like a plate of spaghetti — hence **"spaghetti code."**

In 1968 Edsger Dijkstra published a famous letter, **"Go To Statement Considered Harmful,"** arguing that unrestricted `goto` makes programs nearly impossible to reason about. His point was precise and worth understanding:

> When you read a line of structured code, you can describe the program's *state* by saying "we're at this line, on this loop iteration." With arbitrary `goto`, you *can't* — control could have arrived at this line from anywhere, so the set of possible states is unbounded, and you lose the ability to reason locally.

The cure was **structured programming**: restrict control flow to three composable shapes — **sequence**, **selection**, **iteration** — each with a *single entry and single exit*. The **Böhm–Jacopini theorem** (1966) proved this is enough: any program built from `goto` can be rewritten using only those three constructs. So nothing is lost in *power*; everything is gained in *readability*.

```c
/* UNSTRUCTURED — goto spaghetti */
    i = 0;
loop:
    if (i >= n) goto done;
    if (a[i] < 0) goto skip;
    sum += a[i];
skip:
    i++;
    goto loop;
done:

/* STRUCTURED — same logic, single-entry/single-exit blocks */
    for (int i = 0; i < n; i++) {
        if (a[i] >= 0)
            sum += a[i];
    }
```

Both compute the same sum. The second is readable because each construct is a box you can understand in isolation: the `for` is one box with one way in and one way out; the `if` is another. Today every mainstream language gives you `if`/`while`/`for` and most discourage or forbid `goto`.

**Nuance for the senior track ahead:** structured programming isn't *anti-jump* — it's anti-*arbitrary*-jump. Disciplined exits like `break`, `continue`, and early `return` are jumps too, but they're *constrained* (they can only exit outward, to predictable places), so they keep most of the reasoning benefit. The thing Dijkstra actually objected to — jumping *into* the middle of an arbitrary block — is what modern languages removed. C still has `goto`, and the Linux kernel uses it deliberately for one disciplined pattern: cleanup-on-error (`goto cleanup;`), jumping only *forward* to a single exit. That's structured in spirit even though it uses the keyword.

---

## Scope and Lifetime

Two questions about every variable, often confused, always distinct:

- **Scope** — *where in the source code* can this name be used? (A compile-time, textual property.)
- **Lifetime** — *for how long during execution* does this variable's storage exist and hold a value? (A runtime property.)

```c
int counter = 0;          // file/global scope; lifetime = whole program

void tick(void) {
    int local = 1;        // scope = this function; lifetime = this call
    static int calls = 0; // scope = this function; lifetime = WHOLE program
    calls++;
    counter += local;
}
```

Three storage classes, three scope/lifetime combinations to know:

| Kind | Scope (where usable) | Lifetime (how long it exists) | Lives in |
|---|---|---|---|
| **Local** | inside its block/function | one call (created on entry, gone on return) | the **stack** |
| **Static / global** | file or whole program | the entire program run | a fixed **data** region |
| **Dynamically allocated** | wherever you hold a pointer | until *you* free it (or GC does) | the **heap** |

The case people get wrong is the `static` local: its *scope* is just the one function (you can't name it elsewhere), but its *lifetime* is the whole program — so `calls` above remembers its value across calls. Scope ≠ lifetime.

### Nested scope and shadowing

Inner scopes can see outer names; an inner declaration with the same name **shadows** the outer one:

```python
x = "outer"
def f():
    x = "inner"   # a NEW local x, shadowing the outer x — doesn't change it
    print(x)      # inner
f()
print(x)          # outer  (untouched)
```

Most languages resolve names by **lexical (static) scope**: a name refers to the nearest enclosing declaration *in the source text*, decidable by reading the code without running it. (The historical alternative, dynamic scope — resolve to the most recent binding on the call stack — survives mainly in old Lisps and shell variables, and is a frequent source of surprises.) Lexical scope is *why* the compiler can check your variable usage and why you can understand a function without tracing who called it.

---

## The Call Stack and Stack Frames, in Detail

The junior page sketched the stack as "I-was-here notes." Now the real structure. When a procedure is called, the runtime pushes a **stack frame** (activation record) — a contiguous block of memory containing everything that call needs:

```
        high addresses
        ┌─────────────────────────┐
        │ caller's frame          │
        ├─────────────────────────┤  ← frame for the CURRENT call:
        │ arguments / parameters  │     • the values passed in
        │ return address          │     • where to resume in the caller
        │ saved frame pointer      │     • link to caller's frame
        │ local variables         │     • this call's own locals
        │ (scratch / temporaries) │     • space for sub-expression results
        ├─────────────────────────┤  ← stack pointer (top); grows DOWNWARD
        │   (unused stack space)  │
        └─────────────────────────┘
        low addresses
```

What each part does:

- **Return address** — the instruction in the caller to jump back to when this call finishes. This is literally how `return` knows where to go.
- **Parameters / arguments** — the inputs to this call, copied in (more on copies below).
- **Saved frame pointer** — a link to the caller's frame, so the runtime can unwind correctly. Following this chain frame-by-frame is exactly how a debugger prints a **stack trace** ("called from X, called from Y, called from main").
- **Local variables** — this call's locals, which is why each call's locals are private and independent.

Key consequences you can now explain:

- **Why locals vanish on return.** When the procedure returns, its frame is popped — the stack pointer just moves back up. The locals' storage is *reused* by the next call. (This is why returning a pointer to a C local is a bug: you're pointing into memory that's about to be overwritten.)
- **Why recursion works *and* why it can overflow.** Each recursive call pushes a *new* frame with its *own* locals — that's why `factorial(5)` can have five `n`s alive at once. But every frame consumes stack space, so unbounded recursion exhausts the stack: **stack overflow**.
- **Why the stack is fast.** Allocating a frame is just "move the stack pointer down by N bytes" — one instruction. Freeing it is "move it back up." No bookkeeping, no fragmentation. This bump-allocation speed is a big part of why imperative procedural code is fast, and it's the contrast with heap allocation. Full treatment: [Language Internals → Memory Management](../../language-internals/memory-management/).

```c
// Each recursive call pushes a frame with its own n.
long factorial(int n) {
    if (n <= 1) return 1;        // base case → stop pushing, start popping
    return n * factorial(n - 1); // pushes a new frame for n-1
}
// factorial(4): 4 frames stacked, then they pop:  4*(3*(2*(1)))
```

---

## Pass-by-Value vs Pass-by-Reference

This is the single most misunderstood topic in procedural programming, and getting it precise eliminates a whole category of "why did my variable change?!" bugs. The question: **when you pass an argument to a procedure, does the procedure get a copy of your value, or access to your original?**

### Pass-by-value — the callee gets a copy

The argument's value is *copied* into the parameter. The procedure works on its own copy; changes to the parameter do **not** affect the caller's variable.

```c
// C — pass-by-value (C's ONLY mechanism for plain values)
void increment(int x) {
    x = x + 1;        // changes the LOCAL copy only
}
int a = 5;
increment(a);
printf("%d\n", a);    // 5 — a is untouched
```

`increment` received a copy of `5` in its own frame. It changed *that copy*. The caller's `a` never saw it.

### Pass-by-reference — the callee gets the original

The parameter is an *alias* for the caller's variable. Changes to the parameter **do** affect the caller. To get this in C, you pass a **pointer** (the address of the variable) and the callee dereferences it:

```c
// C — simulate pass-by-reference by passing an address
void increment(int *x) {
    *x = *x + 1;      // follow the address, change the ORIGINAL
}
int a = 5;
increment(&a);        // pass the ADDRESS of a
printf("%d\n", a);    // 6 — a was changed through the pointer
```

C++ has true reference parameters (`void increment(int &x)`) that do this without explicit pointer syntax, but the underlying idea is identical: the callee can reach back and modify the caller's variable.

### The part that trips up everyone: "pass-by-value of a reference"

Languages like **Python, Java, Go, and JavaScript** are *all* pass-by-value — but the value being copied, for objects, is a **reference** (a pointer to the object). This produces behavior that *looks* like pass-by-reference but isn't, and the distinction matters:

```python
def add_item(lst):
    lst.append(99)     # MUTATES the shared object → caller sees it
def reassign(lst):
    lst = [1, 2, 3]    # REBINDS the local copy of the reference → caller does NOT see it

items = [1, 2]
add_item(items)
print(items)           # [1, 2, 99]  — the object was mutated through the shared reference
reassign(items)
print(items)           # [1, 2, 99]  — UNCHANGED; reassign only rebound its local copy
```

The precise mental model: **the reference is copied (pass-by-value), but both copies point at the *same* object.** So:

- **Mutating the object** through either reference (`lst.append`) is visible everywhere — same object.
- **Rebinding the parameter** (`lst = ...`) only changes the *local copy of the reference* — the caller's variable still points at the old object.

This is sometimes called **"call-by-sharing"** or "pass-by-value of the reference," and it explains nearly every "why didn't my reassignment stick?" / "why did my list change?" surprise in these languages.

| Language | Plain values (int, struct) | Objects / arrays / slices |
|---|---|---|
| **C** | by value (copy) | by value; pass `&x` for reference behavior |
| **Go** | by value (copy) — incl. structs | slices/maps/pointers copy the *header/reference* → shared backing data |
| **Java** | by value (copy) — primitives | by value of the *reference* → shared object, but reassigning the param doesn't escape |
| **Python** | (everything is an object) | by value of the *reference* → mutate-yes, rebind-no |

> **The one rule to carry:** *Everything mainstream is pass-by-value. The question is "value of what?"* For ints it's the number; for objects it's a reference. Mutating the pointed-at object is shared; rebinding the parameter is not.

---

## Side Effects: the Defining Trait

A **side effect** is anything a procedure does besides compute and return a value: assigning to a variable that outlives the call, mutating an argument, printing, writing a file, sending a network request, changing global state. Imperative programming is *built on* side effects — assignment itself is one. That's the paradigm's power *and* its central liability.

```python
log = []
def process(order):
    log.append(order.id)      # side effect: mutates external state
    order.status = "done"     # side effect: mutates the argument
    total = order.amount * 2  # NOT a side effect: local, returned
    return total
```

`process` returns a value *and* changes two things outside itself. The return value tells you only part of what it did. To know the *full* effect of calling it, you must know its entire body — and the more side effects a procedure has, the harder it is to reason about, test, and reuse.

This is the precise contrast with the functional paradigm. A **pure** function has *no* side effects: same inputs → same output, always, and it touches nothing else. Pure functions are **referentially transparent** — you can replace a call with its result without changing the program's meaning — which is exactly what you *cannot* do with `process`, because calling it also appends to `log`. (Full treatment: [FP → Pure Functions & Referential Transparency](../../code-craft/functional-programming/02-pure-functions-and-referential-transparency/).)

You don't avoid side effects in imperative code — they're the point. The skill, which [`senior.md`](senior.md) develops, is **controlling and localizing** them: keeping mutation contained, minimizing shared state, and making the side effects a procedure *does* obvious rather than hidden.

---

## How Loops Become Jumps

The junior page claimed loops compile to jumps. Here's the mechanism, because seeing it demystifies performance, off-by-one bugs, and what `break`/`continue` really are.

A CPU has no "loop" instruction. It has **conditional and unconditional jumps** (also called branches): "jump to address L," and "jump to L *only if* this comparison holds." A loop is built from a backward conditional jump:

```
Go source                  Conceptual machine code
─────────                  ───────────────────────
sum := 0                       MOV   sum, 0
i := 0                         MOV   i, 0
for i < n {              loop:  CMP   i, n          ; compare i and n
    sum += a[i]                JGE   done          ; if i >= n, jump OUT (exit test)
    i++                        LOAD  r, a[i]
}                              ADD   sum, r
                               INC   i
                               JMP   loop          ; jump BACK to the test
                         done:  ...
```

Read the shape:

- A `for`/`while` is a **test at the top** (`CMP` + conditional jump out) plus an **unconditional jump back up** at the bottom. The "loop" is literally that backward `JMP`.
- **`break`** is an unconditional jump straight to `done` — exit now.
- **`continue`** is a jump to the increment/test part — skip the rest of this iteration, go around again.
- An **off-by-one bug** is using `JG` (jump if greater) where you needed `JGE` (greater-or-equal): one wrong comparison and you process one element too few or too many. Seeing the comparison instruction makes the bug's nature concrete.

This is also why a tight imperative loop is *fast and predictable*: it's a handful of register operations and a branch the CPU's branch predictor learns to anticipate. There's no allocation, no indirection, no hidden machinery — which is the performance argument for imperative code that [`senior.md`](senior.md) develops. The execution model underneath is in [Language Internals → Evaluation & Execution Models](../../language-internals/evaluation-and-execution-models/).

---

## Putting It Together: a Procedure End to End

One small procedure that exercises everything on this page — trace it deliberately:

```c
int sum_positive(int *arr, int n) {   // arr passed by reference (pointer); n by value
    int total = 0;                    // local, lives on this frame, lifetime = this call
    for (int i = 0; i < n; i++) {     // i: block scope; loop = test-at-top + jump-back
        if (arr[i] > 0)               // selection inside iteration
            total += arr[i];          // mutation of local state (a side effect on `total`)
    }
    return total;                     // pop frame; total's storage is reclaimed
}
```

What a call to `sum_positive(data, 5)` involves, in order:

1. **A frame is pushed**: parameters `arr` (a copied *pointer* — the array is shared, by reference) and `n` (a copied *value*, `5`), plus locals `total` and `i`.
2. **Control flow** runs the structured constructs: the `for` is a top-test loop; the `if` selects; the `total +=` mutates state once per qualifying element.
3. **The loop compiles to** a compare-and-conditional-jump-out plus a jump-back — no "loop instruction" exists.
4. **`total` is local**: its lifetime is exactly this call; a second concurrent call would have its own `total`.
5. **`return`** sends `total`'s value back via the return address and **pops the frame** — `total` and `i` cease to exist.

Every concept on this page is in those six lines. That's procedural programming: structured control flow over mutable local state, organized into a called, parameterized unit, executed on a stack frame.

---

## Mental Models

- **Scope is the map; lifetime is the clock.** Scope answers "*where* can I write this name?" (read it off the source). Lifetime answers "*when* does its storage exist?" (watch it run). A `static` local has a small map and a long clock — that's why they feel paradoxical until you separate the two axes.
- **A stack frame is a desk.** Each call gets a fresh desk with its own scratch paper (locals) and a sticky note saying where to file the result (return address). Finish the call, clear the desk, hand the result up. Two calls = two desks; they never share paper.
- **Pass-by-value copies the thing; the trick is what "the thing" is.** Pass an `int`, copy the number. Pass an object, copy the *arrow pointing at* the object — both arrows aim at one object, so mutating it is shared, but bending your own arrow elsewhere isn't.
- **A loop is a backward jump with a guard.** Strip the syntax and a `for` is "check a condition; if it fails, leave; otherwise do the body and jump back to the check." `break` is "leave now"; `continue` is "jump to the check now."

---

## Common Mistakes

- **Confusing scope with lifetime.** A `static` local is in-scope only inside its function but lives the whole program. They're independent axes; reason about each separately.
- **Believing your language is "pass-by-reference" because objects seem shared.** Java, Python, Go are pass-by-*value* — of a reference, for objects. The proof: reassigning the parameter (`x = newThing`) never escapes the function; only *mutating the pointed-at object* does.
- **Returning a pointer to a local (C/C++).** The local's frame is popped on return; the pointer now aims at reclaimed memory that the next call will overwrite. Dangling pointer, undefined behavior.
- **Unbounded recursion.** Forgetting or mis-writing the base case means frames keep pushing until the stack overflows. Recursion is a stack-consuming loop; it must shrink toward a stopping case.
- **Hidden side effects.** A function named `getTotal()` that *also* logs, mutates a cache, and flips a global is a debugging trap. The name promises a value; the body does more. Make side effects visible (name them, or isolate them).
- **Assuming `goto`-free means jump-free.** `break`, `continue`, and early `return` are disciplined jumps. They're fine; the thing structured programming banned was jumping *into* arbitrary places, which destroys local reasoning.
- **Off-by-one from the wrong comparison.** `<` vs `<=` in a loop condition is a one-instruction difference (`JGE` vs `JG`) that processes one element too many or too few. Know exactly which boundary you mean.

---

## Test Yourself

1. What was Dijkstra's actual argument against `goto`? Why don't `break`/`continue`/early `return` fall under the same objection?
2. Distinguish **scope** from **lifetime**, and give an example where they differ.
3. List four things a stack frame contains, and say what each is *for*.
4. C passes everything by value. So how do you write a C function that modifies the caller's variable?
5. In Python, `def f(lst): lst.append(1)` changes the caller's list, but `def g(lst): lst = [1]` does not. Explain *precisely* why, using "copy of a reference."
6. What is a **side effect**? Why does having many of them make a procedure hard to reason about?
7. A `while` loop has no "loop instruction" underneath. What does it actually compile to? Where do `break` and `continue` jump?

> If #5 is fuzzy, re-read [Pass-by-Value vs Pass-by-Reference](#pass-by-value-vs-pass-by-reference); if #7 is fuzzy, re-read [How Loops Become Jumps](#how-loops-become-jumps).

---

## Cheat Sheet

```
STRUCTURED PROGRAMMING:
  ban arbitrary goto → use sequence / selection / iteration (single-entry/single-exit)
  Böhm–Jacopini: those three shapes can express ANY program (no power lost)
  break/continue/return = DISCIPLINED jumps (exit outward only) → still fine

SCOPE vs LIFETIME (independent!):
  scope    = WHERE in source a name is usable     (compile-time, lexical)
  lifetime = HOW LONG its storage exists at runtime
  local → stack, one call   |   static/global → fixed, whole program   |   heap → until freed/GC'd

STACK FRAME holds:  params · return address · saved frame ptr · locals · temporaries
  call → push frame    return → pop frame (locals vanish; storage reused)
  recursion = a frame per call → can stack-overflow;  unwinding frames = the stack trace

PASS SEMANTICS — everything mainstream is BY VALUE; "value of what?":
  int/struct → copy the value      → callee can't change caller's var
  object/ref → copy the REFERENCE  → both point at one object
      mutate object  → visible to caller (shared object)
      rebind param   → NOT visible (only local copy of the ref changed)
  C "by reference" = pass &x, deref *x

SIDE EFFECT = doing anything besides compute+return (assign global, mutate arg, I/O)
  imperative is built on them; pure functions have none (referential transparency)

LOOP → JUMPS:  for/while = top test (CMP + jump-out) + backward JMP
  break = jump out · continue = jump to test/increment · off-by-one = wrong CMP (< vs <=)
```

---

## Summary

The middle layer of imperative programming is its **machinery**. **Structured programming** replaced arbitrary `goto` with sequence/selection/iteration — single-entry/single-exit blocks that, by the Böhm–Jacopini theorem, lose no power while making code locally reasonable; `break`/`continue`/`return` survive as *disciplined* jumps. **Scope** (where a name is usable) and **lifetime** (how long storage exists) are independent axes — the `static` local proves it. The **call stack** allocates a **frame** per call holding parameters, return address, saved frame pointer, and locals; calls push, returns pop, recursion stacks frames until it overflows, and unwinding frames is what a stack trace prints. The pivotal practical topic is **pass semantics**: everything mainstream is **pass-by-value**, but for objects the value copied is a *reference*, so mutating the shared object escapes while rebinding the parameter does not. **Side effects** — mutation, I/O, global changes — define the paradigm and cause most of its bugs; pure functions are their absence. And **loops compile to jumps**: a top test plus a backward branch, with `break`/`continue` as exits — which is why tight imperative loops are fast and why off-by-one errors are one-comparison mistakes. Next: [`senior.md`](senior.md) — the trade-offs, when imperative is the *right* call, and the cost of reasoning about mutable state at scale.

---

## Further Reading

- **"Go To Statement Considered Harmful"** — Edsger W. Dijkstra (1968) — three pages; read the actual argument, not the slogan.
- **Structured Programming** — Dahl, Dijkstra, Hoare (1972) — the foundational case for the three constructs.
- **Computer Systems: A Programmer's Perspective** (CS:APP) — Bryant & O'Hallaron — Ch. 3 ("Machine-Level Representation") is the definitive treatment of stack frames, calls, and loops-as-jumps.
- **Expert C Programming: Deep C Secrets** — Peter van der Linden — pointers, pass-by-value, and what arrays/pointers really do across a call.

---

## Related Topics

- [`junior.md`](junior.md) — statements, state, the three control-flow shapes, and the gentle call stack.
- [`senior.md`](senior.md) — the trade-offs: control and performance vs the cost of mutable state.
- [03 — Declarative Programming](../03-declarative-programming/) — hiding these imperative mechanics behind a "what, not how" interface.
- [Functional Programming → Pure Functions & Referential Transparency](../../code-craft/functional-programming/02-pure-functions-and-referential-transparency/) — the disciplined opposite of side effects.
- [Language Internals → Memory Management](../../language-internals/memory-management/) — the stack and heap your frames and objects live in.
- [Language Internals → Evaluation & Execution Models](../../language-internals/evaluation-and-execution-models/) — how source becomes the jumps and frames described here.
