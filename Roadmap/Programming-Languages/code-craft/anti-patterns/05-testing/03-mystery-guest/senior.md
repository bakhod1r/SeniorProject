# Mystery Guest — Senior Level

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *a test whose inputs or expected results come from outside the test, where the reader cannot see them.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Anatomy of a General Fixture](#anatomy-of-a-general-fixture)
4. [The Migration Strategy: Shared to Fresh, Safely](#the-migration-strategy-shared-to-fresh-safely)
5. [Builders vs. Object Mothers at Suite Scale](#builders-vs-object-mothers-at-suite-scale)
6. [The Speed Trade-Off: Fresh Fixtures Cost Time](#the-speed-trade-off-fresh-fixtures-cost-time)
7. [Making Necessary External Data Honest](#making-necessary-external-data-honest)
8. [A Worked Migration](#a-worked-migration)
9. [Common Mistakes](#common-mistakes)
10. [Test Yourself](#test-yourself)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Untangling a shared fixture across a whole suite** — migrating a General/Shared Fixture to fresh-per-test, choosing builders vs. object mothers, managing the speed cost that fresh fixtures introduce, and making the external data you genuinely need honest and discoverable.

`middle.md` showed you how to keep a Mystery Guest out of a *single* test. This level is about the systemic version: a suite where dozens or hundreds of tests share **one big fixture** — a `StandardTestData`, a seeded database, an `Object Mother` everyone reaches into. No single test is unreasonable; the *suite* is a tangle. Touch the shared fixture and a dozen unrelated tests flicker red. New tests don't add fresh data — they bolt onto the existing pile, because "that's how it's done here."

This is Meszaros's **General Fixture** (a fixture that serves many tests, so it's bloated and nobody-knows-which-bit-matters) sitting on top of a **Shared Fixture** (one instance reused across tests, breeding order-coupling). The two together are the Mystery Guest industrialized.

Untangling it is a *migration*, not an edit — you can't pause development to rewrite every test, and the shared fixture is load-bearing. The senior skills are: **migrating incrementally without breaking green**, **choosing the right local-data pattern** (builder vs. object mother), and **paying the resulting speed cost deliberately** rather than letting it push you back to sharing. The **test-data-management** and **integration-testing** skills are the day-to-day tools for this work.

---

## Prerequisites

- **Required:** Fluent with [`middle.md`](middle.md) — local/explicit/minimal data and Test Data Builders.
- **Required:** You've maintained a test suite of non-trivial size and felt a shared fixture break unrelated tests.
- **Required:** Comfort with transactions, test database lifecycle, and CI test timing.
- **Helpful:** You've owned a flaky CI pipeline and traced an intermittent failure to test-order coupling.

---

## Anatomy of a General Fixture

A General Fixture is the fixture that tried to please everyone:

```python
# Python — the suite's "standard" fixture, imported by ~200 tests
@pytest.fixture(scope="session")
def standard_data(db):
    org      = make_org(db, name="Acme")
    admin    = make_user(db, org=org, role="admin",  email="admin@acme.test")
    member   = make_user(db, org=org, role="member", email="mem@acme.test")
    gold     = make_customer(db, org=org, tier="gold", country="UK")
    standard = make_customer(db, org=org, tier="standard", country="US")
    catalog  = [make_product(db, sku=f"SKU-{i}", price=10 * i) for i in range(1, 21)]
    # ...orders, invoices, subscriptions, feature flags...
    return Namespace(org=org, admin=admin, gold=gold, catalog=catalog, ...)
```

Then 200 tests do this:

```python
def test_gold_discount(standard_data):
    price = quote(standard_data.gold, standard_data.catalog[8])   # SKU-9, price 90
    assert price == 81.00     # 90 − 10%... if SKU-9 is still 90, and gold is still gold
```

The pathologies, all at once:

- **Mystery Guest:** `standard_data.gold` and `catalog[8]` are defined 200 lines away in a session fixture. The reason `81.00` is right is entirely off-screen.
- **General Fixture bloat:** the fixture builds orgs, users, customers, a 20-item catalog, orders, invoices — almost none of which any given test needs. Nobody can tell which fields are load-bearing for which test.
- **Shared Fixture coupling:** `scope="session"` means *one* instance for the whole run. A test that mutates `gold.tier` poisons every later test that reads it — pass/fail now depends on order.
- **Change-amplification:** reprice `SKU-9` to fix one test and you silently break every test that happens to use `catalog[8]`.

This is the structure you're migrating away from.

---

## The Migration Strategy: Shared to Fresh, Safely

You can't big-bang rewrite 200 tests. Migrate incrementally, keeping the suite green at every step.

**Step 0 — Stop the bleeding.** Add a lint/review rule: *new tests may not extend `standard_data`.* New tests use local builders. The pile stops growing while you drain it.

**Step 1 — Narrow the fixture's scope.** Change `scope="session"` to `scope="function"` (fresh instance per test). This alone kills order-coupling — and will *expose* tests that were secretly relying on a mutation left by an earlier test. Those failures are information: they're the coupling you needed to find. Fix each by making its data local. (Expect this step to be slower; that's the trade-off, addressed below.)

**Step 2 — Make each test's relevant data local, one test at a time.** For each test, identify the *interesting* fields it depends on and build them with a local builder, dropping the dependency on `standard_data`:

```python
def test_gold_discount(db):                          # no more standard_data
    gold    = make_customer(db, tier="gold")         # the fact that matters, local
    product = make_product(db, price=90.00)          # the base, visible
    assert quote(gold, product) == 81.00             # 90 − 10%, derivable
```

**Step 3 — Shrink the fixture as tests leave it.** Every time a test stops using a field of `standard_data`, delete that field if nothing else needs it. The General Fixture withers as tests migrate off it.

**Step 4 — Delete it.** When the last test leaves, the fixture is gone. The suite now consists of self-contained tests, each with local data.

> **Characterize before you migrate.** Before narrowing scope, run the suite in **randomized order** (`pytest -p randomly`, `go test -shuffle=on`, JUnit `MethodOrderer.Random`). Every test that fails under shuffle is order-coupled — a Shared-Fixture victim. That list *is* your migration backlog, prioritized by how dangerous each coupling is.

---

## Builders vs. Object Mothers at Suite Scale

At suite scale you'll want a named, reusable way to make common objects. Two patterns compete:

- **Test Data Builder** — a fluent/parameterized constructor with sensible defaults; the *test* chooses overrides. Maximally explicit; the relevant fields appear in the test.
- **Object Mother** — a factory of *named canonical* objects: `Mother.goldCustomer()`, `Mother.bannedUser()`. Concise; the *intent* is in the name.

```java
// Object Mother — the name carries the meaning
Customer c = CustomerMother.goldUkCustomer();      // concise; "gold UK" is in the name

// Test Data Builder — the relevant fields are visible in the test
Customer c = aCustomer().withTier(GOLD).inCountry("UK").build();
```

Neither is a Mystery Guest *if used well* — both are visible at the call site and produce fresh objects. The risk is specific to the Object Mother: `goldUkCustomer()` hides *what* makes it gold-UK behind a method, so if a test asserts on the discount, the reader must open the Mother to confirm the tier. **An Object Mother becomes a Mystery Guest the moment a test's assertion depends on a field the Mother sets but doesn't reveal at the call site.**

Practical guidance:

| Use a **Builder** when | Use an **Object Mother** when |
|---|---|
| The test asserts on a property of the object (tier, balance, state) — that property must be visible | The object is *context*, not the thing under test (a valid logged-in user for an unrelated test) |
| You need many slight variations | A few canonical archetypes recur across the suite |
| Explicitness matters more than brevity | The name fully captures the intent (`expiredTrial()`) |

A common, healthy hybrid: **Object Mothers implemented as builders** — `CustomerMother.gold()` returns `aCustomer().withTier(GOLD)`, which the test can further override: `CustomerMother.gold().inCountry("DE").build()`. You get a named starting point *and* the ability to make the test-relevant override visible.

> The discriminator from `middle.md` generalizes: **data a test's assertion depends on must be visible in the test.** A Mother is fine for incidental context, dangerous for the thing under test. When in doubt, prefer the builder — explicitness is cheap insurance against the next reader's confusion.

---

## The Speed Trade-Off: Fresh Fixtures Cost Time

Here's the honest tension. A session-scoped fixture is built **once**; a fresh per-test fixture is built **N times**. If building it means inserting rows into a real database, fresh-per-test can turn a 30-second suite into a 5-minute one. The Mystery Guest cure (fresh, local data) directly worsens [Slow Tests](../05-slow-tests/senior.md) if applied naively. Pretending otherwise is how cargo-cult "always fresh fixtures" advice gets a team to revert to sharing.

Manage the cost deliberately:

- **Transaction rollback per test.** Wrap each test in a transaction and roll it back in teardown. The *schema* is set up once; each test's *data* is created and discarded cheaply, with perfect isolation. This is the default for DB integration tests and usually erases most of the fresh-fixture cost.
- **Build in memory, not in the DB, when the test allows it.** Many "integration" tests don't actually need persistence — a fresh object graph in memory is local, explicit, *and* fast. Push tests down the pyramid: most should never touch the database at all.
- **Share the immutable, not the mutable.** It's legitimate to build *truly read-only* reference data once per suite (a currency table, a static catalog) — the danger is sharing *mutable* state. Freeze what you share; build fresh what tests change. The Mystery-Guest risk remains (the shared data is still off-screen), so keep even shared immutable data small, named, and obviously reference-only.
- **Parallelize.** Fresh, isolated data is *prerequisite* for parallel tests — order-coupled shared fixtures can't be parallelized at all. So the cure that costs you serial time often *buys back* wall-clock time through parallelism the old fixture forbade.

> The trade-off is real but usually favorable: fresh-per-test costs CPU but buys **isolation, parallelizability, and trust**. Measure suite time before and after (`go test -count` timing, JUnit/Gradle build scans, `pytest --durations`), and apply transaction rollback before concluding fresh fixtures are "too slow." The choice is engineering, not dogma.

---

## Making Necessary External Data Honest

Some data genuinely must stay external — a 2 MB realistic API payload, a contract fixture shared with another team, a golden render. You can't and shouldn't inline it. The senior goal shifts from *eliminate the guest* to **make the guest announce itself**: discoverable, documented, regenerable, and scoped to the test that needs it.

Make external data honest with these moves:

- **Co-locate and name by test.** `testdata/render_invoice/gold_customer.golden`, not `testdata/expected1.txt`. The path tells the reader exactly which test owns it.
- **Generate it visibly, never hand-edit.** A documented `-update`/`--snapshot-update` flag (and a committed generator script) makes the file *reproducible* and tells the next person how it came to exist. A hand-edited golden file is a Mystery Guest nobody can regenerate.
- **Keep the input on-screen.** The expectation may be external, but the *input* should be a readable builder in the test. A golden test with both sides hidden is the worst case.
- **Diff on failure.** A golden assertion that prints `mismatch` is useless; one that prints a unified diff tells the reader what changed and whether it's a regression or an intended update.
- **Document why it's external.** A one-line comment — *"golden file: full rendered invoice is too large to inline; regenerate with `-update`"* — converts a mystery into a deliberate decision.

`professional.md` goes deeper on *when* external data is the right call (contract fixtures, large realistic payloads) and how to keep it from rotting.

---

## A Worked Migration

A suite of order tests leans on a session-scoped `standard_data`. We'll migrate one test and show the diagnostic that drives the rest.

**Before** — order-coupled and mysterious:

```python
@pytest.fixture(scope="session")
def standard_data(db):
    cust = make_customer(db, tier="gold", country="UK")
    cat  = [make_product(db, sku=f"SKU-{i}", price=10 * i) for i in range(1, 21)]
    return Namespace(cust=cust, cat=cat)

def test_gold_discount(standard_data):
    price = quote(standard_data.cust, standard_data.cat[8])   # which SKU? what price?
    assert price == 81.00                                     # why 81? unknowable here

def test_loyalty_upgrade(standard_data):
    standard_data.cust.tier = "platinum"      # MUTATES the shared customer!
    assert upgrade_reward(standard_data.cust) == "lounge_access"
    # every later test that reads standard_data.cust now sees platinum — order-coupled
```

**Diagnose:** run `pytest -p randomly`. `test_gold_discount` fails intermittently — when `test_loyalty_upgrade` runs first, `cust.tier` is `"platinum"`, so the gold discount no longer applies. The shuffle exposed the coupling.

**After** — fresh, local, derivable, isolated:

```python
def test_gold_discount(db):
    gold    = make_customer(db, tier="gold")     # the fact under test, local
    product = make_product(db, price=90.00)      # base price, visible
    assert quote(gold, product) == 81.00         # 90 − 10%, derivable on sight

def test_loyalty_upgrade(db):
    gold = make_customer(db, tier="gold")        # its own customer; can't poison others
    gold.tier = "platinum"
    assert upgrade_reward(gold) == "lounge_access"
```

Each test now owns its data. The mutation in `test_loyalty_upgrade` is harmless — it touches a customer no other test can see. `test_gold_discount` reads top-to-bottom and survives any order. Wrap both in a per-test transaction (rolled back in teardown) and the speed cost of building two customers instead of reusing one is negligible.

---

## Common Mistakes

1. **Big-bang rewriting the whole suite.** You'll break green for days and lose the team's trust. Migrate test-by-test behind a "no new uses of the fixture" rule.
2. **Narrowing fixture scope without expecting failures.** Going session→function *will* surface hidden order-coupling. Treat the new failures as the backlog they are, not as a regression you caused.
3. **Replacing a Shared Fixture with an Object Mother used for the thing under test.** If the test asserts on the tier, `Mother.goldCustomer()` still hides the tier. Use a builder (or a Mother-returning-builder) so the asserted property is visible.
4. **Reverting to sharing the moment the suite slows down.** The fix for fresh-fixture slowness is transaction rollback, in-memory tests, and parallelism — not abandoning isolation. Measure first.
5. **Sharing mutable reference data "because it's read-only."** If anything *can* mutate it, a test eventually will, and the coupling returns. Freeze shared data or build it fresh.
6. **Leaving a golden file hand-editable.** A golden file you can't regenerate from a command is a Mystery Guest that *also* drifts from reality. Make it generated, co-located, and diffed.

---

## Test Yourself

1. Distinguish **General Fixture**, **Shared Fixture**, and **Mystery Guest**. How do the three combine in a typical "standard test data" object?
2. Outline the incremental migration from a session-scoped fixture to fresh-per-test without breaking green.
3. What single command surfaces the order-coupling a Shared Fixture causes, and why does it work?
4. When does an **Object Mother** become a Mystery Guest, and what's the hybrid that avoids it?
5. Fresh-per-test fixtures made the suite 4× slower. List three legitimate ways to recover the speed *without* reintroducing shared mutable state.
6. A 2 MB golden payload genuinely can't be inlined. Name four things that make it honest rather than mysterious.

<details>
<summary>Answers</summary>

1. **General Fixture** = one fixture built to serve many tests, so it's bloated and nobody knows which fields matter for which test (a *content* problem). **Shared Fixture** = a single fixture *instance* reused across tests, breeding order-coupling (a *lifecycle* problem). **Mystery Guest** = a test reads data it doesn't show (a *readability/trust* problem). A "standard test data" object is all three: bloated (general), reused live (shared), and referenced off-screen (mystery).
2. (0) Forbid *new* uses of the fixture. (1) Narrow scope session→function to kill order-coupling and expose hidden dependencies. (2) For each test, build its interesting data locally via a builder and drop the fixture dependency. (3) Delete fixture fields as tests stop using them. (4) Delete the fixture when the last test leaves.
3. Running the suite in **randomized order** (`pytest -p randomly`, `go test -shuffle=on`, JUnit random orderer). It works because order-coupled tests pass only in a particular sequence; shuffling breaks that sequence, so every test relying on state left by another flips red — exactly the Shared-Fixture victims.
4. When a test's **assertion depends on a field the Mother sets but doesn't reveal at the call site** (e.g. asserting a gold discount while the tier is hidden inside `goldCustomer()`). The hybrid: implement Mothers *as* builders — `CustomerMother.gold()` returns `aCustomer().withTier(GOLD)` — so a test can make the relevant override visible: `CustomerMother.gold().inCountry("DE").build()`.
5. Any three: (a) wrap each test in a **transaction rolled back** in teardown (schema once, data cheap-and-isolated); (b) build the graph **in memory** for tests that don't truly need persistence, and push tests down the pyramid; (c) **parallelize** — fresh isolated data is the prerequisite the old fixture forbade; (d) share only **frozen, immutable** reference data, kept small and named.
6. Any four: co-locate and **name it by the test** that owns it; **generate it via a documented flag** (never hand-edit) with a committed generator; keep the **input visible** (a readable builder); **diff on failure** instead of a bare "mismatch"; add a **comment explaining why** it's external.

</details>

---

## Cheat Sheet

| Situation | Move |
|---|---|
| 200 tests share one big fixture | Migrate incrementally: forbid new uses → narrow scope → localize per test → shrink → delete |
| Suspect order-coupling | Run the suite shuffled; the failures are your backlog |
| Test asserts on an object's property | **Builder** (property visible), not Object Mother (property hidden) |
| Need a named canonical object as *context* | **Object Mother**, ideally returning a builder for overrides |
| Fresh fixtures slowed the suite | Transaction rollback → in-memory → parallelize → freeze shared reference data |
| Data genuinely must be external | Co-locate + name + regenerate-by-flag + visible input + diff + comment |

> **One rule to remember:** *isolation is non-negotiable; speed is negotiable. Make every test own its interesting data, then buy back the time with transactions, in-memory graphs, and the parallelism that isolation unlocks.*

---

## Summary

- The suite-scale Mystery Guest is a **General Fixture** (bloated, serves everyone) that is also a **Shared Fixture** (one live instance, order-coupled). No single test is wrong; the suite is a tangle.
- Untangle it as an **incremental migration**: stop new uses, narrow the fixture's scope to per-test (which *exposes* hidden coupling), localize each test's interesting data with builders, shrink the fixture as tests leave, then delete it. A randomized-order run gives you the prioritized backlog.
- At scale, choose **builders** when the test asserts on a property (it must be visible) and **object mothers** for incidental context; the safest hybrid is a Mother that returns a builder. The rule that data an assertion depends on must be visible never changes.
- Fresh-per-test fixtures **cost time** — the Mystery-Guest cure can worsen Slow Tests. Pay the cost deliberately with transaction rollback, in-memory graphs, frozen shared reference data, and the parallelism isolation unlocks. Measure, don't dogmatize.
- For data that genuinely must stay external, shift the goal from *eliminate* to **honest**: discoverable, named-by-test, regenerable, input-visible, diffed.
- Next: [`professional.md`](professional.md) — *the full trade-off analysis: when external/golden data is genuinely right (large realistic payloads, contract fixtures), how to keep it non-mysterious, and the deeper link between hidden data, fragility, and flakiness.*

---

## Further Reading

- **xUnit Test Patterns: Refactoring Test Code** — Gerard Meszaros (2007) — **General Fixture**, **Shared Fixture**, **Fresh Fixture**, **Mystery Guest**, **Obscure Test**, and the Object Mother / Test Data Builder remedies. The definitive treatment of everything in this file.
- **Working Effectively with Legacy Code** — Michael Feathers (2004) — characterization tests and seams; how to migrate a tangled suite without breaking it.
- **Unit Testing Principles, Practices, and Patterns** — Vladimir Khorikov (2020) — fixture lifecycle, the test pyramid, and the speed/isolation trade-off.

---

## Related Topics

- [Slow Tests](../05-slow-tests/senior.md) — the cost side of fresh-per-test fixtures and how to manage it.
- [Flaky Tests](../02-flaky-tests/senior.md) — order-coupling and shared state as flakiness root causes.
- [Fragile Tests](../01-fragile-tests/senior.md) — change-amplification from shared fixtures.
- [Over-Mocking](../06-over-mocking/senior.md) — the complementary "tests stop testing behavior" failure.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/senior.md) — refactoring tangled *production* structure safely.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — shared mutable state and coupling at the system level.
