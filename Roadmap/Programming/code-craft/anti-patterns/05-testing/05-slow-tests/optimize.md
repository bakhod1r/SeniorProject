# Slow Tests — The Optimization Showcase

> **Category:** [Testing Anti-Patterns](../README.md) → **Slow Tests** — *take a real, slow suite, profile it, and make it fast — with timing numbers and reasoning at every step.*

---

This is the chapter's set piece. The other files explain the causes and the cures; here we run the whole loop on **one realistic, slow suite** end to end:

> **profile → attack the dominant cost → measure the delta → preserve coverage & isolation → re-profile → repeat.**

Every step shows a **before/after timing number** and the *reasoning* for why the change is faster — and, just as important, why it doesn't lose coverage or introduce flakiness. The timings are representative of a real JVM/Spring suite on a developer laptop (8 cores); your numbers will differ, but the *shape* — a power-law dominated by a couple of causes — is universal.

> **The one discipline to carry away:** never optimize a test you haven't ranked, and never buy speed with coverage or isolation. Speed that makes the suite lie is a regression, not a win.

---

## Table of Contents

1. [The Suite Under Test](#the-suite-under-test)
2. [Step 0 — Profile Before Touching Anything](#step-0--profile-before-touching-anything)
3. [Step 1 — Kill the Per-Test Context Boot (the giant)](#step-1--kill-the-per-test-context-boot-the-giant)
4. [Step 2 — Move Pure-Rule Tests off the Database](#step-2--move-pure-rule-tests-off-the-database)
5. [Step 3 — Replace Sleeps with Awaits](#step-3--replace-sleeps-with-awaits)
6. [Step 4 — Amortize the Container, Isolate by Rollback](#step-4--amortize-the-container-isolate-by-rollback)
7. [Step 5 — Parallelize the Now-Isolated Suite](#step-5--parallelize-the-now-isolated-suite)
8. [Step 6 — Stage CI: Fast Gate, Slow Gate](#step-6--stage-ci-fast-gate-slow-gate)
9. [The Scoreboard](#the-scoreboard)
10. [Did We Lose Anything? (Coverage Audit)](#did-we-lose-anything-coverage-audit)
11. [Lessons](#lessons)
12. [Related Topics](#related-topics)

---

## The Suite Under Test

A real-shaped `orders` module suite — **70 tests**, currently run by nobody locally because it takes nearly five minutes:

| Group | Count | What it does today | Per-test |
|---|---|---|---|
| **A. "Unit" tests of business rules** | 40 | annotated `@SpringBootTest`, write to a real Postgres for data | ~4.1 s |
| **B. Repository query tests** | 18 | `@SpringBootTest`, real Postgres, verify SQL | ~4.1 s |
| **C. Async job tests** | 6 | submit a job, `Thread.sleep(2s)`, assert | ~2.0 s |
| **D. End-to-end purchase tests** | 6 | full stack, `RANDOM_PORT`, real DB | ~5.0 s |

All 70 run **serially**, on **every push**, in one CI stage. The Postgres is a `static` Testcontainers instance shared at the class level (so the container itself boots only a few times — that part is already fine), but **the Spring context is booted per test class with `@SpringBootTest`**, and most "unit" tests needlessly go through it.

```java
// Representative "unit" test from Group A — a pure rule, tested through the whole stack.
@SpringBootTest
class DiscountServiceTest {
    @Autowired DiscountService service;     // full context booted to reach this bean
    @Autowired JdbcTemplate jdbc;

    @Test
    void goldMembersGet20Percent() {
        jdbc.update("INSERT INTO members(id, tier) VALUES (1, 'gold')");  // real DB write
        assertEquals(0.20, service.discountFor(1));
        jdbc.update("DELETE FROM members WHERE id = 1");
    }
}
```

```java
// Representative Group C test — sleeps to wait for an async job.
@SpringBootTest
class ShipmentJobTest {
    @Autowired ShipmentQueue queue;
    @Test
    void jobMarksShipped() throws InterruptedException {
        var job = queue.submit(orderId("o-1"));
        Thread.sleep(2_000);                 // "should be done"
        assertTrue(job.isDone());
    }
}
```

**Starting wall-clock (serial, one stage):**

```text
A: 40 × 4.1 s = 164 s
B: 18 × 4.1 s =  74 s
C:  6 × 2.0 s =  12 s
D:  6 × 5.0 s =  30 s
                ------
total          ≈ 280 s  (4 min 40 s)   ← run by nobody before pushing
```

---

## Step 0 — Profile Before Touching Anything

Resist the urge to start "optimizing." Rank first, at the three resolutions from [`senior.md`](senior.md).

**1. Rank by duration** (Surefire/Gradle XML, or a JUnit `TestWatcher`):

```text
SLOWEST TESTS (sorted)
4.2s  DiscountServiceTest.goldMembersGet20Percent
4.1s  DiscountServiceTest.silverMembersGet10Percent
4.1s  OrderRepositoryTest.findsPendingOrders
... (58 tests clustered at ~4.1s) ...
5.1s  CheckoutE2ETest.fullPurchase
2.0s  ShipmentJobTest.jobMarksShipped
```

**2. Setup vs body.** Instrumenting `@BeforeAll`/`@BeforeEach` vs the method shows the killer:

```text
Per ~4.1s test:  context boot ≈ 3.9 s   |   test body ≈ 0.2 s
```

The **bodies are fast (~0.2 s)**; ~3.9 s of every test is the **Spring context boot**. The whole suite is paying for a heavyweight harness 58 times over.

**3. Wall-clock vs CPU.** `/usr/bin/time` shows the suite is **~70% CPU-idle** during the run — it's *wait-bound* (context boot I/O, DB round-trips, the 2 s sleeps, serial execution leaving 7 cores idle), not compute-bound. That tells us the wins are **slicing, awaits, and parallelism**, not "less computation."

> **The profile, in one sentence:** the dominant cost is **per-test context boot (≈ 58 × 3.9 s ≈ 226 s of the 280)**, the suite is wait-bound, and it runs serially. That dictates the order of attack — biggest cause first.

---

## Step 1 — Kill the Per-Test Context Boot (the giant)

226 of the 280 seconds is context boot. Nothing else matters until this is fixed. The fix is **slicing**: boot only the layer each test needs, and let Spring **cache** the (much smaller) sliced context across tests instead of re-booting the full app.

- **Group A (business rules)** → most don't need Spring *at all*; they need the `DiscountService` and its data. → plain unit tests with a fake (Step 2). For now, the few that legitimately need wiring become `@DataJpaTest` or a minimal slice.
- **Group B (repository queries)** → `@DataJpaTest` — boots JPA + the DB only, ~0.4 s, and the slice context is **cached and reused** across all Group B classes.

```java
// Group B — sliced; context cached across the group.
@DataJpaTest
@Transactional                         // per-test rollback (isolation — Step 4)
class OrderRepositoryTest {
    @Autowired OrderRepository repo;

    @Test
    void findsPendingOrders() {
        repo.save(new Order("o-1", PENDING));   // data built in the test
        assertEquals(1, repo.findByStatus(PENDING).size());
    }
}
```

**Effect on Group B (18 tests):** boot drops from ~3.9 s (full context, per class) to ~0.4 s for the *first* sliced test, then **~0 s** for the rest (cached). Body stays ~0.2 s.

```text
Group B before: 18 × 4.1 s            = 74 s
Group B after:  0.4 s (one boot) + 18 × 0.2 s ≈ 4.0 s
```

> **Why no coverage lost:** `@DataJpaTest` runs against the **real Postgres** (via the existing Testcontainers instance), so the actual SQL dialect is still verified — we removed the *web/service layers we weren't testing*, not the database boundary we were.

**Delta: −70 s.** (Group A handled next.)

---

## Step 2 — Move Pure-Rule Tests off the Database

Profiling Group A's bodies shows the ~0.2 s isn't computation — it's a **real DB write + delete** to set up a member, to test a rule that's pure arithmetic. These tests don't need a database *or* Spring. Replace the DB with a fake and drop the framework.

```java
// Before: @SpringBootTest + real DB write for a pure rule (Group A).
// After: a plain unit test with an in-memory fake. No context, no DB.
class DiscountServiceTest {
    @Test
    void goldMembersGet20Percent() {
        var repo = new FakeMemberRepository();
        repo.put(1, "gold");                          // data in the test
        var service = new DiscountService(repo);
        assertEquals(0.20, service.discountFor(1));
    }
}
```

We audit Group A's 40 tests: **32 are pure rules** (discounts, totals, validation) → fakes, no Spring, no DB. **8 genuinely touch persistence behavior** → keep as `@DataJpaTest` (joining Group B's sliced, cached context).

```text
Group A before: 40 × 4.1 s                       = 164 s
Group A after:  32 × ~0.001 s (pure unit + fake) +
                 8 × ~0.2 s   (sliced, cached)   ≈ 1.6 s
```

> **Why no coverage lost:** the 32 rules are tested *more directly* than before (no DB noise, data visible in the test — no [Mystery Guest](../03-mystery-guest/middle.md)). The persistence the 8 tests cared about is verified in the slice against the real DB. Nothing the old tests caught is now uncaught; the rules just stopped paying for infrastructure they never exercised.

**Delta: −162 s.** This is the structural payoff of fixing the inverted pyramid: most "unit" tests were secretly end-to-end.

---

## Step 3 — Replace Sleeps with Awaits

Group C's 6 tests each `Thread.sleep(2_000)` — 12 s total, paid every run, and latently flaky. Replace with **Awaitility**, which returns the instant the condition holds.

```java
// After — await the condition; ceiling still fails a real hang.
import static org.awaitility.Awaitility.await;
import static java.util.concurrent.TimeUnit.SECONDS;

@DataJpaTest
class ShipmentJobTest {
    @Autowired ShipmentQueue queue;

    @Test
    void jobMarksShipped() {
        var job = queue.submit(orderId("o-1"));
        await().atMost(2, SECONDS)
               .pollInterval(java.time.Duration.ofMillis(10))
               .until(job::isDone);             // returns in ms when the job finishes
    }
}
```

```text
Group C before: 6 × 2.0 s = 12.0 s
Group C after:  6 × ~0.05 s ≈ 0.3 s   (sliced context + instant await)
```

> **Why no coverage lost (and flakiness *removed*):** the assertion is unchanged — the job must reach `isDone()` within 2 s. The 2 s is now a *ceiling*, not a floor, so a genuine hang still fails, while the common case returns immediately. The old fixed sleep was *also* a flakiness risk under load; the await removes it. Best case, inject a completion signal and drop polling entirely.

**Delta: −11.7 s.**

---

## Step 4 — Amortize the Container, Isolate by Rollback

The Testcontainers Postgres was already `static` (a few boots, not per-test) — good. But Steps 1–2 moved many tests *onto* the shared sliced context against that one container, so we must guarantee **isolation** before we parallelize (Step 5). The mechanism is **transaction-per-test rollback**, already added via `@Transactional` on the sliced tests.

```java
@DataJpaTest
@Transactional      // each test's writes roll back at the end → clean slate, no leakage
class OrderRepositoryTest { /* ... */ }
```

This is the senior rule applied to infra: **share the warm container (immutable engine), isolate the data (rollback).** Container boots stay at O(1); per-test data can't leak. No measurable time change here — its job is to make Step 5 *safe*, converting a serial suite into one that can run in parallel without races.

> **Why this matters before parallelizing:** if we turned on parallelism with tests sharing rows on one container, they'd race and flake. Rollback (plus the data being built *in* each test) makes every test independent — the prerequisite for parallel speed *and* the cure for flakiness. The same investment buys both.

---

## Step 5 — Parallelize the Now-Isolated Suite

The profile said the suite was 70% CPU-idle and serial on an 8-core box. With isolation guaranteed (Step 4), turn on parallel execution.

```properties
# junit-platform.properties — run tests concurrently.
junit.jupiter.execution.parallel.enabled = true
junit.jupiter.execution.parallel.mode.default = concurrent
junit.jupiter.execution.parallel.config.strategy = dynamic
```

After Steps 1–3 the suite is ~12 s of work *if serial*; spread across cores it overlaps the remaining I/O-bound slices and e2e tests. Conservatively, the parallelizable portion sees roughly a **3–4× wall-clock reduction** (not 8×: shared container contention, JVM warmup, and the few serial-ish e2e tests cap the speedup).

```text
Serial (post Steps 1–3): unit ~1.6s + sliced ~5.6s + async ~0.3s + e2e ~30s ≈ 37.5 s
Parallel:                fast groups overlap; e2e overlaps too           ≈ 11–12 s
```

> **Why no flakiness introduced:** parallelism here is safe *only because* Step 4 made every test isolated (rollback, data-in-test, the container is read-shared and write-isolated). We ran `./gradlew test` 50× to confirm zero intermittent failures before trusting the parallel config. If it had flaked, the fix would be *more isolation*, never *less parallelism*.

**Delta: ~37.5 s → ~12 s wall-clock.**

---

## Step 6 — Stage CI: Fast Gate, Slow Gate

The 6 end-to-end tests (Group D) are *legitimately* slow — they verify the whole stack and that's their value. They shouldn't gate every push. Tag and stage.

```java
@Tag("e2e")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class CheckoutE2ETest { /* ... */ }
```

```yaml
jobs:
  fast-gate:                       # every push — unit + sliced + async
    steps:
      - run: ./gradlew test -PexcludeTags=e2e   # ≈ 8 s wall-clock, parallel
  slow-gate:                       # only after fast-gate is green — e2e
    needs: fast-gate
    steps:
      - run: ./gradlew test -PincludeTags=e2e   # ≈ 6–8 s (6 e2e, parallel), pre-merge only
```

Locally, `./gradlew test -PexcludeTags=e2e` is the default developers run constantly (~8 s); the e2e tests run pre-merge in CI.

```text
Fast gate (what people feel):  ≈ 8 s   ← was 280 s
Slow gate (pre-merge only):    ≈ 7 s
```

> **Why no coverage lost:** the e2e tests still run — every PR clears them before merging. We moved *when* they run (pre-merge, after the cheap gate is green) so they never block the fast feedback loop, and we never boot the e2e stack on a PR a unit test already failed.

---

## The Scoreboard

| Step | Change | Group | Before | After | Δ |
|---|---|---|---|---|---|
| 1 | Slice repository tests (`@DataJpaTest`, cached) | B | 74 s | ~4 s | **−70 s** |
| 2 | Move pure rules to fakes (drop Spring + DB) | A | 164 s | ~1.6 s | **−162 s** |
| 3 | Sleeps → Awaitility | C | 12 s | ~0.3 s | **−11.7 s** |
| 4 | Rollback isolation (enables Step 5) | all | — | — | 0 s (safety) |
| 5 | Parallelize the isolated suite | A/B/C/D | ~37.5 s | ~12 s | **−25 s wall** |
| 6 | Stage e2e into the slow gate | D | 30 s on push | 0 s on push | **−30 s from gate** |

```text
START:  ≈ 280 s serial, single stage, run by nobody
END:    ≈ 8 s fast gate (every push, parallel)
        ≈ 7 s slow gate (pre-merge only)

Fast-feedback loop: 280 s → 8 s  ≈ 35× faster
```

The win was **not one trick.** It was: profile → attack the dominant cost (context boot, 226 s) → fix the inverted pyramid (rules to fakes) → remove sleeps → make the suite isolated → parallelize → stage the legitimately-slow tests. The single biggest lever (Step 2, −162 s) was *structural* — most "unit" tests were end-to-end in disguise — which is why profiling first mattered: a naïve "let's parallelize" would have given an 8× on a 280 s suite (~35 s) and missed the 35× that came from testing each thing at the right layer.

---

## Did We Lose Anything? (Coverage Audit)

Speed bought with lost coverage is fraud, so audit explicitly:

| Old coverage | Where it lives now | Verdict |
|---|---|---|
| Business rules (discounts, totals, validation) | 32 plain unit tests with fakes | **Kept** — tested more directly, no DB noise |
| Real SQL / persistence behavior | `@DataJpaTest` (B + 8 from A) against real Postgres | **Kept** — real dialect still exercised |
| Async job completion | Awaitility-based tests | **Kept** — same assertion, faster, less flaky |
| Full-stack purchase journey | 6 e2e tests in the slow gate | **Kept** — run pre-merge, just not on every push |

Nothing the original 70 tests caught is now uncaught. We **relocated** coverage to the cheapest layer that catches each bug and **rescheduled** the expensive tests — we never deleted a boundary. And we ran the parallel suite 50× to confirm we didn't trade slowness for [flakiness](../02-flaky-tests/optimize.md). Faster, same coverage, not flakier: the only kind of test speed-up worth shipping.

---

## Lessons

1. **Profile before optimizing.** The dominant cost (context boot, 226 of 280 s) wasn't obvious from the wall-clock total; only ranking + setup-vs-body revealed it. Guessing would have parallelized a fundamentally mis-layered suite.
2. **The biggest win is usually structural.** −162 s came from realizing most "unit" tests were end-to-end. Slicing and fakes beat any micro-optimization. Fix the inverted pyramid first.
3. **Slice the harness, fake the boundary.** `@DataJpaTest` (slice) + cached context + in-memory fakes (boundary) attack boot cost from both sides.
4. **Awaits, never sleeps.** Free speed *and* removed flakiness — the timeout becomes a ceiling instead of a floor.
5. **Isolate *then* parallelize.** Rollback + data-in-test made the suite independent; only then is parallelism safe. The isolation investment is the shared cure with Flaky Tests.
6. **Stage the legitimately slow.** Don't make e2e tests faster than they can be — run them pre-merge, after the cheap gate, so they never block fast feedback.
7. **Audit coverage and flakiness at the end.** A speed-up that drops coverage or adds flakiness is a regression. Prove neither happened.

> **The loop, one more time:** *profile → attack the dominant cost → measure the delta → preserve coverage & isolation → re-profile.* A 280-second suite nobody ran became an 8-second gate everyone runs — and it catches exactly the same bugs.

---

## Related Topics

- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) · [`professional.md`](professional.md) — the principles applied here.
- [`tasks.md`](tasks.md) — practice each move on its own.
- [`find-bug.md`](find-bug.md) — spot the slow cause before fixing it.
- [Flaky Tests](../02-flaky-tests/optimize.md) — the isolation work in Steps 4–5 is the same cure for flakiness.
- [Mystery Guest](../03-mystery-guest/optimize.md) — building data in the test (Steps 2, 4) also kills hidden-fixture smells.
- [Over-Mocking](../06-over-mocking/optimize.md) — keep fakes faithful so the fast suite doesn't go green-while-broken.
- [Performance → Premature Optimization Traps](../../06-performance/01-premature-optimization-traps/optimize.md) — profile-first optimization, the same loop on production code.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level structures that resist change.
