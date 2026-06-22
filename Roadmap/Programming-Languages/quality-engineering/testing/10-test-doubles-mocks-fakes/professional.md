# Test Doubles: Mocks & Fakes — Professional Level

> **Roadmap:** [Testing](../README.md) → Test Doubles: Mocks & Fakes
>
> *At scale, mocking discipline is a property of the organization, not the individual. The cost of brittle mock-based tests is paid in every migration the team is afraid to start.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Mock-Heavy Suites as an Organizational Liability](#core-concept-1--mock-heavy-suites-as-an-organizational-liability)
5. [Core Concept 2 — The Migration Tax of Brittle Mocks](#core-concept-2--the-migration-tax-of-brittle-mocks)
6. [Core Concept 3 — Organizational Guidance on Mocking](#core-concept-3--organizational-guidance-on-mocking)
7. [Core Concept 4 — Shared Fakes as First-Class Infrastructure](#core-concept-4--shared-fakes-as-first-class-infrastructure)
8. [Core Concept 5 — Keeping Fakes Honest at Scale](#core-concept-5--keeping-fakes-honest-at-scale)
9. [Core Concept 6 — Codifying "When a Mock Is Right"](#core-concept-6--codifying-when-a-mock-is-right)
10. [Core Concept 7 — Teaching the Taxonomy and Reviewing for It](#core-concept-7--teaching-the-taxonomy-and-reviewing-for-it)
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

> Focus: **steering mocking discipline across teams — recognizing mock-heavy suites as a design and migration liability, writing the guidance, providing shared fakes, and teaching the taxonomy so the whole org gets it right.**

An individual engineer can keep their own tests clean. A staff/principal engineer's job is to make the *default* clean across dozens of services and hundreds of contributors. The leverage points are different: you're writing the testing guideline, deciding whether to invest in shared fakes, reviewing for over-mocking as a recurring pattern, quantifying the cost of brittle suites to justify refactoring time, and teaching the vocabulary so that "stub," "mock," and "fake" mean the same thing in every code review.

The unifying theme: **mock-heavy test suites are an organizational tax that comes due during change** — every migration, dependency upgrade, and refactor is slowed by tests that break for reasons unrelated to behavior. Reducing that tax is a measurable engineering investment.

---

## Prerequisites

- The over-mocking trap, "don't mock what you don't own," and design-for-testability ([senior.md](senior.md)).
- Experience leading a non-trivial refactor or migration under test.
- Familiarity with contract testing as the external-dependency answer ([05-contract-testing](../05-contract-testing/professional.md)).
- You can read a test suite and diagnose its verification-style distribution.

---

## Glossary

| Term | Meaning |
|---|---|
| **Migration tax** | Extra effort a change incurs because brittle tests break for non-behavioral reasons. |
| **Mock ratio** | Rough proportion of tests that assert interactions vs state — a suite-health signal. |
| **Shared fake** | A maintained, reusable in-memory implementation of a common port (repo, clock, queue), provided as a library. |
| **Verified fake** | A fake proven faithful to its real counterpart by a shared contract test suite. |
| **Testing guideline** | Written org policy on when to use each double, what not to mock, and how to verify. |
| **Change-detector test** | Khorikov's term: a test that fails on every code change regardless of behavior — pure cost. |
| **Refactoring confidence** | The degree to which engineers trust the suite enough to change code freely. Eroded by brittle mocks. |

---

## Core Concept 1 — Mock-Heavy Suites as an Organizational Liability

A suite dominated by behavior verification has three compounding organizational costs:

1. **It blocks refactoring.** When internal restructuring reddens hundreds of tests, engineers stop refactoring. The codebase ossifies. The tests meant to *enable* change now *prevent* it — the opposite of their purpose.
2. **It hides regressions.** Tautological tests pass while behavior breaks (mocked return values masked the real defect). Teams gain false confidence; bugs reach production despite "100% green."
3. **It encodes bad design and resists improvement.** Mocks for eight collaborators document — and lock in — an SRP violation. Fixing the design means rewriting the tests, so nobody does.

The tell at the org level: **a high mock ratio correlates with low refactoring confidence.** Engineers say "I don't want to touch that, the tests will all break." That sentence is the symptom. Treat a pervasively mock-heavy suite the way you'd treat any systemic tech debt — measure it, attribute cost to it, and pay it down deliberately (the `technical-debt-management` material applies directly).

---

## Core Concept 2 — The Migration Tax of Brittle Mocks

The cost of mocks is rarely felt when they're written; it's felt years later, during change. Concrete scenarios where brittle mocks dominate the effort:

- **Swapping a dependency** (Postgres → DynamoDB, REST → gRPC). With wrapped ports and fakes, you rewrite one adapter and its integration tests. With direct mocks of the old client scattered across hundreds of unit tests, you rewrite *all* of them — the mocks were welded to the old interface.
- **Library major-version upgrade.** Mocks of a third-party type silently match the *old* signature; after upgrade the mocks are wrong but green, or break en masse. Wrapped + faked code is insulated: only the adapter changes.
- **Refactoring a hot module.** A behavior-preserving refactor should turn *no* tests red. With over-mocking, it turns dozens red, and engineers can't tell "I broke behavior" from "I changed a call the mock watched." Signal is lost in noise.
- **Splitting a monolith service.** Moving logic across boundaries reshuffles call graphs; interaction-verifying tests break wholesale even when behavior is preserved.

Quantify it for prioritization: *"Migration X is estimated at 6 weeks; ~4 of those are rewriting brittle mock-based tests that don't test behavior."* That framing turns "rewrite the tests to state-based/fakes" from a nicety into a **migration-enabling investment** with a number attached. This is how you win the budget to fix it.

---

## Core Concept 3 — Organizational Guidance on Mocking

Codify the discipline so it isn't relitigated in every PR. A practical testing guideline says:

```
MOCKING POLICY (testing guideline excerpt)
  1. Prefer real objects. Double only slow/nondeterministic/side-effecting collaborators.
  2. Prefer fakes over mocks. Use the team's shared verified fakes for repos, clock, queue, HTTP.
  3. NEVER mock a type you don't own (third-party SDKs, drivers, clients).
       → Wrap it behind a port you own; fake the port; integration-test the adapter.
  4. Default to STATE verification (assert results). Use behavior verification ONLY when
       the interaction IS the contract (event published, side effect required, call forbidden).
  5. If a unit needs >3 doubles, treat it as a design smell — refactor before adding mocks.
  6. Verify external reality with CONTRACT TESTS, not mocks.
```

Make it *enforceable and discoverable*, not just aspirational:
- **Lint where possible.** Custom rules / ArchUnit-style checks can flag direct imports of a third-party type inside test files, or cap `verify`/`assert_called` density.
- **PR template prompt:** "Any new behavior-verifying mocks? Could a fake + state assertion replace them?"
- **Reference implementation.** Point to one exemplary service that does it right; people copy patterns more than they read docs.

The goal is to make the *easy path the right path*: provide the fakes, set the defaults, and the policy mostly enforces itself. The `mocking-strategies` and `unit-testing-patterns` skills are the canonical references to link from the guideline.

---

## Core Concept 4 — Shared Fakes as First-Class Infrastructure

The single highest-leverage investment for reducing mock sprawl: **maintain shared, verified fakes for the common ports**, published as a library every team imports.

```go
// package testkit — shipped to every service.
//   testkit.NewClock(t0)        → controllable Clock fake
//   testkit.NewInMemoryUserRepo() → verified UserRepo fake
//   testkit.NewFakeQueue()      → records & replays messages
//   testkit.NewSeededRand(seed) → deterministic rand.Source
```

Why this matters at scale:
- **Quality once, used everywhere.** A well-built in-memory repo (correct round-trip, realistic errors, optimistic-locking semantics) written once beats hundreds of ad-hoc stubs of varying quality.
- **Consistency in review.** When everyone uses `testkit.NewClock`, reviewers recognize the pattern instantly; bespoke per-test clock fakes each need scrutiny.
- **It makes the right path the easy path.** If using the fake is one import and a constructor call, engineers won't hand-roll mocks.
- **Centralized fidelity.** When the real repo gains a behavior (e.g. a new constraint), you update the fake once and every consumer benefits.

Treat `testkit` like production code: owned, versioned, reviewed, documented. It is leverage — a few engineers' effort improving every test in the org.

---

## Core Concept 5 — Keeping Fakes Honest at Scale

A fake that drifts from reality is worse than a mock — it green-lights broken code with confidence. The discipline that prevents drift is the **shared contract test**: one suite of behavioral assertions run against *both* the fake and the real implementation.

```python
# Run the SAME suite against both implementations.
@pytest.mark.parametrize("make_repo", [
    lambda: InMemoryUserRepo(),          # the fake
    lambda: PostgresUserRepo(test_db),   # the real thing (integration tier)
])
def test_user_repo_contract(make_repo):
    repo = make_repo()
    repo.save(User(id=7, email="ada@x.io"))
    assert repo.get(7).email == "ada@x.io"
    with pytest.raises(DuplicateError):  # both must enforce uniqueness
        repo.save(User(id=8, email="ada@x.io"))
```

If the fake doesn't enforce the unique-email constraint the real DB does, this suite catches the divergence. Run the real-side parametrization in the integration tier (against an ephemeral DB / Testcontainers) and the fake side in the unit tier. This is the same principle as consumer-driven contract testing, applied internally to keep your *own* fakes faithful (cross-ref [05-contract-testing](../05-contract-testing/professional.md)). Without it, fakes rot silently — make it a non-negotiable for any shared fake.

---

## Core Concept 6 — Codifying "When a Mock Is Right"

To stop the pendulum swinging from over-mocking to dogmatic never-mock, the org needs a *positive* list of legitimate mock cases, so engineers don't feel they're violating policy when a mock is correct:

| Legitimate mock case | Why state verification can't replace it |
|---|---|
| "Publish exactly one `OrderPlaced` event" | The publication *is* the deliverable; no resulting state in the unit. |
| "Must not call the payment gateway for an empty cart" | Asserting a call's *absence* has no state equivalent. |
| "Emit an audit log entry on each privileged action" | The side effect is the requirement, not a return value. |
| "Retries the call exactly 3 times, then gives up" | The interaction *count/sequence* is the behavior under test. |
| Fire-and-forget notification where the SUT returns nothing | No observable state to assert. |

The rule to teach: **mock when the interaction is the contract; otherwise assert state.** And even then, verify the **payload and the count**, never just "something was called." This list belongs in the testing guideline next to the prohibitions — discipline is "use the right tool," not "never use this tool."

---

## Core Concept 7 — Teaching the Taxonomy and Reviewing for It

Vocabulary precision is an org-wide multiplier. When half the team calls every double a "mock," design discussions in review are mush. Invest in shared language:

- **Teach Meszaros's five explicitly** — dummy, stub, spy, mock, fake — in onboarding and the testing guideline. Insist on the words in review comments: "this is a stub, not a mock; we don't need `verify` here."
- **Review for verification style, not just coverage.** A PR with rising line coverage but all new behavior verification over mocks is often *negative* value. Ask: "What does this test prove if the implementation is correct but refactored?" (See the `code-review` material.)
- **Name the smell out loud.** "This is a change-detector test — it'll break on the next refactor and tells us nothing about behavior. Can we assert on the result with a fake?" Naming the pattern teaches faster than abstract rules.
- **Pair the rule with the fix.** Don't just reject over-mocking; point to the shared fake and the state-based pattern that replaces it. People adopt patterns they can copy.

The end state: every engineer can name the five doubles, defaults to fakes + state, knows the few cases where a mock is right, and never mocks a type the team doesn't own — because that's the documented, tooled, reviewed-for, taught default.

---

## Real-World Examples

- **The 4-week migration line item.** A team's DynamoDB migration estimate was dominated by rewriting direct DynamoDB-client mocks. The retrospective drove a `testkit` investment + a "wrap third-party clients" rule; the next migration was 70% faster.
- **`testkit` adoption.** A platform team shipped verified fakes for repos, clock, and the message queue. Within two quarters, new services' mock ratios dropped sharply and reviewers stopped re-reviewing bespoke clock fakes.
- **Contract-pinned fakes catch a drift.** The in-memory queue fake didn't preserve FIFO ordering the real broker guaranteed; the shared contract suite failed on the real side, exposing a bug a passing unit suite had hidden.
- **A guideline that codified mock-when-interaction-is-contract** ended a recurring review argument: the event-publishing assertions were *correct*, and the policy now said so explicitly.

---

## Mental Models

- **Mocks are a loan against future change.** Cheap to write, expensive to repay — and the bill arrives during your most important migrations.
- **Make the right path the easy path.** Ship the fakes and set the defaults; policy you have to enforce by willpower loses.
- **A verified fake is a contract, not a convenience.** Without the shared contract suite, a fake is just a confident liar.
- **Vocabulary is leverage.** When the whole org means the same thing by "stub" and "mock," reviews get sharper for free.
- **Discipline = right tool, both directions.** Neither "mock everything" nor "never mock." Codify the few cases each way.

---

## Common Mistakes

- **Treating over-mocking as a per-PR nitpick** instead of systemic debt with a measurable migration tax.
- **Banning mocks entirely**, pushing engineers into contorted state checks for genuine interaction contracts.
- **Shipping shared fakes without contract tests** — they drift and eventually green-light broken code org-wide.
- **Writing the guideline but not the tooling** — aspirational policy nobody follows because the easy path is still hand-rolled mocks.
- **Reviewing only coverage, not verification style** — rewarding change-detector tests that add cost, not safety.
- **Not quantifying the cost** — "mocks are bad" loses to "ship the feature"; "this saves 4 weeks next migration" wins budget.

---

## Test Yourself

1. Explain how a high mock ratio erodes refactoring confidence, with a concrete sentence engineers actually say.
2. You're scoping a REST→gRPC migration. How do brittle direct-client mocks change the estimate, and how would you have prevented it?
3. Draft three lines of a mocking policy for a testing guideline. Make them enforceable, not aspirational.
4. Why is a shared fake without a contract test more dangerous than a mock?
5. Give the org's positive list of "when a mock is right." What's common to every entry?
6. A PR raises coverage but adds ten behavior-verifying mocks. Write the review comment and the suggested fix.

---

## Cheat Sheet

```
MOCK-HEAVY SUITE = ORG LIABILITY
  blocks refactoring • hides regressions (tautological green) • locks in bad design
  symptom: "I won't touch that, the tests will all break"  ← low refactoring confidence

MIGRATION TAX
  dep swap / lib upgrade / refactor / monolith split → brittle mocks dominate the cost
  quantify it: "4 of 6 weeks = rewriting mocks that test no behavior" → wins budget

ORG GUIDANCE (make right path the easy path)
  policy: prefer real > fakes > mocks • never mock unowned • state by default • >3 doubles = smell
  tooling: shared verified fakes (testkit) • lint unowned-type imports in tests • PR-template prompt
  ref impl > docs

KEEP FAKES HONEST
  shared CONTRACT suite run vs fake AND real (parametrized)  ← non-negotiable
  drifting fake = confident liar, worse than a mock

WHEN A MOCK IS RIGHT (codify it)
  interaction IS the contract: publish exactly one event • forbid a call • audit • retry-count
  assert payload + count, never just 'called'

TEACH IT
  five doubles by name in onboarding • review verification STYLE not just coverage
  name the smell: "change-detector test" • pair every rejection with the fake-based fix
```

---

## Summary

At scale, mocking is an **organizational discipline**, and a mock-heavy suite is a **liability**: it blocks refactoring, hides regressions behind tautological green, and locks in bad design — the symptom being low refactoring confidence ("don't touch it, the tests will break"). The cost is paid as a **migration tax** during dependency swaps, library upgrades, and refactors, and the senior+ move is to *quantify* that tax so paying it down becomes a funded, migration-enabling investment. The levers are organizational: a written, **enforceable mocking guideline** (prefer real > fakes > mocks, never mock what you don't own, state by default, >3 doubles is a smell); **shared verified fakes** shipped as infrastructure so the right path is the easy path; **contract tests** that keep those fakes honest against the real implementations; a **positive list** of the few cases where a mock is genuinely correct (interaction-is-the-contract); and **teaching the precise taxonomy** plus reviewing for verification style, not just coverage. Get those right and clean mocking discipline becomes the org's default rather than each engineer's private battle.

---

## Further Reading

- Vladimir Khorikov — *Unit Testing Principles, Practices, and Patterns* (change-detector tests; the mock/state economics).
- Freeman & Pryce — *Growing Object-Oriented Software, Guided by Tests* (mock roles; only mock what you own).
- Google — *Software Engineering at Google*, the testing chapters (fakes, test doubles at scale, verified fakes).
- Martin Fowler — *Mocks Aren't Stubs*; *Test Double*.
- The `mocking-strategies`, `dependency-injection`, `unit-testing-patterns`, and `refactoring-techniques` skills.

---

## Related Topics

- [Unit Testing — Professional](../02-unit-testing/professional.md) — suite health and test economics at scale.
- [Integration Testing — Professional](../03-integration-testing/professional.md) — where adapters and the real side of fakes get verified.
- [Contract Testing — Professional](../05-contract-testing/professional.md) — org-wide contracts, including keeping fakes faithful.
- [Test Doubles — Interview](interview.md) — the question bank for this topic.
