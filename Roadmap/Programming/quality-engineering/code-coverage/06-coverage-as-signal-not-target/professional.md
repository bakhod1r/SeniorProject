# Coverage as Signal, Not Target — Professional Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage as Signal, Not Target
> *The senior page taught you why a coverage number lies under pressure. This page is about writing the org-wide policy and culture that gets the diagnostic value without the pathology — resisting the exec who wants "90% across the board," walking back a mandated 100% gate without a quality scare, and making coverage a habit people use rather than a number they game.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Writing the Policy](#writing-the-policy)
4. [The Leadership Conversation](#the-leadership-conversation)
5. [Killing the Pathologies](#killing-the-pathologies)
6. [Walking Back a Broken Regime](#walking-back-a-broken-regime)
7. [Making Coverage a Healthy Team Habit](#making-coverage-a-healthy-team-habit)
8. [War Stories](#war-stories)
9. [Decision Frameworks](#decision-frameworks)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Setting org-wide coverage policy and culture that captures the diagnostic benefit without inducing the gaming pathology.**

The senior page argued the technical case: covered is not tested, a global percentage is a Goodhart magnet, and the number degrades the instant it becomes a target. At the professional level that argument stops being a blog opinion and becomes a *policy you have to write down, defend in a leadership meeting, and operate across dozens of teams who will optimize for whatever you measure.*

The meetings are specific. A VP saw a competitor's "92% coverage" slide and wants the same number on a roadmap. A team's coverage gate is blocking a critical hotfix at 2 a.m. because a one-line change dropped the file from 80.1% to 79.8%. A security review asks "what's your coverage standard?" and "no global target" sounds, to the wrong audience, like "we don't care about quality." An engineer quietly added forty `# pragma: no cover` lines last quarter and the dashboard went green. Someone proposed putting coverage on performance reviews and half the room nodded.

None of these are new *concepts* — they're Goodhart's law from the senior tier, now multiplied by org politics, an incentive system, and an existing regime you may have inherited. The skill here is judgment under those constraints: knowing exactly which gate to set (a patch-coverage floor on new code, nothing else), exactly what to offer the exec instead of a global percentage (escaped-defect rate, diff coverage, risk-weighted gaps), and exactly how to dismantle a mandated 100% gate without anyone being able to claim you "lowered the quality bar." This is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Goodhart's law in practice, the specific gaming techniques, why a global threshold backfires, mutation testing as the honest signal.
- **Required:** [../04-coverage-in-ci-and-diffs/professional.md](../04-coverage-in-ci-and-diffs/professional.md) — diff/patch coverage, the ratchet, PR status checks, and the mechanics a policy is built on.
- **Required:** [../05-what-coverage-does-not-tell-you/professional.md](../05-what-coverage-does-not-tell-you/professional.md) — the limits (no assertions, missed requirements, concurrency blind spots) the policy must account for.
- **Helpful:** You have owned a CI policy, sat in a metrics review with leadership, or inherited a quality regime someone else designed.
- **Helpful:** You have watched a team game a metric and seen the second-order damage.

---

## Writing the Policy

A coverage policy is a short, opinionated document. The failure mode is a vague one-liner ("aim for 80%") that every team interprets differently and every gate enforces differently. The professional version is explicit about *what is measured, what is gated, and — critically — what is deliberately not gated.* Spelling out the non-goals is what stops the policy from drifting into the pathology a year later.

Here is policy text you can adapt nearly verbatim:

```markdown
# Coverage Policy

## What we measure
- Line and branch coverage are collected on every build, for every service,
  and published to the coverage dashboard. Visibility is universal.
- Mutation score is collected on a defined set of critical-path modules
  (payments, auth, money math, data-integrity) on a nightly schedule.

## What gates a merge
- **Patch (diff) coverage on changed lines must be ≥ 80%.** This is the ONLY
  coverage gate. New and modified code must be tested; the floor applies to
  the diff, not the repository.
- The gate is advisory-overridable by a second reviewer with a written reason
  (see "Overrides").

## What we deliberately do NOT do
- We do NOT set or enforce a global repository coverage target. There is no
  "the repo must be at X%" line anywhere.
- We do NOT rank teams by coverage. There is no leaderboard, no per-team
  scorecard, no coverage column in any team-comparison dashboard.
- We do NOT put coverage on individual performance reviews. Ever. (See rationale.)
- We do NOT block merges on total-project coverage moving by fractions of a percent.

## Quality check (beyond line counting)
- For critical-path modules, the real bar is mutation score, reviewed in code
  review as inline hints, not a percentage on a dashboard.

## Overrides & exclusions
- `no cover` / exclusion pragmas require a one-line justification comment and
  are surfaced in code review. Net new exclusions are reviewed like code.
```

Every clause earns its place:

- **Measure everywhere, target nowhere.** Universal measurement gives you the diagnostic — you can always *look up* the under-tested module. Removing the target removes the incentive to game it. The senior insight ("coverage is a signal, not a KPI") becomes operational: collect the signal globally, gate on it narrowly.
- **A patch-coverage floor as the *only* gate.** New code is where you have leverage and where the author has the context to write a real test. Gating the *diff* (Codecov/Coveralls "patch" status, SonarCloud "new code" condition) sidesteps the legacy-code problem entirely — you never demand that someone retro-test a 200k-line monolith to merge a typo fix. The floor is ~80% of changed lines, not 100%, precisely so that a defensible "this branch is genuinely not worth a test" doesn't require an override every time.
- **No global percentage, in writing.** This is the load-bearing non-goal. Without it, the first metrics-minded manager turns the dashboard number into an OKR and you are back in Goodhart territory.
- **No leaderboard.** A per-team coverage ranking is a gaming machine: it rewards the team that writes assertion-free tests fastest and punishes the team working on the gnarly legacy module that's hard to test. Ranking turns a diagnostic into a competition over a number that doesn't measure quality.
- **Mutation on critical paths as the quality check.** Line coverage answers "did a test execute this?"; mutation answers "would a test *fail* if this broke?" You cannot afford mutation everywhere (it's expensive), so the policy names the modules where being wrong is catastrophic and puts the honest signal there.

> **The professional reality:** the policy's *non-goals* are more important than its goals. Anyone can write "measure coverage." The discipline is writing down, and defending, "we will not set a global target and we will not rank teams" — because those are the two clauses that decay into gaming the moment they're absent, and they're the two an enthusiastic manager will try to add back every quarter.

---

## The Leadership Conversation

The hardest part of this topic is not technical; it's the conversation with an executive who wants "90% coverage across the board" because it's a clean number for a board slide. Dismissing it as naïve fails — the exec has a *legitimate* underlying want: assurance that quality is under control. The move is to validate the want and redirect the metric.

**What they're actually asking:** "Can I trust that we won't ship a humiliating, expensive defect, and can I see evidence?" Coverage percentage is a *proxy they reached for*, not the thing they care about. Your job is to offer better proxies for the real question.

**What to offer instead — three metrics that answer the real question better than a global percentage:**

| Instead of "global coverage %" | Offer | Why it's better |
|---|---|---|
| "We're at 78%, targeting 90%" | **Escaped-defect rate** — bugs found in production per release / per KLOC shipped | Measures the *outcome* the exec cares about (did quality hold?), not a proxy that can be faked. Trends are the signal. |
| "Coverage went up 4 points" | **Diff coverage on new code** — % of changed lines tested, per release | Shows new work is tested *without* the legacy-retro-test tax, and it's much harder to game on a per-PR basis. |
| "Module X is at 60%" | **Risk-weighted coverage gaps** — untested code *in critical paths* (auth, payments, data integrity), ranked | Directs attention to where a gap actually hurts, instead of treating an untested logging helper as equal to untested money math. |

The script that works:

> "I can give you a 90% number on every dashboard by next quarter — and it will tell you nothing, because the fastest way to hit it is tests with no assertions. Here's what I'd rather report, because it actually tracks the thing you're worried about: our **escaped-defect rate** (are we shipping fewer production bugs?), our **diff coverage** (is new code being tested?), and our **risk-weighted gaps** (is anything *important* untested?). I'll commit to those three trending the right way. The single global percentage is the one metric I'd ask you *not* to put on a slide, because the day it's a target, my engineers will optimize the number instead of the quality, and you'll have a green dashboard over a worse product."

Two things make this land. First, you're not refusing accountability — you're offering *three* harder-to-game metrics in place of one easy-to-game one, which reads as more rigor, not less. Second, you name the specific failure (assertion-free tests) concretely, so "it'll get gamed" isn't an abstract worry; it's a mechanism the exec can picture.

> **The reframe in one line:** the exec wants *assurance*, and reached for *a percentage*. Give them assurance — escaped-defect rate, diff coverage, risk-weighted gaps — and take the percentage off the table by explaining, concretely, how it gets gamed. You trade one fakeable number for three accountable ones.

---

## Killing the Pathologies

Each gaming pathology has a specific trigger and a specific antidote. Naming the trigger matters, because the antidote is almost always "remove the incentive," not "add more enforcement."

**Pathology 1 — Coverage on performance reviews → instant, total gaming.** The moment an individual's rating depends on a coverage number, every engineer in the org has a personal incentive to make the number go up by the cheapest route — which is assertion-free tests, trivial getters/setters tested to death, and `no cover` on anything hard. This is the single most destructive thing you can do with coverage. *Antidote:* a hard policy line — coverage is **never** an individual performance metric. Not a goal, not a stretch goal, not "a factor." The instant it touches comp or ratings, it stops measuring anything. This is non-negotiable and belongs in the written policy.

**Pathology 2 — The exclusion-list arms race → governance.** `# pragma: no cover`, `/* istanbul ignore next */`, JaCoCo `@Generated` exclusions, and `.coveragerc` omit-globs are *legitimate* tools (generated code, unreachable defensive branches, vendored files). Under a global target, they become a pressure valve: when the number is short, the cheapest fix is to *exclude* the untested code rather than test it. Left ungoverned, the exclusion list grows until the metric measures only the easy code. *Antidote:* treat exclusions as code. Require a one-line justification comment on each, surface net-new exclusions in the PR diff (they show up in review like any other change), and periodically audit the exclusion list for the "I just wanted the gate to pass" entries. Governance, not prohibition — the goal is that every exclusion is a *defensible* one, reviewed by a human.

**Pathology 3 — The assertion-free test culture → review + mutation.** The purest form of gaming: tests that execute code (driving coverage up) but assert nothing (verifying nothing). `def test_process(): process(order)` with no `assert` covers every line `process` touches and would not catch a single regression. Coverage tooling *cannot* detect this — executed is executed. *Antidote:* two layers. In **code review**, a test with no meaningful assertion is a review defect, full stop — reviewers are trained to reject "it runs, ship it" tests. As a **backstop**, mutation testing on critical paths catches it automatically: an assertion-free test kills zero mutants, so a high line-coverage / near-zero mutation-score module is the unmistakable fingerprint of fake tests. Mutation is what makes the gaming *visible* when review misses it.

> **The pattern across all three:** gaming is a rational response to an incentive, so the durable fix is to *remove the incentive*, not to police the behavior. Take coverage off performance reviews and the arms race over exclusions and assertion-free tests largely evaporates on its own, because nobody has a reason to fake a number that doesn't feed anything. Enforcement (review, mutation, exclusion governance) is the backstop for the residual; the incentive design is the actual cure.

---

## Walking Back a Broken Regime

You will sometimes inherit a regime that's already broken — most commonly a mandated 90% or 100% global gate that has produced a swamp of low-value tests. The instinct is to rip the gate out. The danger is that "engineering is *lowering* the quality bar" is a terrible headline, and a naïve removal hands it to anyone who wants to block you. Walk it back as a *substitution*, never a subtraction.

The sequence that survives scrutiny:

1. **Lead with evidence, not opinion.** Quantify the pathology the current gate produced: count assertion-free tests, count `no cover` lines added since the mandate, show the mutation score on a "well-covered" critical module (it'll be embarrassing). You're not arguing the gate is *philosophically* wrong; you're showing it *didn't deliver quality* — high coverage, low mutation score, defects still escaping. Numbers, not "Google says so."

2. **Introduce the replacement *before* relaxing anything.** Stand up the patch-coverage gate and the critical-path mutation check *first*, and let them run for a sprint or two alongside the old gate. Now you can say "new code is tested and our critical paths are verified" — the replacement is demonstrably working before you touch the old gate.

3. **Reframe the change as raising the *real* bar.** The message is "we are replacing a number that's being gamed with a check that actually verifies behavior" — diff coverage on new code plus mutation on what matters. That is *more* rigor on the things that count, less theater on the things that don't. You are not lowering the bar; you are pointing it at reality.

4. **Freeze, then drain, the global gate.** Don't delete it overnight. *Freeze* it (stop ratcheting it upward) so it can't manufacture new low-value tests, keep the *measurement* (the dashboard stays), then quietly retire the *gate* once the replacement has a track record. The number remains visible as a diagnostic; it just stops being a merge blocker.

5. **Keep the escaped-defect rate in the same view the whole time.** This is your proof the change was safe. If production defects didn't rise after you swapped gates — and they won't, because the old gate wasn't catching them — you have unanswerable evidence that quality held or improved.

> **The hard-won lesson:** you cannot win "remove the gate" framed as removal — someone will always cast it as caring less about quality. You win it framed as *substitution*: a gameable global number out, a behavior-verifying check (diff coverage + mutation on critical paths) in, with the escaped-defect rate flat-or-better the whole way through. Bring the replacement *and* the safety evidence, then the old gate is the thing that looks negligent.

---

## Making Coverage a Healthy Team Habit

The end state is coverage as a tool engineers *reach for*, not a number that *reaches for them*. The difference is entirely about where the signal lives: in the workflow (useful) versus on a scoreboard (gamed).

**Surface it at review time, where the author has context.** The single highest-leverage placement is a coverage annotation *on the PR diff* — Codecov/SonarCloud showing which changed lines are uncovered, inline, while the author and reviewer are already looking at the change. At that moment the question "is this untested branch one that matters?" has an obvious owner and an obvious answer. This is the senior insight ("coverage's value is local — it points at the specific untested line") operationalized into the one place it's actionable.

**Make gap-hunting a deliberate activity on risky modules, not a global chore.** Instead of "get the repo to 85%," the healthy pattern is "before we touch the payments reconciliation module, let's pull its coverage report and mutation score and see what's *not* exercised." Coverage as a *map of where the tests aren't*, used intentionally on the code where being wrong is expensive. This is exactly the diagnostic use the metric is good at — and it's the inverse of optimizing a dashboard number.

**Pair it with mutation where it counts.** On critical paths, the team's reflex should be to read the mutation report ("which of my mutations survived?") as a list of *missing assertions to add* — concrete, behavior-level, and immune to the assertion-free-test trap. Surfacing surviving mutants as code-review hints (the Google approach) is far more motivating than a percentage, because each one is an actionable "this specific change would not be caught."

**Keep it off the dashboard people optimize.** The dashboard exists for diagnosis (look up an under-tested module) — not for comparison, not for targets, not for status meetings. The instant a coverage number appears in a team-vs-team view or a goal, the habit curdles back into gaming. Universal *visibility* (anyone can look it up) is healthy; universal *targeting* (everyone must hit X) is the pathology. The line between them is whether the number feeds an incentive.

> **The cultural test:** ask whether your engineers experience coverage as *"a tool I use to find untested risk in the code I'm about to change"* or as *"a number I have to satisfy to merge / look good."* The first is the habit you want; the second is the pathology. Everything in the policy — diff-only gate, no global target, no leaderboard, no perf-review tie-in — exists to keep the org on the first side of that line.

---

## War Stories

**The mandated 90% gate that produced thousands of assertion-free tests.** An org mandated a hard 90% global line-coverage gate to "professionalize testing." Teams hit it — and an audit a year later found thousands of tests with no assertions: functions called, return values discarded, nothing verified. Coverage was 91%; mutation score on a sampled critical module was under 20%. The gate had measured *test execution* and the org had optimized *test execution*, exactly as written. The expensive part wasn't the wasted effort; it was the *false confidence* — leadership believed the 91% meant the code was safe, and a serious defect shipped through code that was "fully covered" by tests that asserted nothing. The fix was to stop gating on the global number, gate on diff coverage, and put mutation on the critical paths — but the tests themselves were near-worthless and had to be largely rewritten.

**Coverage on performance reviews, backfiring within a quarter.** A director, wanting accountability, made coverage a line item in individual reviews. Within one quarter the behavior was textbook Goodhart: engineers wrote sprawling tests for trivial getters and config structs (cheap coverage), avoided the genuinely hard-to-test modules (where coverage was expensive to earn), and the `no cover` count tripled. The *number* rose; the *signal* died — and worse, the trust between engineers and the metric was poisoned, so even the legitimate diagnostic use was now seen as "the thing that's used against me." Walking it back took longer than the quarter it took to break, precisely because the metric had been weaponized and people no longer believed "we just want to find untested code."

**The team that switched from global-target to patch-floor and quality went *up*.** A team dropped its global 85% target entirely and replaced it with a single rule: 80% diff coverage on new code, plus mutation testing on the auth and billing modules. Counterintuitively, *quality improved.* Engineers stopped writing filler tests to prop up the repo number and started writing fewer, sharper tests for the code they were actually changing — with real assertions, because the diff gate is satisfied by tested *behavior*, not executed lines, and reviewers were now looking at coverage on the diff in front of them. The surviving-mutant reports on auth/billing surfaced genuine missing edge cases. Total repository coverage *drifted down a few points* and nobody cared, because the escaped-defect rate fell. It's the cleanest demonstration of the thesis: a narrower, behavior-focused gate beat a broad, gameable target on the outcome that mattered.

**The exclusion-list that quietly ate the metric.** Under a global gate, a service's `.coveragerc` omit-list and `istanbul ignore` comments grew steadily as the easiest way to keep the number green. By the time anyone audited it, whole modules — including a chunk of error-handling logic — were excluded "to get the build passing," and the 88% headline figure was computed over a shrinking, increasingly trivial slice of the code. The lesson: an ungoverned exclusion mechanism under a target doesn't just let gaming happen, it *hides* it — the dashboard looks healthier as the metric becomes more meaningless. Net-new exclusions now go through review like code.

---

## Decision Frameworks

**Setting a coverage policy from scratch? Default to:**
- **Measure** line + branch coverage everywhere; publish to a dashboard for *diagnosis only*.
- **Gate** on patch/diff coverage of changed lines (~80%) — and *nothing else*.
- **Explicitly write the non-goals:** no global target, no team leaderboard, no perf-review tie-in.
- **Add mutation** on the handful of critical-path modules; review surviving mutants as hints.
- If you're tempted to add a global percentage target → don't; that's the clause that decays into gaming.

**Facing an exec who wants "X% across the board"? Ask:**
- What's the real fear behind the number? → It's almost always "will we ship an expensive defect?"
- What better proxies answer *that*? → escaped-defect rate, diff coverage, risk-weighted gaps.
- Can I commit to those three trending right, in exchange for not making the global % a target? → yes — that's the trade to offer.

**Inheriting a broken mandated gate (90%/100%)? Sequence:**
- Quantify the pathology it produced (assertion-free tests, exclusion growth, low mutation score) → evidence first.
- Stand up the replacement (diff gate + critical-path mutation) *before* relaxing anything.
- Freeze the global gate (stop ratcheting), keep the *measurement*, retire the *gate* once the replacement has a track record.
- Keep escaped-defect rate in view as your safety proof. → Frame the whole thing as substitution, never removal.

**Someone proposes coverage on performance reviews? Answer:**
- No. Not as a goal, stretch goal, or "factor." → It guarantees instant, total gaming and poisons the metric's legitimate use. This is a one-word framework.

**An exclusion (`no cover`) shows up in a PR? Check:**
- Is it generated/unreachable/vendored code with a written justification? → fine, approve.
- Is it "I excluded the hard branch to pass the gate"? → reject; that's the arms race. Govern, don't prohibit.

---

## Mental Models

- **Measure everywhere, target nowhere.** Universal *measurement* gives you the diagnostic (look up any under-tested module). A *target* gives you the gaming. The whole policy is keeping the first without the second.

- **The non-goals are the load-bearing part of the policy.** "Measure coverage" is easy. "No global target, no leaderboard, no perf-review tie-in" is the hard, durable part — those three clauses are exactly what an enthusiastic manager re-adds and exactly what turns the metric toxic.

- **The exec wants assurance; the percentage is a proxy they grabbed.** Don't argue the proxy — replace it with better answers to the real question: escaped-defect rate, diff coverage, risk-weighted gaps. Three accountable numbers beat one gameable one.

- **Gaming is a rational response to an incentive — so remove the incentive, don't police the behavior.** Take coverage off comp and rankings and the assertion-free tests and exclusion arms race largely stop on their own. Enforcement is the backstop, not the cure.

- **Walk back a gate as substitution, never subtraction.** "We removed the gate" loses. "We replaced a gamed number with a behavior-verifying check, and defects held flat" wins. Always bring the replacement and the safety evidence.

- **Gate the diff, not the repo.** New code is where you have leverage and the author has context. A patch-coverage floor sidesteps the legacy-retro-test tax entirely and is far harder to game than a project total.

- **Mutation is what makes assertion-free tests visible.** High line coverage with a near-zero mutation score is the unmistakable fingerprint of fake tests. It's the automated backstop for what code review misses.

---

## Common Mistakes

1. **Setting a global coverage target.** The single most common policy error and a Goodhart magnet. Measure globally for diagnosis; gate only on the diff. The global percentage belongs on no slide and no OKR.

2. **Putting coverage on performance reviews or a team leaderboard.** Guarantees instant gaming — assertion-free tests, trivial-code padding, exclusion abuse — and poisons the metric's legitimate diagnostic use. Write the prohibition into the policy.

3. **Dismissing the exec's "90%" instead of redirecting it.** They have a legitimate want (assurance). Refusing reads as refusing accountability. Offer three better metrics (escaped-defect rate, diff coverage, risk-weighted gaps) so it reads as *more* rigor.

4. **Removing a broken gate by subtraction.** "We dropped the requirement" hands a bad headline to anyone who wants to block you. Substitute: stand up the replacement first, keep escaped-defect rate in view, frame it as raising the real bar.

5. **Leaving the exclusion mechanism ungoverned.** `no cover` / `istanbul ignore` under a target becomes a pressure valve that quietly hollows out the metric. Require justifications, surface net-new exclusions in review, audit periodically.

6. **Mandating coverage but never checking assertions.** Line coverage can't see assertion-free tests. Reject them in review and run mutation on critical paths as the automated backstop. A gate on execution is satisfied by execution.

7. **Putting the coverage number where people compare and optimize it.** A dashboard for diagnosis is healthy; the same number in a team-vs-team view or a status meeting curdles into gaming. Visibility yes, targeting no — the line is whether it feeds an incentive.

---

## Test Yourself

1. Write the *non-goals* section of a coverage policy and explain why each non-goal is more important than the corresponding goal.
2. An exec wants "90% coverage across the board" for a board slide. What do they actually want, and what three metrics do you offer instead — and why is each harder to game?
3. Coverage is being proposed as a line item on individual performance reviews. Give your answer and the specific second-order failures you're preventing.
4. You inherit a mandated 100% global gate that has produced a swamp of low-value tests. Lay out the sequence to walk it back without a quality scare.
5. A team's line coverage on its auth module is 95% but its mutation score is 18%. What does that pattern mean, and what produced it?
6. Why gate on *patch/diff* coverage instead of *project* coverage? Name the two problems the diff gate sidesteps.
7. A PR adds twelve `# pragma: no cover` lines. How do you tell a legitimate use from gaming, and what governance makes the difference?

<details>
<summary>Answers</summary>

1. The non-goals: **no global repository coverage target; no per-team coverage leaderboard; no coverage on individual performance reviews; no merge-blocking on fractional total-project movement.** Each non-goal matters more than its goal because the *goal* (measure coverage) is benign and easy, while the *failure modes* live entirely in turning the number into a target/ranking/incentive — those are the clauses that, if absent, an enthusiastic manager re-adds, converting a useful diagnostic into a Goodhart magnet. Writing the non-goals down is what keeps the policy from decaying into the pathology.
2. They want **assurance that the org won't ship an expensive, embarrassing defect** — the percentage is a proxy they reached for. Offer: **escaped-defect rate** (measures the actual outcome, can't be faked by writing tests), **diff coverage on new code** (shows new work is tested without the legacy-retro tax, hard to game per-PR), and **risk-weighted coverage gaps** (directs attention to untested *critical* paths, not trivial helpers). Each is harder to game because they measure outcomes or narrow, reviewed slices rather than a single blunt total.
3. **No** — coverage must never be an individual performance metric, not even as a "factor." The second-order failures: engineers pad coverage with assertion-free tests and trivial-code tests (cheap number, zero quality), *avoid* the genuinely hard-to-test modules (where coverage is expensive), abuse `no cover` to dodge hard branches, and — worst — the metric's *legitimate* diagnostic use is poisoned because it's now "used against me." The number rises while the signal dies.
4. (a) **Quantify the pathology** the gate produced — assertion-free test count, exclusion growth, low mutation score on "covered" critical modules — evidence first. (b) **Stand up the replacement** (diff-coverage gate + critical-path mutation) and run it alongside for a sprint or two. (c) **Reframe as substitution** — replacing a gamed number with a behavior-verifying check is *raising* the real bar. (d) **Freeze the global gate** (stop ratcheting), keep the *measurement*, retire the *gate* once the replacement has a track record. (e) **Keep escaped-defect rate in view** as proof quality held. Never frame it as removal.
5. It's the **unmistakable fingerprint of assertion-free (or assertion-weak) tests**: the tests *execute* the auth code (95% lines run) but verify almost nothing (only 18% of injected faults are caught). Line coverage can't see this — executed is executed. It was produced by optimizing for a coverage number (gate/review/perf-review pressure) by writing tests that run code without asserting on behavior. Mutation is exactly what makes it visible.
6. The **diff gate** asks only that *changed* lines are tested. It sidesteps (1) the **legacy-code problem** — you never demand someone retro-test a huge untested monolith to merge a one-line fix — and (2) **gameability** — a per-PR diff floor is far harder to satisfy with filler than a project total, and it's enforced where the author has context to write a real test. Project coverage punishes legacy work and invites padding.
7. **Legitimate:** generated code, genuinely unreachable defensive branches, vendored files — each with a written justification comment. **Gaming:** "I excluded the hard branch to make the gate pass." The governance that distinguishes them: require a one-line justification on every exclusion, **surface net-new exclusions in the PR diff** so they're reviewed like code, and periodically audit the exclusion list. Govern (review each one), don't prohibit (exclusions are sometimes correct).

</details>

---

## Cheat Sheet

```
THE POLICY IN FIVE LINES
  measure   line + branch EVERYWHERE → dashboard for DIAGNOSIS only
  gate      patch/diff coverage of changed lines ≥ ~80%  (the ONLY gate)
  never     no global target · no team leaderboard · no perf-review tie-in
  verify    mutation on critical paths (auth/payments/money/data integrity)
  govern    no-cover exclusions need a reason + show up in review

THE EXEC REFRAME ("90% across the board")
  they want → assurance we won't ship an expensive defect
  offer     → escaped-defect rate  (the actual outcome)
              diff coverage        (new code tested, low legacy tax)
              risk-weighted gaps   (untested CRITICAL code, ranked)
  trade     → those three trend right, in exchange for NO global % target

KILLING THE PATHOLOGIES (remove the incentive, then backstop it)
  perf-review tie-in     → instant gaming   → hard NO in policy
  exclusion arms race    → metric hollows   → justify + review each, audit
  assertion-free tests   → fake coverage    → reject in review + mutation

WALK BACK A MANDATED 100% GATE (substitution, never subtraction)
  1 quantify the pathology it produced (evidence, not opinion)
  2 stand up the replacement FIRST (diff gate + critical-path mutation)
  3 reframe: replacing a gamed number with a behavior check = HIGHER bar
  4 freeze the gate, keep the measurement, retire the gate later
  5 keep escaped-defect rate in view = proof quality held

HEALTHY HABIT vs PATHOLOGY
  signal   → coverage on the PR diff; gap-hunt risky modules before changing
  target   → a number in a team-vs-team view / OKR / status meeting
  test     → "tool I use to find untested risk" vs "number I must satisfy"
```

---

## Summary

- **A coverage policy is short and opinionated, and its non-goals carry the weight.** Measure line + branch everywhere (diagnosis), gate *only* on patch/diff coverage of changed lines (~80%), and write down — explicitly — **no global target, no team leaderboard, no perf-review tie-in.** Those three non-goals are the clauses that decay into gaming if absent.
- **The leadership conversation is a redirect, not a refusal.** The exec who wants "90% across the board" actually wants *assurance*; the percentage is a proxy they grabbed. Offer three harder-to-game answers to the real question — **escaped-defect rate, diff coverage, risk-weighted gaps** — and explain concretely (assertion-free tests) why the single global number gets gamed.
- **Each pathology has a trigger and an antidote, and the antidote is usually "remove the incentive."** Coverage on perf reviews → instant gaming (hard no); the exclusion arms race → governance (justify + review each); assertion-free test culture → code review plus mutation as the automated backstop. Gaming is rational, so kill the incentive first and enforce the residual.
- **Walk back a broken regime as substitution, never subtraction.** Quantify the pathology, stand up the replacement (diff gate + critical-path mutation) *before* relaxing anything, freeze-then-retire the global gate while keeping the measurement, and keep escaped-defect rate in view as proof quality held. "Removed the gate" loses; "replaced a gamed number with a behavior check, defects flat" wins.
- **The healthy habit lives in the workflow, not on a scoreboard.** Coverage on the PR diff (where the author has context), deliberate gap-hunting on risky modules, surviving-mutant reports as missing-assertion hints — and the number kept off any view where people compare and optimize it. Visibility yes, targeting no; the line is whether it feeds an incentive.

You can now design, defend, and repair a coverage policy at org scale. The remaining tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone understands coverage as signal versus target.

---

## Further Reading

- *Software Engineering at Google* — Winters, Manshreck, Wright — the coverage chapter, and specifically the reasoning behind **not** enforcing a global coverage threshold.
- *TestCoverage* — Martin Fowler (martinfowler.com) — the canonical short essay: coverage is a tool to find untested code, not a target to hit.
- *An Industrial Evaluation of Mutation Testing* — Petrović & Ivanković (Google, 2018) — surfacing mutation results as code-review hints as a quality signal that beats a coverage percentage.
- *Goodhart's Law* and Marilyn Strathern's reformulation — the theoretical backbone of every gaming story in this page.
- Codecov / SonarCloud "new code" (diff) coverage documentation — the mechanics of the patch-coverage gate the policy is built on.

---

## Related Topics

- [04 — Coverage in CI & Diffs](../04-coverage-in-ci-and-diffs/professional.md) — diff/patch coverage, the ratchet, and the gate mechanics the policy gates on.
- [05 — What Coverage Does *Not* Tell You](../05-what-coverage-does-not-tell-you/professional.md) — the limits (no assertions, missed requirements, concurrency) the policy and the mutation backstop account for.
- [Quality Gates](../../quality-gates/) — where the patch-coverage gate sits among the other merge-blocking checks, and how to design gates that help rather than game.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — escaped-defect rate and outcome metrics in the broader context of measuring engineering without inducing Goodhart pathologies.
