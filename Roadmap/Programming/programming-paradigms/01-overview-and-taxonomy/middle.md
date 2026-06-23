# Overview & Taxonomy — Middle Level

> **Roadmap:** [Programming Paradigms](../README.md) → Overview & Taxonomy
>
> *Junior asks "what is a paradigm?"; middle asks "what are the actual axes that separate them — and what happens to my code when I move along one?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [From a Spectrum to Axes: How Paradigms Are Really Classified](#from-a-spectrum-to-axes-how-paradigms-are-really-classified)
4. [The Four Axes That Do the Work](#the-four-axes-that-do-the-work)
5. [Van Roy's Insight: Paradigms Are Concepts Added to a Kernel](#van-roys-insight-paradigms-are-concepts-added-to-a-kernel)
6. [Adding One Concept #1: Mutable State](#adding-one-concept-1-mutable-state)
7. [Adding One Concept #2: Concurrency](#adding-one-concept-2-concurrency)
8. [Plotting the Common Paradigms on the Axes](#plotting-the-common-paradigms-on-the-axes)
9. [Applying the Taxonomy: Reading Code by Its Axes](#applying-the-taxonomy-reading-code-by-its-axes)
10. [The Same Problem, Four Axes Apart](#the-same-problem-four-axes-apart)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does it work, and how do I apply the taxonomy?**

At the junior level you learned that a paradigm is a way of thinking about what a program *is*, and that the single most useful axis is **imperative ("how") ↔ declarative ("what")**. That one axis is a great starting map, but it is one-dimensional — and the moment you try to place, say, the actor model or reactive streams on a single left-to-right line, the line buckles. Are actors imperative or declarative? Both, neither, depends. The honest answer is that "imperative ↔ declarative" is a *projection* of a higher-dimensional space onto one line, and at this level you graduate to the actual dimensions.

This file does three things. First, it replaces the single spectrum with a small set of **independent axes** — state mutability, control-flow explicitness, evaluation order, and what entities are first-class — that together explain why paradigms feel different. Second, it introduces Peter Van Roy's framework: a paradigm is not a vague style but a **specific set of concepts you add to a minimal kernel language**, and adding *one* concept moves you precisely from one paradigm to a neighbor. Third, it shows you that movement in code: we add mutable state to a functional kernel (and watch functional become imperative) and then add concurrency (and watch sequential become concurrent), one concept at a time.

The payoff is operational. Once you can name *which* axis a piece of code sits on, "what paradigm is this?" stops being a vibe check and becomes a checklist: does it mutate? is control explicit or managed by a runtime? is evaluation eager or deferred? what can I pass around as a value? Answer those four and you have classified the code.

> **The mindset shift:** stop ranking paradigms on one line. Start measuring code along several independent axes — because that's how you'll later *choose* one deliberately instead of inheriting it.

---

## Prerequisites

- **Required:** You've read [`junior.md`](junior.md) — you know the imperative ↔ declarative spectrum and can name the four starter paradigms (procedural, OOP, functional, declarative).
- **Required:** You can read **Python**, a little **Go**, and an **SQL** query, and you've written both a mutating loop and a `map`/comprehension.
- **Helpful:** You've seen a closure (a function that captures a variable) — it's the carrier of "first-class functions," one of the axes here. See [FP → First-Class & Higher-Order Functions](../../code-craft/functional-programming/01-first-class-and-higher-order-functions/middle.md).
- **Helpful:** A nodding acquaintance with concurrency (threads, goroutines, async) — we add it as a "concept" later. Mechanics live in [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/).
- **Not required:** Formal language theory. We use Van Roy's framework informally, as a *map*, not a proof.

---

## From a Spectrum to Axes: How Paradigms Are Really Classified

The junior spectrum collapses everything onto one question: *how much do you say about "how"?* That's pedagogically perfect and analytically thin. Two paradigms can both be "fairly declarative" and yet be nothing alike — SQL and the actor model both hide steps from you, but for completely different reasons (a query planner vs. independent processes), and you reason about them in completely different ways.

The fix is to treat "imperative ↔ declarative" as the *resultant* of several deeper, **independent** properties. Think of each as a knob you can turn separately:

```
                 ┌──────────────────────────────────────────────┐
                 │  A paradigm = a SETTING on each of these knobs │
                 └──────────────────────────────────────────────┘

  STATE          immutable ────────────────────────────► mutable
  CONTROL FLOW   implicit (runtime drives) ────────────► explicit (you drive)
  EVALUATION     lazy / deferred ──────────────────────► strict / eager
  FIRST-CLASS    functions, rules, processes, time… are values ── or not
```

"Imperative" turns out to mean roughly *mutable state + explicit control flow + strict evaluation*. "Declarative" means *immutable + implicit control + (often) lazy*. But because the knobs are independent, you can build paradigms the one-line model can't even name: a language that is **immutable but with explicit control** (pure functional with recursion), or **mutable but with implicit control** (a reactive UI where you mutate state and a runtime re-derives the view). The axes are how you tell those apart.

> **Key reframe:** a paradigm is a *point in a multi-dimensional space of choices*, not a position on a line. The line was the shadow; the axes are the object casting it.

---

## The Four Axes That Do the Work

Four axes account for most of what makes paradigms feel categorically different. Learn to read each off a snippet on sight.

### Axis 1 — State mutability

*Does data change in place, or do you only ever produce new values?*

```python
# MUTABLE: the list object is changed in place; its identity persists.
xs = [1, 2, 3]
xs.append(4)          # xs is the same object, now [1, 2, 3, 4]

# IMMUTABLE: you build a new value; the old one is untouched.
ys = (1, 2, 3)
zs = ys + (4,)        # zs is a NEW tuple; ys is still (1, 2, 3)
```

Mutability is the deepest axis because it determines whether *time* matters: with mutable state, the answer to "what is `xs`?" depends on *when* you ask. Immutability makes a value's meaning independent of time — which is exactly what makes functional code easier to reason about and safer under concurrency, and what makes imperative code direct and cache-friendly. (Detailed treatment lives in [FP → Immutability](../../code-craft/functional-programming/03-immutability/middle.md).)

### Axis 2 — Control-flow explicitness

*Do you write the order of operations, or does a runtime decide it?*

```python
# EXPLICIT control: you wrote the loop, the order, the termination.
total = 0
for o in orders:
    total += o.amount

# IMPLICIT control: you described a result; SQL's planner picks the order,
# the join algorithm, whether to use an index — none of which you wrote.
# SELECT SUM(amount) FROM orders;
```

The further right on this axis, the more a *runtime* (query planner, event loop, solver, scheduler) owns sequencing. This is the axis the junior spectrum mostly captured — but notice it's separate from mutability. SQL is implicit-control *and* (conceptually) immutable; a `for` loop is explicit-control *and* usually mutable. They differ on two knobs, not one.

### Axis 3 — Evaluation order (strict vs. lazy)

*Is an expression evaluated when you write it, or only when its result is demanded?*

```python
# STRICT/EAGER: range materializes? No — but list() forces it all now.
squares = [x*x for x in range(10)]      # all ten computed immediately

# LAZY: nothing is computed until something pulls values out.
squares = (x*x for x in range(10))      # a generator — computes on demand
next(squares)  # 0   <- only NOW is the first element produced
```

Evaluation order is its own axis because it changes *what programs are even possible*: lazy evaluation lets you describe **infinite** structures (an unbounded stream of primes) and only pay for the prefix you consume. Haskell is lazy by default; most languages are strict but offer lazy escapes (generators, streams, `Iterator`). This axis is invisible on the imperative/declarative line yet decisive for stream and reactive paradigms. (See [FP → Laziness & Streams](../../code-craft/functional-programming/12-laziness-and-streams/middle.md).)

### Axis 4 — Which entities are first-class

*What can you store in a variable, pass as an argument, and return?*

A thing is **first-class** if the language treats it as an ordinary value. The set of first-class entities is a paradigm fingerprint:

| Paradigm | Newly first-class entity |
|---|---|
| Procedural | data, procedures (as call targets) |
| Functional | **functions** (pass, return, compose) |
| OOP | **objects** (and sometimes classes/messages) |
| Logic | **relations / rules** the engine searches |
| Reactive | **time-varying values** (signals, observables) |
| Actor | **processes** and **messages** |
| Symbolic / Lisp | **code itself** (programs are data — homoiconicity) |

Each paradigm earns its identity largely by making *one more kind of thing* a value you can manipulate. Functional programming's whole leverage comes from functions being first-class; reactive's from a *changing value over time* being a first-class object you can `map` and combine. When you ask "what paradigm is this?", a fast route is "what unusual thing is being passed around as if it were a number?"

---

## Van Roy's Insight: Paradigms Are Concepts Added to a Kernel

The axes tell you how to *describe* a paradigm. Peter Van Roy's framework (*Programming Paradigms for Dummies*, and the CTM book) tells you how paradigms *relate*: each one is a minimal **kernel language** plus a specific set of **concepts**, and the paradigms form a graph where an edge means "adds exactly one concept."

The idea: start with a tiny kernel — variables, function definition and call, conditionals. That kernel, with nothing added, is **strict functional programming** (sometimes called the declarative model): pure, deterministic, no mutation, no concurrency. Now add concepts one at a time:

```
                  (kernel: values, functions, conditionals)
                          = strict functional / declarative
                                    │
              ┌─────────────────────┼──────────────────────┐
        + mutable cell        + concurrency           + nondeterminism
              │                     │                       │
     imperative / stateful     dataflow / declarative   relational /
     (and the road to OOP)      concurrency             logic programming
              │                     │
              └──────── + both ─────┴──► message-passing concurrency
                                          (actors, stateful + concurrent)
```

Two consequences make this powerful at the middle level:

1. **Paradigms are not islands; they are *reachable* from one another by adding a single concept.** "OOP vs FP" stops looking like a war and starts looking like "FP plus mutable state plus a discipline for bundling it." That's why multiparadigm languages are natural, not hacks — they simply expose several concepts and let you choose.

2. **Each added concept has a cost, paid in reasoning.** Van Roy's striking claim: *add a concept only when you must, because each one weakens the properties you can rely on.* Add mutable state and you lose referential transparency (a call's result now depends on history). Add concurrency and you lose determinism (results depend on timing). This is the seed of the **principle of least power** you'll meet at the senior level: the fewer concepts a piece of code uses, the more you can prove about it.

> **The lever to remember:** you don't *switch* paradigms by rewriting from scratch — you *add or remove a concept* (mutation, concurrency, laziness, first-class functions) and the code slides to a neighboring paradigm. The next two sections show exactly that.

---

## Adding One Concept #1: Mutable State

Start in the kernel — strict functional. We compute a running total **without mutation**, by passing the accumulator forward through recursion. Nothing changes in place; each call produces a new value.

```python
# FUNCTIONAL kernel: no mutable cell. State is threaded as an argument.
def total(orders, acc=0):
    if not orders:
        return acc
    head, *rest = orders
    return total(rest, acc + head.amount)   # new acc each call; nothing mutates
```

This code has strong properties: `total(orders)` always returns the same answer for the same input, in any context, with no spooky action elsewhere. It is *referentially transparent* — you could replace the call with its result and nothing would notice.

Now add **one concept: a mutable cell** (a variable you assign to repeatedly). The very same computation becomes imperative:

```python
# Add a MUTABLE CELL (`total`) → the code is now IMPERATIVE.
def total(orders):
    total = 0
    for o in orders:        # explicit control flow appears alongside mutation
        total += o.amount   # the cell changes over time
    return total
```

What did adding mutable state *do* to the code's character?

- It moved us along **Axis 1** from immutable to mutable, and pulled **Axis 2** toward explicit control (a `for` loop, sequenced by us).
- It traded the strong property (referential transparency, trivially safe to call concurrently) for a benefit (directness, no recursion depth, easy in-place update of large structures).
- Conceptually, it walked us from *functional* to *imperative* by adding **exactly one concept**, just as Van Roy's graph predicts.

Push the same concept further and you reach OOP, which is, on this axis, *mutable state bundled with the procedures that own it*:

```python
# Add a DISCIPLINE around mutable state: bundle the cell with its methods → OOP.
class OrderBook:
    def __init__(self):
        self._total = 0                 # encapsulated mutable state
    def add(self, order):
        self._total += order.amount     # only methods may mutate the cell
    @property
    def total(self):
        return self._total
```

OOP didn't introduce a *new* axis here — it added **encapsulation as a discipline** over the mutable-state concept: the cell still mutates, but only through a named, controlled interface. This is why, on the axes, OOP sits near imperative (mutable, explicit-ish control) but distinguishes itself by *who is allowed to mutate and how that's organized*. (The full treatment of objects, messages, and encapsulation is the dedicated [OOP roadmap](../../object-oriented-programming/).)

---

## Adding One Concept #2: Concurrency

Return to a clean sequential computation: process three independent jobs, one after another.

```python
# SEQUENTIAL: explicit order, one job finishes before the next starts.
def run(jobs):
    results = []
    for job in jobs:
        results.append(fetch(job))   # blocks here until this fetch returns
    return results
```

This is deterministic in *time*: job 0 is done before job 1 begins. Now add **one concept: concurrency** — the ability for computations to make progress independently. We don't change *what* each job does; we change whether they're forced to wait for each other.

In **Go**, the concept is spelled with goroutines and a channel (CSP-style message passing):

```go
// Add CONCURRENCY: each fetch runs as an independent goroutine; a channel
// collects results. We no longer dictate the order they complete in.
func run(jobs []Job) []Result {
    ch := make(chan Result, len(jobs))
    for _, job := range jobs {
        go func(j Job) { ch <- fetch(j) }(j)   // independent process
    }
    results := make([]Result, 0, len(jobs))
    for range jobs {
        results = append(results, <-ch)        // arrive in completion order
    }
    return results
}
```

What did adding concurrency do?

- It moved us along **Axis 2**: we gave up explicit ordering of *when* each job runs — a *scheduler* now decides. Control flow became (partly) implicit.
- It introduced **nondeterminism**: results arrive in completion order, not submission order. The function's *behavior over time* is no longer fixed, even for fixed input. That's the property Van Roy warns concurrency costs you.
- It walked us from *sequential procedural* to a *concurrent* paradigm (here, CSP / message-passing — the subject of [07 — Actor Model & CSP](../07-actor-model-and-csp/)) by adding **one concept**.

And here is the framework's sharpest lesson, visible in this example: **concurrency is dangerous *in combination with* mutable shared state, not on its own.** If the goroutines had mutated a shared `results` slice instead of sending on a channel, we'd have a data race. By keeping state local and communicating by message, we added concurrency *without* re-introducing shared mutation — which is precisely why the actor/CSP paradigm pairs concurrency with isolation. Two concepts (mutable state, concurrency) are each manageable; their *uncontrolled* combination is where most concurrency bugs live. (Mechanics — races, channels, memory models — are in [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/); here we care that it's a *concept you add*, with a *cost you pay*.)

---

## Plotting the Common Paradigms on the Axes

With the axes and the "add a concept" lens, the paradigms you'll meet stop being a flat list and become a grid. Read each row as a *setting* on each knob.

| Paradigm | State | Control flow | Evaluation | First-class entity |
|---|---|---|---|---|
| **Procedural / imperative** | mutable | explicit | strict | procedures |
| **Object-oriented** | mutable (encapsulated) | explicit | strict | objects |
| **Functional (pure)** | immutable | explicit (recursion/HOFs) | strict or lazy | functions |
| **Declarative / query (SQL)** | immutable view | implicit (planner) | strict (set-at-once) | relations |
| **Logic (Prolog)** | immutable | implicit (search/backtrack) | lazy-ish | rules, goals |
| **Reactive** | values that change *over time* | implicit (propagation) | lazy/push | signals/observables |
| **Dataflow / stream** | immutable tokens | implicit (data dependencies) | lazy/pull | streams, nodes |
| **Actor / CSP** | isolated per-process state | implicit (scheduler) | strict | processes, messages |

Two things to notice:

- **"Imperative" and "declarative" are just clusters in this grid.** The imperative cluster is the top-left region (mutable + explicit + strict); the declarative cluster is the right region (implicit control). The grid shows *why* SQL and reactive both feel "declarative" yet differ — same control-flow setting, opposite settings on state-over-time and evaluation.
- **Neighboring rows differ by about one concept.** Functional → OOP is "+ encapsulated mutable state." Functional → reactive is "+ time-varying values + propagation." Procedural → actor is "+ concurrency + isolation." The graph from the Van Roy section is exactly these edges.

> A demonstration of `Prolog`, the logic outlier, in two lines — note there is *no control flow you wrote at all*; you state relations and pose a goal, and the engine searches:
>
> ```prolog
> parent(tom, bob).  parent(bob, ann).
> grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
> ?- grandparent(tom, Who).   % engine searches; Who = ann.
> ```
>
> First-class entity: **rules**. Control flow: **implicit** (unification + backtracking). You can't read a loop here because there isn't one — the engine owns all sequencing. That's [04 — Logic Programming](../04-logic-programming/) at the far implicit end of Axis 2.

---

## Applying the Taxonomy: Reading Code by Its Axes

The point of a taxonomy is *use*. Here is the four-question checklist to classify any snippet, and the inference each answer licenses.

1. **Does it mutate, or only produce new values?** Mutation → imperative/OOP family; new-values-only → functional/declarative family.
2. **Did *you* write the control order, or does a runtime own it?** You wrote it → imperative/functional; a planner/loop/scheduler owns it → declarative/reactive/actor.
3. **Is evaluation eager or deferred?** Eager → most imperative/strict-functional; deferred/streaming → lazy-functional, dataflow, reactive.
4. **What unusual thing is passed around as a value?** Functions → functional; objects → OOP; rules → logic; signals → reactive; messages/processes → actor.

Run it on a real fragment:

```python
# Classify me:
prices = (p * 1.1 for p in base_prices if p > 0)   # generator
expensive = sorted(p for p in prices if p > 100)
```

- Mutate? **No** — comprehensions/generators produce new values; `base_prices` is untouched.
- Control order yours? **Partly** — you wrote the pipeline, but iteration/laziness is managed.
- Eager or deferred? **Deferred** — the generator computes on demand until `sorted` forces it.
- Unusual first-class thing? **Functions** are implicit in the comprehension predicates; values flow through transformations.

Verdict: this is **functional-leaning** code (immutable, transformation pipeline, some laziness) written in a multiparadigm language. Contrast it with the same task done with an accumulator list and a `for` loop, which would answer "mutate? yes; control yours? yes; eager? yes" — **imperative**. Same language, same result, different settings on the knobs. *That* is the taxonomy doing work: it tells you which style a fragment is in, and therefore which properties you may rely on (no aliasing surprises here; safe to evaluate lazily) and which pitfalls to watch (don't consume the generator twice).

---

## The Same Problem, Four Axes Apart

To make the axes concrete, here is one task — *find the names of users who have at least one overdue invoice* — expressed at four different settings, with the axis that changed annotated.

```python
# 1. IMPERATIVE — mutable accumulator, explicit control, strict.
result = []
for u in users:
    for inv in u.invoices:
        if inv.overdue:
            result.append(u.name)
            break
# Axes: mutable / explicit / strict.
```

```python
# 2. FUNCTIONAL — no mutation, transformation pipeline, (lazily) any().
result = [u.name for u in users if any(inv.overdue for inv in u.invoices)]
# Changed Axis 1 (immutable) and Axis 3 (the inner any() is lazy/short-circuit).
```

```sql
-- 3. DECLARATIVE (SQL) — implicit control; the planner owns the "how".
SELECT DISTINCT u.name
FROM users u JOIN invoices i ON i.user_id = u.id
WHERE i.overdue = true;
-- Changed Axis 2: you no longer wrote the loop, the join order, or the index use.
```

```prolog
% 4. LOGIC — relations and a goal; the engine searches, you wrote no control.
overdue_user(Name) :- user(U, Name), invoice(U, Inv), overdue(Inv).
?- overdue_user(Who).
% Pushed Axis 2 to the extreme: control flow is unification + backtracking.
```

Every version returns the same set of names. The *journey* across them is the taxonomy: version 1→2 flips the state axis and adds laziness; 2→3 hands control flow to a runtime; 3→4 hands it to a *search* engine. None is "best" — each is the natural shape for a different context (a tight in-memory pass; a clean pipeline; data already in a database; a rules/knowledge problem). Choosing well is the senior skill; *seeing which knobs were turned* is the middle skill you're building now.

---

## Common Mistakes

- **Collapsing everything back to one line.** Forcing actors, reactive streams, and logic onto "imperative ↔ declarative" loses the very distinctions that matter. Use the axes; the line is a summary, not the model.
- **Confusing "no visible loop" with "declarative."** A `map` with a side-effecting callback has no loop *and* mutates — it's imperative wearing functional syntax. Check the **state** axis, not just the syntax.
- **Thinking multiparadigm means "no paradigm."** A multiparadigm language exposes several concepts; *your code* still picks settings on the axes in each section. "Python is multiparadigm" doesn't classify your function — its mutation/control/evaluation choices do.
- **Believing adding a concept is free.** Each concept (mutation, concurrency, laziness) buys power and *costs a property* (referential transparency, determinism, predictable evaluation). Adding one "just in case" is how reasoning quietly gets harder.
- **Mixing concepts by accident.** Concurrency plus shared mutable state, added carelessly, is the canonical source of races. The actor/CSP answer — add concurrency *with* isolation — is a deliberate pairing, not luck.
- **Treating laziness as a free optimization.** Deferred evaluation changes *when* side effects fire and lets bugs hide behind unconsumed streams. It's a different setting on a real axis, with its own failure modes.

---

## Test Yourself

1. Name the four axes from this file and give a one-line definition of each.
2. The imperative ↔ declarative spectrum is a *projection* of these axes. Which two axes most strongly determine where code lands on that line, and why isn't one enough?
3. Take a pure recursive `sum` and describe the *single concept* you'd add to make it imperative. What property do you lose?
4. SQL and a reactive UI both feel "declarative." On the axis grid, where do they agree and where do they differ?
5. Why is concurrency "safe-ish on its own but dangerous combined with shared mutable state"? How do actors/CSP resolve this?
6. Classify this with the four-question checklist: `total = sum(o.amount for o in orders if o.paid)`.
7. In Van Roy's framing, why is "OOP vs FP" a poor framing once you see paradigms as *kernel + concepts*?

<details>
<summary>Answers</summary>

1. **State mutability** (does data change in place or do you make new values), **control-flow explicitness** (do you write the order or does a runtime), **evaluation order** (eager now vs. lazy on demand), **first-class entities** (what can be stored/passed/returned — functions, objects, rules, signals…).
2. **Control-flow explicitness** (the "how much do I say about *how*" knob) and **state mutability** dominate the line: imperative ≈ mutable + explicit, declarative ≈ immutable-ish + implicit. One axis isn't enough because paradigms that share a control-flow setting (SQL vs. reactive) differ sharply on state-over-time and evaluation, and the line can't separate them.
3. Add a **mutable cell** (an accumulator variable you reassign in a loop). You lose **referential transparency** — the computation now depends on the order of assignments / history, so you can no longer freely replace a call with its value or assume trivial concurrency-safety.
4. They **agree** on control flow (implicit — a planner / a propagation runtime owns sequencing). They **differ** on the *time* dimension of state: SQL queries an immutable snapshot and returns a set once; a reactive UI's first-class values *change over time* and re-propagate, and reactive leans push/lazy while SQL is set-at-once. Different paradigms, same control-flow setting.
5. Concurrency alone (independent progress) only becomes a correctness hazard when two computations *touch the same mutable cell* without coordination — that's a data race. Concurrency over **isolated, immutable, or message-passed** state has no shared cell to corrupt. Actors/CSP resolve it by giving each process private state and forcing communication through messages/channels, so concurrency is added *with* isolation rather than over shared memory.
6. Mutate? **No** (a generator + `sum`, new value produced). Control order yours? **Mostly no** (`sum` and the generator manage iteration; you described the transform). Eager/deferred? The generator is **lazy**, forced eagerly by `sum`. Unusual first-class thing? **Functions/transforms** (the comprehension's predicate and projection). Verdict: **functional-leaning**.
7. Because both are just the kernel plus a few concepts: FP is the kernel (functions, no mutation); OOP is the kernel **plus encapsulated mutable state plus a discipline for bundling it**. They're neighbors differing by concepts, not rival worldviews — which is why real languages and real code mix them freely. The useful question isn't "which wins" but "which concepts does *this problem* actually need?"

</details>

---

## Cheat Sheet

```
PARADIGM = a SETTING on independent axes, not a spot on one line.

THE FOUR AXES:
  1. State mutability   immutable ───────► mutable
  2. Control flow       implicit (runtime) ───────► explicit (you)
  3. Evaluation         lazy / deferred ───────► strict / eager
  4. First-class        what is a value? functions | objects | rules | signals | processes

VAN ROY: paradigm = minimal KERNEL + added CONCEPTS.
  kernel (functions, conditionals)            = strict functional / declarative
  + mutable cell                              → imperative  (→ +encapsulation → OOP)
  + concurrency                               → dataflow / message-passing
  + nondeterminism                            → logic / relational
  EACH concept costs a PROPERTY:
    mutation  → lose referential transparency
    concurrency → lose determinism
    laziness  → lose predictable evaluation timing

CLASSIFY ANY SNIPPET (4 questions):
  mutate?  control-order yours?  eager or deferred?  what unusual value is passed?

DANGER: concurrency + shared mutable state = races.
  actors/CSP fix it by ADDING concurrency WITH isolation (messages, not memory).
```

---

## Summary

- The junior **imperative ↔ declarative line** is a one-dimensional shadow of a multi-dimensional space. At this level you classify code by **four independent axes**: state mutability, control-flow explicitness, evaluation order, and which entities are first-class.
- **Van Roy's framework** ties them together: a paradigm is a minimal **kernel language plus a specific set of concepts**, and paradigms form a graph where each edge adds *one* concept. You don't switch paradigms by rewriting — you add or remove a concept and slide to a neighbor.
- **Adding mutable state** turns functional into imperative (and, with an encapsulation discipline, into OOP), at the cost of referential transparency. **Adding concurrency** turns sequential into concurrent, at the cost of determinism — and is only hazardous when *combined with shared mutable state*, which is exactly why actor/CSP pairs concurrency with isolation.
- Plotted on the axes, the common paradigms form a **grid**, not a list: "imperative" and "declarative" are clusters in it, and neighboring rows differ by roughly one concept.
- The operational skill is the **four-question checklist** — mutate? control order yours? eager or deferred? what's first-class? — which classifies any snippet and tells you which properties you can rely on.
- Next: [`senior.md`](senior.md) turns this descriptive taxonomy into a *decision* tool — matching a problem's shape to a paradigm, the cost of mismatch, and the principle of least power.

---

## Further Reading

- **Peter Van Roy — *Programming Paradigms for Dummies: What Every Programmer Should Know*** — the canonical "kernel + concepts" taxonomy and the paradigm-relationship diagram this file is built on.
- **Van Roy & Haridi — *Concepts, Techniques, and Models of Computer Programming* (CTM)** — the long-form version: paradigms built up by adding concepts to a kernel, with the costs spelled out.
- **Robert W. Floyd — *The Paradigms of Programming* (1978 Turing lecture)** — the origin of the term and the argument for cultivating several paradigms.
- **Structure and Interpretation of Computer Programs (SICP), Ch. 1–3** — mutation, state, and the loss of referential transparency, taught by building interpreters.
- **Krishnamurthi — *Programming Languages: Application and Interpretation (PLAI)*** — language features (the "concepts") as composable building blocks.

---

## Related Topics

- [02 — Imperative & Procedural](../02-imperative-and-procedural/) — the kernel-plus-mutation cluster, in depth.
- [03 — Declarative Programming](../03-declarative-programming/) — the implicit-control end of Axis 2.
- [04 — Logic Programming](../04-logic-programming/) — the far implicit extreme: rules and search, no control you wrote.
- [07 — Actor Model & CSP](../07-actor-model-and-csp/) — concurrency *with* isolation, as a deliberate concept pairing.
- [17 — Multiparadigm in Practice](../17-multiparadigm-in-practice/) — languages that expose many concepts so you can pick settings per section.
- [Object-Oriented Programming](../../object-oriented-programming/) · [Functional Programming](../../code-craft/functional-programming/) — the two big dedicated roadmaps; FP is the kernel, OOP adds encapsulated mutable state.
- [Language Internals → Concurrency](../../language-internals/concurrency-async-parallel/) · [Type Systems](../../language-internals/type-systems/) — where the *mechanics* of the concepts you add actually live.
