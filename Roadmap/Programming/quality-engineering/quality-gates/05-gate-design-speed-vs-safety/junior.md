# Gate Design: Speed vs Safety — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Gate Design: Speed vs Safety
> *Every gate you add makes shipping a little safer — and a little slower, a little more annoying. The skill isn't adding gates; it's deciding which ones are worth their cost.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Every Gate Has a Cost](#core-concept-1--every-gate-has-a-cost)
5. [Core Concept 2 — Fast Feedback and Shift-Left](#core-concept-2--fast-feedback-and-shift-left)
6. [Core Concept 3 — Every Gate Needs an Owner and a Purpose](#core-concept-3--every-gate-needs-an-owner-and-a-purpose)
7. [Core Concept 4 — The Flaky or Pointless Gate](#core-concept-4--the-flaky-or-pointless-gate)
8. [Core Concept 5 — Defense in Depth, Not Pointless Redundancy](#core-concept-5--defense-in-depth-not-pointless-redundancy)
9. [Core Concept 6 — Match the Gate to the Risk](#core-concept-6--match-the-gate-to-the-risk)
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

> Focus: **How do you think about gates as a set, instead of one at a time?**

By now you know what individual quality gates are: a required CI check that must pass, an approval someone has to click, a coverage threshold the build won't fall below. Each one, on its own, sounds like a good idea. More checks means fewer bugs, right?

So a team adds a linter. Then a type check. Then unit tests, then integration tests, then a coverage gate, then a security scan, then two required reviewers, then a "must link a ticket" check, then a license scan. Each was added by a well-meaning person solving a real problem they'd been burned by. A year later, opening a pull request triggers a 45-minute pipeline with fourteen required checks, three of which fail at random, and merging a one-line typo fix takes two hours and a Slack message asking someone to "just admin-merge it."

That team didn't make a single bad decision. They made fifteen *locally* reasonable decisions and ended up with a *globally* terrible system. This is the core problem of gate design: gates trade **speed** (how fast and how often you can ship) against **safety** (how many real problems you catch before they reach users). You cannot maximize both. Every gate you add buys some safety and spends some speed — and the speed it spends is real, recurring, and paid by every engineer on every change, forever.

This page teaches you to evaluate gates the way a senior engineer does: not "is this check good?" but "is this check *worth what it costs*, and is *this* the cheapest place to run it?"

> **Mindset shift:** stop thinking "more gates = more safety, so add them." Start thinking "safety isn't free — every gate is a tax on every change, so each one must *earn its place* by catching real problems often enough to justify the time and friction it costs." A gate that doesn't pull its weight isn't neutral; it's a cost with no benefit, and it quietly trains people to route around all your gates.

---

## Prerequisites

- **Required:** You know what an individual quality gate is — a required check, an approval, or a threshold that can block a merge or deploy. (If "required CI check" is new, read [01 — Required CI Checks](../01-required-ci-checks/junior.md) first.)
- **Required:** You've opened a pull request and waited for CI to run, and you've seen at least one check go red.
- **Helpful:** You've experienced a *slow* pipeline — waited 20+ minutes to find out a check failed — and felt the friction.
- **Helpful:** You've seen (or been the person who said) "just re-run it, that test is flaky."

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Gate** | Any check, approval, or threshold that can *block* a change from moving forward (merging, deploying). |
| **Speed** | How fast and how often you can ship a change. Hurt by slow or numerous gates. |
| **Safety** | How reliably you catch real problems before they reach users. |
| **Fast feedback** | Finding out something is wrong *quickly* and *early* — seconds in your editor, not 40 minutes into CI. |
| **Shift-left** | Moving a check *earlier* in the process (editor → pre-commit → PR → staging → prod), where it's cheaper to fix. |
| **Feedback loop** | The cycle of *make a change → run a check → learn the result*. Shorter is better. |
| **False positive** | A gate that fails when nothing is actually wrong (a "false alarm"). |
| **False negative** | A gate that passes when something *is* actually wrong (it missed a real bug). |
| **Flaky** | A check that passes or fails randomly on the *same* code, for no real reason. |
| **Gate owner** | The person or team responsible for a gate — keeping it healthy and deciding if it stays. |
| **Defense in depth** | Layering several cheap checks that each catch *different* problems, so a miss by one is caught by another. |
| **Risk-based gating** | Matching the strictness of gates to how risky the change is (a typo vs a database migration). |
| **Admin-merge / bypass** | Overriding the gates to merge anyway. A signal — see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md). |

---

## Core Concept 1 — Every Gate Has a Cost

The first instinct everyone has is wrong: that gates are free safety. They are not. **A gate's cost is paid by every person on every change, every time, forever.** A check that adds three minutes to the pipeline isn't a one-time three minutes — it's three minutes × (every PR your team will ever open). At 30 PRs a week, that's 90 minutes a week, ~75 hours a year, for *one* check.

A gate has at least three kinds of cost:

- **Time cost** — how long it makes people wait. A 40-minute pipeline means a 40-minute gap between "I'm done" and "I know if I'm done."
- **Friction cost** — annoyance and interruption. A gate that requires chasing a reviewer, filling a form, or fixing a nitpick breaks flow even when it eventually passes.
- **False-alarm cost** — when the gate fails but nothing was actually wrong. Every false alarm costs investigation time *and* erodes trust (more on this in Concept 4).

Against those costs sits the **benefit**: the real problems the gate catches that would otherwise reach users. The whole discipline of gate design is one comparison:

> **Key insight:** A gate earns its place only when its **benefit** (real problems caught × how bad they'd be) is clearly larger than its **cost** (time + friction + false alarms, paid on every change forever). If a gate has never caught a real problem in six months but adds five minutes to every build, it is not "extra safety" — it is pure cost, and you should fix it or delete it.

Here's the same idea as a rough table. The point isn't the exact numbers — it's learning to *think* in this shape:

| Gate | Time it adds | Real problems it catches | Worth it? |
|---|---|---|---|
| Linter / formatter | ~10 sec | Style noise, some real bugs (unused vars, `==` vs `===`) | **Yes** — tiny cost, runs anywhere |
| Unit tests | ~1–2 min | Logic bugs, regressions | **Yes** — high catch rate, fast |
| Integration tests | ~5–10 min | Bugs across components, DB/API breakage | **Usually** — slower, but catches what units can't |
| Full end-to-end suite on every PR | ~30–40 min | Rare whole-system bugs | **Often no on *every* PR** — huge cost; run on a schedule or pre-release |
| "Must link a Jira ticket" check | ~30 sec of human friction | Process compliance, not bugs | **Maybe** — depends if anyone uses the link |
| A scan that's failed once in a year | ~4 min | ~0 real problems | **No** — almost pure cost |

Notice the bottom rows. The same *kind* of check (a scan, a test suite) can be clearly worth it or clearly not, depending entirely on its cost-to-benefit ratio *for your team*. Gate design is not "good gates vs bad gates" — it's "is *this* gate worth *this* cost *here*?"

---

## Core Concept 2 — Fast Feedback and Shift-Left

If gates cost time, the obvious move is to make them *fast* — and to run them as *early* as possible, where mistakes are cheapest to fix. These two ideas — **fast feedback** and **shift-left** — are the most important levers a junior engineer has.

**Fast feedback** means shrinking the gap between "I made a mistake" and "I find out." The cost of a bug grows the later you catch it:

```
WHERE you catch a typo'd variable name        COST to fix
  your editor (red squiggle)        →  2 seconds, you just fix it
  a pre-commit hook                 →  20 seconds, before it leaves your machine
  PR CI (after 8-min pipeline)      →  10 minutes + a new commit + re-run CI
  staging (manual tester finds it)  →  hours + a bug report + redeploy
  production (a user finds it)       →  an incident, possibly customer impact
```

The *exact same bug* costs 2 seconds in one place and an incident in another. The only thing that changed is *when* it was caught. That ladder is why fast, early checks are so valuable: catching the same thing earlier is pure profit.

**Shift-left** is the deliberate practice of moving each check as far toward the start ("left") of that ladder as you can. "Left" is earlier; "right" is closer to production.

```
   EDITOR  →  PRE-COMMIT  →  PR / CI  →  STAGING  →  PRODUCTION
   cheapest                                          most expensive
   fastest                                           slowest
   ← shift-left: move checks this way when you can
```

Concretely, shift-left looks like:

- Running the linter and formatter **in your editor**, not waiting for CI to tell you about a missing semicolon.
- A **pre-commit hook** that runs the fast checks before a commit even exists, so trivially broken code never reaches the PR.
- Running the **unit tests locally** before you push, so you don't burn a CI cycle discovering a failure you could've found in 30 seconds.

> **Key insight:** A check that runs in 30 seconds locally is *far* cheaper than the identical check that fails after a 40-minute pipeline — same bug, but one wastes 30 seconds and the other wastes most of an hour and a context-switch. When you design gates, ask not just *"should this check exist?"* but *"what's the earliest, cheapest place it can run?"* Shifting a check left often keeps all the safety while cutting most of the cost.

A subtlety: shift-left doesn't mean *delete* the later check. The CI run still enforces the linter for people who skipped the hook. It means the *common case* — you, doing your job — gets the answer in seconds, while the gate still guarantees the rule for everyone.

---

## Core Concept 3 — Every Gate Needs an Owner and a Purpose

A gate with nobody responsible for it rots. Tests start failing for unclear reasons, nobody's sure if the failure is real, and the default becomes "re-run it" or "click bypass." Within months you have a gate that blocks people without protecting anyone.

So a healthy gate has three things attached to it:

1. **A purpose** — one sentence: *what real problem does this catch?* If you can't write that sentence, the gate probably shouldn't exist. "We've always had it" is not a purpose.
2. **An owner** — a named person or team responsible for keeping it healthy: fixing it when it breaks, tuning it when it's noisy, and deciding when it's no longer worth keeping. A gate everyone uses but nobody owns is an orphan.
3. **Evidence it works** — ideally, some sense of whether it actually catches anything. Even rough: "the security scan flagged three real vulnerabilities last quarter" tells you it's earning its place. "I can't remember it ever finding anything" is a warning sign.

You don't need a heavyweight process for this as a junior. You just need the *habit* of asking, when you meet a gate: *Why is this here? Who looks after it? Does it actually catch things?*

> **Key insight:** "Required" is not a reason — it's a setting. The reason has to come from a *purpose* (what it catches) and an *owner* (who keeps it honest). When you find a gate with neither — a check nobody can explain and nobody maintains — you've found a strong candidate for deletion, not a sacred rule.

A tiny template some teams attach to each gate:

```
GATE: integration-tests
  Purpose:  catches bugs where two services break each other (auth + billing)
  Owner:    platform team (#platform-oncall)
  Blocks:   merge to main
  Evidence: caught 4 real breakages in the last quarter; flaky rate < 1%
```

That's it. If a gate can't fill in those four lines, it's a liability dressed up as a safeguard.

---

## Core Concept 4 — The Flaky or Pointless Gate

This is the failure mode that quietly destroys trust in your *entire* system of gates, so it deserves its own concept. There are two villains, and they cause the same damage.

**The flaky gate** fails randomly on code that is actually fine. A test that passes 95% of the time and fails 5% for no real reason — a timing issue, a shared test database, a network blip — is *flaky*. It's a **false positive** machine: it cries wolf. The first time it fails, you investigate. The third time, you re-run it. By the tenth, you've learned a lesson the gate is *teaching* you: **its red doesn't mean anything.** And once you've learned to ignore *this* red, you start ignoring red in general — including the day it's a real bug.

**The pointless gate** never catches anything real. It passes on good code and bad code alike — a **false negative** machine that provides theater, not safety. A coverage gate set to 10% when you're already at 80% never blocks anything meaningful. A "linter" configured with all the useful rules disabled. It costs time and adds a green checkmark that *feels* like safety but isn't.

Both train the same dangerous reflex: **route around the gates.** People learn that the gates are obstacles, not protection, so they reach for admin-merge, force-push, "just approve it," or disable-and-forget. And here's the part that's genuinely counterintuitive:

> **Key insight:** A gate nobody trusts is *worse* than no gate at all. No gate at least leaves people alert and careful. A flaky or pointless gate gives a false sense of safety (the green checkmark) *and* trains everyone to ignore your warnings *and* costs time on every run. It's negative on all three axes. The correct response to a flaky or pointless gate is not "live with it" — it's **fix it or remove it.** A loud, unreliable alarm is more dangerous than no alarm, because people stop hearing it.

Practically, when you meet a check that fails randomly:

- **Don't normalize the re-run.** Every "just re-run it, it's flaky" is the gate failing at its one job.
- **Quarantine, then fix or delete.** A flaky test should be marked non-blocking *and* tracked for repair — not left blocking-but-ignored, which is the worst state. (Quarantine is a stopgap, not a home.)
- **Treat flakiness as a real bug**, because it is one — usually in the test, not the code.

When you meet a gate that never seems to catch anything, the question to raise (kindly) is: *what does this protect us from, and when did it last do that?* If nobody can answer, that's not a check — it's a tax.

---

## Core Concept 5 — Defense in Depth, Not Pointless Redundancy

If one perfect gate could catch everything, you'd run just that. None can. So good systems use **defense in depth**: several *cheap, fast* layers, each catching a *different kind* of problem, so something that slips past one layer gets caught by the next.

A typical layered set, ordered cheapest-first:

```
  lint / format     →  catches style + trivial bugs (unused vars, bad syntax)   ~10s
  unit tests        →  catches logic bugs in single functions/modules           ~1–2m
  integration tests →  catches bugs WHERE components meet (DB, API, services)    ~5–10m
  canary / staged   →  catches problems only real traffic reveals (perf, edge)   live
```

The key word is **different**. Each layer catches things the others *can't*: a unit test won't notice your service can't reach the database; an integration test won't notice a single function's off-by-one as precisely as a unit test will. Layering them means a bug has to slip past *several different kinds* of check to reach users. That's real, earned safety.

The trap is mistaking **redundancy** for depth. If two gates check the *same thing* in the *same way*, the second one adds cost without adding safety — it's not a second layer, it's the first layer paid for twice. Running the full end-to-end suite on every commit *and* on every PR *and* nightly, all testing identical paths, is redundancy. Three reviewers who all skim the same diff is redundancy. More copies of the same check is not "more defense" — it's more cost.

> **Key insight:** Defense in depth means *different cheap checks catching different problems*, not *the same expensive check run more times*. Before adding a layer, ask: *what does this catch that my existing gates miss?* If the honest answer is "nothing — it just double-checks what lint already caught," it's redundancy, and redundancy is pure cost wearing a safety costume.

A useful way to picture it: each layer is a net with holes of a different shape and size. Stack nets with *different* holes and almost nothing gets through. Stack ten *identical* nets and you've just made the same holes ten times more expensive.

---

## Core Concept 6 — Match the Gate to the Risk

Here's the last big idea, and it's the one that breaks the "everything is required" reflex: **not all changes are equally risky, so they shouldn't all face the same gates.** This is **risk-based gating**.

Consider two pull requests:

- **PR A:** fixes a typo in a help-text string. Worst case if it's wrong: a slightly worse sentence. Trivial to revert.
- **PR B:** a database migration that alters a production table millions of users depend on. Worst case if it's wrong: data loss, downtime, an incident that can't be cleanly undone.

If your system forces *both* through the exact same gauntlet — same reviewers, same full test suite, same approvals — you've made a double mistake. PR A is paying for safety it doesn't need (slow, annoying, for a typo). And PR B might *not be getting enough* — a migration arguably deserves *extra* scrutiny (a DBA review, a rollback plan, a staging dry-run) that a one-size-fits-all pipeline never asked for.

> **Key insight:** Strictness should scale with *blast radius* — how bad it is if this change is wrong, and how hard it is to undo. A reversible, low-impact change (config tweak, doc fix, copy change) should sail through cheap, fast gates. A high-impact, hard-to-reverse change (schema migration, auth logic, payment flow) deserves heavier gates *and* should accept the extra friction gladly. Treating a typo and a migration identically is how you get pipelines that are *both* too slow for small changes *and* too weak for dangerous ones.

You don't have to build a fancy risk engine to use this. Even simple, human versions help:

- A `docs/` or copy-only change might skip the heavy integration suite.
- Touching files in a `payments/` or `migrations/` directory might *require* an extra reviewer or a senior approver.
- A revert of a known-bad change might be fast-tracked (it's *reducing* risk, not adding it).

The underlying shift is from *"every change is the same"* to *"how risky is this particular change, and what gates does that risk justify?"* That's also exactly the logic behind setting different coverage and quality thresholds for different code — see [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/junior.md).

---

## Real-World Examples

**1. The 45-minute pipeline nobody trusts.** A team accreted fourteen required checks over two years, three of them flaky. The median time from "PR opened" to "merged" hit four hours, and engineers routinely pinged a lead to admin-merge past the flaky checks. An audit found that two of the slowest checks (a full E2E suite and a redundant security re-scan) had caught *zero* real problems in a year. They moved E2E to a nightly schedule and deleted the redundant scan. Pipeline time dropped to 11 minutes, admin-merges nearly vanished, and — the point — *safety went up*, because people stopped routing around the gates that actually mattered. Slower and noisier did not mean safer.

**2. Shift-left saving a sprint's worth of CI.** A frontend team's formatter and linter only ran in CI, so a third of PRs failed their *first* CI run on pure formatting — an 8-minute wait to learn a quote should've been a backtick. They added an editor integration and a pre-commit hook. The same rules, moved left, eliminated almost all formatting-only CI failures. Nobody lost any safety (CI still enforced the rules); everybody got the answer in milliseconds instead of minutes.

**3. The flaky test that hid a real one.** An integration test failed ~1 in 8 runs due to a shared test database. The team's habit became "integration red? re-run it." One Tuesday it went red because of an *actual* bug — a broken auth check. Three engineers re-ran it on reflex before someone read the failure. The flaky gate hadn't just wasted time; it had *trained the team to ignore the exact signal* that was, this time, telling the truth. They fixed the test isolation that week.

**4. Risk-based gating on migrations.** After a migration caused two hours of downtime, a team added one rule: PRs that touch the `migrations/` directory require a second senior approval *and* a filled-in rollback plan. Every other PR kept its normal, fast gates. They didn't slow everything down to prevent a rare-but-severe event; they put the *extra* gate exactly where the *blast radius* was largest, and left the typo fixes fast.

---

## Mental Models

- **A gate is a tax, not a gift.** Free safety doesn't exist. Every gate charges time and friction on *every* change forever. Like any tax, it's justified only if you're getting enough back. "We could add a check" is never the question; "is this check worth what it'll cost us on every PR for the next two years?" is.

- **The feedback ladder: catch it lower, pay less.** Editor < pre-commit < CI < staging < production. The same bug gets exponentially more expensive as it climbs. Shift-left is just "push the catch as low down the ladder as it'll go."

- **A flaky alarm is worse than no alarm.** A smoke detector that shrieks at toast gets the battery pulled — and then it's silent during a real fire. A flaky gate trains people to ignore red, so it fails you precisely when it's finally right. Fix it or remove it; "live with the flake" is the trap.

- **Nets with different holes.** Defense in depth = stacking nets whose holes are *different shapes*, so almost nothing falls through all of them. Ten identical nets just make the same holes ten times more expensive — that's redundancy, not depth.

- **Match the lock to the door.** You don't put a bank vault door on a broom closet, or a screen door on a vault. Strictness should scale with what's behind the door — blast radius. A typo gets a light gate; a payments change gets the vault.

---

## Common Mistakes

1. **Treating gates as free safety.** Adding a check *feels* costless because the cost is hidden and spread across everyone, forever. It isn't free — it's a recurring tax. Every gate must justify its cost, not just sound like a good idea.

2. **"Everything is required."** Making every check blocking, on every change, regardless of risk. This produces slow, brittle pipelines where half the checks don't matter — and trains people to bypass the whole set to get anything done.

3. **Running a check only in CI when it could run in your editor.** Waiting 8 minutes to learn about a missing semicolon is a self-inflicted wound. If a check *can* shift left (lint, format, fast unit tests), the slow CI-only version is wasting your time on every PR.

4. **Living with flaky gates.** "Just re-run it" is not a workaround — it's the gate failing at its one job and training you to ignore red. A flaky gate is a real bug. Quarantine and fix it, or remove it; don't normalize the re-run.

5. **Keeping pointless gates because removing them feels risky.** A gate that has never caught anything in a year isn't protecting you; it's a tax with a green checkmark. "We've always had it" is not a purpose. Deleting a useless gate *increases* trust in the ones that remain.

6. **Confusing redundancy with defense in depth.** Running the same test suite three times, or stacking three reviewers who skim the same diff, adds cost without adding coverage. Real depth means *different* checks catching *different* problems — ask "what does this catch that the others miss?"

7. **One-size-fits-all gates.** Forcing a doc typo and a database migration through the identical gauntlet. The typo overpays and the migration may be *under*-protected. Scale strictness to blast radius.

8. **Designing gates with no owner.** A gate nobody maintains rots into flakiness and irrelevance. If you can't name who owns a gate and what it catches, it's an orphan heading for the "ignore it" pile.

---

## Test Yourself

1. A check adds 4 minutes to a pipeline your team runs 40 times a week. In one sentence, why is "it's only 4 minutes" the wrong way to think about its cost?
2. Define **shift-left** in one sentence, and give one concrete example of shifting a check left.
3. Your team has an integration test that fails about 1 in 10 runs on unchanged code, and everyone's habit is to just re-run it. Why is this *worse* than not having the test at all?
4. What three things should every healthy gate have attached to it?
5. A teammate wants to add the full end-to-end suite as a *fourth* place it runs (it already runs nightly, on PRs, and on merge — all testing the same paths). Is this defense in depth or redundancy? Why?
6. PR A fixes a typo in help text; PR B alters a production database table. Should they face the same gates? What principle decides this, and what's the word for it?
7. You find a required check that nobody can explain and that hasn't failed in over a year. What's the right move, and why isn't "leave it, just in case" a good answer?

<details>
<summary>Answers</summary>

1. Because the cost isn't 4 minutes once — it's 4 minutes × *every run forever* (here ~160 min/week, ~130 hours/year), paid by everyone, so it must catch enough real problems to be worth that recurring tax.
2. **Shift-left** means moving a check *earlier* (and cheaper) in the path from editor → pre-commit → CI → staging → production, where mistakes cost far less to fix. Example: run the linter in your editor / a pre-commit hook instead of only in CI.
3. A flaky gate is a false-positive machine that trains everyone to ignore its red — so it gives a false sense of safety, wastes time on every run, *and* fails you on the day the red is finally a real bug. No gate at least keeps people alert; a distrusted gate is negative on every axis.
4. A **purpose** (what real problem it catches), an **owner** (who keeps it healthy and decides if it stays), and **evidence it works** (some sign it actually catches things).
5. **Redundancy.** It re-runs the *same* check on the *same* paths, adding cost without catching anything the existing runs miss. Defense in depth requires *different* checks catching *different* problems.
6. **No.** Strictness should scale with **blast radius** — how bad it is if the change is wrong and how hard it is to undo. The typo deserves light, fast gates; the migration deserves heavier scrutiny (extra reviewer, rollback plan). The principle is **risk-based gating**.
7. **Fix it or remove it** — here, almost certainly remove it (or at least make it non-blocking and find an owner). "Just in case" isn't a purpose; a gate that catches nothing is pure cost *and* it dilutes trust in the gates that do matter. Deleting useless gates makes the remaining ones more credible.

</details>

---

## Cheat Sheet

```
THE CORE TRADE-OFF
  more gates  →  more SAFETY (problems caught)  BUT  less SPEED (slower, more friction)
  you can't max both. each gate must EARN its place.

A GATE'S COST (paid on EVERY change, FOREVER)
  time      = how long people wait
  friction  = annoyance / interruption / chasing approvals
  false alarm = fails when nothing's wrong → wastes time + erodes trust
  keep it only if  benefit (real problems caught) >> cost

THE FEEDBACK LADDER (catch lower = pay less)
  editor → pre-commit → PR/CI → staging → production
  cheap/fast ............................. expensive/slow
  SHIFT-LEFT = push each check as low down this ladder as it'll go

EVERY HEALTHY GATE HAS
  purpose  = one sentence: what real problem does it catch?
  owner    = who keeps it honest / decides if it stays
  evidence = does it actually catch anything?

THE FLAKY / POINTLESS GATE
  flaky    = fails randomly on good code (false positives) → cry-wolf
  pointless= never catches anything (false negatives) → theater
  both     = train people to IGNORE red and ROUTE AROUND gates
  rule: a gate nobody trusts is WORSE than no gate → FIX or REMOVE

DEFENSE IN DEPTH vs REDUNDANCY
  depth     = DIFFERENT cheap checks catching DIFFERENT problems  ✓
              lint → unit → integration → canary
  redundancy= the SAME check run more times                       ✗ (pure cost)
  test before adding: "what does this catch the others MISS?"

RISK-BASED GATING (match gate to blast radius)
  typo / docs / config  → light, fast gates
  migration / auth / pay → heavier gates, extra review, rollback plan
  NOT everything needs to block.
```

---

## Summary

- Gates trade **speed against safety**, and you can't maximize both. Every gate buys some safety and spends some speed — so each one must **earn its place**.
- **Every gate has a cost** — time, friction, and false alarms — paid by everyone on every change *forever*. A gate is worth keeping only when the real problems it catches clearly outweigh that recurring cost.
- **Fast feedback** and **shift-left** are your best levers: catch the same bug earlier and cheaper. The feedback ladder runs editor → pre-commit → CI → staging → production, and the cost of a bug grows the higher it climbs. Push checks as far left as they'll go.
- Every healthy gate has a **purpose**, an **owner**, and some **evidence it works**. "Required" is a setting, not a reason.
- The **flaky or pointless gate** is the silent killer: it trains people to ignore red and route around your gates, giving false safety while costing time. A gate nobody trusts is *worse* than no gate — **fix it or remove it**.
- **Defense in depth** means *different* cheap checks catching *different* problems (lint → unit → integration → canary), not the *same* expensive check run more times — that's just redundancy wearing a safety costume.
- **Match the gate to the risk:** a typo and a database migration should not face the same gauntlet. Scale strictness to blast radius. Not everything needs to block.

You now have the lens: stop asking "is this check good?" and start asking "is this check worth its cost, and is this the cheapest place to run it?" That single shift turns a pile of well-meaning checks into a system that's both fast *and* safe.

---

## Further Reading

- *Continuous Delivery* (Humble & Farley) — the foundational text on fast feedback and the deployment pipeline; read the chapters on the commit stage and the pipeline as the route to production.
- *Accelerate* (Forsgren, Humble & Kim) — the DORA research showing that *speed and stability rise together* in elite teams; the data behind "fast feedback makes you safer, not riskier."
- [Google Engineering Practices](https://google.github.io/eng-practices/) — Google's code-review and small-CL guidance; a practical view of keeping gates fast and human.
- [Google Testing Blog — flaky tests](https://testing.googleblog.com/) — why flakiness is a first-class problem and how to attack it.
- The [middle.md](middle.md) of this topic, which puts numbers on this: measuring gate value (catch rate, flake rate), pipeline stage design, and quantifying the speed/safety trade-off.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/junior.md) — the individual gates this page teaches you to evaluate as a *set*.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/junior.md) — applying "match strictness to risk" to coverage numbers specifically.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md) — what happens when gates are too slow or untrusted: people route around them.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — how to *measure* speed and stability together, so you can tell if your gates help or hurt.
- [Testing](../../testing/) — the test types (unit, integration, end-to-end) that make up most of your gate layers.
