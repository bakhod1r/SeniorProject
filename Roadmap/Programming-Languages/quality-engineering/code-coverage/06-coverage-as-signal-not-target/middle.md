# Coverage as Signal, Not Target — Middle Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage as Signal, Not Target
> *The junior page argued the principle: coverage is a diagnostic, not a KPI. This page is the mechanics — exactly how engineers game a coverage gate, the tell-tale signs in review, why any high global target is the failure mode, and the policies (diff coverage, mutation pairing, the ratchet) that use the number well instead of worshipping it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Goodhart's Law, Made Concrete](#goodharts-law-made-concrete)
4. [The Gaming Playbook — Five Techniques and Their Tells](#the-gaming-playbook--five-techniques-and-their-tells)
5. [Why a Hard 100% (or Any High Global) Target Backfires](#why-a-hard-100-or-any-high-global-target-backfires)
6. [The Better Policy — Diff Coverage, No Global Threshold](#the-better-policy--diff-coverage-no-global-threshold)
7. [Coverage as a Code-Review Input](#coverage-as-a-code-review-input)
8. [Pairing Coverage with Mutation So the Gate Measures Quality](#pairing-coverage-with-mutation-so-the-gate-measures-quality)
9. [Setting a Sensible Expectation — the Ratchet, Not the Magic Number](#setting-a-sensible-expectation--the-ratchet-not-the-magic-number)
10. [Worked Example — Spot the Gamed Test, Fix the Policy](#worked-example--spot-the-gamed-test-fix-the-policy)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How is a coverage gate gamed, how do I spot it in review, and what policy uses coverage honestly?**

The junior page made the case that coverage measures *execution*, not *correctness*, and that it belongs in your diagnostics, not on a leaderboard. That's the *why*. This page is the *how* — and the *how* matters because the moment you wire a coverage percentage to a merge-blocking gate, you have created an incentive, and incentives get optimized. Not always maliciously: a tired engineer at 5 p.m., one red check away from shipping, will reach for the cheapest way to make the bar go green. The cheapest way is almost never "write a better test."

So this page works in two directions at once. First, the **adversarial** view: the concrete techniques people use to inflate a coverage number without improving the suite, and the specific signatures each leaves in a diff — because you will review these PRs and you need to recognize them on sight. Second, the **constructive** view: the policies that don't create the perverse incentive in the first place — **diff coverage on new code, no global threshold** (Google's actual stance), coverage surfaced as a *code-review hint* rather than a hard gate, and **mutation** layered on top so the bar measures whether tests can *catch bugs*, not merely whether lines *ran*. The throughline is a single discipline: keep coverage a signal you read, never a target you chase.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and accept that covered ≠ tested.
- **Required:** You understand the difference between line and branch coverage ([01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/middle.md)).
- **Helpful:** You've seen a coverage gate in CI ([04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md)).
- **Helpful:** You know what a mutation test does, even roughly ([02 — Mutation Coverage](../02-mutation-coverage/middle.md)).

---

## Goodhart's Law, Made Concrete

Goodhart's law, in Marilyn Strathern's crisp reformulation: *"When a measure becomes a target, it ceases to be a good measure."* Coverage is the textbook case. As a **measure**, the percentage is informative — it correlates loosely with test effort and pinpoints code nobody runs. The instant you make it a **target** with teeth (a number CI enforces, a number in a performance review), that correlation rots, because there are two ways to move the number and only one of them is the thing you actually wanted:

1. Write tests that meaningfully exercise behaviour. (Expensive, what you want.)
2. Make more lines *execute* during the test run, by any means. (Cheap, what you get.)

A gate cannot tell these apart — instrumentation records *that a line ran*, full stop. So under pressure the suite drifts toward path (2): the number climbs while the suite's power to catch regressions flatlines or *falls*, because the padding tests add maintenance weight and noise without adding signal. This is the precise mechanism that makes a coverage *target* self-defeating: it optimizes the proxy (lines executed) while the goal (bugs caught) is left behind. Worse, it actively **punishes honest measurement** — see §5.

> **Key insight:** Coverage measures the *quantity of code executed under test*. Test quality is *the probability a defect is caught*. These are different variables that happen to be correlated until you start optimizing one of them — at which point the correlation is exactly what breaks. A target doesn't improve the suite; it improves the suite's *score*.

---

## The Gaming Playbook — Five Techniques and Their Tells

You can't defend a gate you don't understand. Here are the five techniques that show up in real PRs, each with the diff signature that gives it away in review.

**1. Assertion-free / execute-only tests.** The test calls the code and asserts *nothing* (or asserts something trivially true). Coverage counts the lines as executed; nothing checks the result. This is the purest form of gaming — 100% line coverage, zero verification.

```python
# GAMED — runs the code, verifies nothing
def test_calculate_discount():
    calculate_discount(price=100, tier="gold")   # no assert at all
    # coverage: ✅ every line ran.  oracle: none. a bug changing the
    # result from 80 to 8000 still passes.
```

*Tell:* a test body with no `assert`, or with `assert result is not None` / `assert True` standing in for a real check. Grep your diff for test functions that contain no assertion keyword. Some linters (e.g. `flake8-assertive`, Pylint's `W0131`-adjacent checks) flag assertion-free tests directly — wire one in.

**2. Over-broad `pragma: no cover` / exclusion lists.** Coverage tools let you exclude code from measurement (`# pragma: no cover` in Coverage.py, `/* istanbul ignore next */` in JS, `//coverage:ignore` in some Go setups, `<exclude>` globs in JaCoCo). Legitimately used for unreachable defensive branches. Illegitimately used to *delete the denominator*: mark the hard-to-test code as ignored and the percentage jumps for free.

```python
def process(order):
    if order.is_valid():            # pragma: no cover   ← whole hard path excluded
        return charge(order)        # pragma: no cover
    return reject(order)
```

*Tell:* `pragma: no cover` (or the equivalent) appearing in a *feature* PR, on a *branch* or *function* rather than a single defensive line; growth in the exclusion config. Treat every new exclusion as a reviewable line that needs a one-line justification: *why is this genuinely untestable?*

**3. Padding with trivial getters / generated code.** Write tests for the cheapest, most pointless surface — getters, setters, `__repr__`, autogenerated DTOs — purely to bank the percentage. The number rises; not one of these tests would ever fail on a real bug.

```java
@Test void testGetName() { assertEquals("x", new User("x").getName()); } // pure padding
```

*Tell:* a cluster of one-line tests against accessors with no logic, often suspiciously timed right before a release or right after a gate was tightened. High line coverage concentrated on trivial members while the branchy core stays thin.

**4. Deleting (or never writing) the hard-to-cover code.** The subtlest one: instead of testing a difficult branch, *remove* it — drop the error handling, the edge case, the defensive guard — because uncovered code that no longer exists can't drag the ratio down. The metric improves by making the software *worse*.

```diff
- if resp.status == 429:          # rate-limited path was hard to test...
-     return backoff_and_retry()  # ...so it was deleted to lift coverage
- return resp.json()
+ return resp.json()             # now 100% covered, and silently broken under load
```

*Tell:* a PR that *removes* error-handling or edge-case branches while coverage goes up. This is why you read the diff, not the dashboard — the number says "better," the code says "worse." A reviewer who only checks the green badge ships the regression.

**5. "Snapshot everything" tests.** Auto-generate a snapshot/golden assertion over a huge output blob. Every line that produced the blob is now "covered," and there *is* an assertion — but it asserts "the output equals whatever it happened to be," which approves any change as long as you re-bless the snapshot. Coverage is high; the oracle is "trust me."

*Tell:* large committed snapshot files, `toMatchSnapshot()` / golden-file assertions with no targeted checks alongside, and PRs whose main content is "update snapshots." Snapshots have legitimate uses, but as the *only* assertion they convert review into rubber-stamping.

> **Key insight:** Every gaming technique attacks the *numerator* or the *denominator* of `covered / total` without touching the only thing that matters — whether a wrong result would be *caught*. The universal review reflex: for any line claimed as covered, ask *"what assertion fails if this line is wrong?"* If the answer is "none," the coverage is fake regardless of the percentage.

---

## Why a Hard 100% (or Any High Global) Target Backfires

A global threshold is a single number — say 90% — that the *whole codebase* must meet for CI to pass. It feels rigorous. In practice it produces four predictable pathologies:

- **It manufactures the gaming above.** A hard global bar is precisely the incentive that turns honest engineers toward assertion-free tests, getter-padding, and `pragma` abuse. You built the perverse incentive on purpose.
- **It punishes honest measurement.** Here's the cruel asymmetry: a team that *adds* coverage instrumentation to a legacy module suddenly sees its global number *drop* (all that old untested code now counts against them) and the gate goes red — for the crime of measuring. So teams rationally *avoid* measuring the riskiest code. The metric you most want is the one the gate discourages you from collecting.
- **The last few percent are the worst ROI in testing.** Going 90→100% means writing tests for defensive branches, unreachable `default:` arms, and `OutOfMemoryError` handlers — high effort, near-zero defect-catching value. A 100% mandate spends your most expensive engineering hours on your least valuable tests, *and* tempts people to fake the unreachable parts.
- **One number can't fit every file.** A pure-logic billing module and an autogenerated gRPC stub have wildly different reasonable coverage. A single global threshold is either too lax for the first or impossible for the second; usually both.

This is why **Google does not enforce a global coverage threshold** at all. The stance from *Software Engineering at Google* is deliberate and worth stating precisely: coverage tooling is **available everywhere, mandated nowhere**. Engineers can see coverage on any change; no project-wide percentage blocks a merge. Coverage is treated as information for the author and reviewer, not as a pass/fail gate — because Google's own internal study (Petrović & Ivanković, 2018) found that *mutation* results surfaced as review hints beat coverage percentages as a quality signal, and that hard coverage targets drove exactly the gaming described above.

> **Key insight:** A hard global target optimizes for *not being measured*. The riskiest, least-tested code is the most expensive to bring over the line, so a team under a global gate is incentivized to *exclude* it, *delete* it, or *never instrument* it — the precise opposite of what you wanted. Mandate nothing globally; make the signal available everywhere.

---

## The Better Policy — Diff Coverage, No Global Threshold

If a global number is the anti-pattern, what replaces it? **Diff coverage** (a.k.a. *patch coverage*): measure coverage only on the lines a change *adds or modifies*, and ignore the global percentage entirely.

```
Project coverage:  61%   ← reported, never gated. legacy debt, not your fault today.
Patch coverage:    94%   ← of the lines THIS PR touched. THIS is what review looks at.
```

Why this is the right shape:

- **It asks a fair question.** Not "is the whole codebase 90% covered?" (you didn't write most of it) but "did *you* test what *you* just wrote?" Responsibility lands on the person who can actually act on it.
- **It rewards measurement instead of punishing it.** Adding coverage to legacy code can only *help* now — untouched old lines never count against a patch. The §5 asymmetry disappears.
- **It improves the codebase monotonically.** Every PR is held to a decent bar on *new* lines, so coverage rises naturally on the parts under active development — exactly where regressions are most likely — without anyone chasing a global figure.
- **The legacy mountain stops blocking everyone.** A 30%-covered legacy service doesn't red-gate every unrelated one-line fix. You improve it by *touching* it, gradually.

Tools that implement this directly: **Codecov** (`patch` vs `project` status), **Coveralls**, **SonarCloud** ("coverage on new code"). The config that matters is making *patch* the thing that can block, and making *project* informational-only.

```yaml
# codecov.yml — sane policy: gate the PATCH, never the PROJECT
coverage:
  status:
    patch:
      default:
        target: 80%        # new/changed lines must hit 80%
        threshold: 2%      # tolerate small noise, no flapping
    project:
      default:
        informational: true   # report global %, NEVER block on it
```

> **Key insight:** Switching from a project threshold to a patch threshold changes the question from *"is the codebase good enough?"* (unanswerable, unfair, gameable by exclusion) to *"is this change well-tested?"* (specific, fair, and answerable by the person making it). Same tool, opposite incentive.

---

## Coverage as a Code-Review Input

The highest-value use of coverage isn't a gate at all — it's an **annotation in code review**. Modern tools render a per-line coverage overlay on the PR diff: new lines show green (covered) or red (uncovered). That overlay turns coverage from a verdict into a *question for the reviewer*:

> *"You added a branch here that no test exercises — is that intended? Is it dead code, an untestable edge, or a missing test?"*

This framing is strictly better than a hard gate for one reason: it keeps **human judgment in the loop**, which is exactly what coverage needs because the number can't tell a deliberately-untested defensive branch from a forgotten critical one. The reviewer can:

- Accept it ("that's an unreachable defensive guard, fine").
- Reject it ("that's the error path for a failed payment — write the test").
- Reframe it ("that branch is actually dead — delete it").

A hard gate makes all three outcomes look identical (red → blocked) and pushes the author toward the cheapest unblock, which is gaming. A review hint makes the *author justify* the gap to a person, which is precisely the friction that catches both real gaps and lazy fakes. This is the operational meaning of "coverage as signal": the signal goes to a *reviewer who decides*, not to a *gate that decrees*.

```
diff view in the PR (uncovered lines flagged for the reviewer):

   def withdraw(self, amount):
       if amount <= 0:
🔴         raise ValueError("amount must be positive")   ← reviewer: "test this?"
       if amount > self.balance:
🔴         raise InsufficientFunds()                      ← reviewer: "and this?"
🟢     self.balance -= amount
```

Two red branches in money-handling code is a conversation, not a number. The reviewer asks; the author answers. That exchange is worth more than any threshold.

---

## Pairing Coverage with Mutation So the Gate Measures Quality

Diff coverage fixes *whose* code is measured. It does **not** fix coverage's core blindness: a covered line with no real assertion still counts as covered. Even at 100% patch coverage, you can have a suite full of execute-only tests. The fix is to measure something execution-based can't fake — **mutation testing**.

Mutation testing deliberately introduces small faults ("mutants") into your code — flip a `>` to `>=`, swap `+` for `-`, replace a return value with a default — then reruns your tests. If a test **fails**, the mutant is *killed* (good — your tests detect that defect). If every test still **passes**, the mutant *survived* (bad — a real bug of that shape would ship undetected). The **mutation score** is `killed / total`, and unlike coverage it is *unfakeable by execution alone*: an assertion-free test executes the mutated line and still passes, so the mutant survives and the score exposes the hollow test.

```python
# original
def is_adult(age): return age >= 18

# mutant: >= becomes >
def is_adult(age): return age > 18

# the assertion-free test runs both happily → mutant SURVIVES → quality gap exposed.
# a real test (assert is_adult(18) is True) FAILS on the mutant → killed.
```

The two metrics are complementary, and together they pincer the gap:

| | What it answers | Defeated by |
|---|---|---|
| **Coverage** | Did the test *execute* this line? | assertion-free / weak tests |
| **Mutation** | Would the test *catch a bug* in this line? | (resistant — must actually assert) |

The practical policy: run **mutation on the diff only** (full-repo mutation is far too slow — it reruns the suite per mutant), surface survived mutants as **review comments** on the changed lines, exactly like coverage hints. Tools: `pitest` + arcmutate/pitest-git for JVM diffs, **Stryker** for JS/TS/C#, `mutmut`/`cosmic-ray` for Python, `go-mutesting` for Go. This is the Google finding in operational form: mutants-as-review-hints raise test *quality*, where a coverage *percentage* only raised test *quantity*.

> **Key insight:** Coverage gates execution; mutation gates *detection*. If you must put a quality bar somewhere, put diff-coverage as the cheap first filter ("did you even run it?") and diff-mutation as the real one ("would you catch a bug?"). A gate built on coverage alone measures effort; a gate that adds mutation measures power.

---

## Setting a Sensible Expectation — the Ratchet, Not the Magic Number

Teams still want *a* number. The healthy way to set one is a **directional ratchet**, not a fixed magic threshold:

- **No global mandate.** Per the Google stance, there is no project-wide "must hit X%."
- **A patch floor that's a floor, not a ceiling.** Something like "new code should be ~80% covered" — high enough to mean you tested the change, low enough that the unreachable last-mile isn't worth gaming. Pick it to be *clearly achievable by honest testing*, so the cheapest way to pass is to actually test.
- **A ratchet that only moves up.** Configure the gate so coverage on touched code may not *drop* below the current level (e.g. Codecov's `threshold` / "do not decrease"). The number is allowed to climb as the code improves and is *forbidden to regress* — but no one ever has to hit a magic absolute.
- **Direction over destination.** The signal you care about is the *trend* on actively-developed code: is it flat or rising? A team whose patch coverage is steady at 85% and whose mutation score is rising is healthier than one that hit a mandated 95% by padding getters.

The ratchet works because it removes the two failure modes at once: there's no high absolute target to game, and there's no way to silently backslide. You don't *worship* a number; you *prevent regression* and *let improvement accrue*.

> **Key insight:** A magic number ("we are a 90% shop") is a target — Goodhart applies, gaming follows. A ratchet ("touched code may not get less tested than it is") is a *guardrail* — it has no fixed value to optimize toward, so there's nothing to game; the only way to satisfy it is to not make things worse.

---

## Worked Example — Spot the Gamed Test, Fix the Policy

**Part A — Spot the gamed test.** A PR adds a `BankAccount.withdraw` method and this test, and the coverage badge flips to 100%. Review it:

```python
# the change under review
class BankAccount:
    def withdraw(self, amount):
        if amount <= 0:
            raise ValueError("amount must be positive")
        if amount > self.balance:
            raise InsufficientFunds()
        self.balance -= amount
        return self.balance

# the test that "achieves 100%"
def test_withdraw():
    acct = BankAccount(balance=100)
    acct.withdraw(50)              # runs the happy path...
    acct.withdraw(-5)             # ...and "covers" the guards by calling them
    acct.withdraw(999)           # but the raises are swallowed — no assert anywhere
```

What's wrong: **assertion-free** (technique 1). The negative and over-balance calls *execute* the `raise` lines — so coverage is 100% — but nothing asserts that they raised, nor that the balance is correct afterward. A mutant that changes `amount <= 0` to `amount < 0`, or deletes `self.balance -= amount`, sails through untouched. The badge says perfect; the suite catches nothing. The review comment writes itself: *"every branch runs but nothing is asserted — what fails if `withdraw` returns the wrong balance?"*

The real test asserts outcomes — and a mutation run confirms it kills the mutants:

```python
def test_withdraw_deducts_and_returns_balance():
    acct = BankAccount(balance=100)
    assert acct.withdraw(30) == 70          # value oracle
    assert acct.balance == 70               # state oracle

def test_withdraw_rejects_non_positive():
    with pytest.raises(ValueError):         # the guard is verified, not just run
        BankAccount(balance=100).withdraw(-5)

def test_withdraw_rejects_overdraw():
    with pytest.raises(InsufficientFunds):
        BankAccount(balance=100).withdraw(999)
```

Same 100% coverage — but now the `<=`→`<` mutant and the deleted-subtraction mutant both *fail a test*. Coverage was identical; *quality* was night and day. That gap is exactly what coverage alone can never show you and mutation does.

**Part B — Fix the policy.** The team's CI enforces a hard global target. Rewrite it into a sane patch-coverage policy:

```yaml
# BEFORE — the anti-pattern: one hard global threshold, gameable by exclusion,
# punishes anyone who instruments legacy code, blocks unrelated fixes.
coverage:
  global_threshold: 100%      # mandate → gaming; legacy red-gates everything
  fail_under: 100

# AFTER — signal, not target
coverage:
  status:
    patch:                    # gate only the lines THIS PR changed
      default:
        target: 80%           # achievable by honest testing
        threshold: 2%         # noise tolerance — no flapping
    project:
      default:
        informational: true   # global % reported for context, NEVER blocks
        # ratchet: touched code may not regress; absolute may rise freely
comment:
  layout: "diff, files"       # render per-line coverage IN the PR for the reviewer
# (separately) run diff-mutation in CI; post survived mutants as review comments.
```

The transformation in one breath: stop gating the *whole codebase* at a magic number; gate the *diff* at an achievable floor; show coverage *to the reviewer* as a hint; and let *mutation* judge whether the new tests actually bite. The number stopped being a target and went back to being a signal.

---

## Mental Models

- **Coverage is a smoke detector, not a fire inspector.** A red line ("uncovered") reliably tells you *something is missing* — that's the smoke detector earning its keep. A green line ("covered") does *not* certify the code is safe — the detector is silent, which is not the same as "inspected and sound." Trust the alarms; never read silence as approval.

- **A gate creates an incentive; design the incentive, not just the gate.** The instant a number blocks a merge, people optimize the number. A global-threshold gate incentivizes *not measuring*; a patch-coverage gate incentivizes *testing your own change*. Same tool, opposite behaviour — because you changed what the number rewards.

- **The denominator is attackable.** Half the gaming techniques (`pragma`, deleting branches, excluding files) don't add tests — they *shrink what's counted*. When a coverage number jumps, ask whether the numerator grew (more tested) or the denominator shrank (less counted). Only the first is good news.

- **Coverage asks "did it run?"; mutation asks "would you notice if it broke?"** Stack them in that order: coverage is the cheap first pass, mutation is the real exam. A suite that passes the first and fails the second is the suite that looks tested and isn't.

---

## Common Mistakes

1. **Wiring a hard global threshold into CI.** It manufactures gaming, punishes teams for instrumenting legacy code, and red-gates unrelated fixes. Gate the *patch*, not the *project*; keep the global number informational.

2. **Reading the dashboard instead of the diff.** A PR can *raise* coverage by *deleting* error handling. The badge says "better," the code is worse. Coverage gaming is invisible from the percentage and obvious from the diff — so review the diff.

3. **Accepting tests with no assertions because the line went green.** Execute-only tests are the single most common form of gaming. For every "covered" line, ask what assertion fails if that line is wrong; "none" means the coverage is fake.

4. **Treating `pragma: no cover` as free.** Each exclusion silently shrinks the denominator. A new exclusion in a feature PR — especially on a whole branch or function — needs a one-line justification, reviewed like any other code.

5. **Believing 100% coverage means the suite is strong.** 100% line coverage with weak assertions has a low mutation score — bugs ship through. Coverage caps at "every line ran"; only mutation tells you they're actually *tested*.

6. **Chasing the last 10% to a magic number.** The final stretch is defensive branches and unreachable arms — maximum effort, minimum defect-catching value, maximum temptation to fake. Spend that effort on mutation-killing assertions in the core instead.

---

## Test Yourself

1. State Goodhart's law and explain the exact mechanism by which a hard coverage *target* stops being a good *measure*.
2. Name three gaming techniques and the diff signature ("tell") that exposes each in code review.
3. Why does a global coverage threshold *punish* a team for adding instrumentation to legacy code? What policy removes that asymmetry?
4. What is Google's stance on a global coverage threshold, and what did its internal study find beat coverage as a quality signal?
5. Coverage and mutation both passed a "quality gate." Which one can an assertion-free test defeat, and why can't it defeat the other?
6. What's the difference between a coverage *magic number* and a coverage *ratchet*, and why is the ratchet not gameable?

<details>
<summary>Answers</summary>

1. *"When a measure becomes a target, it ceases to be a good measure"* (Strathern's form of Goodhart). Mechanism: there are two ways to raise coverage — write real tests (the goal) or make more lines merely execute / shrink the denominator (the proxy). A gate can't distinguish them, so under pressure the suite optimizes the cheap proxy; the proxy's correlation with real quality is exactly what breaks once it's targeted.
2. Any three, e.g.: *assertion-free tests* → a test body with no `assert`; *over-broad `pragma: no cover`* → exclusions on whole branches/functions appearing in feature PRs; *deleting hard branches* → a PR that removes error-handling while coverage rises; *getter padding* → a cluster of one-line accessor tests; *snapshot-everything* → large golden files as the only assertion.
3. Instrumenting old code makes all that untested legacy *count against* the global percentage, so the number *drops* and a global gate goes red — for the crime of measuring. Teams then avoid instrumenting the riskiest code. **Diff/patch coverage** removes the asymmetry: untouched old lines never count against a patch, so measuring legacy can only help.
4. Google enforces **no global coverage threshold** — coverage tooling is available everywhere, mandated nowhere; it's a per-change input for author and reviewer. Its 2018 study (Petrović & Ivanković) found **mutation** results surfaced as review hints beat coverage percentages as a quality signal.
5. An assertion-free test defeats **coverage** (the line executes, so it counts as covered) but *not* **mutation** — the mutant changes behaviour and, with no assertion to fail, the test still passes, so the mutant *survives* and the score exposes the hollow test. Mutation requires a real assertion to pass.
6. A *magic number* is a fixed absolute target ("90% everywhere") — a target, so Goodhart applies and it gets gamed. A *ratchet* is a guardrail: touched code may not get *less* tested than it currently is (and may rise freely). It has no fixed value to optimize toward, so the only way to satisfy it is to not make things worse — nothing to game.

</details>

---

## Cheat Sheet

```
GAMING TECHNIQUES → THE TELL IN REVIEW
  assertion-free test      no `assert` in the body (assertEquals(x,x) counts too)
  pragma: no cover abuse    exclusion on a whole branch/func in a feature PR
  getter/DTO padding        cluster of 1-line accessor tests, branchy core thin
  delete the hard branch    PR removes error handling, coverage goes UP
  snapshot everything       huge golden file is the only assertion

THE UNIVERSAL CHECK
  for any "covered" line:  what assertion fails if this line is WRONG?
  "none" → the coverage is fake regardless of the %

ANTI-PATTERN                SANE POLICY
  hard global threshold  →  diff/patch coverage, project = informational
  one magic number       →  ratchet: touched code may not regress
  gate blocks merge      →  coverage as code-review HINT (reviewer decides)
  coverage alone         →  + diff-mutation (gates detection, not execution)

GOOGLE STANCE
  coverage available EVERYWHERE, mandated NOWHERE
  mutation-as-review-hint > coverage-% as a quality signal (Petrović 2018)

TWO QUESTIONS
  coverage:  did the line RUN?            (faked by execute-only tests)
  mutation:  would a BUG be caught?       (resistant — needs real asserts)
```

---

## Summary

- **Goodhart in practice:** the moment a coverage percentage becomes an enforced target, the suite optimizes the proxy (lines executed) instead of the goal (bugs caught), and the two stop correlating. A target raises the *score*, not the *suite*.
- **The gaming playbook** — assertion-free tests, over-broad `pragma: no cover`, getter padding, deleting hard branches, snapshot-everything — all attack the `covered/total` ratio without improving detection. Each has a diff signature; the universal reflex is *"what assertion fails if this line is wrong?"*
- **A hard global threshold is the anti-pattern:** it manufactures that gaming, *punishes honest measurement* (instrumenting legacy code drops the number and reddens the gate), and spends your most expensive hours on your least valuable tests. Google enforces **no global threshold** — available everywhere, mandated nowhere.
- **The better policy** is **diff coverage** (gate the lines the PR touched, keep the project number informational) surfaced as a **code-review hint** the reviewer acts on, not a gate the author games.
- **Pair coverage with mutation** so the bar measures *detection*, not *execution* — mutation can't be defeated by an assertion-free test. Run it on the diff, post survived mutants as review comments.
- **Set the expectation as a ratchet, not a magic number:** an achievable patch floor plus a no-regression guardrail. Direction over destination — there's no absolute target to chase, so there's nothing to game.

---

## Further Reading

- *Software Engineering at Google* — Winters, Manshreck, Wright. The coverage discussion, especially the rationale for **no global coverage threshold**.
- *TestCoverage* — Martin Fowler (martinfowler.com). The canonical short essay: coverage finds untested code, it does not certify tested code.
- *Goodhart's Law* — Charles Goodhart (1975); Marilyn Strathern's reformulation ("when a measure becomes a target…") is the version that applies to metrics-as-targets.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018). The study behind mutants-as-review-hints over coverage percentages.
- Codecov / SonarCloud docs on **patch vs project** coverage — the configuration that turns the principles here into an actual gate.

---

## Related Topics

- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/middle.md) — the blind spots (no oracle, missed requirements) that make a coverage target meaningless in the first place.
- [02 — Mutation Coverage](../02-mutation-coverage/middle.md) — the quality signal you pair with coverage so the gate measures detection, not execution.
- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/middle.md) — diff/patch coverage, the ratchet, and PR status checks in mechanical detail.
- [junior.md](junior.md) — the principle this page operationalizes: coverage is a diagnostic, not a KPI.
- [senior.md](senior.md) — org-scale coverage policy, the politics of gates, and coverage in a quality strategy.
