# Eager vs. Lazy Evaluation — Junior Level

> **Topic:** [Eager vs. Lazy Evaluation](README.md)
> **Focus:** When does an expression actually *run*? Right now, or only when its value is finally needed? And why does the answer change how you write code.

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

---

## Introduction

> Focus: **What does it mean for code to run "now" versus "later"?** And why the difference is something you already use every day without naming it.

Most code you have written so far is **eager**. When you write

```python
x = expensive() + 1
```

the language calls `expensive()` *immediately*, gets a value back, adds one, and stores the result in `x`. The work happens at the moment the line executes. This is the default in almost every mainstream language — Python, JavaScript, Java, C#, Go, C, Ruby. It is called **eager evaluation** (or **strict evaluation**): arguments and sub-expressions are evaluated as soon as you reach them.

**Lazy evaluation** is the opposite stance: *don't compute a value until something actually needs it.* You build a description of the work — "here is how to get `x` when you ask for it" — and the work stays unexecuted, parked, until the very first moment its result is required. If nobody ever asks, the work never runs at all.

You have already met laziness, even if nobody called it that. When you write `a && b` in any language, `b` is **not evaluated** if `a` is already `false`. When you write `cond ? whenTrue : whenFalse`, only one of the two branches runs. That selective, on-demand evaluation *is* laziness. The big idea of this topic is to take that small, familiar trick and turn it into a general strategy: lists that are infinite, values that compute themselves the first time you read them, and pipelines that do zero wasted work.

In one sentence: **eager means "do it now"; lazy means "do it only if and when the answer is needed."**

> 🎓 **Why this matters for a junior:** The single most common bug junior engineers hit with laziness is "my code didn't run." You write a `.map()` or a LINQ query or a Python generator, nothing happens, and you can't see why. The reason is always the same: the thing you built was *lazy*, and you never asked for its result. Understanding eager vs. lazy turns that mystery into a one-line explanation.

This page covers: what eager and lazy actually mean, the short-circuit operators you already use, the idea of a **thunk** (a parked computation), Python generators as your first real lazy tool, and the classic traps — generator exhaustion and the "I built a query but it never ran." The next level (`middle.md`) goes into streams and infinite data; `senior.md` covers Haskell's lazy-by-default world and its famous space leaks; `professional.md` covers strictness analysis and production-grade lazy design.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a simple program with functions in at least one language (Python, JavaScript, Java, or C#).
- **Required:** What a function call is, and what "passing an argument" means.
- **Required:** Basic loops (`for x in xs:`), and what a list is.
- **Helpful but not required:** Some exposure to `if`/ternary expressions and the `&&` / `||` operators.
- **Helpful but not required:** A vague idea that calling a function "does work" that costs time.

You do **not** need to know:

