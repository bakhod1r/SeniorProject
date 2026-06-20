# Model Checking — Junior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Model Checking
> *A test tries the handful of cases you thought of. A model checker tries every case the system can reach — and when one breaks, it doesn't just say "bug," it plays you the exact movie of how it broke.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A System Is a Graph of States](#core-concept-1--a-system-is-a-graph-of-states)
5. [Core Concept 2 — A Property Is What Must Always Be True](#core-concept-2--a-property-is-what-must-always-be-true)
6. [Core Concept 3 — Checking Means Exploring Every Reachable State](#core-concept-3--checking-means-exploring-every-reachable-state)
7. [Core Concept 4 — The Counterexample Is the Whole Point](#core-concept-4--the-counterexample-is-the-whole-point)
8. [Core Concept 5 — State-Space Explosion: Why Models Stay Small](#core-concept-5--state-space-explosion-why-models-stay-small)
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

> Focus: **What is model checking, and why is it different from testing?**

Imagine two threads sharing one counter. Each does the obvious thing: read the counter, add one, write it back. You run it. It works. You run it a thousand times. It works. You ship it. Three weeks later the count is mysteriously low under load, and you spend two days staring at code that *looks* correct.

It is correct — on the interleavings your test happened to hit. The bug only appears when both threads read `0` at the same instant, both compute `1`, and both write `1` — so two increments produce a count of `1`, not `2`. Your test never scheduled the threads in that exact order. It *couldn't* reliably: thread timing is the operating system's decision, not yours.

**Model checking** is the tool that catches this. You describe the system as a small **model** — the variables, and the steps that change them. You write down a **property** — "the final count equals the number of increments." Then a model checker does something no test can: it **automatically and exhaustively explores every reachable state** of the model — every possible ordering of every step — and either proves the property always holds, or hands you a **counterexample**: a precise, step-by-step trace showing exactly how the system reaches a bad state.

That is the headline difference. A **test** explores a *few* paths that *you* chose. A **model checker** explores *all* paths, for a finite model, *by machine*. Where a test asks "does it work for this input?", a model checker asks "is there *any* input or ordering, anywhere in the whole state space, that breaks this?"

> **Mindset shift:** Stop thinking "I'll write tests until I'm confident." Start thinking "I'll describe the design and let a machine search every reachable state for a counterexample." Testing samples; model checking *exhausts* (for a small model). The skill you're learning is not a new test framework — it's a new question: *not* "does my example pass?" but "can the tool find any way to break my design at all?"

This page teaches the building blocks — state, transition, state space, property, counterexample — using tiny concurrent examples a junior can hold in their head. The deeper formalism (temporal logic, the algorithms) waits for later tiers. What you'll take away: for anything with concurrency or tricky state, a *tiny* model plus a model checker finds interleaving bugs your tests will never reliably reproduce.

---

## Prerequisites

- **Required:** You can write a program and you know that threads (or processes) run concurrently and can be interleaved by the OS in orders you don't control.
- **Required:** You've written at least one test and understand that a passing test only tells you about the cases it ran.
- **Helpful:** You've hit (or heard of) a *race condition* or a *Heisenbug* — a bug that vanishes when you add a print statement or attach a debugger.
- **Helpful:** You've seen a graph (nodes and edges). A state space is just a big graph; if you can picture nodes connected by arrows, you're ready.
- **Not required:** Any math, logic notation, or prior exposure to formal methods. Every term is defined below.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Model** | A small, simplified description of your system: its variables and the steps that change them. *Not* your real code — an abstraction of it. |
| **State** | A snapshot of all the variables at one moment (e.g. `count=1, thread A is at line 3`). |
| **Transition** | A single step that moves the system from one state to another (one thread executing one line). |
| **State space** | All the states the system can reach, connected by transitions — a giant graph. |
| **Reachable state** | A state you can actually arrive at by starting from the initial state and following transitions. |
| **Property** | A statement that must hold — what "correct" means (e.g. "two threads are never both in the critical section"). |
| **Safety property** | "Something bad never happens." A property the checker can disprove with a *finite* trace. |
| **Liveness property** | "Something good eventually happens." About the system making progress, not getting stuck. |
| **Counterexample (trace)** | The step-by-step sequence of states the checker found that violates a property — the "movie of the bug." |
| **Interleaving** | One particular ordering of the steps of concurrent threads/processes. |
| **State-space explosion** | The number of reachable states growing exponentially as you add variables or processes. |
| **Model checker** | The tool that explores the state space and checks properties (e.g. **SPIN**, **TLC** for TLA+, **Alloy Analyzer**). |
| **Critical section** | A piece of code that only one process may execute at a time (e.g. updating shared data). |

---

## Core Concept 1 — A System Is a Graph of States

Before you can check anything, you need to see your system the way a model checker does: as a **graph**. Every node is a **state** — a complete snapshot of every variable. Every edge is a **transition** — one step the system can take.

Take a traffic light. Its only variable is `color`, which can be `Red`, `Green`, or `Yellow`. The steps are: green→yellow, yellow→red, red→green. As a graph:

```text
   ┌──────────────────────────────┐
   ▼                              │
 [Red] ──────► [Green] ──────► [Yellow]
```

Three states, three transitions. The **state space** is the whole picture. A model checker can walk this graph and confirm a property like "the light is never both Red and Green" trivially — there's no state where that's true.

Now make it concurrent, where it gets interesting. Two processes, A and B, each want to enter a **critical section** (say, write to shared data). The simplest model of each process: a flag for "where am I" — `idle`, `trying`, or `critical`. A *combined* state must record where *both* are at once, because the bug we care about is about both of them together:

```text
state = (A's location, B's location)

initial:  (idle, idle)
```

From `(idle, idle)`, two things can happen — A moves, or B moves. That's two outgoing transitions. From *each* of those, again two. The graph branches:

```text
                 (idle, idle)
                 /          \
        A starts/            \B starts
               ▼              ▼
        (trying, idle)    (idle, trying)
            /    \            /    \
         ...    ...        ...    ...
```

> **Key insight:** A model checker doesn't reason about *your code line by line* — it reasons about *states and the transitions between them*. The single most important modeling move is deciding **what goes into a state**. For a concurrency bug, the "where is each process" location *must* be part of the state, because the bug is "both are in the critical section at once" — and you can't even *express* that unless both locations are in the snapshot.

The branching is the key. Every place two processes *could* both take a step, the graph splits — and each branch is a different **interleaving**. Real concurrency means *all* these branches are possible, because the OS, not you, decides who runs next. Testing might hit a few of these branches by luck. The model checker visits *every* one.

---

## Core Concept 2 — A Property Is What Must Always Be True

A model checker is useless without a **property** — a precise statement of what "correct" means. You can't check "is it good?"; you must say *exactly* what good is. Properties come in two flavors, and the difference is the most useful idea in this whole topic.

**Safety — "something bad never happens."** This is the common case. For the two-process example:

```text
SAFETY:  it is never the case that A is critical AND B is critical
         (at most one process in the critical section, ever)
```

Safety says a *bad state* is never reached. The beautiful thing: if safety is violated, there's a **finite trace** that proves it — a sequence of steps ending in the bad state. The checker can *show* you the violation.

**Liveness — "something good eventually happens."** This is about *progress*:

```text
LIVENESS: if a process is trying to enter, it eventually enters
          (no process waits forever — no starvation)
```

Liveness rules out systems that are "safe" by doing nothing useful. A traffic light stuck on Red forever is perfectly *safe* (it never shows two colors) but obviously broken — it never lets anyone go. Liveness catches that.

Here's the intuition for why they differ. A safety violation is something that happens at a *specific moment* (the instant both enter the critical section). A liveness violation is something that *never* happens no matter how long you wait (the waiting process is forever skipped). Safety is broken by a finite "gotcha"; liveness is broken by an infinite "still waiting...".

> **Key insight:** Keep it intuitive at this tier: **safety = "never bad," liveness = "eventually good."** Almost every bug a junior cares about — data races, two-things-at-once, an invariant violated — is a *safety* property, and safety is exactly where counterexamples are easiest to read. The formal notation (LTL, CTL, `□` and `◇`) is real and useful, but it's [TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md)'s job. For now: name the bad thing that must never happen, and the good thing that must eventually happen.

A subtle trap worth flagging now: a property that's *too weak* passes for the wrong reason. "At most one in the critical section" is satisfied by a broken lock that *never lets anyone in* — zero is "at most one"! That's why you need both: safety says "not too many," liveness says "but not zero forever."

---

## Core Concept 3 — Checking Means Exploring Every Reachable State

Now the engine. Once you have a model (states + transitions) and a property, the model checker does conceptually one thing: it starts at the initial state and **systematically visits every state reachable from it**, checking the property at each one. It's a graph search — the same breadth-first or depth-first traversal you may have met in algorithms — applied to the state space.

In pseudocode, the heart of a (safety) model checker is strikingly simple:

```text
frontier = { initial_state }      # states discovered but not yet explored
visited  = { }                    # states we've already checked

while frontier is not empty:
    s = take a state from frontier
    add s to visited

    if PROPERTY is false in s:
        return COUNTEREXAMPLE: the path from initial_state to s   # found a bug!

    for each transition s -> s':           # every step possible from s
        if s' not in visited:
            add s' to frontier

return "PROPERTY HOLDS"           # explored everything, never saw a bad state
```

Read what that loop guarantees. If *any* reachable state violates the property, the search *will* reach it and report it. If the loop finishes without finding one, it has **proven** the property — not "we tested a lot," but "there is no reachable state where this is false," because it literally looked at all of them.

This is the superpower and it's worth dwelling on. Compare:

| | A test | A model checker |
|---|---|---|
| How many cases? | The few you wrote | *All* reachable states |
| Who chooses the interleaving? | The OS, unpredictably | The checker, *all* of them |
| Result on success | "Passed (these cases)" | "Holds (every reachable state)" |
| Result on failure | "Assertion failed" (maybe) | A full step-by-step counterexample |
| Catches rare race? | Only if you got lucky | Always, if it's in the model |

The `visited` set matters: many transitions lead back to states you've already seen (the traffic light loops Red→Green→Yellow→Red forever). Without remembering visited states, the search would loop infinitely. With it, the search terminates the moment there are no *new* states to explore — which is exactly when "every reachable state" has been covered.

> **Key insight:** "Exhaustive" is precise, not marketing. A model checker explores **every reachable state of the model** — so a passing check is a *proof over the model*, and a failing check is a *concrete trace*. The catch hiding in the word *model*: it proves things about the **abstraction you wrote**, not your production code. If your model leaves out the thing that actually breaks, the checker can't see it. Modeling well — putting the right things in the state — is the real skill.

---

## Core Concept 4 — The Counterexample Is the Whole Point

If you remember one thing from this page, remember this: **a model checker doesn't just tell you a property fails — it shows you the exact sequence of steps that makes it fail.** That trace is called a **counterexample**, and it is the feature that makes model checking worth the effort.

Back to the two threads incrementing a shared counter. Model each increment as three separate steps, because that's what the hardware really does:

```text
  read:  tmp ← count        (load count into a local temp)
  add:   tmp ← tmp + 1      (increment the temp)
  write: count ← tmp        (store the temp back)
```

Property: after both threads finish one increment each, `count == 2`. Run the checker. It comes back with a counterexample — the movie of the bug:

```text
COUNTEREXAMPLE  (property "count == 2 at end" violated)

step  action                         count   A.tmp   B.tmp
────  ─────────────────────────────  ─────   ─────   ─────
init                                    0       -       -
 1    A: read   (A.tmp ← count)         0       0       -
 2    B: read   (B.tmp ← count)         0       0       0     ◄─ B reads the STALE 0
 3    A: add    (A.tmp ← A.tmp+1)       0       1       0
 4    A: write  (count ← A.tmp)         1       1       0
 5    B: add    (B.tmp ← B.tmp+1)       1       1       1
 6    B: write  (count ← B.tmp)         1       1       1     ◄─ B overwrites A's work!

RESULT: count == 1, expected 2.   ✗ LOST UPDATE
```

Read it top to bottom and the "impossible" bug becomes obvious. Both threads read `0` (steps 1–2) *before* either writes. A writes `1` (step 4). Then B, still holding the stale `0` it read back in step 2, computes `1` and writes `1` again (step 6) — silently erasing A's increment. This is the classic **lost update**, and the counterexample doesn't *describe* it, it *demonstrates* it, step by step, with the exact interleaving.

Why this is transformative for a junior:

- **It's reproducible.** The bug that "only happens under load" is now a deterministic, replayable sequence. No more sprinkling print statements hoping to catch it.
- **It's exact.** It names the precise interleaving (B reads before A writes). You don't guess; you read.
- **It tells you what to fix.** The fix is obvious once you see it: the read-add-write must be *atomic* (one lock around all three, or an atomic increment) so no other thread can squeeze in between read and write.

> **Key insight:** The counterexample is the killer feature. Compilers and linters say "something is wrong here." A model checker says "here is *the exact sequence of events* that makes it go wrong" — and a concrete trace you can read top-to-bottom is worth more than a hundred warnings, because it turns an abstract "race condition" into a movie you can watch frame by frame.

---

## Core Concept 5 — State-Space Explosion: Why Models Stay Small

If exhaustive search is so powerful, why not point a model checker at your whole codebase? One brutal reason: **state-space explosion.** The number of reachable states grows *exponentially* as you add variables or processes — fast enough to overwhelm any computer.

Count it for the counter example. Each thread is at one of 4 points (before-read, before-add, before-write, done), and `count` plus two temps each hold a small number. Rough arithmetic:

```text
states ≈ (positions of A) × (positions of B) × (values of count) × (A.tmp) × (B.tmp)

2 threads:   manageable — thousands of states
3 threads:   the "positions" factor cubes;  tens of thousands+
N threads:   ~ k^N   ← exponential in the number of threads
```

The pattern is the headline: every independent thing you add *multiplies* the state count. Two booleans → 4 states. Ten booleans → 1,024. Thirty booleans → over a billion. Add a second process and you multiply by *its* whole state count. This is why you can't just feed in your real program with its millions of variables — the graph would be astronomically large.

```text
variables          rough state count
─────────          ─────────────────
 1 boolean                  2
10 booleans             1,024
20 booleans         1,048,576
30 booleans     1,073,741,824   ← already a billion, from 30 bits
```

So the working method of model checking is: **build a small, abstract model — not your whole system.** You deliberately strip away everything irrelevant to the property and shrink everything else:

- Model **2 or 3** threads, not 10,000 — concurrency bugs almost always show up with the *smallest* number of participants that can trigger them (often just 2).
- Replace a real 64-bit integer with a tiny range (`0..3`), or a real queue with one bounded to length 2.
- Keep only the variables the property actually mentions; drop the rest.

This is a feature, not a defect. The discipline of abstraction *forces you to understand what actually matters* for correctness. A two-process, three-state model can reveal a flaw that would sink a distributed system of thousands of nodes — because the *logical* flaw doesn't need thousands of nodes to appear.

> **Key insight:** State-space explosion is *the* central limitation of model checking, and it's why you check a **small, abstract model of your design**, never your full codebase. The good news, and the reason the field works at all: most bugs are **small**. If two processes can deadlock, two processes are enough to *show* the deadlock — you rarely need more. Modern checkers also fight explosion with clever tricks (storing states compactly, skipping equivalent interleavings), which the [middle.md](middle.md) and senior tiers cover. For now, internalize the trade: tiny model, total certainty *about that model*.

---

## Real-World Examples

**1. Amazon Web Services finds deep bugs in DynamoDB — before shipping.** AWS engineers wrote TLA+ models of core distributed protocols (DynamoDB replication, S3, others) and ran the TLC model checker on them. It found subtle bugs requiring **35 steps** of a specific interleaving to trigger — sequences no human reviewer or test suite would ever have hit, found in a *design model* before the code was trusted in production. This is the canonical "model checking pays off" story, and it's *exactly* the small-model-finds-deep-bug pattern from Concept 5. (See [TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md) for the tool they used.)

**2. The Therac-25 and the cost of *not* checking concurrency.** The Therac-25 radiation-therapy machine killed and injured patients in the 1980s. A root cause was a **race condition**: a specific, fast operator-input interleaving put the machine into a state that delivered a massive overdose — precisely the kind of "rare interleaving reachable in the state space" a model checker is built to find. The bug existed in the reachable states; testing simply never hit that ordering. It is the most sobering argument for "test your *design*, not just your code."

**3. Mutual-exclusion algorithms taught with a checker.** Classic lock algorithms — Peterson's algorithm, Dekker's algorithm — are routinely *modeled in SPIN or TLA+* by students and engineers. The checker confirms safety (never two in the critical section) and liveness (a waiting process eventually enters), and — more instructively — *breaks* a naive lock by producing the exact interleaving that violates mutual exclusion. Seeing the counterexample teaches the "why" of correct locking far better than reading the finished algorithm.

**4. Your own naive lock, in five minutes.** You don't need AWS's scale. Model two threads and a single shared variable in TLA+ or Promela (SPIN's language), assert "count is correct at the end," and the checker hands you the lost-update trace from Concept 4 in seconds. The point of this example is accessibility: the *smallest* useful model — two threads, one counter — already catches a real, common, hard-to-reproduce bug.

---

## Mental Models

- **The state space is a maze; the model checker is a robot that walks every corridor.** A test is one person trying a few paths they remember. The robot visits *every* room and checks a sign on each wall ("is the property true here?"). If it ever finds a room where the sign reads false, it prints the exact directions from the entrance to that room — your counterexample.

- **A property is a "this must always be true" sticker on every state.** Safety = "no room is ever on fire." Liveness = "every guest eventually reaches the exit." The checker walks the maze enforcing the stickers. Safety fails the instant *one* room is on fire; liveness fails only if a guest can wander *forever* without exiting.

- **The counterexample is a movie, not a review.** A linter is a critic saying "this scene is bad." A model checker is a projector playing the exact footage of the disaster, frame by frame, so you can see precisely where it went wrong. You don't theorize about the race; you *watch* it.

- **State-space explosion is a multiplying mirror room.** Add one mirror (variable) and the reflections (states) don't add — they *multiply*. That's why you keep the room tiny: a few mirrors give you a few clear reflections; a hundred give you an unsearchable infinity. Model small on purpose.

- **Model checking is testing your *blueprint*, not your *building*.** You don't wait until the skyscraper is built to discover the foundation is flawed. You check the design — the small abstract model — *before* you pour concrete. Catching a design bug here costs an afternoon; catching it in production costs a Therac-25.

---

## Common Mistakes

1. **Thinking a model checker checks your real code.** It checks the **model** — the abstraction *you* wrote. If the model omits the variable or step that actually breaks, the checker happily reports "all good." Garbage model in, false confidence out. The art is choosing *what* to put in the state.

2. **Believing "the property holds" means "no bugs."** It means "no reachable state of *this model* violates *this property*." A bug in a part you didn't model, or a property you didn't write, is invisible. A pass is only as strong as your model *and* your property.

3. **Writing a property that's too weak (or trivially true).** "At most one process in the critical section" is satisfied by a lock that *never lets anyone in*. You also need a liveness property ("a waiting process eventually enters") to rule out "safe but useless." Always ask: *what broken system would still pass this?*

4. **Modeling too much and hitting state-space explosion.** Trying to model 10,000 threads or a full 64-bit integer makes the state space astronomically large and the checker runs forever (or out of memory). Shrink aggressively: 2–3 processes, tiny value ranges. Most bugs appear at the smallest scale that can trigger them.

5. **Confusing model checking with testing.** They're complementary, not the same. Testing runs *real* code on *some* inputs; model checking explores *all* states of an *abstract* model. A passing model check does not mean your *implementation* matches the model — that's a separate concern (and a real source of bugs).

6. **Ignoring the counterexample's detail.** The trace tells you the *exact* interleaving — read it step by step. Juniors sometimes see "violated" and start guessing at fixes; the counterexample already *shows* the cause (e.g. "B read before A wrote"). Read the movie before you rewrite the code.

---

## Test Yourself

1. In one sentence each, what is the difference between a **test** and a **model checker** in terms of how many cases each explores and who chooses the interleaving?
2. Define **state**, **transition**, and **state space** in your own words, using the two-process critical-section example.
3. Classify each property as **safety** or **liveness**: (a) "the two processes are never both in the critical section"; (b) "a process that wants the lock eventually gets it"; (c) "the balance never goes negative."
4. Two threads each run `count = count + 1` (read, add, write) starting from `count = 0`. Sketch a counterexample interleaving that ends with `count == 1`, and name the bug.
5. You have 25 independent boolean variables in your model. Roughly how many states is that, and what is this problem called?
6. A teammate says "the model checker says the property holds, so the code is bug-free." Give two distinct reasons that conclusion can be wrong.

<details>
<summary>Answers</summary>

1. A **test** explores a *few* paths that *you* chose, and the *OS* decides the interleaving unpredictably; a **model checker** explores *all* reachable states of the model, trying *every* interleaving itself.
2. A **state** is a snapshot of all variables at once — e.g. `(A: trying, B: critical)`. A **transition** is one step changing that snapshot — e.g. A moves from `trying` to `critical`. The **state space** is every reachable combination connected by transitions: the whole graph of where both processes can be.
3. (a) **Safety** ("never bad" — two-at-once never happens). (b) **Liveness** ("eventually good" — progress, no starvation). (c) **Safety** ("never bad" — a bad state, negative balance, is never reached).
4. `count=0`. Thread A reads `0` (tmp=0). Thread B reads `0` (tmp=0). A adds → tmp=1, A writes → `count=1`. B adds → tmp=1, B writes → `count=1`. Two increments, result `1`. This is a **lost update** (a race condition): B overwrote A's write because it read the value *before* A stored it. Fix: make read-add-write atomic (a lock, or an atomic increment).
5. About 2²⁵ ≈ **33 million** states (each boolean doubles the count). This is **state-space explosion** — the exponential blow-up that forces models to stay small.
6. Any two of: (a) it only proves things about the **model**, not the real code — the model may omit what actually breaks; (b) it only checks the **properties you wrote** — a bug you didn't state a property for is invisible; (c) the **implementation may not match the model** — a verified design can be coded wrong; (d) the property may be **too weak** and pass for the wrong reason.

</details>

---

## Cheat Sheet

```text
THE BUILDING BLOCKS
  state        = snapshot of ALL variables at one moment
  transition   = one step from one state to the next
  state space  = all reachable states + transitions (a big graph)
  property     = what must be true ("correct" defined precisely)
  counterexample = step-by-step trace showing how a property breaks

PROPERTY TYPES
  safety    = "something bad NEVER happens"      → finite trace disproves it
              e.g. never two in the critical section; balance never negative
  liveness  = "something good EVENTUALLY happens" → about progress / no starvation
              e.g. a waiting process eventually enters

WHAT MODEL CHECKING DOES
  given (model + property):
    explore EVERY reachable state, check property at each
    → "HOLDS"            (proof over the model — looked at all states)
    → COUNTEREXAMPLE     (concrete trace to a bad state)

TEST  vs  MODEL CHECK
  test         = a FEW paths you chose; OS picks the interleaving
  model check  = ALL reachable states; checker tries EVERY interleaving

THE CATCH: STATE-SPACE EXPLOSION
  states grow EXPONENTIALLY with variables/processes
  N booleans → 2^N states   (30 bits ≈ 1 billion)
  ⇒ model SMALL & ABSTRACT: 2–3 processes, tiny value ranges, only relevant vars

REMEMBER
  it checks the MODEL, not your real code
  a pass = "no reachable state of THIS model breaks THIS property"
  the COUNTEREXAMPLE is the killer feature — it shows the movie of the bug

TOOLS (high level)
  SPIN (+ Promela) · TLA+ / TLC · Alloy Analyzer
```

---

## Summary

- **Model checking** lets a tool **automatically and exhaustively explore every reachable state** of a system model to check whether a property always holds — and if it doesn't, it returns a **counterexample**: a concrete, step-by-step trace of exactly how things go wrong.
- The difference from **testing** is the whole point: a test tries a *few* paths *you* picked while the OS chooses interleavings unpredictably; a model checker tries *all* reachable states and *every* interleaving by machine. Testing samples; model checking exhausts (for a finite model).
- The building blocks: a **state** is a snapshot of all variables, a **transition** is one step, the **state space** is the graph of all reachable states, and a **property** is what must be true. **Safety** = "never bad" (disproved by a finite trace); **liveness** = "eventually good" (about progress).
- The **counterexample** is the killer feature — not "there's a bug" but "*here is the exact sequence of events* that triggers it," turning an unreproducible race into a movie you can read top to bottom and fix.
- The central limitation is **state-space explosion**: states grow exponentially with variables and processes, so you check a **small, abstract model** of your *design*, never your whole codebase. Most bugs are small — two processes are usually enough to expose a concurrency flaw.

You now have the core idea: describe the design as a tiny model, name what must always be true, and let a machine search every reachable state for a way to break it. This is **testing your design before you build it** — and for anything concurrent or stateful, it finds bugs your tests never will.

---

## Further Reading

- **Hillel Wayne — [*Learn TLA+*](https://learntla.com/)** and *Practical TLA+*. The friendliest on-ramp to model checking through TLA+; start here if you want to *run* a checker this week.
- **An Introduction to SPIN / Promela** — Gerard Holzmann's [SPIN model checker](https://spinroot.com/) site and *The SPIN Model Checker* book. The classic explicit-state checker; great for the concurrency examples on this page.
- **Clarke, Grumberg, Peled & Veith — *Model Checking*.** The canonical, authoritative textbook of the field. Heavy going for a junior — bookmark it for when you want the algorithms and the theory, not your first read.
- **Daniel Jackson — *Software Abstractions*** (the Alloy book). A different, lightweight flavor of model checking focused on structures and relations; very readable.
- The [middle.md](middle.md) of this topic, which formalizes the state-transition system, explains how checkers fight state-space explosion, and connects safety/liveness to temporal logic.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/junior.md) — writing the *spec* of the design that a model checker then verifies; the input to the whole process.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md) — the formal language for properties (LTL/CTL, safety vs liveness) and the TLC checker AWS used.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md) — the cheaper rung: property-based testing and contracts when full model checking is overkill.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/junior.md) — the engineering judgement of *where* exhaustive checking is worth the cost.
- [Testing](../../testing/) — the sampling-based complement; model checking is what you reach for when testing's "few cases" isn't enough.
