# ThreadSanitizer (TSan) — Professional Level

> **Roadmap:** [Dynamic Analysis & Sanitizers](../README.md) → ThreadSanitizer (TSan)
> *The senior page taught you how TSan's happens-before engine proves a race. This page is about the part the engine can't help with: a race only exists on an interleaving that **runs**, so the entire job at org scale is coverage — manufacturing the rare schedule, ratcheting a backlog of real bugs, paying for a 5–15× CI lane, and holding the line when someone calls a data race "benign."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Coverage Problem Is the Whole Problem](#core-concept-1--the-coverage-problem-is-the-whole-problem)
5. [Core Concept 2 — Manufacturing Rare Interleavings](#core-concept-2--manufacturing-rare-interleavings)
6. [Core Concept 3 — Rolling Out `-race`/TSan to a Large Codebase](#core-concept-3--rolling-out-racetsan-to-a-large-codebase)
7. [Core Concept 4 — "It's a Benign Race" Is a Smell](#core-concept-4--its-a-benign-race-is-a-smell)
8. [Core Concept 5 — Annotations, Suppressions, and the Over-Suppression Trap](#core-concept-5--annotations-suppressions-and-the-over-suppression-trap)
9. [Core Concept 6 — Production Strategy When TSan Can't Run in Prod](#core-concept-6--production-strategy-when-tsan-cant-run-in-prod)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Operating dynamic race detection across an org, where the binding constraint is not the tool's accuracy but how much concurrent interleaving your tests actually exercise.**

The senior page framed TSan as a precise instrument: shadow memory, vector clocks, a happens-before relation, and a report when two accesses to the same location aren't ordered by synchronization. All true. But at the professional level the instrument's precision stops being the interesting part, because TSan has a property unlike almost any other bug-finding tool you own: **it has near-zero false positives and near-total dependence on execution coverage.** It will not invent a race that isn't there. It also will not find a race on a code path your test never ran, or on an interleaving your scheduler never produced.

That asymmetry reframes everything. The question in design reviews stops being "does TSan work?" and becomes "did the race actually *happen* in the run we instrumented?" The hard problems are organizational: a fleet of services where the first time you turn on `-race` you discover forty real data races nobody knew about; a CI bill that grows 5–15× because the race-instrumented lane can't share a build with anything else; a senior engineer insisting their lock-free counter race is "benign" while billing numbers drift; a crash that reproduces in production once a week at 64 cores and never on a laptop. This page is the judgment layer for all of that — the pragmatic, battle-tested view of running TSan where it stops being a checkbox and becomes a coverage strategy.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — shadow memory, vector clocks, the happens-before relation, why TSan reports a *pair* of accesses, the instrumentation model and its slowdown.
- **Required:** You've shipped concurrent code to production and debugged at least one failure that wouldn't reproduce locally.
- **Helpful:** You've owned a CI pipeline and made tradeoffs about lane cost, parallelism, and flake budgets.
- **Helpful:** You've been in the room when someone argued a known race was "fine" — and you weren't sure how to answer.

---

## Glossary

| Term | Meaning |
|---|---|
| **Data race** | Two accesses to the same memory location, at least one a write, not ordered by a happens-before edge, from different threads/goroutines. In C/C++ this is **undefined behavior**, full stop. |
| **Happens-before (HB)** | The partial order TSan builds from synchronization (mutexes, atomics, channel ops, thread start/join). If neither access "happens before" the other, they race. |
| **Interleaving / schedule** | A specific order in which the runtime ran concurrent operations. TSan only judges the interleaving that executed. |
| **Coverage (for races)** | Not line coverage — *interleaving* coverage. Whether the racy schedule was ever produced during an instrumented run. |
| **Benign race** | A data race whose author claims has no observable bad effect. In C/C++ this category is essentially empty; in Go/Java it's rare and usually wrong. |
| **Suppression** | A rule (file/regex) telling TSan to silence a specific report. Used for known-acceptable noise or third-party code you can't fix. |
| **Baseline / ratchet** | A frozen set of pre-existing findings you tolerate temporarily, with a gate that blocks *new* findings — so the count only goes down. |
| **Annotation** | An explicit hint to TSan about synchronization it can't see (e.g., custom lock-free protocols), e.g. `__tsan_acquire`/`__tsan_release`. |
| **Soak test** | A long-running test (hours/days) under load, designed to hit rare schedules through sheer volume of interleavings. |
| **Flaky-under-race** | A test that passes normally but fails intermittently when run with TSan — usually because instrumentation changes timing and exposes a real latent race. |

---

## Core Concept 1 — The Coverage Problem Is the Whole Problem

Most sanitizers are coverage-limited but the limitation is mild: AddressSanitizer finds the out-of-bounds read the moment that line executes with that input. TSan is different in kind. A data race requires *two threads to touch the same location in a particular order with no synchronization between them*. TSan can prove the race the instant that interleaving occurs — but it is utterly silent if the interleaving never occurs.

Concretely: imagine two goroutines, one writing a map and one reading it, where 99.9% of the time the write finishes before the read starts because of incidental timing. Your `-race` test runs, the schedule that happens to execute is the safe one, and TSan reports nothing. The race is *real* — it is UB in C/C++ and a corruption risk in Go — but you didn't see it because the bad schedule didn't run.

> **The central truth of dynamic race detection:** *TSan finds races on interleavings that execute, not races that exist.* A clean TSan run is evidence about the schedules you exercised, not a proof of correctness. Treat "TSan is green" the way you treat "tests pass with the coverage we have" — informative, not absolute.

This single fact drives the entire professional playbook. Everything downstream — running `-race` continuously, `-count`, stress, randomized scheduling, fault injection, soak, fuzzing-under-TSan — is one strategy: **increase the number and diversity of interleavings TSan gets to judge.** The accuracy of the detector is a solved problem. The coverage of the detector is your job, forever.

It also explains a phenomenon that confuses teams: the same code can be green for months and then a report appears after an unrelated change. Nothing about the race changed. A timing shift — a new log line, a slower dependency, a different machine — perturbed the schedule enough to surface the bad interleaving. The report was always *deserved*; it just took a schedule to reveal it.

---

## Core Concept 2 — Manufacturing Rare Interleavings

If coverage is the problem, the work is making rare schedules reproduce on demand, in pre-production, where a finding is cheap. The toolbox, roughly in order of cost-effectiveness:

**1. Run the `-race` / TSan suite continuously, not occasionally.** The single highest-leverage move. A race that surfaces once in 500 runs is invisible if you run the suite weekly and routine if you run it on every merge plus a nightly multiplier. In Go this is `go test -race ./...` as a standing CI lane; in C/C++ it's a TSan build of the test binary.

**2. Repeat the same tests — `-count` and loops.** The cheapest way to sample more schedules from the *same* test is to run it many times. Repetition resamples the scheduler.

```bash
# Go: run the whole concurrent suite 50 times under the race detector
go test -race -count=50 ./internal/cache/...

# Shake out a specific suspect test with fresh schedules each run
go test -race -run TestConcurrentEvict -count=200 ./internal/cache/
```

**3. Stress tests with real concurrency.** Don't test a concurrent structure with one goroutine. Spin up many workers hammering shared state, ideally with `GOMAXPROCS` cranked up and randomized timing.

```go
func TestCacheStress(t *testing.T) {
    c := NewCache()
    var wg sync.WaitGroup
    for i := 0; i < 64; i++ {        // many writers + readers
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for j := 0; j < 10_000; j++ {
                if id%2 == 0 {
                    c.Set(j%128, id)   // writers
                } else {
                    _ = c.Get(j % 128) // readers
                }
            }
        }(i)
    }
    wg.Wait()
}
```

**4. Randomized / controlled scheduling.** The scheduler's defaults sample a narrow band of interleavings. Perturbing it widens the band. C/C++ TSan exposes knobs to bias toward more aggressive interleaving discovery; research and production tools (rr's chaos mode, Go's runtime scheduler under load, controlled-concurrency frameworks) deliberately reorder. The key idea: *don't let the OS scheduler's habits decide your coverage.*

```bash
# C/C++ TSan options that widen schedule exploration / surface ordering bugs
TSAN_OPTIONS="history_size=7 flush_memory_ms=1000" ./test_binary
# rr record --chaos ./test_binary   # perturb scheduling to reproduce timing bugs
```

**5. Fault injection.** Many races only open a window when something is *slow* — a delayed RPC, a paused GC, a retry. Inject latency and faults so the slow path that widens the race window actually runs.

**6. Soak tests.** Hours-to-days of sustained load under TSan. Brute force: enough wall-clock at enough concurrency eventually samples the rare schedule. Expensive, but the catch-net for the long tail.

**7. TSan + fuzzing.** Couple a coverage-guided fuzzer with a TSan build so the fuzzer's input exploration also drives different concurrent code paths. This is the frontier of [coverage-guided dynamic analysis](../05-coverage-guided-dynamic-analysis/professional.md) — let the fuzzer hunt inputs while TSan watches for races on the paths they unlock.

**8. Capture field races.** Some interleavings only happen at production scale (real core counts, real load, real timing). You can't run TSan there, so you capture *signals* — panics on concurrent map writes, corruption asserts, checksum mismatches — and feed them back as new stress tests (see Core Concept 6).

> **The principle:** a race you can't reproduce is a race you can't fix with confidence. Spend your effort moving rare schedules from "production, once a week" to "CI, on demand." Continuous `-race` plus `-count` plus a real stress test covers most of the distribution; soak and fuzzing-under-TSan catch the tail.

---

## Core Concept 3 — Rolling Out `-race`/TSan to a Large Codebase

Turning on the race detector for the first time across a mature codebase is a project, not a flag flip. Expect this arc:

**The initial backlog.** The first full `-race` run on a codebase that's never had one will surface real races — often dozens. Concurrent map access, unguarded shared counters, lazy-init double-checks, closures capturing loop variables shared across goroutines. These are *not* tooling artifacts; they're bugs that have been shipping. The shock is normal. Do not respond by disabling the detector.

**The baseline ratchet.** You cannot block all merges until forty pre-existing races are fixed; you also cannot let the count grow. The standard move is a **ratchet**: snapshot the existing findings into a baseline/suppression set, then **gate on new** — any race *not* in the baseline fails CI. The baseline only shrinks; every PR that touches racy code is expected to fix, not extend it.

```
Day 0:  full -race run → 41 findings → freeze as baseline (suppression list)
Gate:   CI fails if a race appears that is NOT in the baseline  ("gate-on-new")
Ratchet: every fix removes an entry; the baseline count is a burn-down chart
Rule:   you may delete baseline entries, never add — the list is monotonic-down
```

**The cost structure.** TSan/`-race` is expensive: typically **5–15× slower** and **5–10× more memory** (shadow memory is several bytes per byte of application memory). Practical consequences:

- It needs a **separate CI lane.** You cannot run it on every commit in the same budget as your normal tests; it's a dedicated job, often on beefier runners.
- **It cannot share a build with ASan.** ASan and TSan have conflicting runtime/instrumentation models and are mutually exclusive in one binary — you build and run them as *separate* lanes (this is a recurring surprise; see [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md)).
- **Timeouts must be raised.** Tests that pass in 30s may take 5 minutes under instrumentation; naïve timeouts produce phantom "failures."
- **Memory limits must be raised.** A test that fits in 2 GB may need 8–16 GB with shadow memory; OOM-kills masquerade as flakes.

**Flaky-under-race triage.** The most common rollout complaint is "TSan makes my tests flaky." Resist the framing. A test that passes normally and fails *intermittently under TSan* is almost always exposing a **real latent race** — instrumentation perturbed timing enough to hit the bad schedule. The triage discipline: when a TSan run flakes, read the report. If it's a genuine HB violation, you found a real bug that your non-instrumented tests were hiding by luck. Only after reading do you consider tooling causes (a known unsupported pattern, a third-party library).

> **The org reality:** the cost of TSan is real and you must budget for it as a first-class lane — but the alternative is paying the same cost as production incidents at 3 a.m. instead of as CI minutes at noon. A 10× CI lane that catches a data race is one of the best trades in engineering. Frame the rollout as "move the race-detection cost from prod to CI," because that is exactly what it is.

---

## Core Concept 4 — "It's a Benign Race" Is a Smell

This is the hardest *organizational* problem TSan surfaces, and the one where staff judgment matters most. Someone will look at a TSan report and say: "that race is benign — it's just a stats counter / a flag / a best-effort cache; the worst case is a slightly stale value." You need a principled answer, because the claim is almost always wrong.

**In C and C++, a data race is undefined behavior — there is no benign data race.** Full stop. Not "usually bad," not "bad on weak memory models" — *UB*. The moment two threads race on a non-atomic location, the compiler is licensed to do anything: tear the value, hoist the load out of the loop, assume the value can't change and optimize on that assumption, fuse or split the access. "It only reads a flag" is not safe: the compiler may cache the flag in a register and never re-read it, or read it twice and get different values within one expression. The "benign" mental model assumes a sequentially-consistent machine that does not exist. The fix is not "ignore it"; the fix is to make the access atomic (`std::atomic`, the right memory order) so it is *defined*.

**In Go, the memory model is explicit that racy programs have no guarantees**, and the race detector reports are real. A "benign" counter race in Go can still tear on some architectures, and a "benign" map race can crash the process outright — the Go runtime intentionally panics ("concurrent map writes") because a torn map is unrecoverable. Go gives you `sync/atomic` and `atomic.Value`/`atomic.Pointer` precisely so the "I just need a flag/counter" case is cheap to make correct.

So when someone says "benign," your script is:

1. **In C/C++:** "There is no benign data race; this is UB. The compiler can tear or eliminate this access. Make it `atomic` with the appropriate ordering — that's the whole fix and it's cheap." (Push back hard. This is not a judgment call.)
2. **In Go/Java:** "Show me the memory model guarantee that makes this safe. If it relies on x86's strong ordering, it'll tear on ARM. If it's a map, it can crash the runtime. The atomic version is one line — why are we taking the risk?"
3. **Always:** "What does this access *guard*? Benign-looking races often gate something that isn't benign — a counter that feeds billing, a flag that gates a refund, a cache that backs a decision."

The deeper point: a TSan finding has near-zero false-positive rate, so the prior is overwhelmingly "this is a real bug." The burden of proof is on the person claiming it's safe, not on the person who wants to fix it. "It's benign" should make you *more* suspicious, not less — it's the phrase that precedes the worst War Stories below.

> **The staff stance:** treat every TSan report as a real bug until *proven* otherwise, and in C/C++ it is provably a real bug by definition. The cost of fixing a "benign" race (usually one atomic) is trivial; the cost of being wrong is a corruption you'll debug for weeks. The asymmetry says: just fix it.

---

## Core Concept 5 — Annotations, Suppressions, and the Over-Suppression Trap

Two escape hatches exist, and both are dangerous in different ways.

**Annotations** tell TSan about synchronization it genuinely cannot see. TSan understands standard primitives (mutexes, atomics, channels, thread join). It does *not* understand a hand-rolled lock-free protocol, a custom hazard-pointer scheme, or synchronization that happens through a mechanism outside the language runtime (a memory-mapped doorbell, a custom futex dance). For *legitimate* custom synchronization, you annotate the happens-before edge so TSan stops reporting a race that is actually correctly ordered:

```c
// C/C++: tell TSan that this custom protocol establishes release/acquire
__tsan_release(&node);   // on the producer side, after publishing
// ... custom publication ...
__tsan_acquire(&node);   // on the consumer side, before reading
```

```go
// Go: exclude a deliberately-racy benchmark/util from instrumentation
//go:build !race

// Or guard race-only logic:
//go:build race
```

**Suppressions** silence reports by file/function/regex, via `TSAN_OPTIONS=suppressions=...` (C/C++) or a suppression file. They're for third-party code you can't fix, a known-acceptable report you've *analyzed and documented*, or the rollout baseline.

The trap is the same for both, and it is the most dangerous failure mode in TSan operations: **over-suppression turns a near-zero-false-positive tool into a tool that finds nothing.** Every annotation that lies (claims synchronization that isn't really there) and every suppression that's too broad (silences a whole package "because it was noisy") punches a permanent hole in your coverage. Unlike a missed line in coverage, a bad suppression actively hides *future* real races in that scope, forever, silently.

Discipline that keeps the escape hatches honest:

- **Suppressions are scoped as narrowly as possible** — one function, not a package; one symbol, not a wildcard.
- **Every suppression carries a comment** with a ticket and a one-line justification. An uncommented suppression is a bug.
- **Suppressions expire.** Periodically delete the whole file and re-run; entries that no longer fire are dead and should stay gone. The list is monotonic-down (Core Concept 3).
- **Annotations are code review red flags.** A `__tsan_acquire/release` pair is a claim that you have correctly implemented lock-free synchronization — a claim that should get the most scrutiny in the entire review, because if you got the real fences wrong, you've now *also* silenced the detector that would have caught it (see the lock-free-queue War Story).
- **Prefer fixing to suppressing.** The whole value of TSan is the near-zero false-positive rate. Every suppression you add is a small tax on that value.

> **The principle:** suppressions and annotations are debt against your own detector. A small, documented, expiring set is healthy. A large, undocumented, package-wide set means you've quietly turned TSan off while still paying for the lane. Audit the suppression file the way you'd audit `// nolint` or `# type: ignore` — growth in it is a signal that the team is silencing the tool instead of using it.

---

## Core Concept 6 — Production Strategy When TSan Can't Run in Prod

TSan does not run in production. The 5–15× CPU cost and 5–10× memory cost make it a non-starter for serving traffic, and that's not a temporary limitation — it's inherent to instrumenting every memory access. So the production strategy for races is necessarily indirect, and it has two halves.

**Half one: maximize pre-prod interleaving coverage** — everything in Core Concept 2. Because you can't catch races in prod with TSan, you must catch them *before* prod by manufacturing the schedules. This is why the coverage work isn't optional polish; it's the only place dynamic race detection can happen. The mature posture is: continuous `-race` lane + `-count` multipliers + real stress tests + nightly soak + (where it pays) fuzzing-under-TSan. The goal is to push as much of the interleaving distribution as possible into pre-prod, leaving as thin a tail as possible to escape.

**Half two: observability for the races that escape.** Some interleavings only happen at production scale — true 64- or 128-core parallelism, production load, production timing, hardware you don't have in CI. For those, you instrument *consequences*, not the race itself:

- **Let the runtime tell you.** Go's "concurrent map writes" / "concurrent map read and map write" panics are free race detectors in production — they fire exactly when an unsynchronized map access corrupts state. Don't recover-and-swallow them; let them crash, capture the stack, and treat each one as a P1 with a reproduction owed.
- **Assertions and invariant checks** in hot paths — a checksum on a structure that "can't" change concurrently, a sequence-number gap detector, a "this counter should be monotonic" check. These convert silent corruption into a loud, debuggable signal (see [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md)).
- **Crash fingerprinting.** Cluster production crashes; a stack that recurs under high load but never reproduces locally is a race signature. Feed the implicated code back into a new stress test under TSan.
- **Canary at real concurrency.** If prod runs at 64 cores, a 4-core canary will never see the 64-core race. Where feasible, canary on production-representative hardware so timing-and-parallelism-dependent races have a chance to surface before full rollout.

> **The production discipline:** you can't run TSan in prod, so prod's job is to *report consequences* and feed them back into pre-prod stress. The loop is: race escapes → production panic/assert/crash-cluster fires → reproduce as a TSan stress test → fix → the stress test guards against regression. A race that escaped once should become a deterministic CI failure forever after. Closing that loop is the difference between fixing the race and fixing *this instance* of the race.

---

## War Stories

**The map-write that crashed prod every week.** A high-traffic Go service panicked with "fatal error: concurrent map writes" roughly once a week, always under peak load, never reproducible on any developer machine or in the normal test suite. The map was a request-scoped cache that *almost always* finished population before any concurrent reader arrived — the bad interleaving needed two requests to collide on the same key within microseconds, which only happened at production QPS. `go test -race` was green because the unit tests used one goroutine. The fix was found by writing a **stress test**: 64 goroutines hammering the cache under `-race -count=100`. The race fired on the second run. The map had been shared across goroutines without a mutex; the "it works in tests" comfort was pure luck of low-concurrency schedules. *Lesson:* a green `-race` on single-threaded tests proves nothing about a concurrent structure — you must manufacture the concurrency, and production QPS is an interleaving generator you can't match without deliberate stress.

**The "benign" counter that corrupted billing.** A metrics counter — `usageBytes += n` across goroutines, no atomic — was flagged by TSan during a rollout. The owning engineer suppressed it: "it's just a stats counter, worst case it's slightly off." Months later, finance noticed usage-based invoices were systematically *under*-counting for the largest (most concurrent) customers. Cause: the non-atomic `+=` was a classic lost-update — read-modify-write tearing under concurrency, dropping increments exactly in proportion to how parallel the customer's traffic was. The "benign" stats counter *was* the billing input. The fix was a one-line `atomic.AddInt64`. The suppression that hid it cost a quarter of mis-billing and a revenue restatement. *Lesson:* "benign race" is a smell, and "it's just a counter" ignores that the counter usually feeds *something* — here, money. The cost of the fix (one atomic) was trivial; the cost of being wrong was enormous. The asymmetry always says fix it.

**The lock-free queue TSan "got wrong" — except it didn't.** A team built a high-performance lock-free SPSC queue in C++. TSan flagged a race between the producer's write and the consumer's read. A senior engineer, confident in the lock-free design, concluded TSan didn't understand lock-free code and *annotated the race away* with `__tsan_acquire`/`__tsan_release`. The queue then corrupted data under load on ARM servers but not x86. The truth: the publication used a plain store where it needed a `release` store, and the consumer used a plain load where it needed an `acquire` load. On x86's strong memory model the missing fences were usually invisible; on ARM's weaker model the reordering tore the data. **TSan had been correct** — the accesses genuinely were not synchronized, because the real release/acquire fences were missing. The annotation didn't *fix* the synchronization; it *silenced the only tool that had detected the missing synchronization.* The fix was to use `std::atomic` with explicit `memory_order_release`/`memory_order_acquire` and delete the annotation. *Lesson:* annotating a TSan report on lock-free code is a claim that your fences are already correct — and if TSan is reporting a race, that claim is probably false. Annotations on lock-free code deserve the harshest review in the codebase.

**The race that only appeared at 64 cores.** A service passed every test, every stress test, and weeks of soak on 8-core CI runners. It started corrupting state in production, which ran on 64-core machines. The race needed genuine parallelism — not just concurrency (interleaved on few cores) but *true simultaneity* across many cores — to hit a window where two CPUs executed a non-atomic read-modify-write at the same instant. The 8-core soak literally could not produce the schedule; with 8 hardware threads, the probability of the exact simultaneous collision was negligible, but at 64 it became routine. The fix came from running the **soak test on production-representative hardware** (64 vCPUs) under `-race`, where it reproduced in minutes. *Lesson:* core count is part of your interleaving coverage. Concurrency on few cores does not sample the same schedule space as parallelism on many. If prod runs wide, your stress and soak must run wide.

---

## Decision Frameworks

**Is this race real, or a tooling artifact?** (TSan's false-positive rate is near zero, so the prior is "real.")

| Signal | Likely real bug | Likely tooling artifact |
|---|---|---|
| Language is C/C++ | Always — any data race is UB | Essentially never |
| TSan shows two stacks with no HB edge | Yes — that's a genuine race | Only if a real sync edge is invisible to TSan |
| Custom lock-free / non-standard sync involved | Probably real (your fences are likely wrong) | Possible — but prove the fences first, don't annotate-away |
| Synchronization via a mechanism outside the runtime (mmap doorbell, custom futex) | — | Plausible — TSan can't see it; annotate the real edge |
| "It's benign / just a flag / just a counter" | Almost always real | The phrase itself is a red flag |
| Reproduces under stress/`-count` | Definitely real | No |

**How to make a rare race reproduce** (cheapest first):

| Technique | Cost | Best for |
|---|---|---|
| Continuous `-race` lane | Low (standing CI) | Catching the broad middle of the distribution |
| `-count=N` / loop the suspect test | Very low | Resampling schedules from existing tests |
| Real stress test (many goroutines, high `GOMAXPROCS`) | Low–medium | Concurrent data structures; the highest-yield single move |
| Randomized / chaos scheduling (rr `--chaos`, TSan options) | Medium | Ordering-dependent bugs the default scheduler hides |
| Fault/latency injection | Medium | Races whose window only opens on slow paths |
| Soak (hours–days under load) | High | The long tail; rare schedules by brute force |
| Soak on production-core-count hardware | High | True-parallelism races (the 64-core class) |
| Fuzzing under TSan | High setup | Races gated behind specific inputs/paths |

**When to annotate vs fix vs suppress:**

| Situation | Action | Why |
|---|---|---|
| Real race in your code | **Fix** (add the lock/atomic) | It's a bug; the fix is usually cheap |
| C/C++ "benign" race | **Fix** with `atomic` | There is no benign data race in C/C++ — it's UB |
| Legit custom sync TSan can't see, *verified correct* | **Annotate** (narrow, reviewed) | Restores a true HB edge so TSan stops false-flagging |
| Lock-free code TSan flagged | **Fix the fences**, don't annotate | A flag means your release/acquire are probably wrong |
| Third-party code you can't change | **Suppress** (narrow, commented, expiring) | You can't fix it; scope tightly so you don't blind yourself |
| Rollout backlog of pre-existing races | **Baseline + gate-on-new** | Stop the bleeding; burn down the list monotonically |

**TSan lane: cost vs coverage:**

| Investment | Cost | Coverage gained | Verdict |
|---|---|---|---|
| No `-race` lane | $0 | Zero — races found in prod | Unacceptable for any Go shop |
| `-race` on merge only | 1× lane (5–15× per run) | Broad middle of distribution | Baseline minimum |
| `-race` on merge + nightly `-count` | + nightly budget | Resamples schedules; catches the meatier tail | Strong default |
| + dedicated stress suite | + maintenance | Concurrent structures specifically | High ROI for libraries/infra |
| + soak on prod-core hardware | High | True-parallelism / long-tail races | For systems where a race = revenue/safety incident |
| + fuzzing-under-TSan | High setup | Input-gated races | For parsers, protocol/state machines |

---

## Mental Models

- **TSan finds races on schedules that run, not races that exist.** A green run is evidence about the interleavings you exercised, not a proof of correctness. Your job is coverage of *schedules*, not lines.

- **Coverage is the whole game; accuracy is solved.** The detector is near-perfect and near-silent on un-run interleavings. Every technique you reach for — `-count`, stress, chaos, soak, fuzzing — is one strategy: feed TSan more diverse schedules.

- **A TSan finding is a real bug until proven otherwise — and in C/C++ it's proven by definition.** The burden of proof is on whoever claims "benign," and "benign" is the word that precedes the expensive corruption stories.

- **Suppressions and annotations are debt against your own detector.** A small, documented, expiring set is healthy; a sprawling one means you've quietly turned TSan off while still paying for the lane. Audit them like `// nolint`.

- **Annotating a lock-free report is claiming your fences are already right.** If TSan flagged it, that claim is probably false — you've silenced the one tool that caught the missing `acquire`/`release`. Fix the memory orders instead.

- **Core count is coverage.** Concurrency on few cores does not sample the same schedule space as true parallelism on many. If prod runs wide, your stress and soak must run wide.

- **Production's job is to report consequences and feed them back.** You can't run TSan in prod, so let the runtime panic, assert invariants, fingerprint crashes — then turn each escape into a deterministic TSan stress test.

---

## Common Mistakes

1. **Treating a green `-race` run as proof of correctness.** It only covers the schedules that executed. A single-goroutine test of a concurrent structure proves nothing. Manufacture concurrency with stress and `-count`.

2. **Running `-race` weekly instead of continuously.** A race that surfaces in 1 of 500 runs is invisible at weekly cadence and routine at per-merge-plus-nightly. Make it a standing lane.

3. **Calling a data race "benign."** In C/C++ there is no such thing — it's UB the compiler can exploit by tearing or eliminating the access. In Go it can tear or crash the runtime. The phrase is a smell; the fix is usually one atomic.

4. **Annotating a lock-free race away instead of fixing the fences.** A TSan report on lock-free code almost always means your `release`/`acquire` are missing. The annotation silences the detector without fixing the bug — and it'll tear on weak memory models (ARM) even if x86 hides it.

5. **Over-suppressing.** A package-wide, undocumented, never-expiring suppression blinds TSan to all *future* races in that scope. Scope narrowly, comment with a ticket, expire periodically, prefer fixing.

6. **Trying to share a build/lane with ASan.** TSan and ASan are mutually exclusive in one binary — separate lanes, separate runs. Expecting one job to do both is a category error.

7. **Forgetting to raise timeouts and memory limits for the TSan lane.** The 5–15× slowdown and 5–10× memory turn passing tests into phantom "flakes" via timeout and OOM. Budget the lane's resources for instrumentation, not for the bare test.

8. **Disabling `-race` after the initial backlog shock.** Discovering forty real races is the tool *working*. Baseline them, gate-on-new, and burn down — don't shoot the messenger.

---

## Test Yourself

1. Your service's `-race` suite is green on every merge, yet production panics with "concurrent map writes" once a week. Explain why TSan didn't catch it and what you'd change to reproduce it pre-prod.
2. A senior engineer wants to suppress a TSan report on `usageBytes += n`, calling it "a benign stats counter." Give the two-sentence pushback and the actual fix.
3. Why can't TSan run in production, and what *two-part* strategy replaces it?
4. TSan flags a race in your hand-rolled lock-free queue. A teammate proposes adding `__tsan_acquire`/`__tsan_release` to silence it. Why is that probably the wrong move, and what's the real diagnosis?
5. You're turning on `-race` across a codebase that's never had it and the first run shows 41 findings. Describe the rollout strategy that neither blocks all merges nor lets the count grow.
6. A race passes all 8-core CI (including soak) but corrupts state in 64-core production. What dimension of coverage is missing, and how do you fix the gap?
7. Name four techniques to make a rare race reproduce, ordered cheapest-first, and say what each one is best at.

<details>
<summary>Answers</summary>

1. TSan only judges **interleavings that execute**; the unit tests ran the map with effectively one goroutine, so the racy schedule (two requests colliding on the same key within microseconds) never occurred under test — it only occurs at production QPS. **Fix:** write a stress test with many goroutines (e.g. 64) hammering the cache under `-race -count=N`; the bad schedule reproduces in a couple of runs. Then guard the map with a mutex (or use a concurrent map / `sync.Map`).
2. *Pushback:* "A data race in Go has no memory-model guarantees — this non-atomic `+=` is a lost-update that drops increments under concurrency, and the worst case isn't 'slightly off,' it's systematically under-counting for your most parallel (largest) customers. If this counter feeds billing or quotas, 'benign' is wrong by definition." *Fix:* `atomic.AddInt64(&usageBytes, n)` — one line.
3. TSan's instrumentation imposes ~5–15× CPU and ~5–10× memory overhead, inherent to instrumenting every access — too costly to serve traffic. The replacement is **(a) maximize pre-prod interleaving coverage** (continuous `-race` + `-count` + stress + soak + fuzzing-under-TSan) so most schedules are exercised before prod, and **(b) observe consequences in prod** (let runtime panics fire, add invariant assertions, fingerprint crashes) and feed each escape back as a deterministic TSan stress test.
4. A TSan report on lock-free code almost always means the **real `release`/`acquire` fences are missing or wrong** — the accesses genuinely aren't synchronized. Annotating claims the synchronization is already correct and *silences the only tool that detected the gap*; the bug will then tear on weak memory models (ARM) even if x86 hides it. **Real diagnosis:** replace the plain load/store with `std::atomic` using explicit `memory_order_acquire`/`memory_order_release` (or the language's equivalent), then delete the annotation.
5. **Baseline + gate-on-new ("ratchet").** Snapshot the 41 findings into a suppression/baseline set, then configure CI to fail only on races *not* in the baseline. The baseline is monotonic-down: every fix removes an entry, none may be added; track it as a burn-down. This stops new races immediately while letting the backlog be paid off over time. Run on a dedicated lane with raised timeouts/memory.
6. **True parallelism / core count.** Concurrency interleaved on 8 cores doesn't sample the same schedule space as genuine simultaneity across 64 cores; the racy window (two CPUs hitting a non-atomic RMW at the same instant) is negligibly rare at 8 and routine at 64. **Fix:** run stress/soak under `-race` on production-representative hardware (e.g. 64 vCPUs), where it reproduces — then fix the access (lock/atomic) and keep the wide-core stress test as a regression guard.
7. (1) **`-count` / loop the suspect test** — cheapest; resamples schedules from existing tests. (2) **Real stress test** (many goroutines, high `GOMAXPROCS`) — highest single-move yield for concurrent structures. (3) **Randomized/chaos scheduling** (rr `--chaos`, TSan options) — ordering-dependent bugs the default scheduler hides. (4) **Soak on prod-core hardware** — the long tail and true-parallelism races, by brute force.

</details>

---

## Cheat Sheet

```
THE ONE TRUTH
  TSan finds races on interleavings that EXECUTE, not races that exist.
  Green run = evidence about schedules you ran, NOT proof of correctness.
  Accuracy is solved; COVERAGE (of schedules) is your job, forever.

MAKE RARE RACES REPRODUCE (cheapest → costliest)
  go test -race -count=N ./...        resample schedules from existing tests
  stress test: 64 goroutines, high    highest single-move yield for structures
    GOMAXPROCS, randomized timing
  rr record --chaos / TSAN_OPTIONS     perturb scheduling, surface ordering bugs
  fault / latency injection            open windows that only appear on slow paths
  soak (hours–days under load)         the long tail by brute force
  soak on PROD core count (64+)        true-parallelism races
  fuzzing under TSan                   input-gated races

ROLLOUT TO A LARGE CODEBASE
  Day 0: full -race run → freeze findings as baseline
  Gate-on-new: CI fails only on races NOT in baseline
  Baseline is monotonic-DOWN (burn-down); never add, only remove
  Separate CI lane (5–15× CPU, 5–10× mem); CANNOT share build with ASan
  Raise timeouts + memory limits or you get phantom flakes/OOM

"BENIGN RACE" = SMELL
  C/C++: NO benign data race — it's UB; compiler can tear/eliminate. Fix = atomic.
  Go:    can tear (ARM) or crash runtime (map). Fix = sync/atomic, one line.
  Burden of proof is on whoever says "benign."

ANNOTATE vs FIX vs SUPPRESS
  real race          → FIX (lock/atomic)
  C/C++ "benign"     → FIX (atomic) — it's UB
  legit unseen sync  → ANNOTATE (narrow, reviewed, verified correct)
  lock-free flagged  → FIX THE FENCES (don't annotate — your acquire/release is wrong)
  3rd-party code     → SUPPRESS (narrow, commented w/ ticket, expiring)
  Over-suppression blinds TSan to FUTURE races — audit like // nolint

PRODUCTION (TSan can't run there)
  Pre-prod: maximize interleaving coverage (above)
  In prod : let runtime panics fire, assert invariants, fingerprint crashes
  Loop    : escape → reproduce as TSan stress test → fix → regression guard
```

---

## Summary

- **The coverage problem is the whole problem.** TSan finds races on interleavings that *execute*, not races that *exist*. Its accuracy is near-perfect and its false-positive rate near-zero — so a green run is evidence about the schedules you exercised, not a correctness proof. Everything else on this page is one strategy: feed TSan more diverse schedules.
- **Manufacture rare interleavings, cheapest-first:** continuous `-race`, `-count`/loops, real stress tests at high `GOMAXPROCS`, randomized/chaos scheduling, fault injection, soak (including on production core counts), and fuzzing-under-TSan. A race you can't reproduce is a race you can't fix with confidence.
- **Rolling out `-race`/TSan is a project:** expect an initial backlog of *real* races, freeze a **baseline** and **gate-on-new** (monotonic-down), run it as a **separate lane** (5–15× CPU, 5–10× memory, **cannot share a build with ASan**), and raise timeouts/memory. Flaky-under-race is almost always a *real* latent race, not a tooling problem.
- **"It's a benign race" is a smell.** In C/C++ there is no benign data race — it's UB. In Go it can tear or crash the runtime. The burden of proof is on whoever claims safety, and the fix is usually one atomic. The asymmetry — trivial fix vs weeks-long corruption — always says fix it.
- **Annotations and suppressions are debt against your own detector.** Use them narrowly, with tickets, and expire them. Annotating a lock-free report is claiming your fences are already correct — and a TSan flag means they probably aren't. Over-suppression silently blinds you to future races.
- **TSan can't run in prod**, so the strategy is two-part: maximize pre-prod interleaving coverage, and observe *consequences* in prod (runtime panics, invariant asserts, crash fingerprints) — feeding every escape back as a deterministic TSan stress test.

You can now operate dynamic race detection as an org-scale coverage problem, not a flag. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands why a green TSan run is not a correctness proof.

---

## Further Reading

- [Go: Data Race Detector](https://go.dev/doc/articles/race_detector) — the official guide to `-race`: usage, cost, and the explicit "build old, run continuously" advice every Go shop should internalize.
- [The Go Memory Model](https://go.dev/ref/mem) — the authoritative statement that racy Go programs have *no* guarantees; the foundation for pushing back on "benign."
- [Google sanitizers wiki — ThreadSanitizer](https://github.com/google/sanitizers/wiki/ThreadSanitizerCppManual) — flags, `TSAN_OPTIONS`, suppressions, and annotation APIs.
- ["ThreadSanitizer: data race detection in practice"](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/35604.pdf) (Serebryany & Iskhodzhanov) — the original paper; why the happens-before approach is precise and why coverage is the limiting factor.
- [C++ memory model and `std::atomic`](https://en.cppreference.com/w/cpp/atomic/memory_order) — the `acquire`/`release` semantics behind the lock-free War Story.
- [interview.md](interview.md) — the consolidated question set for this topic.

---

## Related Topics

- [01 — AddressSanitizer](../01-address-sanitizer-asan/professional.md) — the memory-safety counterpart; note it's a *separate* lane (TSan and ASan can't share a build).
- [03 — UndefinedBehaviorSanitizer](../03-undefined-behavior-sanitizer-ubsan/professional.md) — the third sanitizer lane; UBSan catches the UB that "benign" C/C++ races are an instance of.
- [05 — Coverage-Guided Dynamic Analysis](../05-coverage-guided-dynamic-analysis/professional.md) — coupling fuzzing with sanitizers to drive more code paths (and more interleavings) under instrumentation.
- [06 — Runtime Assertions & Contracts](../06-runtime-assertion-and-contract-checking/professional.md) — the in-prod consequence-observability half of the race strategy.
- [Language Internals → Concurrency](../../../language-internals/concurrency-async-parallel/concurrency/) — memory models, happens-before, and the synchronization primitives TSan reasons about.
