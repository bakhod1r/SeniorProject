# TLA+ & Temporal Logic — Middle Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → TLA+ & Temporal Logic
> *The junior page sold TLA+ as "a notation for design you can run." This page makes good on it: the standard spec idiom (Init / Next / `Spec`), temporal logic stated precisely, the fairness you must add before liveness means anything, the PlusCal labels that secretly decide your atomicity, and the TLC loop — run, read the error trace, fix, re-run.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Standard Spec Idiom: Init, Next, Spec](#core-concept-1--the-standard-spec-idiom-init-next-spec)
5. [Core Concept 2 — Stuttering and `[Next]_vars`](#core-concept-2--stuttering-and-nextvars)
6. [Core Concept 3 — Temporal Logic, Done Properly](#core-concept-3--temporal-logic-done-properly)
7. [Core Concept 4 — Safety vs Liveness, and Why Liveness Needs Fairness](#core-concept-4--safety-vs-liveness-and-why-liveness-needs-fairness)
8. [Core Concept 5 — PlusCal and the Atomicity-Defining Power of Labels](#core-concept-5--pluscal-and-the-atomicity-defining-power-of-labels)
9. [Core Concept 6 — The TLC Workflow: Model, Run, Read the Trace](#core-concept-6--the-tlc-workflow-model-run-read-the-trace)
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

> Focus: **What does a TLA+ spec actually look like, what do its temporal operators mean, and how do I run the checker against it?**

At the junior level TLA+ is "pseudocode you can model-check." That framing is correct but it leaves every operational question open: *what* do you write down, in *what* structure; what does `[][Next]_vars` mean and why is it shaped like that; why does a perfectly reasonable liveness property come back "violated by stuttering"; and why does moving a single PlusCal label change which bugs the checker finds.

This page answers those. The spine is the **standard spec idiom** — `VARIABLES`, a `TypeOK` invariant, an `Init` predicate, a set of actions, `Next` as their disjunction, and `Spec == Init /\ [][Next]_vars /\ Fairness`. Around it sit the two ideas that trip up everyone past the tutorial: **stuttering** (a step may leave the state unchanged, and this is a feature, not a bug) and **fairness** (without it, "the system makes progress" is not provable — and asserting too much of it makes the checker lie to you). Then PlusCal, where **labels secretly define atomicity**, and the **TLC** loop that turns a spec into found bugs. Everything is shown on one small-but-complete spec you could type into the Toolbox or the VS Code TLA+ extension today.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say, in one sentence, what a *behavior* is (an infinite sequence of states).
- **Required:** Comfort with basic set notation and logic — `\A` (for all), `\E` (there exists), `/\` (and), `\/` (or), `=>` (implies).
- **Helpful:** You've stated at least one property informally as "nothing bad ever happens" vs "something good eventually happens" — the [model checking](../02-model-checking/middle.md) page frames this split.
- **Helpful:** Any experience debugging a concurrency bug (a race, a deadlock, a lost update). TLA+ is the tool that would have found it on a whiteboard.

---

## Glossary

| Term | Meaning |
|---|---|
| **Behavior** | An infinite sequence of states `s0 → s1 → s2 → …`. A spec *describes a set of behaviors*; a property is true iff it holds for **every** behavior the spec allows. |
| **State** | An assignment of a value to every declared variable at one instant. |
| **Step** | A pair of consecutive states `(s, t)`. An action is a predicate on a step. |
| **Primed variable** `x'` | The value of `x` in the *next* state of a step. An action relates `x` (now) to `x'` (next). |
| **Invariant** | A *state* predicate asserted to hold in every reachable state. Pure safety. |
| **`UNCHANGED <<a,b>>`** | Shorthand for `a' = a /\ b' = b` — the *frame* of an action: what it leaves alone. |
| **Stuttering step** | A step where every variable is unchanged (`vars' = vars`). |
| **`[Next]_vars`** | "A `Next` step **or** a stuttering step on `vars`." |
| **`<<A>>_vars`** | (Angle brackets) "An `A` step that **does** change `vars`" — the dual, used in liveness. |
| **WF / SF** | Weak / strong fairness — the assumptions that force enabled actions to actually occur. |
| **TLC** | The explicit-state model checker for TLA+; enumerates reachable states. |
| **Apalache** | A *symbolic* checker for TLA+ that discharges steps to an SMT solver instead of enumerating. |

---

## Core Concept 1 — The Standard Spec Idiom: Init, Next, Spec

Almost every TLA+ spec ever written follows the same shape. Learn the shape once and you can read most specs at a glance. Here it is on a one-bit mutex-flavored example — a single resource that processes acquire and release:

```tla
------------------------------ MODULE Counter ------------------------------
EXTENDS Integers
CONSTANT Max                 \* the upper bound, supplied by the model

VARIABLES x                  \* the (entire) state: one integer
vars == <<x>>                \* a tuple of all variables, named once

TypeOK == x \in 0..Max       \* the type invariant: x is always an in-range int

Init == x = 0                \* the initial-state predicate

Incr == x < Max /\ x' = x + 1     \* enabled when x<Max; bumps x by one
Decr == x > 0   /\ x' = x - 1     \* enabled when x>0;  drops x by one

Next == Incr \/ Decr              \* one step = some action fires

Spec == Init /\ [][Next]_vars /\ WF_vars(Incr)
=============================================================================
```

Read it top to bottom:

- **`VARIABLES`** declares the entire state. Here the whole world is one integer `x`. In a real spec it might be `<<queue, pc, msgs, leader>>`. Convention: bundle them as `vars == <<...>>` so you can write `vars` once.
- **`TypeOK`** is an *invariant* you assert and check — "x is always an integer in `0..Max`." It is not a type declaration the language enforces; TLA+ is untyped. `TypeOK` is your hand-written type system, and TLC checking it catches a huge class of "I wrote nonsense" bugs early.
- **`Init`** is a predicate on the *first* state. Any state satisfying it is a legal start. `Init` can allow many initial states (e.g., `x \in 0..Max` would mean "start anywhere").
- **Actions** (`Incr`, `Decr`) are predicates over a *step* — they relate current variables to primed (next) ones. The idiom is **enabling condition `/\` effect**: `x < Max` (when this can happen) and `x' = x + 1` (what it does). An action is *enabled* in a state iff some next state satisfies it.
- **`Next`** is the *disjunction of all actions*. "One step of the system" means "`Incr` happens, or `Decr` happens." Nondeterminism is just `\/`.
- **`Spec`** is the whole behavior, assembled from three parts: the start (`Init`), the allowed steps forever (`[][Next]_vars`), and fairness (`WF_vars(Incr)`). The next two sections unpack the last two.

> **Key insight:** A TLA+ action is **not** an assignment statement — it is a *predicate that must come out true* over the pair (current state, next state). `x' = x + 1` is not "set x to x+1"; it is the constraint "the next x equals the current x plus one." This is why an action can leave a variable's next value *unconstrained* (any value is allowed) or *over*-constrained (no next value works → the action is disabled). Thinking "assignment" instead of "constraint" is the single biggest source of confusion for programmers learning TLA+.

The **frame problem** is the corollary. In a multi-variable spec, an action that touches only `x` must *still say what happens to everything else*, or those variables are left free to take any value — an explosion of garbage behaviors. That is what `UNCHANGED` is for:

```tla
VARIABLES x, y
vars == <<x, y>>

Incr == x < Max /\ x' = x + 1 /\ UNCHANGED y    \* y' = y, explicitly
```

Omit `UNCHANGED y` and TLC will happily explore behaviors where `y` teleports to arbitrary values on every `Incr` step. Forgetting the frame is mistake #1 for beginners; the symptom is a wildly larger state space and "impossible" counterexamples.

---

## Core Concept 2 — Stuttering and `[Next]_vars`

The brackets in `[][Next]_vars` decompose into two operators that mean very different things:

- **`[]`** is the temporal operator **always** (covered next section). `[]F` means "`F` holds at every step of the behavior."
- **`[Next]_vars`** (square brackets, subscript `vars`) means **"a `Next` step *or* a stuttering step on `vars`."** A *stuttering step* is one where `vars' = vars` — nothing changes. Formally `[Next]_vars == Next \/ (vars' = vars)`.

So `[][Next]_vars` reads: *"at every step, either one of our actions fires, or nothing happens."* Allowing "nothing happens" steps — stuttering — is deliberate and load-bearing:

1. **Refinement and composition.** A high-level spec and a low-level implementation describe the same system at different grains. The implementation takes *many* small steps where the high-level spec takes *one* — and, from the high-level variables' point of view, most of those small steps are stuttering (they don't change the abstract state). Allowing stuttering is precisely what lets "the implementation `=>` the spec" be a *single, ordinary implication* in TLA+. Without stuttering, every refinement would have to fudge the step count.
2. **Open-world composition.** Your component sits in a larger system. While *other* components take steps, *your* variables stutter. A spec that forbade stuttering would be claiming "the rest of the universe is frozen while I run" — false for any real component.

> **Key insight:** Allowing stuttering for free is *why* TLA+ refinement is just implication. A correct implementation is one whose behaviors, projected onto the abstract variables, are all behaviors the abstract spec allows — and the "extra" implementation steps simply look like stuttering up top. This is the deep reason TLA+ specs compose; it is not a quirk, it is the point.

The cost lands on **liveness**. Because stuttering is always allowed, the behavior "the system does one step, then stutters forever" satisfies `Init /\ [][Next]_vars`. That behavior makes *no progress* — and yet it is legal. So *any* "something good eventually happens" property is false against `Init /\ [][Next]_vars` alone: the system is permitted to just stop. Ruling that out is the job of **fairness** (Core Concept 4). This is also why the dual `<<A>>_vars` (angle brackets — "an `A` step that genuinely changes `vars`") shows up in fairness formulas: it is the way to say "a *real* step, not a stutter."

---

## Core Concept 3 — Temporal Logic, Done Properly

TLA+ properties are written in **linear temporal logic (LTL)**: every property is a statement about a single behavior (one timeline), and the spec is correct iff the property holds for *all* behaviors. This is the **linear-time** view. It contrasts with **branching-time** logics like **CTL** (used by some other checkers, e.g. NuSMV), which quantify over the *tree* of possible futures with path quantifiers (`A` = all paths, `E` = some path). The practical difference: CTL can say "from here there *exists* a path to a reset state" (`EF reset`); pure LTL/TLA+ cannot directly express "there exists a future where…" — it talks about what holds on *the* timeline. TLA+ is firmly linear-time, and for specifying systems that is almost always what you want.

The operators you will use constantly:

| Operator | Read as | Means (on a behavior) |
|---|---|---|
| `[]P` | **always** P | `P` holds in **every** state |
| `<>P` | **eventually** P | `P` holds in **at least one** (current or future) state |
| `[]<>P` | **infinitely often** P | for every state, `P` holds *then or later* — `P` recurs forever |
| `<>[]P` | **eventually always** P | from some point on, `P` holds in every state — the system *stabilizes* |
| `P ~> Q` | **P leads to** Q | every `P` is eventually followed by a `Q`; defined as `[](P => <>Q)` |

The two nested forms are worth internalizing because they are how you state real liveness:

- **`[]<>P` — infinitely often.** "No matter how far out you go, `P` will be true again." Use it for *recurrence*: "the scheduler keeps giving each thread a turn," "the leader keeps sending heartbeats."
- **`<>[]P` — eventually always (stabilization).** "After some finite prefix of chaos, `P` is true forever." Use it for *convergence*: "the cluster eventually agrees on one leader and stays agreed," "the gossip protocol eventually quiesces."

And the workhorse, **leads-to**:

```tla
\* "Every request is eventually served."
Liveness == \A r \in Requests : Pending(r) ~> Served(r)
```

`P ~> Q` is exactly `[](P => <>Q)`: *whenever* `P` becomes true, `Q` is true then-or-later. It does **not** say `Q` happens immediately, nor that `P` and `Q` happen once — it says the implication holds at every point on the timeline. Leads-to is the single most useful liveness shape: "submitted ~> committed," "requested ~> granted," "crashed ~> recovered."

> **Key insight:** Safety properties are `[]Invariant` and are decided by looking at *states* (and, for step-invariants, single steps). Liveness properties — anything with a `<>` or `~>` that demands progress — are decided by looking at *whole infinite behaviors*, and they are **vacuously satisfiable by a spec that allows stopping**. That asymmetry is the whole reason fairness exists. If your property has a `<>` in it and you haven't written any fairness, the property is almost certainly meaningless against your spec.

---

## Core Concept 4 — Safety vs Liveness, and Why Liveness Needs Fairness

Every property splits into two kinds, and they are checked against the spec completely differently:

- **Safety — "nothing bad ever happens."** Always-an-invariant, `[]Inv`. A violation is *finite*: TLC can show you a finite trace ending in a bad state. Safety needs no fairness; it constrains what states are reachable, full stop.
- **Liveness — "something good eventually happens."** `<>`, `~>`, `[]<>`, `<>[]`. A violation is *infinite*: a behavior that runs forever and never reaches the good thing (typically a cycle the system gets stuck in). Liveness is meaningful **only** relative to fairness, because — per Core Concept 2 — a spec that allows stuttering can always just stop, falsifying any progress claim.

**Fairness** is the assumption that enabled actions don't get ignored forever. TLA+ gives two strengths:

**Weak fairness** — `WF_vars(A)`: *if action `A` stays continuously enabled, then `A` eventually happens.* It rules out the pathology "`A` is ready to go, and stays ready, but the scheduler never picks it." Formally, weak fairness on `A` means: it's not allowed for `A` to be enabled forever-from-some-point yet never taken. Use WF for the common case: "a step that is ready will eventually be taken."

**Strong fairness** — `SF_vars(A)`: *if action `A` is enabled infinitely often (it keeps becoming enabled, even if it also keeps becoming disabled), then `A` happens infinitely often.* SF is *stronger* — it forces `A` even when `A` is repeatedly enabled-then-disabled (e.g., a process that can only act while it holds a lock that keeps getting taken away). Use SF only when you genuinely need it; it is a heavier assumption and more expensive for TLC to check.

```tla
\* Weak fairness: the worker, once it can run, eventually runs.
Spec == Init /\ [][Next]_vars /\ WF_vars(Work)

\* Strong fairness: even if the resource is intermittently grabbed by others,
\* a process that is repeatedly able to acquire it eventually does.
Spec == Init /\ [][Next]_vars /\ \A p \in Procs : SF_vars(Acquire(p))
```

The danger runs both ways:

- **Too little fairness** → liveness properties are vacuously false; TLC hands you a "stuttering" counterexample (the system stops). The fix is to add the fairness your real system actually has.
- **Too much fairness** → you assume away the very failures you should be checking. Asserting strong fairness on an action quietly bakes in "this always eventually succeeds," which can *hide* a real liveness bug. Worse, you might assert fairness on an action whose enabledness depends on a buggy condition, "proving" progress that the real system doesn't have.

> **Key insight:** Fairness is a *modeling decision about the environment*, not a correctness property — it encodes "what the scheduler / network / runtime guarantees me." Add the *weakest* fairness that reflects reality (usually WF on the actions a real scheduler would eventually run) and no more. Every fairness conjunct you add is an assumption you are choosing to trust; over-assert and your "proof of liveness" proves nothing about the system you'll actually ship.

---

## Core Concept 5 — PlusCal and the Atomicity-Defining Power of Labels

Writing the Init/Next idiom by hand for an imperative algorithm (with a program counter, loops, local variables) is tedious. **PlusCal** is an algorithm language that *looks like* pseudocode and **translates to TLA+** — the translator generates the `pc` variable, the actions, `Next`, and `Spec` for you. You write PlusCal in a comment block; the Toolbox / VS Code extension writes the TLA+ underneath it.

Here is a complete PlusCal algorithm — two processes incrementing a shared counter, the canonical lost-update race:

```tla
---------------------------- MODULE IncDec ----------------------------
EXTENDS Integers
CONSTANT Procs                  \* e.g. {p1, p2}, set in the model

(*--algorithm IncDec
variables counter = 0;          \* shared state

process Worker \in Procs
variables tmp = 0;              \* a process-local register
begin
  Read:    tmp := counter;      \* read shared into local
  Write:   counter := tmp + 1;  \* write local+1 back
end process;
end algorithm; *)

\* (BEGIN TRANSLATION) ... TLC fills in pc, Next, Spec ... (END TRANSLATION)
=======================================================================
```

Now the crucial concept. **Each label is an atomic-step boundary.** Everything *between* two labels executes as a single, indivisible TLA+ step; the program counter only stops at labels, and that is where another process can interleave. So the placement of labels *defines the grain of atomicity* — and getting it wrong silently changes which interleavings exist.

In the spec above, `Read` and `Write` are **separate labels**, so the read and the write are **two atomic steps**. Between them, the other worker can run. That admits the lost-update interleaving:

```
p1.Read   : tmp_p1 = 0           (reads counter=0)
p2.Read   : tmp_p2 = 0           (reads counter=0, p1 hasn't written yet)
p1.Write  : counter = 1
p2.Write  : counter = 1          (overwrites — increment lost!)
```

Two increments, final value `1`. The bug. Now collapse it to **one label**:

```tla
  Step:  counter := counter + 1;   \* single atomic read-modify-write
```

With one label, the increment is *indivisible* — no interleaving point between read and write — and the final value is always `2`. **Same algorithm text, one label fewer, a completely different set of behaviors and no bug.** This is the heart of PlusCal: labels are not cosmetic; they are the model of what your hardware/lock/transaction actually makes atomic. Model a compare-and-swap as one label; model a non-atomic `i++` as `Read`/`Write` two labels; model a critical section as the work *inside* lock/unlock labels.

Two more PlusCal constructs you'll reach for immediately:

- **`await P`** — block until predicate `P` is true. Generates an enabling condition: the step at that label is *disabled* until `P` holds. This is how you model "wait for the lock," "wait for a message," "wait for quorum."
- **`with v \in S do ... end with`** — nondeterministically pick `v` from set `S`. The model checker explores *every* choice. This is how you model "the network delivers some message," "the adversary picks any value."

```tla
  Acquire: await lock = FALSE;     \* block until free...
           lock := TRUE;           \* ...then take it (atomic with the await)
```

> **Key insight:** In PlusCal you are not choosing where to put labels for readability — **you are declaring your atomicity assumptions, and they are the most consequential design decision in the spec.** Too-coarse labels (one big atomic block) hide real races your hardware permits; too-fine labels invent interleavings that can't occur (e.g., splitting an instruction the CPU executes atomically). When a TLA+ result surprises you, the *first* thing to re-examine is your labels.

---

## Core Concept 6 — The TLC Workflow: Model, Run, Read the Trace

A spec is inert until you give TLC a **model** to check it under. In the Toolbox you create a model; with the VS Code TLA+ extension you write a `.cfg` file. Either way the model supplies four things:

1. **`CONSTANTS`** — concrete values for the spec's parameters. Sets must be made *finite* so TLC can enumerate: `Procs = {p1, p2, p3}`, `Max = 3`. This is the "instantiate the abstract spec at a small size" step. (TLA+ specs are written for *any* size; you check them at sizes small enough to enumerate but large enough to expose the bug — often 2–4 of everything.)
2. **The behavior spec** — name the `Spec` formula (`SPECIFICATION Spec`), so TLC knows `Init`, `Next`, and fairness.
3. **`INVARIANTS`** — the *safety* properties to check at every reachable state (`INVARIANT TypeOK`, `INVARIANT NoLostUpdate`).
4. **`PROPERTIES`** — the *temporal* (often liveness) properties to check over behaviors (`PROPERTY Liveness`).

Optionally a **state `CONSTRAINT`** bounds the search (`CONSTRAINT x <= 10`) so an unbounded counter doesn't make the state space infinite.

A minimal `.cfg` for the counter:

```
SPECIFICATION Spec
CONSTANT  Max = 3
INVARIANT TypeOK
PROPERTY  EventuallyMax
```

…against a spec that adds, in the `.tla` file:

```tla
EventuallyMax == <>(x = Max)     \* "x eventually reaches Max"
```

TLC then does breadth-first exploration of all reachable states, checking every invariant at each state and every temporal property over the behavior graph. The output you care about is the **error trace**: when a property fails, TLC prints the *shortest* sequence of states that violates it, each annotated with the **action name** that produced it. Reading the trace is the skill.

Here is a realistic safety violation — `NoLostUpdate` (final counter equals the number of completed increments) checked on the two-label `IncDec` above:

```
Error: Invariant NoLostUpdate is violated.
Error: The behavior up to this point is:

State 1: <Initial predicate>
  /\ counter = 0
  /\ pc = (p1 :> "Read" @@ p2 :> "Read")
  /\ tmp = (p1 :> 0 @@ p2 :> 0)

State 2: <Read line 9, col 12 of module IncDec>      \* p1 reads
  /\ counter = 0
  /\ pc = (p1 :> "Write" @@ p2 :> "Read")
  /\ tmp = (p1 :> 0 @@ p2 :> 0)

State 3: <Read line 9, col 12 of module IncDec>      \* p2 reads (stale!)
  /\ counter = 0
  /\ pc = (p1 :> "Write" @@ p2 :> "Write")
  /\ tmp = (p1 :> 0 @@ p2 :> 0)

State 4: <Write line 10, col 12 of module IncDec>    \* p1 writes 1
  /\ counter = 1
  /\ pc = (p1 :> "Done" @@ p2 :> "Write")
  /\ tmp = (p1 :> 0 @@ p2 :> 0)

State 5: <Write line 10, col 12 of module IncDec>    \* p2 overwrites with 1
  /\ counter = 1                                       \* should be 2 — LOST!
  /\ pc = (p1 :> "Done" @@ p2 :> "Done")
  /\ tmp = (p1 :> 0 @@ p2 :> 0)
```

Read it like a debugger's stepping log: each state shows *every variable*, and the `<...>` header names the action and source line that caused the transition. Here the story is unmistakable — both processes read `counter = 0` (states 2–3) *before* either writes, then both write `1` (states 4–5), so one increment vanishes. The fix is exactly the labels discussion: collapse `Read`/`Write` into one atomic `Step`, re-run, and TLC reports "no error found." Run → read the trace → fix the spec (or the property, if the property was wrong) → re-run is the entire inner loop.

You import the building blocks from **standard modules**: `EXTENDS Integers` (arithmetic), `Sequences` (lists — `Append`, `Head`, `Tail`, `Len`), `FiniteSets` (`Cardinality`, `IsFiniteSet`), and `TLC` (debugging helpers like `Print` and `Assert`, plus the `:>`/`@@` function-construction operators you see in the trace).

> **Key insight:** TLC checks the spec at a *small, finite instance* you choose with `CONSTANTS` — it is exhaustive *over that instance*, not a proof for all sizes. Bugs in distributed protocols are overwhelmingly *small*: the AWS team found most of theirs at 2–3 nodes. Pick the smallest model that *could* exhibit the bug (you need at least two of anything that races), get it green, then scale up until the state space stops being tractable. A green check at `Procs = {p1, p2}` is enormously more informative than no check at all — but it is not the same claim as a proof.

---

## Real-World Examples

**Mutual exclusion (the classic first spec).** Model two processes and a `lock` flag; the safety property is `MutualExclusion == ~(p1 \in cs /\ p2 \in cs)` (never both in the critical section). The liveness property is `\A p : Trying(p) ~> InCS(p)` (anyone who wants in eventually gets in) — and proving *that* is exactly where you discover you need fairness, and sometimes *strong* fairness, because a process can be repeatedly enabled-then-disabled as the lock ping-pongs. This one spec teaches the whole safety/liveness/fairness arc.

**A bounded queue / producer-consumer.** State is the `buffer` sequence plus per-process `pc`. Actions: `Put` (enabled when `Len(buffer) < N`, appends), `Get` (enabled when `buffer # <<>>`, takes the head). Invariant: `Len(buffer) \in 0..N` (never overflows or underflows). Liveness: every produced item is eventually consumed (`~>`). It surfaces the deadlock where producers all block on a full buffer while consumers all block on… an empty one, if you mis-model the signaling.

**A cache with invalidation.** Variables for the cache map and the backing store; the key invariant is *coherence* — a cached value is never stale past an invalidation. Modeling the window between "store updated" and "cache invalidated" as separate atomic steps (separate labels!) is what exposes the stale-read race; collapsing them hides it. This is the labels lesson on a real system.

**Simple consensus / replication.** A handful of nodes, a `log` per node, messages in flight modeled as a set, an adversary that drops or reorders via `with`. The safety invariant is *agreement* (no two nodes commit different values at the same index); liveness is *eventually some value is chosen* under fairness + a non-faulty quorum. This is the shape of what made TLA+ famous.

**The AWS experience (at middle depth).** Newcombe et al. (CACM 2015) report that AWS engineers used TLA+ on S3, DynamoDB, EBS, and the internal lock manager — and the value wasn't only "found a 35-step bug in a replication protocol that testing would never reach." It was equally the *design exploration* it enabled: once a protocol is a spec, "what if we change the timeout rule?" or "what if we add this optimization?" becomes a *re-run of TLC*, not a multi-week implement-test-and-pray cycle. The spec is a cheap wind-tunnel for design changes. That "what if we change X" loop is the day-to-day payoff most teams underestimate.

**When TLC's enumeration hurts: Apalache.** Because TLC enumerates states explicitly, large models blow up (state explosion — see [model checking](../02-model-checking/middle.md)). **Apalache** is an alternative checker that is *symbolic*: it encodes bounded behaviors as SMT constraints and asks Z3 to find a violation, rather than walking every state. It can check some properties at sizes TLC can't reach (and benefits from type annotations), at the cost of a different mental model (bounded depth, SMT quirks). For most learning and design work TLC is the right default; reach for Apalache when TLC's state count becomes the bottleneck.

---

## Mental Models

- **A spec is a *set of behaviors*; a property is a *yes/no question asked of every one of them*.** "Is the spec correct?" decomposes into "does every behavior the spec allows also satisfy the property?" Everything TLC does is checking that universal quantifier over behaviors.

- **An action is a constraint, not a command.** `x' = x + 1` doesn't *do* anything; it *requires* the next `x` to be one more than this one. Read every action as "the step is legal iff this predicate is true," and the rest of TLA+ stops being surprising.

- **`UNCHANGED` is the frame; forgetting it lets variables teleport.** Any variable an action doesn't constrain is free to become *anything*. Listing the frame is not boilerplate — it is the difference between modeling your system and modeling chaos.

- **Stuttering is the "do nothing" step that's always available — which is why progress must be *demanded*.** Safety survives stuttering (nothing bad happens if nothing happens). Liveness does not (nothing *good* happens if nothing happens). Fairness is how you forbid the system from doing nothing forever.

- **PlusCal labels are atomicity declarations in disguise.** Where you draw label boundaries *is* your claim about what executes indivisibly. Coarser labels = bigger atomic steps = fewer interleavings = bugs hidden. Finer labels = more interleavings = bugs (real or imaginary) exposed.

- **TLC is an exhaustive checker of a *small instance*, not a theorem prover.** Green at `N=3` means "no violation in this finite world," which catches the overwhelming majority of design bugs — but a *proof for all N* is the proof-assistant tier ([05](../05-proof-assistants-and-dependent-types/middle.md)), not TLC.

---

## Common Mistakes

1. **Forgetting `UNCHANGED` on the frame.** An action that constrains only some variables leaves the rest free to take any value, exploding the state space with garbage behaviors and "impossible" counterexamples. Every action must say what *all* variables do — change them or `UNCHANGED` them.

2. **Reading `x' = e` as assignment.** It is a *predicate*. `x' = x + 1 /\ x' = x + 2` is not "do both" — it is *unsatisfiable*, so the action is disabled. Programmers who think "statement" instead of "constraint" write specs that mean something other than they intended.

3. **Writing a liveness property with no fairness.** `<>Goal` or `P ~> Q` against `Init /\ [][Next]_vars` (no `WF`/`SF`) is *always violated* — the system is allowed to stutter forever. TLC's counterexample will be "and then it stops." Add the fairness your real system has.

4. **Over-asserting fairness.** Slapping `SF` on everything to make liveness pass assumes away the failures you should be testing. Fairness is a trusted assumption about the environment; assert the *weakest* one that's realistic. Too much fairness "proves" progress the real system doesn't have.

5. **Mis-grained labels in PlusCal.** Splitting an operation your hardware does atomically invents interleavings that can't occur (false bugs); fusing operations that *aren't* atomic hides real races (missed bugs). When a result surprises you, re-examine label placement first.

6. **Checking a model too big to finish — or too small to matter.** Unbounded constants (`Nat`, an unbounded counter) make the state space infinite; add a `CONSTRAINT` to bound it. Conversely, `Procs = {p1}` can never exhibit a race — you need *at least two* of anything that contends. Pick the smallest instance that *could* show the bug.

7. **Confusing `<>[]P` with `[]<>P`.** `<>[]P` is "eventually stays true forever" (stabilization); `[]<>P` is "true infinitely often" (recurrence). They are different liveness claims and a system can satisfy one but not the other. State the one you actually mean.

---

## Test Yourself

1. In `Spec == Init /\ [][Next]_vars /\ WF_vars(A)`, what does each of the three conjuncts contribute, and what does the `[Next]_vars` (vs plain `Next`) part allow?
2. Why is *any* `<>`/`~>` liveness property false against a spec that has no fairness? What does the counterexample look like?
3. State the difference between weak fairness `WF_vars(A)` and strong fairness `SF_vars(A)` in one sentence each, and give a situation that needs SF.
4. You have a PlusCal `i++` written as two labels `Read: tmp := i;` then `Write: i := tmp + 1;`. What behavior does this admit that a single-label `Step: i := i + 1;` does not, and why?
5. What four things does a TLC model/`.cfg` supply, and why must the `CONSTANTS` make the relevant sets finite?
6. In a TLC error trace, what is shown for each entry, and how does the `<Action line N>` annotation help you debug?
7. TLC reports your spec is correct at `Procs = {p1, p2}`. What exactly have you established — and what have you *not*?

<details>
<summary>Answers</summary>

1. `Init` constrains the first state; `[][Next]_vars` constrains every step to be either a `Next` action or a *stuttering* step (vars unchanged); `WF_vars(A)` is the fairness that forces enabled `A`-steps to eventually occur. The `[Next]_vars` (vs `Next`) is what *permits stuttering* — essential for refinement and composition, but it's also why liveness needs fairness.
2. Because stuttering is always allowed, the behavior "do one step, then stutter forever" satisfies `Init /\ [][Next]_vars` while making no progress — so any "eventually" claim fails. The counterexample is a short prefix followed by "and then nothing changes" (TLC reports a stuttering/lasso with no progress).
3. **WF:** if `A` is *continuously* enabled, it eventually happens. **SF:** if `A` is enabled *infinitely often* (even if intermittently disabled), it happens infinitely often. SF is needed when an action is repeatedly enabled-then-disabled — e.g., a process that can act only while holding a lock that keeps getting grabbed by others; WF wouldn't force it because it isn't *continuously* enabled.
4. Two labels make read and write *two atomic steps*, so the other process can interleave between them — admitting the lost-update race (both read the old value, both write old+1, one increment lost). One label makes the read-modify-write *indivisible*; no interleaving point exists, so no value is lost. Labels define the grain of atomicity.
5. (a) `CONSTANTS` — concrete, *finite* values for parameters; (b) the behavior spec (`SPECIFICATION Spec`); (c) `INVARIANTS` — safety, checked per state; (d) `PROPERTIES` — temporal, checked per behavior. Sets must be finite because TLC *enumerates* reachable states; an infinite set means an infinite (non-terminating) search.
6. Each entry shows the *full state* (every variable's value) plus a header naming the *action and source line* that produced the transition. The action annotation tells you *which* action fired at each step, so you can trace the exact sequence of decisions that led to the violation — like a stack trace for the protocol.
7. You've established that **no checked invariant or property is violated in any reachable state of the 2-process instance** — exhaustively, for that finite world. You have *not* proved it for arbitrary `Procs`; it's a check at one small size, not a proof for all sizes (that's the proof-assistant tier). Most design bugs are small, so this is highly valuable — but it's not a universal proof.

</details>

---

## Cheat Sheet

```
THE SPEC IDIOM
  VARIABLES x, y           declare the entire state
  vars == <<x, y>>         name the tuple once
  TypeOK == ...            your hand-written type invariant (CHECK IT)
  Init   == ...            initial-state predicate
  ActionA == enabled /\ effect /\ UNCHANGED <<rest>>   \* frame!
  Next   == ActionA \/ ActionB \/ ...                  \* disjunction
  Spec   == Init /\ [][Next]_vars /\ Fairness

STEPS & FRAME
  x' = e            constraint on NEXT value (NOT assignment)
  UNCHANGED <<a>>   == a' = a   (the frame: what an action leaves alone)
  [Next]_vars       == Next \/ vars'=vars   (a step OR a stutter)
  <<A>>_vars        == A /\ vars'#vars       (a REAL A-step, used in fairness)

TEMPORAL OPERATORS
  []P     always P                  <>P     eventually P
  []<>P   infinitely often (recur)  <>[]P   eventually-always (stabilize)
  P ~> Q  leads-to == [](P => <>Q)

SAFETY vs LIVENESS
  safety   []Inv     checked on states   no fairness needed   finite counterexample
  liveness <> ~> []<>  whole behaviors    NEEDS fairness        infinite counterexample

FAIRNESS  (add the weakest that's realistic!)
  WF_vars(A)  continuously enabled  => eventually happens
  SF_vars(A)  enabled infinitely often => happens infinitely often (stronger)

PLUSCAL
  labels = ATOMIC-STEP BOUNDARIES  (placement = your atomicity assumptions)
  await P            block until P (enabling condition)
  with v \in S do    nondeterministic pick (checker explores all)

TLC MODEL (.cfg)
  SPECIFICATION Spec
  CONSTANT  Procs = {p1,p2,p3}    \* must be FINITE
  INVARIANT TypeOK               \* safety, per state
  PROPERTY  Liveness             \* temporal, per behavior
  CONSTRAINT x <= 10             \* bound an unbounded space

STANDARD MODULES
  Integers  Sequences(Append/Head/Tail/Len)  FiniteSets(Cardinality)  TLC(Print/Assert)

TROUBLESHOOT
  liveness "violated by stuttering"   -> add fairness
  state space explodes / never ends   -> add CONSTRAINT, shrink CONSTANTS
  surprising result                   -> re-check your PlusCal LABELS first
  TLC too slow at scale               -> try Apalache (symbolic, SMT-backed)
```

---

## Summary

- The **standard spec idiom** is `VARIABLES` + `TypeOK` + `Init` + actions (each *enabling condition `/\` effect `/\` `UNCHANGED` frame*) + `Next` (their disjunction) + `Spec == Init /\ [][Next]_vars /\ Fairness`. Learn it once; it's nearly every spec.
- An action is a **predicate over a step** (`x'` = next value), *not* an assignment. Every variable an action doesn't constrain must be `UNCHANGED`, or it teleports.
- **`[Next]_vars` allows stuttering** (a step may change nothing). Stuttering is what makes refinement just implication and lets components compose — and it's exactly why liveness can't be proved without fairness.
- **Temporal logic:** `[]` always, `<>` eventually, `[]<>` infinitely often, `<>[]` eventually-always (stabilize), `P ~> Q` leads-to. TLA+ is **linear-time** (about each behavior), unlike branching-time CTL.
- **Safety** (`[]Inv`) is checked on states and needs no fairness; **liveness** (`<>`, `~>`) is checked over infinite behaviors and is meaningless without **fairness** — `WF` (continuously enabled ⇒ happens) vs `SF` (enabled infinitely often ⇒ happens). Assert the *weakest* fairness that's realistic.
- **PlusCal** translates pseudocode to TLA+, and its **labels define the grain of atomicity** — the most consequential design choice in the spec. `await` and `with` model blocking and nondeterminism.
- The **TLC loop**: a model supplies finite `CONSTANTS`, the spec, `INVARIANTS`, and `PROPERTIES`; TLC enumerates reachable states and, on failure, prints the shortest **error trace** (every variable + the action that fired). Run → read the trace → fix → re-run. TLC is exhaustive over a *small instance*, not a proof for all sizes; **Apalache** (symbolic/SMT) is the alternative when enumeration explodes.

---

## Further Reading

- *Practical TLA+* — Hillel Wayne. The book for engineers: PlusCal-first, worked systems, the labels-and-fairness intuitions developed slowly and well.
- **learntla.com** — Hillel Wayne's free online course; the fastest way to a running spec, now PlusCal-centric and kept current.
- *Specifying Systems* — Leslie Lamport. The definitive source from TLA+'s creator: temporal logic, stuttering, refinement, and the full language semantics. Free PDF.
- *"How Amazon Web Services Uses Formal Methods"* — Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff (CACM 2015). The industrial case: the bugs found, the design exploration enabled, and the cost in engineer-weeks.
- The **TLA+** Toolbox, the **VS Code TLA+** extension, and **Apalache** docs — the tooling you'll actually run.
- [senior.md](senior.md) — refinement and `Spec1 => Spec2` in depth, hiding with `\EE`, the TLAPS proof system for going beyond bounded checking, large-model engineering, and the explicit-state vs symbolic (TLC vs Apalache) trade-off.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/middle.md) — the general discipline TLA+ is one instance of; what a spec *is*, and refinement as the link between abstract and concrete.
- [02 — Model Checking](../02-model-checking/middle.md) — the engine underneath TLC: transition systems, the safety/liveness split, and the state-explosion problem TLA+ inherits.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/middle.md) — the cheaper rungs (property-based testing, design by contract, SMT-backed Dafny) when a full temporal spec is more than the problem warrants.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/middle.md) — the ROI judgement: where a TLA+ spec earns its weeks (distributed protocols, concurrency) and where a property test is enough.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the domain TLA+ was built for; consensus, replication, and the protocols whose interleavings these specs explore.
