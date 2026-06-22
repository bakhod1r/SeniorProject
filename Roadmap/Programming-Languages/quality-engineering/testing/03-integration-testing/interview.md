# Integration Testing — Interview Level

> **Roadmap:** [Testing](../README.md) → Integration Testing
>
> *Interviewers probe one thing here: do you know what real I/O catches that mocks can't — and can you keep that suite fast and honest?*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Real vs In-Memory](#real-vs-in-memory)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **a question bank that separates engineers who say "integration test" from those who can reason about fidelity, isolation, flakiness, and cost.**

Integration-testing questions are a reliable seniority filter. Juniors recite "tests components together." Strong candidates explain *which* bugs only real I/O catches, why in-memory databases lie, how they isolate state, how they keep the suite from flaking, and how they reason about its cost. Each question below gives the **Q**, *what's really being tested*, and a model **A**.

---

## Prerequisites

- The concepts across [junior](junior.md) → [professional](professional.md).
- Comfort speaking to Testcontainers, transaction isolation, WireMock, and CI.
- Ability to reason out loud about trade-offs, not just recite definitions.

---

## Fundamentals

**Q1. What is an integration test, and how is it different from a unit test?**
*Tests whether you understand the defining boundary, not a memorized slogan.*
**A.** A unit test exercises one unit with all collaborators replaced by test doubles — fast, no I/O. An integration test runs your real code against one or more *real* collaborators (a real database, broker, or HTTP server), crossing an actual I/O boundary. The dividing line is real I/O: if nothing real is exercised, it's a unit test no matter what you call it.

**Q2. Give three concrete bugs an integration test catches that a mocked unit test cannot.**
*The core value question — surface-level candidates blank here.*
**A.** (1) Wrong SQL — a bad column name, a join that duplicates rows, a `WHERE` that's off; the mock returns whatever you stubbed. (2) Serialization mismatches — a timestamp or JSON field that round-trips differently through the real engine/wire. (3) Transaction behaviour — whether a commit actually persisted or a rollback actually undid. Bonus: config/wiring and the gap between what the mock returns and what the real driver does (null vs throw vs empty Optional).

**Q3. Explain the "unit tests pass, system broken" problem.**
*Whether you grasp why integration tests exist at all.*
**A.** Unit tests with mocked collaborators can be entirely green while the system fails, because the mock never sees the seams — real SQL, serialization, config, transactions. CI goes green, production falls over on the first real request. Integration tests close exactly that gap by exercising the real boundary.

**Q4. Where does integration testing sit in the test pyramid, and why fewer than unit tests?**
*Strategy awareness and cost reasoning.*
**A.** In the middle: more than e2e, fewer than unit. They're 10–100× costlier than unit tests (real I/O, container startup, slower, flakier), so you spend them only where real I/O is the only way to catch the bug — boundaries — and push everything else down to unit tests.

**Q5. Distinguish narrow from broad integration testing.**
*Whether you know the spectrum exists.*
**A.** Narrow = your code + one real dependency (e.g. a repository against a real Postgres). Broad = several of your services wired together. Narrow tests are the sweet spot — most of the safety for a fraction of the cost. Broad tests are heavier, flakier, and fewer; for service-to-service agreement, contract tests are usually the better tool.

---

## Technique

**Q6. How do you give a test a real Postgres without a shared dev database?**
*Whether you know the modern default.*
**A.** Testcontainers — start the real Postgres engine in a throwaway Docker container scoped to the test or suite, run real migrations, run real code against it, then discard it. Same engine as production, no shared state, reproducible. Pin the image version (e.g. `postgres:16.4-alpine`), not `:latest`.

**Q7. How do you isolate state between integration tests?**
*Practical hygiene — order-dependence is a classic smell.*
**A.** Three patterns: truncate tables per test (`TRUNCATE ... RESTART IDENTITY CASCADE` — reliable default); transaction-rollback per test (fastest); or fresh container per test (strongest, slowest). Every test must bring its own data and pass in any order or alone — never depend on another test's leftovers.

**Q8. When does transaction-rollback-per-test silently fail?**
*A subtle gotcha that separates people who've actually done it.*
**A.** When the code under test manages its own transactions or commits explicitly (e.g. `REQUIRES_NEW`, an explicit `commit()`). The outer rollback can't undo a child commit, and you may never exercise the real commit path at all. If commit/visibility semantics matter to correctness, use truncate so the commit actually happens.

**Q9. You need to test code that calls a third-party payment API. How?**
*External-dependency handling and the contract boundary.*
**A.** Don't hit the real API — it's slow, rate-limited, non-deterministic. Stand up WireMock/MockServer returning canned responses, including failure modes (500, timeout, malformed body) to test retries and error handling. But know the limit: WireMock proves *my client handles this response*; it does **not** prove the provider actually sends that shape. That's contract testing (Pact). Use both.

