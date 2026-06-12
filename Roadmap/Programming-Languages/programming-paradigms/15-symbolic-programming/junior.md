# Symbolic Programming — Junior Level

> **Roadmap:** [Programming Paradigms](../README.md) → Symbolic Programming
> *Most code computes with numbers. Symbolic programming computes with **expressions** — and the program's own code is one of those expressions.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Symbols vs Values](#core-concept-1--symbols-vs-values)
5. [Core Concept 2 — Expressions Are Data You Can Build and Transform](#core-concept-2--expressions-are-data-you-can-build-and-transform)
6. [Core Concept 3 — Code Is Data (Homoiconicity)](#core-concept-3--code-is-data-homoiconicity)
7. [Core Concept 4 — Transforming Expressions: Symbolic Math](#core-concept-4--transforming-expressions-symbolic-math)
8. [Numeric vs Symbolic — The Same Task, Two Worlds](#numeric-vs-symbolic--the-same-task-two-worlds)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is it, and why does it matter?**

Almost every program you've written *computes a value*. You feed it numbers or strings, it grinds through some steps, and out comes an answer: `2 + 3` gives `5`, and the `2`, the `3`, and the `+` all vanish the instant the result is known. The machine kept the answer and threw away the question.

Symbolic programming keeps the question. Instead of immediately collapsing `2 + 3` into `5`, it can hold onto the *structure* — "an addition of 2 and 3" — as a piece of data you can inspect, store, pass around, pattern-match on, and rewrite. And when one of the operands is a **symbol** like `x` rather than a number, you *have* to keep the structure, because `x + 3` has no number you could collapse it to. You can still do useful work on it: simplify it, differentiate it, substitute a value for `x` later. You are manipulating *meaning*, not arithmetic.

The most famous form of this idea goes one step further. In the **Lisp** family of languages, the program's own source code is itself one of these data structures — a nested list. `(+ 1 2)` is simultaneously *a call to add one and two* and *a three-element list* `[+, 1, 2]` that another part of your program can pick apart and rebuild. Code and data have the same shape. That property is called **homoiconicity**, and it's the engine behind the most powerful idea in this paradigm: **programs that write programs**.

> **The mindset shift:** stop thinking of code as something that only *runs*. Start thinking of expressions — including code — as **structured data you can build, take apart, and transform** before (or instead of) running them.

---

## Prerequisites

- **Required:** You can read basic code — variables, function calls, lists/arrays. Examples use **Scheme/Lisp** (the canonical symbolic language), **Python** (with the SymPy library), and a little pseudocode.
- **Required:** You know what a nested list or tree looks like (a list that contains other lists).
- **Helpful:** You've seen a function called with arguments, e.g. `add(2, 3)`. That `add(2, 3)` and Lisp's `(+ 2 3)` are *the same idea* is half of this topic.
- **Helpful:** A little high-school algebra — you remember that the derivative of `x²` is `2x`. We'll make a program do that by *moving symbols around*, not by computing.
- **Not required:** Any Lisp experience. We introduce just enough syntax to read the examples.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Symbol** | A name treated as a *thing in itself*, not as a stand-in for a value. In `x + 3`, `x` is a symbol you can keep and manipulate without knowing its value. |
| **Symbolic expression** | A structured representation of a computation — e.g. "the sum of `x` and 3" — held as data rather than evaluated to a number. |
| **S-expression** | Lisp's notation for a nested list, written with parentheses: `(+ 1 (* 2 3))`. The universal shape for both code and data in Lisp. |
| **Homoiconicity** | "Same representation": a language where code is written in the same data structure the language can manipulate — so code *is* data. |
| **Evaluation** | Turning an expression into its value: evaluating `(+ 1 2)` yields `3`. |
| **Quote** | Telling the language *not* to evaluate an expression, so you get it as data instead. `'(+ 1 2)` is the list `(+ 1 2)`, not `3`. |
| **Term rewriting** | Transforming an expression by matching a pattern and replacing it with another — e.g. rewrite `x + 0` to `x`. The basic move of symbolic computation. |
| **CAS (Computer Algebra System)** | Software that does *exact symbolic math*: simplify, differentiate, integrate, solve equations — by transforming expressions. Examples: SymPy, Mathematica, Maple. |
| **Numeric computation** | Computing with actual numbers (often approximate, like `0.333...` for ⅓). The opposite end from symbolic. |

> The two words to lock in now: **symbol** (a name you manipulate as data) and **homoiconicity** (code and data share one shape). Almost everything in this topic grows from those two.

---

## Core Concept 1 — Symbols vs Values

In ordinary programming, a name is a *box*: `x = 5` means "wherever I write `x`, use 5." The name is a convenience that disappears — the program really cares about the `5`.

In symbolic programming, a name can be a *first-class thing*. The symbol `x` can exist and be manipulated **even when it has no value at all**. Consider:

```python
from sympy import symbols
x, y = symbols("x y")     # declare x and y as symbols, not numbers

expr = x + y              # this does NOT compute anything
print(expr)               # x + y
```

`x + y` did not raise "x is undefined." It produced an *expression object* representing the sum of two symbols. There's nothing to add yet — and that's fine, because the point isn't the number, it's the structure.

This is the first mental flip. A symbol is a value in its own right:

- A **number** (`5`) answers "how much?"
- A **symbol** (`x`) answers "which named thing?" — and lets you defer "how much?" indefinitely, or forever.

Why would you ever want a name with no value? Because enormous amounts of useful work happen *before* any value is known: algebra ("simplify `2x + 3x` to `5x`" — true regardless of what `x` is), compilers ("optimize this code" — without running it), and rule systems ("if symptom A and symptom B, conclude C" — matching symbols, not numbers). All of these manipulate symbols.

---

## Core Concept 2 — Expressions Are Data You Can Build and Transform

Here is the core idea in one picture. The expression `2 * (x + 3)` is naturally a **tree**:

```
        *
       / \
      2   +
         / \
        x   3
```

A symbolic system holds exactly this tree as data. You can ask it questions and rebuild it:

```python
from sympy import symbols, expand
x = symbols("x")

e = 2 * (x + 3)
print(e.args)        # (2, x + 3)   — the parts of the multiplication
print(e.func)        # the operation at the top: Mul

print(expand(e))     # 2*x + 6      — a NEW expression, built by transforming the tree
```

Three things just happened that don't happen with ordinary numbers:

1. **You inspected the structure** (`.args`, `.func`) — the expression knows it's "a multiplication of 2 and (x + 3)."
2. **You transformed it into a different but equivalent expression** (`expand` turned `2*(x+3)` into `2*x + 6`).
3. **Nothing was "computed" in the numeric sense** — no final number came out, because none exists yet. You moved *symbols* around according to the rules of algebra.

That third point is the heart of the paradigm: **the output of a symbolic operation is another expression, not a number.** You can keep transforming — simplify it, differentiate it, factor it — chaining expression-to-expression steps, only dropping to a number at the very end (if ever) by substituting values in.

This is exactly how a calculator differs from a mathematician. A calculator computes `2 × (4 + 3) = 14`. A mathematician can say `2(x + 3) = 2x + 6` *for every x* — transforming the form, not crunching a case. Symbolic programming gives the machine the mathematician's move.

---

## Core Concept 3 — Code Is Data (Homoiconicity)

Now the deepest idea, and the one that gives this paradigm its reputation. In the **Lisp** family, you write code as parenthesized lists called **s-expressions**:

```scheme
(+ 1 2)            ; calls + on 1 and 2  →  evaluates to 3
(* 2 (+ x 3))      ; multiply 2 by (x + 3)
(define (square n) (* n n))   ; define a function
```

The rule is uniform: a list `(f a b)` means "call `f` with arguments `a` and `b`." The first element is the operation; the rest are arguments. This is the same `add(2, 3)` you already know — Lisp just moves the function name *inside* the parentheses: `(add 2 3)`.

Here's the twist. That very same `(+ 1 2)` is also **just a list of three things**: the symbol `+`, the number `1`, the number `2`. And Lisp lets you grab it *as a list* instead of running it, using a **quote** (`'`):

```scheme
(+ 1 2)        ; → 3            (evaluated: it's code)
'(+ 1 2)       ; → (+ 1 2)      (quoted: it's data — a 3-element list)

(define code '(+ 1 2))
(car code)     ; → +    the first element  (the operator!)
(cdr code)     ; → (1 2)  the rest (the operands)
```

Read that again. The **exact same text** is *code that adds* and *a list you can pick apart*. The only difference is whether you evaluate it or quote it. That is **homoiconicity**: code and data are written in, and stored as, the same structure.

Why is this a superpower? Because if your code is data, you can write code that **builds other code as data and then runs it**:

```scheme
;; Build the list (+ 1 2) programmatically, then evaluate it.
(define built (list '+ 1 2))   ; construct the list  (+ 1 2)
(eval built)                    ; → 3   run the code we just built!
```

A program that constructs and runs programs. In most languages, generating code means smashing strings together and hoping they parse. In Lisp, generating code means building a *list* — using the same list functions you use for any other data. This is the seed of **macros** (you'll meet them at the middle level): programs that write programs at compile time. For now, the single thing to absorb:

> In a homoiconic language, **there is no wall between "code" and "data."** A list is a list; whether it runs depends only on whether you ask it to.

---

## Core Concept 4 — Transforming Expressions: Symbolic Math

Let's make the paradigm earn its keep with a concrete win: **differentiating `x²` to get `2x` — without computing a single number.**

A numeric approach would *estimate* the derivative by plugging in nearby numbers (`(f(x+h) - f(x)) / h` for tiny `h`) and get an approximate decimal. The symbolic approach instead **transforms the expression** using the rules of calculus, the same ones you learned in school, applied as *rewrite rules on the tree*:

- Rule: the derivative of `xⁿ` is `n · xⁿ⁻¹`.
- Apply it to `x²` (here `n = 2`): get `2 · x¹` = `2x`. Exactly. Forever. No decimals.

In SymPy:

```python
from sympy import symbols, diff
x = symbols("x")

print(diff(x**2, x))        # 2*x          — exact, symbolic
print(diff(x**3 + 2*x, x))  # 3*x**2 + 2   — applied term by term
```

What `diff` did was walk the expression tree and apply differentiation rules at each node, building a *new* tree as the answer. No `x` value was needed because the result is true for **all** `x`. That's the symbolic promise: an *exact, general* answer, expressed as another symbol expression you can keep working with.

You can do the same for simplification, which is pure **term rewriting** — match a pattern, replace it:

```python
from sympy import symbols, simplify
x = symbols("x")

print(simplify(x + x))          # 2*x      (rewrote x + x → 2x)
print(simplify((x**2 - 1)/(x - 1)))  # x + 1   (cancelled the common factor)
```

Each step is "this pattern means the same as that simpler pattern; replace it." Stack thousands of such rules together and you have a **Computer Algebra System** — a program that does algebra and calculus exactly, by rewriting expressions. We'll see how the rules themselves are written at the middle level.

---

## Numeric vs Symbolic — The Same Task, Two Worlds

> Task: **find the slope of `x²` and evaluate one-third.**

```python
# NUMERIC — compute with actual (often approximate) numbers.
h = 1e-6
slope_at_4 = ((4 + h)**2 - 4**2) / h     # ≈ 8.000001  (an estimate near x=4)
third = 1 / 3                             # 0.3333333333333333  (truncated)
```

```python
# SYMBOLIC — transform expressions; stay exact and general.
from sympy import symbols, diff, Rational
x = symbols("x")
slope = diff(x**2, x)                     # 2*x        (the derivative for EVERY x)
slope_at_4 = slope.subs(x, 4)             # 8          (exact, by substitution)
third = Rational(1, 3)                    # 1/3        (kept exact, not 0.333…)
```

Compare what each world gives you:

| | Numeric | Symbolic |
|---|---|---|
| Works with | Actual numbers | Symbols & expressions |
| `diff(x²)` gives | a number at one point (≈8.000001) | the formula `2x`, true everywhere |
| `1/3` is | `0.333…` (approximate) | `1/3` (exact) |
| Generality | one input at a time | the whole expression at once |
| Speed / scale | fast, scales to huge data | can be slow; expressions can balloon |

Neither is "better" — they answer different questions. Numeric computation powers graphics, machine learning, and physics simulations where you need speed and concrete values. Symbolic computation powers algebra systems, compilers, and proof tools where you need *exactness* and *generality*. A mature engineer reaches for the right one (and sometimes uses symbolic to *derive* a formula, then numeric to *evaluate* it fast).

---

## Real-World Examples

| Thing you've used or heard of | The symbolic idea inside it |
|---|---|
| **WolframAlpha / Mathematica** | A CAS — solves, simplifies, integrates by rewriting expressions, not crunching numbers. |
| **SymPy** (Python) | Symbolic math in code: `diff`, `integrate`, `solve` on expression trees. |
| **A compiler** | Parses your code into a tree (AST) and *rewrites* it — optimizing, transforming — before emitting machine code. Pure symbolic programming. |
| **Lisp / Clojure / Racket** | Homoiconic languages where code is lists; macros are programs that write programs. |
| **Spreadsheet showing `=A1+B1`** | The *formula* is kept as a symbolic expression, re-evaluated when cells change — not collapsed to a one-time number. |
| **`x + 0 → x` in your optimizer** | A term-rewriting rule. Optimizers are full of them. |
| **Theorem provers (Coq, Lean)** | Manipulate logical expressions symbolically to *prove* statements. |

Notice the pattern: anywhere a tool reasons about *the form of an expression* — math software, compilers, optimizers, proof assistants — symbolic programming is underneath.

---

## Mental Models

- **The calculator vs the mathematician.** A calculator collapses `2 × (4+3)` to `14` and forgets the question. A mathematician writes `2(x+3) = 2x+6` — true for all `x`, keeping the *form*. Symbolic programming gives the machine the mathematician's move: transform the expression, don't just evaluate it.
- **Code as Lego, not as glue.** In string-based metaprogramming, building code means gluing text and praying it parses. In a homoiconic language, code is **Lego bricks** (lists): you snap them together and take them apart with ordinary list operations, and the result is guaranteed to be well-formed structure.
- **The recipe you can edit before cooking.** Ordinary code is a meal already cooked. A symbolic expression is the *recipe* — still written down, still editable. You can rewrite "add salt" to "add no salt," reorder steps, or read it to a friend, all *before* anyone cooks. Evaluation is the cooking; until then it's data.
- **Quote = "hold, don't run."** A quote (`'`) is a pause button. `(+ 1 2)` runs; `'(+ 1 2)` hands you the list to inspect. The same text, two modes — that *is* homoiconicity.

---

## Common Mistakes

- **Thinking a symbol is a variable with an unknown value.** A symbol isn't "an `x` we'll fill in later"; it's a *thing you manipulate directly*. `x + x` simplifies to `2x` with no value for `x` anywhere in sight — the work happens on the symbol itself.
- **Expecting a number to come out.** `diff(x**2, x)` returns `2*x`, an *expression*, not a number. The output of symbolic operations is (almost always) more symbols. Forgetting this and printing-then-panicking is the classic first stumble.
- **Confusing "homoiconic" with "interpreted" or "dynamic."** Plenty of dynamic languages (Python, JS) are *not* homoiconic — their code is not naturally available as data you manipulate. Homoiconicity is specifically: *code is written in the same data structure the language can build and inspect* (Lisp's lists).
- **Treating symbolic math as always fast and exact-and-free.** Exactness has a cost: symbolic expressions can **swell** enormously (an "integrate" can return a page-long formula), and operations can be slow or even not terminate. Numeric methods exist precisely because symbolic ones don't scale to everything.
- **Building code with string concatenation when the language is homoiconic.** If you're in Lisp/Clojure and gluing strings to make code, you're throwing away the paradigm's whole point — build *lists*, not strings.

---

## Test Yourself

1. In one sentence, what's the difference between a **symbol** and a **value**?
2. The expression `2 * (x + 3)` is held as a tree. Draw it, and name the operation at the top.
3. What does **homoiconicity** mean, and what is the *one* thing that makes `(+ 1 2)` both code and data?
4. What does a **quote** (`'`) do to `'(+ 1 2)`? What do you get back?
5. `diff(x**3, x)` — does this return a number or an expression? What is it, and *why* didn't it need a value for `x`?
6. Give one task where you'd want **numeric** computation and one where you'd want **symbolic**, and say why.
7. "Rewrite `x + 0` to `x`" — what general technique is this an example of, and where (in tools you've used) does it show up?

> Try each before reading on. If #3 or #4 is fuzzy, re-read [Code Is Data](#core-concept-3--code-is-data-homoiconicity).

---

## Cheat Sheet

```
SYMBOLIC PROGRAMMING = manipulate SYMBOLS and EXPRESSIONS as first-class data
                       (including the program's own code).

SYMBOL vs VALUE:
  value   5       answers "how much?"          (gets computed away)
  symbol  x       answers "which named thing?" (kept and manipulated)

EXPRESSIONS ARE DATA:
  2*(x+3) is a TREE you can inspect (.args), rebuild (expand → 2x+6),
  and transform — output is another EXPRESSION, not a number.

HOMOICONICITY (Lisp):  code IS data, same shape (s-expressions / lists)
  (+ 1 2)    evaluated → 3          (it's code)
  '(+ 1 2)   quoted    → (+ 1 2)    (it's data — a 3-element list)
  (eval (list '+ 1 2)) → 3          program builds & runs a program

SYMBOLIC MATH (CAS):  transform, don't compute
  diff(x**2, x)  → 2*x        exact, true for ALL x  (calculus as rewrite rules)
  simplify(x+x)  → 2*x        TERM REWRITING: match a pattern, replace it

NUMERIC vs SYMBOLIC:
  numeric  = actual (approx) numbers, fast, scales      (graphics, ML, physics)
  symbolic = exact & general expressions, can be slow   (algebra, compilers, proofs)

LIVES IN: Lisp/Clojure/Racket · SymPy/Mathematica/Maple · compilers (AST) · provers
```

---

## Summary

**Symbolic programming** is the paradigm where you manipulate **symbols and symbolic expressions** as first-class data — including, in the Lisp tradition, the program's own code. Its three pillars: a **symbol** is a name you work with directly (no value needed); an **expression** is structured data (a tree) you can inspect, build, and *transform* into another expression rather than collapse to a number; and **homoiconicity** means code and data share one representation, so a list like `(+ 1 2)` is simultaneously runnable code and inspectable data — the foundation for programs that write programs. The everyday payoff is **symbolic computation**: a CAS differentiates `x²` to `2x` exactly and for all `x` by applying calculus rules as **term-rewriting** transformations on the expression tree, never touching a concrete number. This trades the speed and scale of **numeric** computation for *exactness* and *generality*, which is why symbolic programming powers computer-algebra systems, compilers, optimizers, and theorem provers — anywhere a tool must reason about the *form* of an expression rather than just its value.

---

## Further Reading

- *Structure and Interpretation of Computer Programs* (SICP), §2.3 "Symbolic Data" and §3.3.3 — symbolic differentiation built from scratch in Scheme. The canonical first encounter with this paradigm.
- Paul Graham, *On Lisp* (early chapters) — why code-as-data and macros change how you program.
- The [SymPy tutorial](https://docs.sympy.org/) — symbolic math in Python, hands-on.
- Peter Norvig, *Paradigms of Artificial Intelligence Programming* (Ch. 1–2) — the Lisp/AI symbolic tradition, gently.

---

## Related Topics

- [`middle.md`](middle.md) — s-expressions in depth, quote/eval, macros, building a DSL, and writing term-rewriting rules.
- [`senior.md`](senior.md) — the trade-offs: expressive power vs readability, macro hygiene, when symbolic is the right tool, expression swell.
- [`professional.md`](professional.md) — where this lives in industry: Clojure/Racket macros, compilers, CAS, provers, neuro-symbolic AI.
- [01 — Overview & Taxonomy](../01-overview-and-taxonomy/) — where symbolic sits on the paradigm map.
- [04 — Logic Programming](../04-logic-programming/) — its close cousin: facts, rules, and unification also manipulate symbols.
- [Functional Programming](../../code-craft/functional-programming/) — Lisp's other half; symbolic programming grew up alongside FP.
