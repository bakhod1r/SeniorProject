# TLA+ & Temporal Logic — Senior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → TLA+ & Temporal Logic
> *The middle page taught you to write `Init`, `Next`, and an invariant and run TLC. This page is about the logic underneath: why a TLA+ spec is literally a single temporal formula over infinite behaviors, why stuttering-invariance is the property that makes refinement and composition work at all, how `WF` and `SF` differ when you actually need liveness, and what TLC is really doing when it fingerprints ten million states onto disk.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — A Spec Is a Temporal Formula Over Behaviors](#core-concept-1--a-spec-is-a-temporal-formula-over-behaviors)
5. [Core Concept 2 — Stuttering Invariance and Why It Is Everything](#core-concept-2--stuttering-invariance-and-why-it-is-everything)
6. [Core Concept 3 — Refinement as Implication](#core-concept-3--refinement-as-implication)
7. [Core Concept 4 — Temporal Operators, ENABLED, and the Action Operators](#core-concept-4--temporal-operators-enabled-and-the-action-operators)
8. [Core Concept 5 — Fairness: WF vs SF, Precisely](#core-concept-5--fairness-wf-vs-sf-precisely)
9. [Core Concept 6 — Machine Closure and the Fairness Traps](#core-concept-6--machine-closure-and-the-fairness-traps)
10. [Core Concept 7 — Inductive Invariants](#core-concept-7--inductive-invariants)
11. [Core Concept 8 — TLC Internals](#core-concept-8--tlc-internals)
12. [Core Concept 9 — The Modeling Craft](#core-concept-9--the-modeling-craft)
13. [Core Concept 10 — Apalache and TLAPS](#core-concept-10--apalache-and-tlaps)
14. [Real-World Examples](#real-world-examples)
15. [Mental Models](#mental-models)
16. [Common Mistakes](#common-mistakes)
17. [Test Yourself](#test-yourself)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)
21. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The semantics of TLA and the craft of modeling — what a senior engineer must understand to use TLA+ on a real protocol rather than a toy.**

By the middle level you can write a small spec, define an invariant, and watch TLC find a violating trace. That is enough to catch real bugs, and it is where most practitioners stop. The senior jump is understanding that everything you wrote — `Init`, `[][Next]_vars`, your fairness conditions, your invariant — is *one temporal formula*, and that TLA's entire design (stuttering-invariance, refinement-as-implication, the precise definitions of `WF`/`SF`) follows from a single idea: a specification denotes a *set of behaviors*, and a behavior is an infinite sequence of states.

Once you see that, the hard questions become answerable. Why can you compose two specs by conjunction? Why does a low-level design "implement" a high-level one *exactly when* it implies it? When do you need strong fairness instead of weak? Why does TLC choke on liveness but breeze through safety? Why does `SYMMETRY` make a 10-hour check finish in 20 minutes — and why is it unsound for some properties? This page answers those by going to the semantics, then to TLC's internals, then to the part that actually distinguishes seniors: choosing the right abstraction and atomicity grain so the model says what you think it says.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — you can write `Init`, a next-state action with `UNCHANGED`, run TLC, and read a basic error trace.
- **Required:** Comfort with predicate logic and quantifiers (`\A`, `\E`), sets, functions, and records — TLA+ is built on ZFC set theory, not on a programming type system.
- **Helpful:** You've modeled or debugged a real concurrent or distributed protocol (a lock, a queue, a consensus or replication scheme) and felt where the bugs hide.
- **Helpful:** A working intuition for linear temporal logic (LTL) operators — `□` (always), `◇` (eventually) — even informally.

---

## Glossary

| Term | Meaning |
|---|---|
| **Behavior** | An infinite sequence of states `s0 → s1 → s2 → ...`. The semantic object a spec describes. |
| **State** | An assignment of values to all declared variables at one instant. |
| **Step** | A pair of consecutive states `(s, s')`; an *action* is a predicate on a step. |
| **Stuttering step** | A step where all spec variables are unchanged (`s = s'` for the variables that matter). |
| **`[Next]_vars`** | `Next \/ (vars' = vars)` — "a `Next` step *or* a stuttering step." |
| **`□` / `[]`** | "Always" — true at every suffix of the behavior. |
| **`◇` / `<>`** | "Eventually" — true at some suffix. |
| **`~>`** | "Leads to": `P ~> Q` ≜ `□(P => ◇Q)` — every `P` is eventually followed by a `Q`. |
| **`ENABLED A`** | True in a state iff there exists a successor state making action `A` true. |
| **`WF_vars(A)`** | Weak fairness on action `A` (defined precisely below). |
| **`SF_vars(A)`** | Strong fairness on action `A`. |
| **Refinement mapping** | A definition of the high-level variables as expressions over the low-level ones, used to prove implementation ⇒ spec. |
| **Inductive invariant** | A predicate `Inv` with `Init => Inv` and `Inv /\ Next => Inv'`; implies the invariant holds in all reachable states. |
| **Machine closure** | The property that the liveness part of a spec doesn't rule out finite prefixes the safety part allows. |
| **Fingerprint** | A 64-bit hash TLC stores per state to detect already-seen states. |

---

## Core Concept 1 — A Spec Is a Temporal Formula Over Behaviors

The single fact that reorganizes everything: in TLA, a specification is a **logical formula**, and its meaning is the **set of behaviors that satisfy it**. A behavior is an infinite sequence of states. A *temporal formula* is true or false of a whole behavior. So when you write a spec, you are writing a predicate over infinite sequences, and "this system satisfies this property" is just "every behavior of the system is also a behavior of the property" — logical implication between two formulas.

The canonical shape of a complete spec is:

```tla
Spec == Init /\ [][Next]_vars /\ Liveness
```

Read each conjunct as a constraint on the *whole behavior*:

- `Init` — a predicate on the **first** state. It constrains `s0`.
- `[][Next]_vars` — "at every step, either `Next` holds or nothing changed." `[Next]_vars` is shorthand for `Next \/ (vars' = vars)`, and the outer `[]` says it holds at every step. This is the **safety** part: it says what steps are *allowed*, never that any step must happen.
- `Liveness` — typically a conjunction of fairness conditions (`WF`/`SF`). This is the **liveness** part: it forces certain steps to *eventually* happen.

```tla
EXTENDS Naturals
VARIABLES x
vars == << x >>

Init == x = 0
Next == x' = x + 1                 \* one action: increment

Spec == Init /\ [][Next]_vars      \* safety only; says nothing must ever happen
FairSpec == Spec /\ WF_vars(Next)  \* now x must keep increasing
```

> **Key insight:** The conjunction `Init /\ [][Next]_vars /\ Liveness` is not a template you fill in — it *is* the formula whose models are exactly the system's behaviors. Properties are also formulas. "The system is correct" means `Spec => Property`, a single implication between two temporal formulas. Everything else (refinement, composition, fairness) is consequences of this one design.

The deep payoff: because both system and property are formulas of the *same kind*, you can use the same language for "the thing I built" and "the thing it should do," and relate them with `=>`. No other specification framework collapses the implementation and the specification into one logic this cleanly.

---

## Core Concept 2 — Stuttering Invariance and Why It Is Everything

Notice that `Next` always appears inside `[Next]_vars` — i.e., disjoined with "the variables don't change." That `_vars` is not decoration. It makes every TLA spec **invariant under stuttering**: inserting finitely many steps that leave the variables unchanged turns a behavior of the spec into another behavior of the spec, and removing finite runs of such steps does too.

Why would you ever *want* a system that's indifferent to "do nothing" steps inserted anywhere? Because that indifference is precisely what lets you relate descriptions at *different levels of abstraction*.

Consider a high-level spec where transferring money is a single atomic step, and a low-level spec where the same transfer is three steps (debit, log, credit). When you "view" the low-level behavior through the high-level variables (account balances), the *log* step changes only the low-level log variable — from the high-level vantage point, the balances don't move. That is a **stuttering step** at the high level. Without stuttering-invariance, the high-level formula would reject that behavior because "nothing happened" for a step. With it, the extra step is invisible, and the low-level behavior counts as a legitimate high-level behavior.

```tla
\* High level: one atomic transfer step
HiNext == \E a, b, amt : Transfer(a, b, amt)

\* Low level: debit, then (later) credit — two steps where high-level vars stutter
LoNext == Debit \/ Credit
\* Between Debit and Credit, the *abstract* balance view stutters
```

> **Key insight:** Stuttering invariance is the property that makes refinement and composition *possible*. Refinement adds steps (more detail) without changing the abstract story — only stuttering-invariance lets those added steps be invisible at the abstract level. Composition conjoins specs over a shared clock of steps — only stuttering-invariance lets each component "not move" while another does. Lamport's choice to bake `_vars` into the canonical form is the load-bearing decision of the whole logic.

A practical consequence: you **never** write a formula that can distinguish a stuttering step from its absence (e.g., counting steps with a wall-clock variable that ticks on *every* step, including stutters). Doing so breaks stuttering-invariance and quietly destroys your ability to refine. If you need a clock, model it as an action that *may* tick, not one that ticks on every step.

---

## Core Concept 3 — Refinement as Implication

This is the senior payoff and the reason TLA+ scales to real designs. **A implements B** — A correctly implements the more abstract spec B — means exactly:

```
Spec_A => Spec_B          (every behavior of A is a behavior of B)
```

That's it. "Implements" *is* logical implication between the two formulas — no separate refinement relation to learn, just `=>` plus the stuttering-invariance that lines the levels up.

The catch: A and B usually have *different variables*. The low-level Paxos spec has `messages`, `proposals`, per-acceptor state; the abstract "consensus" spec has a single `chosen`. You can't ask `Spec_A => Spec_B` directly when `chosen` isn't a variable of A. You bridge the gap with a **refinement mapping**: define each high-level variable as an *expression over the low-level variables*.

```tla
---- MODULE LinearizableRegister ----  \* the ABSTRACT spec B
VARIABLE value
InitR == value = 0
WriteR(v) == value' = v
ReadR(v) == v = value /\ UNCHANGED value
SpecR == InitR /\ [][\E v : WriteR(v) \/ ReadR(v)]_value
=====================================

---- MODULE ReplicatedRegister ----    \* the CONCRETE spec A (many replicas + msgs)
VARIABLES replicas, messages, ...
\* ... detailed Init, Next, actions ...

\* Refinement mapping: define the abstract `value` as a function of concrete state.
\* e.g., the value of a designated leader replica, or the committed value.
value == replicas[leader].committed

\* Instantiate the abstract module with the mapping (the WITH binds B's vars to A's exprs):
R == INSTANCE LinearizableRegister WITH value <- value

\* The refinement claim, checkable by TLC:
THEOREM Spec => R!SpecR
====================================
```

In the TLC model you check refinement by listing the abstract spec as a **property** of the concrete model:

```
SPECIFICATION Spec              \* the concrete spec A
PROPERTY      R!SpecR           \* assert the abstract spec B holds under the mapping
```

TLC then explores A's reachable behaviors and, on each, evaluates B's formula through the mapping. If some concrete behavior maps to a state sequence the abstract spec forbids, you get a trace — that's your refinement bug (e.g., two replicas committing different values, which maps to the abstract register holding two different values across a step it should not).

> **Key insight:** Refinement-as-implication is how you connect a *detailed design* to an *abstract correctness statement* without re-proving correctness from scratch. You prove the abstract spec is linearizable (or whatever) once; then any number of concrete designs earn that property simply by exhibiting a refinement mapping and checking `Spec => Abstract!Spec`. This is exactly the move behind "this protocol implements a linearizable register" or "this is single-decree Paxos refining a one-shot consensus object."

A subtlety seniors hit: refinement mappings sometimes need **auxiliary variables** (history or prophecy variables) added to the concrete spec so the mapping can be defined — e.g., a history variable recording the linearization point. A history variable only *records*; it doesn't change what the spec does, so it preserves the implementation while giving the mapping enough information to exist. (Abadi & Lamport's "The Existence of Refinement Mappings" is the canonical treatment.)

---

## Core Concept 4 — Temporal Operators, ENABLED, and the Action Operators

To state liveness and fairness precisely you need the operator vocabulary, defined over a behavior `σ = s0, s1, s2, ...`. Write `σ|n` for the suffix starting at `sn`.

| Operator | Definition over behavior σ | Reads as |
|---|---|---|
| `□F` | `F` holds of `σ|n` for **all** n | always F |
| `◇F` | `F` holds of `σ|n` for **some** n | eventually F |
| `P ~> Q` | `□(P => ◇Q)` | P leads to Q |
| `◇□F` | eventually F holds forever | F eventually-stable |
| `□◇F` | F holds infinitely often | F infinitely-often |

Two more pieces are essential for fairness:

**The `ENABLED` predicate.** `ENABLED A` is a *state* predicate: it's true in state `s` iff there exists some `s'` such that the action `A` is true of the step `(s, s')`. Informally, "A *could* happen now."

```tla
\* For an action that requires the lock to be free:
Acquire(p) == lock = NoOne /\ lock' = p
\* ENABLED Acquire(p) is true exactly when lock = NoOne.
```

**The angle-bracket action operator.** `<<A>>_vars` ≜ `A /\ (vars' /= vars)` — "an A step that *actually changes* vars" (a non-stuttering A step). This matters because fairness must talk about *real* progress, not about A being satisfied by a stuttering step (every action is trivially satisfiable by stuttering if you're not careful). The angle brackets exclude that degenerate case.

With these, leads-to (`~>`) is how you state most liveness goals:

```tla
\* Every request is eventually served:
Liveness == \A r \in Requests : Requested(r) ~> Served(r)
```

> **Key insight:** `~>` (`□(P => ◇Q)`) is the workhorse of liveness specs because real requirements are almost always "whenever X, eventually Y." You rarely write raw `◇`; you write `~>`. And every liveness property you can *verify* must ultimately be *forced* by fairness — `~>` states the goal, `WF`/`SF` supply the obligation that makes it true.

---

## Core Concept 5 — Fairness: WF vs SF, Precisely

Fairness is the bridge from "this step is *allowed*" (safety) to "this step *must eventually happen*" (liveness). The two flavors differ in exactly one quantifier of "how persistently must the action be enabled before we're obligated to take it."

**Weak fairness:**

```
WF_vars(A)  ==  ◇□ENABLED <<A>>_vars  =>  □◇<<A>>_vars
```

In words: *if A is eventually enabled forever* (continuously, from some point on), *then A happens infinitely often*. Equivalent contrapositive intuition: A cannot stay enabled forever without ever being taken. WF is the right fairness for an action that, once it can happen, *stays* able to happen until it does — e.g., "a ready process eventually runs," "a buffered message eventually gets delivered."

**Strong fairness:**

```
SF_vars(A)  ==  □◇ENABLED <<A>>_vars  =>  □◇<<A>>_vars
```

In words: *if A is enabled infinitely often* (it keeps becoming enabled, even if it also keeps becoming disabled), *then A happens infinitely often*. SF is strictly stronger than WF (`◇□P => □◇P`, so SF's weaker hypothesis makes it a stronger obligation).

The whole reason SF exists: **actions that get repeatedly disabled.** Picture a process competing for a lock it keeps losing.

```tla
Acquire(p) == lock = Free /\ lock' = p          \* enabled only when lock is Free
Release(p) == lock = p    /\ lock' = Free
```

`ENABLED Acquire(p)` is true only when `lock = Free`. If other processes keep grabbing and releasing, `Acquire(p)` is enabled *intermittently* — flickering true (free), false (taken), true again. It is **not** eventually-enabled-forever, so **WF gives you nothing**: `WF_vars(Acquire(p))`'s hypothesis `◇□ENABLED` is false, the implication is vacuously satisfied, and `p` starves forever. To guarantee `p` eventually acquires you need

```tla
Liveness == \A p \in Procs : SF_vars(Acquire(p))   \* SF: enabled infinitely often => taken
```

because `Acquire(p)` *is* enabled infinitely often (the lock keeps becoming free), so SF's `□◇ENABLED => □◇⟨A⟩` forces it to eventually be taken.

> **Key insight:** Use **WF** for actions that stay enabled until taken (delivery, a ready thread running). Use **SF** for actions an environment can keep snatching away — anything *competing* for a contended resource. The litmus test: ask "can this action be enabled, then disabled by someone else, then enabled again, forever, without ever being taken?" If yes and that's a bug, you need SF. Getting this wrong is the single most common cause of "TLC says my liveness property fails and I don't understand why."

A practical note: SF is more expensive for TLC to check than WF (more complex tableau, more "promises" to track). Don't reach for SF reflexively — use it exactly where the disable/re-enable pattern occurs.

---

## Core Concept 6 — Machine Closure and the Fairness Traps

Splitting a spec into `Safety /\ Liveness` is only meaningful if the liveness part doesn't secretly constrain the safe behaviors. The property guaranteeing this is **machine closure**: `Init /\ [][Next]_vars /\ Liveness` is machine-closed iff every *finite* behavior allowed by the safety part can be *extended* to an infinite behavior satisfying the liveness part. Equivalently, the liveness part rules out only infinite "stalling," never any reachable finite prefix.

Why care? Two failure modes, both nasty because TLC may not obviously complain.

**Over-specifying (non-machine-closed).** If `Liveness` is stronger than `WF`/`SF` of `Next`'s subactions — say a free-form `□◇(x = 5)` bolted onto a spec where reaching `x = 5` needs a *particular* sequence of choices — you may get a spec whose behaviors are a thin, weird subset, or **no behaviors at all** (unsatisfiable). A spec with no behaviors implies *every* property vacuously: every invariant and liveness "holds," and your verification is meaningless. `WF`/`SF` of subactions of `Next` are *always* machine-closed — which is exactly why fairness is expressed **only** that way, never as free-form temporal formulas. This is not stylistic; it keeps liveness honest.

**Under-specifying.** The opposite: you assert `req ~> resp` but give *no* fairness, or fairness on the wrong action. Now the spec has behaviors where the system sits forever (a legal no-progress stutter), the property fails, and TLC hands you a lasso ending in an infinite stutter. The fix is the right `WF`/`SF`, not a weaker property.

> **Key insight:** Liveness is a *conjunct of the spec*, and the only safe way to write it is `WF`/`SF` of `Next`'s subactions. That guarantees machine closure (safety and liveness stay independent) and keeps you from the vacuity trap where an over-constrained spec proves everything. If you ever find yourself writing a raw `□◇(complicated)` as part of `Spec`, stop — you're probably about to make the spec vacuous.

**The non-vacuity check every senior runs.** Because a vacuous spec passes every property, you must *prove your spec isn't vacuous*. The cheapest check: assert a property you *know is false* (e.g., `□(x /= TargetValue)` for a value you expect to be reachable) and confirm TLC produces a counterexample reaching it. If TLC says that false property *holds*, your spec is dead — it has no behaviors that get there, and your "passing" verification is worthless.

---

## Core Concept 7 — Inductive Invariants

The invariant you *care about* (say, "no two replicas commit different values") is usually not directly checkable by hand-proof because it isn't **inductive** — knowing it holds in state `s` isn't enough to prove it holds in `s'`; you need extra facts about the in-flight messages and per-node state that make the bad transition impossible. An **inductive invariant** `Inv` is one strong enough to prove itself across a step:

```
(1)  Init => Inv                 \* holds initially
(2)  Inv /\ Next => Inv'         \* preserved by every step
```

From (1) and (2), `Inv` holds in every reachable state — and if `Inv => Safety`, your safety property holds. The art is *strengthening*: starting from the property you want (`Safety`) and adding the auxiliary conjuncts (type-correctness, message well-formedness, "no acceptor has accepted a value below its promised ballot") needed to close the induction.

```tla
\* The property we want:
Consistent == \A r1, r2 \in Replicas :
                committed[r1] /= None /\ committed[r2] /= None
                => committed[r1] = committed[r2]

\* The INDUCTIVE strengthening (schematic): add the facts that make a bad step impossible.
Inv == /\ TypeOK                                  \* every var in its domain
       /\ Consistent                              \* what we ultimately want
       /\ \A m \in messages : WellFormed(m)       \* no garbage messages
       /\ \A r \in Replicas :                      \* the real invariant work:
            committed[r] /= None =>
              \E Q \in Quorums : \A q \in Q : voted[q] = committed[r]
            \* a value is committed only if a quorum voted for it -> two committed
            \* values share a voter -> they're equal -> Consistent is preserved
```

You check inductiveness with TLC by treating `Inv` as the spec's "Init" over a *single* step:

```
\* A separate model just for the induction step:
SPECIFICATION  InvAndNext      \* InvAndNext == Inv /\ [Next]_vars  (one step)
INVARIANT      Inv             \* TLC checks Inv => Inv' on every Inv-state's successors
```

This is **inductive invariant checking** and it's qualitatively stronger than ordinary invariant checking: ordinary checking explores *reachable* states from `Init`; inductive checking explores all states satisfying `Inv` (reachable or not) and confirms none of them step *out* of `Inv`. The latter is what a real proof needs, and it's the bridge to TLAPS (below) for *unbounded* guarantees.

> **Key insight:** The bug-finding loop is "TLC shows me a state where `Inv'` fails; I look at it and realize I forgot a fact (some quorum/ballot/message constraint); I add that conjunct to `Inv`; repeat until inductive." Each failure teaches you a real property of the protocol you hadn't articulated. The inductive invariant *is* the proof of safety, written as a single predicate.

---

## Core Concept 8 — TLC Internals

TLC is an **explicit-state** model checker: it materializes states as concrete values and explores the reachable state graph by brute force. Its machinery tells you why it's fast for safety, slow for liveness, and how to make it finish at all.

**Safety search.** From the `Init` states, TLC does a **breadth-first** exploration of the successor relation: for each state it computes all successors (every action × every quantifier binding), checks each new state against all `INVARIANT`s immediately, and enqueues unseen states.

**Fingerprinting.** TLC can't keep tens of millions of full states in RAM, so each is reduced to a **64-bit fingerprint** and the "seen set" is a set of fingerprints. Hence TLC's *probabilistic* completeness: two distinct states could collide, skipping one. With `N` states the birthday-bound collision probability is ≈ `N² / 2^65` — at 10⁸ states ~10⁻⁴, small but nonzero. TLC prints the estimate; high-assurance work notes it.

**Disk-backed queue.** The frontier (discovered-but-unexpanded states) routinely exceeds memory, so TLC spills it to **disk** — exploration is often I/O-bound, and the practical limit is disk, not just CPU.

**Bounding with constraints.** You bound a huge/infinite space with a `CONSTRAINT` (state predicate — TLC won't expand states failing it) or `ACTION_CONSTRAINT` (step predicate), making unbounded models (queues, counters, message bags) finite-checkable at the cost of completeness beyond the bound:

```
CONSTRAINT  Len(queue) <= 4 /\ clock <= 10     \* don't explore beyond these bounds
```

**Symmetry reduction.** If a set of **model values** is interchangeable (three identical processes `{p1, p2, p3}`), the graph has huge symmetry — `p1` holding the lock is the same shape as `p2` holding it. `SYMMETRY` explores one representative per class, often a factorial reduction:

```
CONSTANTS  Procs = {p1, p2, p3}    SYMMETRY  Perms   \* Perms == Permutations(Procs)
```

> **Key insight:** `SYMMETRY` can make an intractable check tractable (k! fewer states), but it is **unsound for many liveness properties and for any expression that distinguishes the symmetric values** (one naming `p1` specifically, certain temporal properties). TLC trusts you. Use it for safety invariants over fully-interchangeable values; run liveness *without* it when in doubt.

**`VIEW`.** When states differ only in a component irrelevant to the property, a `VIEW` projects each state to "what counts"; TLC fingerprints the view, collapsing equivalent states. Like symmetry, it deliberately discards distinctions — sound only if the discarded part can't affect the property.

**Liveness checking — the expensive part.** Safety needs only the state graph; liveness needs **bad cycles** — lassos (a path into a cycle, repeated forever) that violate a temporal property. TLC builds a **tableau** from the negated formula, products it with the behavior graph, and searches for a reachable cycle that is (a) safety-permitted, (b) fairness-satisfying, and (c) property-violating. This effectively second, more global pass — tracking fairness "promises" — is why **liveness is markedly slower and more memory-hungry than safety**.

**Diameter and parallelism.** TLC reports the **diameter** (longest shortest-path from `Init` — the BFS depth where it stopped finding new states), a measure of how deep the reachable space is. It parallelizes successor computation across workers (`-workers N`), scaling reasonably for safety; a depth-first mode (`-dfid`) helps very deep, narrow spaces where the BFS frontier blows up memory.

> **Key insight:** TLC is brute force with good engineering — fingerprints + disk queue reach 10⁸–10⁹ states. The whole game is *keeping the reachable space small*: smallest model (2–3 of each thing) that still exhibits the bug, `CONSTRAINT` the unbounded parts, `SYMMETRY` the interchangeable values. The senior's first instinct on "TLC is still running after an hour" is a smaller, smarter model — not a bigger machine.

---

## Core Concept 9 — The Modeling Craft

This is the skill that separates someone who *knows* TLA+ from someone who *finds real bugs* with it. The hard part is never the syntax; it's choosing the abstraction.

**Atomicity grain.** In PlusCal, **labels mark atomic boundaries**: everything between two labels executes as a single, indivisible step. Choosing where labels go is choosing what your model treats as atomic — and it directly trades off correctness vs. tractability:

```pluscal
\* Coarse (one label): read-modify-write is ATOMIC -> hides the lost-update bug
acquire: counter := counter + 1;

\* Fine (the bug is now visible): read and write are SEPARATE steps -> interleaving exposed
read:   tmp := counter;
write:  counter := tmp + 1;
```

Too **coarse** and you hide real bugs (you modeled an atomic CAS where the system has none). Too **fine** and the state space explodes (every memory access is an interleaving point). The senior judgment is: *make atomic exactly what the real system makes atomic* — a single hardware CAS, one network send, one disk write — and split everything else.

> **Key insight:** A model checker can only find bugs your *abstraction* makes visible. If you put the whole transfer behind one label, no interleaving in the universe will reveal the lost-update race — you've assumed it away. The most consequential decision in a spec is the placement of atomicity boundaries, because it defines the set of bugs that are even *expressible*.

**Modeling a network.** The standard pattern: a network is a **set or bag of in-flight messages**, and receiving is "pick any message that's there." This one idea models asynchrony, reordering, loss, and duplication almost for free:

```tla
VARIABLE messages           \* a SET of messages currently in flight

Send(m)    == messages' = messages \union {m}

Receive(m) == /\ m \in messages                       \* \E msg \in messages : ...
              /\ <handle m, update state>
              /\ messages' = messages \ {m}            \* consume it

\* REORDERING: free — Receive picks *any* m \in messages, in any order.
\* LOSS: model as a Drop action, or just never deliver some message:
Drop(m)    == m \in messages /\ messages' = messages \ {m}
\* DUPLICATION: use a BAG (multiset) instead of a set, or simply DON'T remove on receive:
ReceiveDup(m) == m \in messages /\ <handle m> /\ UNCHANGED messages   \* m can be received again
```

A *set* gives arbitrary reordering and (receive-without-remove) re-delivery; a *bag* gives true multiplicity when exact duplicate counts matter. Loss is just "a message never received," explored automatically when no fairness forces delivery — or an explicit `Drop` when you want to reason about it.

**Modeling crashes.** A crash resets a node's volatile state (and may drop it from quorums) while preserving durable state:

```tla
Crash(n) == /\ state[n]' = [state[n] EXCEPT !.volatile = InitialVolatile]   \* lose memory
            /\ UNCHANGED durable[n]                                          \* keep disk
            /\ up' = up \ {n}                                                \* mark down
Recover(n) == /\ n \notin up
              /\ up' = up \union {n}
              /\ state[n]' = [state[n] EXCEPT !.volatile = RebuildFrom(durable[n])]
```

The line between `volatile` and `durable` is exactly where crash-consistency bugs live.

**Bounding the unbounded.** Counters, timestamps, and sequence numbers are conceptually unbounded; make them finite with a `CONSTRAINT` (`clock <= 5`) and verify the bug appears within the bound. If a small bound already exhibits it, a bigger one won't help; if an invariant holds *only* because of the bound, you've found either a real bound-dependence or an artifact — investigate which.

**"Is my spec saying what I think?"** Beyond the non-vacuity check (Core Concept 6), the essential discipline is **inject a bug and confirm the model catches it**: break an action (drop a guard, weaken a quorum), rerun TLC, and verify the expected counterexample appears. A spec whose invariants pass even after you sabotage the protocol was checking nothing. This "test the test" step is what makes a green run *mean* something.

---

## Core Concept 10 — Apalache and TLAPS

TLC is not the only engine, and seniors choose the tool to the problem.

**Apalache — symbolic model checking (SMT).** Apalache translates a *bounded* run of a TLA+ spec (up to some step length / unrolling) into **SMT constraints** and discharges them with **Z3**. Instead of enumerating concrete states, it reasons about *symbolic* states — so it handles **large or data-heavy state spaces** (big integers, large records, wide value domains) that would make TLC's explicit enumeration hopeless. The cost: it's **bounded** (it checks up to a depth `k`; it doesn't prove unbounded liveness), and it requires **type annotations** because SMT needs types where TLC was happy with untyped set theory:

```tla
\* Apalache type annotations (in comments TLC ignores but Apalache reads):
VARIABLES
  \* @type: Int;
  counter,
  \* @type: Set({src: Str, dst: Str, val: Int});
  messages
```

Reach for Apalache when: the data is too wide for TLC (large numeric ranges, big structures), you want *inductive-invariant* checking on a heavy spec, or TLC's explicit blowup is the bottleneck and the property is a safety/bounded one. Reach for TLC when: the state space is small/combinatorial, you need **liveness** with fairness, or you want the gentlest learning curve and richest error traces.

**TLAPS — the proof system.** TLC and Apalache are *checkers* (bounded or finite); TLAPS (the TLA+ Proof System) lets you write **machine-checked proofs** of *unbounded* theorems — properties that hold for *all* values, all process counts, forever — by decomposing the proof into steps discharged by backend provers (Zenon, Isabelle, SMT). You typically use TLAPS exactly for the **inductive-invariant** argument from Core Concept 7: prove `Init => Inv` and `Inv /\ Next => Inv'` for arbitrary parameters, getting a guarantee no finite model check can give. The price is real proof effort (it's interactive theorem proving), so it's reserved for the crown-jewel properties of the most critical protocols.

> **Key insight:** The toolchain is a ladder. Use **TLC** to find bugs fast and check liveness on small models; use **Apalache** when the data is too big for TLC or you want symbolic inductive checking; use **TLAPS** when "checked up to N processes / depth k" isn't enough and you need "proved for all N, forever." Most projects live entirely on the first rung — and that's correct; you climb only for the properties that justify the cost.

---

## Real-World Examples

**AWS — the canonical industrial case.** Amazon specified S3, DynamoDB, EBS, and internal lock/replication services in TLA+ and found *serious* bugs in already-reviewed, deployment-grade designs — subtle errors needing 35+ steps to trigger, the kind no test or review finds. The published account (Newcombe et al., *How Amazon Web Services Uses Formal Methods*, CACM 2015) is why TLA+ entered mainstream industry, and it stresses that the value was as much the *precise thinking the modeling forced* as the bugs TLC found.

**A lock service (the SF example, end to end).** Model a mutex with N competing clients. Safety (`□ (at most one holder)`) is an invariant TLC checks instantly. The interesting property is *liveness*: `\A c : RequestsLock(c) ~> HoldsLock(c)` — no client starves. As Core Concept 5 showed, `Acquire` is only enabled when the lock is free, so under contention it's intermittently-enabled; **WF leaves clients starving** and TLC produces a lasso where one client is forever passed over. `\A c : SF_vars(Acquire(c))` makes it hold — and watching WF fail then SF succeed is the clearest way to internalize the difference.

**Single-decree Paxos refining one-shot consensus.** Specify abstract consensus as a one-shot object: a single `chosen` value with "once chosen, never changes" and "only a proposed value is chosen." Then specify Paxos concretely (ballots; `Prepare`/`Promise`/`Accept`/`Accepted` in a `messages` set; per-acceptor `maxBal`/`maxVBal`/`maxVal`). The **inductive invariant** (Core Concept 7) is the heart of Paxos: a value is chosen only if a quorum accepted it, and any later accepted value at a higher ballot equals it — so two chosen values share a quorum, share a voter, and are equal. The **refinement mapping** defines abstract `chosen` from the committed value, and `PROPERTY Consensus!Spec` checks that Paxos implements consensus. (Lamport's own Paxos spec is the reference.)

**A TLC liveness error trace (abridged).** When liveness fails, TLC gives a **lasso** — a finite prefix plus a cycle it repeats forever:

```
Error: Temporal property "Liveness" is violated.
Error: The following behavior constitutes a counter-example:

State 1: <Initial>  /\ lock = Free  /\ pc = [c1 |-> "req", c2 |-> "req"]
State 2: c2 acquires /\ lock = c2    /\ pc = [c1 |-> "req", c2 |-> "crit"]
State 3: c2 releases /\ lock = Free  /\ pc = [c1 |-> "req", c2 |-> "req"]
State 4: c2 acquires /\ lock = c2    /\ pc = [c1 |-> "req", c2 |-> "crit"]
   |
   | -- Back to state 2 (a cycle) --
   v
\* c1 is enabled (lock becomes Free) infinitely often but never taken:
\* WF was assumed; SF_vars(Acquire(c1)) is required.
```

Reading it: `c1` sits in `req` forever while `c2` grabs the lock again and again. The cycle (states 2–4 repeating) is the bad behavior; `c1`'s `Acquire` is enabled infinitely often (every time the lock is `Free`) but never taken — exactly the WF-vs-SF gap. The fix is `SF_vars(Acquire(c1))`, and the trace told you precisely which fairness assumption was too weak.

---

## Mental Models

- **A spec is one formula; correctness is one implication.** `Spec == Init /\ [][Next]_vars /\ Liveness` denotes a set of behaviors. "System satisfies property" is `Spec => Property`. Hold this and refinement, composition, and properties all become the same move.

- **Stuttering-invariance is the hinge.** The `_vars` in `[Next]_vars` makes added "do-nothing" steps invisible — which is the *only* reason a detailed design can implement an abstract spec. If you ever break stuttering-invariance (e.g., a clock that ticks every step), you've broken refinement.

- **Refinement is implication through a mapping.** Define the abstract variables as functions of the concrete ones, then `Spec_concrete => Abstract!Spec`. Prove the abstract spec correct once; concrete designs inherit correctness by refining it.

- **WF is for "stays ready"; SF is for "keeps being snatched away."** Weak fairness fires when an action is *continuously* enabled; strong fairness fires when it's *repeatedly* enabled. Contention needs SF.

- **The atomicity grain defines which bugs exist.** Labels are atomic boundaries. Coarse hides races; fine explodes the state space. Model atomic exactly what the real system makes atomic.

- **TLC is brute force; the skill is shrinking the universe.** Smallest model that shows the bug, `CONSTRAINT` the unbounded parts, `SYMMETRY` the interchangeable values. Safety is cheap; liveness (bad-cycle search) is expensive.

---

## Common Mistakes

1. **Using WF where SF is required.** For an action enabled only intermittently (anything competing for a contended resource), `WF`'s `◇□ENABLED` hypothesis is false and gives you nothing — clients starve and TLC reports a liveness violation you can't explain. Diagnose with "can this be enabled, disabled, re-enabled forever without firing?"; if yes, use `SF`.

2. **Writing liveness as a free-form temporal formula.** Bolting `□◇(complex)` onto `Spec` risks a non-machine-closed (often vacuous) spec that proves everything. Express fairness *only* as `WF`/`SF` of subactions of `Next`.

3. **Never checking for vacuity.** A spec with no behaviors satisfies every property. Always assert a known-false property (a reachable state you claim is unreachable) and confirm TLC produces the counterexample — otherwise a "passing" run may be meaningless.

4. **Atomicity too coarse.** Putting a read-modify-write behind one PlusCal label models an atomicity the real system lacks and *assumes away* the very race you're hunting. Split steps to match real atomic operations.

5. **`SYMMETRY` with liveness or value-distinguishing properties.** Symmetry reduction is unsound for many `PROPERTY`/liveness checks and for any expression that names a specific symmetric value. Use it for safety over interchangeable values; verify liveness without it.

6. **Forgetting `UNCHANGED`.** An action that doesn't constrain some variable lets TLC set it to *anything*, exploding the state space and admitting absurd behaviors. Every action must say what each variable does — usually via `UNCHANGED <<others>>`.

7. **Confusing "checked" with "proved."** TLC verifies a *bounded model* (this many processes, this depth). It is not a proof for all N. If you need an unbounded guarantee, you need an inductive invariant (Apalache or TLAPS), not a bigger TLC model.

8. **A clock that ticks every step.** Breaks stuttering-invariance and silently destroys refinement. Model time as an action that *may* advance, not one that advances on every transition.

---

## Test Yourself

1. Write the canonical form of a complete TLA+ spec and say what kind of object (state predicate / step predicate / behavior predicate) each conjunct is.
2. What is stuttering-invariance, and why is it the prerequisite for refinement? Give a concrete example of a step that stutters at the abstract level but not the concrete one.
3. State what "A implements B" means formally when A and B have different variables. What bridges the variable gap, and how do you check it in TLC?
4. Define `WF_vars(A)` and `SF_vars(A)` precisely (as `ENABLED`/`□`/`◇` formulas). Give a scenario where WF is insufficient and SF is required, and explain why.
5. What is machine closure, and why must fairness be written as `WF`/`SF` of `Next`'s subactions rather than arbitrary temporal formulas?
6. What makes an invariant *inductive*, and why is inductive-invariant checking stronger than ordinary invariant checking?
7. Why is liveness checking in TLC much more expensive than safety checking? What is the engine actually searching for?
8. When would you reach for Apalache over TLC, and when for TLAPS over both?

<details>
<summary>Answers</summary>

1. `Spec == Init /\ [][Next]_vars /\ Liveness`. `Init` is a **state predicate** (the first state). `[][Next]_vars` is a **temporal predicate** over the **action predicate** `Next` (`[Next]_vars == Next \/ (vars' = vars)`, with `[]` at every step) — the *safety* part. `Liveness` (a conjunction of `WF`/`SF`) is also temporal — the *liveness* part.

2. Inserting/deleting finite runs of variable-unchanged steps maps behaviors of the spec to behaviors of the spec. It's the prerequisite for refinement because a detailed design has *more* steps than the abstract spec, and those extra steps must be invisible at the abstract level — invisible precisely because the abstract variables stutter across them. Example: a low-level `LogTransfer` changes only a log variable; through the abstract balances, nothing moved.

3. `Spec_A => Spec_B` (every behavior of A satisfies B). When variables differ, a **refinement mapping** bridges the gap: define each of B's variables as an expression over A's (`INSTANCE B WITH bVar <- expr_over_A`). Check in TLC with `SPECIFICATION Spec` + `PROPERTY B!Spec` — TLC evaluates B through the mapping on every concrete behavior.

4. `WF_vars(A) == ◇□ENABLED <<A>>_vars => □◇<<A>>_vars`; `SF_vars(A) == □◇ENABLED <<A>>_vars => □◇<<A>>_vars`. WF is insufficient for an intermittently-enabled action — `Acquire` for a lock others keep grabbing is enabled, disabled, re-enabled, never *continuously* enabled, so WF's `◇□ENABLED` hypothesis is false and the obligation is vacuous (the process starves). SF's `□◇ENABLED` *is* satisfied (the lock keeps becoming free), so SF forces the acquire.

5. Machine closure: every finite safe behavior extends to an infinite live one — liveness rules out only infinite stalling, never a reachable prefix. It matters because an over-strong liveness conjunct can make the spec describe a thin subset or *none at all* (vacuously true of everything). `WF`/`SF` of `Next`'s subactions are always machine-closed, which is why fairness is restricted to that form.

6. Inductive: `Init => Inv` and `Inv /\ Next => Inv'`. Ordinary checking explores only *reachable* states; inductive checking explores *all* states satisfying `Inv` (reachable or not) and confirms none step out — what an unbounded proof needs, and the basis for TLAPS.

7. Safety needs only the reachable *state graph*. Liveness requires finding **bad cycles** — infinite lasso behaviors that satisfy the fairness hypotheses yet violate the property. TLC builds a tableau from the negated property, products it with the behavior graph, and searches for a reachable, fairness-respecting, violating cycle — a second, more global analysis tracking fairness promises, hence much slower.

8. **Apalache** when data is too wide for TLC's enumeration, or for symbolic bounded / inductive-invariant checking (needs `@type` annotations; depth-bounded). **TLAPS** when bounded isn't enough and you need "for all N, forever" via a machine-checked inductive proof.

</details>

---

## Cheat Sheet

```
THE SPEC (one temporal formula over behaviors)
  Spec == Init /\ [][Next]_vars /\ Liveness
  [Next]_vars  ==  Next \/ (vars' = vars)      \* allows stuttering steps
  Init        : state predicate (first state)
  [][Next]    : SAFETY  (allowed steps; nothing is forced)
  Liveness    : WF/SF only  (what must eventually happen)

TEMPORAL / ACTION OPERATORS
  []F  always F      <>F  eventually F      P ~> Q  ==  [](P => <>Q)
  <>[]F eventually-stable   []<>F infinitely-often
  ENABLED A   : state pred — exists a successor making A true
  <<A>>_vars  ==  A /\ (vars' /= vars)        \* a *non-stuttering* A step

FAIRNESS
  WF_vars(A) == <>[]ENABLED <<A>>_vars => []<><<A>>_vars   \* stays-enabled => taken
  SF_vars(A) == []<>ENABLED <<A>>_vars => []<><<A>>_vars   \* enabled-often => taken
  WF: delivery, a ready thread runs.   SF: contention for a contended resource.

REFINEMENT
  "A implements B"  ==  Spec_A => Spec_B
  mapping: INSTANCE B WITH bVar <- expr_over_A    \* bridge differing variables
  check in TLC:  SPECIFICATION Spec   PROPERTY B!Spec

INDUCTIVE INVARIANT (the proof of safety)
  Init => Inv          and          Inv /\ Next => Inv'
  strengthen Inv with TypeOK + message/quorum/ballot facts until inductive

TLC TUNING (shrink the universe)
  CONSTRAINT  Len(q) <= 4 /\ clock <= 10     bound unbounded parts
  SYMMETRY    Permutations(Procs)            k! fewer states (UNSOUND for liveness!)
  VIEW        <projection>                    collapse states by what matters
  -workers N   parallel safety     -dfid K    depth-first for deep narrow spaces

TOOL LADDER
  TLC      explicit-state, finite, great traces, does liveness
  Apalache symbolic (SMT/Z3), bounded, big data, needs @type annotations
  TLAPS    machine-checked proofs, unbounded ("for all N, forever")

SANITY CHECKS (make a green run MEAN something)
  non-vacuity : assert a known-false (reachable) property -> expect a counterexample
  test-the-test: inject a bug -> confirm TLC catches it
```

---

## Summary

- A TLA+ spec is **one temporal formula** over behaviors (infinite state sequences): `Init /\ [][Next]_vars /\ Liveness`. "System satisfies property" is the implication `Spec => Property` — the same logic for the implementation and the specification.
- The `_vars` makes specs **stuttering-invariant**, and that single property is what makes **refinement** and **composition** possible — extra implementation steps are invisible at the abstract level because the abstract variables stutter across them.
- **Refinement is implication through a refinement mapping:** define the abstract variables as functions of the concrete ones and check `Spec_concrete => Abstract!Spec` (in TLC, `PROPERTY Abstract!Spec`). Prove the abstract spec correct once; concrete designs inherit it.
- **Fairness:** `WF_vars(A)` (`◇□ENABLED => □◇⟨A⟩`) for actions that stay enabled until taken; `SF_vars(A)` (`□◇ENABLED => □◇⟨A⟩`) for actions repeatedly snatched away by contention. Write fairness **only** as `WF`/`SF` of `Next`'s subactions to keep the spec **machine-closed** and non-vacuous.
- The **inductive invariant** (`Init => Inv`, `Inv /\ Next => Inv'`) is the safety proof written as one predicate; strengthening it until inductive is the core bug-finding loop and the bridge to TLAPS.
- **TLC** is explicit-state BFS with 64-bit fingerprints and a disk-backed queue; safety is cheap, **liveness (bad-cycle search via a tableau) is expensive**, and `CONSTRAINT`/`SYMMETRY`/`VIEW` shrink the space (symmetry is unsound for liveness). The real craft is the **abstraction and atomicity grain** — labels are atomic boundaries that define which bugs are even expressible — plus the discipline of non-vacuity and bug-injection checks.

You now reason about TLA+ at the level of the logic, not just the tool. The next layer — [professional.md](professional.md) — is about operating formal specification across a team and an organization: where it pays off, how to integrate it with the engineering process, and how to keep specs alive as designs evolve.

---

## Further Reading

- *Specifying Systems* — Leslie Lamport. The canonical book: TLA+, TLC, fairness, refinement, and the full semantics. Free online.
- *The Temporal Logic of Actions* — Leslie Lamport, *ACM TOPLAS* 16(3), 1994. The foundational paper defining TLA, stuttering-invariance, and `WF`/`SF`.
- *The Existence of Refinement Mappings* — Abadi & Lamport. When refinement mappings exist and why you sometimes need history/prophecy variables.
- *How Amazon Web Services Uses Formal Methods* — Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff, *CACM* 58(4), 2015. The industrial case that mainstreamed TLA+.
- [Apalache documentation](https://apalache.informal.systems/) — the symbolic (SMT/Z3) model checker, type annotations, and inductive-invariant checking.
- *Learn TLA+* and *Practical TLA+* — Hillel Wayne. The most approachable on-ramps, strong on PlusCal and the modeling craft.
- The TLAPS site and Lamport's Paxos / Byzantine Paxos specs — worked references for proofs and refinement.
- Pointer to the next tier: [professional.md](professional.md).

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/senior.md) — the broader discipline of writing precise specs; TLA+ is one notation within it.
- [02 — Model Checking](../02-model-checking/senior.md) — explicit-state vs symbolic checking, state explosion, and how TLC fits the wider landscape.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/senior.md) — lighter-weight, code-level verification (properties, contracts) versus design-level TLA+.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/senior.md) — full theorem proving (Coq/Isabelle/Lean), the world TLAPS borrows its backends from.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the consensus, replication, and linearizability protocols TLA+ is most often used to verify.
