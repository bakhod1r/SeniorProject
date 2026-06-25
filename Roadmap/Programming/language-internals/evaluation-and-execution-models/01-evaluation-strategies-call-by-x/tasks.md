# Evaluation Strategies (call-by-x) — Hands-On Tasks

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)

---

## Introduction

This file is a structured set of exercises that take you from "I think Python
passes by reference" to "I can predict termination, mutation, and performance
from the passing strategy, and I can simulate call-by-name and call-by-need by
hand." Every task is small enough for one or two focused sessions, and they
build on one another.

How to use this file: read the task, write the code, **run it and predict the
output before you look**, and only then check the hints. The single most
valuable habit this topic teaches is *predicting* a program's behavior from the
passing rule rather than running it to find out. Mark the self-check boxes when
you can explain the result to someone else, not when the program merely
compiles. Sample solutions are intentionally sparse — they appear only where the
canonical answer is more instructive than your first attempt.

## Table of Contents

- [Warm-Up](#warm-up)
- [Core](#core)
- [Advanced](#advanced)
- [Capstone](#capstone)

---

## Warm-Up

These tasks rebuild the mental model. Short, but each one isolates one rule you
will reuse for the rest of the file.

### Task 1: Prove your language is not pass-by-reference

**Problem.** In Python (or Java, or JavaScript), write a `swap(a, b)` that tries
to swap two variables. Call it on two integers and two lists. Print the
caller's variables before and after.

**Constraints.**
- The body must be the obvious `a, b = b, a` (or the Java/JS equivalent).
- Do not use any container trick yet — write the naive version.

**Hints (try without first).**
- Predict the output *before running*. Write your prediction down.
- The swap will not change the caller's variables. Explain why in one sentence.
- The give-away: if the language were pass-by-reference, this would work.

**Self-check.**
- [ ] You can state the one-line reason the swap fails.
- [ ] You can name the strategy your language actually uses.

---

### Task 2: Mutation leaks, rebinding doesn't

**Problem.** Write a function that takes a list and does two things in order:
`lst.append(99)` and then `lst = [1, 2, 3]`. Pass it a list and print the
caller's list afterward.

**Constraints.**
- Both operations must be in the same function, in that order.

**Hints (try without first).**
- One operation leaks to the caller; the other doesn't. Predict which.
- "Mutation reaches through the shared reference; rebinding replaces the local
  copy of the reference."

**Self-check.**
- [ ] You can explain why `append` leaks but the assignment doesn't.
- [ ] You can draw the "arrows and boxes" picture for both operations.

---

### Task 3: Why integers feel like call-by-value

**Problem.** Write `def add_one(n): n = n + 1; return n`. Call it with an integer
variable and print the caller's variable. Then explain — in writing — why the
integer is unchanged even though the language uses call-by-sharing.

**Hints (try without first).**
- The passing rule is identical to the list case. What's different is the type.
- Integers are immutable: the only operation available is rebinding.

**Self-check.**
- [ ] You can explain the result using *mutability*, not a different passing rule.

---

### Task 4: Fake call-by-reference with a pointer

**Problem.** In C (or Go), write `add_one` that *does* change the caller's
variable, using a pointer. Then explain why this is still call-by-value
underneath.

**Constraints.**
- Use a pointer parameter; take the address at the call site.

**Hints (try without first).**
- The pointer itself is copied (by value). Following it reaches the original.
- "Pass by reference" in C = call-by-value of a pointer.

**Self-check.**
- [ ] You can explain why the pointer is copied but the effect still reaches the caller.

---

## Core

These tasks move from observing behavior to *predicting* it across strategies,
and to simulating non-strict evaluation by hand.

### Task 5: The `f(x, x)` aliasing experiment

**Problem.** Implement `f(a, b)` that does `a = 1; b = 2; return a`. Call it as
`f(x, x)` with `x = 0`. Predict the value of `x` afterward and the return value
under three strategies: call-by-value, call-by-reference, and call-by-copy-restore.
Then verify the call-by-value case in a real language (any mainstream language),
and the call-by-reference case in C++ (`int&`).

**Constraints.**
- Write down all three predictions *before* running anything.

**Hints (try without first).**
- Value: copies; `x` unchanged, returns 1.
- Reference: both alias `x`; the later write wins; trace carefully.
- Copy-restore: copies that write back at return; "last write-back wins."

**Self-check.**
- [ ] Your three predictions are written down before any code runs.
- [ ] You can explain why copy-restore's answer can be unspecified.

<details>
<summary>Solution sketch</summary>

- **Call-by-value:** `a`, `b` are independent copies; `x` stays `0`; returns `1`.
- **Call-by-reference:** `a` and `b` are both aliases of `x`. `a = 1` makes `x = 1`;
  `b = 2` makes `x = 2`; `return a` reads `x` which is now `2`. So `x = 2`, returns `2`.
- **Call-by-copy-restore:** `a` and `b` start as copies of `0`. The function sets the
  local `a = 1`, `b = 2`, returns the local `a` = `1`. On return, both copies are
  written back into `x`; whichever is restored last wins, so `x` is `1` or `2`
  depending on (often unspecified) restore order.

</details>

---

### Task 6: The mutable-default-argument trap

**Problem.** Write `def add(item, bucket=[]): bucket.append(item); return bucket`.
Call it three times *without* the second argument and print each result. Explain
the output, then fix it so each call starts fresh.

**Hints (try without first).**
- The default list is created once and shared across calls.
- The fix is the `None` sentinel pattern.

**Self-check.**
- [ ] You can explain the trap as a direct consequence of call-by-sharing.
- [ ] Your fixed version produces a fresh list per call.

---

### Task 7: Shallow vs deep copy

**Problem.** Take a list of lists, e.g. `a = [[1], [2]]`. Make `b = list(a)`
(shallow copy). Now do `b[0].append(99)` and `b.append([3])`. Print `a` after
each. Explain which change leaked into `a` and which didn't.

**Hints (try without first).**
- The shallow copy duplicates the outer list but shares the inner lists.
- `b[0].append(99)` mutates a *shared inner* list; `b.append([3])` mutates only
  the new outer list.

**Self-check.**
- [ ] You can state when a shallow copy is sufficient and when you need a deep copy.

---

### Task 8: Short-circuit is non-strictness

**Problem.** In any language, write `cheap() || expensive()` (or `&&`) where
`expensive()` prints something. Show that `expensive()` is not called when the
result is already determined. Then write the *strict* version (Java `|`/`&`, or
calling both into temporaries first) and show that it *is* called.

**Hints (try without first).**
- `||`/`&&` are non-strict in their second operand — a built-in thunk.
- The bitwise `|`/`&` are strict — both operands evaluated.

**Self-check.**
- [ ] You can explain short-circuiting as non-strict evaluation.
- [ ] You can distinguish it from memoization (it doesn't cache).

---

### Task 9: Simulate call-by-name with a thunk

**Problem.** Write a function `unless(condition, action)` that runs `action`
**only when** `condition` is false. First write the broken version that takes
`action` as an already-evaluated value, and show it has a side effect even when
it shouldn't. Then fix it by passing `action` as a thunk (`lambda`/`Supplier`/
closure) and forcing it only when needed.

**Constraints.**
- `action` must have an observable side effect (a print or a counter).

**Hints (try without first).**
- In the broken version the argument is evaluated *before* `unless` runs.
- The thunk defers evaluation until you call it.

**Self-check.**
- [ ] You can explain why the broken version evaluates the action regardless.
- [ ] You can describe a thunk as a zero-argument closure.

---

## Advanced

These tasks require simulating call-by-need, observing termination differences,
and reasoning about performance.

### Task 10: Call-by-name vs call-by-need by hand

**Problem.** Build a thunk type. Write `twice_name(thunk)` that returns
`thunk() + thunk()` (call-by-name: forces twice) and `twice_need(thunk)` that
memoizes the first force and reuses it (call-by-need: forces once). Pass a thunk
whose body prints and returns a random number. Show that `twice_name` prints
twice (and may sum two *different* numbers) while `twice_need` prints once (and
sums the *same* number twice).

**Hints (try without first).**
- Call-by-need = call-by-name + a one-slot cache.
- The "different numbers" observation proves re-evaluation, not just re-printing.

**Self-check.**
- [ ] Your `twice_need` forces the thunk exactly once.
- [ ] You can explain why call-by-name can produce a different sum than call-by-need.

<details>
<summary>Solution sketch (Python)</summary>

```python
def twice_name(thunk):
    return thunk() + thunk()          # forces twice

def memoize(thunk):
    box = {}
    def force():
        if "v" not in box:
            box["v"] = thunk()        # compute once
        return box["v"]
    return force

def twice_need(thunk):
    f = memoize(thunk)
    return f() + f()                  # forces once

import random
mk = lambda: (print("forced"), random.randint(1, 100))[1]
# twice_name(mk) → "forced" twice, possibly different numbers summed
# twice_need(mk) → "forced" once, same number summed twice
```

</details>

---

### Task 11: Termination depends on the strategy

**Problem.** Write `const(x, y)` that returns `x` and ignores `y`. Call it as
`const(42, loop_forever())` where `loop_forever()` never returns. In a strict
language (Python/Java/Go), show it hangs. Then re-express the call so `y` is a
**thunk** and `const` never forces it — show it now returns `42`. Finally, in
Haskell, run `const 42 undefined` and observe it returns `42` with no work
to defer manually.

**Hints (try without first).**
- Strict evaluation runs `loop_forever()` before `const` ever executes.
- Deferring `y` into a thunk that's never forced sidesteps the divergence.
- Haskell is call-by-need, so non-strictness is the default.

**Self-check.**
- [ ] You can explain why strict evaluation hangs even though `y` is unused.
- [ ] You can connect this to normal-order vs applicative-order reduction.

---

### Task 12: The Go slice aliasing and `append` surprise

**Problem.** In Go, write a function that takes a `[]int`, mutates an element,
and `append`s a value. Call it twice: once with a slice that has spare capacity
(use `make([]int, 3, 8)`) and once with a slice at full capacity. Print the
caller's slice after each. Explain why the element mutation always leaks but the
`append` is visible only in one case.

**Hints (try without first).**
- The element mutation goes through the shared backing array.
- `append` reallocates only when capacity is exhausted; otherwise it writes in
  place (visible to the caller).

**Self-check.**
- [ ] You can explain why `append` visibility is capacity-dependent.
- [ ] You know the idiomatic fix (return the slice and reassign at the caller).

---

### Task 13: Move vs copy, measured

**Problem.** In C++ (or Rust), create a function that takes a large
`std::vector<int>` (a few million elements). Call it once **by value** and once
**by move** (`std::move`). Measure and compare the time and, if you can, the
allocations. Then add a `const&` overload and show it's the cheapest for a
read-only call.

**Constraints.**
- Use a vector large enough that the copy is clearly measurable.
- Report wall-clock time and (bonus) allocation count.

**Hints (try without first).**
- By value deep-copies every element (O(n)); by move transfers the 3-word header
  (O(1)) and empties the source.
- `const&` copies nothing at all — it just aliases for reading.

**Self-check.**
- [ ] You can explain the O(n) vs O(1) difference from the data structure.
- [ ] You can state when each of the three is the correct choice.

---

### Task 14: Defensive copy at a boundary

**Problem.** Write a function `enrich(record)` that adds a field to a dict/map,
in a language with call-by-sharing (Python/Java/Go-map). First show that it
mutates the caller's object. Then make it safe by copying at the boundary.
Finally, demonstrate that a *shallow* copy still leaks if a nested object is
mutated, and that a deep copy fixes it.

**Hints (try without first).**
- Shared mutable argument → mutation leaks.
- Shallow copy breaks only the *outer* aliasing.

**Self-check.**
- [ ] You can articulate the cost (allocation) of the defensive copy.
- [ ] You can decide when shallow is enough and when deep is required.

---

## Capstone

### Task 15: Build a tiny interpreter that switches evaluation strategy

**Problem.** Implement a minimal expression interpreter for a language with
variables, function definitions, and application. Make the **evaluation
strategy a flag**: support call-by-value, call-by-name, and call-by-need. Use a
program that (a) ignores one of its arguments and (b) uses another argument
multiple times, with a side-effecting / divergent argument, so the three
strategies produce *observably different* behavior:

- call-by-value: hangs / runs the side effect once eagerly,
- call-by-name: runs the side effect once per use,
- call-by-need: runs it once, on first use, then memoizes.

**Constraints.**
- The only difference between the three modes should be *when and how often*
  arguments are evaluated — the rest of the interpreter is shared.
- Represent deferred arguments as thunks; call-by-need adds a memo cell.

**Hints (try without first).**
- Call-by-value: evaluate the argument expression to a value at application time.
- Call-by-name: bind the parameter to a thunk capturing the argument expression
  and the *caller's* environment; force on each variable lookup.
- Call-by-need: same thunk, but replace the thunk with its value on first force
  (an updatable indirection — this is graph reduction in miniature).

**Self-check.**
- [ ] The same test program yields three distinct behaviors under the three flags.
- [ ] You can point at the *one* place in your code where the strategy diverges.
- [ ] You can explain how call-by-need's memo cell turns call-by-name into laziness.

<details>
<summary>Solution sketch</summary>

The three modes differ only in how a parameter is bound and looked up:

- **Value:** at application, evaluate `arg` in the caller's env to a value `v`;
  bind `param → v`. Lookups return `v` directly.
- **Name:** at application, build `thunk = (arg_expr, caller_env)`; bind
  `param → thunk`. Each variable lookup of `param` *re-evaluates* the thunk.
- **Need:** identical binding, but the first lookup evaluates the thunk and
  **overwrites the binding** with the resulting value (or marks the cell
  computed). Subsequent lookups read the cached value — the thunk is forced at
  most once.

A test program like `(λx. λy. y + y) DIVERGE (print_and_return 7)` exposes all
three: value diverges (forces `DIVERGE` eagerly), name prints `7` twice (forces
`y` per use), need prints `7` once (memoized) and sums `14`.

</details>

---

### Task 16: Write the API-signature decision guide

**Problem.** Without code: produce a one-page decision guide that, given a
parameter, picks among *copy by value*, *read-only borrow* (`const&`/`&`),
*mutable borrow* (`&mut`/ref), *take ownership* (by-value/move), and *defer*
(thunk/lazy). For each, state the contract it expresses, its cost, its aliasing
behavior, and one failure mode of choosing it wrongly. Then apply your guide to
five real signatures from a codebase you know and justify each choice.

**Self-check.**
- [ ] Each option lists contract, cost, aliasing, and a failure mode.
- [ ] Your five real-world justifications cite size, mutability, lifetime, or hot-path concerns.
- [ ] You can defend why a const-reference is *not* always the right default.
