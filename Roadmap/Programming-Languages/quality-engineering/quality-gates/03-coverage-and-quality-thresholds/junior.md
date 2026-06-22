# Coverage & Quality Thresholds — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Coverage & Quality Thresholds
> *Some gates don't ask "pass or fail?" — they ask "what's the number, and is it good enough?" The first time CI blocks your PR because your coverage is 78% and the rule says 80%, you've met a quality threshold. The number is real, the gate is real — but what the number actually proves is far smaller than it looks.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Coverage, Recapped Simply](#core-concept-1--coverage-recapped-simply)
5. [Core Concept 2 — A Coverage Gate Turns the Number Into a Rule](#core-concept-2--a-coverage-gate-turns-the-number-into-a-rule)
6. [Core Concept 3 — Absolute vs Diff/Patch Coverage](#core-concept-3--absolute-vs-diffpatch-coverage)
7. [Core Concept 4 — The Ratchet: Coverage Can Only Go Up](#core-concept-4--the-ratchet-coverage-can-only-go-up)
8. [Core Concept 5 — Goodhart's Law: When a Number Becomes a Target](#core-concept-5--goodharts-law-when-a-number-becomes-a-target)
9. [Core Concept 6 — Other Quality Thresholds as Gates](#core-concept-6--other-quality-thresholds-as-gates)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is a numeric gate, and what does the number actually prove?**

You've met the pass/fail gate: a test either passes or it doesn't, the build either compiles or it doesn't. This page is about a *different shape* of gate — one that doesn't ask a yes/no question but reads a **number** off your change and blocks the merge if that number is out of bounds. The most common one by far: **code coverage must be at least 80%**. Your PR runs, CI measures what fraction of your code the tests actually touched, and if it lands below the line, the merge button greys out — exactly like a failing test, except the verdict came from a percentage, not a red ✗ on a single test.

These are called **quality thresholds** (or **numeric gates**), and coverage is only the first of them. The same machinery — measure a number, compare it to a limit, block if it's on the wrong side — is used to stop a function from getting too tangled (a **complexity** limit), to stop copy-pasted code from piling up (a **duplication** limit), to keep a JavaScript bundle from bloating (a **bundle-size budget**), and to keep a benchmark from quietly getting slower (a **performance-regression** gate). Once you understand the coverage gate, you understand all of them, because they're the same idea wearing different hats.

But there's a trap built into every numeric gate, and it's the single most important thing for you to internalize at this level. A number is easy to *measure* and easy to *game*. Coverage measures **"was this line of code run by a test"** — and that is *not* the same as **"is this line of code correct."** You can write a test that executes every line and checks *nothing*, and your coverage hits 100% while your tests prove nothing at all. So the gate is genuinely useful — as a *floor* that catches "you shipped untested code" — but it is not, and can never be, proof that your code works.

> **Mindset shift:** The threshold is a **floor, not a goal**. An 80% coverage gate is the team saying "below this line is *definitely* not enough testing" — it is the *minimum*, the thing you must clear, not the thing you should aim *at*. Chasing the number itself ("I need to hit 100%") leads you to write hollow tests that move the percentage without adding any safety. The number is a smoke detector that tells you when testing is *obviously missing*; it was never a measure of how good your tests are. Treat it as a floor you clear on your way to writing *real, asserting* tests — not a trophy to maximize.

This page teaches you: what coverage means, how a coverage gate works in CI, the crucial difference between gating the *whole project* and gating *only the lines you changed*, the "ratchet" idea that stops coverage from sliding backward, why Goodhart's law means the number can be gamed, and how the same pattern shows up as complexity, duplication, and size budgets.

---

## Prerequisites

- **Required:** You write tests for your code — even simple ones — and can run them (`go test`, `npm test`, `pytest`).
- **Required:** You understand what a **required CI check** is and why a red check blocks a merge. (See [01 — Required CI Checks](../01-required-ci-checks/junior.md) if not.)
- **Helpful:** You've seen a *coverage report* before — a number like "82% covered," or a file view with green and red lines — even if you didn't think hard about it.
- **Helpful:** You've opened a pull request and seen extra status checks from a bot (Codecov, Coveralls, SonarCloud) leaving a comment with numbers.
- **Not required:** Any prior knowledge of "diff coverage," "ratchet," or "Goodhart's law." We define every term.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Code coverage** | The percentage of your code that your tests actually *execute* when they run. |
| **Line coverage** | Coverage counted by lines: (lines run by tests) ÷ (total lines), as a percent. |
| **Branch coverage** | Coverage counted by decision paths: did the test hit *both* the `if` and the `else`? Stricter than line coverage. |
| **Threshold** | The minimum number the gate requires (e.g. "coverage ≥ 80%"). Cross it and you pass; fall short and you fail. |
| **Quality gate / numeric gate** | A required check that compares a measured number to a threshold and blocks the merge if it's out of bounds. |
| **Absolute (project) coverage** | Coverage of the *whole codebase*, including old code you never touched. |
| **Diff / patch coverage** | Coverage of *only the lines this PR added or changed*. "Did you test your new code?" |
| **Ratchet** | A rule that lets the number go *up* or stay flat but never *down* — like a ratchet wrench that won't turn backward. |
| **Goodhart's law** | "When a measure becomes a target, it ceases to be a good measure" — people optimize the number, not the thing it stood for. |
| **Cyclomatic complexity** | A number measuring how many decision paths a function has — roughly, how tangled it is. |
| **Code duplication** | How much code is copy-pasted (near-)identically across the codebase, usually reported as a percent. |
| **Budget** | A threshold framed as a ceiling you're allowed to spend up to (bundle-size budget, lint-error budget). |
| **Codecov / Coveralls** | Popular services that ingest your coverage report and post a pass/fail status check on the PR. |

---

## Core Concept 1 — Coverage, Recapped Simply

Before the gate, the measurement. **Code coverage** answers one question: *when my tests ran, what fraction of my code did they actually execute?* If your test suite never calls a function, every line in that function is **uncovered** — your tests never even *looked* at it.

The mechanism is mechanical. A coverage tool runs your tests with instrumentation that records every line as it executes. At the end it divides:

```
line coverage = (lines executed by at least one test) ÷ (total executable lines) × 100%
```

Concretely. Here's a tiny function and its test:

```go
func Classify(n int) string {
    if n < 0 {
        return "negative"      // line A
    }
    if n == 0 {
        return "zero"          // line B
    }
    return "positive"          // line C
}

func TestClassify(t *testing.T) {
    if Classify(5) != "positive" {
        t.Fatal("expected positive")
    }
}
```

That single test calls `Classify(5)`. Execution checks `n < 0` (false), checks `n == 0` (false), then runs line C. **Line A and line B never executed** — no test passed a negative number or zero. So the `negative` and `zero` paths are *uncovered*. Run the coverage tool and you'd see something like:

```bash
$ go test -cover ./...
ok   shop/classify   0.004s   coverage: 50.0% of statements
```

Half the statements ran. The `negative` and `zero` branches are an *untested promise* — they might be perfectly correct or quietly broken, and your tests would never tell you which. Most languages produce a per-line view too, where uncovered lines are flagged red:

```
classify.go
   1 | func Classify(n int) string {
 ✓ 2 |     if n < 0 {
 ✗ 3 |         return "negative"     ← never executed by a test
 ✓ 4 |     }
 ✓ 5 |     if n == 0 {
 ✗ 6 |         return "zero"         ← never executed by a test
   7 |     }
 ✓ 8 |     return "positive"
   9 | }
```

> **Key insight:** Coverage measures **execution, not correctness**. A line being "covered" means *a test caused it to run* — nothing more. It does **not** mean the test checked that the line did the right thing. Hold onto that distinction; it's the hinge the entire topic turns on. "Covered" = "looked at by a test"; it is *not* "verified by a test."

---

## Core Concept 2 — A Coverage Gate Turns the Number Into a Rule

A coverage *number* on its own is just information — useful to glance at, easy to ignore. A coverage **gate** turns it into a rule with teeth: **CI measures coverage on your PR and fails the check if it's below a threshold.** Now it's not advice; it's the same kind of hard stop as a failing test.

Mechanically, it's three steps wired into CI:

1. Run the tests *with coverage instrumentation* and write a coverage report file.
2. Read the number out of that report.
3. Compare it to the threshold; exit non-zero (fail the check) if it's below.

You can do the crudest version with nothing but the language's own tooling and a tiny script:

```yaml
# .github/workflows/coverage.yml
jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go test -coverprofile=coverage.out ./...   # 1. measure
      - name: Enforce 80% threshold
        run: |
          pct=$(go tool cover -func=coverage.out | grep total | awk '{print $3}' | tr -d '%')
          echo "total coverage: ${pct}%"
          # 3. fail the check if below 80
          awk "BEGIN { exit !($pct >= 80) }"
```

If total coverage is 80% or above, the last command exits `0` and the check is green. If it's 79.4%, it exits non-zero and the check goes red — your merge button greys out, exactly like a failing test. That's the whole gate: *a number, a threshold, a non-zero exit when you're under.*

In practice you rarely hand-roll it. Most teams use a service — **Codecov** or **Coveralls** — that ingests the report and posts its own status check on the PR. Their config is just a threshold declaration:

```yaml
# codecov.yml
coverage:
  status:
    project:                 # gate on WHOLE-PROJECT coverage
      default:
        target: 80%          # require ≥ 80% overall
    patch:                   # gate on the CHANGED lines only
      default:
        target: 80%          # require ≥ 80% of new/changed lines covered
```

And what lands on your PR is a status check plus a comment:

```
✔  ci/build              Successful
✔  ci/test               Successful
✘  codecov/patch         58% of diff hit (target 80%)        ← BLOCKS the merge
✔  codecov/project       81.2% (+0.1%)  vs  81.1%

   Codecov Report
   Patch coverage: 58.00%  —  21 of 36 changed lines covered
   ⚠  21 lines in your changes are not covered by tests
```

Read that the same way you read any check list: build and test are green, project coverage is fine, but **`codecov/patch` is red** because only 58% of the lines *you changed* were covered, against an 80% target. The fix isn't mysterious — write tests that exercise those 15 uncovered lines.

> **Key insight:** A coverage gate is "just another required check," but the *category* of failure is different. A red test means **your code is wrong**. A red coverage gate means **your code might be fine, but it isn't tested enough** — nobody is claiming a bug exists; the gate is saying "you haven't given me evidence." The fix is always *add tests* (or, occasionally, justify an exclusion), never "change the logic."

---

## Core Concept 3 — Absolute vs Diff/Patch Coverage

This is the most important practical distinction in the whole topic, and it decides whether a coverage gate feels *fair* or feels like punishment for sins you didn't commit. There are two fundamentally different things a coverage gate can measure.

**Absolute coverage** (also called **project** or **total** coverage) gates the *entire codebase*: "the whole project must be ≥ 80% covered." This is the blunt instrument. The problem: it judges you for code you never touched. Imagine you join a project sitting at 62% coverage and your job is a tiny three-line bug fix. With a hard absolute gate at 80%, *your* PR is blocked — not because your three lines are untested, but because a decade of other people's untested code drags the total down. You'd have to write tests for unrelated legacy code just to merge a one-character fix. That's why pure absolute gates are widely disliked: they punish the wrong person at the wrong time.

**Diff coverage** (also called **patch** coverage) gates *only the lines your PR added or changed*: "of the lines you touched, ≥ 80% must be covered." This is far fairer and is what most teams actually enforce. It asks one honest, scoped question: **"Did you test your new code?"** It says nothing about the legacy mess you didn't write — that's not your PR's fault — and everything about whether *the work in front of you* came with tests.

Here is the difference made concrete. Say the project is 100,000 lines at 62% overall. Your PR adds **50 new lines**, of which **40 are covered** by the tests you wrote:

```
PROJECT (absolute):  62,040 / 100,050 covered  →  62.0% overall
                     a hard 80% absolute gate → ✘ BLOCKED (the legacy 62% sinks you)

PATCH (diff):        40 / 50 changed lines covered  →  80.0% patch coverage
                     an 80% patch gate → ✔ PASSES (you tested your new work)
```

Same PR, opposite verdicts. The patch gate rewards exactly the behavior you want — *test the code you write* — without holding you hostage to the past. That worked example is the heart of why **diff/patch coverage is the default for any sane team** and the kind of gate you should *expect* to meet on a real PR.

A diff-coverage config makes the scope explicit — note `patch`, not `project`:

```yaml
# codecov.yml — patch-only gate (the common, fair choice)
coverage:
  status:
    patch:
      default:
        target: 80%          # 80% of CHANGED lines must be covered
        threshold: 0%        # no slack — the diff must hit the target
    project:
      default:
        target: auto         # don't enforce a hard absolute number;
        threshold: 0.5%      # just don't let total DROP by more than 0.5% (a ratchet — next concept)
```

This is the configuration you'll see most: a *firm patch gate* ("test what you change") paired with a *gentle project ratchet* ("don't make the overall number worse").

> **Key insight:** **Diff/patch coverage > absolute coverage** for day-to-day gating, because it scopes the question to *your* change. Absolute gates punish you for old untested code; diff gates ask only "did you test what you wrote?" When a coverage gate blocks your PR, your first question should be *which kind* — a red **patch** check means you genuinely left new code untested (go fix it); a red **absolute** check on a tiny change usually means the gate is mis-designed, and that's a conversation to have with whoever owns it.

---

## Core Concept 4 — The Ratchet: Coverage Can Only Go Up

Even with a fair diff gate, there's a slow-bleed problem. Coverage tends to *drift downward* over time: someone adds code without tests, someone deletes a well-tested module, and percent by percent the number sinks. The fix is a wonderfully simple idea borrowed from a hand tool: the **ratchet**.

A ratchet wrench turns one way and *locks* the other — it can tighten but never loosen. A **coverage ratchet** applies the same rule to your number: **total coverage may go up or stay flat, but it may never go down.** It doesn't demand you reach 80% today. It demands only that you never make things *worse* than they are right now. If the project is at 62%, the ratchet says "fine — but the next PR must leave it at 62% or higher." Over many PRs, the floor keeps clicking upward and never slips back.

Concretely, the gate compares your PR's total coverage to the base branch's:

```
base branch (main):   coverage = 62.0%

  PR #1 adds tests       → 62.4%   ✔  (went UP — allowed, new floor is 62.4%)
  PR #2 adds untested code → 61.8% ✘  (went DOWN — BLOCKED by the ratchet)
  PR #3 no net change    → 62.4%   ✔  (flat — allowed)
```

In Codecov terms, that's the `project` status with `target: auto` — "auto" means *compare against the base branch*, and `threshold` is how much downward slack (if any) you tolerate:

```yaml
coverage:
  status:
    project:
      default:
        target: auto      # compare to the base branch coverage
        threshold: 0%     # 0% slack → coverage must NOT drop at all (a strict ratchet)
```

The ratchet is the gentler, more humane cousin of the absolute gate. An absolute 80% gate on a 62% project is a brick wall that blocks *everyone* until a huge testing effort happens. A ratchet on the same project blocks *nobody* who isn't actively making it worse, and the number still climbs steadily as people add tests. It turns "we're at 62% and ashamed" into "we're at 62% and it only ever goes up from here," which is a far more achievable promise — improve continuously instead of all at once. SonarQube packages this exact philosophy under the name **"Clean as You Code"**: don't try to fix the whole old codebase at once; just guarantee that everything *new* meets the bar, and the codebase heals over time.

> **Key insight:** A **ratchet** changes the question from "are you good enough yet?" (an absolute target most legacy projects fail) to "are you making it worse?" (which is fair to ask of *every* PR). It's how teams escape the trap of a coverage number too low to mandate but too important to ignore: stop the bleeding first, then let the floor click upward one PR at a time.

---

## Core Concept 5 — Goodhart's Law: When a Number Becomes a Target

Now the big lesson — the one that separates an engineer who *uses* metrics from one who is *used by* them. It has a name: **Goodhart's law**, usually stated as *"When a measure becomes a target, it ceases to be a good measure."* In plain terms: the moment you reward people for moving a number, they'll move the number — by the *easiest* path, which is often not the one you actually wanted.

Coverage is the textbook victim. Coverage was *supposed* to be a proxy for "the code is well tested." But the gate doesn't reward "well tested" — it can only reward "high coverage percentage." And the easiest way to raise coverage is *not* to write good tests; it's to write tests that **execute** code without **asserting** anything about it. Look:

```go
func Discount(price float64, isMember bool) float64 {
    if isMember {
        return price * 0.9        // 10% off for members
    }
    return price
}

// A test that achieves 100% coverage and proves NOTHING:
func TestDiscount_Hollow(t *testing.T) {
    Discount(100, true)           // runs the member branch
    Discount(100, false)          // runs the non-member branch
    // ...no assertion. Both lines "covered." Test always passes.
}
```

That test gives you **100% coverage of `Discount`**. The coverage gate goes green. And it would *still* go green if a bug changed `0.9` to `0.5`, or to `1.9`, or deleted the discount entirely — because the test never *checks the result*. It only proves the lines *ran*, which is exactly, and only, what coverage measures. Compare a *real* test:

```go
func TestDiscount(t *testing.T) {
    if got := Discount(100, true); got != 90 {     // ASSERTS the member price
        t.Errorf("member: got %v, want 90", got)
    }
    if got := Discount(100, false); got != 100 {   // ASSERTS the non-member price
        t.Errorf("non-member: got %v, want 100", got)
    }
}
```

Same 100% coverage. Completely different value: change `0.9` to `0.5` and *this* test fails instantly. The coverage number cannot tell these two tests apart — they look identical to it. **That is Goodhart's law in one screen:** the metric (coverage) and the goal (correctness) came apart the instant coverage became the target.

This is precisely why **100% coverage is not the goal**, and chasing it is often counterproductive. Pushing from a healthy 85% to a mandated 100% tends to manufacture exactly these hollow, assertion-free tests for the awkward last 15% (error paths, defensive branches), inflating the number while adding zero safety — and worse, creating tests that *look* like protection but catch nothing. A coverage gate is a useful **floor** ("you clearly under-tested this") and a poor **ceiling** ("you've tested enough"). It can prove testing is *missing*; it can never prove testing is *good*.

> **Key insight:** Coverage tells you what is **definitely untested** (the uncovered lines — genuinely valuable), but a high coverage number does **not** tell you the covered lines are **correctly** tested. So use the gate to catch the obvious gap — "you added 50 lines and tested none of them" — and never mistake a green coverage check for "this code is proven correct." The number is a floor for catching neglect, not a trophy for proving quality.

---

## Core Concept 6 — Other Quality Thresholds as Gates

Coverage is the most common numeric gate, but it's one of a family. *Any* code property you can reduce to a number can be turned into a gate with the identical pattern — **measure it, set a limit, block if it crosses.** Knowing the family helps you recognize a numeric gate on sight, whatever it's measuring.

**Complexity limits.** A tool measures **cyclomatic complexity** — roughly, how many independent decision paths a function has (each `if`, `for`, `case`, `&&` adds one). A very high number means a tangled function that's hard to read and test. A gate blocks any function over a limit:

```yaml
# golangci-lint config — fail on overly complex functions
linters-settings:
  gocyclo:
    min-complexity: 15      # flag any function with complexity > 15
```

```bash
$ golangci-lint run
service.go:88: cyclomatic complexity 22 of func `handleRequest` is high (> 15) (gocyclo)
```

The fix is to *break the function up* until each piece is below the limit — the gate is nudging you toward smaller, testable units.

**Duplication limits.** A tool detects copy-pasted blocks and reports the **duplicated percentage**; a gate fails the PR if it rises above a ceiling (e.g. "no more than 3% duplicated lines on new code"). It's the automated form of "don't copy-paste — extract it."

**Lint-error budgets.** Instead of "zero lint warnings" (often impossible on a legacy codebase), a team sets a **budget**: "no *new* lint errors" or "stay under N total." Same ratchet spirit — don't make it worse.

**Bundle-size budgets.** Front-end teams gate the size of the JavaScript a user must download, because every kilobyte slows page load. A budget fails the PR if the bundle grows past a ceiling:

```yaml
# bundlesize config — fail if a built file exceeds its budget
[
  { "path": "./dist/main.js",   "maxSize": "150 kB" },
  { "path": "./dist/vendor.js", "maxSize": "250 kB" }
]
```

```
main.js    158 kB  > 150 kB  ✘  FAIL (bundle grew past budget)
vendor.js  240 kB  < 250 kB  ✔
```

**Performance-regression gates** (handle with care). These run a benchmark and fail if your change made it meaningfully slower — e.g. "fail if this endpoint's latency regressed more than 10%." The idea is sound, but in practice these gates are **noisy**: CI machines are shared and their speed varies run-to-run, so the same code can look 8% slower one run and 5% faster the next, producing false alarms. They're valuable for catching *big* regressions but notoriously flaky as a hard gate for *small* ones — which is why teams often run them as advisory signals, or only block on large, statistically-confident regressions, rather than greying out the merge button on every wobble.

> **Key insight:** Every numeric gate is the **same machine** — measure a number, compare to a threshold, block if it's on the wrong side — only the number changes (coverage %, complexity, duplication %, lint count, kilobytes, latency). So every one inherits coverage's two lessons: it's a useful **floor** for catching obvious problems, and it's **gameable** the instant the number becomes the target. A complexity limit nudges you to split functions; gamed, it just hides logic in helper functions to dodge the count. Same trap, every time.

---

## Real-World Examples

**1. The fair PR that the diff gate let through.** A junior joins a service stuck at 64% absolute coverage and ships a 30-line feature, writing tests that cover 27 of those lines (90% patch). An *absolute* 80% gate would have blocked them for the team's old debt; the team's *patch* gate at 80% passes them cleanly — they tested their own work, which is all the gate should ask. The `codecov/patch` check is green at 90%, the `codecov/project` ratchet shows `+0.1%`, and the PR merges. The lesson lands without a lecture: gate the *diff*, not the *legacy*.

**2. The 100%-coverage codebase with a real bug in production.** A team mandated 100% coverage and was proud of the green badge. A pricing bug still shipped — a discount applied twice — because the test for that code *ran* the function but only checked it "returned a number," never the *right* number. Coverage was 100%; the assertion was hollow. The post-mortem's one-line conclusion: *"We measured that the code ran, not that it was right."* They kept measuring coverage but stopped worshipping the number, and added a rule that every test must assert a *specific* expected value.

**3. The coverage ratchet that healed a legacy project.** A 12-year-old codebase sat at 41% and nobody dared mandate a target — the gap was too big to ever close in one effort. Instead they switched on a strict ratchet (`project: target auto, threshold 0%`) plus an 85% patch gate. No big-bang testing project, no blocked team — just "every PR leaves it ≥ where it was, and new code is tested." Eighteen months later it had drifted to 68% purely as a side effect of normal work. Stopping the bleeding, then ratcheting, beat any heroic one-time push.

**4. The flaky performance gate that got demoted.** A team added a hard gate: "fail the PR if the checkout benchmark regresses >5%." Within a week it was failing PRs that changed *only documentation*, because the shared CI runners varied ±7% run to run. People started blindly re-running it until it passed — the exact trust-erosion that kills a gate. They demoted it to *advisory* (it comments the delta but doesn't block) and kept a *hard* gate only for regressions above 25% measured across several runs. The noisy gate became a useful signal once it stopped lying.

---

## Mental Models

- **Coverage is a fuel gauge, not a destination.** A gauge near empty is a real, actionable warning — "you'll get stranded." But a *full* tank doesn't mean you're going anywhere good; it says nothing about your *route*. Coverage near zero genuinely warns "untested code"; coverage near 100% says nothing about whether the tests *check the right things*. Watch the low end; don't worship the high end.

- **The threshold is a floor, not a ceiling.** Picture a literal floor: its job is to stop you falling *below* a minimum. It is not a target to press your head against. An 80% gate means "below 80% is definitely too little" — it does **not** mean "80% is the goal" and certainly not "100% is better." Clear the floor, then write *good* tests above it.

- **Diff coverage = "clean as you cook."** You inherited a messy kitchen (legacy untested code) — you're not required to deep-clean the whole thing before you can make dinner. But you *are* required to clean up *your own* mess as you go. Diff coverage asks only that: leave your new code tested, regardless of the existing pile.

- **A ratchet is a one-way valve.** It lets the number flow *up* and locks it from flowing *back*. You don't have to be at 80% today; you just can't slide below where you are now. Click by click, the floor rises and never drops.

- **Goodhart's law is a genie.** You wished for "well-tested code" and the genie heard "high coverage number" — and granted *exactly* that, with hollow assertion-free tests, in the most literal, least helpful way. Any time you turn a proxy into a target, expect the genie. The defense is to remember what the number was *standing in for* and check *that*, not just the number.

---

## Common Mistakes

1. **Treating the threshold as a goal instead of a floor.** "We need to hit 100%" is the tell. The gate's job is to catch *obviously missing* tests, not to be maximized. Chasing the last few percent manufactures hollow tests and wastes time on trivial or defensive branches that didn't need a test.

2. **Writing tests that execute but don't assert.** A test with no assertion (or a weak one like "it returned *something*") raises coverage while proving nothing — it goes green even when the code is broken. Coverage cannot tell a real test from a hollow one; *you* must. Every test should assert a *specific* expected result.

3. **Confusing "covered" with "correct."** A green coverage check means lines *ran* under test, not that they *do the right thing*. Never read a high coverage number as "this code is proven to work." It only ever proves what *wasn't* tested (the uncovered lines).

4. **Demanding absolute coverage on a legacy codebase.** A hard absolute gate (80% of *everything*) on an old project blocks innocent small PRs for sins they didn't commit, and pressures people to bolt low-value tests onto unrelated old code. Prefer a **diff/patch** gate plus a **ratchet**.

5. **Aiming for 100% and thinking it means "done."** 100% coverage with hollow tests is *worse* than 80% with sharp ones — it gives false confidence and hides the absence of real checks behind a green badge. 100% is not the goal; *meaningful* tests on the code that matters is.

6. **Letting a performance gate stay flaky.** A perf-regression gate that fails on documentation-only PRs (because CI machines vary run to run) trains the team to re-run-until-green and ignore it — the same trust erosion a flaky test causes. Make noisy perf checks *advisory*, or block only on large, repeated regressions.

7. **Not asking *which kind* of coverage gate is red.** A red **patch** check almost always means you genuinely left new code untested — fix it. A red **absolute** check on a tiny change usually means the gate is mis-designed — that's a conversation with the gate's owner, not a reason to write filler tests.

---

## Test Yourself

1. In one sentence each, define **coverage**, an **absolute** coverage gate, and a **diff/patch** coverage gate.
2. A PR adds 50 lines; 40 are covered by tests. The team gates **patch** coverage at 80%. Does it pass? Show the calculation.
3. Your three-line bug fix is blocked by a check reading "project coverage 62% < 80%." Whose fault is the failing number, really, and what kind of gate would have been fairer?
4. Explain a **coverage ratchet** in one sentence, and say what it requires of a PR on a project currently at 55%.
5. You can hit **100% coverage** on a function and still have a real bug ship. Explain *exactly* how, using the words *execute* and *assert*.
6. State **Goodhart's law** in your own words, and give the one-line version of how it applies to coverage.
7. Name three numeric gates *other than* coverage, and say what number each one measures.
8. Why are **performance-regression** gates often run as advisory rather than hard blockers?

<details>
<summary>Answers</summary>

1. **Coverage** = the percentage of your code that your tests actually *execute* when they run. **Absolute** gate = requires the *whole codebase* to be ≥ a threshold (e.g. 80% of all code). **Diff/patch** gate = requires ≥ a threshold of *only the lines this PR changed* ("did you test your new code?").
2. **Yes, it passes.** Patch coverage = 40 ÷ 50 = **80%**, which meets the 80% target. (The whole-project number is irrelevant to a *patch* gate.)
3. The failing **number** is mostly the fault of *old, pre-existing untested code* that drags the total down — *not* your three lines. A **diff/patch** gate would have been fairer: it would ask only whether *your* three lines are tested, ignoring the legacy debt.
4. A **ratchet** is a rule that lets total coverage go *up* or stay flat but never *down*. On a 55% project it doesn't require you to reach any high target — it only requires your PR to leave coverage at **55% or higher** (it must not drop).
5. Coverage only checks that a line was **executed** by a test, not that the test **asserted** anything about the result. A test can *call* a function (executing — and thus "covering" — every line) while *asserting* nothing, so a bug that changes the function's output still passes, and coverage still reads 100%.
6. **Goodhart's law:** once you reward people for moving a number, they optimize the *number* by the easiest path, which often isn't the real goal the number stood for. **For coverage:** the moment "high coverage" becomes the target, people write assertion-free tests that raise the percentage without testing anything — so coverage stops being a good proxy for "well tested."
7. Any three of: **complexity limits** (cyclomatic complexity — decision paths per function), **duplication limits** (percent of copy-pasted code), **lint-error budgets** (count of lint warnings/errors), **bundle-size budgets** (kilobytes of shipped JS), **performance-regression gates** (benchmark latency/throughput).
8. Because CI machines are **shared and vary run-to-run**, so the same code can measure several percent slower or faster between runs — a hard gate produces frequent false alarms (failing even documentation-only PRs), which trains the team to re-run-until-green and ignore it. Advisory mode (or blocking only on large, repeated regressions) keeps the useful signal without the noise.

</details>

---

## Cheat Sheet

```
WHAT IS A QUALITY THRESHOLD / NUMERIC GATE?
  A required check that reads a NUMBER off your change and BLOCKS the
  merge if it's out of bounds. (Coverage is the most common one.)
  measure → compare to threshold → exit non-zero (fail) if on the wrong side.

COVERAGE, IN ONE LINE
  coverage = (lines a test EXECUTED) / (total lines) × 100%
  "covered" = a test RAN this line.  NOT "a test VERIFIED this line."

ABSOLUTE vs DIFF/PATCH  (know which one is red!)
  absolute (project) = whole codebase ≥ X%   ← blunt; punishes old untested code
  diff / patch       = CHANGED lines ≥ X%    ← fair; "did you test YOUR code?"  ← prefer this
  example: PR adds 50 lines, 40 covered → 80% patch → PASSES an 80% patch gate

THE RATCHET
  total coverage may go UP or stay flat, NEVER down.
  doesn't demand a target — demands you don't make it WORSE.
  Codecov: project → target: auto, threshold: 0%   (compare to base, no drop)

GOODHART'S LAW  (the big lesson)
  "When a measure becomes a target, it stops being a good measure."
  you can hit 100% coverage with tests that EXECUTE but don't ASSERT → prove nothing.
  → coverage is a FLOOR (catches missing tests), NOT proof of correctness.
  → 100% is NOT the goal. write REAL, ASSERTING tests.

OTHER NUMERIC GATES (same machine, different number)
  complexity limit   → decision paths per function  (gocyclo, max 15)
  duplication limit  → % copy-pasted code
  lint-error budget  → count of lint warnings (often: no NEW ones)
  bundle-size budget → kilobytes of shipped JS  (maxSize: 150 kB)
  perf-regression    → benchmark latency  (NOISY → often advisory, not blocking)

JUNIOR RECIPE
  • write REAL (asserting) tests for the code you ADD
  • expect a DIFF/PATCH coverage gate (test what you changed)
  • a red patch check → add tests for your uncovered lines
  • DON'T chase 100%; treat the number as a FLOOR, not a trophy
```

---

## Summary

- A **quality threshold** (numeric gate) is a required check that reads a *number* off your change and blocks the merge if it's out of bounds. **Coverage** is the most common: CI measures what fraction of your code the tests ran and fails the PR below a threshold.
- **Coverage measures execution, not correctness.** "Covered" means *a test ran this line* — never that *a test verified it*. That single distinction is the foundation of the whole topic.
- **Diff/patch coverage beats absolute coverage** for daily gating. Absolute gates judge the *whole codebase* (and punish you for old untested code); patch gates ask only **"did you test the lines you changed?"** A PR adding 50 lines with 40 covered is 80% patch coverage — it passes an 80% patch gate regardless of legacy debt.
- A **ratchet** lets coverage go up or stay flat but never down. It doesn't demand a target — it demands you don't make things *worse* — which is how legacy projects climb out of low coverage one PR at a time ("Clean as You Code").
- **Goodhart's law** is the lesson that matters most: when the number becomes the target, people game it. You can hit 100% coverage with tests that *execute* code but *assert* nothing, proving nothing at all. So a coverage gate is a useful **floor** (it catches *missing* tests) and never proof of quality — **100% is not the goal.**
- The **same pattern** powers other gates — complexity limits, duplication limits, lint-error and bundle-size budgets, performance-regression checks — and every one inherits coverage's two truths: a useful floor, and gameable the moment the number becomes the target. Perf gates especially are *noisy* and often better run as advisory signals.
- **Junior recipe:** write *real, asserting* tests for the code you add; expect a diff-coverage gate; don't chase 100%; treat the number as a floor, not a trophy.

You now know what the percentage on your PR actually means, why the gate blocks you, and — most importantly — why a green coverage check is a starting line, not a finish line. The deeper tiers cover *which* coverage type to measure, mutation testing (which checks whether your tests would *catch* a bug), and how to set thresholds that drive behavior without inviting Goodhart.

---

## Further Reading

- [Codecov Docs — Status checks & the `codecov.yml`](https://docs.codecov.com/docs/commit-status) — how `project` vs `patch` status checks are configured and posted on a PR.
- [Coveralls Docs](https://docs.coveralls.io/) — the other widely-used coverage service; same idea, different UI.
- [SonarQube — "Clean as You Code"](https://www.sonarsource.com/solutions/clean-as-you-code/) — the philosophy behind gating *new* code (diff + ratchet) instead of the whole legacy codebase.
- [Martin Fowler — "TestCoverage"](https://martinfowler.com/bliki/TestCoverage.html) — the canonical short essay on why coverage is a useful floor and a terrible target. Read this one.
- [Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law) — the original idea, beyond software.
- The [middle.md](middle.md) of this topic, which formalizes line vs branch vs mutation coverage, where to *exclude* code from coverage honestly, how to choose a threshold, and the surrogation/Goodhart failure modes in depth.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/junior.md) — the pass/fail gate this topic extends into *numeric* gates; a coverage gate is just another required check.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/junior.md) — how to decide *whether* a threshold gate is worth its cost, and how flaky gates (like noisy perf checks) erode trust.
- [Code Coverage](../../code-coverage/) — the measurement itself in depth: line/branch/statement coverage, instrumentation, and what coverage can and can't tell you.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity, duplication, and the other numbers these gates threshold, and how to read them well.
- [Testing](../../testing/) — writing the *real, asserting* tests that make a coverage number actually mean something.
