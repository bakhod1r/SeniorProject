# Coverage in CI & Diffs — Professional Level

> **Roadmap:** [Code Coverage](../README.md) → Coverage in CI & Diffs
> *The senior page taught you the mechanics — patch coverage, the ratchet, shard merging, flaky gates. This page is about turning those mechanics into org policy without starting a revolt: how you roll a gate out across dozens of repos and hundreds of engineers, who owns `codecov.yml`, what happens when people game the number, and why the day you tie coverage to a performance review is the day the number dies.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Rolling Out a Coverage Gate Without a Revolt](#rolling-out-a-coverage-gate-without-a-revolt)
4. [The Politics of the Gate](#the-politics-of-the-gate)
5. [Choosing the Policy](#choosing-the-policy)
6. [Coverage Gates vs Delivery Speed](#coverage-gates-vs-delivery-speed)
7. [Making the Number Trustworthy Across Teams](#making-the-number-trustworthy-across-teams)
8. [The Org Dashboard and Trends](#the-org-dashboard-and-trends)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Coverage gates as organizational policy — the politics and the rollout, not the YAML.**

The senior page gave you working machinery: a patch-coverage check, a project ratchet, merged shards, a de-flaked gate. That machinery is necessary and not remotely sufficient. The hard part of coverage at the professional level isn't configuring Codecov — it's that a coverage gate is a *policy you impose on other people's pull requests*, and people respond to policy. They route around it, argue about it, game it, and — if you get the rollout wrong — campaign to have it deleted. A gate that gets disabled after three sprints did worse than no gate: it taught the org that quality controls are theater.

So this page is about the political and organizational layer. How do you introduce a gate on a legacy repo with 40% coverage without every PR turning red overnight? Who decides the threshold, and who can change it under pressure? What's the emergency-override process when the gate stands between a Sev1 hotfix and production? How do you stop the exclusion list from quietly absorbing every file someone didn't feel like testing? And the deepest question: how do you keep the number *honest* across twenty teams, so that "82% coverage" means roughly the same thing in the payments repo as in the marketing-site repo — and never becomes a stick in a performance review, which is the fastest known way to destroy a metric. This is the layer where Goodhart's law stops being a quote on the README and becomes a force you actively manage.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — patch vs project coverage, the ratchet, status checks, shard merging, flaky-gate causes.
- **Required:** You've owned or operated a CI pipeline that other engineers depend on to merge.
- **Helpful:** You've rolled out *any* org-wide policy (a linter, a required review, a branch-protection rule) and watched how people react.
- **Helpful:** You've been the person blocked by a quality gate during an incident and felt the temptation to bypass it.

---

## Rolling Out a Coverage Gate Without a Revolt

The single most common way to fail at coverage gating is to flip on a **global project threshold** on an existing repo. Someone reads that the team "should be at 80%," sets `project.target: 80%` on a repo that's at 47%, and every pull request — including a one-line typo fix in the README — turns red because the *whole repo* is below the line. The gate is now blocking work that has nothing to do with the uncovered code, engineers learn to click "merge anyway" or demand admin override, and within a week the check is either disabled or universally ignored. You have spent your political capital and bought negative quality.

The path that works is **clean as you code**: you don't gate the legacy debt, you gate *the change in front of you*. The rollout has three phases, and skipping any of them is how revolts start.

**Phase 1 — Advisory / informational (weeks, not days).** Turn coverage *on* but make it **non-blocking**. The PR gets a comment and a status check, but the check is `informational: true` (Codecov) — it reports, it never fails the build. This does three things: it surfaces the number so people start seeing it, it lets you find and fix your *own* config and flakiness before it can hurt anyone, and it gives teams time to absorb that coverage is now a visible signal. Crucially, nobody is blocked yet, so nobody is angry yet.

```yaml
# codecov.yml — Phase 1: visible but harmless
coverage:
  status:
    project:
      default:
        informational: true   # report only — never blocks a merge
    patch:
      default:
        informational: true
```

**Phase 2 — Patch-coverage gate on new code only.** Now you make a gate *blocking* — but only the **patch** (diff) check, never the project check. The rule becomes: *the lines you changed in this PR must be covered* (say, ≥ 75–80% of new/modified lines), and the legacy debt is left entirely alone. A typo fix touches no code, so patch coverage is trivially satisfied. A new feature must come with tests for the new feature. The repo's overall number is irrelevant to whether you can merge; only *your diff* matters. This is the heart of "clean as you code" (the phrase SonarQube popularized): you stop the bleeding without demanding anyone retroactively test ten years of history.

```yaml
# codecov.yml — Phase 2: gate the diff, ignore the legacy debt
coverage:
  status:
    project:
      default:
        informational: true        # still report-only; do NOT block on the global number
    patch:
      default:
        target: 80%                 # new/changed lines must hit this
        threshold: 0%               # no slack — the diff is small, hold it to the bar
```

**Phase 3 — Project ratchet (optional, and only once Phase 2 is boring).** If — and only if — the team wants the overall number to *climb*, add a **ratchet** on the project check: it may never go *down*. You don't pick a target; you pin the floor to wherever the repo currently is and forbid regressions. Coverage rises naturally because Phase 2 forces every new line to be tested, and the ratchet guarantees no PR quietly deletes a tested branch to dodge the patch gate.

```yaml
    project:
      default:
        target: auto      # the floor = current coverage; PRs may not drop it
        threshold: 1%     # tiny tolerance so refactors that delete tested code don't trip it
```

The whole sequence is *opt-in to pain, gradually*. Advisory removes surprise; patch-only removes the "I'm blocked by code I never touched" injustice; the ratchet (last, optional) lets the number improve without a flag day. The repo that's at 47% can climb to 70% over a year of normal work, and no engineer ever experienced a morning where everything was suddenly red.

> **The professional reality:** the *technical* difference between gating `project` and gating `patch` is one YAML block. The *organizational* difference is enormous: `project` on a legacy repo punishes everyone for the past; `patch` asks only that you not make it worse. Always gate the diff first. A global-threshold block on a legacy repo is the single most reliable way to get your coverage program killed.

---

## The Politics of the Gate

The moment a number can block a merge, humans optimize *the number*, not the thing it was supposed to proxy. This is not a moral failing of your colleagues; it's the predictable response to a constraint on their critical path. Expect it and design for it.

**Developers gaming the gate.** Patch coverage demands that new lines be *executed* by a test. It does not — cannot — demand that the test *assert* anything. So the path of least resistance under a coverage gate is the **assertion-free test**: call the new function, ignore the result, the lines light up green, the gate passes, the behavior is untested. The gate manufactured a test that proves nothing. (This is exactly the failure mode mutation testing exists to catch — see [02 — Mutation Coverage](../02-mutation-coverage/professional.md) — because a mutant survives an assertion-free test trivially.) Other moves: writing the test against trivial getters to pad the diff while leaving the hard branch uncovered; or splitting a PR so the untested risky code lands in a "refactor" commit that touches lots of lines and dilutes the patch denominator. You cannot YAML your way out of this. The countermeasure is code review culture plus, where it matters, a mutation gate on top of the coverage gate.

**The exclusion-list arms race.** Every coverage tool lets you exclude paths (`ignore:` in `codecov.yml`) and lines (`# pragma: no cover`, `/* istanbul ignore next */`). These exist for legitimate reasons — generated code, vendored code, `main()` wiring, the genuinely untestable. But the same mechanism is the perfect gate-bypass: can't be bothered to test this module? Add it to `ignore:`. The exclusion list starts at four sensible entries and, left ungoverned, grows into a graveyard where inconvenient code goes to die — and because excluded code vanishes from the denominator, the *reported* coverage can climb while the *real* coverage falls. The defense is to treat `codecov.yml` and every inline `pragma` as **reviewed code**: changes to the exclusion list require explicit justification in the PR, and a periodic audit asks "why is this excluded, and is the reason still true?"

**Who owns `codecov.yml`?** This is the question that decides whether the gate has integrity. If *anyone* on a team can edit the repo's `codecov.yml`, then the gate is advisory in practice — the first time it's inconvenient, someone lowers the target or adds an ignore, and it never goes back up (ratchets only work upward; humans editing config ratchet downward). The mature pattern is a **two-tier config**: an org-level default config (committed in a central repo, or set as the org default in Codecov) that individual repos *inherit* and *cannot weaken*, plus a repo-level config for the things that are legitimately local (which paths are generated here). Ownership of the org default sits with a platform/quality team or a guild, behind code review, so loosening the gate is a *visible, reviewed, cross-team* act rather than a quiet commit.

**The bypass / override process.** A gate with no override is a gate that will be ripped out the first time it blocks a Sev1 hotfix at 2 a.m. You *must* have an escape hatch — but it must be **loud, logged, and rare**, not a button everyone can press silently. The shape of a good override:

- **Who can use it:** a small set (repo admins, the on-call lead), not every author.
- **How:** an explicit, auditable action — admin "merge without passing checks," or a `coverage-override` label that a bot honors, or a documented `break-glass` approval — *never* by quietly editing the threshold down.
- **What it costs:** the override is recorded (who, when, why), and it creates a **follow-up obligation** — a tracked ticket to add the missing tests, so "I'll test it later" is a commitment, not a vanishing promise.
- **What it must never be:** the *normal* way to merge. If overrides are routine, the threshold is wrong (too strict) — fix the threshold, don't normalize the bypass.

> **The political reality:** the gate's authority comes entirely from being *fair* and *escapable*. Fair = it only judges the diff, so nobody is blocked by code they didn't write. Escapable = there's a loud, audited override for real emergencies. A gate that is unfair (global threshold) or inescapable (no override) doesn't get respected — it gets disabled, and it takes the rest of your quality program's credibility with it.

---

## Choosing the Policy

The policy is a set of dials. Set them by what behavior you want, not by copying another org's numbers — an 80% that's appropriate for a billing service is theater on a throwaway prototype.

**The patch threshold value.** The honest target for *new* code is high — 80% is the common default, and on critical-path services 90%+ is defensible *because the diff is small and you control it*. The mistake is treating the patch number like the project number; on a diff, demanding high coverage is reasonable precisely because you're only asking the author to test what they just wrote. Set `threshold: 0%` (no slack) on the patch check for critical repos so a 79.9% can't sneak through; allow a point or two of `threshold` on less critical ones to avoid blocking on a single hard-to-hit error branch.

**Project ratchet vs fixed floor.** Two ways to gate the overall number, and they send different messages:

| | Fixed floor (`target: 80%`) | Ratchet (`target: auto`) |
|---|---|---|
| What it says | "Be at least 80%" | "Never get worse than today" |
| On a legacy repo | Blocks everything until you hit 80% — revolt risk | Safe to enable today at any starting coverage |
| Failure mode | People game *up to* the floor, then stop | People can't regress, but no pressure to improve (Phase-2 patch gate supplies that) |
| Best for | Greenfield repos started above the bar | Existing repos; the default for "clean as you code" |

For an existing codebase the ratchet (`auto`) is almost always right: it's enable-able immediately, it can't be hostile, and the *upward* pressure comes from the patch gate, not the project gate. A fixed floor only makes sense on a repo that already clears it comfortably.

**Which repos are gated.** Not all repos deserve the same gate, and pretending they do is how you get the prototype-blocked-by-coverage complaint that discredits the whole program. Tier them:

- **Critical / core services** (payments, auth, data integrity): patch gate blocking at 80–90%, ratchet on, override behind break-glass.
- **Normal product repos:** patch gate blocking at ~75–80%, ratchet on, standard override.
- **Tooling / internal / low-stakes:** advisory, or a lenient patch gate.
- **Prototypes / spikes / examples:** *no gate*, explicitly. A repo named to signal throwaway status (or a top-level `codecov.yml` with `coverage.status` off) is honest about its nature.

**Exemptions for spikes and prototypes.** Even inside a gated repo, there are legitimate "I am deliberately not testing this yet" cases: a spike branch exploring an approach, a prototype behind a feature flag, generated code. The professional move is to make the exemption *explicit and bounded* — a documented label, a known directory convention, or a `// prototype` path in the ignore list with a removal ticket — rather than letting "it's just a spike" be an ad-hoc verbal exception that erodes into "we don't really gate here."

> **The calibration principle:** the policy should make *the right thing the easy thing*. Gate the diff (so testing-as-you-go is the path of least resistance), tier the strictness to the stakes (so nobody's prototype is held to payments standards), and make exemptions explicit and time-boxed (so the easy escape doesn't quietly become the norm). A policy that ignores stakes will be either too weak where it matters or too strict where it doesn't — and the second one is what gets gates deleted.

---

## Coverage Gates vs Delivery Speed

A coverage gate is a tax on every pull request. A *well-calibrated* tax buys real quality cheaply; an *overtuned* tax slows everyone down, breeds resentment, and gets the gate disabled — which is strictly worse than never having gated, because now the org has learned that quality controls are obstacles to route around.

The failure mode is the gate that's **too strict for the work**. Set patch coverage at 100% with zero threshold, and you've guaranteed that the *one* genuinely hard-to-cover line — a defensive `default:` branch, an `errno`-path that needs fault injection, a platform-specific code path — blocks a PR that is otherwise correct and well-tested. The author now spends an hour writing a contorted test (often an assertion-free one — see above) purely to satisfy the gate, or spends that hour begging for an override. Multiply by every PR, and the gate has added a per-change drag that the team feels acutely and the quality numbers don't reward. People notice. The campaign to disable it writes itself, and it's *justified*.

Calibrating to not block legitimate work:

- **Leave a little slack on the patch check** (`threshold: 1–2%`) on most repos, so a single unhittable line doesn't fail an otherwise well-tested diff. Reserve `threshold: 0%` for the few repos where the rigor is worth the friction.
- **Make the gate fast.** A coverage check that adds ten minutes to CI *is* a delivery-speed cost even when it passes. The shard-merge and upload mechanics from senior.md matter here: a slow or flaky coverage step taxes every PR regardless of the number.
- **Watch the override rate as a calibration signal.** If overrides are *routine*, the gate is too strict — the team is telling you, through their behavior, that the bar doesn't fit the work. Lower it. A gate that's bypassed constantly is mis-tuned, not disrespected.
- **Measure the gate's own cost.** PR cycle time, the number of "fix coverage" follow-up commits, the override frequency — these tell you whether the gate is buying quality or just buying delay.

> **The speed/quality reality:** the goal is not maximum coverage; it's the *most quality the team will actually tolerate sustainably*. A gate set slightly below the line of pain is a gate that survives and compounds over years. A gate set above it is a gate that gets deleted in a quarter — and a deleted gate protects nothing. Calibrate to "tight enough to matter, loose enough to live with," and revisit the dial when the override rate tells you you're wrong.

---

## Making the Number Trustworthy Across Teams

For coverage to be an org-level signal, "78% coverage" has to mean roughly the same thing everywhere. Three things make the number trustworthy — and one thing reliably destroys it.

**Consistent config.** If every repo defines coverage differently — one counts branches, another only lines; one excludes tests-of-tests, another doesn't; one merges integration coverage, another reports unit-only — then cross-repo comparison is meaningless and the org dashboard is lying. The fix is the **shared org default** from the politics section: a common `codecov.yml` baseline that defines *what counts* (line vs branch — see [01 — Line, Branch & Path Coverage](../01-line-branch-path-coverage/professional.md)), what's excluded by default, and how flags/components are named, so the numbers are commensurable. Repos override only the genuinely local bits.

**Flaky-gate eradication.** A gate that fails intermittently for reasons unrelated to the diff — a dropped shard upload, a coverage report that races, a parallel test that doesn't always run — is worse than no gate, because it trains the entire team that *red doesn't mean broken*. Once people learn to reflexively re-run or override a flaky coverage check, they apply that reflex to the *real* failures too, and the gate's signal value goes to zero. The senior page covered the mechanics (atomic coverage mode, deterministic shard merging, waiting for all uploads); the *professional* obligation is to treat a flaky coverage gate as a **production incident for the gate itself** — drop everything and fix it, because every flaky failure spends trust you can't easily rebuild.

**Goodhart, and the thing that destroys the number: performance reviews.** *"When a measure becomes a target, it ceases to be a good measure."* The instant coverage feeds a performance review, a bonus, or a team ranking, you have made it a target with personal stakes — and you will get exactly what you incentivized: assertion-free tests, padded diffs, exclusion-list growth, and a number that climbs while quality doesn't. Engineers are smart and motivated; point that intelligence at *gaming a percentage* and they will succeed. Google's stance (from *Software Engineering at Google*) is the hard-won lesson: they do **not** enforce a global coverage threshold and explicitly avoid coverage-as-KPI, treating it as a diagnostic for finding untested code, not a score to rank people by. The professional rule is absolute: **coverage may inform engineering decisions; it may never appear in a performance review.** The moment it does, the number is dead as a signal — and you can't un-ring that bell. (This is the whole thesis of [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md).)

> **The trust reality:** a number is only a useful org signal if it's *consistent* (same definition everywhere), *reliable* (the gate doesn't cry wolf), and *unweaponized* (never tied to individual evaluation). Break any of the three and the dashboard becomes decoration at best, an active distortion at worst. The most expensive mistake is the last one: tying coverage to reviews is irreversible — once people have learned to game it for their bonus, the metric never tells the truth again.

---

## The Org Dashboard and Trends

An org-wide coverage dashboard (Codecov's org view, SonarQube's portfolio, a homegrown rollup) is genuinely useful — *as a watched signal, not a weapon*. The distinction is everything.

**As a signal**, the dashboard answers questions worth asking: *Which repos have no coverage at all* (a real risk indicator)? *Is the trend on our critical services flat, rising, or quietly eroding* (the slope matters more than the absolute number)? *Did a repo's coverage just drop 15 points* (someone disabled the gate, or merged a huge untested feature, or — watch for this — grew the exclusion list)? Trends are far more informative than snapshots: a service holding steady at 70% is healthier than one that slid from 85% to 78% in a quarter, even though the snapshot favors the second. Use the dashboard to *find conversations*, not to *assign blame*.

**As a weapon**, the same dashboard rots fast. Rank teams by coverage and you've created a Goodhart competition: teams optimize their position with exclusions and assertion-free tests, the leaderboard rewards the best gamers, and the dashboard now actively misleads leadership about where the risk is. The teams with the *honest* (lower, unpadded) numbers look worst; the teams that gamed hardest look best. You have inverted the signal.

The healthy posture: surface the dashboard for *engineering* visibility (teams watch their own trend, platform teams spot repos with zero coverage or sudden drops), pair every number with the caveat that it's a diagnostic, and *never* roll it up into a metric that flows to performance management. Pair it with the *change* signals — a coverage drop on a PR, a spike in the exclusion list, a gate that got switched to advisory — because those *deltas* point at where attention is actually needed.

> **The dashboard reality:** trends beat snapshots, and "find the conversation" beats "assign the blame." A coverage dashboard is a smoke detector — useful for noticing where something's off so a human can go look. The moment you turn the smoke detector into a scoreboard people are graded on, they learn to disconnect it (game it) and it stops detecting smoke.

---

## War Stories

**The global 80% gate that bypassed itself into meaninglessness.** A platform team mandated `project.target: 80%` across all repos in one rollout. The flagship service — a decade-old monolith at 52% — turned *every* PR red, including dependency bumps and config tweaks that touched no application code, because the *whole repo* was under the line. With releases blocked, leadership demanded an escape, so admins got "merge without passing checks." Within two weeks, *every* merge to that repo used the admin override, because every merge failed the gate. The override became the normal path; the gate became a checkbox everyone clicked through. Six months later coverage was *lower* (untested code kept landing via override) and the team had learned that the quality gate was an obstacle, not a guardrail. The fix was a full reset: gate the *patch* only, leave the 52% legacy debt alone, and let the number climb on new code. The lesson: a global threshold on a legacy repo doesn't enforce quality — it manufactures a culture of routine override, and overrides don't ratchet back.

**The patch-coverage rollout that stuck.** A different org introduced coverage the slow way. Phase 1: informational-only for a full quarter — every PR got a Codecov comment, nothing blocked, and the platform team quietly fixed shard-merge flakiness during this window. Phase 2: a *patch* gate at 80% with a 1% threshold, legacy debt untouched. The only PRs that ever went red were ones adding genuinely untested new code — which is exactly the conversation you *want* in review. Phase 3, a year later: an `auto` ratchet, by which point coverage had already drifted up from new-code discipline alone. Two years on, the gate was uncontroversial, the flagship repo had climbed 20 points without a single flag day, and *nobody had ever experienced a morning where everything was red*. The lesson: rollout *sequence* — advisory, then patch-only, then ratchet — is what determined survival, far more than the threshold value.

**The exclusion-list arms race.** A repo's `codecov.yml` `ignore:` block started with four reasonable entries (generated protobufs, vendored code, `main.go`, migrations). Because nobody reviewed it as real code, it became the path of least resistance: a hard-to-test integration module, then a sprint's worth of "I'll add tests later" files, then an entire `legacy/` directory. Reported coverage *rose* from 71% to 84% over a year — and real coverage *fell*, because excluded code left the denominator. The illusion broke when an incident traced to a NullPointer in a module that had been silently added to `ignore:` months earlier; it had *zero* tests and the dashboard had no idea, because it wasn't counted. The team instituted a rule: `codecov.yml` changes require a reviewer and a written justification, and a quarterly audit re-examines every `ignore:` entry. Coverage "dropped" to 73% the day they cleaned the list — which was the *honest* number all along. The lesson: an ungoverned exclusion list is a coverage-inflation machine; the exclusion list is code, and it needs the same review rigor as code.

---

## Decision Frameworks

**How do I roll out a gate on an existing repo? Sequence:**
- Phase 1 — **informational only**, for weeks. Surface the number; fix your own flakiness; block nobody.
- Phase 2 — **patch gate, blocking**, on new code only (~80%). Never gate `project` on a legacy repo.
- Phase 3 — **ratchet** (`auto`), optional, once Phase 2 is boring. Floor = today; never regress.

**Fixed floor or ratchet? Ask:**
- Is the repo *already above* the bar comfortably? → fixed floor is fine.
- Is it an existing repo at an arbitrary starting point? → **ratchet (`auto`)** — safe to enable today, upward pressure comes from the patch gate.

**Which repos do I gate, and how hard? Tier by stakes:**
- Critical/core (payments, auth, data) → patch 80–90%, `threshold: 0`, break-glass override.
- Normal product → patch ~75–80%, standard override.
- Tooling/internal → advisory or lenient.
- Prototypes/spikes → **no gate**, explicitly.

**Who can change the config? Default to:**
- Org-default `codecov.yml` owned by a platform/quality guild, behind review, that repos *inherit and cannot weaken*. Repo-level config only for genuinely local bits (which paths are generated).

**What's the override process? Require:**
- Small set of people, an *auditable* action (label/admin-merge — never quietly lowering the threshold), a logged who/when/why, and a tracked follow-up ticket. Loud, rare, and never the normal path.

**Is the gate calibrated right? Check the signal:**
- Overrides *routine* → too strict; lower it.
- Coverage rising but quality not → it's being gamed (assertion-free tests / exclusions); add mutation, audit the ignore list.
- Anyone proposing coverage in a performance review → **stop**; that's the one irreversible mistake.

---

## Mental Models

- **Gate the diff, not the debt.** Patch coverage asks "did you test what you just wrote?" — fair, and survivable. Project coverage on a legacy repo asks "have you retroactively tested ten years of history?" — unfair, and it gets your gate deleted. Always start with patch-only.

- **A gate's authority comes from being fair *and* escapable.** Fair = it only judges your diff. Escapable = a loud, audited break-glass for emergencies. Unfair or inescapable gates aren't respected; they're disabled.

- **Anything that can block a merge gets gamed.** Point motivated engineers at a percentage on their critical path and they'll satisfy it the cheap way (assertion-free tests, padded diffs, exclusions). Expect it; counter it with review culture and mutation, not stricter YAML.

- **The exclusion list is code.** Ungoverned, it's a coverage-inflation machine — excluded code leaves the denominator, so the number rises as real coverage falls. Review every `ignore:` and `pragma` like you review logic.

- **The override rate is the calibration gauge.** Routine overrides don't mean indiscipline; they mean the gate is too tight. The team is telling you the bar doesn't fit the work — listen and lower it.

- **Coverage in a performance review is irreversible death of the metric.** Tie it to evaluation once and people learn to game it for their bonus forever. It may inform engineering decisions; it may *never* score people.

---

## Common Mistakes

1. **Flipping on a global `project` threshold on a legacy repo.** Every PR turns red over code nobody touched; the gate gets overridden into meaninglessness or deleted. Gate the **patch** first; leave the debt alone.

2. **No rollout phases.** Going straight to a blocking gate skips the advisory window where you find your *own* flakiness and let teams absorb the signal. Do informational → patch → ratchet.

3. **Letting anyone edit `codecov.yml`.** The gate ratchets *down* every time it's inconvenient. Own an org-default config behind review that repos inherit and can't weaken.

4. **No override process — or one that's silent and routine.** No escape hatch → the gate dies at the first Sev1. A silent, everyone-can-press button → the override becomes the normal merge path. Make it loud, audited, rare, with a follow-up ticket.

5. **Ignoring the exclusion-list arms race.** `ignore:` and `pragma: no cover` quietly absorb every inconvenient file; reported coverage rises while real coverage falls. Review exclusions as code; audit them periodically.

6. **Setting the gate too strict for the work.** 100%/zero-threshold blocks otherwise-correct PRs on one unhittable line, taxes every change, and gets the gate disabled. Leave slack; watch the override rate; calibrate to "tight enough to matter, loose enough to live with."

7. **Tying coverage to performance reviews.** The single irreversible mistake. You get gamed numbers forever and a metric that no longer tells the truth. Coverage informs engineering; it never scores people.

8. **Tolerating a flaky gate.** An intermittently-failing coverage check trains the team that red doesn't mean broken — and that reflex spreads to real failures. Treat a flaky gate as an incident for the gate itself.

---

## Test Yourself

1. A teammate sets `project.target: 80%` on a 50%-coverage legacy repo and every PR — including a README typo fix — goes red. Explain *why* even no-code PRs fail, and give the rollout you'd do instead.
2. Walk through the three-phase "clean as you code" rollout. What does each phase block, and why is the order load-bearing?
3. A repo's reported coverage climbed from 71% to 84% over a year, but an incident hit a completely untested module. What almost certainly happened, and what governance prevents it?
4. Why is gating `patch` fair but gating `project` on a legacy repo unfair? Tie your answer to who gets blocked.
5. You're told to add coverage to the company's performance-review rubric to "drive quality." Make the case against it in terms of Goodhart's law, and say what you'd offer instead.
6. Overrides on a gated repo have become routine — most merges use the break-glass label. Is the team being undisciplined? What does this actually tell you, and what do you change?
7. Two repos both report "78% coverage." What would have to be true about their configs for that comparison to be meaningful, and why does it matter at org scale?

<details>
<summary>Answers</summary>

1. The `project` check evaluates the **whole repo's** coverage against the target, not the diff. A README typo touches no code, but the repo is still at 50% < 80%, so the project check fails *regardless of the PR*. Everyone is blocked by the legacy debt. Instead: **informational** for weeks → blocking **patch** gate on new code only (~80%) → optional `auto` ratchet later. The 50% debt is never gated; coverage climbs from new-code discipline.

2. **Phase 1 — informational/advisory:** blocks *nothing*; surfaces the number and lets you fix your own config/flakiness before it can hurt anyone. **Phase 2 — patch gate:** blocks PRs whose *new/changed* lines fall below the bar; legacy debt untouched, so only genuinely-untested new code goes red. **Phase 3 — ratchet (`auto`):** blocks PRs that *lower* the overall number; floor = current coverage. Order matters because each phase removes a specific source of injustice/surprise before the next adds teeth: advisory removes surprise, patch-only removes "blocked by code I didn't write," ratchet (last) prevents regression without a flag day.

3. The **exclusion list grew ungoverned** — files got added to `ignore:` (or `pragma: no cover`), leaving the denominator, so reported coverage rose while real coverage fell; the incident module had been silently excluded and had zero tests. Prevention: treat `codecov.yml`/`pragma` changes as reviewed code requiring written justification, plus a periodic audit of every exclusion ("is this still true?").

4. **Patch** judges only the lines *this PR changed* — it asks "did you test what you just wrote?", which the author controls and can satisfy. **Project** on a legacy repo judges the *entire repo*, so an author is blocked by uncovered code written years ago by other people that they never touched. Patch blocks the person responsible for the new code; project blocks everyone for the past.

5. By Goodhart, the moment coverage becomes a target with personal stakes it stops measuring quality and starts measuring *gaming ability*: assertion-free tests, padded diffs, exclusion growth — the number rises while quality doesn't, and the distortion is **irreversible** (people who learned to game it for a bonus keep doing it). Offer instead: coverage as a *diagnostic* for finding untested code, surfaced in review and on trend dashboards, explicitly kept out of evaluation (Google's no-global-threshold, no-KPI stance).

6. They're **not** being undisciplined — routine overrides mean the **gate is too strict for the work**. The behavior is the signal: the bar doesn't fit reality. Lower the patch target / add a point or two of `threshold` so legitimate PRs pass, reserve the override for true emergencies, and re-check the override rate.

7. The configs would have to define coverage **the same way**: same metric (line vs branch), same default exclusions, same handling of merged integration vs unit coverage, comparable flag/component setup. Otherwise "78%" means different things and the org dashboard is comparing incommensurable numbers — which matters because leadership uses the rollup to spot risk, and inconsistent definitions make it point at the wrong repos. The fix is a shared org-default config repos inherit.

</details>

---

## Cheat Sheet

```
ROLLOUT (clean as you code) — never skip a phase
  Phase 1  informational: true        report only, block NOTHING (weeks)
  Phase 2  patch gate ~80%, blocking   new code only; leave legacy debt alone
  Phase 3  project target: auto        ratchet (optional); floor = today, never regress
  ANTI-PATTERN: project target: 80% on a legacy repo → every PR red → gate dies

PATCH vs PROJECT
  patch    judges the DIFF        fair, survivable — gate this first
  project  judges WHOLE repo      on legacy = unfair; ratchet (auto) is the safe form

POLICY DIALS (set by stakes, not by copying numbers)
  critical/core   patch 80-90%, threshold 0, break-glass override
  normal product  patch ~75-80%, standard override
  tooling/internal advisory or lenient
  prototypes/spikes  NO gate, explicitly

CONFIG OWNERSHIP
  org-default codecov.yml  owned by platform/quality guild, behind review
  repos INHERIT and CANNOT weaken it; local config = generated paths only

OVERRIDE (the escape hatch)
  loud + logged + rare    who/when/why recorded, follow-up ticket required
  via label / admin-merge NEVER by quietly lowering the threshold
  routine overrides       = gate too strict → lower it

GAMING (expect it; YAML can't stop it)
  assertion-free test     lines green, asserts nothing → add MUTATION gate
  exclusion-list creep    ignore: grows, denominator shrinks, number lies → review as code
  padded diff             trivial getters tested, hard branch skipped → code review

THE IRREVERSIBLE MISTAKE
  coverage in a perf review → gamed forever, metric dead. NEVER. (Goodhart)

TRUST = consistent config + no flaky gate + not weaponized
DASHBOARD = trends > snapshots; find conversations, not blame
```

---

## Summary

- **Rollout sequence beats threshold value.** Go **informational → patch-gate-on-new-code → optional ratchet**, over weeks. Flipping on a global `project` threshold on a legacy repo turns every PR red, manufactures routine overrides, and gets your gate deleted — the single most reliable way to kill a coverage program.
- **Gate the diff, not the debt.** Patch coverage is *fair* (it judges only what you wrote) and survivable; project coverage on a legacy repo is *unfair* (it blocks you for the past). On existing repos, the **ratchet (`auto`)** is the safe form of project gating — enable-able today, upward pressure supplied by the patch gate.
- **Anything that blocks a merge gets gamed** — assertion-free tests, padded diffs, and an exclusion-list arms race where reported coverage rises as real coverage falls. Counter with code-review culture, [mutation testing](../02-mutation-coverage/professional.md), and treating `codecov.yml`/`pragma` as reviewed code.
- **Own the config and the override.** An org-default config behind review that repos inherit and can't weaken keeps the gate honest; a loud, audited, rare break-glass override (never a quiet threshold edit) keeps it from being ripped out at the first Sev1.
- **Calibrate to delivery speed.** A gate too strict for the work taxes every PR and gets disabled — worse than no gate. Leave slack, watch the **override rate** as your calibration gauge, and tune to "tight enough to matter, loose enough to live with."
- **Make the number trustworthy: consistent config, zero flaky gates, and — the one irreversible rule — never tie coverage to performance reviews** (Goodhart). The org dashboard is a smoke detector for trends, not a scoreboard for ranking people. This is the whole thesis of [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md).

You can now run coverage gating as organizational policy — surviving the politics, the gaming, and the speed/quality tension. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone has actually operated a gate at scale, not just configured one.

---

## Further Reading

- *Software Engineering at Google* — Winters, Manshreck, Wright — the coverage chapter, especially the argument for **no global coverage threshold** and coverage-as-diagnostic, not KPI.
- [Codecov flags, carryforward, and status configuration](https://docs.codecov.com/docs/commit-status) — `informational`, `patch` vs `project`, `target: auto`, and `threshold` — the dials this page sets as policy.
- [SonarQube — Clean as You Code](https://docs.sonarsource.com/sonarqube/latest/user-guide/clean-as-you-code/) — the canonical articulation of gating *new* code and leaving legacy debt alone.
- *TestCoverage* — Martin Fowler — why coverage is a diagnostic for finding untested code, never a target.
- *Goodhart's Law* (Goodhart 1975; Strathern's reformulation) — the theory behind "don't tie it to reviews."
- Postmortems and engineering blogs on **quality-gate rollouts** (Spotify, Google, GitLab) — the recurring lesson that rollout sequence and fairness, not threshold numbers, decide whether a gate survives.

---

## Related Topics

- [06 — Coverage as Signal, Not Target](../06-coverage-as-signal-not-target/professional.md) — Goodhart in depth; why the gate must never become a KPI.
- [02 — Mutation Coverage](../02-mutation-coverage/professional.md) — the gate that catches the assertion-free tests a coverage gate manufactures.
- [Quality Gates](../../quality-gates/) — the broader family of merge-blocking checks; coverage is one gate among many, and the rollout/override patterns generalize.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — how to treat a metric as a watched signal without weaponizing it; the same Goodhart discipline applied across delivery metrics.
