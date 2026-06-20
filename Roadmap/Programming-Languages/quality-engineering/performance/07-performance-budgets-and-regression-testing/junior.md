# Performance Budgets and Regression Testing — Junior Level

> **Roadmap:** [Performance](../README.md) → Performance Budgets and Regression Testing
> *Nobody ever ships a commit titled "make the app 400ms slower." Slowness arrives one harmless-looking millisecond at a time, and by the time anyone notices, the cause is spread across two hundred commits and nobody can find it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Performance Rots Silently](#core-concept-1--performance-rots-silently)
5. [Core Concept 2 — A Budget Turns a Vague Goal Into a Testable Line](#core-concept-2--a-budget-turns-a-vague-goal-into-a-testable-line)
6. [Core Concept 3 — A Regression Test Is Just a Test That Fails When Things Get Slower](#core-concept-3--a-regression-test-is-just-a-test-that-fails-when-things-get-slower)
7. [Core Concept 4 — Baselines: Comparing New Against Known-Good](#core-concept-4--baselines-comparing-new-against-known-good)
8. [Core Concept 5 — Wiring It Into CI](#core-concept-5--wiring-it-into-ci)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why does software get slower over time, and how do you stop it?**

Here is a story that has happened to every team. Version 1 of the app responds in 80 milliseconds. Everyone is happy. Eighteen months later, the same screen takes 600 milliseconds, users are complaining, and an engineer is told to "make it fast again." But there is no single commit to revert — no villain. There were two hundred pull requests, and each one added five, ten, twenty milliseconds. Every single one of them passed code review. Every single one of them looked reasonable in isolation. This is *death by a thousand cuts*, and it is the default fate of any system whose performance nobody is actively guarding.

The reason it happens is simple: correctness has a guardian and performance usually does not. If you break a feature, a test fails and the build goes red — the team is *forced* to deal with it before merging. But if you make a feature 8ms slower, *nothing happens*. The tests are green. The PR merges. The slowdown is invisible until it accumulates into something a human can feel, and by then it is too late to attribute.

This page is about giving performance the same guardian that correctness has. The tool is a **performance budget**: a specific number you commit not to exceed — `p99 latency < 200ms`, `JS bundle < 250KB`, `allocations per request < 40`. And the enforcement mechanism is a **regression test**: a benchmark that runs on every pull request and *fails the build* if the code got slower than the budget allows, exactly like a unit test fails when behaviour breaks. You will not learn to make code fast here — that is profiling and optimization. You will learn to *keep* it fast, which is a different and more durable skill.

> **The mindset shift:** stop treating performance as a quality you *have* and start treating it as a quality you *defend*. Speed is not a property of code; it is a property of code *plus the discipline that prevents it from drifting*. Performance you don't guard is performance you will lose — not in one dramatic event, but quietly, a millisecond at a time.

---

## Prerequisites

- **Required:** You can write and run a basic test in some language and you understand what "the build went red" means in CI.
- **Required:** You've used a terminal and a version-control tool (commits, branches, pull requests).
- **Helpful:** You've written or read a benchmark — code that measures how long an operation takes. (We use Go's, which are beginner-friendly.)
- **Helpful:** You've experienced an app or website that felt fast once and feels sluggish now. That feeling is the problem this page solves.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Performance budget** | A specific limit you promise not to exceed (e.g. `latency < 200ms`, `bundle < 250KB`). |
| **Regression** | A change that makes something *worse* than it was — here, slower or heavier. |
| **Benchmark** | Code that measures how long an operation takes or how much memory it uses. |
| **Baseline** | A saved, known-good measurement you compare new results against. |
| **CI (Continuous Integration)** | The automated system that runs your tests on every push / pull request. |
| **p99 (99th percentile)** | The latency that 99% of requests come in *under*; the slow-but-not-rarest case. |
| **allocs/op** | Memory allocations per operation — a Go benchmark metric; fewer is usually faster. |
| **Threshold** | The line that separates "acceptable" from "fail the build" (often baseline + a margin). |
| **Noise** | Random run-to-run variation in timing that isn't caused by your code change. |

---

## Core Concept 1 — Performance Rots Silently

The central fact you must internalize: **performance degrades by default, and it does so invisibly.** Unlike a crash or a wrong answer, a slowdown produces no error, no stack trace, no red build. It just *is*, and it grows.

Why does it grow? Because every feature you add does *something*, and "something" costs time. A new validation check. An extra database query. A larger payload. A logging call in a hot loop. None of these are bugs. Each is a deliberate, reasonable trade — a feature for a few milliseconds. The problem is purely *additive math*: a hundred reasonable trades is a feature-rich app that is unusably slow.

Picture the curve over a year:

```
latency
  600ms |                                          ____
        |                                    _____/
        |                              _____/
  300ms |                       ______/
        |              _______/
   80ms |____________/
        +--------------------------------------------------> time / commits
         v1                                          today
        "fast"        each PR: +5..20ms          "why is it so slow?"
```

No single step looks alarming. Slide your eye along the line and you can't point to *the* commit that ruined it — there isn't one. This is what makes it so dangerous and so hard to fix after the fact: by the time the slowness is *felt*, the cause is *distributed* across hundreds of changes, and bisecting through them is miserable.

The cure is not heroic optimization sprints once a year (which only buy back ground you'll lose again). The cure is to **catch each cut at the moment it's made**, while the cause is a single PR you can see, review, and reject. A 12ms regression is trivial to find and fix when it's the only change in the diff. It is nearly impossible to find when it's buried under six months of unrelated work.

> **Key insight:** You can't fight an enemy you can't see. The entire discipline of performance regression testing exists to make slowdowns *visible at the moment they're introduced*, when fixing them is cheap, instead of *visible only in aggregate*, when fixing them is a project.

---

## Core Concept 2 — A Budget Turns a Vague Goal Into a Testable Line

"The app should be fast" is not a goal. It is a wish. You cannot test it, you cannot fail a build on it, and three engineers will have three different ideas of what "fast" means. A **performance budget** replaces the wish with a *number*:

- "The search endpoint's **p99 latency must stay under 200ms**."
- "The homepage's **JavaScript bundle must stay under 250KB** (gzipped)."
- "Parsing one request must use **fewer than 40 allocations**."
- "The checkout flow must complete in **under 1.5 seconds** on a mid-range phone."

The magic of a budget is not the number itself — it's that a number is *testable*. "Fast" can't fail a build; `p99 < 200ms` can. The moment you write a budget down, the question "is this PR acceptable?" stops being a matter of opinion and becomes a matter of measurement. Either the number is under the line or it isn't.

A budget also does something subtle and valuable: it **makes the cost of a feature explicit at decision time**. Imagine a budget of 250KB on your bundle and you're at 240KB. A new feature wants to add a 30KB chart library. Without a budget, that library gets added, nobody notices, and the page is now 270KB and slower for everyone — forever. *With* a budget, adding it blows the limit, the build fails, and the team has a real conversation: do we want this chart more than we want a fast page? Maybe yes! But now it's a *choice* someone made on purpose, not an accident that happened to everyone.

That is the whole point. A budget doesn't forbid spending — it forces spending to be *deliberate*. You're allowed to go over budget; you just have to *raise the budget on purpose*, in a commit, with a reason. The slowness can't sneak in.

> **Key insight:** A budget converts "fast" (an opinion no test can check) into "under N" (a line every test can check). The number doesn't have to be perfect — almost any reasonable line is infinitely better than no line, because *a line is the only thing CI can enforce*.

---

## Core Concept 3 — A Regression Test Is Just a Test That Fails When Things Get Slower

You already trust regular tests. A unit test asserts `add(2, 3) == 5`; if a change breaks that, the test fails and the build is red. A **performance regression test** is the exact same idea pointed at *speed* instead of *correctness*: it measures how long something takes (or how much it allocates), and **fails if that number is worse than allowed.**

Here's the smallest possible version using a Go benchmark. Go has benchmarking built into its test tooling, which makes it the friendliest place to start. A benchmark is a function that runs your code `b.N` times so the tool can measure it precisely:

```go
// search_test.go
package search

import "testing"

func BenchmarkSearch(b *testing.B) {
    index := buildTestIndex() // set up once, not measured
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        Search(index, "performance budget")
    }
}
```

Run it and Go reports timing and memory:

```bash
$ go test -bench=BenchmarkSearch -benchmem
BenchmarkSearch-8    52310    22841 ns/op    4096 B/op    37 allocs/op
```

Read that line: each call to `Search` took about **22,841 nanoseconds** (~23µs), used **4096 bytes**, and made **37 allocations**. Those three numbers are exactly the kind of thing you put a budget on. Now turn the benchmark into a *failing test* — a hard ceiling that breaks the build if crossed:

```go
func TestSearchAllocBudget(t *testing.T) {
    index := buildTestIndex()
    const budget = 40 // allocs/op — our committed limit

    result := testing.Benchmark(func(b *testing.B) {
        for i := 0; i < b.N; i++ {
            Search(index, "performance budget")
        }
    })

    if got := result.AllocsPerOp(); got > budget {
        t.Fatalf("alloc regression: %d allocs/op exceeds budget of %d", got, budget)
    }
}
```

Now if some innocent-looking PR pushes `Search` from 37 to 45 allocations, *this test goes red*, in *that PR*, with a message that names the problem. The author sees it immediately, while the cause is the only thing in their diff. That is the entire mechanism — there is nothing more sophisticated going on. You've given speed the same red-build guardian that correctness has had all along.

> **Key insight:** A performance regression test is not a special, exotic thing. It is an ordinary test whose assertion happens to be `measured_cost <= budget` instead of `output == expected`. Once you see that, "guarding performance in CI" stops sounding hard and starts sounding like Tuesday.

---

## Core Concept 4 — Baselines: Comparing New Against Known-Good

A fixed budget like "`< 40 allocs`" is a great start, but it has a weakness: it only catches you when you cross the *absolute* line. If you're at 37 and a PR pushes you to 39, the absolute budget of 40 is happy — yet you just absorbed a real regression, and the *next* small PR will tip you over with no warning. The thousand cuts can still get you; they just have to be quieter.

The stronger approach is a **baseline**: a saved record of the *known-good* measurement, so you compare *new vs. previous* rather than *new vs. some far-off ceiling*. The rule becomes "this PR may not be meaningfully slower than `main` is *today*," which catches the 37→39 creep that an absolute budget misses.

In Go, the standard tool for this comparison is `benchstat`. You save the current good numbers, then compare your branch against them:

```bash
# 1. On main: capture the baseline
$ git checkout main
$ go test -bench=. -benchmem -count=10 > baseline.txt

# 2. On your branch: capture the new numbers
$ git checkout my-feature
$ go test -bench=. -benchmem -count=10 > new.txt

# 3. Compare — benchstat tells you what actually changed
$ benchstat baseline.txt new.txt
name       old time/op    new time/op    delta
Search-8     22.8µs ± 2%    27.1µs ± 3%   +18.9%  (p=0.000 n=10+10)
```

That `+18.9%` is the regression, stated plainly, *with a confidence value* (`p=0.000` means it's almost certainly a real change, not random noise). Notice the `±2%` and `n=10` — they exist because timing is **noisy**. A single benchmark run can be off by several percent purely due to the OS scheduling other work, CPU frequency scaling, or caches being warm or cold. That's why you run it *multiple times* (`-count=10`) and let the tool decide whether a difference is signal or noise. A baseline comparison without repeated runs will fire false alarms constantly and teach the team to ignore it — the worst outcome.

The practical pattern most teams land on combines both ideas: an **absolute budget** as a hard backstop ("never exceed 250KB, period") *and* a **baseline comparison** with a small tolerance ("don't regress more than ~5% versus `main`"). The budget catches the cumulative drift; the baseline catches the individual cut.

> **Key insight:** An absolute budget asks "are we still under the ceiling?" A baseline asks "did *this change* make things worse?" You want both: the ceiling stops slow accumulation, the baseline catches each fresh cut — and *neither* is meaningful without enough repeated runs to separate a real regression from random timing noise.

---

## Core Concept 5 — Wiring It Into CI

A regression test that only runs when someone remembers to run it locally is worthless — it depends on the one human who is busiest at the moment. The value is unlocked the instant it runs **automatically on every pull request**, so the check happens whether anyone remembers or not. That's what CI is for.

Conceptually, the CI step is identical to running your normal tests, plus a comparison against the saved baseline. Here's a stripped-down GitHub Actions job that fails the build on a performance regression:

```yaml
# .github/workflows/perf.yml
name: performance
on: [pull_request]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }

      - name: Run benchmarks (this branch)
        run: go test -bench=. -benchmem -count=10 ./... > new.txt

      - name: Compare against committed baseline
        run: |
          go install golang.org/x/perf/cmd/benchstat@latest
          benchstat baseline.txt new.txt | tee result.txt
          # fail if any benchmark regressed beyond tolerance
          ./scripts/check_regression.sh result.txt   # exits non-zero on a bad delta
```

For the simplest possible version — no baseline file at all — the hard-ceiling test from Concept 3 needs *zero* extra setup: it's an ordinary Go test, so `go test ./...` already runs it, and CI already runs `go test`. The budget is enforced for free. That's the easiest place to start: write one `TestXxxBudget` with an absolute limit, and you have a real performance guardian today.

Two warnings about CI environments specifically. First, **shared CI runners are noisy** — they're virtual machines sharing hardware with other jobs, so absolute timings bounce around far more than on your laptop. This is exactly why baseline-with-tolerance and repeated runs matter so much in CI: trust *relative* changes and *allocation counts* (which are deterministic and don't drift with CPU load) more than raw wall-clock time. Second, **make the failure message actionable.** "Benchmark failed" teaches people to retry the build; "`Search` regressed +18.9% (22.8µs → 27.1µs), budget is +5%" teaches them to look at their own diff.

> **Key insight:** The discipline only works when it's *automatic and unavoidable*. A check that runs on every PR and blocks merge is a guardian; a check that runs "when you remember" is a suggestion, and suggestions lose to deadlines every single time.

---

## Real-World Examples

**1. The web page that gained 400ms over a year.** A marketing site loads in 1.1s at launch. Over twelve months the team adds an A/B testing script, a chat widget, a heavier hero image, three font weights, and an analytics bundle. Each addition was approved; each was small. The site now loads in 2.4s and conversions are down. The fix going forward is a **bundle-size budget** enforced in CI (`total JS < 250KB`, `largest image < 200KB`): the *next* time someone adds a 90KB widget, the build fails and the team decides on purpose whether the widget is worth the speed. The thousand cuts stop because each cut now has to justify itself.

**2. The allocation that quietly tripled GC pressure.** A Go service handles 10k requests/sec comfortably. A refactor changes a request parser to build strings with `+` in a loop instead of reusing a buffer — clean-looking code, all tests green. Latency at p99 creeps up over the following weeks as the extra garbage drives the garbage collector harder. With a regression test asserting `allocs/op <= 40` on the parser, this never ships: the PR that raised allocations from 37 to 58 goes red on the author's screen, named, in their diff. Allocation counts are *deterministic*, so this check is rock-solid even on noisy CI.

**3. The "fast on my Mac" trap.** An engineer optimizes a query and it's blazing on their M-series laptop, so they ship. In production — on older, busier servers — it's slower than before, because their fast local machine hid the regression. A budget defined as an *absolute number checked in CI* (not "feels fast for me") catches this, because CI runs on a consistent, neutral environment rather than the fastest machine on the team. The lesson: "fast on my machine" is the performance cousin of "works on my machine," and the cure is the same — measure somewhere neutral and automatic.

---

## Mental Models

- **Performance is a guarded border, not a fixed wall.** Left alone, the border creeps inward one quiet step at a time. A budget is the line on the map; the CI check is the guard who stops anyone who tries to cross it. Remove the guard and the line means nothing.

- **A budget is a smoke detector, not a fire extinguisher.** It doesn't make anything fast (that's profiling and optimization). It *alerts you the instant something starts smoking*, while a single PR is the only thing burning — long before the whole house is involved.

- **Regression testing is just unit testing with the assertion swapped.** `expect(output).toEqual(5)` guards correctness; `expect(latency).toBeLessThan(200)` guards speed. Same machinery, same red build, same "fix it before you merge." If you can write a unit test, you can write a regression test.

- **Baseline = "compared to last time"; budget = "compared to the ceiling."** The baseline catches each individual cut (37→39). The budget catches the accumulated total (we hit 250KB). You need both because each is blind to what the other sees.

- **Noise is the static on the radio.** Run a benchmark once and you're listening through static — you can't tell a real signal from crackle. Run it ten times and the static averages out, leaving the actual change audible. No repeated runs, no trustworthy signal.

---

## Common Mistakes

1. **Having a goal instead of a budget.** "It should be fast" can't fail a build, so nothing enforces it and performance drifts. Write a *number* (`p99 < 200ms`), or you have nothing CI can check.

2. **Only checking absolute limits, never deltas.** A hard ceiling of 40 allocs lets you creep from 37 to 39 unnoticed — until one more PR tips you over with no warning. Add a baseline comparison to catch the small cuts the ceiling misses.

3. **Benchmarking once and trusting the number.** Timing is noisy; a single run can be off by several percent for reasons unrelated to your code. Run multiple times (`-count=10`) and use a tool like `benchstat` to separate signal from noise — or you'll get false alarms and learn to ignore the check.

4. **Trusting wall-clock time on shared CI runners.** Cloud runners share hardware, so absolute timings bounce wildly. Lean on *allocation counts* and *relative deltas* (which are stable) rather than raw nanoseconds, or your build will fail randomly.

5. **A vague failure message.** "Benchmark failed" teaches people to hit retry. State *what* regressed, *by how much*, and *against what budget*, so the author knows it's their diff and what to fix.

6. **Running the check only locally / only sometimes.** A guardian that depends on someone remembering will be skipped on the busy day that matters most. Wire it into CI on every PR so it's automatic and blocks merge — that's the whole point.

7. **Treating the budget as sacred and never raising it.** Budgets are *deliberate spending limits*, not laws of nature. Sometimes a feature is worth the cost — then raise the budget *on purpose*, in a commit, with a reason. The goal is conscious choices, not zero spending.

---

## Test Yourself

1. In one sentence, explain "death by a thousand cuts" as it applies to performance.
2. Why does a slowdown not fail the build the way a broken feature does — and why is that the core problem?
3. What is the difference between a *performance budget* and a *baseline*? Give an example a budget catches that a baseline misses, and vice versa.
4. Your Go benchmark reports `37 allocs/op` today. Write (in words) the assertion that would turn this into a regression test with a budget of 40.
5. Why must a benchmark be run multiple times before you trust a comparison?
6. A teammate says "my change is fast, I tested it on my laptop." What's wrong with that as a regression guard, and what fixes it?

<details>
<summary>Answers</summary>

1. Performance degrades gradually as many small, individually-reasonable changes each add a few milliseconds, until the cumulative slowdown is severe but has no single cause to blame or revert.
2. A slowdown produces no error, stack trace, or red build — the tests stay green — so nothing forces the team to deal with it; it's the *invisibility* that lets it accumulate until it's expensive to fix.
3. A **budget** is an absolute ceiling ("under 250KB"); a **baseline** is the known-good previous measurement you compare against ("not slower than `main`"). A budget catches accumulated drift hitting the ceiling; a baseline catches a single small regression (e.g. 37→39 allocs) that's still under the ceiling.
4. Run the benchmark, take its `allocs/op`, and `t.Fatalf` (fail the test) if that number is greater than 40 — exactly like asserting an output equals an expected value, but the value is the measured allocation count.
5. Timing is noisy — a single run varies by several percent due to scheduling, CPU frequency, and caches — so repeated runs let a tool average out the noise and tell whether a difference is a real regression or random variation.
6. A fast personal laptop can hide a regression that shows up on slower, busier production hardware — it's "works on my machine" for speed. The fix is to enforce an absolute budget measured in a neutral, consistent CI environment on every PR.

</details>

---

## Cheat Sheet

```
THE PROBLEM
  performance rots silently: each PR +5..20ms, all green, no single villain
  → "death by a thousand cuts"; invisible until it's a project to fix

THE TWO TOOLS
  budget    = a committed number you won't exceed   (p99<200ms, bundle<250KB, allocs<40)
  baseline  = saved known-good measurement to diff against (new vs main)
  use BOTH: budget catches accumulated drift, baseline catches each fresh cut

REGRESSION TEST = UNIT TEST WITH A DIFFERENT ASSERTION
  correctness:  assert output == expected
  performance:  assert measured_cost <= budget   → red build when slower

GO QUICK START
  go test -bench=. -benchmem            # measure: ns/op, B/op, allocs/op
  go test -bench=. -count=10 > base.txt # capture baseline (repeat for signal)
  benchstat base.txt new.txt            # compare; reports delta + p-value

TRUST / DON'T TRUST  (on noisy shared CI)
  trust:    allocation counts, relative deltas      (deterministic / stable)
  suspect:  raw wall-clock nanoseconds on a single run (noisy)
  always:   run multiple times; require statistical confidence

MAKE IT STICK
  run on EVERY pull request in CI, block merge      (automatic > "when remembered")
  failure message names what regressed, by how much, vs which budget
  raising a budget is allowed — on purpose, in a commit, with a reason
```

---

## Summary

- **Performance rots silently.** It degrades by default, one reasonable PR at a time, with no error and no red build — *death by a thousand cuts*. By the time it's felt, the cause is spread across hundreds of commits and is miserable to find.
- **A budget turns "fast" into a testable line.** "It should be fast" can't fail a build; `p99 < 200ms` or `bundle < 250KB` can. The number forces the cost of every feature to be a deliberate choice instead of an accident.
- **A regression test is an ordinary test with a different assertion.** Instead of `output == expected`, it asserts `measured_cost <= budget`, and turns the build red — in the offending PR — when code gets slower. Same machinery as a unit test.
- **Baselines compare new against known-good.** An absolute budget catches accumulated drift hitting the ceiling; a baseline catches each individual small regression the ceiling would miss. Use both — and run benchmarks *multiple times*, because timing is noisy and a single run lies.
- **It only works automatically.** Wire the check into CI on every pull request so it blocks merge whether anyone remembers or not. Trust stable signals (allocation counts, relative deltas) over raw nanoseconds on shared runners, and make failures name exactly what regressed.

You now have the core idea: performance is something you *defend*, not something you *have*. The rest of this roadmap — profiling, benchmarking honestly, latency and throughput thinking — is about *what* to measure and *how* to make it faster. This page is about the discipline that ensures the fast code you write *stays* fast.

---

## Further Reading

- *Systems Performance* — Brendan Gregg. The canonical text on measuring system performance; read it for *what* to measure once you understand *why to guard it*.
- [`benchstat` documentation](https://pkg.go.dev/golang.org/x/perf/cmd/benchstat) — the standard Go tool for comparing benchmark runs with statistical rigor.
- [Go testing package — Benchmarks](https://pkg.go.dev/testing#hdr-Benchmarks) — how Go's built-in benchmarking actually works (`b.N`, `b.ResetTimer`, `-benchmem`).
- *web.dev — Performance budgets 101* — a practical, beginner-friendly take on budgets for web pages (bundle size, image weight, Core Web Vitals).
- The [middle.md](middle.md) of this topic, which formalizes statistical regression detection (Mann-Whitney U), trend dashboards, and handling flaky CI benchmarks.

---

## Related Topics

- [02 — Benchmarking and Microbenchmarks](../02-benchmarking-and-microbenchmarks/junior.md) — *how* to write a benchmark you can actually trust (avoiding dead-code elimination, warm-up, noise).
- [03 — Latency and Throughput](../03-latency-and-throughput/junior.md) — what `p99`, latency, and throughput mean — the quantities you put budgets on.
- [middle.md](middle.md) — statistical regression detection, trend tracking, and taming noisy CI benchmarks at the next level of depth.
