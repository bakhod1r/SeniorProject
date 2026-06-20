# Formal Specification — Interview Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Formal Specification
> *A formal-methods interview rarely asks "what is a theorem." It asks "specify a money transfer and tell me the one invariant you'd never let break," and then watches whether you can separate a spec from a test, safety from liveness, and a verified model from correct code. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Notations & Properties](#notations--properties)
5. [Refinement & the Spec–Code Gap](#refinement--the-speccode-gap)
6. [Practice & Judgement](#practice--judgement)
7. [Scenario Exercises](#scenario-exercises)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **spec vs test** (a universal claim over all behaviors vs a probe of one behavior)
- **safety vs liveness** (nothing bad happens vs something good eventually happens)
- **model vs code** (the verified abstraction vs the artifact that ships — the *gap*)
- **bounded check vs proof** (no counterexample up to size N vs no counterexample, period)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a tool name like "TLA+" or "Alloy."

---

## Prerequisites

You should be comfortable with: basic predicate logic (∀, ∃, implication), set and relation notation, the idea of a state machine (states + transitions), and ordinary software testing. You do *not* need to have written a proof in Coq or run a model checker — the interview tests whether you can *think* in specifications and judge *when* they're worth the cost, not whether you've memorized a tool's syntax. Where a tool appears (TLA+, Alloy, Z), it's used to make an idea concrete, not as the point.

---

## Fundamentals

### Q: What is a formal specification, and how is it different from a test or a prose requirement?

> **Testing:** The foundational distinction. Do you see a spec as a *universal claim*, or just "documentation with symbols"?

**A.** A **formal specification** is a description of *what* a system must do, written in a language with **precise mathematical semantics** — so it has exactly one meaning and can be analyzed by a machine. The three differ in what they *claim* and what *checks* them:

- A **prose requirement** ("transfers must be atomic") is read by humans; ambiguity is resolved by argument, and nothing checks it.
- A **test** is an *existential probe*: "for *this* input, the output is *that*." It demonstrates the system works on the examples you thought of.
- A **formal spec** is a *universal claim*: "for *all* states/inputs satisfying the precondition, the postcondition holds." A tool (model checker or prover) tries to *refute* it across the whole modeled state space.

The shift is from "I checked some cases" to "I stated a property over *all* cases and something tried to break it." A test can only find bugs in the examples present; a spec, checked, finds bugs in cases no one wrote down — which is the whole point.

### Q: People say "writing the spec finds the bug." What does that actually mean?

> **Testing:** Whether you understand the highest-ROI part of formal methods is often the *writing*, before any tool runs.

**A.** Two effects, and the first is usually bigger than the second.

1. **The act of writing forces precision.** To state a postcondition you must answer questions prose let you skip: *What's the invariant? What happens on the empty case? Can these two events interleave?* Most "specs find bugs before the tool runs" stories are an engineer realizing, mid-spec, that two requirements contradict, or that an edge case was never decided. Amazon's well-known result was that writing TLA+ specs surfaced design flaws *during specification*, not only during checking.
2. **Then the tool finds the bugs you can't see.** Once written, a model checker explores interleavings and corner states a human can't enumerate — the 14-step concurrent sequence that violates an invariant. This catches *design* bugs, in the logic, before a line of production code exists.

So the value isn't only the green check at the end; it's that a spec is a thinking tool that makes vagueness impossible to sustain. The summary engineers repeat: *the bug is usually in the part you didn't bother to specify.*

### Q: Define preconditions, postconditions, and invariants. How do they relate?

> **Testing:** The vocabulary of contracts — and whether you know an invariant is the load-bearing one.

**A.**
- A **precondition** is what must hold *before* an operation for it to be obligated to behave (`transfer` requires `amount > 0 ∧ from.balance ≥ amount`). It's an obligation on the *caller*.
- A **postcondition** is what the operation guarantees *after*, given the precondition held (`from.balance' = from.balance − amount ∧ to.balance' = to.balance + amount`). It's an obligation on the *implementation*.
- An **invariant** is a property true in *every* reachable state — before and after every operation (`sum of all balances = constant`). It's a property of the *whole system over time*.

They compose: each operation, assuming its precondition and the invariant, must re-establish the invariant in its postcondition. The invariant is usually the most valuable artifact — it's the single sentence that captures "the system is sane," and most safety bugs are an operation that quietly breaks it (here, money created or destroyed). Get the invariant right and many postconditions follow.

> Convention: a primed variable (`balance'`) denotes its value in the *next* state. This "unprimed = now, primed = next" notation is standard in TLA+ and worth using even on a whiteboard.

### Q: Define safety and liveness, with one concrete example of each.

> **Testing:** The single most important property classification — and whether you confuse the two.

**A.** They split *every* temporal property into two kinds:

- **Safety — "nothing bad ever happens."** If violated, there's a *finite* prefix of behavior that witnesses it; you can point at the exact step where it broke. Examples: *mutual exclusion* (two threads never in the critical section at once), *no money created* (total balance constant), *a sent message is never delivered twice*.
- **Liveness — "something good eventually happens."** Violated only by an *infinite* behavior (it never happens, ever); no finite prefix proves it broken. Examples: *every request eventually gets a response*, *a process waiting for the lock eventually acquires it* (no starvation), *the election eventually chooses a leader*.

The practical test: *Could a single screenshot of the run prove the bug?* If yes, it's safety (two threads in the critical section — caught in one frame). If you'd need to prove "this never happens no matter how long you wait," it's liveness. A useful mnemonic: a program that does *nothing* satisfies every safety property (nothing bad happens) but violates every interesting liveness one (nothing good happens either) — which is exactly why you need both.

### Q: If a system never does anything, which properties does it satisfy? Why does that matter?

> **Testing:** Whether you truly grasp safety vs liveness, via the classic edge case.

**A.** A do-nothing system satisfies *all* safety properties and violates *all* nontrivial liveness ones. Safety says "nothing bad happens" — and nothing happening means nothing bad happens, trivially. Liveness says "something good eventually happens" — and nothing good ever does. This matters because it proves the two are independent: you cannot get correctness from safety alone, or you'd "prove correct" a server that accepts no connections. Real specs need *both* — safety to forbid bad states, liveness to require progress. It's also why a spec with only safety properties is a common, dangerous gap: it'll happily certify a deadlocked system.

---

## Notations & Properties

### Q: State-based (Z/VDM/B), relational (Alloy), temporal (TLA+) — when does each fit?

> **Testing:** Whether you match the notation to the *shape* of the problem, instead of reaching for one favorite tool.

**A.** They model different things well:

| Family | Models | Best for | Tooling style |
|---|---|---|---|
| **State-based** (Z, VDM, B) | System state as typed sets/functions; ops as pre/post predicates | Data-rich specs, a single component's operations, sequential refinement to code (B) | Proof-oriented (B's Atelier B), some animation |
| **Relational** (Alloy) | Everything as relations over atoms; structural constraints | Structural/data-model questions — "can this configuration exist?", schemas, security models, ownership graphs | Bounded SAT-backed check (the Analyzer) |
| **Temporal** (TLA+) | A state machine + properties over *infinite behaviors* | Concurrency and distribution — interleavings, protocols, "what sequences of states are allowed" | Model checking (TLC) + proof (TLAPS) |

The decision: *Is your hard question about a static structure, or about behavior over time?* Alloy shines at "is there a configuration that violates this?" — one snapshot. TLA+ shines at "is there an *execution* that violates this?" — a sequence of states, which is the natural fit for concurrency. State-based methods like B shine when you intend to *refine the spec down to code* with proof obligations at each step. Picking the family that matches the question is itself a senior signal.

### Q: What is the small-scope hypothesis, and what does it cost you?

> **Testing:** The core idea behind bounded analysis — and whether you know its limit honestly.

**A.** The **small-scope hypothesis** (Jackson) is the empirical claim that *most bugs have small counterexamples* — if a property is wrong, you'll usually find a violating instance within a small bound (say, ≤ 5 objects of each type). Alloy is built on it: it exhaustively checks *all* configurations up to a finite scope by compiling to SAT. The payoff is enormous: fully automatic, no proof effort, and a concrete counterexample you can see.

The cost is honesty about what you proved. A clean run means **"no counterexample exists within this scope"** — *not* "the property is true." A bug needing 6 nodes when you checked 5 slips through. So bounded analysis gives you cheap, high *confidence*, not a proof. The discipline is to *state the scope*, push it as high as time allows, and never report a green Alloy run as "verified." It's a bug-*finder* of remarkable power, not a theorem prover.

### Q: Bounded model checking versus proof — what's the real difference, and when do you want each?

> **Testing:** The distinction between "no counterexample up to N" and "no counterexample, ever."

**A.** **Bounded analysis** (Alloy's scopes, model checking up to a depth/state-count) explores a *finite* slice of the state space and is fully automatic; a clean result means "no violation found *within these bounds*." **Proof** (TLAPS, Coq, Isabelle, Dafny) establishes the property holds for *all* states and *all* sizes — unbounded — but requires human effort to guide the prover (especially finding the inductive invariant).

When to want each:
- **Bounded / model checking** — almost always *first*. It's automatic, finds the overwhelming majority of design bugs fast, and hands you a concrete counterexample trace to debug. For most industrial work this is the whole engagement.
- **Proof** — when the cost of *any* residual bug is catastrophic and unbounded (a cryptographic protocol, a consensus core, a CPU's memory model, an OS microkernel like seL4), or when the state space is genuinely infinite and no bound suffices. You pay weeks-to-months of expert time for the unbounded guarantee.

The pragmatic stance: model-check to find bugs cheaply; prove only the small, critical kernel where bounded confidence isn't enough. Most teams never need full proof, and reaching for it first is a classic over-investment.

### Q: What are specification patterns? Name a few and why they matter.

> **Testing:** Whether you know the reusable vocabulary so you don't reinvent temporal logic each time.

**A.** **Specification patterns** (Dwyer, Avrunin, Corbett) are a catalogue of the temporal properties that recur in practice, so you don't have to derive each one from raw logic. The common ones:

- **Absence** — "P never holds" (a bad state is unreachable). *No two threads in the critical section.*
- **Universality / Invariance** — "P always holds." *Balance is always non-negative.*
- **Existence** — "P eventually holds." *The system eventually reaches `ready`.*
- **Response** — "if P happens, Q eventually follows." *Every request eventually gets a response.* (The workhorse liveness pattern.)
- **Precedence** — "Q is preceded by P" / "P must happen before Q." *A resource is acquired before it's released; a file is opened before it's read.*

Each pattern also has a **scope**: globally, before R, after Q, between Q and R. They matter because they (1) are a *checklist* — scanning the list reminds you to ask "what's the response property here? the precedence?", surfacing missing requirements; and (2) translate to ready-made temporal-logic formulas, so you write `Response(req, resp)` instead of fumbling nested `□◇` operators. They're the design-patterns book of formal specs.

---

## Refinement & the Spec–Code Gap

### Q: What is refinement?

> **Testing:** Whether you understand the formal link between an abstract spec and a concrete one.

**A.** **Refinement** is a *correctness-preserving* step from a more abstract specification to a more concrete one, such that every behavior of the concrete model is *permitted* by the abstract model. You prove the concrete *implements* the abstract: the abstract used a mathematical set for "the accounts"; the refinement uses a hash map and a B-tree index, and you discharge proof obligations showing the concrete operations *simulate* the abstract ones under a mapping (the **abstraction/refinement relation**) between concrete and abstract states.

The point is a *verified ladder*: abstract spec (easy to reason about, obviously correct) → refined design (closer to implementation) → … → code, where each rung is proved to preserve the rung above. The B method is built entirely around this — you refine until the spec is concrete enough to mechanically generate code, with proofs at every step (this is how the Paris Métro Line 14 signaling was built). Refinement is the formal answer to "how does a high-level spec become trustworthy low-level code?"

### Q: I verified my spec. Does that mean my code is correct? (The differentiator.)

> **Testing:** The single most important judgement in this topic — the spec–implementation gap. Get this wrong and you've oversold formal methods.

**A.** **No.** Verifying a spec proves the *model* is correct, not the *code*. There is always a **spec–implementation gap**: the spec is an abstraction in TLA+ or Alloy; the code is C or Go that someone *hand-translated* from it, and that translation can introduce bugs the spec never saw. Verifying the spec rules out *design* bugs (the algorithm is wrong); it says nothing about *implementation* bugs (the algorithm is right but the code has an off-by-one, a missed lock, an integer overflow the model abstracted away).

Two further gaps even if the code matches the spec perfectly:
- **Modeling gap** — the spec abstracted reality. You modeled the network as reliable; production drops packets. The spec is correct *about a world that isn't yours*.
- **Assumption gap** — you assumed the compiler, the hardware memory model, the libraries behave; if they don't, the proof's premises fail.

The mature framing: a verified spec moves the bugs from "design errors" (the expensive, subtle ones) to "transcription and assumption errors." That's a *huge* win, but claiming "verified spec ⟹ correct system" is the error that discredits the whole practice.

### Q: So how do you actually bridge the spec–code gap?

> **Testing:** Whether you know the toolbox, not just that a gap exists. The follow-up that separates "read a blog post" from "done it."

**A.** Four techniques, roughly in increasing strength and cost:

1. **Refinement proof / verified implementation** — prove the code refines the spec (B method, Dafny, F\*, or a Coq development as in CompCert/seL4). Strongest; closes the gap by construction, but expensive and limited to a small kernel.
2. **Code generation** — generate code *from* the verified spec (B's code generators) so there's no manual transcription to get wrong. Strong, but you must then trust the generator and the runtime.
3. **Conformance / property-based testing against the spec** — derive a test oracle from the spec and run it against the real implementation. The spec becomes the source of truth; property-based testing (QuickCheck-style) or model-based testing checks that the code's observable behavior matches the model's. This is the *highest-ROI* bridge for most teams — it doesn't prove equivalence but cheaply catches divergence on real executions.
4. **Runtime monitors** — compile the spec's invariants/temporal properties into assertions or a monitor that runs *in production* and screams when the live system violates the modeled property. Catches modeling-gap and assumption-gap failures the static analysis structurally couldn't.

The pragmatic stack most teams should use: **model-check the design** (kills design bugs) + **property-based test the implementation against the spec** (kills transcription bugs) + **runtime-assert the key invariants** (catches the modeling/assumption gaps). Full refinement proof is reserved for the rare critical core.

### Q: What are over-specification and under-specification, and why are both dangerous?

> **Testing:** Whether you can calibrate a spec — too tight and too loose both bite.

**A.**
- **Under-specification** leaves behavior undefined where it matters. The spec says nothing about concurrent transfers, so it permits an implementation that loses money under interleaving — and the spec *certifies* it because the bad case was never constrained. The risk: a green check that means nothing because the dangerous behavior was outside the spec.
- **Over-specification** pins down *more* than required — it bakes in *how* instead of *what*. The spec mandates "process requests in FIFO order" when the real requirement was only "every request is eventually served." Now correct implementations (a priority queue, a sharded handler) are rejected as violating the spec, you lose design freedom, and the spec becomes brittle to legitimate change.

The craft is specifying *exactly* the required behavior — every safety/liveness property that matters, and *nothing about mechanism that doesn't*. Deliberate under-specification (leaving genuinely free choices free, e.g. "any of the valid leaders may be chosen") is good and intentional; *accidental* under-specification (forgetting concurrency) is a hole. Knowing which you're doing is the skill.

### Q: What is a vacuous specification, and how would you catch one?

> **Testing:** The "it passes for the wrong reason" failure — the most embarrassing and most common.

**A.** A property is **vacuously true** when it passes because its premise is *never satisfied*, not because the system is correct. The classic shape is `P ⟹ Q` where `P` never holds: "every time the buffer overflows, we alert" passes trivially if the buffer can *never* overflow in your model. You think you verified the alerting logic; you verified nothing, because the antecedent was unreachable. A whole spec can be vacuous if it's **inconsistent** (the constraints contradict, so there are *no* valid states, and every property holds over an empty set).

How to catch it:
- **Sanity / liveness checks** — assert that the interesting states *are* reachable (`◇BufferFull` should be *satisfiable*, not provable-false). If the checker says "no behavior ever reaches BufferFull," your `P ⟹ Q` was vacuous.
- **Run the spec / animate it** — Alloy: ask for an *instance* (`run`), not just a `check`. If `run` finds *no* model, your spec is inconsistent — a dead giveaway. TLA+: check that the spec isn't deadlocked and that key states appear in the trace.
- **Deliberately inject a violation** — temporarily break the implementation and confirm the property *fails*. If a property never fails no matter what you do to the model, it's not testing anything.

The discipline mirrors mutation testing for code: a spec that *can't fail* is as worthless as a test that can't fail. Always confirm your properties are *falsifiable* and your antecedents *reachable*.

---

## Practice & Judgement

### Q: What is "lightweight formal methods," and how do you justify the ROI to a skeptical manager?

> **Testing:** Whether you can sell formal methods as an engineering investment, not an academic indulgence.

**A.** **Lightweight formal methods** means applying formal *specification and bounded checking* to the *riskiest slice* of a system — not proving the whole thing, just model-checking the one protocol or data model where a bug is catastrophic. Alloy and TLA+ are the canonical lightweight tools: days of effort, automatic checking, concrete counterexamples — no months of proof.

The ROI pitch is **expected cost avoided**: `P(subtle bug) × cost(bug in production)`. For a payments ledger, a consensus protocol, or a permissions model, the cost of one subtle concurrency bug — data corruption, a breach, a multi-day incident — dwarfs the few engineer-days a TLA+ spec costs. Amazon's report is the standard citation: TLA+ found serious bugs in S3 and DynamoDB *that testing had missed*, in systems already in production, and the specs paid for themselves on the first bug. The framing for the manager: it's not "prove everything," it's "spend three days to make the worst possible bug in our most critical component *impossible by design*." You scope it to where blast radius justifies the spend.

### Q: How do you decide what's worth formally specifying?

> **Testing:** Triage. Formal methods everywhere is as wrong as nowhere.

**A.** Specify where the **blast radius is high and human intuition is weakest**. Concretely, the high-value targets:

- **Concurrency and distribution** — interleavings and partial failures defeat human reasoning and testing; this is where model checking earns its keep most reliably (locks, consensus, replication, cache coherence).
- **Security and access-control models** — "can a user ever reach a resource they shouldn't?" is a structural question Alloy answers exhaustively; a single hole is a breach.
- **Core invariants of irreplaceable state** — the ledger that must never lose money, the inventory that must never go negative, the allocator that must never double-free.
- **Protocols with many parties or versions** — handshakes, migrations, anything where the *interaction* is the hard part.

*Don't* formally specify CRUD endpoints, UI layout, or logic that's simple enough to read and well-covered by ordinary tests — the spec costs more than the bugs it'd find. The rule of thumb: *if you can't convince yourself it's correct by reading it, and getting it wrong is expensive, specify it; otherwise test it.* Reserving formal effort for the small high-stakes core is the senior judgement.

### Q: How do formal specs relate to property-based testing and to contracts (DbC)?

> **Testing:** Whether you see the continuum from spec to runnable check, not three unrelated tools.

**A.** They're points on one continuum — *state a property, then check it with progressively more/less rigor*:

- A **formal spec** states a property and checks it against a *model* (exhaustively or by proof). No real code runs.
- **Property-based testing** (QuickCheck, Hypothesis) states the *same kind* of property — an invariant or postcondition — and checks it by generating many random inputs against the *real code*. It's a spec you run against the implementation; weaker than proof (samples, doesn't exhaust) but it tests the actual artifact, directly bridging the spec–code gap. A spec's invariant *becomes* a property-based test almost mechanically.
- **Design by Contract** (Eiffel, and `assert`/`requires`/`ensures` elsewhere) embeds preconditions, postconditions, and invariants *in the code* as runtime-checked assertions. It's the spec made executable and *always on* — the same pre/post/invariant vocabulary, enforced at run time.

The throughline: **the property is the asset**; the spec, the property-based test, and the contract are three enforcement strengths of the *same* statement (model-check it, fuzz it against code, assert it at runtime). A strong engineer writes the invariant once and pushes it into all three. That's also the most practical way to keep a spec honest — derive the property test from it so divergence is caught automatically.

### Q: What is spec rot, and how do you keep a specification trustworthy over time?

> **Testing:** Whether you treat a spec as a living artifact or a one-time document that lies within a quarter.

**A.** **Spec rot** is the spec drifting out of sync with the implementation: the code evolves, the spec doesn't, and now it describes a system that no longer exists. A stale spec is *worse* than none — it confidently misleads, and people make decisions against a fiction. It's the same failure as out-of-date documentation, with higher stakes because people *trust* a formal artifact more.

Defenses:
- **Tie the spec to CI** — check the spec on every change to the relevant component (model-check in the pipeline), and *fail the build* if it breaks. A spec that's checked automatically can't silently rot.
- **Derive tests from the spec** — when the implementation diverges, the spec-derived property tests fail, forcing someone to reconcile spec and code rather than letting them drift.
- **Scope it small** — a tight spec of the *critical core* is maintainable; a sprawling spec of the whole system rots fastest because no one keeps it current. Specify less, but keep that less *alive*.
- **Make it part of "definition of done"** for changes to the specified component — change the code, change the spec, in the same PR.

The honest stance: a spec is *code*, with the same maintenance burden. If you can't commit to keeping it current, scope it down to the piece you *will* maintain.

---

## Scenario Exercises

> "Design a spec for X" is the staple senior/staff exercise. The interviewer wants: the **invariant**, one **safety** property, one **liveness** property, and *how you'd check it* (Alloy vs TLA+). Talk through the modeling decisions out loud — that's what's being graded.

### Q: Specify a bounded stack (capacity N). Give the invariant, a safety property, a liveness property, and how you'd check it.

> **Testing:** Can you model the simplest possible data structure cleanly before tackling concurrency?

**A.** **State:** a sequence `items` and a constant capacity `N`.

- **Invariant:** `0 ≤ Len(items) ≤ N` — size is always within bounds. (The load-bearing one for a *bounded* stack.)
- **Operations & their pre/post:**
  - `push(x)` — pre: `Len(items) < N`; post: `items' = items ∘ ⟨x⟩`.
  - `pop()` — pre: `Len(items) > 0`; post: `items' = Front(items)` and returns `Last(items)`.
- **Safety property:** *LIFO order is preserved* — `pop` always returns the most recently pushed not-yet-popped element. Plus the no-overflow/no-underflow guarantee the preconditions encode (`push` never exceeds `N`, `pop` never empties past zero).
- **Liveness property:** for a *concurrent* stack, *every `push` that satisfies its precondition eventually completes* (no thread waits forever to push when there's room) — a Response/no-starvation property. For a sequential stack, liveness is trivial.
- **How to check:** sequential and data-structural → this is naturally a **state-based** spec; you can model it in TLA+ and let **TLC** check the invariant and LIFO ordering across operation sequences, or in Alloy if you frame "is there a sequence of ops that violates LIFO within scope?" The bounded-overflow case is exactly what a checker confirms automatically.

### Q: Specify a money transfer between two accounts. What's the one invariant you'd never let break?

> **Testing:** The canonical exercise. The interviewer wants "conservation of money" *instantly*, then concurrency awareness.

**A.** **State:** a function `balance : Account → ℕ` (non-negative integers — money doesn't go negative).

- **The invariant you never break — conservation:** `sum of all balances = constant` (no operation creates or destroys money). This is the single most important property of any ledger, and most real bugs are an operation that quietly violates it (double-credit, lost debit under a race).
- **Operation:** `transfer(from, to, amt)` — pre: `amt > 0 ∧ balance[from] ≥ amt ∧ from ≠ to`; post: `balance' = balance EXCEPT from ↦ balance[from] − amt, to ↦ balance[to] + amt`.
- **Safety property:** *no balance ever goes negative* (`∀ a : balance[a] ≥ 0`) — enforced by the precondition, *and* (the subtle part) preserved under **concurrent** transfers. The interesting bug: two concurrent transfers from the same account each pass the `balance ≥ amt` check, then both debit, overdrawing it. That's the safety violation worth catching.
- **Liveness property:** *every transfer that satisfies its precondition eventually commits* (no transfer is starved forever) — a Response property; relevant once there's locking or a queue.
- **How to check:** the hard part is *concurrency and interleaving*, so this is a **TLA+** problem. Model transfers as atomic-or-not actions, let **TLC** explore all interleavings, and check the conservation invariant and non-negativity. TLC will hand you the exact interleaving that overdraws the account if your locking is wrong — which is the entire reason to spec it instead of testing it.

> The "tell" the interviewer wants: you name **conservation** as the invariant *before* anything else, and you immediately worry about the *concurrent* double-debit rather than the happy path.

### Q: Specify the *safety* of leader election: at most one leader. Sketch it and say how you'd verify.

> **Testing:** Distributed-systems modeling, and crucially that you don't conflate the safety property with the liveness one.

**A.** **State:** a set of `Nodes`, each with a `role ∈ {follower, candidate, leader}` and a `term` (monotonically increasing election number, as in Raft).

- **The safety property (the one asked for):** **at most one leader *per term*** — `∀ n1, n2 ∈ Nodes : (n1.role = leader ∧ n2.role = leader ∧ n1.term = n2.term) ⟹ n1 = n2`. This is an *Absence/uniqueness* invariant: two distinct leaders in the same term is the bad state, and it must be unreachable. (Note the "per term" — split-brain across *different* terms is allowed and normal; the invariant is uniqueness *within* a term, upheld by majority-quorum voting: a node becomes leader only with votes from a majority, and two majorities of the same term must intersect, so they can't both elect.)
- **Invariant supporting it:** each node casts at most one vote per term — the mechanism that makes the quorum argument hold.
- **One liveness property (explicitly *separate*):** *eventually some leader is elected* (`◇ ∃ n : n.role = leader`) — progress. This is the Existence/Response side; it can *only* be guaranteed under fairness/timing assumptions (FLP: you can't have guaranteed liveness *and* safety under fully asynchronous, failure-prone conditions, so liveness here is conditional on partial synchrony).
- **How to verify:** unmistakably **TLA+ / TLC** — it's behavior over time with concurrency, partial failure, and message interleaving, exactly TLA+'s domain (Raft and Paxos both have well-known TLA+ specs). Model the messages and node steps, let TLC check the uniqueness invariant across all interleavings; it'll surface any race where two nodes both think they won.

> The staff-level signal: you state *at most one leader per term* (not the naive "exactly one leader always," which is *false* and unachievable), and you keep the safety invariant rigidly separate from the conditional liveness — because that separation is the whole hard-won lesson of consensus.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Spec vs test in one line?** A: A test probes one behavior (existential); a spec is a universal claim over *all* behaviors that a tool tries to refute.
- **Q: Safety vs liveness in one line?** A: Safety = nothing bad ever happens (finite witness); liveness = something good eventually happens (only an infinite run can violate it).
- **Q: What does a do-nothing program satisfy?** A: All safety properties, no nontrivial liveness ones — which is why you need both.
- **Q: Invariant, in one phrase?** A: A property true in *every* reachable state — usually the most valuable thing in the spec.
- **Q: Alloy in one line?** A: Bounded, SAT-backed exhaustive check of *structural* properties up to a finite scope.
- **Q: TLA+ in one line?** A: A state machine plus temporal properties over infinite behaviors; checked by TLC, the tool for concurrency and distribution.
- **Q: Small-scope hypothesis?** A: Most bugs have small counterexamples, so checking up to a small bound finds the overwhelming majority.
- **Q: Does a clean bounded check mean "proved"?** A: No — it means "no counterexample within this scope." State the scope.
- **Q: The spec–code gap?** A: A verified spec proves the *model* correct, not the *code*; transcription, modeling, and assumption gaps remain.
- **Q: One cheap way to bridge that gap?** A: Property-based testing of the implementation against the spec's properties.
- **Q: Vacuous truth?** A: A property passing because its premise is never satisfied — verifies nothing; catch it by checking the antecedent is reachable.
- **Q: Over- vs under-specification?** A: Over = baking in *how* and rejecting valid implementations; under = leaving dangerous behavior unconstrained so the spec certifies bugs.
- **Q: Refinement?** A: A correctness-preserving step where the concrete model's every behavior is permitted by the abstract one.
- **Q: The Response pattern?** A: "If P happens, Q eventually follows" — the workhorse liveness pattern (every request eventually answered).
- **Q: The Precedence pattern?** A: "P must happen before Q" — e.g. acquire before release, open before read.
- **Q: One famous industrial win?** A: Amazon using TLA+ to find serious bugs in S3/DynamoDB that testing had missed.
- **Q: Money-transfer invariant?** A: Conservation — the sum of all balances is constant; no money created or destroyed.
- **Q: Leader-election safety?** A: At most one leader *per term* — not "exactly one leader always," which is unachievable.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Claiming "I verified the spec, so the code is correct" — missing the spec–implementation gap entirely.
- Treating a clean Alloy/bounded run as a *proof* rather than "no counterexample within scope."
- Confusing safety and liveness, or only ever specifying safety (certifying a deadlocked system).
- Reaching for full theorem-proving as the *default* — over-investing where model checking would do.
- "Let's formally specify everything" — no triage on blast radius.
- Writing a property without checking it's *falsifiable* / its antecedent is *reachable* (vacuous specs).
- Saying "exactly one leader always" for consensus, unaware it's impossible under asynchrony.
- Picking a tool by familiarity ("I'd use TLA+") without matching it to whether the question is structural or temporal.

**Green flags:**
- Naming the *distinction* (spec/test, safety/liveness, model/code, bounded/proof) before reaching for a tool name.
- Stating the **invariant first** in a design exercise, and worrying about the *concurrent* failure unprompted.
- Saying "this proves the model, not the code" and then naming a bridge (property tests, refinement, runtime monitors).
- Quoting the scope on a bounded check and pushing it as high as time allows.
- Framing formal methods as *lightweight, scoped to high-blast-radius* components, with an ROI argument.
- Seeing spec, property-based test, and contract as one continuum — "the property is the asset."
- Treating a spec as *living code* that rots, and tying it to CI.
- Knowing leader election is "one leader *per term*" and keeping safety separate from conditional liveness.

---

## Cheat Sheet

| Concept | One-line answer |
|---|---|
| **Formal spec** | A precise, machine-checkable description of *what* a system must do; a universal claim over all behaviors. |
| **Pre / post / invariant** | Obligation before an op / guarantee after / property true in every reachable state. |
| **Safety** | "Nothing bad ever happens" — violated by a *finite* prefix. |
| **Liveness** | "Something good eventually happens" — violated only by an *infinite* run. |
| **State-based (Z/VDM/B)** | State + pre/post ops; data-rich specs, refinement to code. |
| **Relational (Alloy)** | Relations over atoms; *structural* questions, bounded SAT check. |
| **Temporal (TLA+)** | State machine + properties over behaviors; *concurrency/distribution*, checked by TLC. |
| **Small-scope hypothesis** | Most bugs have small counterexamples; bounded checking finds them. |
| **Bounded vs proof** | "No counterexample up to N" vs "no counterexample, ever." |
| **Spec patterns** | Absence, Universality, Existence, Response, Precedence (+ scopes). |
| **Refinement** | Correctness-preserving step; concrete behaviors ⊆ abstract behaviors. |
| **Spec–code gap** | Verified spec ⟹ correct *model*, not correct *code*. |
| **Bridges** | Refinement proof, code-gen, property/conformance tests, runtime monitors. |
| **Over- / under-spec** | Bakes in *how* (rejects valid impls) / leaves danger unconstrained. |
| **Vacuous spec** | Passes because the premise is never true; verifies nothing. |
| **Lightweight FM** | Scoped formal checking of the highest-blast-radius slice; cheap, automatic. |

---

## Summary

- The bank reduces to four distinctions in costumes: **spec vs test**, **safety vs liveness**, **model vs code**, **bounded vs proof**. Name the distinction first; the tool follows.
- A **spec** is a *universal* claim a tool tries to refute, where a test probes single cases; the act of writing it is itself a bug-finder because it forbids vagueness.
- **Safety** (nothing bad, finite witness) and **liveness** (something good, infinite witness) are independent — a do-nothing system has all safety and no liveness, so you always need both.
- Match the **notation** to the question: Alloy for structural ("can this configuration exist?", bounded SAT), TLA+ for behavioral concurrency/distribution (checked by TLC), state-based methods for data and refinement-to-code.
- A clean **bounded check** means "no counterexample within scope," not "proved"; reserve full **proof** for the small catastrophic core.
- The **spec–code gap** is the differentiator: verifying a spec proves the *model*, not the *code* — bridge it with refinement, code-gen, property-based/conformance tests, and runtime monitors, and never claim "verified spec ⟹ correct system."
- **Judgement** wins the interview: specify the high-blast-radius slice (concurrency, security, core invariants), watch for over/under/vacuous specs, treat the spec as living code, and in design exercises state the **invariant first** and the **concurrent** failure unprompted.

---

## Further Reading

- *Software Abstractions* (Daniel Jackson) — the Alloy book; the small-scope hypothesis and relational modeling, with hands-on examples.
- *Specifying Systems* (Leslie Lamport) — the TLA+ book; state machines, temporal logic, safety/liveness, and TLC. Free online.
- *Practical TLA+* (Hillel Wayne) and his **Learn TLA+** site — the most approachable on-ramp to temporal specs and why lightweight formal methods pay off.
- *Patterns in Property Specifications for Finite-State Verification* (Dwyer, Avrunin, Corbett) — the specification-patterns catalogue.
- "Use of Formal Methods at Amazon Web Services" (Newcombe et al.) — the canonical industrial-ROI case study for TLA+.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — Model Checking](../02-model-checking/interview.md) — the bounded/exhaustive checking that refutes the properties you specify here.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/interview.md) — the temporal notation for the safety/liveness properties above.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/interview.md) — turning a spec's invariants into property-based tests and runtime contracts.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/interview.md) — the ROI and triage judgement, at length.
- [Testing](../../testing/) — where specs meet ordinary tests on the spec–code continuum.
