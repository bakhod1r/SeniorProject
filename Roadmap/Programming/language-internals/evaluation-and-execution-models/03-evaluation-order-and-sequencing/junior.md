# Evaluation Order & Sequencing — Junior Level

> **Topic:** [Evaluation Order & Sequencing](README.md)
> **Focus:** In what order does the machine actually compute the pieces of an expression — and why does `a[i] = i++` sometimes mean nothing at all?

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
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)

---

## Introduction

> Focus: **When you write `f(g(), h())` or `x + y * z`, what gets computed first — and does the language even promise an answer?**

When you read an expression like `a + b * c`, you already know `b * c` is multiplied *before* it is added to `a`. That rule is **operator precedence**, and it tells you how the expression is *grouped*. But precedence does **not** tell you *which side runs first*. Does `a` get evaluated before `b`? Before `c`? Precedence and evaluation order are two completely different things, and confusing them is one of the most common sources of "works on my machine" bugs.

**Evaluation order** is the order in which the language actually computes the sub-pieces of an expression — the function calls, the variable reads, the `i++` side effects. For pure code (no side effects), the order is invisible: `2 + 3` is `5` no matter what runs first. The order only becomes *observable* when one of the pieces **changes something** — increments a variable, prints, returns a different value each time, throws. That is when the question "what runs first?" suddenly decides whether your program is correct, broken, or — in C and C++ — has *no defined meaning at all*.

In one sentence: **precedence decides the shape of the tree; evaluation order decides the order you walk it.** And some languages refuse to promise you any particular walk.

> 🎓 **Why this matters for a junior:** You will eventually write something like `data[index++] = index;` or `print(next(), next())` and get a result that makes no sense. The instinct is to blame the function, the compiler, or the universe. The real culprit is almost always evaluation order — and the fix is almost always to *not cram side effects into one expression*. Learning this early saves you from a whole class of bugs that survive code review because they look obviously correct.

This page covers: what a sub-expression is, the difference between precedence and order, what "left-to-right" means and which languages guarantee it, the classic `i++` traps, short-circuit `&&` / `||` as an *ordering* guarantee you can rely on, and a tour of the same examples across C, Java, Python, Go, and JavaScript. The harder model — C's "sequence points" and C++'s "sequenced-before" — is introduced gently here and dissected in `middle.md` and `senior.md`.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to read and run a small program in at least one of C, Java, Python, Go, or JavaScript.
- **Required:** What a variable is, and what `i++` (increment) does.
- **Required:** Basic arithmetic and boolean expressions (`a + b`, `x && y`).
- **Helpful but not required:** A vague sense that `a + b * c` multiplies first — that's *precedence*, which we'll contrast with order.
- **Helpful but not required:** Having once been confused by an off-by-one bug. This topic explains a sneaky family of them.

You do **not** need to know:

