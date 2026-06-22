# Test Strategy & the Pyramid — Junior Level

> **Roadmap:** [Testing](../README.md) → Test Strategy & the Pyramid
> *Why a test suite has layers, and why most of your tests should live at the bottom.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- The one question a test strategy answers](#core-concept-1----the-one-question-a-test-strategy-answers)
5. [Core Concept 2 -- The three levels](#core-concept-2----the-three-levels)
6. [Core Concept 3 -- The pyramid shape](#core-concept-3----the-pyramid-shape)
7. [Core Concept 4 -- Why fast tests win](#core-concept-4----why-fast-tests-win)
8. [Core Concept 5 -- What goes where](#core-concept-5----what-goes-where)
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

> Focus: **why automated tests come in layers, and why the cheap fast layer should be the biggest.**

You can write thousands of tests. You cannot write *every* test — there is never enough time, and a slow test suite that nobody runs is worse than a small one that everybody runs. So every team faces the same trade: given finite time, **where do you spend testing effort?**

The **test pyramid** is the classic answer. It says: write many small fast tests, fewer medium tests, and only a handful of large slow ones. The shape — wide at the bottom, narrow at the top — is the whole point. This page teaches you the levels, the shape, and the simple rule for deciding where a given test belongs.

## Prerequisites

**Required**

- You have written or read at least one automated test (`assert something == expected`).
- You understand functions and return values in any one language.

**Helpful**

- Having run a test suite and waited for it to finish (so you have felt slowness).
- Basic idea of a "database" and an "API call" as things a program talks to.

## Glossary

| Term | Plain-English meaning |
|---|---|
| Unit test | Tests one small piece of code (one function/class) in isolation, no database or network. |
| Integration test | Tests that two or more pieces work together — e.g. your code plus a real database. |
| End-to-end (E2E) test | Drives the whole running system like a user would — through the UI or public API. |
| Test pyramid | A picture saying: many unit tests, fewer integration, very few E2E. |
| Feedback loop | How long you wait between making a change and learning whether you broke something. |
| Flaky test | A test that sometimes passes and sometimes fails without the code changing. |
| Test suite | All your tests, run together. |

## Core Concept 1 -- The one question a test strategy answers

A *test strategy* is not a tool or a framework. It is a plan that answers one question:

> **What do we test, at what level, and why?**

Without a plan, people test "what is easy to test" or "what they happened to think of." That produces suites that are slow, full of holes, and painful to maintain. A strategy makes the choice on purpose.

The first thing to get right is *level*. The same behaviour can often be checked at more than one level — and the level you pick changes how fast the test runs, how realistic it is, and how clearly it tells you what broke.

## Core Concept 2 -- The three levels

Start with three classic levels, from smallest to largest.

**Unit** — one function or class, by itself. No real database, no network, no clock you can't control.

```python
def discount(price, percent):
    return price - price * percent / 100

def test_discount():
    assert discount(100, 10) == 90   # runs in microseconds
```

**Integration** — your code plus one real collaborator, usually I/O: a database, a file, a queue, another service.

```python
def test_save_order_persists_to_db(db):
    repo = OrderRepository(db)          # real database connection
    repo.save(Order(id=1, total=90))
    assert repo.get(1).total == 90      # round-trips through SQL
```

**End-to-end (E2E)** — the whole system running, driven like a user.

```text
1. Start the app + database + frontend.
2. Open a browser, log in, add item to cart, check out.
3. Assert the confirmation page shows "Order #1234 placed".
```

Each step up adds *more real stuff*: more code exercised, more wiring proven, more realistic. It also adds *more cost*: more setup, more time, more ways to break for reasons unrelated to your change.

## Core Concept 3 -- The pyramid shape

Mike Cohn drew this in his 2009 book *Succeeding with Agile*. The widths show **how many tests of each kind you should have.**

```text
            /\
           /  \         E2E  -- very few, slow, realistic
          /----\
         /      \       Integration -- some, medium speed
        /--------\
       /          \     Unit -- many, fast, focused
      /____________\
```

The pyramid is **bottom-heavy on purpose**: most of your tests are cheap fast unit tests, a moderate number are integration tests, and only a few precious E2E tests cover the most important journeys.

Why not a rectangle (equal numbers everywhere)? Because the upper levels are expensive — in time, in flakiness, in maintenance. A test you can only afford a few of is a test you should *spend on the things that matter most*, not on every edge case.

## Core Concept 4 -- Why fast tests win

The deciding factor is the **feedback loop**: how quickly a failing test tells you *what* is wrong.

| | Unit | Integration | E2E |
|---|---|---|---|
| Typical speed | < 10 ms | 50 ms – 2 s | 5 s – minutes |
| When it fails it says... | "Line 42 returned 91, expected 90" | "The DB query is wrong" | "Something on the checkout page is wrong" |
| How often you can run it | every save | every commit | nightly / pre-merge |

A unit test fails in milliseconds and points at the exact line. An E2E test fails in minutes and points at "something, somewhere, in the whole stack." When you are mid-change, the fast precise signal is worth far more — you stay in flow, you fix the right thing, you run it again immediately.

A simple sum makes it concrete. Suppose you want 1,000 tests:

```text
1,000 unit tests   × 5 ms   = 5 seconds   (run on every save)
1,000 E2E tests    × 8 s     = 2.2 hours   (run... almost never)
```

Same count, wildly different usefulness. Speed is not a nice-to-have; it decides whether the suite gets run at all.

## Core Concept 5 -- What goes where

The allocation rule, in one line per level:

- **Business logic and edge cases → unit tests.** Pricing rules, validation, parsing, state machines, "what happens on the boundary." There are many of these and they are cheap, so cover them thoroughly down here.
- **Wiring and I/O → integration tests.** "Does my SQL actually save and load this object?" "Does my HTTP client parse this real response?" A handful per integration point.
- **Critical user journeys → E2E tests.** "Can a user sign up, buy, and get a receipt?" Only the journeys that *must* work. Not every variation — just the spine.

The trap to avoid: testing the *same* logic at multiple levels. If the discount math is fully covered by unit tests, do **not** also write ten E2E tests for discount edge cases. Test each thing **once**, at the **lowest level that can prove it.**

## Real-World Examples

**A login feature.**

- *Unit:* password hashing produces the right hash; "email must contain @" validation rejects `bob`.
- *Integration:* the user repository actually reads/writes the `users` table.
- *E2E:* one test — open the page, type a valid email + password, click Login, land on the dashboard.

Notice: one E2E covers the happy path; the dozens of validation cases live in fast unit tests.

**A shopping cart.** All the "add quantity, apply coupon, recompute total" math is unit-tested (dozens of cases). Integration tests confirm the cart saves to the DB. A single E2E proves a real user can check out.

## Mental Models

- **Pyramid, not rectangle.** If your test counts per level form a box (or worse, an upside-down pyramid), you will have a slow, flaky, hard-to-debug suite.
- **Cheap tests catch cheap bugs; expensive tests catch expensive bugs.** Spend the expensive tests only where the bug would be expensive (a broken checkout) — not on a typo in a label.
- **Test once, at the lowest useful level.** Climbing a level should buy you *new* confidence (real wiring), not repeat what a lower test already proved.

## Common Mistakes

- **Everything through the UI.** Writing all tests as browser/E2E tests because "that's how a user uses it." Result: a 40-minute, flaky suite. (This is the *ice-cream cone* anti-pattern — covered in [middle.md](middle.md).)
- **No strategy — test what's easy.** You end up with tests for getters and none for the gnarly pricing rule.
- **Duplicating coverage.** The same edge case tested as unit *and* integration *and* E2E. Slow, and three places to update when the rule changes.
- **Skipping the bottom.** Jumping straight to integration/E2E because "those feel more real." You lose the fast feedback that makes daily work pleasant.

## Test Yourself

1. Put these in order from most to fewest (per the pyramid): integration, unit, E2E.
2. A pricing rule has 12 edge cases. At which level should you cover all 12, and why?
3. Your suite takes 35 minutes and everyone skips it. Which level is probably too fat?
4. What does "feedback loop" mean, and why does a unit test have a better one than an E2E test?
5. True or false: each step up the pyramid is *more* realistic but *less* convenient. Explain.

## Cheat Sheet

```text
THE PYRAMID (bottom-heavy)
  E2E          few    slow    realistic    "something broke"
  Integration  some   medium  some wiring  "the DB query broke"
  Unit         many   fast    isolated     "line 42 is wrong"

ALLOCATION RULE
  business logic / edge cases  -> unit
  wiring & real I/O            -> integration
  critical user journeys only  -> E2E

GOLDEN RULES
  - test each behaviour ONCE, at the lowest level that proves it
  - fast feedback beats realism for day-to-day work
  - a suite nobody runs has zero value
```

## Summary

- A test strategy answers: **what to test, at which level, why.**
- Three levels: **unit** (one piece, fast), **integration** (pieces + real I/O), **E2E** (whole system, like a user).
- The **pyramid** says: many unit, fewer integration, very few E2E — because higher levels cost more in speed and flakiness.
- Put **logic at the bottom, journeys at the top**, and test each thing **once** at the lowest useful level.
- Fast precise feedback is what makes a suite actually get run.

## Further Reading

- Mike Cohn, *Succeeding with Agile* (2009) — the original pyramid.
- Martin Fowler, "TestPyramid" (martinfowler.com).
- The `unit-testing-patterns` skill — how to write the bottom layer well.
- The `test-driven-development` skill — how tests drive design.

## Related Topics

- [Unit Testing](../02-unit-testing/) — the wide base of the pyramid.
- [Integration Testing](../03-integration-testing/) — the middle layer.
- [End-to-End Testing](../04-end-to-end-testing/) — the narrow top.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — why upper layers misbehave.
- [Middle level](middle.md) — the competing shapes (trophy, honeycomb) and the allocation heuristic.
