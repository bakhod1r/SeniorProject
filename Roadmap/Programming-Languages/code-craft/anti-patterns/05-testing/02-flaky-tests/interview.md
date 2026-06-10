# Flaky Tests — Interview Questions

> **Category:** [Testing Anti-Patterns](../README.md) → **Flaky Tests** — *the same test, on the same code, passes sometimes and fails sometimes.*
> **Also known as:** non-deterministic tests · intermittent tests · heisentests

---

This file is **30+ interview questions with model answers**, ordered roughly junior → professional. Each answer is what a strong candidate says — concise, correct, and showing the *reasoning*, not just a definition. Use it to rehearse out loud; the goal is to explain the *why*, not recite the term.

> **How to use this file:** cover the answer, attempt it aloud, then compare. An interviewer probes for whether you understand that flakiness is **uncontrolled non-determinism** and that the cure is **controlling the input** — not retrying.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Causes and cures](#causes-and-cures)
3. [Detection and tooling](#detection-and-tooling)
4. [Process and policy](#process-and-policy)
5. [Hard / senior](#hard--senior)

---

## Fundamentals

### Q1. What is a flaky test?

A test whose **result is not a pure function of the code under test** — run it twice on byte-for-byte identical code and you can get a pass *and* a fail. Its outcome depends on something it doesn't control: timing, ordering, randomness, the clock, the network, another thread. That non-determinism is the defining property.

### Q2. How is a flaky test different from a failing test?

A **failing** test fails *every* time on this code — that's a real, actionable signal (a bug or a wrong assertion). A **flaky** test *alternates* pass and fail with no code change. The tell is **irreproducibility**: you can't make a flake fail on demand. If you can reliably reproduce a failure, it's a bug, not a flake.

### Q3. Why are flaky tests considered so harmful — worse than having no test?

Because they destroy **trust**, which is the only thing that makes a suite useful. Green should mean "fine," red should mean "go look." A flake makes green possibly-luck and red possibly-noise. Once red is sometimes noise, people re-run instead of investigating — and the day a flake hides a real regression, it ships. A suite you don't trust still costs maintenance but no longer gives confidence: worse than nothing.

### Q4. A test fails, you re-run it on the same code, and it passes. Is it flaky?

Not proven yet — one pass after one fail is *also* exactly what an intermittent real bug looks like. To call it a flake (a test problem, not a code problem) I'd identify the uncontrolled input — does it sleep, race a thread, depend on test order, hit the network? — and ideally reproduce the failure on demand by stressing that input (`-count`, `-race`, random order). If I *can* reliably reproduce the failure, it's a bug.

### Q5. Why is "just re-run it until it's green" a bad habit?

It doesn't fix anything — the non-determinism is still there — and it *trains the team to treat red as noise*. Once red means "maybe a flake," a real regression looks identical, gets re-run, and ships. It's silencing the smoke alarm instead of finding the fire. The correct response is to find the cause, or quarantine and ticket it — never retry forever.

### Q6. Name the common sources of non-determinism in tests.

Seven: **timing** (`sleep`-based waits, real timeouts), **async/concurrency races**, **shared mutable state / test-order dependence**, **unseeded randomness**, **real wall clock / date / timezone**, **external dependencies** (network, DB, filesystem, ports), and **ordering assumptions** (relying on map/hash iteration order).

---

## Causes and cures

### Q7. What's the classic flaky test, and why does it flake?

The `sleep`-based async wait: the code does background work, the test `sleep(100ms)` then asserts. It flakes because `100ms` is a *bet* that the work finishes within 100ms — true on an idle laptop, false on loaded CI where the work takes 140ms. It's racing a fixed duration against work whose timing it doesn't control.

### Q8. How do you fix a sleep-based flake? Why isn't a bigger sleep the answer?

**Wait for the condition, not a duration**: poll until the thing you care about is true (`completed == 1`) with a *generous timeout as a backstop*, or block on a signal the worker sends when done. A bigger sleep only makes the flake *rarer* and the test *slower* — there's no duration that's both fast and safe, because you don't control the work's timing. The condition-wait returns the instant the work finishes and only fails if it *never* does.

### Q9. What's the difference between a poll-with-timeout and a sleep?

A **sleep** waits a fixed duration unconditionally, then assumes the work is done — fast path wasted, slow path flaky. A **poll-with-timeout** checks the condition repeatedly and returns the *instant* it's true; the timeout is a backstop for genuine failure, sized far larger than any normal completion. So it's both faster (returns early) and not flaky (only fails on real failure).

### Q10. How do you make a test that depends on the current time deterministic?

**Inject the clock.** Production code takes a `Clock` dependency instead of calling `time.Now()`/`LocalDate.now()` directly; tests pass a *fixed* clock (`Clock.fixed(...)`, a `FakeClock`). Then "now" is whatever the test says — no midnight/DST/timezone flake. Bonus: a fake clock lets you `advance(24h)` instantly, so time-based tests are fast too.

### Q11. Why do tests that read the real clock flake, concretely?

They're coupled to *when they run*: they fail at midnight, on month/year boundaries, on a leap day, during a DST transition, or in CI's UTC timezone when written in UTC+5. A common one: `expires_at = now() + 1s; assert not expired` flakes if a GC pause or loaded box delays the assertion past the 1-second window.

### Q12. How do you handle randomness in a test without flakiness?

**Seed the RNG** to a fixed value so the "random" input is identical every run — a failure becomes reproducible (fails every run on that seed) instead of a one-off. Use a *local* seeded generator (`rand.New(rand.NewSource(42))`, `random.Random(42)`), not the global one (seeding the global leaks into other tests). For random UUIDs/IDs, inject a deterministic generator.

### Q13. Isn't property-based testing deliberately random? How is that not flaky?

It randomizes inputs *to find edge cases*, but a good PBT framework **prints the failing seed**, so any failure is reproducible (`reproduce with seed=...`) and shrinks to a minimal case. The flake isn't "randomness" — it's *un-loggable, un-reproducible* randomness. Seed it or log the seed and it's deterministic-on-replay.

### Q14. What is test-order dependence and why does it cause flakiness?

When one test leaves behind mutable state (a static field, module global, shared DB row, temp file) that another test reads, the result depends on *which test ran first*. It flakes because test runners are free to — and increasingly do — randomize order. The acid test: if running tests in random order changes the result, you have shared state.

### Q15. How do you fix shared-state / order-dependent flakiness?

Give each test **fresh, isolated state** and **reset what you touch in teardown** (`t.Cleanup`, `@AfterEach`, fixture finalizers — these run even on failure). Better, don't share at all: inject state instead of using globals; per-test DB schema or rolled-back transaction; `t.TempDir` per test. Then order can't matter.

### Q16. A test asserts a list equals `["a","b","c"]` from iterating a map and flakes ~1 in 6 runs. Diagnosis and fix?

**Ordering assumption** — Go randomizes map iteration order (Java's `HashMap` order is unspecified). Fix: remove order from the assertion — `sort` the result before comparing, or use an order-agnostic comparison (`ElementsMatch`, set equality). If the producer doesn't guarantee order, don't assert on order.

### Q17. Your unit test hits a real external API and fails ~2% of the time. How do you fix it?

**Fake the boundary.** Replace the real call with an in-process fake server (`httptest.Server`) or an injected fake client returning a fixed response — no network, no latency, no flake. For databases: an in-memory fake, or an ephemeral real DB (Testcontainers) wrapped in a per-test transaction rolled back at the end. Never a shared long-lived test DB. A unit test must not depend on the non-deterministic outside world.

### Q18. What's the single principle behind all the cures?

Make the test a **pure function of the code under test.** Every flake is the test secretly depending on an *uncontrolled input* — the clock, the RNG, the scheduler, the network, leftover state, map order. The cure is always to **take control of that input** (inject it, fix it, seed it, isolate it, fake it), never to gamble on it or retry around it.

---

## Detection and tooling

### Q19. How do you *deliberately* detect a flaky test instead of waiting for CI?

Stress the non-deterministic inputs: **repeat** the test many times (`go test -count=1000`, `@RepeatedTest`, pytest-repeat) to surface rare intermittents; run under the **race detector** (`-race`, thread-sanitizer, jcstress) to surface data races; run in **randomized order** (`-shuffle=on`, pytest-randomly) to surface order-dependence. Do this in a scheduled nightly job, not just on demand.

### Q20. What does `-race` (the race detector) catch, and why does it help with flakiness?

It catches **data races** — concurrent unsynchronized access to shared memory where at least one is a write. It helps because a data race is undefined behavior that flakes intermittently in normal runs; the detector turns it into a *deterministic* "RACE DETECTED" failure you can fix. A test green alone but red under `-race` is a flake waiting to happen — and usually a bug in *production* code.

### Q21. What does `-shuffle` / random test order do for you?

It randomizes test execution order, which surfaces **hidden order-dependence** that a stable order conceals. Without it, an order-dependent flake stays invisible until a new test perturbs the order. With it (seeded and logged), you get an immediate, reproducible failure — and you prevent *new* order-dependence from being merged. It's the highest-leverage flag most teams leave off.

### Q22. How do you root-cause a flake that only fails on CI, never locally?

Almost always an environment-coupling flake: **timezone** (CI in UTC), **machine load** (timing), **a different DB** (shared state), or a **bound port**. Reproduce by *matching the environment* — `TZ=UTC`, constrained CPU in a container, the same DB — rather than staring at the diff. And capture the printed seed if order/RNG is involved; reproducing with it makes the failure deterministic.

### Q23. You suspect a flake but can't reproduce it. What's your first move?

Convert it into a reproducible failure by stressing the suspected input: run it under `-count=N -race -shuffle=on`. Capture any printed seed and re-run with it. You haven't root-caused a flake until you can make it fail **on demand** — without that, any "fix" is a speculative guess (usually a bug-masking retry).

---

## Process and policy

### Q24. What is test quarantine, and how does it differ from retrying?

**Quarantine** moves a known-flaky test *out of the gating (blocking) build* — it still runs and is tracked in a separate non-gating job, with an owner, a ticket, and an SLA. The gate stays meaningful for everything else. **Retry** leaves the test in the gate and re-runs it until green, hiding the flake indiscriminately (including real intermittent bugs) and training the team to ignore red. Quarantine is selective and visible; retry is blanket and invisible.

### Q25. What rules keep a quarantine bucket from becoming a graveyard?

Every quarantined test has an **owner and an SLA** (a deadline); quarantine **expires** — if not fixed by the SLA, the test is *deleted* (with a coverage-gap ticket), because a long-quarantined test gives zero protection; and there's a **cap** on the bucket size (e.g. 1% of the suite) so hitting it forces fixes rather than indefinite accumulation.

### Q26. What is "flake rate" and how do you measure it?

The fraction of runs whose result flipped on **identical code**: `flips / total runs`, per test and aggregated. Source it from (a) **same-commit reruns** — when CI re-runs a failed job on the same SHA and it passes, log a flake; and (b) a **nightly N-run job** running the suite K times against `main`, counting any test that isn't 100% consistent. Track it on a dashboard so flakiness is a prioritizable backlog, not a vibe.

### Q27. What's a reasonable target for flakiness, and why not zero?

Zero is unattainable at scale, so target a per-run flake failure rate **well under 1%** — low enough that a red build is almost always real. The real goal is to *protect the meaning of red*: detect proactively, quarantine the residue, and keep the trend going down. Because suite-flake probability is super-linear in suite size, the *per-test* rate you can tolerate shrinks as the suite grows.

### Q28. Should you ever turn on auto-retry for the whole CI suite?

No — blanket auto-retry hides *every* flake indiscriminately, including real intermittent product bugs, and removes all pressure to fix the underlying non-determinism. It's "just re-run it," industrialized. The acceptable version is **retrying the *job* for *infrastructure* hiccups** (a lost agent, an OOM-killed runner), which is a different category from a *test's* own non-determinism.

---

## Hard / senior

### Q29. When is a retry *legitimate* rather than bug-masking?

When the non-determinism is **real, external, and irreducible** — e.g. an end-to-end smoke test against live staging retrying a transient network blip, because transient failure is a genuine property of the world the test exists to exercise. It masks a bug when the non-determinism was *controllable* (a sleep, race, unseeded RNG, leaked state, real DB you could've faked). The test: *"could I have made this deterministic by controlling an input?"* Yes → masks a bug. Even legitimate retries must be **bounded, logged, and monitored** (a rising retry rate is itself a signal).

### Q30. What does it mean to say "the flaky test is telling you the *system* is flaky"?

Sometimes a flaky test is a **correct report of real non-determinism in production** — a data race that loses updates, an eventually-consistent read taken too soon, a mis-tuned timeout users actually hit, an ordering bug. De-flaking it by faking the cause away would *delete a true bug report*. So before faking/seeding/isolating, diagnose whether the non-determinism is a **test artifact** (fix the test) or a **real system property** (fix the production code). On critical paths this judgment matters most.

### Q31. How do you make a concurrency test deterministic when the race is in the memory model?

You can't reliably reproduce it by sampling runs — it may only flake on certain CPUs/compilers. Use a **race detector** (`-race`, thread-sanitizer, jcstress) or a **model checker** (Rust `loom`) that *exhaustively explores interleavings*, turning a 1-in-a-million race into a deterministic, every-run failure. Then fix the **production** code (atomics/mutex/channel). Never sleep or retry — that hides undefined behavior.

### Q32. How do you test a time-and-schedule-dependent system (e.g. retry-with-backoff) deterministically?

A single fixed clock isn't enough because backoff is a *sequence* of timed events. Use **deterministic simulation**: a virtual clock plus a controlled scheduler the test drives, so the system runs on **logical time** you advance (`advanceTimeBy(4, SECONDS)` / `advance_to_idle()`), firing every scheduled timer in order — instantly, deterministically, and seed-reproducibly. This is how Reactor's `VirtualTimeScheduler`, RxJava's `TestScheduler`, and FoundationDB's simulation work.

### Q33. Why does flakiness get *economically* worse as a test suite grows?

Suite-flake probability ≈ `1 − (1 − p)ⁿ` for per-test rate *p* over *n* tests — **super-linear** in *n*. A 0.1% rate that's fine at 500 tests (~39% of builds flake) means ~99% of builds flake at 5,000 tests. So the tolerable per-test rate *shrinks* as the suite grows, and you must drive *p* toward zero as ongoing infrastructure work, not a one-time cleanup.

### Q34. At scale, how do you eliminate order-dependence — not just one flake at a time?

Design it out structurally: forbid shared mutable state by construction (per-test schemas/sandboxes, no static singletons, per-test resources), then make **randomized order always-on as a build-*failing* fitness function** so new order-dependence can't merge. Auto-detect pollution by comparing each test's in-suite vs in-isolation result. You guard the boundary instead of chasing pairs forever.

### Q35. Walk me through diagnosing a flaky test end to end.

(1) **Confirm it's a flake** (alternates on unchanged code, irreproducible) vs a real intermittent bug. (2) **Reproduce on demand** with `-count -race -shuffle`, capturing the seed. (3) **Match the symptom to a cause** — fails under `-race` → async race; only in the full suite → shared state; on CI only → environment/clock/dep; different value each run → RNG; order assertion → map iteration. (4) **Decide test-artifact vs system property** — fix the test, or fix production. (5) **Apply the matching cure** (await condition, inject clock, seed, isolate, fake, sort). (6) If it can't be fixed now, **quarantine with an owner/SLA** — never leave it failing in the gate.

---

## Related Topics

- [`junior.md`](junior.md) — what flaky is and why "just re-run it" is poison.
- [`middle.md`](middle.md) — the seven causes with a worked fix for each.
- [`senior.md`](senior.md) — detection, root-causing, quarantine, and flake rate as a metric.
- [`professional.md`](professional.md) — memory-model races, deterministic simulation, legitimate retries, flaky system vs flaky test.
- [Testing Anti-Patterns → Slow Tests](../05-slow-tests/interview.md) and [Fragile Tests](../01-fragile-tests/interview.md) — sibling interview banks.
- [Concurrency Anti-Patterns → Shared State](../../03-concurrency/03-shared-state/senior.md) — the production races behind async-test flakiness.
