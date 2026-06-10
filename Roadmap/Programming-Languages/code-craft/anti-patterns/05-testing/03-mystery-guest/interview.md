# Mystery Guest — Interview Questions

> **Category:** [Testing Anti-Patterns](../README.md) → **Mystery Guest** — *a test whose inputs or expected results come from outside the test, where the reader cannot see them.*

---

This file is **interview preparation** spanning all four levels — from "define it" to "defend a fixture strategy in a design review." Each question has a model answer; read the question, answer it out loud, then check. The strongest answers connect the Mystery Guest to its consequences (fragility, flakiness) and know when external data is *right*.

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Diagnosis & Readability](#diagnosis--readability)
3. [Fixtures: Shared vs. Fresh](#fixtures-shared-vs-fresh)
4. [Builders, Object Mothers, Factories](#builders-object-mothers-factories)
5. [Golden Files & External Data](#golden-files--external-data)
6. [Consequences: Fragile & Flaky](#consequences-fragile--flaky)
7. [Trade-offs & Judgment](#trade-offs--judgment)
8. [Related Topics](#related-topics)

---

## Fundamentals

**Q1. Define the Mystery Guest anti-pattern.**

A test smell, named by Gerard Meszaros in *xUnit Test Patterns*, where a test reads its inputs or expected results from a source not visible in the test body — an external file, a seeded database row, a fixture set up far away, a golden file, an env var. The reader can't understand or trust the test without hunting elsewhere; the "guest" is the off-screen data the test depends on but never introduces.

**Q2. Why is it called a "Mystery Guest"?**

Because the test invites a guest — the data it depends on — but never introduces them to the reader. You can see that *someone* is at the table (the test uses the data), but who they are and where they came from is a mystery you have to leave the room to solve.

**Q3. What's the single-sentence test for whether a test has a Mystery Guest?**

Cover everything except the test body: can you still tell what it proves and *why* the expected value is correct? If you have to uncover a fixture, open a CSV, or query a database to answer, it's a Mystery Guest.

**Q4. Is a magic number like `assert total == 42` a Mystery Guest even though it's inline?**

Yes, in spirit. The value is physically present but its *meaning and origin* are hidden — you can't tell why 42 is correct. The real enemy isn't off-screen-ness, it's the reader's inability to determine the data's origin and meaning. Inline-but-unexplained is a mystery too; the fix is to derive the expectation from named, visible inputs.

**Q5. What are the related smells the Mystery Guest sits among?**

**Obscure Test** (the umbrella smell — a test that's hard to understand, of which Mystery Guest is one cause), **Shared Fixture** (one fixture instance reused across tests, causing coupling), and **General Fixture** (one bloated fixture serving many tests, so nobody knows which fields matter). The Mystery Guest is what you experience when reading; the others are structural causes.

**Q6. What are the three jobs of a test, and which does a Mystery Guest break?**

A test should (1) catch regressions, (2) document behavior, and (3) be trusted. A Mystery Guest primarily breaks (2) documentation — you can't learn the behavior by reading it — and (3) trust — red or green, you can't tell whether it's right. It often also undermines (1), because hidden shared data makes it pass for the wrong reasons.

---

## Diagnosis & Readability

**Q7. List the common disguises a Mystery Guest appears in.**

External file (`testdata/orders.csv`), seeded "magic" DB row (`findById(4071)`), far-away `setUp`/`@BeforeEach`, golden/snapshot file (hides the *expected output*), env var (`os.environ[...]`), and a shared constant/fixture list reused everywhere (`TEST_USERS[0]`). The common thread: the test *points at* data instead of *showing* it.

**Q8. A test loads a 500-row fixture to exercise a 2-row case. What's wrong, and what's the fix?**

It violates *minimal*: 498 of those rows are irrelevant, so the reader can't tell which data is load-bearing, and any change to the big fixture can break the test. Fix: build only the two rows the behavior needs, inline or via a builder. Minimal data makes the test's intent — and its expected result — obvious.

**Q9. Why is "the data's in `users.json`, so it's documented" not a sufficient defense?**

Documentation the reader must leave the test to consult is a tax paid on every read; the file can change without anyone noticing the test changed; and pointing at a file doesn't say *which rows* this test depends on or *why* the expected value follows. Self-explanatory means readable as a unit, not retrievable in principle.

**Q10. What does "the test should read top-to-bottom" mean concretely?**

Arrange (build the specific input), Act (run the thing), Assert (check a result derivable from the Arrange) — all on screen and in order, with the assertion following from the setup. You learn the behavior by reading the test linearly, never jumping to another file to follow the plot.

**Q11. How do you decide what setup belongs in `setUp`/`@BeforeEach` vs. in the test?**

Setup that is identical for every test *and* not the thing under test (a configured collaborator with no interesting state) can live in shared setup. Anything a test's *assertion depends on* — the "interesting" data whose change would change the expected result — must be in the test, next to the assertion that depends on it.

**Q12. Why does including irrelevant fields in an object count as a small Mystery Guest?**

Because the reader can't tell which fields matter. If a test sets `name`, `address`, `tier`, and `createdAt` but only `tier` affects the result, the reader wonders whether the address is load-bearing. Set only what matters; default the rest (a builder makes this easy). The relevant field should be the most visible thing in the test.

---

## Fixtures: Shared vs. Fresh

**Q13. What is a Shared Fixture, and why does it cause trouble?**

A single fixture *instance* reused across multiple tests (e.g. a session-scoped object or a seeded DB shared by the suite). It causes **test-order coupling** (one test mutating it changes another's behavior, so pass/fail depends on run order), **change amplification** (editing it breaks many tests at once), and **mystery** (the data is off-screen). It also blocks parallelism.

**Q14. What is a General Fixture, and how is it different from a Shared Fixture?**

A General Fixture is one fixture built to serve *many* tests, so it's bloated with data most tests don't need — a *content* problem (nobody knows which field matters). A Shared Fixture is about *lifecycle* — one instance reused across tests. They often coexist (a big `standard_data` reused everywhere is both), but they're distinct: you can have a fresh-per-test fixture that's still bloated (general), or a small fixture that's shared.

**Q15. What is a Fresh Fixture, and what's its main cost?**

A fixture built anew for each test, so every test is isolated. It cures order-coupling and mystery (the data is local) but costs **setup time** — paid N times instead of once. For DB tests that can be significant; the usual mitigation is a per-test transaction rolled back at teardown, so the schema is set up once and only the cheap data is fresh.

**Q16. How do you migrate a session-scoped shared fixture used by 200 tests to fresh-per-test without breaking the build?**

Incrementally: (0) forbid *new* tests from using it; (1) narrow its scope session→function, which exposes hidden order-coupling as failures; (2) for each test, build its interesting data locally via a builder and drop the dependency; (3) delete fixture fields as tests stop using them; (4) delete the fixture when the last test leaves. Run the suite in randomized order first to get the prioritized backlog of coupled tests.

**Q17. How do you *detect* test-order coupling in an existing suite?**

Run the suite in randomized order (`go test -shuffle=on`, `pytest -p randomly`, JUnit random orderer). Tests that pass in declared order but fail when shuffled are relying on state another test left behind — Shared-Fixture victims. The failing set is exactly the coupling you need to remove.

**Q18. When is sharing a fixture actually defensible?**

Only when *all* of: the fixture is **immutable** (frozen reference data), its setup is **genuinely expensive** (seconds — a container, a large model load), and **no test asserts on its hidden internals**. Even then, the usual better factoring is "share the infrastructure, not the data": share the expensive immutable layer (container/schema) once, but give each test fresh, isolated data via a rolled-back transaction.

**Q19. A shared fixture is mutable but "no test mutates it today." Safe to keep?**

No. *Can* be mutated means it eventually *will* be, and the coupling reappears as an intermittent failure that's expensive to diagnose. Freeze it (make it genuinely immutable) or build it fresh. The cost model only favors sharing immutable fixtures.

---

## Builders, Object Mothers, Factories

**Q20. What is a Test Data Builder?**

A small helper that constructs a valid object with sensible defaults and lets each test override only the fields it cares about (`aCustomer().withTier(GOLD).build()`). It gives local, explicit, minimal data without the duplication that pushes teams back to shared fixtures, and produces a fresh object per call.

**Q21. How does a Test Data Builder differ from a shared fixture constant, and why does it matter for Mystery Guest?**

A builder constructs a *fresh, parameterized* object *in the test*, exposing only overridden fields; a shared constant is one off-screen object reused everywhere. The builder keeps the relevant data local and explicit (no mystery) and gives each test an isolated object (no coupling). A `GOLD_CUSTOMER` constant reintroduces both the mystery and the coupling — it's the anti-pattern with a nicer name.

**Q22. What is an Object Mother, and when does it become a Mystery Guest?**

An Object Mother is a factory of *named canonical* objects (`Mother.goldCustomer()`, `Mother.bannedUser()`) — concise, with intent in the name. It becomes a Mystery Guest when a test's **assertion depends on a property the Mother sets but doesn't reveal at the call site** (asserting a gold discount while the tier is hidden inside `goldCustomer()`). It's fine for incidental context, dangerous for the thing under test.

**Q23. How do you get the benefits of both builders and Object Mothers?**

Implement Mothers *as* builders: `CustomerMother.gold()` returns `aCustomer().withTier(GOLD)`, which a test can further override — `CustomerMother.gold().inCountry("DE").build()`. You get a named, intent-revealing starting point *and* the ability to make the test-relevant override visible at the call site.

**Q24. Builder vs. Object Mother — give the decision rule.**

Use a **builder** when the test asserts on a property of the object (that property must be visible) or you need many variations; use an **Object Mother** when the object is incidental *context* (a valid logged-in user for an unrelated test) or a few canonical archetypes recur and the name fully captures the intent. When in doubt, prefer the builder — explicitness is cheap insurance.

**Q25. Why not just use the production constructor directly in every test?**

You can, but production constructors often require many arguments (most irrelevant to a given test), which reintroduces noise and obscures the one field that matters. A builder defaults the irrelevant arguments so the test mentions only the interesting one. It's the same goal — local, explicit, minimal — with less ceremony.

---

## Golden Files & External Data

**Q26. When is a golden/snapshot file the *right* choice rather than a smell?**

When the expected output is large and structural — a rendered invoice, a generated SQL migration, a formatted report, compiler output — so inlining it would be unreadable. The expectation's size is intrinsic to what you're testing. The smell isn't the golden file; it's making it *silent*.

**Q27. What makes a golden file honest rather than a Mystery Guest?**

Five things: (1) it's **co-located and named** for the specific test (`testdata/render_invoice/gold.golden`); (2) the **input is visible** (a readable builder, not a second mystery); (3) it's **regenerable via a documented flag** (`-update`), never hand-edited; (4) failures **print a diff**, not "files differ"; (5) snapshot changes are **reviewed like code** in PRs.

**Q28. What is "the snapshot trap"?**

Regenerating a golden file is so easy that humans stop scrutinizing it, so a green snapshot can certify a bug — the most insidious Mystery Guest, one that passes *and* lies. Defused by small reviewable artifacts, a visible input, mandatory diff-on-failure, and mandatory review of snapshot changes.

**Q29. Why is inlining a 4,000-line JSON payload also wrong?**

Because it makes the test unreadable in the opposite direction — the one fact under test drowns in noise, and a hand-trimmed copy risks losing the messy real shape the bug lives in. Large realistic payloads belong external (named, co-located), with the test asserting on *named, visible facts* extracted from them. The goal is *honest*, not literally *visible*.

**Q30. Why is sharing a contract fixture (e.g. a Pact file) across services correct, not a Mystery Guest?**

Because the *sharedness is the point* — it's the single source of truth both sides test against, and per-test copies would drift, defeating the contract. It's a *deliberate fixture*: owned, versioned, named, referenced explicitly. A fixture is judged by ownership, authority, mutability, and call-site honesty — not by "is it in a file."

**Q31. Distinguish a deliberate fixture from a Mystery Guest when both are "data in a file."**

By four properties: **origin** (owned/documented vs. accreted), **authority** (single source of truth vs. an unowned convenience copy), **mutability** (immutable/fresh vs. mutable-and-shared), and **call-site honesty** (identity + asserted facts visible vs. silent dependence on unseen fields). Same shape, opposite diagnosis.

---

## Consequences: Fragile & Flaky

**Q32. How does a Mystery Guest cause Fragile Tests?**

The hidden data is usually *shared*, so one off-screen edit — reprice a SKU, change a seed row — breaks every test that silently depended on it. The edit and the breakage are far apart, so the failure looks unrelated and mysterious: the defining feature of a Fragile Test. Local data confines the blast radius to the one test that owns it.

**Q33. How does a Mystery Guest cause Flaky Tests?**

When the hidden shared data is *mutable*, one test mutating it changes another's behavior, so the suite passes or fails by **run order** — and parallelism makes the order nondeterministic. The flakiness's root cause is a Mystery Guest (shared mutable state), not a race in the code under test. Fresh-per-test data removes the class of failure.

**Q34. A CI suite is intermittently red and failures correlate with test order. Where do you look first?**

A shared fixture / shared mutable state — a Mystery Guest — not the code under test. Confirm by running shuffled; the order-dependent failures are the coupled tests. Chasing each flaky failure individually is endless when the root cause is structural; eliminate the shared fixture and the class disappears.

**Q35. Can a hidden *expectation* (not just a hidden input) cause harm? How?**

Yes — it's the worst case. A snapshot regenerated without review makes the suite assert whatever the code now produces, so a genuine regression turns the suite *green*. The hidden expectation certifies the bug. This is why golden-file changes must be reviewed and the input kept visible.

---

## Trade-offs & Judgment

**Q36. Reframe the whole anti-pattern in one sentence a staff engineer would use.**

The enemy isn't *external* data, it's *mysterious* data — data whose origin, meaning, and authority the reader can't determine; make data honest, and choose visibility as the cheapest form of honesty for small data.

**Q37. Give the visible-vs-honest matrix and place an example in each cell.**

Two axes — *visible* (in the test body) and *honest* (origin/meaning/authority knowable). Visible+honest: an inline builder with named fields. Not-visible+honest: a co-located, named, regenerable golden file with a visible input. Visible+dishonest: a magic number. Not-visible+dishonest: a seeded `findById(4071)` against a shared DB — the classic Mystery Guest.

**Q38. The reviewer says "you're duplicating setup across ten tests — extract it to `setUp`." How do you respond?**

Duplication of *construction* is cheap to fix with a builder, which keeps the data local; extracting to `setUp` hides the interesting data and couples the tests. I'd introduce a Test Data Builder so each test still states only its relevant fields, getting DRY setup *without* a Mystery Guest. The thing to avoid duplicating is *logic*, not *visible intent*.

**Q39. When is it acceptable to leave data external and *not* refactor?**

When the data's realism, sharedness, or size is intrinsic to the test (a large realistic payload, a contract fixture, a golden artifact) *and* it's honest (named, input-visible, regenerable, diffed, reviewed). Then external is the correct engineering choice, and inlining it would make the test worse, not better.

**Q40. How do you keep a large suite honest without relying on everyone remembering these rules?**

Encode the rules: randomized test order in CI (surfaces order-coupling early), a lint/review rule forbidding growth of the General Fixture, a golden-file review gate (CI fails on un-intentional snapshot changes), per-test timing visibility (so expensive fixtures are seen and decided deliberately), and a `testdata/<test_name>/...` naming convention so every external artifact's owner is obvious. Make the honest path the path of least resistance.

---

## Related Topics

- [`junior.md`](junior.md) — what a Mystery Guest looks like and why it's bad.
- [`middle.md`](middle.md) — sources of hidden data and the local/explicit/minimal cure.
- [`senior.md`](senior.md) — untangling shared fixtures across a suite.
- [`professional.md`](professional.md) — trade-offs and legitimate external data.
- [`tasks.md`](tasks.md) and [`find-bug.md`](find-bug.md) and [`optimize.md`](optimize.md) — hands-on practice.
- [Fragile Tests](../01-fragile-tests/interview.md) · [Flaky Tests](../02-flaky-tests/interview.md) · [Over-Mocking](../06-over-mocking/interview.md) — sibling testing anti-patterns.
- [Bad Structure → Development Anti-Patterns](../../01-development/01-bad-structure/interview.md) — the production-code cousin.
- [Architecture Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — shared state and coupling at the system level.
