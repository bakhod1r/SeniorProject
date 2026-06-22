# Test Data Management — Interview Level

> **Roadmap:** [Testing](../README.md) → Test Data Management
>
> *A question bank for proving you can build data that is realistic, minimal, deterministic, isolated, and compliant.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Builders & Isolation](#builders--isolation)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering test-data questions the way a senior engineer does — with the trade-off, the concrete pattern, and the compliance line.**

Test data questions separate engineers who *write* tests from engineers who *own* test suites. Interviewers probe five layers: do you build minimal readable data; do you make tests deterministic; do you isolate tests; do you know where realistic data safely comes from; and do you understand the legal line on production data. This page gives model answers in **Q / what's really being tested / A** format.

---

## Prerequisites

- Solid grasp of builders, factories, fixtures, determinism, and isolation (see [Junior](junior.md), [Middle](middle.md)).
- Awareness of production-data risk and synthetic data (see [Senior](senior.md), [Professional](professional.md)).
- Comfort discussing GDPR/PII at a working level.

---

## Fundamentals

**Q1. Why is test data a first-class concern and not an afterthought?**
*Testing whether the candidate sees data as foundational to test quality.*
**A.** A test is only as trustworthy as its data. Bad data causes three failures: **false passes** (the data accidentally satisfies a broken assertion), **flakiness** (non-deterministic data fails at random), and **unreadable tests** (noisy data hides what the test is about). The goal is data that is *realistic enough* to be meaningful, *minimal enough* to be clear, and *isolated enough* to be deterministic. Those three tensions define the whole discipline.

**Q2. What is the single most important rule when constructing data for a test?**
*Whether they know the "only specify what matters" principle.*
**A.** Set only the data the test depends on; default everything else. Irrelevant fields are noise that hides intent. If you can delete a value and the test still means the same thing, that value should have been a default. This makes tests readable *and* robust to schema change, because the test couples only to what it overrides.

**Q3. Compare Object Mother, Test Data Builder, and factory.**
*Vocabulary precision and knowing when to use each.*
**A.** A **Test Data Builder** is a fluent helper with valid defaults plus `with_*` overrides — best for one-off shaping (`an_order().with_total(120).build()`). An **Object Mother** is a class of named methods returning canonical shapes (`Orders.paid()`) — best for a small, stable set of recurring shapes, but it rots into a junk drawer if overused. A **factory** (factory_boy/FactoryBot) mass-produces valid objects in one line, often persisted — best for bulk and DB-backed tests. They compose: a factory can use faker for scenery, a builder can wrap a factory.

**Q4. Static fixture files vs programmatic fixtures — which and when?**
*Whether they understand drift.*
**A.** Prefer **programmatic** (code-built) fixtures for anything a test acts on: they fail loudly when the model changes and express intent at the call site. **Static files** (JSON, SQL dumps) drift silently — a new field isn't reflected, so tests load half-built objects — but are fine for large, stable *reference data* (country codes, a catalog seed) where human-readability and load speed matter and nothing asserts on the specifics.

---

## Technique

**Q5. A test reads `now()` to build "a recent order." What's wrong and how do you fix it?**
*Determinism around time.*
**A.** It's non-deterministic: "recent" depends on when the test runs, so it passes for a window then fails forever (or on a leap day). Fix: never read the clock in data or in the code under test that the test can't override. Inject a fixed clock and compute relative dates from it (`created_at = FIXED_NOW - timedelta(days=5)`, assert with `is_recent(now=FIXED_NOW)`). Time is an input, not an ambient fact.

**Q6. How can random test data be reproducible, and what must you never randomise?**
*Seeded fakers.*
**A.** Seed the generator (`Faker.seed(12345)`) once globally in test setup. It then produces varied-looking but identical-across-runs data, so failures replay the same way locally and in CI. Never let the generator control a field the test *asserts* on — pin those. Faker fills the scenery (fields you ignore); the builder pins the subject (fields you check).

**Q7. Your test asserts `order.id == 10`. Why is that a smell?**
*Stable IDs and order independence.*
**A.** Auto-increment IDs depend on insertion order, which changes under parallelism or reordering, so the assertion is brittle. Assert on values you set (`order.total`), not on database-assigned surrogate keys. More broadly, never let a test depend on execution order; verify by running the suite shuffled.

**Q8. What is the "mystery guest" and how do you eliminate it?**
*Inline vs shared trade-off.*
**A.** A mystery guest is a test whose outcome depends on data defined far away (a 300-line `conftest` fixture), so you can't understand the test by reading it. Eliminate it by sharing the *builder* (DRY) but keeping the *override choices* local (readable): `a_customer().with_tier("gold").save(db)` puts the data the rule depends on right next to the assertion. The well-built test then doubles as documentation — inputs and expected output sit together.

---

## Builders & Isolation

**Q9. Walk me through a Test Data Builder you'd actually write.**
*Concrete implementation skill.*
**A.** Valid defaults in the constructor, chainable `with_*` returning `self`, a `build()` for in-memory and a `save(db)` for persisted use, all dates from an injectable clock, nested builders for related objects so callers stay silent about what they don't care about:

```python
class OrderBuilder:
    def __init__(self):
        self._customer = None
        self._items = [LineItem("DEFAULT", 1, 10.0)]
        self._status = "pending"
        self._created_at = CLOCK.now()      # injectable, never wall time
    def for_customer(self, c): self._customer = c; return self
    def with_total(self, t):   self._items = [LineItem("ITEM", 1, t)]; return self
    def build(self):
        return Order(self._customer or a_customer().build(),
                     self._items, self._status, self._created_at)
    def save(self, db):
        o = self.build(); db.add(o); db.flush(); return o
```

**Q10. List the isolation strategies between tests and when each applies.**
*Core isolation knowledge.*
**A.** In rough order of speed: **transaction rollback per test** (fastest; begin a txn, roll back in teardown — fails if the code commits its own transactions); **truncate-and-reseed** (reset tables to a known baseline; slower but commit-proof); **schema/database-per-worker** (the standard for parallel suites — writes can't collide); **namespacing/unique data per test** (`user-{uuid4()}@test.local` — for shared external systems you can't reset). Pick the cheapest that actually isolates your case. Isolation failures are the top cause of "passes alone, fails in the suite" flakiness.

**Q11. How do you isolate a *parallel* integration suite where the code commits its own transactions?**
*Applying the right strategy.*
**A.** Rollback won't work (the code commits) and shared tables collide across workers. Use **schema-per-worker** or an **ephemeral database per worker/run** — seed reference data into each, build test-case data per test inside it, discard at the end. If a shared external system is involved, add namespacing so each test's data is unique.

**Q12. How do you separate reference data from test-case data when seeding?**
*Layered seeding.*
**A.** **Reference data** (countries, plans, feature flags) is slow-changing scenery — seed it once per environment, idempotently, never assert on it. **Test-case data** is what a specific test acts on — build it per test, via factories, inside an isolation boundary. Never bake test-case rows into a shared seed; that hides branches (a feature passes because the seed only had the happy-path shape) and couples tests together.

---

## Scenarios

**Q13. A teammate proposes copying the production database into staging "for realistic test data." Your response?**
*The PII line — a hard disqualifier if they say yes.*
**A.** No — not raw. Production data contains real PII, and copying it into a lower environment (weaker controls, broader access, no consent) is a reportable data breach under GDPR/CCPA/HIPAA. "It's just for testing" is not a lawful basis; it also breaks the right to erasure, since you can no longer certify a user's data is deleted. The value of prod data is real, but capture it safely: **mask/anonymise** it at the boundary, **subset** it with referential integrity, or **generate synthetic** data that matches production's distribution without any real records.

**Q14. Distinguish masking, pseudonymisation, and anonymisation.**
*Compliance precision.*
**A.** **Masking** obscures a value while preserving shape (`****1234`), so format-dependent code still works. **Pseudonymisation** replaces identifiers with reversible tokens (keyed HMAC) — still legally personal data because re-identification is possible. **Anonymisation** is irreversible — outside most PII regimes — but hard to achieve, because quasi-identifiers (zip + birthdate + gender) can re-identify people even after names are gone. Whatever you choose must preserve **referential integrity** (consistent mapping so joins survive) and **distribution** (don't flatten ages to zero and destroy the realism).

**Q15. You're load-testing and need data. What matters that wouldn't matter for a unit test?**
*Performance data.*
**A.** **Volume** (production scale or beyond, so query plans and caches behave realistically), **skew** (hot keys — a few accounts with millions of rows — because uniform data hides the hotspots that break prod), and **cardinality** (distinct-value counts drive index selectivity and thus the plan). The dataset *is* the experiment; uniform tiny data makes the load test a lie. Synthetic generation is the only safe way to produce billions of realistic rows. See [Performance & Load Testing](../09-performance-and-load-testing/).

**Q16. How would you run test data for an org of twenty teams?**
*Strategy and ownership at scale.*
**A.** A **core builder library** owned by a platform team (composable, clock-injected, backward-compatible) with a **contribution model** for domain builders under enforced contracts; treat a broken core builder as P1. **Synthetic-data and masking pipelines** with lineage. **Data-on-demand** self-service so a compliant dataset takes seconds, not a ticket — because if the official path is slow, engineers copy prod. **Enforcement** via access controls, PII scanning, and CI provenance gates so the compliant path is the only path. A **refresh lifecycle** with a freshness SLA so data doesn't silently go stale and stop catching regressions.

**Q17. Tests pass in CI but you suspect the data is stale. Why is that dangerous, and what do you do?**
*Lifecycle awareness.*
**A.** Stale data is the most dangerous green: the suite passes against schemas and distributions that no longer match production, so it stops catching real regressions while looking healthy. Worse, when official data is stale, engineers improvise — and improvisation reintroduces prod copies. Fix: a scheduled refresh cadence (re-subset/re-mask or regenerate), an accountable owner with a data-age SLA, and versioned golden datasets so suites pin a known baseline and upgrade deliberately.

---

## Rapid-Fire

**Q. One-line definition of a Test Data Builder?**
A. Valid defaults plus fluent overrides for only the fields that matter.

**Q. Where should the data a test asserts on live — inline or shared?**
A. Inline (local), at the call site; share the builder, not the finished object.

**Q. How do you make faker reproducible?**
A. Seed it once, globally (`Faker.seed(N)`).

**Q. Fastest DB isolation strategy?**
A. Transaction rollback per test (when the code doesn't commit).

**Q. Isolation for a parallel suite?**
A. Schema/database-per-worker.

**Q. May you put raw production PII in staging?**
A. No — it's a data breach; mask, anonymise, or synthesise first.

**Q. Reversible identifier replacement is called?**
A. Pseudonymisation (still personal data).

**Q. What does masking-without-referential-integrity break?**
A. Foreign-key joins — the dataset becomes corrupt/unusable.

**Q. Why is uniform synthetic data bad for load tests?**
A. It hides hot keys/skew that actually break production.

**Q. Biggest hidden cost of test data?**
A. Stale data: a green suite that no longer reflects reality.

**Q. What proves a dataset's compliance to an auditor?**
A. Lineage — source, masking version, and generation date.

---

## Red Flags / Green Flags

**Red flags**
- "We just copy production to staging for realism." (PII breach.)
- Builds every field inline in every test, or shares finished fixtures everywhere.
- Uses `now()` in data; can't explain why a test is flaky.
- Thinks unseeded random data is fine, or asserts on random/auto-ID fields.
- "Anonymised" = "we removed the names" (ignores quasi-identifiers).
- Treats test data as a per-test chore with no strategy or owner.

**Green flags**
- Defaults the irrelevant, pins the relevant; tests readable at the call site.
- Injects the clock; seeds fakers; asserts only on set values.
- Names the right isolation strategy for the situation and justifies it.
- Draws a hard line on raw prod PII and reaches for masking/synthetic.
- Talks about builder-library ownership, lineage, refresh cadence, and enforcement.
- Frames test data as infrastructure *and* liability.

---

## Cheat Sheet

```text
PRINCIPLE     Set only what the test depends on; default the rest.
PATTERNS      Builder (one-off) | Object Mother (small stable set) | Factory (bulk/DB).
READABILITY   Share builders, keep overrides local → kills the mystery guest.
DETERMINISM   Inject clock (no now()); seed faker once; assert on set values, not IDs.
ISOLATION     rollback → truncate → schema/db-per-worker → namespacing.
SEED LAYERS   reference data once; test-case data per test in isolation.
PROD DATA     Never raw into lower envs. Mask | pseudonymise | anonymise | subset | synthesise.
COMPLIANCE    GDPR: purpose limitation, minimisation, erasure, residency; keep lineage.
SCALE         Owned builder lib + synthetic program + data-on-demand + enforcement + refresh.
PERF DATA     Volume + skew + cardinality; the dataset is the experiment.
```

---

## Summary

A strong interview answer threads all five layers: build **minimal, readable** data (default the irrelevant), make it **deterministic** (inject the clock, seed fakers, don't assert on IDs), keep tests **isolated** (rollback, schema-per-worker, namespacing), source realistic data **safely** (never raw prod PII — mask, anonymise, subset, or synthesise), and at scale run it as a **program** (owned builder library, synthetic pipelines, data-on-demand, enforcement, refresh). The disqualifier is casually proposing to copy production data with real PII; the differentiator is framing test data as both infrastructure to invest in and a liability to govern.

---

## Further Reading

- Gerard Meszaros, *xUnit Test Patterns* — fixtures, mystery guest, fresh vs shared.
- Nat Pryce, *Test Data Builders*.
- GDPR/ICO guidance on anonymisation and pseudonymisation.
- The `test-data-management` skill — patterns from fixtures to org-scale programs.

---

## Related Topics

- [Unit Testing](../02-unit-testing/) — builders and factories in their natural home.
- [Integration Testing](../03-integration-testing/) — isolation and seeding against a real DB.
- [Flaky Tests & Reliability](../12-flaky-tests-and-reliability/) — determinism and isolation as the cure.
- [Performance & Load Testing](../09-performance-and-load-testing/) — volume and skew in test data.
- [Test Doubles: Mocks & Fakes](../10-test-doubles-mocks-fakes/) — stand-ins vs real data.
