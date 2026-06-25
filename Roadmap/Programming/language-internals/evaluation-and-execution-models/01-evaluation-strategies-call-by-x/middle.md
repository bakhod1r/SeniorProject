# Evaluation Strategies (call-by-x) — Middle Level

> **Topic:** [Evaluation Strategies (call-by-x)](README.md)
> **Focus:** Beyond value/reference/sharing: *when* is an argument evaluated? Call-by-name defers it into a thunk, call-by-need memoizes that thunk into laziness, and strict-vs-non-strict decides whether an unused argument can blow up your program.

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
14. [Tricky Points](#tricky-points)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction

> Focus: **When does an argument get evaluated — at the call, or only if and when the callee actually uses it?**

The junior page answered *what* a function receives (a copy, an alias, a shared reference). This page answers a second, orthogonal question that most languages hide from you: **when is the argument expression evaluated?** In nearly every mainstream language the answer is "right now, before the call" — that is **strict** (or **eager**) evaluation. But there is a whole family of strategies where the answer is "later, maybe never": **call-by-name** wraps the unevaluated expression in a little zero-argument function (a **thunk**) and re-evaluates it each time the parameter is used; **call-by-need** does the same but **memoizes** the first result, so the expression runs *at most once* — this is exactly what "lazy evaluation" means in Haskell.

Why care, as a mid-level engineer? Because the *when* changes program behavior in ways the *what* never can. Under call-by-value, if any argument expression diverges (loops forever) or throws, the call never happens — the whole program is doomed. Under call-by-name/need, an argument you never use is *never evaluated*, so a function can terminate even when one of its arguments would loop forever. That difference — **non-strictness** — is the entire reason Haskell can have infinite lists, and the reason your `if`/`&&`/`||` work the way they do (those are non-strict in their operands even in strict languages, via short-circuiting).

In one sentence: **strict evaluation runs arguments before the call; non-strict evaluation defers them into thunks, and laziness is call-by-name that remembers its answer.** Getting this lets you reason about short-circuiting, lazy streams, and why some code terminates that "shouldn't."

> 🎓 **Why this matters at the middle level:** You already understand mutation and sharing. The next tier of bugs and design choices — infinite generators, `&&` short-circuit, why a logging macro shouldn't evaluate its argument, why Scala's `=> T` by-name params exist, why a thunk closure can leak memory — all live in *evaluation order*, not in passing semantics. This is also the bridge to lambda-calculus reduction order, which `senior.md` makes precise.

This page covers **strict vs non-strict**, **call-by-name** with thunks and the classic **Jensen's device**, **call-by-need** (memoized laziness), **call-by-copy-restore** (value-result, the in/out parameter), and how termination depends on the strategy. `senior.md` ties it all to normal-order vs applicative-order reduction in the lambda calculus and to move semantics.

---

## Prerequisites

What you should know before reading this:

- **Required:** Call-by-value, call-by-reference, and call-by-sharing (the `junior.md` page).
- **Required:** What a closure is — a function bundled with the variables it captures.
- **Required:** Short-circuit evaluation: that `false && expensive()` never calls `expensive()`.
- **Helpful but not required:** Having seen a lambda/anonymous function passed as an argument.
- **Helpful but not required:** Exposure to generators/iterators (Python `yield`, JS generators) — they are a form of laziness.

You do **not** need to know:

- Formal lambda-calculus reduction order (`senior.md`).
- Move semantics or Rust ownership (`senior.md`).
- The category theory or denotational semantics of laziness.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Strict (eager) evaluation** | Argument expressions are fully evaluated **before** the function body runs. The mainstream default. |
| **Non-strict evaluation** | A function may produce a result without evaluating one or more of its arguments. |
| **Call-by-name** | Each parameter is bound to the *unevaluated* argument expression; it is **re-evaluated every time** the parameter is referenced. |
| **Thunk** | A zero-argument closure capturing an unevaluated expression plus its environment. The implementation mechanism for non-strict params. |
| **Call-by-need** | Call-by-name plus **memoization**: the thunk runs at most once; the result is cached and reused. This is "lazy evaluation." |
| **Memoization** | Caching the result of a computation so repeated requests return the stored value instead of recomputing. |
| **Call-by-copy-restore (value-result)** | Copy the argument in at call time; on return, copy the (possibly changed) parameter back out into the caller's variable. |
| **Divergence / bottom (⊥)** | A computation that never returns a value: an infinite loop or an exception. Written ⊥. |
| **WHNF (weak head normal form)** | "Evaluated enough to see the outermost constructor" — e.g. you know a list is a cons cell without forcing its tail. The default depth Haskell evaluates to. |
| **Force / forcing** | Triggering evaluation of a thunk to get its value. |
| **Jensen's device** | A classic Algol 60 trick exploiting call-by-name: passing an expression and an index variable so the callee can iterate by mutating the index, e.g. summing `a[i]` over `i`. |
| **Short-circuit** | Non-strict behavior of `&&`/`||`/`?:` built into otherwise-strict languages. |
| **Space leak** | Memory bloat from accumulating unforced thunks (the dark side of laziness). |

---

## Core Concepts

### 1. Two Orthogonal Axes: *What* vs *When*

The junior page's axis was **what** the parameter aliases (value / reference / shared reference). This page's axis is **when** the argument is evaluated:

- **Strict:** evaluate the argument *now*, before entering the body. Call-by-value and call-by-reference are both strict.
- **Non-strict:** *defer* the argument; evaluate it later (or never). Call-by-name and call-by-need are non-strict.

These axes are independent. You can have call-by-value (strict, copies) or call-by-name (non-strict, re-evaluates). The full picture is a grid, not a line.

### 2. Strictness and Termination

This is the headline consequence. Consider:

```text
def const(x, y):  return x      # ignores y

const(42, loop_forever())
```

- **Under call-by-value (strict):** `loop_forever()` is evaluated *before* `const` runs. The program **hangs**, even though `const` never looks at `y`.
- **Under call-by-name/need (non-strict):** `y` is never referenced, so `loop_forever()` is **never evaluated**. The call returns `42`.

So **call-by-name can terminate where call-by-value loops forever.** This is not a curiosity — it is the formal reason normal-order reduction is "more terminating" than applicative-order, and the reason Haskell can write `take 5 [1..]` over an infinite list.

### 3. Call-by-Name: Bind the Expression, Re-Evaluate Each Use

Under call-by-name, the parameter is essentially a macro for the argument *expression*. Every time the body mentions the parameter, the original expression is evaluated again, **in the caller's context**.

```text
// pseudo call-by-name
def twice(x):
    return x + x          // 'x' here means "the argument expression", evaluated TWICE

twice(roll_dice())        // roll_dice() is called TWICE — you may get 3 + 5 = 8
```

That re-evaluation is the surprising part and the source of both the power (Jensen's device) and the danger (side effects happen N times).

### 4. The Thunk: How Non-Strictness Is Implemented

A language that lacks built-in call-by-name still gets you 90% of the way there with **thunks** — wrapping the argument in a `() -> T` so *nothing runs until you call it*:

```text
// simulate call-by-name with a thunk (lambda)
def twice(thunk):
    return thunk() + thunk()    // forces the thunk each time

twice(lambda: roll_dice())      // explicit deferral
```

A thunk is just a zero-arg closure. It captures the expression and its environment; calling it forces evaluation. Every non-strict mechanism — Scala's `=> T`, Haskell's lazy bindings, your hand-rolled `Supplier<T>` in Java — is a thunk underneath.

### 5. Call-by-Need = Call-by-Name + Memoization (Laziness)

Call-by-name re-evaluates *every* use, which is wasteful and (with side effects) dangerous. **Call-by-need** fixes the waste: force the thunk **once**, cache the result, and every later use reads the cache.

```text
// call-by-need: the thunk memoizes
def twice(lazy_x):
    return lazy_x.force() + lazy_x.force()   // computed ONCE, reused

twice(make_lazy(roll_dice))   // roll_dice() runs exactly once
```

This is exactly Haskell's evaluation model. A binding like `let x = expensive()` does **not** run `expensive()` until `x` is forced, and runs it **at most once** thereafter. That's why laziness is "computed at most once, only if needed."

### 6. Call-by-Copy-Restore (Value-Result)

A fourth strategy, distinct from all the above. At call time, **copy** the argument into the parameter (like call-by-value). The function works on its local copy. On **return**, copy the parameter's final value **back out** into the caller's variable. Ada's `in out` parameters, Fortran's argument convention, and some older systems use this.

It usually *looks* identical to call-by-reference — but it differs precisely under aliasing (when the same variable is passed twice, or a global is also touched), because copy-restore only writes back at the *end*. That subtlety is a famous interview trap, expanded in Tricky Points.

---

## Real-World Analogies

**Strict — cooking every ingredient before you start the recipe.** You chop, boil, and roast *everything* the recipe mentions before turning on the stove. If one ingredient is rotten (diverges), you never get to cook, even if the final dish doesn't use it.

**Call-by-name — a recipe that says "fresh-squeeze juice each time it's called for."** The instruction "add juice" is followed *every time it appears*. Three mentions of juice means squeezing three times. The instruction is the *expression*, re-run on demand.

**Call-by-need — squeeze the juice once, keep the jug.** The first time the recipe wants juice you squeeze it; you keep the jug and pour from it for every later mention. One squeeze, many pours. Cached.

**Thunk — a sealed "just add water" packet.** Nothing happens until you open it. You can carry it around, hand it off, and never open it — no cost until forced.

**Call-by-copy-restore — borrowing a library book, returning the annotated copy at the end.** You take a copy, scribble in it all week, and only when you return it do your changes get merged back into the master. If two people borrowed copies of the same book and both return, the *last* return wins — which is exactly why copy-restore and true reference differ under aliasing.

---

## Mental Models

**Model 1: "A parameter is either a value or a recipe."** Strict params are *values* (already computed). Non-strict params are *recipes* (thunks) that compute on demand. Call-by-name re-runs the recipe each use; call-by-need runs it once and bottles the result.

**Model 2: "Laziness = call-by-name with a cache."** If you remember nothing else: name + memo = need. Re-evaluate every time → name. Re-evaluate once → need.

**Model 3: "Non-strict = unused arguments can't hurt you."** Under non-strict evaluation, `f(x, ⊥)` is fine as long as `f` ignores its second argument. Under strict, `⊥` poisons the call. Termination is a property of *order*.

**Model 4: "Short-circuit is non-strictness you already use."** `cond && expensive()` is `if cond then expensive() else false` — the right operand is a thunk forced only when `cond` is true. Every strict language smuggles in non-strict operators for `&&`, `||`, and `?:`.

**Model 5: "Copy-restore writes back at the boundary; reference writes through immediately."** Same effect when there's no aliasing; divergent effect the moment two names touch the same storage.

---

## Code Examples

### Example 1: Scala By-Name Parameters (Real Call-by-Name)

Scala has first-class call-by-name via `=> T`:

```scala
// 'cond' is evaluated each time it's used; 'body' too
def myWhile(cond: => Boolean)(body: => Unit): Unit =
  if (cond) { body; myWhile(cond)(body) }

var i = 0
myWhile(i < 3) { println(i); i += 1 }   // works: cond re-evaluated each loop
```

If `cond` were a normal (by-value) `Boolean`, it would be evaluated once at the call and the loop would never re-check it. By-name makes `i < 3` a thunk re-forced every iteration.

### Example 2: Lazy = By-Name + Memo, Also in Scala

```scala
def expensive(): Int = { println("computing"); 42 }

def byName(x: => Int)  = x + x   // prints "computing" TWICE
def byNeed(x: => Int)  = { lazy val v = x; v + v }  // prints "computing" ONCE

byName(expensive())   // computing / computing
byNeed(expensive())   // computing
```

`lazy val` is the memoizing wrapper that turns call-by-name into call-by-need.

### Example 3: Haskell — Non-Strictness Lets a Function Ignore ⊥

```haskell
ghci> const 42 undefined      -- 'undefined' is ⊥
42                            -- never forced, so no crash

ghci> take 3 [1..]            -- infinite list, lazily produced
[1,2,3]

ghci> let xs = 1 : xs in take 5 xs   -- self-referential infinite list
[1,1,1,1,1]
```

The same expressions in a strict language would loop or crash on `undefined`/`[1..]`.

### Example 4: Simulating Call-by-Name in Strict Languages With Thunks

```python
# Python: defer with a lambda (thunk). 'unless' must not eval the body unless needed.
def unless(condition, action):       # WRONG: action already evaluated!
    if not condition:
        action

def unless_lazy(condition, action):  # RIGHT: action is a thunk
    if not condition:
        action()

unless_lazy(user_is_admin, lambda: delete_everything())  # only forced if not admin
```

```java
// Java: Supplier<T> is the thunk type
int orElse(boolean flag, int cheap, Supplier<Integer> expensive) {
    return flag ? cheap : expensive.get();   // expensive computed only if needed
}
```

### Example 5: Jensen's Device (the Classic Call-by-Name Trick)

In Algol 60, you could pass an *expression* and a *loop variable*; mutating the variable in the callee changed what the expression evaluated to:

```text
// Algol-style pseudocode
real procedure SUM(expr, i, lo, hi);
  value lo, hi; integer i;          // i and expr are call-by-name
begin
  real s; s := 0;
  for i := lo step 1 until hi do
    s := s + expr;                  // 'expr' re-evaluated with the new i each pass
  SUM := s
end;

// Caller: sum a[i] for i in 1..n  — pass the EXPRESSION a[i], not a value
total := SUM(a[i], i, 1, n);
```

`expr` is `a[i]`. Each loop iteration mutates `i` (call-by-name), so re-evaluating `a[i]` yields a *different* array element. One generic `SUM` can sum `a[i]`, `a[i]*b[i]`, `1/i`, anything — without higher-order functions. This is the canonical demonstration of call-by-name's expressiveness (and its danger).

---

## Pros & Cons

### Call-by-name

**Pros**
- Maximally lazy at the use site; unused arguments cost nothing.
- Enables expression-level abstractions (Jensen's device, custom control flow).

**Cons**
- Re-evaluates on **every** use — duplicated work and duplicated side effects.
- Side-effecting arguments behave unpredictably (run N times, or zero).

### Call-by-need (laziness)

**Pros**
- Computes each argument **at most once**, **only if needed** — best of both.
- Enables infinite data structures, stream fusion, and clean separation of generation from consumption.

**Cons**
- **Space leaks**: unforced thunks pile up and bloat memory.
- Evaluation order becomes hard to predict, complicating debugging, profiling, and reasoning about *when* side effects happen.

### Call-by-copy-restore

**Pros**
- No long-lived aliasing during the call (callee works on a private copy).
- Gives in/out semantics without exposing a live reference.

**Cons**
- Surprising under aliasing: only writes back at return, so "last writer wins."
- Subtle interaction with exceptions (does the restore happen on an abnormal exit?).

---

## Use Cases

- **Call-by-name / thunks** for custom control structures, assertion/logging macros (don't evaluate the message unless the log level is on), and lazy default values.
- **Call-by-need / laziness** for infinite streams, generators, dependency graphs computed on demand, and avoiding work that the consumer may skip.
- **Short-circuit operators** — the non-strictness you use daily.
- **Call-by-copy-restore** in interop boundaries (Ada `in out`, certain FFI/RPC conventions) where you want value semantics during the call but updates afterward.

---

## Coding Patterns

**Pattern: Thunk a costly default.** Don't compute a fallback you may not use.

```python
def get_or_default(cache, key, default_thunk):
    return cache[key] if key in cache else default_thunk()

get_or_default(c, "k", lambda: expensive_default())   # only runs on miss
```

**Pattern: Lazy logging.** Pass a thunk, not a pre-formatted string.

```java
log.debug(() -> "state=" + dumpExpensiveState());  // string built only if DEBUG on
```

**Pattern: Memoize a thunk to get call-by-need by hand.**

```python
def lazy(thunk):
    box = {}
    def force():
        if "v" not in box:
            box["v"] = thunk()      # compute once
        return box["v"]
    return force
```

**Pattern: Generators for pull-based laziness.**

```python
def naturals():
    n = 0
    while True:
        yield n
        n += 1
# consumer pulls only what it needs — values produced on demand
```

---

## Best Practices

1. **Default to strict; reach for laziness deliberately.** Eager evaluation is predictable; make laziness a conscious tool, not an accident.
2. **Never put observable side effects in a call-by-name / thunk argument** unless you fully control how many times it's forced. By-name may run it 0, 1, or N times.
3. **In lazy languages, watch for space leaks.** Force accumulators (Haskell's `seq`, `$!`, `BangPatterns`, `foldl'`) when building up large thunked values.
4. **Use thunks to avoid wasted work**, but profile — a thunk has allocation and indirection cost; cheap arguments don't deserve deferral.
5. **Prefer call-by-need (memoized) over call-by-name** whenever the argument is referenced more than once, unless re-evaluation is the *point* (as in Jensen's device).
6. **Treat copy-restore as value semantics with a write-back**, and document the aliasing behavior at interop boundaries.

---

## Edge Cases & Pitfalls

**Pitfall 1: Side effects under call-by-name run the wrong number of times.** `twice(print("hi"))` under call-by-name prints `hi` twice; if the parameter is never used, zero times. Predict by counting *uses*, not *calls*.

**Pitfall 2: Space leaks from lazy accumulation.** `foldl (+) 0 [1..1000000]` in Haskell builds a giant chain of unforced `+` thunks before evaluating any — it can blow the stack/heap. Use the strict `foldl'`.

**Pitfall 3: Laziness reorders *when* exceptions fire.** A division by zero hidden in a thunk surfaces only when forced — possibly far from where it was written, possibly never. Debugging "where did this exception come from?" gets harder.

**Pitfall 4: Memoized thunk pins memory.** A call-by-need thunk that captures a large structure keeps it alive until forced (and the cached result keeps living after). Long-lived lazy values are a classic memory-retention bug.

**Pitfall 5: Copy-restore vs reference under aliasing.** If `f(x, x)` is passed the same variable for two copy-restore params, only one write-back survives (order-dependent), whereas true reference would interleave writes live. Same call, different answer.

---

## Common Mistakes

- **Calling thunks "lazy" when they're really call-by-name.** A bare `() -> T` re-evaluates each call; it's lazy *only* if you wrap it in a memoizer.
- **Assuming `&&` evaluates both sides.** It doesn't — it's non-strict in the right operand. People still write `if (p != null & p.ok())` (bitwise `&`, strict) and get NPEs.
- **Expecting Haskell to run top-to-bottom.** Evaluation is demand-driven; "earlier" code may run *after* "later" code, or never.
- **Confusing copy-restore with reference** because they agree in the common (no-aliasing) case.
- **Leaving side effects in lazy bindings**, then being surprised they fire in a confusing order.

---

## Tricky Points

**The aliasing test that separates the four strategies.** Consider a function `f(a, b)` that does `a := 1; b := 2; result := a` and is called as `f(x, x)` with `x` initially `0`:

- **Call-by-value:** `a`, `b` are copies; `x` stays `0`.
- **Call-by-reference:** `a` and `b` are *both* aliases of `x`; `a := 1` then `b := 2` both write `x`, so `x` ends at `2`, and `result` (reading `a`, i.e. `x`) is `2`.
- **Call-by-copy-restore:** `a`, `b` are copies; at return, both copy back into `x`; the last write-back wins, so `x` is `1` or `2` depending on restore order (unspecified in some languages!).
- **Call-by-name:** `a` and `b` are the *expression* `x`; behavior follows reference-like, but with re-evaluation subtleties.

This single example is the cleanest way to *distinguish* the strategies empirically, and a beloved exam/interview question.

**Short-circuit is non-strictness, not laziness.** `a || b` doesn't *memoize* `b`; it just doesn't force it when `a` is true. Don't conflate the two.

**`take 5 [1..]` only works because of WHNF.** Haskell evaluates the list to weak head normal form — enough to see the next cons cell — never the (infinite) whole. Laziness operates at the constructor boundary.

---

## Test Yourself

1. What is the difference between strict and non-strict evaluation?
2. Why can call-by-name terminate where call-by-value loops forever?
3. What single addition turns call-by-name into call-by-need?
4. What is a thunk, concretely?
5. Why does `&&` count as non-strict even in a strict language?
6. How does call-by-copy-restore differ from call-by-reference, and when does the difference become visible?

<details>
<summary>Answers</summary>

1. **Strict** evaluates all arguments before the body runs; **non-strict** may run the body without evaluating some arguments (they're deferred into thunks).
2. A non-evaluated argument is never forced, so a diverging argument that the function ignores never runs — the call returns. Under call-by-value the argument is evaluated first and the program hangs.
3. **Memoization**: cache the thunk's first result so it's computed at most once.
4. A **zero-argument closure** capturing an unevaluated expression and its environment; calling it forces evaluation.
5. `a && b` does not evaluate `b` when `a` is false — it's non-strict in its right operand (a built-in thunk), even though the language is otherwise strict.
6. Copy-restore copies in and writes back **only at return**, whereas reference writes **live**. The difference shows under **aliasing** (same variable passed twice, or a global also touched): copy-restore gives "last write-back wins," reference interleaves.

</details>

---

## Cheat Sheet

```text
AXIS 1 (what):  value / reference / sharing      ← junior page
AXIS 2 (when):  STRICT (now)  vs  NON-STRICT (later/maybe never)  ← this page

STRICT (eager):   call-by-value, call-by-reference   → args evaluated before body
NON-STRICT:       call-by-name, call-by-need          → args deferred into thunks

CALL-BY-NAME  = bind the EXPRESSION, re-evaluate EACH use   (Scala  => T, Algol)
CALL-BY-NEED  = call-by-name + MEMOIZE → evaluate ONCE      (Haskell laziness, Scala lazy val)
THUNK         = () -> T : zero-arg closure, the deferral mechanism
COPY-RESTORE  = value-result: copy in, write back at RETURN (Ada in out, Fortran)

TERMINATION:  non-strict can return where strict diverges  (const 42 undefined → 42)
SHORT-CIRCUIT (&& || ?:) = non-strictness you already use, NOT memoization
SPACE LEAK    = pile-up of unforced thunks (laziness' cost) → seq / foldl' / BangPatterns
ALIASING TEST f(x,x) separates value / reference / copy-restore / name
```

---

## Summary

- Passing has two independent axes: **what** the parameter aliases (junior) and **when** the argument is evaluated (this page).
- **Strict** = evaluate arguments before the call; **non-strict** = defer them. Non-strict evaluation can **terminate where strict loops forever** because unused arguments are never forced.
- **Call-by-name** binds the unevaluated *expression* and re-evaluates it on every use (Scala `=> T`, Algol; Jensen's device is the classic demo).
- **Call-by-need** = call-by-name + **memoization** → evaluate at most once. This *is* lazy evaluation (Haskell, Scala `lazy val`).
- **Thunks** (`() -> T`) are how strict languages simulate non-strictness — for lazy logging, deferred defaults, and custom control flow.
- **Call-by-copy-restore** (value-result) copies in and writes back at return; it diverges from call-by-reference only under aliasing.
- Laziness's costs are **space leaks** and **unpredictable evaluation order**; default to strict and reach for laziness deliberately.

---

## Further Reading

- The Scala language spec section on by-name parameters and `lazy val`.
- The Haskell Report / GHC docs on lazy evaluation, WHNF, and strictness (`seq`, `$!`, `BangPatterns`).
- Any treatment of Jensen's device in an Algol 60 reference.
- The `senior.md` page in this topic, which makes call-by-name vs call-by-value precise as normal-order vs applicative-order reduction in the lambda calculus, and adds move semantics.
