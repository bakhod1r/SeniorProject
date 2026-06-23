# TLA+ & Temporal Logic — Junior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → TLA+ & Temporal Logic
> *Tests check what your code does for the handful of inputs you thought of. TLA+ checks what your **design** does across every possible ordering of events — including the one nasty interleaving you'd never have dreamed up at 2 a.m.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — You Model the Design, Not the Code](#core-concept-1--you-model-the-design-not-the-code)
5. [Core Concept 2 — State, Action, and Behavior](#core-concept-2--state-action-and-behavior)
6. [Core Concept 3 — Temporal Logic: □ "Always" and ◇ "Eventually"](#core-concept-3--temporal-logic--always-and--eventually)
7. [Core Concept 4 — Safety vs Liveness (and `~>`)](#core-concept-4--safety-vs-liveness-and-)
8. [Core Concept 5 — PlusCal: Algorithms That Compile to TLA+](#core-concept-5--pluscal-algorithms-that-compile-to-tla)
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

> Focus: **What is TLA+, what do □ and ◇ mean, and why model your design before you code?**

You already know one way to gain confidence in a program: write tests. A test picks some inputs, runs the code, and checks the output. It works — until the bug only shows up when two threads happen to run in *exactly* the wrong order, on the third Tuesday of a leap year, under load. That bug isn't in any single line of code. It's in the **design**: the set of things that *can* happen and the order they *can* happen in. Tests are terrible at finding those, because you'd have to think of the bad ordering yourself to write a test for it.

**TLA+** is a language for describing a system as it **changes over time** — its possible states and the steps between them — so that a tool can check *every* possible run and tell you whether a rule can ever be broken. It was created by **Leslie Lamport**, who won the Turing Award (computing's Nobel) for foundational work on distributed systems. The name stands for the *Temporal Logic of Actions*; don't worry about the words yet, we'll build them up piece by piece.

The crucial thing: in TLA+ **you don't write code**. You write a precise *model* of a design — a money transfer, a small cache, a traffic light, a one-bit clock — and then a checker called **TLC** mechanically explores every reachable state. If some rule you care about (like "balance is never negative") can be violated, TLC hands you the *exact sequence of steps* that breaks it. Not "a test failed" — an actual numbered trace: do this, then this, then this, and now the rule is false.

> **Mindset shift:** stop thinking "I'll write the code, then test that it behaves." Start thinking "before I write any code, I'll describe what *can happen* and ask a tool to try every possibility for me." Testing samples a few runs you imagined; model checking exhausts *all* runs, including the ones you didn't. For tricky concurrent or stateful designs, that's the difference between hoping and knowing.

This page teaches you what TLA+ *is*, the four words you need (state, action, behavior, temporal property), what the two famous symbols □ ("always") and ◇ ("eventually") mean, and why modeling your design pays off. Syntax is kept tiny and always explained.

---

## Prerequisites

- **Required:** You can write a program and you know that threads/processes can run concurrently (even if you've never debugged a race condition).
- **Required:** You've met `==` (equals) and the idea of a variable holding a value.
- **Helpful:** You've once hit a bug that "only happens sometimes" and couldn't reproduce it. (That's the bug TLA+ is built to catch.)
- **Helpful:** You've seen the words "spec" or "model checking" and weren't sure what they meant. This page is the gentle on-ramp; [01 — Formal Specification](../01-formal-specification/junior.md) and [02 — Model Checking](../02-model-checking/junior.md) are the topics on either side.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **TLA+** | A language for describing how a system *changes over time*, so a tool can check it. |
| **Spec(ification)** | The model you write: the variables, the starting state, and the allowed steps. |
| **TLC** | The model checker — the tool that explores every reachable state of your spec. |
| **State** | The values of all your variables *right now* (one snapshot). |
| **Action** | A rule: "from a state like THIS, you may step to a state like THAT." |
| **Primed variable** (`x'`) | The value of `x` in the *next* state. `x' = x + 1` means "next x is current x plus one." |
| **Behavior** | One possible run: a sequence of states `s0 → s1 → s2 → …`. |
| **Invariant** | A rule that must hold in *every* state (a safety property). |
| **Temporal property** | A claim about *all of time* in a behavior, not just one state. |
| **□ ("box" / "always")** | "True in every state." `□P` = P is *forever* true. |
| **◇ ("diamond" / "eventually")** | "True at some state." `◇P` = P *happens sooner or later*. |
| **Counterexample** | The exact step-by-step trace TLC prints when a property *can* be broken. |
| **PlusCal** | A pseudocode-like front-end that reads like an algorithm and compiles to TLA+. |

---

## Core Concept 1 — You Model the Design, Not the Code

Here is the single biggest reframe. When you write a unit test, you are checking an *implementation* — real code, with real inputs you chose. When you write a TLA+ spec, you are checking a *design* — a description of what the system is *allowed* to do, with **no implementation at all**.

Think about a bank transfer between two accounts. The design is tiny: there's money in account A and money in account B, and a "transfer" step moves some amount from one to the other. The rule you care about is simple: **no account ever goes negative**. You could write this design on a napkin. TLA+ lets you write that same napkin precisely enough that a tool can check it.

```tla
VARIABLES a, b          \ two accounts; "\" starts a comment in TLA+

Init == a = 100 /\ b = 0   \ start: A has 100, B has 0.  "/\" means "and"

\ A transfer step: move some amount from A to B
Transfer == \E amt \in 1..a :        \ "there exists an amount between 1 and a"
              /\ a' = a - amt          \ next a = a - amt
              /\ b' = b + amt          \ next b = b + amt
```

Read it slowly. `Init` describes the *starting state*. `Transfer` describes a *step*: pick some amount `amt` (the `\E` means "there exists such an amount"), and the next values of `a` and `b` are the old ones adjusted. There's no loop, no function call, no language runtime. It's a *description of what may happen*, and that's the whole point — you're specifying the design, not coding the implementation.

Why is this powerful for a junior? Because **you can find a design bug before you've written a single line of code**. If your design is broken, no amount of careful coding will save it; you'll just implement the bug faithfully. Catching it at the napkin stage is enormously cheaper.

> **Key insight:** A spec is *executable* in a special sense — not "it runs like a program," but "a tool can explore every state the design permits." You get the bug-finding power of running code *without writing the code*, because TLA+ describes the space of all possible runs rather than one concrete run.

---

## Core Concept 2 — State, Action, and Behavior

Three words carry most of TLA+. Learn them once and the rest follows.

**State** = the values of all your variables at one instant. In the bank example, a state is just a pair like `(a = 100, b = 0)` or `(a = 70, b = 30)`. One snapshot. Nothing more.

**Action** = a rule connecting a state to a *next* state. This is where the famous **primed variables** come in. An unprimed variable like `a` means "its value now"; a primed variable like `a'` (read "a prime") means "its value in the next state." So:

```tla
x' = x + 1
```

reads as: *"the value of x in the next state equals the value of x now, plus one."* It is **not** assignment like `x = x + 1` in code. It's a *relationship* between two states: "a step where x goes up by one is allowed." An action can mention several variables; anything you don't constrain is free to be… well, that's a trap we'll cover in Common Mistakes.

**Behavior** = a *sequence* of states, each connected to the next by some action. One possible run of the system. Here's a behavior of the bank spec drawn out:

```text
state 0:  a = 100, b = 0      \ Init
   |  (Transfer with amt = 30)
state 1:  a = 70,  b = 30
   |  (Transfer with amt = 70)
state 2:  a = 0,   b = 100
```

That's *one* behavior. There are many others (transfer 50 then 50, transfer 1 a hundred times, …). **TLC's job is to generate and check them all.** It starts from `Init`, applies every possible action to reach new states, then every possible action from *those* states, and so on — exhaustively — until it has seen every reachable state or found a state that breaks a rule.

> **Key insight:** The whole of TLA+ is just *states* (snapshots) and *actions* (allowed steps between snapshots). A *behavior* is a path through that space, and TLC explores every path. If you can describe your design as "here's a state, here are the steps," you can model it.

---

## Core Concept 3 — Temporal Logic: □ "Always" and ◇ "Eventually"

So far we've talked about single states and single steps. **Temporal logic** is how you make claims about a *whole behavior over all of time* — and it's half of what makes TLA+ special, so go slowly here.

There are two symbols. They are not scary; they're shorthand for two ordinary English phrases.

**□ — the "box," read "always."** `□P` means *"P is true in **every** state of the behavior, forever."* For the bank:

```tla
□(a >= 0 /\ b >= 0)     \ "in every state, both accounts are non-negative"
```

This says: no matter how the run unfolds, at *every single step*, both balances are ≥ 0. If there's *any* behavior where some state has `a = -5`, then □ is false and TLC will show you that run. □ is the symbol of things that must *never* go wrong.

**◇ — the "diamond," read "eventually."** `◇P` means *"P is true in **some** state, at some point — sooner or later."* For a request/response system:

```tla
◇(responseSent = TRUE)   \ "at some point, a response is sent"
```

This says: the run can't just stall forever; eventually the good thing happens. ◇ is the symbol of progress — things that must *eventually* go right.

A picture of the difference, over one behavior (each box is a state, `P` marked where it's true):

```text
□P  ("always P"):     [P][P][P][P][P][P] …   every state — true here
◇P  ("eventually P"): [ ][ ][ ][P][ ][ ] …   at least one state — true here
```

`□` demands P in *all* states; `◇` demands P in *at least one* state. That's the entire distinction, and almost every property you'll ever write is built from these two.

You can even combine them. `□◇P` reads "always eventually P" — meaning P keeps happening over and over (no matter where you are, P will be true again later). That's how you say "the server keeps responding forever," not just "responds once." You won't need to write these yourself yet, but now you can *read* them.

> **Key insight:** Temporal logic gives you two words — *always* (□) and *eventually* (◇) — and that's enough to express the two things every system promises: "nothing bad ever happens" and "something good eventually does." Master □ and ◇ and you can read most specs.

---

## Core Concept 4 — Safety vs Liveness (and `~>`)

The two symbols line up with the two great categories of system correctness. This split is worth memorizing because it organizes how you think about *any* system, with or without TLA+.

**Safety = "nothing bad ever happens."** A safety property is something that must hold in every state — so it's a `□` property. "Balance never negative." "Two threads never hold the same lock." "The traffic light is never green in both directions." If safety is violated, there's a *specific finite point* where it breaks — and TLC can show you the exact step that did it.

```tla
SafetyExample == □(balance >= 0)              \ never go negative
MutexSafety   == □ ~(p1InCrit /\ p2InCrit)    \ never both in critical section ("~" = not)
```

**Liveness = "something good eventually happens."** A liveness property is about progress — so it involves `◇`. "Every request eventually gets a response." "The system doesn't deadlock." "The pending job eventually runs." Liveness failures are about getting *stuck forever* — the system does nothing wrong, it just never does the right thing.

The handiest liveness operator is **`~>`**, read **"leads to."** `P ~> Q` means *"every time P happens, Q eventually happens afterward."* It's the natural way to say "request leads to response":

```tla
\ "every request is eventually answered"
requested ~> responded
```

This is exactly the property a hung server violates: the request happened, but the response never comes. A `~>` check catches that.

| | Safety | Liveness |
|---|---|---|
| Slogan | "Nothing bad ever happens" | "Something good eventually happens" |
| Symbol | `□` (always) | `◇` (eventually), `~>` (leads to) |
| Failure looks like | A bad state is *reached* | The system gets *stuck forever* |
| Counterexample | A finite trace ending in the bad state | A loop where the good thing never occurs |
| Example | balance never negative | every request eventually answered |

> **Key insight:** Almost every correctness goal is either *safety* ("never do X" → □) or *liveness* ("eventually do Y" → ◇ / `~>`). Naming which one you mean — before you write the spec, before you write the code — sharpens your thinking even if you never open TLC.

---

## Core Concept 5 — PlusCal: Algorithms That Compile to TLA+

TLA+'s `Init`/`Action` style is precise but unfamiliar — it doesn't look like code. **PlusCal** is a friendlier front-end: you write something that *reads like pseudocode* (with `while`, `if`, assignments, and labels), and a translator turns it into TLA+ that TLC can check. For programmers, it's a far gentler entry point, and you can mix in plain TLA+ where you need it.

Here's the classic example: **two processes both incrementing a shared counter.** You expect the final value to be `2`. Whether it actually is depends on how the steps interleave.

```text
\ PlusCal (lives inside a TLA+ comment block)
--algorithm Increment {
  variable counter = 0;          \ shared variable, starts at 0

  process (P \in {1, 2}) {       \ two processes, named 1 and 2
    inc: counter := counter + 1; \ each does ONE increment
  }
}
```

Read as code: there's a shared `counter`, and two processes each run the single line `counter := counter + 1`. Looks obviously correct — two increments, final value 2, right?

Here's the subtlety, and it's the whole reason this example is famous. That one line is **not one step**. Underneath it's *read the counter, add one, write it back* — and the label `inc:` marks a point where the two processes can interleave. So this run is possible:

```text
counter = 0
  P1 reads counter (sees 0)
  P2 reads counter (sees 0)      \ P2 sneaks in before P1 writes
  P1 writes 0 + 1 = 1
  P2 writes 0 + 1 = 1            \ overwrites! the increment is LOST
counter = 1                      \ expected 2, got 1
```

This is the **lost update** — a real race condition. If you ask TLC to check `□(counter \in 0..2)` it passes, but if you check the property you actually *meant* — "after both run, `counter = 2`" — TLC instantly finds the interleaving above and prints it as a numbered counterexample. You didn't have to imagine the bad ordering; the tool tried every ordering for you and *found* it.

That is the junior payoff in one example: **a tricky concurrency bug, surfaced from a five-line model, before any real code exists.** Reproducing this same bug from actual threaded code might take days of stress testing and luck. Of course, where the steps split (the labels) determines what interleavings exist — getting that *granularity* right is a deeper skill the [middle.md](middle.md) covers.

> **Key insight:** PlusCal lets you write a design that looks like an algorithm, and TLC checks *every* interleaving of its steps. Concurrency bugs that hide from tests — because they need one rare ordering — are exactly what exhaustive interleaving exploration is built to expose.

---

## Real-World Examples

**1. Amazon (AWS) catches deep bugs in S3 and DynamoDB.** This is the story that put TLA+ on the industry map. Engineers at AWS wrote TLA+ specs for the designs behind core services — including S3 and DynamoDB — *before and during* implementation. TLC found subtle errors that would have caused data loss or corruption under rare event orderings, including one bug whose shortest counterexample was **35 steps long**. No human reviewer and no realistic test suite finds a 35-step interleaving by hand. The team reported (Newcombe et al., *"How Amazon Web Services Uses Formal Methods,"* CACM 2015) that the specs also let them make aggressive optimizations *with confidence*, because they could re-check the design. The lesson for you: TLA+ isn't academic — it ships in systems you use every day.

**2. A traffic-light controller that's never green-green.** A common teaching model: two roads, each light either red or green. The safety property is `□ ~(nsGreen /\ ewGreen)` — never both green at once. Model it, and TLC will tell you immediately if your "switch" logic has a window where both can be green during a transition. The model is a dozen lines; the bug it prevents is a crash.

**3. A one-bit clock (the "hello world" of TLA+).** A single variable that flips `0 → 1 → 0 → 1 …` forever. Trivial, but it teaches the whole loop: a state (the bit's value), an action (`b' = 1 - b`), a safety invariant (`b \in {0, 1}` — the bit stays a bit), and a liveness property (`□◇(b = 1)` — it keeps becoming 1, i.e., never gets stuck). If you can model the one-bit clock, you understand the machinery; everything bigger is more of the same.

---

## Mental Models

- **A spec is a board game's rule book, TLC is a player who tries every move.** The rule book (your spec) says which moves are legal from each position (state). TLC plays out *every* legal game to the end, looking for a position the rules said could never happen. A human plays a few games; TLC plays all of them.

- **States are photographs; actions are the rules for what the next photograph can look like.** A behavior is a flip-book of photographs. `□` is a property true in *every* photo; `◇` is a property true in *at least one*.

- **`'` (prime) is "next," not "assign."** `x' = x + 1` is a *claim about two adjacent photos* ("the next x is one more than this x"), not an instruction that runs. This is the syntax junior readers stumble on most — read prime as "in the next state."

- **Safety is a guardrail; liveness is a finish line.** Safety (□) keeps you from driving off the cliff at *any* moment. Liveness (◇) guarantees you eventually reach the destination. A parked car never crashes (safe) but never arrives (not live) — both matter.

- **The counterexample is the gift.** A failing test says "something's wrong." A TLC counterexample says "here is the *exact* 12-step sequence that breaks your rule." It hands you the reproduction you could never have written yourself.

---

## Common Mistakes

1. **Reading `x' = x + 1` as assignment.** It's a *relationship between this state and the next*, not a statement that executes. Prime = "in the next state." Internalize this early or every spec will read backwards.

2. **Confusing "TLA+ found a bug" with "my code has a bug."** TLA+ checks your *design/model*. A counterexample means the *design* is flawed (or your *property* is wrong) — not that some line of code is buggy. The whole value is catching it *before* code exists.

3. **Modeling the implementation instead of the design.** Juniors often try to transcribe real code line-for-line into TLA+. Don't. Model the *essential* states and steps — the smallest thing that captures the tricky part. A 200-line spec mirroring your code misses the point; a 15-line spec of the *protocol* finds the bug.

4. **Mixing up □ and ◇.** `□` = *every* state (always, safety); `◇` = *some* state (eventually, liveness). Saying `◇(balance >= 0)` ("balance is non-negative at some point") when you meant `□(balance >= 0)` ("…at every point") checks the wrong, far weaker thing.

5. **Forgetting that one code line ≠ one step.** As the lost-update example showed, `counter := counter + 1` is really read-modify-write. If you model it as a single atomic step, you *hide* the very race you were trying to find. Where steps split is the heart of concurrency modeling.

6. **Expecting TLA+ to verify performance or real-world behavior.** TLA+ reasons about *logical correctness* of a design — orderings, states, safety/liveness. It says nothing about latency, memory, or whether your actual code matches the spec. It's a design tool, not a profiler and not a substitute for tests of the implementation.

---

## Test Yourself

1. In one sentence each, define **state**, **action**, and **behavior** in TLA+.
2. What does `x' = x + 1` mean? Why is it *not* the same as the code statement `x = x + 1`?
3. Translate into English: `□(temperature < 100)` and `◇(doorOpen = TRUE)`. Which is safety and which is liveness?
4. You want to express "every login request eventually gets a response." Which operator fits, and roughly how would you write it?
5. In the two-process increment example, the final counter is sometimes `1` instead of `2`. In plain terms, what happened, and why would a normal unit test usually miss it?
6. Your TLC run prints a 7-step counterexample. Does this mean your *code* is broken? What does it actually tell you?

<details>
<summary>Answers</summary>

1. **State** = the values of all variables at one instant (a snapshot). **Action** = a rule allowing a step from one state to a next state (written with primed variables). **Behavior** = a sequence of states, each linked to the next by an action (one possible run).
2. It means "the value of `x` in the **next** state equals the current `x` plus one" — a *relationship between two adjacent states*. The code statement `x = x + 1` is an *instruction that executes and mutates a variable*; the TLA+ form is a *claim about what the next state may be*, with nothing "running."
3. `□(temperature < 100)` = "the temperature is **always** (in every state) below 100" — **safety**. `◇(doorOpen = TRUE)` = "the door is **eventually** open (at some state)" — **liveness**.
4. The **`~>` ("leads to")** operator: `loginRequested ~> loginAnswered` — "every login request is eventually followed by an answer." (`□(loginRequested => ◇loginAnswered)` expresses the same idea.)
5. Both processes **read** the counter as `0` before either **writes**, so both write `1`; one increment is **lost** (a race condition). A unit test usually misses it because it needs one *specific rare interleaving*, and a test only runs the orderings that happen to occur — TLC tries *all* orderings.
6. **No — it does not mean your code is broken** (there may be no code yet). It means your *design/model* permits a 7-step run that violates a property you stated — i.e., the **design is flawed** or the **property was written wrong**. Either way, it's a design issue caught early, and you get the exact 7 steps to reason about.

</details>

---

## Cheat Sheet

```text
WHAT TLA+ IS
  A language to describe how a system CHANGES OVER TIME (states + steps),
  so a tool (TLC) can explore EVERY possible run and find rule violations.
  You model the DESIGN, not the code. By Leslie Lamport (Turing Award).

THE FOUR WORDS
  state     = values of all variables right now (one snapshot)
  action    = rule: from a state like THIS, may step to a state like THAT
  behavior  = a sequence of states (one possible run)
  property  = a claim about a whole behavior (over all of time)

PRIMED VARIABLES (the #1 gotcha)
  x         = value of x NOW
  x'        = value of x in the NEXT state
  x' = x+1  = "next x is current x plus one"  (a relationship, NOT assignment)

TEMPORAL OPERATORS
  []P  (□, "always")      P is true in EVERY state         → SAFETY
  <>P  (◇, "eventually")  P is true in SOME state          → LIVENESS
  P ~> Q  ("leads to")    every P is eventually followed by Q
  []<>P ("always eventually") P keeps happening forever

SAFETY vs LIVENESS
  safety   = "nothing bad ever happens"   → []   → bad STATE reached
  liveness = "something good eventually"  → <>/~> → system STUCK forever

THE WORKFLOW
  1. write a tiny model (TLA+ or PlusCal) of the tricky design
  2. state your properties (safety with [], liveness with <>/~>)
  3. run TLC — it explores every reachable state
  4. read the COUNTEREXAMPLE: the exact steps that break a rule

PLUSCAL
  pseudocode-like front-end (while/if/labels) that compiles to TLA+
  labels mark where steps can interleave  →  finds lost-update races
```

---

## Summary

- **TLA+** describes a system as it **changes over time** — its states and the allowed steps between them — so the **TLC** checker can explore *every* possible run and report whether a rule can be broken, with an exact step-by-step counterexample. You **model the design, not the code**, which means you can catch design bugs *before writing any code*.
- The machinery is four words: a **state** is a snapshot of all variables; an **action** is a rule for stepping to a next state (using **primed variables** — `x'` is "x in the next state," a *relationship*, not assignment); a **behavior** is a sequence of states; a **property** is a claim about a whole behavior.
- **Temporal logic** gives you two essential operators: **□ ("always")** = true in every state, and **◇ ("eventually")** = true at some state. They map onto the two great categories: **safety** ("nothing bad ever happens," □) and **liveness** ("something good eventually happens," ◇ / `~>` "leads to").
- **PlusCal** is a programmer-friendly, pseudocode-like front-end that compiles to TLA+. Its labels mark where concurrent steps interleave, which is how TLC exposes races like the **lost update** — bugs that hide from ordinary tests because they need one rare ordering.
- **Amazon (AWS)** used TLA+ on S3 and DynamoDB and found deep design bugs (including a **35-step** counterexample) before shipping — proof this is a practical engineering tool, not an academic exercise.

Junior takeaway: for a tricky concurrent or stateful design, a small TLA+/PlusCal model plus TLC can surface ordering bugs *before you write a single line of code*. TLA+ is a **specification** language ([01](../01-formal-specification/junior.md)) that TLC **model-checks** ([02](../02-model-checking/junior.md)).

---

## Further Reading

- [Hillel Wayne — *Learn TLA+*](https://learntla.com) — the friendliest hands-on introduction, written for working programmers. Start here; it uses PlusCal heavily.
- [Leslie Lamport — *The TLA+ Video Course*](https://lamport.azurewebsites.net/video/videos.html) — the creator teaching the language from scratch, with worked examples.
- Newcombe, Rath, Zhang, Munteanu, Brooker, Deardeuff — *"How Amazon Web Services Uses Formal Methods"* (Communications of the ACM, 2015) — the S3/DynamoDB story, including the 35-step bug; readable and motivating.
- The [middle.md](middle.md) of this topic, which formalizes actions and the next-state relation, fairness, step granularity, and how to write specs that TLC can check efficiently.

---

## Related Topics

- [01 — Formal Specification](../01-formal-specification/junior.md) — TLA+ is one *specification* language; this is the broader idea of writing down a design precisely.
- [02 — Model Checking](../02-model-checking/junior.md) — *how* TLC explores every state and finds the counterexample.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md) — checking properties closer to real code (invariants, contracts) vs. modeling the whole design.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/junior.md) — deciding *which* designs are worth a TLA+ model and which aren't.
- [Backend → Distributed Systems](../../../../Backend/distributed-systems/) — the domain where TLA+ shines most: concurrency, ordering, and consensus.
