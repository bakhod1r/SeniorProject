# TLA+ & Temporal Logic — Interview Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → TLA+ & Temporal Logic
> *A TLA+ interview rarely asks you to recite the syntax of `[][Next]_vars`. It asks "you have a distributed lock — what could go wrong," then "you wrote a spec and TLC says no error, are you done," and watches whether you can separate a behavior from a state, safety from liveness, and a green check from a proof. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Introduction](#introduction)
4. [Fundamentals](#fundamentals)
5. [Temporal Logic & Fairness](#temporal-logic--fairness)
6. [Spec Structure & Semantics](#spec-structure--semantics)
7. [TLC & Scale](#tlc--scale)
8. [Practice & Scenarios](#practice--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **state vs behavior** (a snapshot of the variables vs an infinite sequence of them — TLA+ reasons about whole executions, not single states)
- **safety vs liveness** ("nothing bad ever happens" vs "something good eventually happens" — and only liveness needs fairness)
- **model vs code** (you verify a design's abstraction, not the bytes that ship; the spec is a separate artifact)
- **a green check vs a proof** (TLC PASS is only as strong as your constants, your atomicity, and whether the property is vacuously true)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for syntax.

---

## Prerequisites

You'll answer better if you're comfortable with:

- **State machines** — states, transitions, an initial state, and an execution as a path through them. TLA+ is "a state machine with math," so this is the whole mental model.
- **Concurrency basics** — interleavings, race conditions, and why "it passed the load test 10,000 times" proves nothing about the 10,001st interleaving.
- **Predicate logic** — `∧ ∨ ¬ ⇒`, `∀`, `∃`, and set comprehension. TLA+ is *just math*; if `{x ∈ S : P(x)}` reads naturally, the language will too.
- **The two property classes** — even informally: "this must never happen" (safety) versus "this must eventually happen" (liveness). The whole temporal-logic section turns on it.

You do *not* need to have shipped a spec, but knowing the *names* — TLA+/TLC/PlusCal/Apalache, and Lamport and the Amazon paper — will read as senior.

---

## Introduction

TLA+ is the formal method most likely to come up in a *systems* or *distributed* interview, because it's the one with a famous industrial success story: Amazon used it to find a 35-step bug in DynamoDB's replication protocol *before writing the code*, and now uses it across S3, EBS, and more. The questions cluster into five themes: the **fundamentals** (what TLA+ is, what TLC does, PlusCal vs TLA+), **temporal logic and fairness** (the real differentiator — anyone can say "it checks states"; few can write a liveness property and explain why it needs fairness), **spec structure and semantics** (the `Init /\ [][Next]_vars /\ Fairness` shape, stuttering, refinement), **TLC and scale** (explicit-state BFS, state explosion, and the remedies), and **practice/scenarios** (what's worth modeling, the abstraction decisions, and the all-important "TLC passed — now what").

The trap throughout is overclaiming. A weak candidate says "TLA+ proves my system is correct." A strong one says "it exhaustively checks a *finite model* of my *design* against temporal properties, and either hands me a concrete counterexample trace or tells me the property holds *in that model, at that abstraction, under those fairness assumptions and those constant bounds*" — and can then list everything those qualifiers are carrying.

---

## Fundamentals

### Q: What is TLA+ and what problem does it solve?

> **Testing:** Whether you can frame it as *design verification*, not "another testing tool."

**A.** TLA+ is a language for *specifying* a system — usually a concurrent or distributed algorithm — as a state machine described in math, so you can check the **design** before you build it. The problem it solves is that the hardest bugs in distributed systems are in the *design*: a race between a node crash and a retry, a sequence of partial failures that leaves two replicas disagreeing. Those bugs survive code review and unit tests because no human reasons reliably about all interleavings. TLA+ lets you state precisely what the system does and what must always be true, and then a model checker explores *every* reachable state of the model and either finds a counterexample or confirms the property holds. The key reframe: you're not verifying code, you're verifying that the *idea* is sound — which is cheaper to fix at design time than after launch.

### Q: Define state, action, and behavior in TLA+.

> **Testing:** The core vocabulary, and whether you grasp that TLA+ reasons over *executions*, not snapshots.

**A.** A **state** is an assignment of values to all the variables — one snapshot of the system. An **action** is a relation between two consecutive states: a formula over unprimed variables (the current state) and primed variables (the next state), e.g. `x' = x + 1`, which says "the next value of `x` is the current value plus one." A **behavior** is an *infinite sequence of states* — a complete execution of the system. This is the thing that makes TLA+ "temporal": a property isn't evaluated at one state, it's evaluated over a whole behavior. A specification is, formally, a predicate that is true of exactly the behaviors the system is allowed to exhibit.

### Q: What's a primed variable, and what does `UNCHANGED` mean?

> **Testing:** The single most distinctive piece of TLA+ syntax — and the frame problem.

**A.** An *unprimed* variable like `x` denotes its value in the current state; a *primed* variable `x'` denotes its value in the *next* state. So an action `x' = x + 1 /\ y' = y` says "x increments, y stays." `UNCHANGED y` is just sugar for `y' = y`. It matters because of the **frame problem**: in a spec with many variables, every action must say what happens to *all* of them, or TLC will allow them to take *any* value (a non-deterministic, broken model). So you write `UNCHANGED <<y, z, q>>` to pin down everything an action doesn't touch. Forgetting an `UNCHANGED` is one of the most common spec bugs — the model "works" but explores nonsense states where unrelated variables mutate freely.

### Q: What does TLC actually do?

> **Testing:** Whether you know the checker is explicit-state and exhaustive, not a prover or a random tester.

**A.** TLC is an **explicit-state model checker**. Given `Init` (the allowed initial states) and `Next` (the next-state relation), it does a breadth-first search of the *reachable state graph*: start from every initial state, compute every successor via `Next`, and keep going until no new states appear. At every state it checks your **invariants** (state predicates that must hold everywhere); for **temporal properties** it analyzes the behavior graph for violating cycles. If a check fails, TLC prints the **shortest trace** — the exact sequence of states and actions that reaches the violation. Crucially it's *exhaustive over the model* (every reachable state, not a sample) but *finite* (you must bound the model with concrete constants), and it finds bugs or proves the property *for that finite model* — not for the unbounded real system.

### Q: PlusCal vs TLA+ — what's the difference and when do you use each?

> **Testing:** Whether you understand PlusCal is a convenience layer, not a separate tool.

**A.** **TLA+** is the underlying math: actions and temporal formulas. **PlusCal** is an *algorithm language* that looks like pseudocode (with `while`, `if`, procedures, processes) and **compiles to TLA+** — the translation is written back into the same file as a comment block, and TLC checks the generated TLA+. You reach for PlusCal when the system is naturally *imperative* — a concurrent algorithm with a program counter, locks, message loops — because expressing "line 3 then line 4" is far more natural than hand-writing the next-state relation. You drop to raw TLA+ when the system is more naturally *declarative* (a protocol described by the conditions under which each message can be sent) or when you need fine control PlusCal hides. A subtle but critical point: **PlusCal labels define the atomic steps** — everything between two labels happens in one indivisible action — so where you put labels *is* the concurrency model. More on that below.

---

## Temporal Logic & Fairness

### Q: What do `[]`, `<>`, and `~>` mean?

> **Testing:** The vocabulary of temporal logic — the differentiator for this topic.

**A.** These are the temporal operators, evaluated over a behavior (an infinite sequence of states):

- `[]P` ("**always** P", box) — P holds in *every* state of the behavior. This is how you write **safety**.
- `<>P` ("**eventually** P", diamond) — P holds in *at least one* state, now or later. This is the building block of **liveness**.
- `P ~> Q` ("P **leads to** Q") — defined as `[](P => <>Q)`: *whenever* P becomes true, Q is *eventually* true thereafter. This is the workhorse for "every request is eventually answered."

So `[]` quantifies over all states, `<>` asserts existence somewhere downstream, and `~>` chains them: a response is guaranteed to follow every request.

### Q: Contrast `[]<>P` and `<>[]P`.

> **Testing:** The classic temporal-logic gotcha — operator order changes the meaning completely.

**A.** Order flips the meaning entirely:

- `[]<>P` — "**always eventually** P", i.e. P is true *infinitely often*. No matter how far along the behavior you are, P happens again later. This is the shape of **fairness** ("the process is enabled infinitely often, so it eventually runs") and of "the system keeps making progress forever."
- `<>[]P` — "**eventually always** P", i.e. P becomes true at some point and *stays* true forever after. This is **stabilization** — "the system eventually settles into a good state and never leaves." Think: a leader is eventually elected and then remains leader.

Mixing these up is a giveaway. "Infinitely often" (`[]<>`) is a recurring guarantee; "eventually permanent" (`<>[]`) is convergence. A retry loop is `[]<>`; eventual consistency converging is `<>[]`.

### Q: TLA+ uses linear-time logic. What does that mean, and how does LTL differ from CTL?

> **Testing:** Senior-level grounding — knowing *which* temporal logic and why it matters.

**A.** TLA+ is a **linear-time** logic: a property is true or false of a *single* behavior (one linear sequence of states), and the spec holds iff the property is true of *every* behavior. There's no operator that quantifies over branching futures from a state. **LTL** (Linear Temporal Logic) is exactly this view — operators (`[]`, `<>`, `next`, `until`) describe one timeline. **CTL** (Computation Tree Logic) is *branching-time*: it adds path quantifiers `A` ("for all futures") and `E` ("there exists a future"), so you can say `AG EF reset` — "from every reachable state, there *exists* a path back to reset." The practical difference: LTL/TLA+ can't say "there exists a path where...", which is occasionally what you want (reachability of a recovery state), but linear-time matches how we reason about distributed executions (a run is a run) and composes cleanly with refinement. TLA+ deliberately chose linear-time; it's `[]`/`<>` over behaviors, not `A`/`E` over a tree.

### Q: Write "no two processes are ever in the critical section at once" and "every request is eventually answered."

> **Testing:** Can you actually translate English requirements into temporal formulas, and do you classify them correctly?

**A.** The first is **safety** — an invariant, just `[]` over a state predicate:

```tla
MutualExclusion == [] (Cardinality({p \in Procs : pc[p] = "crit"}) <= 1)
```

(In practice you'd assert the inner predicate as a TLC `INVARIANT`, which is the cheap `[]` check.) The second is **liveness** — a `~>` (leads-to):

```tla
Responsiveness == \A r \in Requests : (Pending(r) ~> Answered(r))
```

"For every request, being pending leads to being answered." The first says *bad never happens*; the second says *good eventually happens*. Naming them as safety and liveness — and knowing the second one needs fairness while the first doesn't — is the whole point of the question.

### Q: Why does liveness need fairness, but safety doesn't?

> **Testing:** The deepest conceptual point in temporal logic — most candidates miss this.

**A.** Because **safety can be violated by a finite prefix, but liveness can only be violated by an infinite behavior — and the trivially-infinite behavior is "the system does nothing."** A safety property like mutual exclusion fails the *moment* two processes are both in the critical section; you don't need to assume anything about the future. But a liveness property like "the request is eventually answered" is broken by a behavior where the answering action *never runs* — and `[][Next]_vars` *permits* a behavior that takes one step and then **stutters forever** (the system just sits there). That stuttering behavior never answers the request, so liveness is "violated" trivially, even though a real scheduler would eventually run the action. **Fairness** is the assumption that rules out those pathological non-progressing behaviors: it says "an action that stays enabled must eventually be taken." Without a fairness assumption, *every* liveness property is false because the do-nothing behavior is always a counterexample. So: safety holds regardless of fairness; liveness is only meaningful *relative to* a fairness assumption.

### Q: Weak vs strong fairness — define both and give a case that needs strong.

> **Testing:** The senior distinction — knowing when WF isn't enough.

**A.** Both are about an action `A` not being starved, but they differ on what "enabled" requires:

- **Weak fairness** `WF_vars(A)`: if `A` is **continuously enabled** (stays enabled from some point on), it must eventually be taken. Equivalently, `A` can't be *permanently* enabled and never run.
- **Strong fairness** `SF_vars(A)`: if `A` is **enabled infinitely often** (repeatedly, even if it keeps getting disabled in between), it must eventually be taken.

The difference matters when an action's enabledness *flickers*. Classic case: a process waits on a lock that is repeatedly grabbed and released by others. Each time the lock frees, our process *could* acquire it (enabled), but then someone else grabs it and our process is disabled again — so it's enabled infinitely often but **never continuously enabled**. Weak fairness says nothing (it was never continuously enabled); the process can starve forever. To guarantee it eventually acquires the lock you need **strong fairness** `SF_vars(Acquire(p))`. Rule of thumb: if the action competes for a resource and can lose the race repeatedly, you likely need SF; for an action that, once ready, stays ready until taken, WF suffices. SF is also more expensive for TLC to check.

> **Callout — the fairness footgun.** Over-asserting fairness is a silent way to make liveness *vacuously* pass. If you slap `SF` on everything, you may have assumed away the very starvation the property was meant to catch. Assert the *weakest* fairness that reflects what the real scheduler/runtime actually guarantees — no more.

---

## Spec Structure & Semantics

### Q: Walk me through the canonical shape of a TLA+ spec.

> **Testing:** Whether you know the standard idiom and what each conjunct contributes.

**A.** A complete temporal spec is almost always:

```tla
Spec == Init /\ [][Next]_vars /\ Fairness
```

- **`Init`** — a state predicate defining the allowed *initial* states (e.g. `pc = [p \in Procs |-> "start"] /\ x = 0`).
- **`[][Next]_vars`** — the *core*. `Next` is the disjunction of all actions (`A1 \/ A2 \/ ...`). `[Next]_vars` means "`Next` *or* a stuttering step that leaves `vars` unchanged," and the outer `[]` says this holds at every step. So: every step is either a real action or does nothing.
- **`Fairness`** — the conjunction of `WF_vars(...)` / `SF_vars(...)` assumptions needed for the liveness properties to be meaningful.

Then you check `Spec => Invariant` (safety) and `Spec => LivenessProperty` (liveness). The genius of this shape — and the reason for the `[...]_vars` subscript — is the next question.

### Q: What is stuttering and why does TLA+ build it into the spec?

> **Testing:** A deep TLA+-specific idea that distinguishes it from other temporal logics — and the foundation of refinement.

**A.** **Stuttering** is a step where *nothing changes* — the variables stay the same from one state to the next. The `[Next]_vars` notation explicitly *allows* stuttering steps (`[Next]_vars == Next \/ (vars' = vars)`), which seems pointless until you see why it's there: it makes specs **composable and refineable**. If a high-level spec describes a system in 3 big steps and a low-level spec implements each big step with 5 small steps, the extra small steps look like "stuttering" relative to the high-level variables (the high-level state doesn't change during sub-steps). Because the high-level spec *tolerates* stuttering, the low-level one can be a valid **implementation** of it. Stuttering-insensitivity is what lets you say "the implementation refines the spec" without the two having to take steps in lockstep. It's also why safety properties are naturally robust: adding a do-nothing step never breaks `[]Invariant`.

### Q: What is refinement, and how do you express "the implementation satisfies the spec"?

> **Testing:** The most powerful and least-understood TLA+ idea — staff-level.

**A.** Refinement is the statement that a *detailed* spec is a correct **implementation** of a more *abstract* one — and in TLA+ it's just **logical implication between specifications**: `Impl => Spec`. Both are temporal formulas describing sets of behaviors; `Impl => Spec` says "every behavior the implementation allows is also allowed by the spec," i.e. the implementation does nothing the abstract spec forbids. Because the two specs usually have *different variables*, you supply a **refinement mapping**: you define the abstract variables as functions of the concrete ones (e.g. `queue == [the abstract queue computed from my concrete buffer + pointers]`), substitute them into the abstract spec, and ask TLC to check that the concrete `Spec` implies the *substituted* abstract spec. This is exactly how you verify a real protocol against an idealized one — and how Lamport frames "correctness": an implementation is correct iff it refines its specification. Stuttering (previous question) is what makes this work when the implementation takes more steps than the abstraction.

### Q: What's an inductive invariant, and why isn't every invariant inductive?

> **Testing:** Whether you understand the difference between "true everywhere" and "provable by induction" — key for proofs and for Apalache.

**A.** An **invariant** is a state predicate true in every *reachable* state. An **inductive invariant** is stronger: it's a predicate `Inv` such that (1) `Init => Inv` and (2) `Inv /\ Next => Inv'` — i.e. it's true initially *and* preserved by every action, *considered in isolation, without knowing it's reachable*. Many true invariants are **not** inductive: they hold on all reachable states, but you can construct an *unreachable* state that satisfies the invariant yet has a successor that violates it — so the inductive step fails. The fix is to *strengthen* the invariant: conjoin extra facts (about the relationships between variables) until it becomes self-supporting. This matters because (a) a TLAPS proof of safety needs an inductive invariant, and (b) **Apalache** (the symbolic checker) verifies safety by checking inductiveness rather than enumerating states, so it *needs* you to supply the inductive invariant. TLC, by contrast, only checks reachable states, so it accepts any true invariant — which is exactly why it can't scale the way an inductive proof can.

---

## TLC & Scale

### Q: How does TLC explore the state space, and what's fingerprinting?

> **Testing:** Concrete operational understanding of the checker.

**A.** TLC does a **breadth-first search** of the reachable state graph. It keeps a *queue* of states to expand and a *set* of states already seen; for each state it computes all successors under `Next`, discards ones already seen, and enqueues the rest, until the queue empties. The "already seen" set is the memory hog, so TLC doesn't store full states — it stores a **fingerprint**: a 64-bit hash of each state. That's what lets it track billions of states in feasible memory. The tradeoff is a tiny probability of a hash collision (two distinct states with the same fingerprint), in which case TLC might skip a state — astronomically unlikely but not zero, which is worth knowing. BFS also means the counterexample TLC reports is the **shortest** path to the violation, which makes traces far easier to read.

### Q: What is the state-explosion problem and how do you fight it in TLC?

> **Testing:** The defining practical challenge — and whether you know the standard levers.

**A.** State explosion: the reachable state count is roughly the *product* of each variable's range and grows combinatorially with concurrent components — N processes each with M states is already `M^N`, and adding a message channel or a counter multiplies it again. TLC enumerates explicitly, so this is the wall you always hit. The remedies, roughly in order:

- **Small constants.** Use the *smallest* model that can still exhibit the bug — 3 nodes, not 100; a queue bound of 2, not 1000. Most concurrency bugs appear with 2–3 of everything (the "small scope hypothesis").
- **`SYMMETRY`.** If processes are interchangeable, declare a symmetry set so TLC treats permutations of process identities as one state — often an N!-fold reduction.
- **State constraints.** A `CONSTRAINT` like `x <= 5` tells TLC to stop exploring beyond a bound, making an infinite/huge space finite.
- **`VIEW`.** Collapse states that differ only in details irrelevant to the property.
- **Tighten the model** — fewer variables, coarser atomicity (fewer labels), abstract away parts you're not checking.

The senior point: state explosion is fought at the *modeling* level (smaller, more abstract models) far more than by throwing hardware at it.

### Q: TLC ran out of memory. What now?

> **Testing:** Calm, ordered triage rather than "buy a bigger box."

**A.** First, recognize this is the *expected* failure mode of an explicit-state checker, and that the answer is almost always **shrink the model, not grow the machine**. In order:

1. **Reduce the constants.** Drop from 4 nodes to 3, queue bound 3 to 2. Re-confirm the model is still big enough to *possibly* show the bug.
2. **Add `SYMMETRY`** over interchangeable identities — frequently the single biggest win.
3. **Add a state `CONSTRAINT`** to bound any unbounded variable (counters, sequence numbers, channel length).
4. **Coarsen atomicity** — merge PlusCal labels so fewer intermediate states exist (only safe if those intermediate states can't be observed by another process; see below).
5. **Check for an accidental blowup** — an unbounded counter, a `Nat` where a small set would do, a forgotten `UNCHANGED` letting a variable range freely.
6. **Only then** scale TLC: give it more workers (it parallelizes well), more heap, or switch to **disk-based** state storage. And consider **Apalache**, which is symbolic and doesn't enumerate (next question).

The instinct that separates seniors: reach for SYMMETRY and a CONSTRAINT *before* asking for a bigger instance.

### Q: TLC vs Apalache — when would you use the symbolic checker?

> **Testing:** Awareness that explicit-state isn't the only option.

**A.** **TLC** is explicit-state: it enumerates reachable states. Great default — easy to start, finds bugs fast on small models, gives short concrete traces. **Apalache** is **symbolic**: it translates the spec and a *bounded* property into SMT and asks Z3, so it reasons about *sets* of states symbolically instead of enumerating them. Use Apalache when (a) the state space is too large to enumerate but you can bound the *trace length* (bounded model checking — "is there any violation within k steps?"), or (b) you want to prove an **inductive invariant** outright (`Init => Inv` and `Inv /\ Next => Inv'`) which, if it succeeds, holds for *unbounded* executions — something TLC structurally can't give you. The costs: Apalache needs **type annotations** and tends to want an inductive invariant (which you must craft), and some specs translate to SMT better than others. Practical workflow: prototype and bug-hunt with TLC, then reach for Apalache for inductive proofs or when explicit enumeration won't fit.

### Q: Why is checking safety cheap but checking liveness expensive?

> **Testing:** Understanding the algorithmic asymmetry.

**A.** **Safety** (`[]Invariant`) is a *per-state* check: as TLC discovers each state it evaluates the predicate and stops if it's false. That's linear in the number of states and needs essentially no extra bookkeeping. **Liveness** is a *whole-behavior* property — it's about infinite executions — so TLC can't decide it state-by-state. It must build the behavior graph and search for a **"lasso": a cycle of states that violates the property** (e.g. a loop where the awaited event never occurs), respecting fairness. That requires a different, more expensive graph analysis (roughly, finding strongly-connected components / accepting cycles) and far more memory, and it interacts with fairness constraints. Practical upshot: people often run safety checks routinely in CI and liveness checks less often, on smaller models — and a common technique is to encode a liveness intuition as a safety invariant where possible.

### Q: How do you read a TLC error trace?

> **Testing:** Whether you've actually debugged with the tool.

**A.** A TLC counterexample is a **sequence of states**, each labeled with the **action** that produced it, ending at the state that violates the invariant (or the start of the violating cycle for liveness). You read it like a debugger stepping through the execution: state 1 is an initial state, and each subsequent state shows *which action fired* and the resulting variable values, so you can see exactly the interleaving that breaks the property — "node A sent, node B crashed before acking, node A retried, now both think they hold the lock." Because TLC does BFS, the trace is the *shortest* such path, which keeps it readable. For liveness, the trace shows a finite prefix plus a **loop** ("back to state N") representing the infinite behavior where the good thing never happens. The skill is mapping each state transition back to a line of your spec — the trace is a *concrete, minimal reproduction* of a design bug, which is exactly what makes it more valuable than a failing test.

---

## Practice & Scenarios

### Q: Tell me about the Amazon TLA+ story and what it demonstrates.

> **Testing:** Industrial credibility — do you know *the* canonical success and the right lessons.

**A.** Amazon engineers used TLA+ on core services and, most famously, found a **bug in DynamoDB's replication and fault-tolerant background processes that required a 35-step sequence of events** to trigger — far beyond what any test suite or human review would find, and a bug that could have caused data loss. They documented this in the CACM paper *"How Amazon Web Services Uses Formal Methods."* The lessons that matter for the interview: (1) the value was in modeling the **design before/around implementation**, catching deep concurrency bugs cheaply; (2) it was used for **"what-if" exploration** — engineers changed the spec to test optimizations and proposed designs without building them; (3) it scaled to *real* engineers, not just PhDs, especially via PlusCal; and (4) it found bugs *and* gave engineers the confidence to make aggressive optimizations they'd otherwise have feared. The cautionary half: it verifies the *model*, so they still needed conformance/property testing to tie model to code.

### Q: What's worth modeling in TLA+, and what isn't?

> **Testing:** Engineering judgment — the difference between a zealot and someone who ships.

**A.** Model the things where the *design* is subtle and the *cost of being wrong is high*: concurrent and distributed algorithms, replication and consensus, failover and recovery logic, anything with tricky interleavings of failures and retries, state machines that must maintain a non-obvious invariant. These are exactly where human intuition fails and where a bug is expensive or data-losing. **Don't** model straight-line business logic, CRUD, UI flows, or code whose correctness is obvious from inspection — the spec would just restate the code and add no insight. The heuristic: *if you can't convince yourself the design is correct by careful thought, and the blast radius is large, spec it.* TLA+ buys the most where concurrency × consequences is highest; everywhere else, tests are cheaper and sufficient.

### Q: How do you decide the atomicity / abstraction level of a spec?

> **Testing:** The single most consequential modeling decision — and a PlusCal-specific subtlety.

**A.** Atomicity is *the* judgment call, because **what you make atomic determines which bugs you can find**. In PlusCal, atomicity is set by **labels**: everything between two labels executes as one indivisible step. Make a step too *coarse* (too few labels) and you hide real interleavings — you might lump "read balance" and "write balance" into one atomic action and thereby make a lost-update race *impossible to express*, so TLC reports no bug that genuinely exists in the finer-grained code. Make it too *fine* and you explode the state space and may model interleavings that the real hardware/runtime makes atomic anyway. The right level is "as fine as the *real system's* atomic boundaries" — a single memory read, one network send, one disk write — for the parts the property depends on, and coarser elsewhere. The discipline: split into separate atomic steps exactly at the points where *another process can observe or interleave*. Getting this wrong is how a passing spec misses a real bug.

### Q: You verified the model. How do you connect that to the actual code?

> **Testing:** The honesty to admit the model-code gap and the techniques that bridge it.

**A.** TLA+ verifies the **model**, not the implementation — there's no automatic link between your spec and your Go/Java/Rust, so a spec can be perfect while the code diverges from it. You close the gap with techniques that *check the running code against the model*: **conformance testing** / **trace validation** — instrument the implementation to log its state transitions, then check that the observed traces are behaviors the spec allows (Amazon and others do exactly this; it's how you catch "the code does something the model doesn't"). **Property-based / generative testing** complements this by exercising the code with the invariants the spec proved. And you keep the spec a **living document** that's updated as the design changes, rather than a one-shot artifact that rots. The mature stance: the spec proves the *design* is sound; conformance/property tests give evidence the *code implements that design*. Claiming the spec proves the code correct is the overclaim that fails the interview.

### Q: Scenario — model a distributed lock. State one safety and one liveness property.

> **Testing:** Can you actually do the core task end to end and classify the properties.

**A.** Model: a set of clients and a lock holder. State includes `holder` (the client currently holding the lock, or `NoOne`) and each client's `pc` (e.g. `"idle"`, `"waiting"`, `"holding"`). Actions: `Acquire(c)` — enabled when `holder = NoOne`, sets `holder = c` and `c`'s pc to `"holding"`; `Release(c)` — enabled when `holder = c`, sets `holder = NoOne`. Then:

- **Safety — mutual exclusion:** at most one client holds the lock.
  ```tla
  Safety == [] (Cardinality({c \in Clients : pc[c] = "holding"}) <= 1)
  ```
- **Liveness — no starvation:** every waiting client eventually holds the lock.
  ```tla
  Liveness == \A c \in Clients : (pc[c] = "waiting") ~> (pc[c] = "holding")
  ```

And I'd note the liveness one needs **fairness** — and likely **strong** fairness on `Acquire`, because a waiting client competes for the lock and can lose the race repeatedly (enabled infinitely often, not continuously), exactly the SF case. Stating that unprompted is the senior signal.

### Q: Scenario — TLC says "no errors found." What could still be wrong?

> **Testing:** The most important scenario on this page — humility about what a green check means.

**A.** "No error" is *not* "correct." Half a dozen things can make it hollow:

1. **Constants too small.** The bug needs 4 nodes and you modeled 3, or it needs a queue of 3 and you bounded at 2. You proved correctness of a model too small to contain the bug.
2. **Vacuous / vacuously-true property.** A `~>` whose left-hand side is never satisfiable (`Pending(r)` is never true in your model) passes trivially — it asserts nothing. (Tools can warn; you should sanity-check that the antecedent actually occurs.)
3. **Wrong atomicity.** You made a step too coarse, so the racy interleaving that breaks the real code can't even be expressed in the model.
4. **Over-asserted fairness.** You assumed `SF` on actions the real scheduler doesn't guarantee, assuming away the very starvation the liveness property was meant to catch.
5. **The model isn't the code.** The spec is correct but the implementation diverges from it — the model-code gap.
6. **A missing `UNCHANGED` or a too-permissive `Init`** that makes the model explore the wrong states, or a property that's weaker than you think.

The right answer names several of these *and* the remedy: grow the constants until you're confident, verify the antecedents of leads-to properties actually occur, double-check atomicity against the real system's boundaries, assert the *weakest* honest fairness, and tie model to code with conformance tests. A green TLC run is "no bug *in this model, at this scope, under these assumptions*" — and saying exactly that is the point.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: What does `x'` mean?** A: The value of `x` in the *next* state (a primed variable); unprimed is the current state.
- **Q: `[]` vs `<>`?** A: `[]P` = P always holds (safety); `<>P` = P eventually holds (liveness).
- **Q: What is `~>`?** A: "Leads to" — `P ~> Q` is `[](P => <>Q)`: every time P holds, Q eventually follows.
- **Q: `[]<>` vs `<>[]`?** A: `[]<>` = infinitely often; `<>[]` = eventually-and-then-permanently (stabilization).
- **Q: Safety or liveness needs fairness?** A: Only liveness — safety is violated by a finite prefix, liveness by the do-nothing (stuttering) behavior that fairness rules out.
- **Q: WF vs SF in one line?** A: WF requires the action to fire if *continuously* enabled; SF if enabled *infinitely often* (flickering enabledness).
- **Q: What does `UNCHANGED <<x,y>>` mean?** A: `x' = x /\ y' = y` — pins variables an action doesn't touch (the frame).
- **Q: What is stuttering?** A: A step where variables don't change; `[Next]_vars` permits it, which is what makes refinement work.
- **Q: TLC's search strategy?** A: Breadth-first over reachable states, storing 64-bit fingerprints — so traces are the shortest path to a violation.
- **Q: TLA+ — LTL or CTL?** A: Linear-time (LTL-style) — properties over single behaviors, no `A`/`E` path quantifiers.
- **Q: PlusCal labels determine what?** A: Atomicity — code between two labels is one indivisible step.
- **Q: One way to shrink a state space?** A: `SYMMETRY` for interchangeable processes (often an N!-fold cut); also smaller constants and a `CONSTRAINT`.
- **Q: TLC vs Apalache?** A: TLC enumerates states (explicit); Apalache is symbolic (SMT) and can prove inductive invariants for unbounded runs.
- **Q: What's a refinement mapping?** A: Defining the abstract spec's variables as functions of the concrete ones, so you can check `Impl => Spec`.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Saying "TLA+ proves my *code* is correct" — conflating model and implementation.
- Calling a green TLC run "done" with no mention of constant size, vacuity, or atomicity.
- Mixing up `[]<>` and `<>[]`, or not knowing `~>` is `[](P => <>Q)`.
- Claiming liveness without ever mentioning fairness — or slapping `SF` on everything.
- Treating TLC running out of memory as "need a bigger machine" instead of "shrink the model."
- Not knowing PlusCal compiles to TLA+ (thinking they're separate tools).
- Forgetting `UNCHANGED` and being unaware that omitting it breaks the model.

**Green flags:**

- Naming the *distinction* (state/behavior, safety/liveness, model/code) before reaching for syntax.
- Classifying a requirement as safety or liveness, and noting only the latter needs fairness.
- Reaching for `SYMMETRY` and a state `CONSTRAINT` before asking for more hardware.
- Citing the Amazon 35-step DynamoDB bug as the canonical industrial success — and the model-code caveat with it.
- Recognizing the strong-fairness case (an action that competes and loses the race repeatedly).
- Listing the ways "no error" can be hollow (too-small constants, vacuous property, wrong atomicity, over-asserted fairness, model ≠ code).
- Treating atomicity/labels as the decision that determines which bugs are findable.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **State / Action / Behavior** | Variable snapshot / relation on current+next state (`x' = x+1`) / infinite sequence of states. |
| **`Spec`** | `Init /\ [][Next]_vars /\ Fairness`. |
| **`[]P`** | Always P — safety. Cheap (per-state) in TLC. |
| **`<>P`** | Eventually P — liveness building block. |
| **`P ~> Q`** | Leads to: `[](P => <>Q)`. "Every request eventually answered." |
| **`[]<>P`** | Infinitely often (recurrence / fairness shape). |
| **`<>[]P`** | Eventually permanent (stabilization / convergence). |
| **Safety vs liveness** | "Nothing bad ever" (finite-prefix violation) vs "something good eventually" (needs fairness). |
| **WF_vars(A)** | Fire A if *continuously* enabled. |
| **SF_vars(A)** | Fire A if enabled *infinitely often* — for actions that lose the race repeatedly. |
| **`UNCHANGED v`** | `v' = v` — the frame; omit it and the model explodes into nonsense. |
| **Stuttering** | A do-nothing step; `[Next]_vars` allows it → enables refinement. |
| **Refinement** | `Impl => Spec`, via a refinement mapping (abstract vars as functions of concrete). |
| **Inductive invariant** | `Init => Inv` and `Inv /\ Next => Inv'` — needed for TLAPS/Apalache proofs. |
| **TLC** | Explicit-state BFS, fingerprints, shortest trace; bound with small constants. |
| **State-explosion levers** | Small constants → `SYMMETRY` → `CONSTRAINT` → coarser atomicity → more workers/Apalache. |
| **Apalache** | Symbolic (SMT) — bounded checking + inductive-invariant proofs; needs type annotations. |
| **PlusCal** | Pseudocode that compiles to TLA+; **labels = atomic steps**. |
| **"No error" caveats** | Too-small constants, vacuous property, wrong atomicity, over-asserted fairness, model ≠ code. |

---

## Summary

- The bank reduces to four distinctions in costumes: **state vs behavior**, **safety vs liveness**, **model vs code**, **green check vs proof**. Name the distinction first; the syntax follows.
- **Fundamentals:** TLA+ specifies a *design* as a state machine in math; TLC explicitly explores every reachable state of a *finite model* and returns a counterexample or a (bounded) pass. PlusCal is pseudocode that compiles to TLA+, and its **labels define atomicity**.
- **Temporal logic** is the differentiator: `[]` (always/safety), `<>` (eventually), `~>` (leads-to); `[]<>` (infinitely often) vs `<>[]` (stabilization). TLA+ is linear-time (LTL-style), not branching CTL.
- **Fairness** exists because liveness is violated by the stuttering do-nothing behavior; **weak** fairness covers continuously-enabled actions, **strong** fairness covers actions enabled infinitely often (the lose-the-race case). Over-asserting fairness makes liveness vacuously pass.
- **Structure & semantics:** `Init /\ [][Next]_vars /\ Fairness`; `UNCHANGED` is the frame; stuttering enables **refinement** (`Impl => Spec` via a mapping); inductive invariants underpin proofs.
- **Scale:** TLC is explicit-state BFS with fingerprinting — fight state explosion with small constants, `SYMMETRY`, and `CONSTRAINT` *before* hardware; reach for **Apalache** (symbolic) for inductive proofs. Safety is cheap (per-state); liveness is expensive (cycle search).
- **Practice:** the Amazon 35-step DynamoDB bug is the canonical win; model where concurrency × consequences is high; you verify the **model**, so pair with conformance/property tests and keep the spec living. "TLC found no error" means "no bug *in this model, at this scope, under these assumptions*" — and a great candidate says exactly that.

---

## Further Reading

- *Practical TLA+* — Hillel Wayne. The fastest on-ramp; PlusCal-first, example-driven, written for working engineers. Pair with his free **Learn TLA+** online guide.
- *Specifying Systems* — Leslie Lamport. The authoritative reference from TLA+'s creator: temporal logic, the semantics of `[][Next]_vars`, refinement, and TLC. Free PDF.
- *"How Amazon Web Services Uses Formal Methods"* — Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff (CACM, 2015). The industrial case study, including the 35-step DynamoDB bug and conformance practices.
- The [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), and [professional.md](professional.md) pages of this topic — every answer here is grounded in those.
- The TLA+ Toolbox, the **`tlaplus/Examples`** repository, and the **Apalache** docs — primary sources for the tooling these answers reference.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/interview.md) — what a spec *is*, and the spec-vs-tests and refinement ideas TLA+ builds on.
- [02 — Model Checking](../02-model-checking/interview.md) — the general theory (safety/liveness, state explosion, counterexamples) that TLC instantiates.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md) — the conformance/property-testing layer that ties a verified model to running code.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/interview.md) — the ROI judgment for *whether* a given system is worth specifying.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the consensus, replication, and failover protocols TLA+ is most often used to verify.