- How thunks are implemented internally (memoized closures, call-by-need — that's `middle.md` and `senior.md`).
- Anything about Haskell, monads, or the compiler's strictness analysis (later levels).
- Concurrency, threads, or lazy initialization under locks (that's `professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Eager evaluation** | Compute a value as soon as you reach the expression. Also called **strict** evaluation. The default in most languages. |
| **Lazy evaluation** | Delay computing a value until its result is actually needed. Also called **non-strict** evaluation. |
| **Strict** | A position (an argument, an operator) is *strict* if it always evaluates its operand. `+` is strict in both operands. |
| **Non-strict** | A position that may *not* evaluate its operand. The second operand of `&&` is non-strict. |
| **Thunk** | A parked, unevaluated computation — a little "IOU" that says "here is how to produce this value when asked." |
| **Force** | To actually run a thunk and get its value. "Forcing" a lazy value is what makes the work happen. |
| **Short-circuit** | When `&&` / `||` stops early because the result is already determined, skipping the rest. The everyday face of laziness. |
| **Generator** | (Python/JS) A function that produces values one at a time, on demand, pausing between each. A built-in lazy sequence. |
| **`yield`** | The keyword that turns a function into a generator: it produces one value and pauses. |
| **Iterator** | An object you can pull values from one at a time with `next()`. Generators are iterators. |
| **Exhausted** | A generator/iterator that has produced all its values. Pulling again gives nothing — it does **not** restart. |
| **Deferred execution** | (C#/Java/JS) Building a query or pipeline that does no work until you consume it. Same idea as laziness, different name. |
| **Eager collection** | A fully-built data structure (a `list`, an array) where every element already exists in memory. |
| **Infinite sequence** | A lazy sequence with no end (e.g. "all natural numbers"). Only possible because elements are computed on demand. |

---

## Core Concepts

### 1. Eager Is the Default — and You Never Noticed

When you write ordinary code, *everything runs in order, immediately*:

```python
def greet(name):
    print("computing greeting...")
    return "Hello, " + name

message = greet("Ada")   # "computing greeting..." prints RIGHT HERE
print("about to use it")
print(message)
```

Output:

```text
computing greeting...
about to use it
Hello, Ada
```

The greeting was computed the instant `greet("Ada")` was reached — *before* "about to use it" printed. That is eager evaluation. It is so natural you have never questioned it. The work happens where you wrote it.

### 2. Lazy Means "Build a Recipe, Not a Result"

Lazy evaluation changes the deal. Instead of *running* `greet("Ada")` immediately, the language stores a **recipe** for it — "to get this value, call `greet` with `'Ada'`" — and runs that recipe only the first time someone reads the value.

Most languages don't make whole expressions lazy by default, but they give you tools to *opt in*. In Python, the simplest opt-in is wrapping the work in a function and only calling it later:

```python
def lazy_greeting():
    print("computing greeting...")
    return "Hello, Ada"

# Nothing prints yet — we only have a recipe (the function).
recipe = lazy_greeting
print("about to use it")
message = recipe()   # NOW "computing greeting..." prints
```

Output:

```text
about to use it
computing greeting...
```

Notice the order flipped. With laziness, "about to use it" prints *first*, because the greeting work was deferred until we actually called `recipe()`. The function `lazy_greeting` (without parentheses) is a primitive **thunk**: a parked computation.

### 3. You Already Use Laziness: Short-Circuit Operators

Here is the most important point on this whole page, because it makes laziness concrete with code you have written a hundred times.

```python
def is_admin(user):
    print("checking admin (expensive!)")
    return user.role == "admin"

# If user is None, we must NOT call is_admin — it would crash.
if user is not None and is_admin(user):
    grant_access()
```

The `and` here is **lazy in its right operand**. If `user is not None` is `False`, Python never evaluates `is_admin(user)`. It can't — and it doesn't. This is **short-circuit evaluation**, and it is laziness in miniature. The same holds for:

- `a and b` — `b` runs only if `a` is truthy.
- `a or b` — `b` runs only if `a` is falsy.
- `cond ? x : y` (ternary) — only the chosen branch runs.

These operators are **non-strict** in their second/branch operands. Every mainstream language has them, which means *every language already ships with a little bit of laziness built in.* Lazy evaluation as a topic is just: "what if we could do that on purpose, everywhere, for whole data structures?"

### 4. The Thunk: a Parked Computation

A **thunk** is the unit of laziness. Picture an envelope. On the outside it says "I am a `string`." Inside is not a string — it is *instructions for making the string*. The first time someone opens the envelope (**forces** the thunk), the instructions run, the string is produced, and (in good implementations) the string is written back into the envelope so the next reader gets it for free. We will explore that "write it back" optimization — called **memoization** — in later levels. For now, hold this picture: a thunk is an IOU for a value.

### 5. Generators: Your First Real Lazy Tool

In Python, a function with `yield` becomes a **generator** — a lazy sequence that produces one value at a time, *only when pulled*:

```python
def naturals():
    n = 0
    while True:        # infinite loop — but this is FINE
        yield n
        n += 1

gen = naturals()       # nothing has run yet
print(next(gen))       # 0   (runs until the first yield, then pauses)
print(next(gen))       # 1   (resumes, runs to the next yield)
print(next(gen))       # 2
```

The `while True` loop would hang forever if it were eager. But a generator only advances when you call `next()`. It computes one value, pauses, and waits. This is how laziness lets you describe **infinite** data and still have a program that terminates — you simply never ask for all of it.

---

## Real-World Analogies

**The restaurant kitchen (eager) vs. the food truck (lazy).** An eager kitchen cooks every dish on the menu the moment it opens, so they're ready instantly — but most go cold and get thrown out. A lazy food truck cooks a dish only when you order it. Nothing is wasted, but you wait a moment per order. Eager pays upfront; lazy pays on demand.

**The encyclopedia vs. the search engine.** An eager encyclopedia is printed in full: every article exists whether or not anyone reads it (huge upfront cost, instant lookup). A lazy search engine doesn't "have" an answer until you type a query — it computes the relevant result the moment you ask. If you never search for "the 900,000th prime number," nobody ever computes it.

**The if-statement you already trust.** When you write `if file_exists(path) and is_readable(path):`, you *rely* on `is_readable` not running when the file is missing. You already trust laziness with correctness — short-circuit evaluation is laziness you'd be upset to lose.

**The IOU note.** A thunk is an "I owe you one value" note. You can hand IOUs around, store them, pass them to functions — and the actual money (the computation) only changes hands when someone cashes the note in.

---

## Mental Models

**Model 1: "Now" vs. "When asked."** Every expression sits on a timeline. Eager nails it to *the moment you wrote it*. Lazy lets it float forward to *the moment its value is first read* — and if that moment never comes, the expression simply never happens.

**Model 2: Recipe vs. cooked meal.** An eager value is a cooked meal sitting on the counter. A lazy value is a recipe card. The recipe is cheap to carry around and copy. It becomes a meal only when someone decides to cook it — and a smart system cooks it at most once.

**Model 3: Pull, not push.** Eager pipelines *push* data through: compute all of step 1, then all of step 2. Lazy pipelines *pull*: the consumer asks for one final value, which pulls one value through every step, then asks for the next. Nothing exists until pulled.

**Model 4: The faucet, not the bucket.** An eager list is a full bucket — every drop already in memory. A lazy sequence is a faucet — water appears only while you hold it open, and you can leave it running "forever" (an infinite sequence) as long as you only fill the cup you need.

---

## Code Examples

### Eager: list comprehension computes everything immediately

```python
def square(x):
    print(f"squaring {x}")
    return x * x

# Square brackets = EAGER. All four squares compute right now.
squares = [square(x) for x in range(4)]
print("list is built")
print(squares[0])
```

Output:

```text
squaring 0
squaring 1
squaring 2
squaring 3
list is built
0
```

Every element was computed before "list is built" printed — even `squares[1]`, `[2]`, `[3]`, which we never used.

### Lazy: generator expression computes on demand

```python
def square(x):
    print(f"squaring {x}")
    return x * x

# Round brackets = LAZY generator. Nothing computes yet.
squares = (square(x) for x in range(4))
print("generator created")
print(next(squares))   # only NOW does 'squaring 0' run
```

Output:

```text
generator created
squaring 0
0
```

Same code shape — one bracket difference — and the behavior is completely different. We computed exactly one square: the one we asked for.

### Laziness avoids wasted work: "first match" in a big search

```python
def expensive_check(x):
    print(f"checking {x}")
    return x % 7 == 0 and x > 50

# Eager: builds the ENTIRE list of matches, then takes the first.
def find_first_eager(nums):
    matches = [x for x in nums if expensive_check(x)]  # checks ALL nums
    return matches[0]

# Lazy: stops at the first match. Checks far fewer.
def find_first_lazy(nums):
    return next(x for x in nums if expensive_check(x))  # stops early

print(find_first_lazy(range(1000)))
```

The lazy version stops the instant it finds `56` (the first multiple of 7 over 50). The eager version checks all 1000 numbers first. Same answer; the lazy one did a fraction of the work.

### Short-circuit operators (the laziness you already use)

```python
data = None

# Without short-circuit, this would crash on data.value (None has no .value).
# 'and' is lazy in its right operand, so data.value is never touched.
if data is not None and data.value > 10:
    print("big")
else:
    print("safe — no crash")   # prints this
```

### Generator exhaustion (the #1 beginner trap)

```python
gen = (x * x for x in range(3))

print(list(gen))   # [0, 1, 4]  — consumes the whole generator
print(list(gen))   # []         — it's EXHAUSTED, not refilled!
```

A generator is a *one-shot* stream. Once consumed, it is empty forever. If you need to iterate twice, either store the results in a list, or create a fresh generator each time.

### `itertools`: a toolbox of lazy building blocks

```python
import itertools

# itertools.count(0) is an INFINITE lazy sequence: 0, 1, 2, 3, ...
evens = (n for n in itertools.count(0) if n % 2 == 0)

# islice pulls just the first 5 — laziness lets us slice an infinite stream.
print(list(itertools.islice(evens, 5)))   # [0, 2, 4, 6, 8]
```

---

## Pros & Cons

**Eager evaluation — pros**

- **Predictable timing.** Work happens where you wrote it. Easy to read, easy to debug, easy to profile.
- **Simple mental model.** No surprises about *when* a side effect (a print, a DB write) fires.
- **Errors surface immediately**, at the line that caused them, with a clean stack trace.

**Eager evaluation — cons**

- **Wasted work.** Computes results you may never use (the whole list when you wanted one element).
- **Can't represent infinite data.** A list of "all primes" can't exist eagerly.
- **Forces full materialization**, which costs memory for large intermediate results.

**Lazy evaluation — pros**

- **Avoids wasted work.** Only the values you actually consume get computed.
- **Enables infinite structures** (streams, `count()`, `repeat`) and clean generate-and-filter pipelines.
- **Composes cleanly:** chain `map`/`filter`/`take` with no intermediate lists in memory.

**Lazy evaluation — cons**

- **Unpredictable *when* side effects run** — a print inside a generator fires when consumed, not when defined. Confusing.
- **Exhaustion and "it never ran" bugs** — the classic "I built a query and nothing happened."
- **Harder to debug and profile** — the work is detached from where you wrote it.

---

## Use Cases

**Reach for laziness when:**

- You want only the **first few** results of a possibly huge search ("first matching user," "first 10 results").
- You are processing a **large file or stream** line by line and don't want it all in memory.
- You want to express an **infinite or unbounded** sequence (page numbers, retry attempts, an event stream).
- You are **chaining transformations** (`map` then `filter` then `take`) and want to avoid building intermediate lists.

**Stick with eager when:**

- The data is **small** and you'll use all of it anyway.
- You need **predictable timing** of side effects (logging, I/O ordering).
- You'll **iterate the result more than once** — eager lists can be re-read; generators can't.
- Simplicity and a clean stack trace matter more than a few skipped computations.

---

## Coding Patterns

**Pattern: lazy generate, eager consume.** Build a lazy pipeline, then collect exactly what you need at the end.

```python
import itertools

squares = (n * n for n in itertools.count(1))    # lazy, infinite
first_ten = list(itertools.islice(squares, 10))  # eager snapshot of 10
```

**Pattern: defer the work, pass the recipe.** Hand a *function* (a thunk) instead of a *value*, so the caller decides when (or whether) to run it.

```python
def log_if_enabled(level, make_message):
    if level >= CURRENT_LEVEL:
        print(make_message())   # only build the (expensive) string if we'll log it

# The lambda is a thunk — the f-string isn't built unless logging is enabled.
log_if_enabled(DEBUG, lambda: f"state dump: {expensive_dump()}")
```

**Pattern: convert to a list when you need to iterate twice.**

```python
gen = (x * x for x in range(5))
results = list(gen)          # materialize once
print(sum(results))          # iterate
print(max(results))          # iterate again — works because it's a list
```

---

## Best Practices

- **Know which bracket you wrote.** `[...]` is an eager list; `(...)` is a lazy generator. This one character changes everything.
- **Materialize before iterating twice.** If you'll loop over a generator more than once, `list(gen)` it first — or it'll be empty the second time.
- **Don't hide side effects inside lazy code.** A `print` or a DB write inside a generator runs at consumption time, which is rarely where you expect. Keep generators pure (no side effects) when you can.
- **Use `itertools` instead of hand-rolling.** `islice`, `takewhile`, `chain`, `count`, `cycle`, `repeat` are battle-tested lazy tools.
- **Force the result at the boundary.** Inside a function, laziness is fine; before you *return* to a caller who expects data, `list(...)` it so they get values, not a one-shot stream.
- **Name lazy things clearly.** `user_stream`, `lines_gen`, `lazy_results` — signal that the value is a stream, not a list.

---

## Edge Cases & Pitfalls

**Pitfall 1: "My code never ran."** You built a generator (or a LINQ query, or a JS iterator) and nothing happened. There was no bug in the logic — you simply never *consumed* it. Laziness does nothing until forced. Fix: consume it (`list()`, a `for` loop, `next()`).

**Pitfall 2: Generator exhaustion.** After consuming a generator once, it is empty. `list(gen)` then `list(gen)` again gives `[]` the second time. Fix: materialize to a list, or rebuild the generator.

**Pitfall 3: Late binding of variables.** A subtle one — a lazy value can capture a variable that *changes* before the value is forced:

```python
funcs = []
for i in range(3):
    funcs.append(lambda: i)      # each lambda captures the SAME i
print([f() for f in funcs])      # [2, 2, 2] — not [0, 1, 2]!
```

By the time the lambdas run (forced lazily), the loop has finished and `i` is `2`. This is the classic "modified closure" trap, and it bites in many languages. Fix: bind the value eagerly, e.g. `lambda i=i: i`.

**Pitfall 4: Infinite loop instead of infinite sequence.** A generator with `while True` is safe *only if* every consumer is bounded. `list(naturals())` will hang forever — you asked for *all* of an infinite stream. Always pair an infinite generator with something that stops (`islice`, `takewhile`, a `break`).

**Pitfall 5: Surprising side-effect timing.** Print statements inside generators fire when consumed, interleaved with the consumer's code, not at definition. This makes logs confusing. Keep generators free of side effects.

---

## Test Yourself

1. What is the difference between eager and lazy evaluation in one sentence each?
2. Name three operators you already use that are lazy (non-strict) in one of their operands.
3. What does `[square(x) for x in range(4)]` print versus `(square(x) for x in range(4))` (where `square` prints)?
4. Why can a generator represent "all natural numbers" but a list cannot?
5. What happens when you call `list(gen)` twice on the same generator? Why?
6. Explain the `[2, 2, 2]` lambda trap. What is being captured, and when is it read?
7. When would you choose eager over lazy even though lazy "wastes" less work?

<details>
<summary>Answers</summary>

1. **Eager:** compute a value as soon as you reach the expression. **Lazy:** compute it only when its result is actually needed (and skip it entirely if never needed).
2. `and` (right operand), `or` (right operand), and the ternary `a if cond else b` / `cond ? x : y` (the non-chosen branch). `&&`/`||` in other languages too.
3. The list comprehension prints all four "squaring" lines immediately. The generator prints nothing until you pull a value with `next()`.
4. A list stores every element in memory at once, which is impossible for an infinite count. A generator computes one element at a time on demand, so it never needs all of them to exist.
5. The first `list(gen)` consumes and **exhausts** it; the second returns `[]`. A generator is a one-shot stream, not a re-readable container.
6. Each lambda captures the *variable* `i`, not its value. The lambdas run lazily, *after* the loop ends, when `i` is `2`. Fix with `lambda i=i: i` to bind the value at definition time.
7. When the data is small (you'll use all of it), when side-effect timing must be predictable, or when you'll iterate the result more than once.

</details>

---

## Cheat Sheet

```text
EAGER (strict)  = "do it now"      → default in Python/JS/Java/C#/Go
LAZY  (non-strict) = "do it when needed" → opt in with generators, etc.

YOU ALREADY USE LAZINESS:
  a and b   → b skipped if a falsy
  a or  b   → b skipped if a truthy
  c ? x : y → only chosen branch runs

PYTHON:
  [x for x in xs]   → EAGER list   (all elements now)
  (x for x in xs)   → LAZY generator (on demand, one-shot)
  yield             → makes a generator function
  itertools.count/islice/takewhile/chain → lazy toolbox

THUNK = parked computation (an IOU for a value)
FORCE = run the thunk, get the value

TRAPS:
  - "it never ran"     → you didn't consume the lazy thing
  - exhaustion         → generator is empty after one pass
  - [2,2,2] closure    → lambda captures the variable, read late
  - infinite hang      → list(infinite_gen) — always bound it
```

---

## Summary

Eager evaluation — the default in nearly every language you'll use — runs each expression the moment you reach it. Lazy evaluation defers the work until its result is genuinely needed, and skips it entirely if it never is. You already rely on laziness through short-circuit operators (`and`, `or`, ternary): those skip their second operand when the answer is already known, and that is exactly the idea, scaled down.

A **thunk** is the unit of laziness: a parked computation, an IOU for a value, that runs when **forced**. Python's generators (`yield`, generator expressions, `itertools`) are your first practical lazy tool: they produce values one at a time, on demand, which lets you express infinite sequences and avoid wasted work. The price is that laziness makes the *timing* of work less obvious — hence the classic junior bugs: "my code never ran" (you didn't consume it), generator exhaustion (one-shot streams), and the late-binding closure trap. Choose eager when data is small and predictability matters; choose lazy when you want only part of a large or infinite result. Later levels build streams, sieves, and Fibonacci sequences on this foundation, and explore what happens in a language (Haskell) where laziness is the default rather than the exception.