- The formal C11 "sequence point" wording or the C++11 "sequenced-before" relation — introduced lightly here, formalized in `middle.md`/`senior.md`.
- Anything about CPU instruction reordering or the memory model — that's the connection drawn in `senior.md`.
- Compiler optimization theory or the "as-if" rule — `professional.md`.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Expression** | A piece of code that produces a value: `2 + 2`, `f(x)`, `a && b`, `arr[i]`. |
| **Sub-expression** | A smaller expression inside a bigger one. In `f(a, b)`, the pieces `f`, `a`, and `b` are sub-expressions. |
| **Operand** | The input to an operator. In `x + y`, both `x` and `y` are operands. |
| **Evaluation** | The act of computing an expression's value, *including* running any side effects it contains. |
| **Evaluation order** | The order in which the language computes the sub-expressions of a larger expression. |
| **Operator precedence** | The rule that decides *grouping*: `a + b * c` means `a + (b * c)`. This is **not** evaluation order. |
| **Associativity** | Which way same-precedence operators group: `a - b - c` means `(a - b) - c` (left-associative). Also not the same as order. |
| **Side effect** | Any observable change an expression makes besides producing a value: `i++`, `print()`, writing a field, throwing. |
| **Pure expression** | An expression with no side effects. Its value is all it does; order can't be observed. |
| **Left-to-right** | The guarantee (in Java, C#, JavaScript, Python, ...) that operands and arguments are evaluated leftmost-first. |
| **Unspecified order** | The compiler may pick *any* order, possibly differing between compilers or builds. C/C++ function arguments are like this. |
| **Undefined behavior (UB)** | C/C++ term: the program has *no meaning at all*. The compiler may do anything. `i = i++;` is the canonical example. |
| **Short-circuit** | `&&` and `||` stop evaluating as soon as the result is known. This is also a *guaranteed* left-to-right ordering. |
| **Sequence point** | (C term) A spot in the program where all prior side effects are finished before the next ones start. |
| **Sequenced-before** | (C++11 term) The modern replacement for sequence points: a precise "this happens before that" relation. |

---

## Core Concepts

### 1. Precedence is *grouping*. Order is *timing*. They are different.

This is the single most important idea on the page, so we lead with it.

Take `a + b * c`. **Precedence** says the `*` binds tighter than `+`, so this parses as `a + (b * c)`. That is a fact about the *shape* of the expression — its parse tree:

```
      +
     / \
    a   *
       / \
      b   c
```

Precedence built that tree. But the tree says **nothing** about *which leaf is visited first*. Does the program read `a` before `b`? Before `c`? That is **evaluation order**, and it is a *separate* decision the language makes (or refuses to make).

> **Mantra:** *Precedence shapes the tree. Order walks the tree.* You can have the same tree walked in many different orders.

If `a`, `b`, and `c` are plain numbers, you cannot tell the difference — `2 + 3 * 4` is `14` whatever the walk order. The difference only shows up when reading `a`, `b`, or `c` *does something* (a side effect) or *returns a different value each time* (an impure function).

### 2. A side effect is what makes order visible.

Consider:

```python
def f():
    print("f")
    return 1

def g():
    print("g")
    return 2

x = f() + g()
```

The *value* of `x` is `3` regardless of order. But the *printed output* depends on whether `f()` or `g()` runs first. In Python (and Java, C#, JavaScript) the answer is guaranteed: `f` then `g`, because these languages evaluate **left to right**. In C, the order is **unspecified** — a conforming compiler may print `g` then `f`.

So: **pure expressions hide evaluation order; side-effecting expressions expose it.** The practical lesson writes itself — *if you don't want order to matter, don't put side effects where order matters.*

### 3. Some languages pin the order. Some refuse.

Languages fall into roughly three buckets:

| Language | Operand / argument order | Notes |
|----------|--------------------------|-------|
| **Java** | Strict **left-to-right**, guaranteed by the spec | Operands, then the operation. |
| **C#** | Strict **left-to-right**, guaranteed | Same model as Java. |
| **JavaScript** | Strict **left-to-right**, guaranteed | Including object/array literals and arguments. |
| **Python** | **Left-to-right**, with a few documented exceptions (assignment) | Mostly predictable. |
| **C** | **Unspecified** for function arguments and most operands | Different compilers differ; not portable. |
| **C++** | **Unspecified** for function arguments (pre-C++17 even more so) | The land of "sequenced-before." |
| **Go** | Mostly left-to-right with specified rules; some function-call ordering subtleties | Specified, but read the spec. |
| **Rust** | Left-to-right, well-defined | No UB here, by design. |

The headline: **C and C++ deliberately leave function-argument order unspecified**, so the compiler can optimize. Everyone else mostly pins it left-to-right. Memorize which bucket your language is in.

### 4. Short-circuit operators *do* guarantee order — everywhere.

There is one place where *every* mainstream language guarantees order: the logical operators `&&` and `||` (and their null-coalescing cousins like `??`).

```c
if (p != NULL && p->value > 0) { ... }
```

`&&` evaluates its **left** operand first. If the left is false, the right is **not evaluated at all** ("short-circuit"). That is why the code above is safe: if `p` is `NULL`, `p->value` is never touched. This is a *guaranteed* left-to-right ordering, and you lean on it constantly. The same holds for `||` (stops on the first true) and `??` (stops on the first non-null).

> **Key insight:** `&&` and `||` are the one corner where C/C++ *do* promise order. Function arguments are not. Don't confuse the two.

### 5. The classic trap: reading and writing the same variable in one expression.

This is where C and C++ stop being merely "unspecified" and become **undefined** — meaning the standard says your program has *no meaning whatsoever*.

```c
int i = 1;
a[i] = i++;     // UB in C/C++ (before C++17 for this specific form)
```

The problem: this expression both **writes** `i` (via `i++`) and **uses** `i` (to index `a`) with no sequencing between them. The compiler is allowed to assume that never happens, so the result is undefined — it might use the old `i`, the new `i`, set fire to your stack, or appear to work for ten years and break after an upgrade. We will return to exactly why in `middle.md`. For now: **never read and modify the same variable in a single expression in C/C++.**

---

## Real-World Analogies

**The recipe with one shared bowl.** A recipe says "combine the flour mixture and the egg mixture." Precedence is the *recipe structure* — which sub-mixtures combine into which. Evaluation order is *which mixture you prepare first*. If both sub-recipes are independent (you have two bowls), order doesn't matter. But if both steps say "pour into THE bowl" and there's only one bowl, the order suddenly decides the outcome — and a recipe that doesn't tell you the order is a buggy recipe. That single shared bowl is your variable `i`.

**Two clerks, one ledger.** Imagine `total = withdraw() + withdraw()` where each `withdraw()` subtracts from and reports a shared balance. If the language doesn't say which clerk goes first, two different banks (compilers) will hand you two different totals. The arithmetic (`+`) is fine; the *order of the two withdrawals* is the whole ballgame.

**Reading a sign while repainting it.** `a[i] = i++` is like telling a painter "paint over the house number, and also deliver mail to that exact number" — at the same instant, with no rule about which happens first. Which number do you deliver to: the old one or the new one? In C, the answer is worse than "we don't know" — it's "the question is meaningless; anything may happen."

**Standing in a doorway.** Short-circuit `&&` is a bouncer who checks IDs left to right and stops the moment someone fails. `p != NULL && p->value` checks "is there a person?" *before* "what's in their wallet?" — and never reaches into a non-existent person's pocket. The left-to-right order is the safety guarantee.

---

## Mental Models

### Model 1: The two-step pipeline — parse, then walk.

```
Source text  →  [PARSE using precedence/associativity]  →  Tree  →  [WALK using evaluation order]  →  Result
```

Precedence and associativity build the tree *once*, at compile time. Evaluation order decides how the tree is *walked* at run time. Two languages can build the **identical tree** and **walk it differently**. Keeping these two phases separate in your head dissolves 90% of the confusion.

### Model 2: "Can I see the difference?" decision flow.

```
Does the expression contain a side effect or an impure call?
  ├── No  → evaluation order is INVISIBLE. Relax.
  └── Yes → does my language guarantee an order?
             ├── Yes (Java/C#/JS/Python/Rust) → it's left-to-right; reason accordingly.
             └── No  (C/C++ args) → order is UNSPECIFIED; do not depend on it.
                  └── And do you read AND write the same variable?
                        └── Yes → UNDEFINED behavior in C/C++. Stop. Rewrite.
```

### Model 3: The "one statement per side effect" rule.

The simplest mental defense: **at most one side effect per statement, and never read a variable you're modifying in the same statement.** When you obey this, evaluation order *cannot bite you*, in any language. Most senior C/C++ codebases enforce exactly this with a linter.

---

## Code Examples

### Example 1 — Precedence vs. order, made visible (Python, guaranteed L-to-R)

```python
def tag(name, value):
    print(f"evaluating {name}")
    return value

result = tag("A", 1) + tag("B", 2) * tag("C", 3)
print("result =", result)
```

Output (Python is left-to-right):

```
evaluating A
evaluating B
evaluating C
result = 7
```

Note two separate facts: the *result* is `1 + (2 * 3) = 7` because of **precedence**, but the *print order* is `A, B, C` because of **left-to-right evaluation order**. Precedence did not make `B*C` print first — order is independent of grouping.

### Example 2 — The same code in C, where order is unspecified

```c
#include <stdio.h>

int tag(const char *name, int value) {
    printf("evaluating %s\n", name);
    return value;
}

int main(void) {
    int result = tag("A", 1) + tag("B", 2) * tag("C", 3);
    printf("result = %d\n", result);
}
```

The *result* is still `7` (precedence is the same everywhere). But the **order in which `A`, `B`, `C` print is unspecified** — GCC and MSVC may differ, and even a flag change can flip it. Never write code whose correctness depends on this print order in C.

### Example 3 — Short-circuit as a safety guarantee (C, Java, JS, Go — all the same)

```c
// Safe: '&&' guarantees the left runs first, and skips the right if left is false.
if (node != NULL && node->next != NULL) {
    use(node->next);
}
```

If you wrote `if (node->next != NULL && node != NULL)` you would dereference `node` *before* the null check — a crash. The ordering of `&&` is what makes the correct version correct. This guarantee holds in every mainstream language.

### Example 4 — The undefined-behavior trap (C/C++)

```c
int i = 0;
int a[3];

a[i] = i++;     // UNDEFINED in C (and pre-C++17 C++): read and write of i, unsequenced
i = i++;        // UNDEFINED: also reads and writes i
int x = i++ + i++;  // UNDEFINED in C: two unsequenced modifications of i
```

A linter (or `-Wsequence-point` / `-Wunsequenced`) will flag these. The fix is always to split the side effect out:

```c
a[i] = i;
i++;
```

### Example 5 — Function arguments: defined in Java, unspecified in C

Java (guaranteed left-to-right):

```java
int i = 0;
System.out.println(consume(i++) + ", " + consume(i++) + ", " + consume(i++));
// Always prints arguments built from i = 0, 1, 2 in that order.
```

C (unspecified — do NOT do this):

```c
int i = 0;
printf("%d %d %d\n", i++, i++, i++);   // order of the three i++ is UNSPECIFIED
// GCC and MSVC famously evaluate arguments in different orders.
```

### Example 6 — Making order *not matter* (the fix, any language)

```python
# Instead of relying on order:
result = next(it), next(it)   # depends on left-to-right; fine in Python, risky habit

# Prefer explicit sequencing:
first  = next(it)
second = next(it)
result = (first, second)
```

The second version says *exactly* what you mean and survives a port to a language with different rules.

### Example 7 — Comma operator (C/C++): evaluate left, throw it away, keep right

```c
int x = (printf("side effect\n"), 42);
// prints "side effect", then x = 42.  The comma *guarantees* left-then-right.
```

The comma operator is one of the few C operators that *does* impose order (left fully evaluated, result discarded, then right). It's rarely needed; don't reach for it.

---

## Pros & Cons

**Of languages that pin evaluation order (Java, C#, JS, Python, Rust):**

| Pros | Cons |
|------|------|
| Predictable: the same code behaves the same on every compiler. | Slightly fewer optimization opportunities for the compiler. |
| Easier to reason about side effects in expressions. | Can lull you into writing dense, side-effect-heavy expressions that *work* but read poorly. |
| Portable behavior across implementations. | None that matter much for application code. |

**Of languages that leave it unspecified (C, C++ arguments):**

| Pros | Cons |
|------|------|
| Compiler is free to choose the fastest argument-evaluation order for the target ABI. | Code that depends on order is non-portable and may silently change behavior. |
| Enables some register-allocation and instruction-scheduling wins. | Opens the door to undefined behavior when reads/writes of the same object collide. |

The deeper trade-off — why C chose unspecified order on purpose — is the "as-if rule" story in `professional.md`.

---

## Use Cases

- **Guarded dereferences:** `ptr != NULL && ptr->field` relies on `&&` ordering. Used in essentially every C/Java/Go codebase.
- **Default fallbacks:** `value ?? default` / `a || fallback` use short-circuit ordering to avoid evaluating the fallback when not needed.
- **Lazy / expensive checks:** `cheapCheck() && expensiveCheck()` puts the cheap test first so the expensive one is skipped most of the time — an ordering-based optimization you control.
- **Iterator consumption:** in left-to-right languages, `pair = (next(it), next(it))` consumes in order — but the explicit two-line form is safer.
- **Logging inside conditions:** be careful — a side-effecting log call inside `a && log()` will only run when `a` is true. That's sometimes intentional, often a bug.

---

## Coding Patterns

**Pattern: Hoist side effects out of expressions.**

```python
# Instead of:
process(get_next(), get_next())

# Do:
first = get_next()
second = get_next()
process(first, second)
```

**Pattern: Use short-circuit ordering intentionally, and document it.**

```java
// cheap-first: never call expensiveValidate() unless quickValidate() passed.
if (quickValidate(x) && expensiveValidate(x)) { ... }
```

**Pattern: One mutation per statement.**

```c
a[i] = value;
i++;            // not  a[i] = value, i++  crammed together with a read of i
```

**Pattern: Prefer pure expressions in arithmetic.** Keep `i++`, `print()`, and assignments *out* of arithmetic expressions, so order can never change the result.

---

## Best Practices

1. **Never read and write the same variable in one expression** — especially in C/C++, where it is undefined behavior.
2. **Don't rely on the evaluation order of function arguments** unless your language *guarantees* it (and even then, prefer clarity).
3. **Keep at most one side effect per statement.** This makes order irrelevant.
4. **Lean on `&&` / `||` ordering deliberately** — it's the one ordering guarantee you have everywhere — but keep the cheap/safe test on the left.
5. **Know your language's bucket:** left-to-right (Java/C#/JS/Python/Rust) or unspecified (C/C++ args).
6. **Turn on warnings:** `-Wsequence-point`, `-Wunsequenced`, or a linter catches the classic traps automatically.
7. **When in doubt, split it out:** two clear statements beat one clever expression.

---

## Edge Cases & Pitfalls

- **`i = i++;`** — Looks like it should leave `i` incremented (or unchanged). In C/C++ it's **undefined**. In Java it's *defined* and surprisingly leaves `i` **unchanged** (the old value is stored back over the increment). Same syntax, totally different fates.
- **`f() + g()` where both print** — works, but the print order is unspecified in C. Don't depend on it.
- **`arr[i++] = arr[i]`** — reads and writes around the same `i`; UB in C/C++.
- **Logging in a short-circuit** — `if (ok && logAndReturnTrue())` only logs when `ok` is true. Easy to misread.
- **Assuming precedence implies order** — `a() + b() * c()`: the `*` groups tighter, but `a()` may still run first. Grouping ≠ timing.
- **Ternary `cond ? a() : b()`** — only one branch runs; that's an ordering/short-circuit guarantee, not "both evaluated."
- **Increment in array index** — `data[index++] = index;` reads `index` after modifying it; in left-to-right languages the right side is evaluated before the assignment target's index in some, after in others — read your spec, or just split it.

---

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|----------------|-----|
| Believing precedence sets order | Precedence only groups; order is separate | Memorize: tree shape ≠ walk order |
| `printf("%d %d", i++, i++)` in C | Argument order is unspecified | Split into separate statements |
| `a[i] = i++;` in C/C++ | Undefined behavior (read+write of `i`) | `a[i] = ...; i++;` |
| Assuming all languages are left-to-right | C/C++ args are unspecified | Check your language's spec |
| Relying on `&&` to *not* matter | It absolutely matters: it controls whether the right side runs | Put the guard/cheap test on the left |
| Cramming side effects into arithmetic | Makes results order-dependent | Hoist side effects to their own lines |

---

## Cheat Sheet

```
PRECEDENCE  = grouping ("a + b * c" means "a + (b*c)")     -- compile time, shapes the tree
ORDER       = timing (which sub-expression runs first)     -- separate decision

LEFT-TO-RIGHT (guaranteed): Java, C#, JavaScript, Python*, Rust
UNSPECIFIED  (don't depend): C and C++ FUNCTION ARGUMENTS
UNDEFINED    (never do):     C/C++ read AND write same var in one expr  -> a[i]=i++

ALWAYS ORDERED (every language): &&  ||  ?:  ??   (short-circuit, left first)
THE COMMA OPERATOR (C/C++): left fully, discard, then right -> guaranteed order

GOLDEN RULES
  1. One side effect per statement.
  2. Never read+write the same variable in one expression.
  3. Don't trust argument order unless the spec promises it.
  4. Put the safe/cheap test on the LEFT of && / ||.
```

---

## Summary

**Evaluation order** is the order in which a language computes the sub-pieces of an expression — and it is *not* the same thing as operator precedence, which merely decides grouping. For pure code the order is invisible, but the moment a side effect (`i++`, `print`, an impure call) enters the picture, order decides correctness. Most modern languages — Java, C#, JavaScript, Python, Rust — guarantee **left-to-right** evaluation. C and C++ deliberately leave function-argument order **unspecified**, and worse, reading and writing the same variable in one expression (`a[i] = i++`) is **undefined behavior**. The one ordering guarantee you have *everywhere* is short-circuit `&&` / `||` / `??`, which always evaluate left-first and skip the right when the answer is already known. The junior-level discipline is simple and bulletproof: **one side effect per statement, never read-and-modify the same variable in one expression, and don't depend on argument order.** Obey that, and evaluation-order bugs can't touch you. The next level, `middle.md`, formalizes *why* `a[i] = i++` is undefined by introducing C's "sequence points" and C++'s "sequenced-before" relation.
