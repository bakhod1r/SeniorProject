# Model Checking — Middle Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Model Checking
> *The junior page sold the promise: explore every state, get a counterexample for free. This page makes good on it — the model you actually write, the temporal logic you state properties in, the graph search underneath, and the one problem (state explosion) that the entire toolchain is built to fight.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Model Is a Transition System](#core-concept-1--the-model-is-a-transition-system)
5. [Core Concept 2 — Temporal Logic: Stating What "Correct Over Time" Means](#core-concept-2--temporal-logic-stating-what-correct-over-time-means)
6. [Core Concept 3 — Safety, Liveness, and Why Liveness Needs Fairness](#core-concept-3--safety-liveness-and-why-liveness-needs-fairness)
7. [Core Concept 4 — The Algorithm: Search, Then Look for a Bad Cycle](#core-concept-4--the-algorithm-search-then-look-for-a-bad-cycle)
8. [Core Concept 5 — State Explosion and How to Fight It](#core-concept-5--state-explosion-and-how-to-fight-it)
9. [Core Concept 6 — The Tool Landscape and the Workflow](#core-concept-6--the-tool-landscape-and-the-workflow)
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

> Focus: **How does a model checker actually work, what do I write, and how do I keep it from blowing up?**

At the junior level, model checking is a black box with a slogan: *describe the system, state a property, and the tool either says "OK" or hands you a step-by-step trace of how the property breaks.* That model is true, and it's enough to appreciate why the technique catches concurrency bugs that testing never will. But it can't yet answer the questions that decide whether you can *use* the tool: What exactly do I feed it? What language do I state "the system never deadlocks" or "every request is eventually answered" in? Why does a model with five integer variables sometimes finish in a second and a model with six run for a day — or never finish?

This page opens the box. There are four things inside: a **transition system** (the model — states plus the moves between them), a **temporal logic** (the language for properties that range over time), a **graph search** (the engine — visit reachable states, look for a counterexample), and a pile of **state-reduction techniques** (the survival kit for the one problem that dominates everything, *state explosion*). Get these four and you can read a Promela or PlusCal model, predict roughly where it will choke, and reach for the right mitigation instead of staring at a tool that has been "running" for an hour.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state, in one sentence, what a counterexample is and why exhaustive checking beats sampling.
- **Required:** You can read a state machine — states, transitions, an initial state.
- **Helpful:** You've written or debugged concurrent code (threads, locks, message passing) and have felt a Heisenbug.
- **Helpful:** A rough sense of graph traversal (BFS/DFS) and what a hash set is used for.
- **Helpful:** You've seen propositional logic (`∧`, `∨`, `¬`, `⇒`). Temporal logic is that, plus operators about *time*.

---

## Glossary

| Term | Meaning |
|---|---|
| **Transition system / Kripke structure** | The formal model: a set of states, a transition relation between them, and a labelling of each state with the atomic propositions true there. |
| **Atomic proposition (AP)** | A basic true/false fact about a state, e.g. `lock_held`, `x == 0`, `inCritical[1]`. |
| **State** | One complete snapshot of every variable plus each process's program counter. |
| **Reachable state** | A state you can actually arrive at from an initial state by following transitions. |
| **Trace / behaviour / path** | An (often infinite) sequence of states the system can step through. |
| **LTL** | Linear Temporal Logic — properties over a *single* timeline using `G`, `F`, `X`, `U`. |
| **CTL** | Computation Tree Logic — properties over the *branching tree* of futures using path quantifiers `A` (all) and `E` (some). |
| **Safety property** | "Nothing bad ever happens." Violated by a *finite* prefix. |
| **Liveness property** | "Something good eventually happens." Violated only by an *infinite* trace. |
| **Fairness** | An assumption that an enabled action is not ignored forever; required to prove most liveness. |
| **Counterexample** | A concrete trace witnessing a property violation — the model checker's headline output. |
| **State explosion** | The reachable-state count growing exponentially in variables/processes/buffer sizes. |
| **BDD** | Binary Decision Diagram — a compact representation of a Boolean function (and thus a *set of states*). |
| **BMC** | Bounded Model Checking — unroll the system `k` steps and hand the result to a SAT/SMT solver. |
| **Büchi automaton** | An automaton over infinite words; accepts a run if it visits an accepting state infinitely often. |

---

## Core Concept 1 — The Model Is a Transition System

A model checker does not analyse your code. It analyses a **transition system** (formally, a *Kripke structure*): a triple of

- a set of **states** `S`,
- a **transition relation** `R ⊆ S × S` (which states can step to which), and
- a **labelling** `L : S → 2^AP` saying which atomic propositions hold in each state.

A *state* is a complete snapshot: the value of every variable, plus each concurrent process's program counter. A *transition* is one atomic step that takes you from one snapshot to another. The set of states the system can actually reach from its initial states — the **reachable** states — is the graph the checker explores.

You don't draw this graph by hand; you write a *generator* for it in a modelling language. The dominant styles:

- **Guarded commands** — a set of rules of the form `guard → action`. Any rule whose guard holds in the current state may fire, producing the next state. This is the heart of TLA+, Murφ, and Promela's logic.
- **Communicating processes** — concurrent processes that interleave, communicating over channels. This is **Promela** (the input language of SPIN).
- **PlusCal** — pseudocode-looking syntax that compiles to TLA+ (covered in [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md)).

Here is a deliberately tiny Promela model: two processes competing for a critical section using a single shared flag. It is *wrong on purpose* — we'll let the checker prove it.

```promela
bool lock = false;          /* shared lock flag */
byte inCritical = 0;        /* how many are inside the critical section */

active [2] proctype P() {    /* two identical processes */
  do
  :: (lock == false) ->     /* guard: lock looks free... */
       lock = true;          /* ...so take it */
       inCritical++;
       /* --- critical section --- */
       assert(inCritical == 1);   /* SAFETY: at most one inside */
       inCritical--;
       lock = false;
  od
}
```

The bug: testing `lock == false` and setting `lock = true` are **two separate atomic steps**. The model checker will interleave the two processes so that *both* read `lock == false` before *either* writes `true`, both enter, and `inCritical` hits 2 — violating the assertion. A real run would have to hit that exact interleaving; the model checker hits it by construction.

> **Key insight:** The model is an *abstraction you author*, not your code. Every variable you add and every value it can take multiplies the state space, so you model the *protocol* — the flags, the messages, the program counters that matter — and throw away everything else (payloads, timestamps, the actual data). The art of model checking is choosing what to leave out. A faithful-but-huge model checks nothing because it never finishes; a tiny-but-relevant model finds the bug in seconds.

---

## Core Concept 2 — Temporal Logic: Stating What "Correct Over Time" Means

An assertion like `inCritical == 1` is a fact about a *single state*. But most interesting properties are about *behaviour over time*: "the lock is never held by two processes," "every request eventually gets a response," "once shut down, the system stays down." For these you need **temporal logic** — propositional logic extended with operators that talk about the future along a trace.

**Linear Temporal Logic (LTL)** reasons over a *single timeline* (one infinite trace at a time). Its four core operators, with `p` an atomic proposition:

| Operator | Read as | Meaning along the trace |
|---|---|---|
| `G p` (□) | **globally / always** | `p` holds in every state from now on |
| `F p` (◇) | **eventually / finally** | `p` holds in some future state |
| `X p` (○) | **next** | `p` holds in the *immediately* next state |
| `p U q` | **until** | `p` holds until `q` becomes true (and `q` does become true) |

These compose, and the nesting is where the expressive power lives:

```text
G (¬(inCritical == 2))          mutual exclusion — never two inside        (SAFETY)
G (request ⇒ F response)        every request is eventually answered       (LIVENESS)
G F heartbeat                    the heartbeat fires infinitely often       (LIVENESS)
G (shutdown ⇒ G ¬serving)        once shut down, never serve again          (SAFETY)
```

Read `G (request ⇒ F response)` aloud: *"in every state, if there's a request, then in some later state there's a response."* That one formula is the canonical *responsiveness* property, and it shows why temporal logic matters — there is no single-state assertion that can express "eventually."

**Computation Tree Logic (CTL)** takes a different view: instead of one timeline, it reasons over the *branching tree* of all possible futures, and adds **path quantifiers** in front of the temporal operators:

- `A` — **for all** paths from here; `E` — **there exists** a path from here.

So `AG p` means "on all paths, always `p`" (a true invariant), while `EF p` means "there is some path along which `p` eventually holds" (`p` is *reachable*). `AG (EF reset)` — "from every reachable state, it is always possible to get back to a reset state" — is a classic CTL property that LTL *cannot* express, because it quantifies over branching. (LTL and CTL are incomparable; their union is CTL\*. You rarely need that distinction at this tier — just know LTL = "facts about each timeline," CTL = "facts about the tree of timelines.")

> **Key insight:** Most properties you'll write are LTL and fall into two shapes — `G (something bad never happens)` and `G (trigger ⇒ F good thing happens)`. If you can fluently translate a requirement into one of those two templates, you can specify most of what a model checker will check for you.

---

## Core Concept 3 — Safety, Liveness, and Why Liveness Needs Fairness

Every temporal property is some combination of two fundamental kinds, and the distinction is not academic — it changes *how* the checker hunts for a violation and *what assumptions* it needs.

- **Safety** — *"nothing bad ever happens."* Mutual exclusion, no deadlock, no array-out-of-bounds, an invariant that always holds. A safety property is violated by a **finite** trace: there's a specific bad state, and the counterexample is the finite path that reaches it. You can always *point at the moment* it broke.

- **Liveness** — *"something good eventually happens."* Every request gets a response; the system makes progress; a thread waiting for a lock eventually acquires it. A liveness property can only be violated by an **infinite** trace — one where the good thing is *forever* postponed. The counterexample is a **lasso**: a finite stem leading into a cycle the system can loop in forever, never reaching the good state.

Here's the catch that trips up everyone the first time: **liveness is almost never true without a fairness assumption.** Consider `G (request ⇒ F response)`. A scheduler is technically *allowed* to run process A forever and never give process B a turn — and in that behaviour, B's request is never served, so the liveness property "fails." But that failure isn't a bug in your protocol; it's a pathological scheduler. **Fairness** is the assumption that rules these out:

- **Weak fairness** — if an action stays *continuously enabled*, it eventually executes. (No starving an action that's always ready.)
- **Strong fairness** — if an action is *enabled infinitely often* (even with gaps), it eventually executes.

Under fairness, the checker ignores the "starve B forever" behaviours and only reports a liveness violation if your *protocol* can genuinely deadlock or livelock.

> **Key insight:** Check safety first, always. Safety properties are cheaper (finite counterexample, no fairness needed) and catch the majority of real bugs. Add liveness — and the fairness assumptions it requires — only when "does it *make progress*?" is a question you actually need answered, because a liveness check with the wrong fairness either floods you with bogus counterexamples or silently masks a real one.

| | Safety | Liveness |
|---|---|---|
| Slogan | "nothing bad ever happens" | "something good eventually happens" |
| Example | `G ¬(two in critical section)` | `G (request ⇒ F response)` |
| Counterexample shape | finite path to a bad state | infinite *lasso* (stem + cycle) |
| Needs fairness? | No | Almost always |
| Relative cost | Cheaper | More expensive |
| Check it... | first | after safety holds |

---

## Core Concept 4 — The Algorithm: Search, Then Look for a Bad Cycle

Strip away the vocabulary and **explicit-state model checking is a graph search you already know.**

**Checking an invariant (safety)** reduces to a single reachability question: *is any bad state reachable from an initial state?* The algorithm is breadth- or depth-first search over the transition graph:

```text
frontier  := initial states
visited   := {}                      # a hash table of seen states
while frontier not empty:
    s := pop(frontier)
    if s in visited: continue        # already explored — skip
    add s to visited
    if bad(s):                       # property violated here
        return COUNTEREXAMPLE = path from an initial state to s
    for each s' with R(s, s'):       # every successor
        push s' onto frontier
return "property holds on all reachable states"
```

Three details carry all the weight. The **`visited` hash table** is what makes it terminate and stay tractable — without it you'd revisit states forever in any system with a cycle. The **`bad(s)` test** is just evaluating your invariant (or the assertion in the model) in state `s`. And the **counterexample comes free**: it's the path the search already walked to reach `s` — store each state's predecessor and you reconstruct the trace by walking backwards. BFS gives you the *shortest* such trace, which is why the bugs the tool reports are usually pleasantly minimal. *This is the entire engine for safety.*

**Checking a full LTL property** needs one more idea, the **automata-theoretic approach**. You don't search for the property directly; you search for its *violation*:

1. **Negate** the property you want (`φ`), giving `¬φ`.
2. **Translate** `¬φ` into a **Büchi automaton** — an automaton over infinite traces that *accepts exactly the behaviours that violate `φ`*.
3. **Take the product** of that automaton with your system's transition system (run them in lockstep).
4. **Search for an accepting cycle** in the product. A reachable cycle that passes through an accepting state is an infinite behaviour the system can perform that *violates `φ`* — i.e., a counterexample. Finding it is, again, graph search (nested DFS that detects reachable accepting cycles).

If no accepting cycle exists, no behaviour violates `φ`, so `φ` holds on every trace. You never have to understand Büchi automata to *use* a model checker — but knowing this is why two facts are true: safety counterexamples are finite paths (reach a bad state) and liveness counterexamples are lassos (find an accepting *cycle*).

> **Key insight:** A model checker is not "magic theorem-proving" — for explicit-state checking it is exhaustive graph search with a visited-set, plus the trick of searching for the *negation* of your property so that any path/cycle the search finds *is* the counterexample. Everything hard about it is making that graph small enough to finish.

---

## Core Concept 5 — State Explosion and How to Fight It

The reachable-state count grows **exponentially**. A model with `n` boolean flags has up to `2ⁿ` states; add `k` concurrent processes and the interleavings multiply; widen a message buffer from 2 slots to 4 and the space can square. Ten processes each with ten local states is `10¹⁰` — ten billion states — before you've added a single shared variable. This is **state explosion**, and it is *the* defining problem of the field. Everything below is a technique to make the intractable tractable.

**Symbolic model checking (BDDs).** Instead of enumerating states one at a time, represent *sets of states* as a Boolean formula and store that formula as a **Binary Decision Diagram (BDD)** — a canonical, often dramatically compressed, DAG. Transitions become operations on BDDs, so you manipulate billions of states in one step without listing them. This is what let model checking jump from ~10⁶ to 10²⁰⁺ states and made *hardware* verification practical. Tools: **NuSMV / nuXmv**. (BDD size is sensitive to variable ordering — a good ordering is compact, a bad one explodes; tools heuristically reorder.)

**Bounded Model Checking (BMC).** Give up on full exhaustiveness *for now*: unroll the transition relation `k` steps into one big Boolean/arithmetic formula that is satisfiable *iff* there's a property violation within `k` steps, and hand it to a **SAT or SMT solver**. Modern solvers are astonishingly good, so BMC is superb at finding **shallow bugs fast** — and a violation it finds is a *real* counterexample. The catch: a clean BMC run only proves "no bug in `k` steps," **not** "no bug ever" — unless `k` reaches the system's *diameter* (the longest shortest-path between states), which is usually unknown or impractically large. BMC is a **bug-finder**, not (by default) a prover. Tools: **CBMC** (unrolls C/C++ directly), and the BMC modes of nuXmv.

**Partial-order reduction.** In concurrent models, many interleavings are *equivalent* — if two steps in different processes don't touch shared state, the order they happen in can't affect any property, so exploring both orderings is wasted work. POR explores only one representative of each equivalence class, often shrinking the space by orders of magnitude. SPIN does this automatically.

**Symmetry reduction.** If your model has `N` identical processes, states that differ only by *which* identical process is in which role are equivalent. Collapse them into one representative and you divide the space by up to `N!`.

**Abstraction and CEGAR.** Replace the concrete model with a coarser one that lumps many states together (e.g., track only the *sign* of an integer, not its value). The abstraction is smaller but *over-approximates*, so a counterexample it reports might be **spurious** (an artifact of throwing away detail). **CEGAR** — *Counterexample-Guided Abstraction Refinement* — automates the loop: check the abstract model; if it reports a counterexample, test whether it's real on the concrete system; if spurious, use it to *refine* the abstraction (add back just enough detail to rule it out) and re-check. Repeat until you get a real counterexample or a proof. This is how software model checkers tame programs with huge state spaces.

> **Key insight:** There is no free lunch — every mitigation buys tractability by giving something up (BMC gives up completeness past `k`; abstraction gives up precision and risks spurious traces; BDDs trade time-per-step for ordering sensitivity). Knowing *which* compromise a tool makes tells you exactly how to read its output: a green BMC run means "no shallow bug," not "proven correct," and a CEGAR counterexample is only trustworthy after it's been confirmed on the concrete system.

| Technique | Idea | Buys you | Costs you | Tool |
|---|---|---|---|---|
| Symbolic / BDD | sets of states as Boolean formulas | huge state spaces in one step | ordering sensitivity | NuSMV, nuXmv |
| BMC | unroll `k` steps → SAT/SMT | fast shallow-bug finding | no proof past `k` (diameter) | CBMC, nuXmv |
| Partial-order reduction | skip equivalent interleavings | orders of magnitude in concurrency | none material | SPIN |
| Symmetry reduction | collapse identical processes | divide by up to `N!` | needs real symmetry | Murφ, SPIN |
| Abstraction + CEGAR | coarsen, refine from spurious traces | tame real software | spurious counterexamples | SLAM, BLAST, CPAchecker |

---

## Core Concept 6 — The Tool Landscape and the Workflow

The tools split cleanly by *how* they explore the state space:

- **Explicit-state** (enumerate states, store them in a hash table):
  - **SPIN / Promela** — the classic for concurrent and protocol verification; on-the-fly LTL checking with partial-order reduction. (Holzmann's tool, used at JPL.)
  - **TLA+ / TLC** — Lamport's specification language and its explicit-state checker; the standard for *distributed-systems design* (covered in [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md)).
- **Symbolic** (BDDs):
  - **NuSMV / nuXmv** — symbolic CTL/LTL checking; strong on hardware and finite-state control logic; nuXmv adds SAT/SMT-based and infinite-state techniques.
- **BMC for software** (unroll → solver):
  - **CBMC** — bounded model checker for C/C++; verifies assertions, array bounds, overflow, and pointer safety directly on source.
- **Software model checking** (explore program states):
  - **Java Pathfinder (JPF)** — a special JVM that model-checks Java bytecode, exploring thread interleavings to find concurrency bugs.
- **Bounded, SAT-based relational**:
  - **Alloy** — models *structures and their relations* and checks properties within a bounded *scope* via SAT. Brilliant for data models, permission schemes, and protocols where "find me a counterexample within ≤ N objects" is the right question. (Daniel Jackson's tool; the *small-scope hypothesis* — most bugs show up in small instances — is its whole bet.)

**The workflow** is an iterative loop, and the abstraction step is the one that decides success:

```text
1. MODEL the design — abstract aggressively; capture the protocol, drop the payloads.
2. STATE the properties — invariants/safety first, then liveness (with fairness).
3. RUN the checker.
4. READ the result:
     • "no counterexample within the bound/state space" → property holds (mind the bound!)
     • a counterexample trace → go to 5
5. DIAGNOSE: is it a real design bug, or a wrong/too-strong property, or a modelling artifact?
     • design bug      → fix the design,    re-run
     • bad property    → fix the property,  re-run
     • model artifact  → fix the model,     re-run
6. ITERATE until the checker is green AND you trust the model.
```

> **Key insight:** The deliverable of model checking is rarely the green checkmark — it's the **counterexample and what you learn fixing it.** Most of your time goes into step 5, deciding *which* of the three things is wrong (design, property, or model), and step 1, keeping the model small enough that step 3 ever finishes. The tool is a fast, tireless adversary; your job is to ask it the right question.

---

## Real-World Examples

**Amazon Web Services — DynamoDB and S3.** AWS engineers wrote TLA+ specs of core replication and storage protocols and ran TLC against them. The checker found bugs requiring sequences of **up to 35 steps** to trigger — interleavings no human reviewer or test suite would ever construct — *before* the systems shipped. Their CACM report ("How Amazon Web Services Uses Formal Methods") is the canonical case for model checking in industry: it pays off precisely on the deep, rare, concurrency-induced bugs that are most expensive to find in production.

**The classic mutual-exclusion bug (our Promela model).** Run the model from Core Concept 1 in SPIN and it reports a counterexample in milliseconds: process 0 reads `lock == false`, process 1 reads `lock == false` (before 0 writes it), both set `lock = true`, both increment `inCritical`, and the `assert(inCritical == 1)` fires with `inCritical == 2`. The fix — make test-and-set atomic — turns the spec green. This is the field in miniature: a two-step race that's murder to reproduce by hand and trivial for the checker.

**A protocol counterexample trace.** This is the *shape* of what SPIN/TLC hand back — the headline output of the whole exercise:

```text
COUNTEREXAMPLE (mutual exclusion violated):
  step  process   action                       lock   inCritical
  ----  --------  ---------------------------  -----  ----------
   0    P[0]      eval guard (lock==false) ✓   false       0
   1    P[1]      eval guard (lock==false) ✓   false       0      ← both passed the guard
   2    P[0]      lock = true                  true        0
   3    P[0]      inCritical++                 true        1
   4    P[1]      lock = true                  true        1      ← P[1] still thinks it won
   5    P[1]      inCritical++                 true        2
   6    P[0]      assert(inCritical==1)        true        2      ← VIOLATED: inCritical == 2
```

You read it top to bottom like a debugger session you didn't have to run, with the exact interleaving spelled out and the violated state circled.

**Hardware verification.** Symbolic model checking with BDDs (NuSMV-style) and BMC is standard in chip design — verifying cache-coherence protocols, pipeline control, and arbiters. It is, historically, the field's biggest commercial success: the cost of a silicon respin makes exhaustive checking obviously worth it.

**TLA+ catching a distributed-cache bug.** Engineers modelling a leader-election / cache-invalidation protocol in TLA+ routinely find that a particular crash-and-recovery interleaving leaves two nodes believing they're leader, or serves stale data after an invalidation race. TLC finds it as a safety violation; the trace shows the exact crash timing — the kind of bug that otherwise surfaces as a once-a-quarter production incident no one can reproduce.

---

## Mental Models

- **The model checker is an infinitely patient, infinitely hostile QA engineer.** It tries *every* ordering of *every* event, never gets bored, never misses an edge case within the model — and the instant it finds a failing sequence, it writes you the exact reproduction steps. Your job isn't to find bugs; it's to (a) describe the system honestly and (b) tell it precisely what "bug" means.

- **You verify the *map*, not the *territory*.** The model is a map of your system. A clean run proves the *map* has no bad states — which is only as valuable as the map is faithful. The gap between map and code (the *abstraction gap*) is where a "verified" design can still fail in implementation. Model checking de-risks the *design*; it does not certify the *code*.

- **State explosion is gravity.** It's always pulling. Every variable, process, and buffer slot you add increases the pull exponentially. Every technique in Core Concept 5 is a way to fly anyway — but you never escape gravity, you just manage it. The first question about any model is "how big is the state space?"

- **Safety is a *point*; liveness is a *loop*.** Safety asks "can we reach a bad spot?" — the counterexample is a path to a point. Liveness asks "can we get stuck circling forever without progress?" — the counterexample is a loop. This is why liveness needs fairness (to rule out *unfair* loops) and why it's the harder, costlier check.

- **BMC is a metal detector, not an X-ray.** Sweep `k` steps deep and it reliably beeps on shallow buried bugs — fast and trustworthy when it beeps. But silence only means "nothing in the top `k` inches," not "the ground is clean." Don't read a green BMC run as a proof.

---

## Common Mistakes

1. **Modelling the implementation instead of the design.** Pouring real data structures, payload contents, and incidental variables into the model. The state space explodes and nothing finishes. Model the *protocol* — the flags, messages, and control state that determine correctness — and abstract away the rest.

2. **Checking liveness without (or with wrong) fairness.** `G (request ⇒ F response)` will "fail" under a scheduler that starves a process — a bogus counterexample. Add the appropriate weak/strong fairness so the checker only reports genuine livelock/deadlock, not pathological scheduling.

3. **Reading a green BMC/bounded run as a proof.** "No counterexample found" from CBMC at `k=20`, or from Alloy at scope 5, means *no bug within that bound* — not *no bug*. Only an unbounded checker (or BMC that provably reaches the diameter) proves absence. State the bound when you report the result.

4. **Stating a property that's trivially true (vacuity).** `G (request ⇒ F response)` is *vacuously* satisfied if `request` is never reachable in your model — the checker says "OK" and you learn nothing. If a property passes suspiciously fast, sanity-check that its trigger is actually reachable (many tools have vacuity/coverage checks).

5. **Confusing "the model is correct" with "the system is correct."** The checker certifies the *model*. If the model omits the very behaviour where the real bug lives, a green run is false comfort. The result is only as strong as the model is faithful — state your modelling assumptions explicitly.

6. **Letting the state space grow silently.** Widening a buffer, adding a process, or adding a variable can square or exponentiate the space. A model that ran in 2 seconds yesterday "hangs" today because someone bumped a constant. Watch the reported state count and reach for POR/symmetry/abstraction *before* the run becomes infinite.

7. **Ignoring the counterexample's minimality.** BFS-based checkers return the *shortest* counterexample. Engineers sometimes dismiss a 3-step trace as "too simple to be real" — it's the opposite: a short counterexample is the easiest possible bug to understand and fix. Read it.

---

## Test Yourself

1. What three components make up a transition system (Kripke structure), and what is a "state" in a concurrent model?
2. Translate into LTL: "the system never has two processes in the critical section" and "every login attempt is eventually either accepted or rejected." Which is safety and which is liveness?
3. Why does a *safety* violation produce a finite counterexample while a *liveness* violation produces an infinite (lasso) one?
4. Explain why checking the liveness property `G (request ⇒ F response)` usually requires a fairness assumption. What goes wrong without it?
5. Describe explicit-state invariant checking as a graph algorithm. What is the `visited` set for, and where does the counterexample come from?
6. CBMC reports "no assertion failures" when unrolling a loop to `k = 15`. Has it *proven* the code correct? Why or why not?
7. Name two distinct techniques for fighting state explosion and state what each one trades away.

<details>
<summary>Answers</summary>

1. A set of **states** `S`, a **transition relation** `R ⊆ S × S`, and a **labelling** `L` mapping each state to the atomic propositions true there. In a concurrent model, a *state* is a complete snapshot of every variable **plus** each process's program counter.
2. `G ¬(inCritical == 2)` (or `G ¬(inCS[0] ∧ inCS[1])`) — **safety** (nothing bad ever happens). `G (loginAttempt ⇒ F (accepted ∨ rejected))` — **liveness** (something good eventually happens).
3. Safety means a *bad state exists*; reaching it takes a finite path, so the counterexample is that finite path. Liveness means the good thing is *forever postponed*; the only witness is an infinite behaviour, represented as a **lasso** — a finite stem into a cycle the system loops in without ever reaching the good state.
4. Without fairness, the checker is free to consider behaviours where the scheduler runs other processes forever and *never* services this request — making `F response` false through no fault of the protocol. That's a *spurious* counterexample. Fairness rules out those unfair schedules so a violation reported is a genuine livelock/deadlock in the design.
5. BFS/DFS from the initial states over the transition graph: pop a state, test the invariant (`bad(s)`), and push its successors. The **`visited`** hash set prevents re-exploring states (essential for termination on cyclic graphs and for tractability). The **counterexample** is the path the search already traversed to reach the bad state — recovered by storing each state's predecessor and walking backwards. BFS yields the *shortest* such path.
6. **No.** It has proven only that there's *no assertion failure within 15 unrollings*. A bug requiring 16+ iterations would be missed. BMC proves full correctness only if `k` reaches the system's diameter (the longest shortest path), which here is unknown. BMC is a bug-finder, not (by default) a prover.
7. Any two of: **Symbolic/BDD** — trades time-per-step and ordering sensitivity for representing huge state sets compactly. **BMC** — trades completeness past `k` for fast shallow-bug finding. **Partial-order reduction** — explores one representative per equivalence class of interleavings (essentially free, needs concurrency to help). **Symmetry reduction** — collapses identical processes (needs genuine symmetry). **Abstraction/CEGAR** — trades precision (risks spurious counterexamples) for a smaller model.

</details>

---

## Cheat Sheet

```text
THE MODEL  (transition system / Kripke structure)
  states S  +  transition relation R ⊆ S×S  +  labelling L : S → 2^AP
  state = all variables + every process's program counter
  write it: guarded commands | processes/channels (Promela) | PlusCal→TLA+
  ABSTRACT: model the protocol, drop the payloads

TEMPORAL LOGIC (LTL — one timeline)
  G p (□)  always p          F p (◇)  eventually p
  X p (○)  next p            p U q     p until q (and q happens)
  templates:  G ¬bad                      (safety)
              G (trigger ⇒ F good)        (liveness)
  CTL adds path quantifiers: A (all paths), E (some path) — AG, EF, ...

SAFETY vs LIVENESS
  safety   = nothing bad ever  → finite counterexample      → no fairness, check FIRST
  liveness = something good     → infinite lasso (stem+cycle) → needs FAIRNESS

THE ALGORITHM (explicit-state)
  invariant: BFS/DFS reachable states + visited hash set; bad(s)? → CE = path to s
  full LTL : negate φ → Büchi automaton → product with system → find accepting cycle
  counterexample comes FREE from the search path

STATE EXPLOSION  (states exponential in vars/processes/buffers) — fight it:
  symbolic/BDD  sets-as-formulas (NuSMV/nuXmv)   |  BMC  unroll k → SAT/SMT (CBMC) — shallow bugs, NOT a proof past k
  partial-order skip equiv interleavings (SPIN)  |  symmetry collapse identical procs
  abstraction + CEGAR  coarsen, refine from spurious traces

TOOLS                              WORKFLOW
  SPIN/Promela   explicit, conc.     1 model (abstract!)  2 state props (safety→liveness)
  TLA+/TLC       distributed design  3 run  4 read CE  5 fix design|property|model  6 iterate
  NuSMV/nuXmv    symbolic CTL/LTL
  CBMC           BMC for C/C++       PITFALLS
  Java Pathfinder Java bytecode        green BMC ≠ proof | liveness needs fairness
  Alloy          bounded, SAT          vacuous pass | you verify the MODEL, not the code
```

---

## Summary

- A model checker analyses a **transition system** (states + transition relation + labelling), not your code. You author it as an *abstraction* — model the protocol, drop the payloads — because every variable, process, and buffer slot multiplies the state space.
- Properties are stated in **temporal logic**. LTL (`G`/`F`/`X`/`U`) reasons over a single timeline; CTL adds branching quantifiers `A`/`E`. Almost everything you write fits one of two LTL templates: `G ¬bad` (safety) and `G (trigger ⇒ F good)` (liveness).
- **Safety** ("nothing bad ever") is violated by a finite path and needs no fairness — check it first. **Liveness** ("something good eventually") is violated by an infinite lasso and almost always requires a **fairness** assumption to avoid bogus counterexamples.
- The **algorithm** for safety is BFS/DFS over reachable states with a visited hash set; the counterexample is the search path, free. Full LTL uses the **automata-theoretic** approach — negate the property, build a Büchi automaton, take the product, search for an accepting cycle.
- **State explosion** is the central problem — state count is exponential. The survival kit: **BDDs** (symbolic), **BMC** (unroll → SAT/SMT, finds shallow bugs but proves nothing past `k`), **partial-order** and **symmetry** reduction, and **abstraction + CEGAR**. Each buys tractability by giving something up.
- **Tools** split by exploration strategy — SPIN/TLC (explicit), NuSMV/nuXmv (symbolic), CBMC (BMC for C), JPF (Java), Alloy (bounded SAT). The **workflow** is iterate: model, state properties, run, *read the counterexample*, fix the design/property/model, repeat. The deliverable is the counterexample, not the checkmark — and you've verified the model, not the code.

---

## Further Reading

- *Model Checking* — Clarke, Grumberg & Peled (2nd ed., Clarke, Henzinger, Veith, Bloem). The definitive textbook: Kripke structures, CTL/LTL, BDDs, symbolic and bounded model checking, abstraction.
- *The SPIN Model Checker: Primer and Reference Manual* — Gerard Holzmann. Promela, on-the-fly LTL checking, partial-order reduction — from the author of SPIN.
- *Principles of Model Checking* — Baier & Katoen. The other standard reference; especially clear on the automata-theoretic approach and the safety/liveness/fairness theory.
- *Practical TLA+* and *Learn TLA+* — Hillel Wayne. The most approachable on-ramp to writing real specs and reading TLC counterexamples; pairs directly with [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md).
- *Software Abstractions* — Daniel Jackson. Alloy, the small-scope hypothesis, and bounded relational checking of data models.
- "How Amazon Web Services Uses Formal Methods" — Newcombe et al., CACM 2015. The industrial case for model checking at scale.
- [senior.md](senior.md) — the algorithms in depth: BDD operations and ordering, the nested-DFS accepting-cycle search, CEGAR mechanics, SMT-backed checking, and engineering large models that actually terminate.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/middle.md) — where the *properties* you check come from; a model checker is only as good as the spec it checks against.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/middle.md) — the deep dive on temporal logic and the explicit-state checker (TLC) most used for distributed-systems design.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/middle.md) — the cheaper rungs: property-based testing and SMT-backed deductive verification of actual code.
- [05 — Proof Assistants & Dependent Types](../05-proof-assistants-and-dependent-types/middle.md) — when bounded/finite checking isn't enough and you need a machine-checked proof over *all* inputs.
- [Testing](../../testing/) — the sampling-based complement; model checking is what you reach for when "we ran it on these cases" can't cover the interleavings that matter.