**Q10. How do you assert on something that happens asynchronously (a Kafka consumer writes a row)?**
*The single biggest flakiness source.*
**A.** Never `Thread.sleep`. Poll-until-timeout (Awaitility or equivalent): repeatedly check the condition with a short interval up to a max timeout. It passes the instant the effect lands and fails fast with a clear message if it never does — fast and reliable, which sleep can never be both.

---

## Real vs In-Memory

**Q11. Why not use H2 or SQLite in-memory for speed instead of a real Postgres?**
*The single most important integration-testing trade-off.*
**A.** H2/SQLite are *different database engines*. Different SQL dialect, type handling, constraint timing, locking, and feature support. A test that passes against H2 can fail against production Postgres — so it gives false confidence, which is worse than no test. For database code there's no acceptable middle ground: use the real engine via Testcontainers. Rule: if it isn't your production engine, it can lie.

**Q12. Give a concrete example of "H2 passes, Postgres fails."**
*Whether you can make the trap concrete or only repeat it abstractly.*
**A.** An upsert: `INSERT ... ON CONFLICT (id) DO UPDATE SET balance = accounts.balance + EXCLUDED.balance`. H2 in PG-compat mode may misinterpret the conflict target or `EXCLUDED` and return a different affected-row count; the test goes green, but production Postgres applies the update differently and the balance is wrong. Also common: `jsonb`/array types, `timestamptz` timezone handling, `SELECT ... FOR UPDATE` locking — all faked or ignored by in-memory engines.

**Q13. Isn't mocking the database also an option?**
*Tests whether you know what each double actually proves.*
**A.** Mocking the DB is fine for *unit* tests of logic above the data layer, but it proves nothing about real SQL, serialization, or transactions — the mock only echoes what you told it. It's the lowest fidelity of the three (mock / in-memory / real) and shouldn't be confused with an integration test.

---

## Scenarios

**Q14. Your integration suite takes 25 minutes and the team stopped running it on PRs. Fix it.**
*The senior optimization story end to end.*
**A.** Profile the slowest 20 tests first. Typical wins: (1) per-test container startup → suite-level singleton container (+ local reuse); (2) full schema rebuild per test → migrate once, reset only data; (3) `Thread.sleep` waits → poll-until-timeout, often recovers minutes; (4) serial execution → parallelize with database-per-worker; (5) over-broad tests re-testing logic → demote to unit tests. Goal: under the team's patience threshold so it's run on every change — an unrun test protects nothing.

**Q15. A test passes locally but fails 1-in-15 in CI. Walk me through diagnosis.**
*Systematic flakiness reasoning.*
**A.** Reproduce by running the full suite in random order and in parallel locally. Check the usual causes: order dependence (state not reset), shared mutable state under parallelism (need database-per-worker/namespacing), `LIMIT` without `ORDER BY` (nondeterministic rows), wall-clock dependence (inject a fixed Clock), sleep-based async waits, or — in CI specifically — resource exhaustion (OOM masquerading as a flake; check runner memory). Fix the root cause; quarantine meanwhile. Never paper over a real product race with a retry.

**Q16. How would you run 200 integration tests in parallel against one Postgres without collisions?**
*Concrete parallelism design.*
**A.** Partition state: database-per-worker or schema-per-worker derived from the worker id, each migrated independently, on the same container. Avoid N workers truncating shared tables — they serialize on locks and clobber each other. Watch connection-pool exhaustion: workers × pool size can exceed `max_connections`; size pools down or raise the limit.

**Q17. How do integration tests run in CI, and what breaks?**
*Operational maturity.*
**A.** Own pipeline stage after unit tests (fail cheap first); Docker must be available on the runner (DooD/Ryuk on self-hosted); pin image digests; favour reproducibility over reuse (reuse is a local-dev feature). What breaks: missing Docker daemon, image-pull time on cold runners (use a registry mirror/pre-baked images), and resource limits — many "CI-only flakes" are OOM from too many containers × too much parallelism. Make it a required check only once flake rate is low; a flaky gate is worse than none.

**Q18. How do you decide whether a given behaviour gets a unit or an integration test?**
*The judgment question.*
**A.** Logic gets a unit test; the boundary gets an integration test. If you could delete the database from the test and it still proves the same thing, it should have been a unit test. Don't re-test the same business rule at two layers — the integration test for an endpoint should assert wiring (reachable, serialized, persisted), not re-enumerate every rule branch. Push fidelity to the lowest layer that catches the bug.

