# Testing Roadmap

> *"A test you don't trust is worse than no test — the failed one stops you, the trusted-but-wrong one ships the bug."*

This roadmap is about **the full taxonomy of automated tests** — what each level catches, what each level misses, where they sit in the dependency stack, and the disciplines (TDD, BDD, mutation testing, property-based testing) that determine whether tests actually protect the code or just decorate it.

> Looking for *test-as-discipline* (TDD red-green-refactor, when it pays off)? Pair with the [`test-driven-development`](../../../../skills/) skill.
>
> Looking for the *source-level* rules that make tests readable? See [Clean Code → Unit Tests](../../code-craft/clean-code/08-unit-tests/).

---

## Why a Dedicated Roadmap

Every engineer can name "unit, integration, E2E." A senior engineer knows:

- **Property-based** tests catch invariant violations that example-based tests never will
- **Mutation testing** measures the test suite — not the code — and is the only honest coverage signal
- **Contract testing** is the *only* affordable way to test microservice boundaries without spinning up the whole world
- **Snapshot tests** are usually a code smell — but sometimes the right tool
- **Fuzz testing** finds the inputs a human would never write — and the bugs a human would never see

| Roadmap | Question it answers |
|---|---|
| [Performance](../performance/README.md) | Is my code fast? |
| [Build Systems](../build-systems/README.md) | Can I reproducibly build it? |
| **Testing** (this) | Does my code actually do what I think it does? |

---

## Sections

| # | Topic | Focus |
|---|---|---|
| [01](01-unit-testing/) | Unit Testing | One unit, no I/O, no clock, no network; isolation, AAA pattern, naming, what counts as a "unit" |
| [02](02-integration-testing/) | Integration Testing | Two or more components together; real database vs in-memory; the integration test pyramid |
| [03](03-e2e-testing/) | E2E Testing | The full stack from outside; brittle / slow / valuable; Playwright, Cypress, Selenium |
| [04](04-contract-testing/) | Contract Testing | Pact / Spring Cloud Contract; consumer-driven contracts; the only sane microservice-boundary test |
| [05](05-property-based-testing/) | Property-Based Testing | Hypothesis (Python), QuickCheck (Haskell), `proptest` (Rust), jqwik (Java); shrinking, invariants |
| [06](06-fuzz-testing/) | Fuzz Testing | Coverage-guided fuzzing (`go test -fuzz`, `cargo fuzz`, libFuzzer, AFL); when fuzzing > unit tests |
| [07](07-mutation-testing/) | Mutation Testing | `pitest`, `mutmut`, Stryker; what mutation score actually means; cost vs signal |
| [08](08-load-testing/) | Load Testing | k6, Locust, Gatling, JMeter; closed vs open workload models; what load tests can't prove |
| [09](09-snapshot-testing/) | Snapshot Testing | Jest snapshots, golden files; when they help, when they ossify, refresh discipline |
| [10](10-test-doubles/) | Test Doubles | Dummy / stub / fake / spy / mock — what each is for; the over-mocking trap |
| 11 | Coverage | Line / branch / mutation coverage; what's a useful number, what's a vanity number |
| 12 | Flaky Tests | Root-cause taxonomy (timing, ordering, network, randomness); triage playbook; quarantine |
| 13 | Test Data Management | Factories, fixtures, builders; seeding, snapshotting, anonymisation, GDPR-safe seeds |
| 14 | TDD & BDD | Red-green-refactor in practice; behaviour specs; when the discipline pays off, when it doesn't |

> Sections 11–14 are planned but not yet scaffolded as sub-folders — they'll be added as content is filled in.

---

## Languages

Examples in **Go** (`testing` + `testify`, `go test -fuzz`), **Java** (JUnit 5, Mockito, Testcontainers, jqwik), **Python** (pytest, hypothesis, `pytest-bdd`, Locust), **Rust** (`#[test]`, `proptest`, `cargo fuzz`), and **JavaScript/TypeScript** (Jest, Playwright, Stryker, Fast-Check).

---

## Status

⏳ **Structure defined; 10 sub-folders scaffolded. Sections 11–14 planned. Per-topic files (junior / middle / senior / professional / interview) pending.**

---

## References

- *Growing Object-Oriented Software, Guided by Tests* — Freeman & Pryce (the GOOS book)
- *xUnit Test Patterns* — Gerard Meszaros (the test-double vocabulary lives here)
- *Property-Based Testing with PropEr, Erlang, and Elixir* — Fred Hébert
- *Software Engineering at Google* — Winters, Manshreck, Wright (testing chapters on scale)
- *Working Effectively with Legacy Code* — Michael Feathers (testing as a wedge into untestable code)

---

## Project Context

Part of the [Senior Project](../../../../index.md) — a personal effort to consolidate the essential knowledge of software engineering in one place.
