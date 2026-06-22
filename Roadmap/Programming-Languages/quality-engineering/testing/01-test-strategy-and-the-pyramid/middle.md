# Test Strategy & the Pyramid — Middle Level

> **Roadmap:** [Testing](../README.md) → Test Strategy & the Pyramid
> *The pyramid is one shape among several — learn the trophy, the honeycomb, and the rule for picking the right one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 -- Shapes are answers to "where do bugs live?"](#core-concept-1----shapes-are-answers-to-where-do-bugs-live)
5. [Core Concept 2 -- The Testing Pyramid (Cohn)](#core-concept-2----the-testing-pyramid-cohn)
6. [Core Concept 3 -- The Testing Trophy (Dodds)](#core-concept-3----the-testing-trophy-dodds)
7. [Core Concept 4 -- The Honeycomb (Spotify)](#core-concept-4----the-honeycomb-spotify)
8. [Core Concept 5 -- The ice-cream cone anti-pattern](#core-concept-5----the-ice-cream-cone-anti-pattern)
9. [Core Concept 6 -- Sizes vs types: Google's small/medium/large](#core-concept-6----sizes-vs-types-googles-smallmediumlarge)
10. [Core Concept 7 -- The allocation heuristic](#core-concept-7----the-allocation-heuristic)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **the competing test-suite shapes, why "size" is a sharper axis than "type", and how to allocate tests so each one earns its keep.**

The pyramid is the default, not the law. For a React front-end, a microservice, or a thin CRUD API, a different shape catches more bugs per minute of CI time. This page covers the four shapes you will meet (pyramid, trophy, honeycomb, ice-cream cone), a more useful way to classify tests (Google's *sizes*), and a concrete heuristic for deciding where each test belongs.

## Prerequisites

**Required**

- Junior level of this topic: the three levels, the pyramid, the feedback-loop argument.
- You write unit and integration tests routinely in some language/framework.

**Helpful**

- Exposure to a mocking library and to a test that spins up a real database or HTTP server.
- A rough sense of your own project's CI duration.

## Glossary

| Term | Plain-English meaning |
|---|---|
| Testing Trophy | Shape with a fat *integration* middle; popularised by Kent C. Dodds for JS/front-end. |
| Honeycomb | Spotify's model for microservices: thin unit + integration core, few "implementation detail" tests. |
| Ice-cream cone | Anti-pattern: many slow E2E/manual tests on top, few unit tests below. |
| Test size (Google) | Classification by *resources* a test may touch (memory, network, disk), not by scope. |
| Small / Medium / Large | Google's sizes: small = single process no I/O; medium = single machine, localhost only; large = multi-machine/network. |
| Contract test | Verifies two services agree on a message format, without running both end-to-end. |
| Allocation | Deciding how many tests of each kind, and which behaviour goes at which level. |

## Core Concept 1 -- Shapes are answers to "where do bugs live?"

Every suite shape is implicitly answering: *where, in this kind of system, do defects actually occur — and where are they cheapest to catch?* The right shape follows from three properties of **your** system:

1. **Architecture.** A pure-logic library hides its bugs in algorithms (catch with unit tests). A microservice hides them at *boundaries* — serialization, HTTP, DB mapping (catch with integration/contract tests). A UI hides them in wiring components together.
2. **Change rate.** Code that changes often needs fast feedback, so push tests down. Stable boundaries can afford a few slower tests.
3. **Cost of a missed bug.** A wrong number in a payment service is catastrophic; a misaligned tooltip is not. Spend confidence where the blast radius is large.

There is no universally correct shape — only a correct shape *for a given system at a given time.*

## Core Concept 2 -- The Testing Pyramid (Cohn)

```text
        /\
       /E2\        few, slow, full system
      /----\
     / Integ\      moderate
    /--------\
   /   Unit   \    many, fast, isolated
  /____________\
```

Cohn's pyramid is the right default when **most of your complexity is in code logic** that can be exercised without I/O: business rules, calculations, algorithms, domain models. Classic back-end services with rich domains fit it well. The base is wide because logic has the most cases and they are cheapest to cover in isolation.

## Core Concept 3 -- The Testing Trophy (Dodds)

Kent C. Dodds argued that for **front-end / JavaScript** apps the pyramid mis-allocates: unit tests that mock everything around a component prove little, because most front-end bugs are in *how pieces wire together* and how a component behaves when rendered with its real children.

```text
        ___
       /E2E\        a few critical flows
      /-----\
     /       \
    | INTEGR. |     <- the fat middle: render real component trees
     \       /
      \-----/
       \Unit/        pure functions, small
        \_/
   ----static----    types + lint (the base)
```

The trophy has a **fat integration layer** and adds a **static** base (TypeScript types, ESLint) that catches a class of bugs before any test runs. Dodds's slogan: *"Write tests. Not too many. Mostly integration."* Use it when your bugs cluster in component composition and rendering rather than in deep logic.

```js
// Trophy-style "integration" test: render the real component tree, no deep mocks
test('submitting the form shows a success message', async () => {
  render(<CheckoutForm onSubmit={fakeApi} />);
  await userEvent.type(screen.getByLabelText('Card'), '4242424242424242');
  await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
  expect(await screen.findByText('Payment received')).toBeVisible();
});
```

## Core Concept 4 -- The Honeycomb (Spotify)

For **microservices**, Spotify (André Schaffer) proposed the *honeycomb*: lots of **integration tests**, a thin layer of unit tests, and very few "integrated" (cross-service / E2E) tests.

```text
   integrated tests   (thin top -- few, expensive, flaky)
  /                  \
 |  INTEGRATION TESTS |  (fat middle -- the bulk)
  \                  /
   implementation     (thin bottom -- isolated unit, only where logic is real)
```

The reasoning: a single microservice is usually **thin** — it receives a request, talks to a DB or another service, transforms data, responds. Its bugs live at the seams (HTTP, JSON, SQL), not in deep algorithms. So integration tests that exercise the service with real (or in-memory) infrastructure give the most confidence per test. *Integrated* tests across many services are kept few because they are slow and flaky — their job is largely replaced by **contract tests** (see [Concept 7](#core-concept-7----the-allocation-heuristic) and [Contract Testing](../05-contract-testing/)).

## Core Concept 5 -- The ice-cream cone anti-pattern

```text
  \                              /
   \   M A N U A L   T E S T S  /     <- biggest: humans clicking
    \--------------------------/
     \      E2E / UI tests     /      <- many, slow, flaky
      \----------------------/
       \   integration       /
        \------------------/
         \   unit          /          <- thinnest: almost none
          \--------------/
```

The pyramid turned upside down. It happens by **default**, not by decision: teams test through the UI because "that's how users use it," skip unit tests as "too granular," and lean on manual QA. The result is a suite that is slow (tens of minutes), flaky (UI timing), and uninformative (failures say "checkout broke" with no line number). If your CI takes 30+ minutes and people re-run failed jobs hoping they pass, you are probably standing on a cone. The fix is to **push coverage down** — re-prove logic in fast unit tests and delete redundant E2E cases.

## Core Concept 6 -- Sizes vs types: Google's small/medium/large

"Unit / integration / E2E" classifies by **scope** (how much code is exercised). Google's testing culture classifies by **size** — *what resources the test is allowed to touch* — and finds it more useful operationally.

| Size | May use | May NOT use | Speed target |
|---|---|---|---|
| **Small** | single process, single thread, in-memory | network, disk, real DB, `sleep`, system clock, multiple threads | < 100 ms |
| **Medium** | single machine, localhost (DB, server on loopback), multiple threads | network to other machines | < 1 s (cap ~minutes) |
| **Large** | multiple machines, real network, full environment | — (anything goes) | seconds to minutes |

Why size beats scope: the thing that actually makes a test **slow and flaky** is *touching shared, non-deterministic resources* — the network, the disk, the wall clock, real time. A "unit test" that calls `time.sleep()` or hits `localhost:5432` has the *cost profile* of an integration test no matter what you call it. Asking **"can this test touch the network/disk/clock?"** predicts speed and flakiness better than asking "is it a unit or integration test?"

```python
# Looks like a "unit" test by scope, but it's MEDIUM by size: it sleeps + uses the clock.
def test_token_expires():
    t = Token(ttl=1)
    time.sleep(1.1)          # <-- real clock, non-deterministic, slow
    assert t.expired()

# Same behaviour as a SMALL test: inject the clock.
def test_token_expires_small():
    clock = FakeClock(now=0)
    t = Token(ttl=1, clock=clock)
    clock.advance(2)
    assert t.expired()       # deterministic, microseconds
```

## Core Concept 7 -- The allocation heuristic

The decision rule for "where does this test go," combining everything above:

1. **Find the lowest level that can prove the behaviour.** Pure logic? Unit. Needs a real DB/HTTP round-trip? Integration. Needs the user-visible flow across the whole stack? E2E.
2. **Keep size small where possible.** Inject the clock, fake the network, use in-memory adapters — turn would-be medium/large tests into small ones.
3. **Cover each behaviour once.** If unit tests fully cover the discount matrix, integration/E2E should *not* re-test discount cases — they test *wiring*, not logic.
4. **Replace cross-service E2E with contract tests at boundaries.** Instead of booting six services to check service A talks to service B, write a contract: A's expectations of B, verified against B in isolation. (See [Contract Testing](../05-contract-testing/).)
5. **Reserve E2E for critical journeys only.** Sign-up, checkout, the one flow that loses money if it breaks — and just the spine of each.

Result: most behaviour is proven by fast small tests; a moderate set of integration tests proves the wiring and I/O; contract tests guard the seams between services; and a tiny, hand-picked set of E2E tests proves the whole machine assembles.

## Real-World Examples

**A React e-commerce front-end → trophy.** Static (TS + ESLint) catches typos and prop mismatches. A fat layer of React Testing Library tests renders real component trees ("clicking Add shows the cart badge incrementing"). Pure helpers (currency formatting) get small unit tests. Two or three Cypress E2E tests cover sign-up and checkout.

**A payments microservice → honeycomb/pyramid blend.** Deep money math is unit-tested exhaustively (pyramid instinct, because the logic is real and dangerous). The HTTP+DB seams get many integration tests (honeycomb instinct). A *contract* with the orders service replaces a flaky cross-service E2E.

**A 35-minute Selenium suite → an ice-cream cone being fixed.** The team finds that 80% of E2E cases re-test form validation already covered nowhere else. They move validation to unit tests, keep 6 journey E2E tests, and CI drops to 9 minutes.

## Mental Models

- **The shape is a consequence, not a choice.** Pick it from where *your* bugs live (architecture × change rate × cost of a miss), not from a blog post.
- **Size, not just scope.** "Can it touch the network/disk/clock?" predicts pain better than the unit/integration label.
- **Confidence is bought with money.** Every level up buys realism and pays in speed, determinism, and debuggability. Buy only where the realism is worth the bill.
- **Contract tests are E2E's cheaper substitute at seams.** Same goal (the services agree), a fraction of the cost.

## Common Mistakes

- **Cargo-culting the pyramid onto a front-end.** Mocking everything around a component yields green tests that prove nothing; the trophy exists for this reason.
- **Calling slow tests "unit tests."** Naming doesn't change cost; a sleeping/networking test is medium-sized whatever the folder it lives in.
- **Booting the whole world to test one seam.** Use contract tests instead of N-service E2E.
- **Redundant coverage across levels.** The same rule tested at unit, integration, *and* E2E — three places to maintain, triple the runtime, no extra confidence.
- **Letting the cone grow silently.** Nobody decides "let's invert the pyramid"; it happens when E2E is the path of least resistance. Watch CI time.

## Test Yourself

1. Your service is a thin HTTP→DB transformer with little logic. Pyramid, trophy, or honeycomb? Why?
2. A "unit test" calls `requests.get("http://localhost:8080")`. What *size* is it really, and what does that imply?
3. Give one behaviour that belongs in a unit test and one that belongs in a contract test, for the same microservice.
4. Why does the ice-cream cone usually appear by accident rather than on purpose?
5. The discount matrix is fully unit-tested. Where should it *not* be re-tested, and why?

## Cheat Sheet

```text
SHAPES (pick by where YOUR bugs live)
  Pyramid    rich domain logic            -> wide unit base
  Trophy     front-end / JS               -> fat integration + static base
  Honeycomb  microservices                -> fat integration, contracts at seams
  Cone       <ANTI-PATTERN>               -> too many E2E/manual; push coverage DOWN

SIZE (Google) -- the operational axis
  Small   no net/disk/clock/threads   < 100 ms   (prefer this)
  Medium  localhost only              < ~1 s
  Large   multi-machine / real net    seconds+

ALLOCATION
  lowest level that proves it  |  keep size small  |  cover once
  seams -> contract tests      |  E2E -> critical journeys only
```

## Summary

- The pyramid is the **default**, not the only shape. The **trophy** (fat integration + static) fits front-ends; the **honeycomb** (fat integration + contracts) fits microservices; the **ice-cream cone** is the anti-pattern you slide into by accident.
- Choose the shape from **where your bugs live**: architecture × change rate × cost of a missed defect.
- Classify by **size** (network/disk/clock?) not just scope — size predicts speed and flakiness.
- Allocate by the heuristic: **lowest level that proves it, keep it small, cover once, contracts at seams, E2E for critical journeys only.**

## Further Reading

- Kent C. Dodds, "The Testing Trophy and Testing Classifications."
- André Schaffer (Spotify), "Testing of Microservices" (the honeycomb).
- Mike Wacker (Google Testing Blog), "Just Say No to More End-to-End Tests."
- Google, *Software Engineering at Google*, ch. on test sizes.
- The `unit-testing-patterns` and `mocking-strategies` skills.

## Related Topics

- [Unit Testing](../02-unit-testing/) · [Integration Testing](../03-integration-testing/) · [End-to-End Testing](../04-end-to-end-testing/)
- [Contract Testing](../05-contract-testing/) — the cheaper substitute for cross-service E2E.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — how to shrink test size.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the tax on upper layers.
- [Senior level](senior.md) — designing a risk-based strategy under real constraints.