---

## Rapid-Fire

**Q19.** Default isolation strategy? — **A.** Truncate per test (`RESTART IDENTITY CASCADE`).

**Q20.** Fastest isolation strategy, with one caveat? — **A.** Transaction rollback; breaks if the code commits itself.

**Q21.** Why pin the container image version? — **A.** Reproducibility and to avoid silent engine drift from `:latest`.

**Q22.** WireMock vs Pact in one line? — **A.** WireMock tests *my* client against a stub; Pact verifies *both sides* agree.

**Q23.** Replacement for `Thread.sleep` in async assertions? — **A.** Poll-until-timeout (Awaitility).

**Q24.** One reason `LIMIT 5` tests flake? — **A.** No `ORDER BY` → nondeterministic row selection.

**Q25.** Should container reuse be on in CI? — **A.** No — local-dev only; CI wants reproducibility.

**Q26.** A "CI-only flake" most often is…? — **A.** Resource exhaustion (OOM), not non-determinism.

**Q27.** Preferred test environment over shared staging? — **A.** Ephemeral (Testcontainers) — no shared state, no cross-team flakiness.

**Q28.** Who should own shared test infra (base images, factories)? — **A.** A test-platform/DevEx team, as a product with SLAs.

**Q29.** How do large orgs avoid broad integration everywhere? — **A.** Per-service narrow integration + cross-service contract tests.

**Q30.** Should migrations be tested? Where? — **A.** Yes — run the real migration tool against a real engine in the test/CI.

---

## Red Flags / Green Flags

**Red flags:**
- Calls a mocked test an "integration test."
- Defends H2/SQLite for testing production Postgres SQL.
- Reaches for `Thread.sleep` and `@Retry` to handle flakes.
- Tests depend on execution order or a giant shared seed.
- Wants a shared long-lived staging DB as the default.
- Can't name a bug class that only real I/O catches.
- Enables container reuse in CI for "speed."

**Green flags:**
- Frames choices as fidelity-vs-speed and "cheapest faithful option."
- Gives a concrete H2-vs-Postgres divergence.
- Knows rollback-per-test breaks on self-committing code.
- Distinguishes WireMock (my side) from contract testing (both sides).
- Uses poll-until-timeout, injected clocks, explicit `ORDER BY`.
- Treats flakes as defects with root causes; quarantines, then fixes.
- Reasons about CI resource limits, cost per green, and shared-infra ownership.

---

## Cheat Sheet

```
DEFINITION:  real code + REAL dependency (DB/broker/HTTP); real I/O = the line
CATCHES:     wrong SQL · serialization · transactions · config · mock-vs-real gap
DEFAULT:     Testcontainers (real engine, pinned, disposable) — NOT H2/SQLite
H2 TRAP:     different engine → "passes in H2, fails in Postgres" false green
ISOLATION:   truncate (default) · rollback (fast; breaks on self-commit) · fresh
EXTERNAL:    WireMock (my client) vs CONTRACT test (both sides agree)
ASYNC:       poll-until-timeout, NEVER sleep; inject Clock; explicit ORDER BY
FLAKE:       root-cause + quarantine, never retry; CI flake often = OOM
SCALE:       suite-level container · db-per-worker · ephemeral > shared staging
LINE:        logic→unit, boundary→integration; don't re-test logic twice
```

---

## Summary

Integration-testing interviews reward concrete reasoning over vocabulary. Be able to name the bug classes only real I/O catches, explain why in-memory databases lie (with a real H2-vs-Postgres example), choose an isolation strategy and know where rollback-per-test breaks, distinguish WireMock from contract testing, and replace sleeps with poll-until-timeout. Then go up a level: keep the suite fast and honest with suite-level containers and database-per-worker parallelism, treat flakes as defects, and reason about CI resource limits, cost, and the ownership of shared test infrastructure. The candidates who stand out talk in trade-offs — the cheapest faithful option, fidelity vs speed, the cost of an unrun or untrusted suite.

---

## Further Reading

- The `integration-testing` skill — patterns and scaling.
- The `test-data-management` and `database-migration-patterns` skills.
- The `transaction-isolation` skill — isolation levels you'll be asked about.
- Testcontainers, WireMock, and Awaitility documentation.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — the contrasting layer.
- [Contract Testing](../05-contract-testing/) — the both-sides guarantee WireMock can't give.
- [Test Doubles, Mocks & Fakes](../10-test-doubles-mocks-fakes/) — what you choose not to use.
- [Test Data Management](../11-test-data-management/) — fixtures and reset.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — the flakiness discipline.
- [End-to-End Testing](../04-end-to-end-testing/) — the broadest layer.
