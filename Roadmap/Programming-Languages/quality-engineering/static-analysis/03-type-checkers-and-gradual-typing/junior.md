# Type Checkers & Gradual Typing — Junior Level

> **Roadmap:** [Static Analysis](../README.md) → Type Checkers & Gradual Typing

*A type checker is the cheapest static analyzer you will ever run, and it catches an entire family of bugs before your code executes once.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A type checker is a static analyzer](#core-concept-1----a-type-checker-is-a-static-analyzer)
5. [Core Concept 2 — The bugs types catch before runtime](#core-concept-2----the-bugs-types-catch-before-runtime)
6. [Core Concept 3 — Your first annotations in TypeScript](#core-concept-3----your-first-annotations-in-typescript)
7. [Core Concept 4 — Your first annotations in Python](#core-concept-4----your-first-annotations-in-python)
8. [Core Concept 5 — Running the checker and reading errors](#core-concept-5----running-the-checker-and-reading-errors)
9. [Core Concept 6 — Inference and the editor feedback loop](#core-concept-6----inference-and-the-editor-feedback-loop)
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

> Focus: **Understanding that a type checker is a static analysis tool that proves the absence of whole categories of bugs — and writing your first type annotations.**

When you call `user.nmae` instead of `user.name`, a dynamically typed language like JavaScript or Python won't complain until that exact line runs — maybe in production, maybe at 2 a.m. A type checker reads your code *without running it* and tells you immediately: there is no `nmae` on that object.

That is static analysis: analysis of code as text, before execution. A type checker is the most valuable static analysis you can adopt because it doesn't just flag suspicious patterns — for the classes of bugs it covers, it *proves* they cannot happen. No wrong-type call. No `undefined is not a function`. No `AttributeError`. If the checker passes, those bugs are gone, not "less likely."

This page is your entry point: what a type checker actually does, what it catches, and how to write annotations a checker can use.

## Prerequisites

- You can write and run a small program in **JavaScript/TypeScript** or **Python**.
- You understand basic values: strings, numbers, booleans, arrays/lists, objects/dicts, functions.
- You've hit at least one runtime crash caused by a wrong value (a `TypeError`, `undefined`, or `None`).
- You can run a command in a terminal (`tsc`, `mypy`, `pyright`).

## Glossary

| Term | Meaning |
|------|---------|
| **Type** | A label describing the shape of a value: `string`, `number`, `User`, `list[int]`. |
| **Type checker** | A static analyzer that verifies your code uses types consistently, without running it. |
| **Static** | Done by reading source code, before execution. The opposite is **runtime/dynamic**. |
| **Annotation / type hint** | Syntax you add to declare a type, e.g. `name: str` or `name: string`. |
| **Inference** | The checker figuring out a type you didn't write, e.g. `const x = 5` is a `number`. |
| **`null` / `None` / `undefined`** | The "no value" values — the single largest source of runtime crashes. |
| **TypeScript (TS)** | A typed superset of JavaScript; `tsc` is its compiler/checker. |
| **mypy / pyright** | The two main type checkers for Python type hints. |
| **Compile-time error** | An error the checker reports before the program runs. |

## Core Concept 1 — A type checker is a static analyzer

Static analysis is any tool that inspects your code without executing it: linters, formatters, security scanners — and type checkers. Among them, the type checker is special.

A **linter** says: "this *looks* risky" (heuristic). A **type checker** says: "this *is* inconsistent, here is the proof" (it tracks the type of every value through your program).

```ts
function greet(name: string) {
  return "Hello, " + name.toUpperCase();
}

greet(42); // the checker rejects this before the program runs
```

```
$ tsc
index.ts:5:7 - error TS2345: Argument of type 'number' is not assignable
to parameter of type 'string'.

5 greet(42);
        ~~
```

No program executed. No test ran. The mistake was caught by *reading* the code. That is the leverage: one checker run, every line, every call site, every time you save.

## Core Concept 2 — The bugs types catch before runtime

A type checker eliminates a specific, common family of bugs:

- **Wrong-type bugs** — passing a `string` where a `number` is expected, calling a function with the wrong arguments.
- **Missing-field bugs** — reading `user.email` when the object has no `email`, or typos like `user.nmae`.
- **Null-dereference bugs** — using a value that might be `null`/`None`/`undefined`.

```python
def total_price(items: list[float]) -> float:
    return sum(items)

total_price("10.0")  # mypy: error
```

```
$ mypy shop.py
shop.py:4: error: Argument 1 to "total_price" has incompatible type
"str"; expected "list[float]"  [arg-type]
Found 1 error in 1 file (checked 1 source file)
```

These are not exotic bugs. In real codebases they are *most* of the crashes. Catching them at the keyboard instead of in production is why type checking is described as the highest-leverage analysis you can run in a dynamic language.

## Core Concept 3 — Your first annotations in TypeScript

TypeScript adds type annotations to JavaScript. You write the same code, plus small labels after a colon.

```ts
// Parameters and return type
function area(width: number, height: number): number {
  return width * height;
}

// Variables — usually inferred, so you rarely annotate them
const name = "Ada";        // inferred as string
let count: number = 0;     // explicit (only needed when inference can't help)

// Object shapes
type User = {
  id: number;
  name: string;
  email?: string;          // the ? means "optional"
};

function welcome(u: User): string {
  return `Welcome, ${u.name}`;
}
```

Key habit: **annotate function boundaries (parameters and return types); let inference handle the rest.** The checker propagates types outward from your annotations.

## Core Concept 4 — Your first annotations in Python

Python type hints look almost identical. They are optional and ignored at runtime — they exist purely for the checker (and your editor).

```python
from typing import Optional

def area(width: float, height: float) -> float:
    return width * height

# A value that might be missing uses Optional (i.e. "X or None")
def find_user(user_id: int) -> Optional[str]:
    if user_id == 1:
        return "Ada"
    return None

name = find_user(2)
print(name.upper())   # mypy flags this: name could be None
```

```
$ mypy users.py
users.py:11: error: Item "None" of "Optional[str]" has no
attribute "upper"  [union-attr]
```

The checker noticed that `find_user` can return `None`, and `None` has no `.upper()`. It forces you to handle the missing case — which is exactly the bug you'd otherwise ship.

## Core Concept 5 — Running the checker and reading errors

You run a type checker like any CLI tool. It exits non-zero on errors, so it slots straight into your editor and CI.

**TypeScript:**
```bash
npx tsc --noEmit          # check only, don't produce JS
```

**Python (mypy):**
```bash
pip install mypy
mypy app.py               # or: mypy .
```

**Python (pyright — faster, used by VS Code's Pylance):**
```bash
npx pyright app.py
```

Read errors top-to-bottom and fix the *first* one first — later errors are often just fallout from the first. Every error names a file, a line, the actual type, and the expected type. The error code in brackets (`[arg-type]`, `TS2345`) is searchable and lets you suppress or configure that specific rule later.

## Core Concept 6 — Inference and the editor feedback loop

You don't have to annotate everything, because the checker *infers* types from values. This is what makes typed code pleasant instead of verbose.

```ts
const nums = [1, 2, 3];        // inferred: number[]
const doubled = nums.map(n => n * 2);  // n inferred number, result number[]
const first = nums[0];         // inferred number

const user = { id: 1, name: "Ada" };  // inferred { id: number; name: string }
user.email;                    // error: Property 'email' does not exist
```

```python
nums = [1, 2, 3]               # inferred list[int]
total = sum(nums)              # inferred int
```

Inference flows outward from the values you write and the boundaries you annotate. The practical payoff shows up in your **editor**: because the checker runs continuously, you get red underlines and autocomplete *as you type* — the same analysis that runs in CI runs in your IDE. When you type `user.`, the editor lists exactly the fields that exist. That tight feedback loop — catch the mistake the instant you make it — is most of why types feel productive rather than bureaucratic.

The skill is knowing the boundary: annotate function inputs/outputs and data shapes (where inference can't read your intent), and let inference handle locals, loop variables, and intermediate results.

## Real-World Examples

**1. The renamed field.** A teammate renames `user.fullName` to `user.name`. In plain JS, every old call site silently returns `undefined` until a user notices a blank screen. With types, `tsc` lists *every* broken call site in one run — the rename becomes a 5-minute, checker-guided fix.

**2. The API that returns null.** `fetchProfile()` returns `Profile | null`. Without types you write `profile.avatar` and crash on the first logged-out user. With types the checker won't let you touch `profile` until you've handled `null`.

**3. The wrong argument order.** `transfer(amount, fromAccount, toAccount)` called as `transfer(fromAccount, toAccount, amount)`. If `amount` is a `number` and accounts are `Account` objects, the checker rejects the swapped call instantly.

## Mental Models

- **Spell-check for values.** A type checker is to your data shapes what spell-check is to your prose: it flags inconsistencies as you type, before anyone else reads it.
- **A proof, not a guess.** A linter warns; a type checker proves. If `tsc` passes, the wrong-type bugs it covers are genuinely impossible — not unlikely.
- **Annotate the doors, not the rooms.** Put types on function inputs and outputs (the doors). Inference fills in the inside (the rooms).
- **`null` is a value, not an absence.** The checker treats "might be null" as a distinct type you must handle — that's the feature, not the annoyance.

## Common Mistakes

- **Annotating everything.** Beginners type every local variable. Don't — inference is excellent. Annotate boundaries; let the rest be inferred.
- **Ignoring the first error and reading the last.** Fix errors top-down; the first cause often resolves several downstream errors.
- **Reaching for `any` / `Any` immediately.** When the checker complains, the instinct is to silence it with `any`. That throws away the protection. Understand the error first.
- **Thinking hints run at runtime (Python).** Python type hints are *not* enforced when the program runs; passing the wrong type still "works" until it crashes. The checker is what enforces them, statically.
- **Not actually running the checker.** Annotations you never check are just comments. Run `tsc`/`mypy` locally and in CI.

## Test Yourself

1. In one sentence, how is a type checker different from a linter?
2. Name the three families of bugs a type checker eliminates.
3. What does `email?: string` mean in a TypeScript `type`?
4. Why does `name.upper()` fail when `name: Optional[str]`?
5. Which function parts should you almost always annotate, and which can you leave to inference?
6. Do Python type hints affect how the program behaves at runtime? Why or why not?

## Cheat Sheet

```ts
// TypeScript
function f(x: number, y: string): boolean { ... }   // annotate boundaries
type User = { id: number; name: string; email?: string };  // ? = optional
const n = 5;            // inferred — don't annotate
npx tsc --noEmit        // run the checker
```

```python
# Python
from typing import Optional
def f(x: int, y: str) -> bool: ...        # annotate boundaries
def find() -> Optional[str]: ...          # str or None
mypy app.py                                # run the checker
```

| Symptom | Likely cause |
|---------|--------------|
| `not assignable to parameter` | Wrong-type argument |
| `has no attribute` / `Property does not exist` | Typo or missing field |
| `Object is possibly 'null'` / `union-attr` | Unhandled null/None |

## Summary

A type checker is a static analyzer that reads your code without running it and proves the absence of wrong-type, missing-field, and null-dereference bugs. It's the highest-leverage analysis in a dynamic language because it converts whole categories of runtime crashes into instant, file-and-line errors at the keyboard. You add value by annotating function boundaries in TypeScript or Python, letting inference do the rest, and running `tsc`/`mypy`/`pyright` locally and in CI. Resist silencing errors with `any` — the error is information about a real bug.

## Further Reading

- *TypeScript Handbook* — "The Basics" and "Everyday Types".
- *mypy documentation* — "Getting started" and "Type hints cheat sheet".
- *Pyright documentation* — getting started and configuration.
- PEP 484 — Type Hints (the standard behind Python annotations).

## Related Topics

- [Linters and Style Checkers](../01-linters-and-style-checkers/) — the other everyday static analysis you run on save.
- [Static Analysis in CI](../09-static-analysis-in-ci/) — making the type checker a required check.
- For the theory behind types themselves, see the **type-systems** material under `language-internals` (`../../../language-internals/type-systems/`).
