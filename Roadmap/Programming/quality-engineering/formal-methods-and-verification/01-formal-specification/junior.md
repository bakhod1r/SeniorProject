# Formal Specification — Junior Level

> **Roadmap:** [Formal Methods & Verification](../README.md) → Formal Specification
> *A comment says what you hope the code does. A formal specification says what "correct" actually means — precisely enough that you could check it. Writing one is where you catch the bugs you didn't know you had.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What a Specification Is (and Isn't)](#core-concept-1--what-a-specification-is-and-isnt)
5. [Core Concept 2 — Preconditions, Postconditions, Invariants](#core-concept-2--preconditions-postconditions-invariants)
6. [Core Concept 3 — Spec vs Test: One Rule vs One Example](#core-concept-3--spec-vs-test-one-rule-vs-one-example)
7. [Core Concept 4 — Safety vs Liveness](#core-concept-4--safety-vs-liveness)
8. [Core Concept 5 — Writing the Spec Is Where the Value Is](#core-concept-5--writing-the-spec-is-where-the-value-is)
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

> Focus: **What is a formal specification, and why write one before code?**

You already write specifications — you just write them informally. A function name (`sortAscending`), a comment (`// returns the user, or null if not found`), a ticket ("the cart total should never go negative") — each is an attempt to say *what the code should do*. The problem is that English is slippery. "Sort the list" — ascending or descending? Stable or not? What about duplicates? What about an empty list? The prose *feels* complete, but it's full of holes you only discover when the code breaks in production.

A **formal specification** closes those holes. It is a precise, unambiguous description of *what* a system should do, written in a language with exact meaning — logic, sets, functions — and kept separate from *how* you implement it (the code). "Sort the list" becomes: *the output is a permutation of the input **and** the output is in non-decreasing order*. Now there is nothing left to interpret. Two engineers reading that spec will agree on every case, including the empty list and the duplicates.

Here is the part nobody tells juniors: **the biggest payoff comes from writing the spec, not from any fancy tool that checks it.** The act of being *forced* to say exactly what "correct" means drags every fuzzy assumption into the light. You sit down to specify `withdraw(amount)` and immediately hit the question you'd have shipped a bug over — *what happens when `amount` is more than the balance?* The spec made you answer it *before* a customer's account went negative.

> **Mindset shift:** stop thinking "I'll write the code, then figure out the edge cases when tests fail." Start thinking "I'll write down precisely what *correct* means first — the preconditions, the postconditions, the things that must always hold — and the edge cases will announce themselves." A spec isn't extra paperwork; it's the cheapest bug-finding tool you own, because it finds bugs before the code exists.

This page is about that *mindset* — thinking precisely about what your code must guarantee. It is not about tool syntax. You'll meet the tools (TLA+, Alloy, Z) later in the roadmap; for now, the skill is learning to state a rule so exactly that it could be checked.

---

## Prerequisites

- **Required:** You can write and read a function in at least one language (examples use plain pseudocode plus a little Python).
- **Required:** You know what `if`, `return`, and a `null`/`None` value are.
- **Helpful:** You've written a unit test and understand it checks *one example*.
- **Helpful:** You've shipped a bug that, in hindsight, was an "I never thought about *that* case" bug. (Formal specs are the cure for exactly those.)
- **Not required:** Any mathematics beyond "and", "or", "not", and "for every". We define everything else.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Specification (spec)** | A precise description of *what* a system should do, separate from the code that does it. |
| **Formal** | Stated in a language with *exact* meaning (logic, sets), so there's no room to interpret it two ways. |
| **Informal** | Stated in prose or a comment — readable, but ambiguous. |
| **Precondition** | What must be true *before* an operation runs for it to be allowed to run. |
| **Postcondition** | What the operation *guarantees* is true *after* it finishes (given the precondition held). |
| **Invariant** | Something that is *always* true about a system — before and after every operation. |
| **Property** | A general rule that should hold for *all* inputs (e.g. "reversing twice gives back the original"). |
| **Safety** | "Nothing bad ever happens" — some forbidden state is never reached (balance never goes negative). |
| **Liveness** | "Something good eventually happens" — a desired thing is not delayed forever (a request eventually gets a reply). |
| **Permutation** | A rearrangement — same elements, possibly different order. (`[3,1,2]` is a permutation of `[1,2,3]`.) |
| **Lightweight formal methods** | Using a little precision (a property, a contract) for big payoff, without proving everything. |

---

## Core Concept 1 — What a Specification Is (and Isn't)

A specification answers one question: **what does "correct" mean for this thing?** It does *not* say how to achieve it. That separation is the whole point.

Take the most boring function imaginable — `abs(x)`, absolute value. Informally: "it makes the number positive." That's *wrong* and *vague*: `abs(0)` isn't positive, and "makes positive" doesn't say what happens to numbers that are already positive. Here is the same function, specified precisely:

```
SPEC of abs(x):
  if x >= 0   then   result == x
  if x <  0   then   result == -x
  (and the result is never negative)
```

Notice what just happened. Writing three precise lines forced us to handle `0` correctly and to think about both branches. The spec says nothing about *how* — you could implement it with an `if`, with bit tricks, with a lookup table — and it wouldn't care. It only pins down the *what*.

Now contrast informal and formal side by side for "sort a list":

| Informal (a comment) | Formal (a spec) |
|---|---|
| `// sorts the list` | `output` is a **permutation** of `input` **AND** `output` is in **non-decreasing order** |

The comment leaves four questions open (ascending? stable? duplicates? empty list?). The formal version answers all of them at once. "Permutation of the input" guarantees you didn't lose, add, or duplicate elements — a real class of sorting bugs that "sorts the list" never even mentions. "Non-decreasing order" handles duplicates cleanly (equal elements are fine) and is well-defined for the empty list (vacuously true).

> **Key insight:** a spec describes **what**, code describes **how**, and keeping them apart is what gives the spec its power. The spec becomes the *definition of correct* that you can check the code against. If you only have code, "correct" means "whatever the code happens to do" — which is circular and useless for finding bugs.

A spec doesn't have to be in a special tool to count as formal. The defining trait is **precision**: could two people disagree about whether the system meets it? If no, it's effectively formal. A carefully written property or a docstring with explicit pre/postconditions already crosses that line.

---

## Core Concept 2 — Preconditions, Postconditions, Invariants

Almost every spec you'll ever write is built from three pieces. Learn these three and you can specify most operations you'll meet.

**Precondition — what must hold *before*.** The operation is only obligated to work if the caller meets this. Think of it as the operation's terms of service.

**Postcondition — what's guaranteed *after*.** Given the precondition held, this is the promise the operation keeps.

**Invariant — what's *always* true.** It holds before *and* after every operation — it describes a property of the whole system, not one call.

Let's specify a bank `withdraw`:

```
operation withdraw(amount):
  PRECONDITION:   amount > 0  AND  amount <= balance
  POSTCONDITION:  balance_after == balance_before - amount
  INVARIANT:      balance >= 0      // true at all times, for every account
```

Read it as a contract. *If* the caller passes a positive amount no larger than the balance (precondition), *then* the new balance is exactly the old balance minus the amount (postcondition). And no matter what sequence of operations runs, the balance is never negative (invariant).

Writing those three lines did real work:

- The precondition `amount > 0` killed a bug class: withdrawing a *negative* amount (which would secretly *add* money).
- The precondition `amount <= balance` forced the question *"what about overdrafts?"* — you must now decide, deliberately, what happens when this is violated (reject? throw? allow overdraft up to a limit?). The spec made you choose instead of accidentally allowing it.
- The invariant `balance >= 0` is your safety net: any implementation that could ever break it is wrong *by definition*, even if every test passed.

Here's the same idea on a data structure — a `stack`:

```
INVARIANT:    size >= 0
SPEC of push(x) then pop():
  POSTCONDITION:  pop() returns x      // last pushed = first popped (LIFO)
                  size_after == size_before     // push then pop nets to zero
PRECONDITION of pop():  size > 0        // can't pop an empty stack
```

That precondition on `pop` — "size > 0" — is the spec catching the classic empty-stack bug *on paper*, before you write a line of stack code. This is the entire pitch for specs in one example: **the hard question shows up while you're specifying, which is the cheapest possible time to answer it.**

> **Key insight:** preconditions push responsibility onto the *caller* ("you must hand me valid input"); postconditions are the *implementer's* promise ("then I guarantee this result"). Invariants bind *everyone* ("this is always true, full stop"). Most "I never thought about that case" bugs are a precondition you didn't write down or an invariant you accidentally broke.

---

## Core Concept 3 — Spec vs Test: One Rule vs One Example

This is the distinction that makes specs click for most juniors, so go slow here.

A **test** checks **one example**. A **spec** states the rule for **all cases**.

A test for our sort function:

```python
def test_sort():
    assert sort([3, 1, 2]) == [1, 2, 3]   # one input, one expected output
```

That's a fine test. But it only proves the function works for *that one input*. A buggy `sort` that secretly returns `[1, 2, 3]` for *every* input would pass it. The test says nothing about `[]`, about `[5, 5, 5]`, about a million random lists.

The spec, by contrast, is a rule over *every possible* input:

```
for EVERY list L:
    sort(L) is a permutation of L
    AND sort(L) is in non-decreasing order
```

One says "this specific case works." The other says "the rule holds for everything." That gap is enormous: tests sample reality at a few points; the spec describes the whole surface.

You can feel the difference in **property-based testing**, the most junior-friendly bridge between the two. Instead of writing one example, you write the *property* (the spec rule) and let a tool generate hundreds of random inputs to try to break it:

```python
# property-based test — the spec, made executable against random inputs
@given(lists(integers()))
def test_sort_is_correct(L):
    out = sort(L)
    assert sorted_nondecreasing(out)         # postcondition 1
    assert is_permutation(out, L)            # postcondition 2
```

You wrote the *rule* (the two postconditions), and the framework throws hundreds of lists — empty, single-element, all-duplicates, huge, already-sorted, reverse-sorted — at it. This is "thinking like a spec" with a tiny amount of tooling, and it routinely finds the edge case your three hand-picked example tests missed.

> **Key insight:** a passing test means "it worked for the cases I happened to try." A spec means "here is the rule for *all* cases." Tests can never prove the rule holds everywhere — there are too many inputs — but writing the rule down (even just as a property) is what makes you *notice* the cases you'd never have hand-picked. Specs and tests aren't rivals: the spec tells you *what* to test, and property-based testing turns the spec into many tests at once.

---

## Core Concept 4 — Safety vs Liveness

Specs come in two great flavors, and naming them helps you make sure you've covered both.

**Safety — "nothing bad ever happens."** Some forbidden situation is *never* reached. These are the rules you can violate at a single, identifiable instant.

- A bank balance is **never** negative.
- Two threads are **never** in the critical section at the same time.
- A user **never** sees another user's data.

**Liveness — "something good eventually happens."** A desired outcome is *not delayed forever*. These are about progress.

- Every request **eventually** gets a response.
- A job submitted to the queue is **eventually** processed.
- A thread waiting for a lock **eventually** acquires it.

Here's the intuition for telling them apart. **A safety violation is a moment** — you can point at the exact instant it broke ("right *there*, the balance went to −5"). **A liveness violation is forever** — you can never point at a single instant and say "it failed here," because "eventually" hasn't run out yet; the failure is that the good thing *never* comes.

```
SAFETY  ("never bad"):        balance >= 0           — point to the bad instant
LIVENESS ("eventually good"): request gets a reply   — the good thing never arrives
```

Why does the distinction earn its keep at the junior level? Because **they fail differently and you check them differently.** A system can be perfectly safe and uselessly dead — a server that handles every request *by ignoring it* never makes the balance negative (safe!) but never replies either (no liveness). The reverse also bites: code that "always eventually does something" but occasionally does the *wrong* thing has liveness without safety. A good spec usually needs *both*: the safety rule says don't do anything bad, and the liveness rule says don't just sit there.

> **Key insight:** when you specify something, ask both questions. **Safety:** "what bad state must *never* happen?" **Liveness:** "what good thing must *eventually* happen?" Forgetting safety ships data leaks and negative balances. Forgetting liveness ships deadlocks and hangs that pass every test (the test finished; the system just never did the thing).

---

## Core Concept 5 — Writing the Spec Is Where the Value Is

This concept is the one to take with you even if you forget the rest. The famous payoff of formal methods isn't a tool stamping your design "verified." It's the *act of writing the spec*, because precision is a flashlight: you cannot write down exactly what correct means without confronting every assumption you were silently making.

Watch it happen. You're asked to build "transfer money from account A to account B." Easy, right? Now *specify* it precisely:

```
operation transfer(A, B, amount):
  PRECONDITION:   amount > 0
                  amount <= balance(A)          ← (1) what if A is too poor?
                  A != B                        ← (2) transfer to self?
  POSTCONDITION:  balance(A) decreased by amount
                  balance(B) increased by amount
  INVARIANT:      balance(A) + balance(B) unchanged   ← (3) money is conserved
                  every balance >= 0
```

Three questions surfaced *while writing the spec* that the one-line English ("transfer money from A to B") completely hid:

1. **What if A doesn't have the funds?** The precondition forced you to decide.
2. **What if A and B are the same account?** Without `A != B`, a sloppy implementation might double-count or zero out a balance. The spec made you see it.
3. **Is money conserved?** The invariant `balance(A) + balance(B) unchanged` is a *total-money* check. If an implementation ever credits B without debiting A (a real, classic concurrency bug), it violates this — and you specified the violation into existence *before writing any concurrency code*.

You found three potential bugs and you haven't compiled anything. That is the value, and it's mostly free — it costs a few minutes of honest thinking.

You don't need heavy machinery to capture this. **Lightweight formal methods** means spending a *little* precision for a *lot* of payoff:

- A docstring that lists explicit **preconditions and postconditions** instead of vague prose.
- An `assert` in the code that encodes an **invariant**, so a violation crashes loudly at the scene of the crime instead of corrupting data silently.
- A **property** for a property-based test, which is just a postcondition made executable.

```python
def transfer(A, B, amount):
    assert amount > 0 and A is not B          # precondition, checked
    total_before = A.balance + B.balance
    A.balance -= amount
    B.balance += amount
    assert A.balance >= 0                      # invariant, checked
    assert A.balance + B.balance == total_before   # conservation invariant, checked
```

Every `assert` there is a line of spec living inside the code. None of it required a special language or a proof. It is "thinking like a spec," and it turns a silent corruption into a loud, located crash — the difference between a five-minute fix and a week-long forensic investigation of bad data.

> **Key insight:** the spec earns its keep at the moment you *write* it — that's when the unanswered questions and hidden assumptions surface, which is the cheapest possible time to find them (before code, before tests, before production). Heavyweight tools that *check* specs (model checkers, proof assistants) add more value on top, but the first, biggest win is just being forced to say precisely what you mean.

---

## Real-World Examples

**1. The overdraft that a precondition would have caught.** A team ships a `withdraw` with no written precondition. Months later, a race lets two withdrawals run "at the same time," each reading the balance before the other writes — both succeed, and the account goes to −$340. Had anyone written the invariant `balance >= 0` and the precondition `amount <= balance` *as a spec*, the question "what enforces this when two withdrawals overlap?" would have come up during design. The bug was an unwritten invariant, not a typo.

**2. The property test that found the empty-list bug.** A developer writes `average(numbers)` and three example tests, all passing. A colleague rewrites it as a property — "for every non-empty list, `min(L) <= average(L) <= max(L)`" — and the framework immediately feeds it `[]`, exposing a divide-by-zero the example tests never hit. The property *was* a spec; it stated the rule for all inputs and instantly found the case the human hadn't pictured. (More in [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md).)

**3. Amazon specifying systems before building them.** Engineers at AWS wrote precise specifications of tricky distributed protocols *before* implementing them, and the act of specifying — plus checking those specs — surfaced subtle design bugs that would have been brutal to find in running code. Their public takeaway matches this whole page: writing the spec forced the hard questions early, when they were cheap to fix. (You'll meet the tool they used in [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md).)

**4. The "transfer to self" that zeroed an account.** A real payments bug: transferring money from an account to *itself* ran "debit then credit" in a way that, under a particular ordering, left the balance at zero. A spec with `A != B` in the precondition — or the invariant "total money is conserved" — names this exact bug. The one-line ticket ("let users transfer money") hid it; the spec would have shown it.

---

## Mental Models

- **A spec is the answer key; the code is a student's exam.** Without an answer key, you can't grade the exam — "correct" just means "whatever the student wrote." The spec is the independent definition of right answers that you check the code against. No spec, no grading.

- **Preconditions are the terms of service; postconditions are the guarantee.** "If you use this correctly (precondition), I promise this result (postcondition)." Break the terms of service and all bets are off. The invariant is the house rule that applies to everyone, always.

- **A test is a photo; a spec is the physics.** A photo shows one frozen instant ("the ball was here at this moment"). The physics (the rule) describes every instant for every ball. Tests photograph a few cases; the spec states the law they all obey.

- **Safety is a wall; liveness is a clock.** Safety says "never cross this line" — you can see the exact moment it's crossed. Liveness says "this must happen before time runs out" — and the failure is that the clock runs forever and it never happens.

- **Writing the spec is turning on the lights.** The bugs were always in the room (the unhandled cases, the broken assumptions). You didn't add them by writing the spec — you just stopped tripping over them in the dark.

---

## Common Mistakes

1. **Specifying *how* instead of *what*.** "Loop through the list and swap adjacent elements" is an implementation, not a spec — it bakes in bubble sort and can't tell you whether the result is *correct*. The spec is "output is a sorted permutation of the input"; the loop is one of many ways to satisfy it.

2. **Leaving preconditions implicit.** If you don't write "amount must be ≤ balance," you've silently decided overdrafts are allowed — usually by accident. Unwritten preconditions are where "I never thought about that case" bugs are born.

3. **Confusing a test with a spec.** Passing one example ≠ the rule holds for all inputs. A `sort` that always returns `[1,2,3]` passes `assert sort([3,1,2]) == [1,2,3]`. The spec is the rule; the test is one sample of it.

4. **Forgetting liveness (or forgetting safety).** A spec that only says "never do anything bad" permits a system that does *nothing* (safe but dead). A spec that only says "eventually do something" permits doing the *wrong* thing. Real specs usually need both.

5. **Writing a vague "spec" and calling it formal.** "The function should handle errors gracefully" is still prose — two people will read it differently. The test of formality: *could two engineers disagree about whether the code meets it?* If yes, it's not precise enough yet.

6. **Thinking specs are only for rocket science.** A docstring with explicit pre/postconditions, an `assert` encoding an invariant, or a property for a property-based test — these are *lightweight* formal methods, and they catch real bugs in ordinary CRUD apps. You don't need a special language to think precisely.

7. **Writing the spec *after* the code.** Then the spec just describes whatever the code already does (bugs included), and you've lost the entire benefit — finding the hard questions *before* you've committed to an implementation.

---

## Test Yourself

1. In one sentence each, explain the difference between a **specification** and an **implementation**, and between a **formal** and an **informal** spec.
2. Give a precise specification (precondition, postcondition) for `max(a, b)`, which returns the larger of two numbers.
3. A test asserts `reverse([1,2,3]) == [3,2,1]` and passes. Why does this *not* prove `reverse` is correct? State a **property** that captures the rule for all inputs.
4. Classify each as **safety** or **liveness**: (a) "the inventory count is never negative"; (b) "every submitted order is eventually shipped"; (c) "two users never get the same username."
5. You're asked to specify `divide(a, b)`. What is the obvious **precondition**, and what bug does writing it down prevent?
6. Why is the *writing* of a spec valuable even before any tool ever checks it? Answer with the bank-transfer example.
7. Turn this prose into a precise spec: "the cart total should reflect all items." (Hint: what's the invariant relating the total to the items?)

<details>
<summary>Answers</summary>

1. A **specification** says *what* the system must do (the definition of correct); an **implementation** is the code that *does* it (the how). A **formal** spec is stated precisely enough that two people can't disagree about its meaning (logic/sets); an **informal** spec is prose or a comment, open to interpretation.
2. **Precondition:** none needed (any two numbers work). **Postcondition:** `result == a OR result == b` (it returns one of the inputs) **AND** `result >= a AND result >= b` (it's at least as big as both). The second clause is the real content — "returns one of them" alone would allow returning the *smaller* one.
3. The test only proves `reverse` works for the single input `[1,2,3]`; a function that returns `[3,2,1]` for *every* input would pass it. A property for all inputs: **`reverse(reverse(L)) == L` for every list `L`** (reversing twice returns the original) — and optionally `len(reverse(L)) == len(L)`.
4. (a) **safety** (a "never bad" rule — you can point to the instant it goes negative); (b) **liveness** (an "eventually good" rule — progress must happen); (c) **safety** (a "never bad" rule — uniqueness violated at a specific moment).
5. **Precondition:** `b != 0`. Writing it down forces you to decide, deliberately, what happens on division by zero (reject? return an error?) instead of shipping a silent crash or a garbage result.
6. Writing the spec for `transfer(A, B, amount)` forces three questions the one-line description hid: *what if A lacks the funds* (precondition `amount <= balance(A)`), *what if A == B* (precondition `A != B`), and *is money conserved* (invariant `balance(A) + balance(B)` unchanged). You find three potential bugs before writing or running any code — that's the value, and it's independent of any checking tool.
7. **Invariant:** `cart.total == sum(item.price * item.quantity for every item in cart.items)` — and it must hold *after every* add, remove, or quantity change. Stating it as an always-true invariant (rather than "reflect all items") makes it checkable and pins down that the total must update on *every* mutation, not just on add.

</details>

---

## Cheat Sheet

```
WHAT A SPEC IS
  spec        = WHAT correct means   (the rule, the definition of right)
  code        = HOW you achieve it   (one of many ways)
  formal      = precise; no two readings possible
  informal    = prose/comment; ambiguous
  Test of formality: could two engineers disagree it's met? If yes → not formal yet.

THE THREE BUILDING BLOCKS
  PRECONDITION   what must hold BEFORE   (caller's duty — "valid input")
  POSTCONDITION  what's guaranteed AFTER (implementer's promise — "this result")
  INVARIANT      what's ALWAYS true      (binds everyone — before & after every op)

SPEC vs TEST
  test = ONE example   ("works for [3,1,2]")
  spec = the RULE      ("for EVERY list: sorted permutation of the input")
  property-based test  = the spec, run against hundreds of random inputs

SAFETY vs LIVENESS  (ask BOTH when you specify)
  SAFETY    "nothing bad EVER happens"   balance >= 0      (point to the bad instant)
  LIVENESS  "something good EVENTUALLY"   request gets reply (the good thing never comes)

LIGHTWEIGHT (junior-friendly) FORMAL METHODS
  docstring with explicit pre/postconditions
  assert encoding an invariant   → loud crash AT the bug, not silent corruption
  a property for property-based testing

THE ONE RULE TO REMEMBER
  Before coding, write down — precisely — what CORRECT means:
  the preconditions, the postconditions, the invariants.
  The hard questions surface while you WRITE the spec. That's the win.
```

---

## Summary

- A **formal specification** is a precise, unambiguous description of *what* a system should do — written so two people can't read it two ways — kept **separate** from the *how* (the code). "Sorts the list" (informal, four open questions) becomes "output is a permutation of the input AND is in non-decreasing order" (formal, zero open questions).
- Most specs are built from three pieces: a **precondition** (what must hold before — the caller's duty), a **postcondition** (what's guaranteed after — the implementer's promise), and an **invariant** (what's *always* true — binds everyone). Writing them forces the edge cases — empty stack, overdraft, transfer-to-self — into the open.
- A **test checks one example**; a **spec states the rule for all cases**. A passing test never proves the rule holds everywhere, but *writing the rule* makes you notice cases you'd never hand-pick. **Property-based testing** is the spec made executable against hundreds of random inputs.
- Specs come in two flavors, and good specs need both: **safety** ("nothing bad ever happens" — balance never negative) and **liveness** ("something good eventually happens" — every request eventually gets a reply).
- The biggest payoff is in **writing** the spec, not in any tool that checks it: precision is a flashlight that surfaces hidden assumptions and unanswered questions *before* you write code — the cheapest possible time to find a bug. **Lightweight** versions (a precise docstring, an `assert` for an invariant, a property) deliver most of this value cheaply.

You now have the mindset. Everything else in this section — **model checking**, **TLA+**, **contracts**, and **proofs** — is built on this one foundation: first say precisely what *correct* means, then check that the system meets it.

---

## Further Reading

- *Learn TLA+* — Hillel Wayne ([learntla.com](https://learntla.com)) and his blog. The friendliest on-ramp to thinking in specs; start with the "why specify?" framing before any syntax.
- *Software Abstractions* — Daniel Jackson. The book behind **Alloy**; its early chapters are a superb argument for modeling *what* before *how*. (Tooling appears in [02 — Model Checking](../02-model-checking/junior.md).)
- *The Pragmatic Programmer* — Hunt & Thomas. The chapter on **Design by Contract** is the gentlest introduction to preconditions, postconditions, and invariants in everyday code.
- *Specifying Systems* — Leslie Lamport (free PDF). The deep end on safety, liveness, and specification; skim the early chapters now, return after [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md).
- The [middle.md](middle.md) of this topic, which adds notation, state machines, and how specs scale to whole systems.

---

## Related Topics

- [02 — Model Checking](../02-model-checking/junior.md) — once you can *write* a spec, a model checker automatically searches for states that violate it.
- [03 — TLA+ & Temporal Logic](../03-tla-plus-and-temporal-logic/junior.md) — the language for specifying *what happens over time*, including liveness.
- [04 — Property & Contract Verification](../04-property-and-contract-verification/junior.md) — preconditions and postconditions made executable: contracts and property-based tests.
- [06 — When Formal Methods Pay Off](../06-when-formal-methods-pay-off/junior.md) — choosing how much precision is worth it, from a lightweight property to a full proof.
- [Testing](../../testing/) — where specs and examples meet: tests sample what the spec states for all cases.
