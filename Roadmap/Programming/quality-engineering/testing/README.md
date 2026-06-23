# Testing Roadmap

> *"A test you don't trust is worse than no test — the failed one stops you, the trusted-but-wrong one ships the bug."*

This roadmap is about **the full taxonomy of automated tests** — what each level catches, what each level misses, where they sit in the dependency stack, and the disciplines (the pyramid, property-based testing, mutation testing, contract testing, BDD) that determine whether tests actually protect the code or just decorate it.

> Looking for *test-as-discipline* (TDD red-green-refactor, when it pays off)? Pair with the `test-driven-development` skill; the strategy view lives in [01 — Test Strategy & the Pyramid](01-test-strategy-and-the-pyramid/).
>
> Looking for *coverage* (line / branch / mutation coverage as a number)? That's its own section: [Code Coverage](../code-coverage/).
>
> Looking for *fuzzing, sanitizers, and runtime instrumentation*? See [Dynamic Analysis & Sanitizers](../dynamic-analysis-and-sanitizers/).
>
> Looking for the *source-level* rules that make tests readable? See [Clean Code](../../code-craft/clean-code/).

---

## Why a Dedicated Roadmap

Every engineer can name "unit, integration, E2E." A senior engineer knows:

- **Property-based** tests catch invariant violations that example-based tests never will
- **Mutation testing** measures the test suite — not the code — and is the only honest signal that your tests would catch a bug
- **Contract testing** is the *only* affordable way to test microservice boundaries without spinning up the whole world
- **Snapshot / approval** tests are usually a code smell — but sometimes exactly the right tool
- A **flaky** test is not a test problem, it's a trust problem, and one is enough to rot a suite

| Roadmap | Question it answers |
|---|---|
| [Performance](../performance/) | Is my code fast? |
| [Code Coverage](../code-coverage/) | How much of my code do tests exercise? |
| **Testing** (this) | Does my code actually do what I think it does? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-test-strategy-and-the-pyramid/) | Test Strategy & the Pyramid | The pyramid vs the trophy vs the honeycomb; what to test where; cost/confidence trade-offs; the strategy that governs all the rest |
| [02](02-unit-testing/) | Unit Testing | One unit, no I/O, no clock, no network; isolation, AAA, naming, what counts as a "unit"; fast feedback |
| [03](03-integration-testing/) | Integration Testing | Two or more components together; real DB vs in-memory; Testcontainers; the integration test pyramid |
| [04](04-end-to-end-testing/) | End-to-End Testing | The full stack from outside; brittle / slow / valuable; Playwright, Cypress, Selenium; keeping E2E sane |
| [05](05-contract-testing/) | Contract Testing | Pact / Spring Cloud Contract; consumer-driven contracts; the only affordable microservice-boundary test |
| [06](06-property-based-testing/) | Property-Based Testing | Hypothesis, jqwik, `proptest`, fast-check; invariants, generators, shrinking; finds inputs you'd never write |
| [07](07-mutation-testing/) | Mutation Testing | PIT, mutmut, Stryker, `go-mutesting`; what mutation score actually means; cost vs signal; testing your tests |
| [08](08-snapshot-and-approval-testing/) | Snapshot & Approval Testing | Jest snapshots, golden files, ApprovalTests; when they help, when they ossify, refresh discipline |
| [09](09-performance-and-load-testing/) | Performance & Load Testing | k6, Locust, Gatling, JMeter; closed vs open workload models; what load tests can and can't prove |
| [10](10-test-doubles-mocks-fakes/) | Test Doubles: Mocks & Fakes | Dummy / stub / fake / spy / mock — what each is for; classical vs mockist; the over-mocking trap |
| [11](11-test-data-management/) | Test Data Management | Factories, fixtures, builders; seeding, snapshotting, anonymisation, GDPR-safe seeds; determinism |
| [12](12-flaky-tests-and-reliability/) | Flaky Tests & Reliability | Root-cause taxonomy (timing, ordering, network, randomness); triage playbook; quarantine; suite trust |
| [13](13-testing-in-production/) | Testing in Production | Canaries, synthetic monitoring, feature-flag testing, shadow traffic, chaos; when prod is the only honest env |
| [14](14-acceptance-and-bdd/) | Acceptance & BDD | Behaviour specs, Gherkin/Cucumber, executable specifications; the three amigos; when the discipline pays off |

---

## Tiers

Every topic is written across five tiers, each a standalone page:

| Tier | File | For the reader who… |
|---|---|---|
| **Junior** | `junior.md` | is meeting the test type for the first time and needs the *what*, *why*, and a first test to run |
| **Middle** | `middle.md` | can write the tests and needs the working policy, the trade-offs, and the failure modes |
| **Senior** | `senior.md` | owns the strategy and must reason about it under constraints, at scale, and across teams |
| **Professional** | `professional.md` | sets org-wide testing standards, builds the platform, and weighs confidence, speed, and cost |
| **Interview** | `interview.md` | is preparing to be questioned on it — a question bank with model answers and what each probes |

---

## Languages

Examples in **Go** (`testing` + `testify`, `go test -fuzz`, Testcontainers-go), **Java** (JUnit 5, Mockito, Testcontainers, jqwik, PIT), **Python** (pytest, hypothesis, `pytest-bdd`, Locust, mutmut), **Rust** (`#[test]`, `proptest`, `cargo fuzz`), and **JS/TS** (Jest/Vitest, Playwright, Stryker, fast-check, Pact).

---

## References

- *Growing Object-Oriented Software, Guided by Tests* — Freeman & Pryce (the GOOS book)
- *xUnit Test Patterns* — Gerard Meszaros (the test-double vocabulary lives here)
- *Software Engineering at Google* — Winters, Manshreck, Wright (testing chapters on scale, flakiness, and test sizes)
- *Unit Testing Principles, Practices, and Patterns* — Vladimir Khorikov (the four pillars of a good test)
- *Working Effectively with Legacy Code* — Michael Feathers (testing as a wedge into untestable code)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
