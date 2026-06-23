# Branch Protection & Merge Policies — Junior Level

> **Roadmap:** [Quality Gates](../README.md) → Branch Protection & Merge Policies
> *Anyone with write access to a repo can technically destroy `main` with one command. Branch protection is the set of rules that quietly makes that impossible — and turns `main` from a free-for-all into a guarded destination that every change has to earn its way into.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why `main` Needs a Guard](#core-concept-1--why-main-needs-a-guard)
5. [Core Concept 2 — The Branch-Protection Checkboxes, One by One](#core-concept-2--the-branch-protection-checkboxes-one-by-one)
6. [Core Concept 3 — CODEOWNERS: Who Has to Say Yes](#core-concept-3--codeowners-who-has-to-say-yes)
7. [Core Concept 4 — Merge Strategies: Three Ways to Land a PR](#core-concept-4--merge-strategies-three-ways-to-land-a-pr)
8. [Core Concept 5 — The Merge Queue: Why Two Green PRs Can Still Break `main`](#core-concept-5--the-merge-queue-why-two-green-prs-can-still-break-main)
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

> Focus: **What stops a bad change from reaching `main`, and how is that enforced?**

You already know how to make a branch, commit to it, and open a pull request. So here is a question you may never have asked: what actually *prevents* you from skipping all of that and running `git push origin main` straight from your laptop?

On an unconfigured repository, the answer is **nothing**. Anyone with write access can push directly to `main`, can `git push --force` and overwrite the project's history, or can merge a pull request that no one reviewed and that failed every test. Most of the time nobody does — out of habit and good manners. But "we rely on everyone being careful" is not a system. It is the *absence* of one, and it fails the first time someone is in a hurry at 5 p.m. on a Friday.

**Branch protection** is the system. It is a set of rules your git platform — GitHub, GitLab, Bitbucket — enforces on an important branch (almost always `main`, sometimes also release branches) so that changes can only arrive in approved, tested, reviewed ways. The rules are not suggestions a human can ignore; they are enforced by the platform itself. Try to merge without the required approvals and the green **Merge** button is simply greyed out.

This page teaches you what each rule does, what it prevents, and the day-to-day workflow they create for you as a contributor — because once `main` is protected, *how you get your code in* changes, and the error you'll hit most ("this branch must not contain merge commits" or "review required from code owners") only makes sense once you know the rules behind it.

> **Mindset shift:** stop thinking of `main` as a folder you can write to. Start thinking of it as a **protected destination** — a place changes are *admitted to* after passing a checkpoint, not a place you *push to* whenever you like. The job of branch protection is to make the safe path the *only* path, so the team's ability to ship doesn't depend on everyone remembering to be careful.

---

## Prerequisites

- **Required:** You can create a branch, commit, push, and open a **pull request** (PR) on GitHub or GitLab.
- **Required:** You understand what a **merge** is — combining the changes from one branch into another.
- **Helpful:** You've seen a PR with a "Review required" or "Checks failing" banner and weren't sure who or what had to act.
- **Helpful:** You've read [01 — Required CI Checks](../01-required-ci-checks/junior.md), since branch protection is *how* those checks get enforced. (If not, the short version is below.)

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Branch protection** | Platform-enforced rules on a branch (e.g. `main`) controlling how changes may reach it. |
| **Pull request (PR)** | A proposal to merge one branch into another, with a place for review, discussion, and checks. (GitLab calls it a *merge request* / MR — same thing.) |
| **Direct push** | Running `git push` straight to a branch, bypassing any PR. Protection usually forbids this on `main`. |
| **Force-push** | `git push --force` — overwrites the remote branch's history instead of adding to it. Dangerous on shared branches. |
| **Approving review** | A reviewer clicking "Approve" on a PR. Protection can require *N* of them. |
| **Status check** | An automated result reported on a commit (a test job, a linter, a build) — pass or fail. |
| **CODEOWNERS** | A file mapping paths in the repo to the people/teams responsible for them. |
| **Squash / rebase / merge commit** | The three ways a PR's commits get written into the target branch (see Core Concept 4). |
| **Up to date** | A branch that already contains the latest commits from `main`. |
| **Merge queue** | A line that takes "ready" PRs one at a time, re-tests each against the latest `main`, then merges. |
| **Stale approval** | An approval given on an earlier version of the PR, before newer commits were pushed. |

---

## Core Concept 1 — Why `main` Needs a Guard

`main` is special because it is the branch everything else trusts. People branch *off* it expecting it to work. Your CI deploys *from* it. New teammates clone it and assume it builds. The moment `main` is broken, that trust breaks for everyone at once — every new branch starts from a broken base, and the whole team slows down until it's fixed.

So the goal of branch protection is narrow and concrete: **`main` should always be reviewed, tested, and intact.** Three specific bad things must become impossible:

```
WITHOUT PROTECTION                          WHAT IT CAUSES
  git push origin main          ───────►    untested code lands directly, no review
  git push --force origin main  ───────►    history rewritten; others' clones break
  merge a red, unreviewed PR    ───────►    main is broken for the whole team
```

Notice these are not hypothetical. Every one of them is a single command or a single button-click away on an unprotected repo. Branch protection's entire purpose is to turn each of those one-step disasters into something the platform refuses to do.

It is worth being precise about *who* protection is for. It is **not** mainly about malicious actors — it's about ordinary people on ordinary days: the rushed push, the wrong branch, the "I'll just merge it, the tests are probably fine." Protection removes the *opportunity* to make those mistakes, which is far more reliable than asking everyone to never make them.

> **Key insight:** branch protection is a **guardrail, not a punishment**. It exists so that no single person — including you, including the most senior engineer — can break the shared branch through haste or accident. The rules apply to everyone precisely because *everyone* is occasionally careless, and `main` cannot afford it.

---

## Core Concept 2 — The Branch-Protection Checkboxes, One by One

On GitHub, branch protection lives under **Settings → Branches → Add branch ruleset** (or the older **Branch protection rules**). You specify a branch name pattern — for example `main` — and then tick a list of rules. Here is what that screen offers, in plain terms, and what each one *prevents*. This is the heart of the topic, so read it slowly.

```text
Branch name pattern:  main

[x] Require a pull request before merging
      [x] Require approvals:                  [ 1 ]
      [x] Dismiss stale pull request approvals when new commits are pushed
      [x] Require review from Code Owners
[x] Require status checks to pass before merging
      [x] Require branches to be up to date before merging
      ── required checks ──
      [x] build
      [x] test
      [x] lint
[x] Require conversation resolution before merging
[x] Require linear history
[ ] Require deployments to succeed before merging
[x] Do not allow bypassing the above settings
── rules applied to everyone, including admins ──
[x] Block force pushes
[x] Restrict deletions
[ ] Restrict who can push to matching branches   (→ named people/teams only)
```

Taken one at a time:

- **Require a pull request before merging.** No direct pushes to `main`. Every change has to arrive through a PR, which is the place review and checks happen. This single rule is the foundation; everything else builds on it. After it's on, `git push origin main` is rejected by the server.

- **Require approvals: N.** A PR cannot merge until *N* people click "Approve." `1` is the common minimum for small teams; `2` is typical for high-risk repos. *Prevents:* code reaching `main` that no other human has looked at.

- **Dismiss stale approvals when new commits are pushed.** If a reviewer approves, and then you push *more* commits, the old approval is thrown away and you need a fresh one. *Prevents:* "they approved version 1, but version 5 is what actually merged" — a classic way for unreviewed code to sneak in.

- **Require review from Code Owners.** If the PR touches files that have an owner (see Core Concept 3), the *owner* of those files must approve, not just any teammate. *Prevents:* someone unfamiliar with a critical area (say, payments) merging a change to it without the responsible team weighing in.

- **Require status checks to pass.** The PR can't merge until the named automated checks — your `build`, `test`, `lint` jobs — report green. *Prevents:* merging code that fails to compile or breaks tests. (This is the enforcement mechanism for [01 — Required CI Checks](../01-required-ci-checks/junior.md); branch protection is *where* a check becomes "required.")

- **Require branches to be up to date before merging.** Your PR branch must contain the latest `main` before it can merge — so the checks ran against what `main` *actually* looks like now, not a stale snapshot. *Prevents:* merging something tested against an old `main` that has since changed. (This rule is also exactly what the merge queue automates — Core Concept 5.)

- **Require conversation resolution.** Every review comment thread must be marked "Resolved" before merge. *Prevents:* shipping while a reviewer's "wait, is this a bug?" comment is still open and unanswered.

- **Require linear history.** Forbids merge commits on `main`, forcing squash or rebase merges so history stays a straight line. *Prevents:* a tangled, hard-to-read commit graph. (More on this in Core Concept 4.)

- **Block force pushes.** No `git push --force` to `main`, ever. *Prevents:* history being rewritten under everyone's feet — the change that makes other people's clones suddenly diverge and break.

- **Restrict deletions.** `main` cannot be deleted. *Prevents:* the obvious catastrophe, usually an accident.

- **Restrict who can push.** Optionally, only named people or teams may push/merge to the branch at all. *Prevents:* unauthorized merges on especially sensitive branches (release branches, for instance).

- **Do not allow bypassing / apply to admins.** Crucially, ticking this makes the rules bind **even repository admins**. Without it, an admin can quietly merge around every rule above. *Prevents:* the "rules for thee, not for me" loophole that hollows out the whole system. (The *deliberate*, audited way to bypass is a separate, controlled mechanism — see [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md).)

> **Key insight:** each checkbox closes exactly one hole. Don't memorize them as a blob — read each as *"what one bad outcome does this make impossible?"* "Require approvals" → no unreviewed code. "Block force pushes" → no rewritten history. "Require status checks" → no broken builds. When you understand them that way, the right configuration for a given repo becomes obvious.

The same ideas exist on GitLab under **Settings → Repository → Protected branches** (set "Allowed to push" to *No one* and "Allowed to merge" to a role), plus **Merge request approvals** and **CODEOWNERS** — different labels, identical concepts.

---

## Core Concept 3 — CODEOWNERS: Who Has to Say Yes

"Require approvals: 1" means *someone* must approve — but it doesn't care *who*. For most files that's fine. For some files it isn't: a change to the billing logic, the authentication code, or the database migrations should really be looked at by the people who *own* that area, not whoever happens to be free.

**CODEOWNERS** is a plain text file that maps paths in your repository to the people or teams responsible for them. You commit it like any other file (usually at `.github/CODEOWNERS`, or repo root, or `docs/`). Each line is a path pattern followed by one or more owners:

```text
# .github/CODEOWNERS
# Each line: <path pattern>  <owner> [more owners...]
# Later matches win, so put the most specific rules at the bottom.

# Default owner for everything not matched below:
*                       @acme/platform-team

# Frontend
/src/web/               @acme/frontend
*.css                   @acme/design-systems

# The money. Changes here need the payments team's eyes.
/src/payments/          @acme/payments-team

# Auth is owned by two people specifically:
/src/auth/              @alice @bob

# Database migrations — DBA must sign off:
/db/migrations/         @acme/dba

# CODEOWNERS itself is owned by the leads (so nobody quietly edits ownership):
/.github/CODEOWNERS     @acme/eng-leads
```

CODEOWNERS does two things, and it helps to separate them:

1. **Auto-request, always.** Whenever a PR touches a matched path, the listed owners are *automatically added as reviewers*. The right people get pinged without the author having to know who to ask. This happens even on an unprotected repo — it's just a convenience.

2. **Require their approval — only if branch protection says so.** When you tick **"Require review from Code Owners"** in branch protection, the auto-request becomes a *gate*: the PR cannot merge until each affected owner approves. Touch `/src/payments/` and the `@acme/payments-team` approval is now mandatory, no matter how many other people approved.

A few rules that trip people up: the syntax is gitignore-style globbing, **the last matching line wins** (so general rules go on top, specific ones at the bottom), and a team only counts as an owner if its members have access to the repo. If a PR touches three owned areas, *all three* owners must approve before it can merge.

> **Key insight:** "require approvals" asks *"did enough humans look?"*; CODEOWNERS asks *"did the **right** humans look?"* The first is about quantity, the second about expertise. Critical areas — money, auth, data, infrastructure — almost always want the second, so that the people who'll be paged when it breaks are the ones who approved it.

---

## Core Concept 4 — Merge Strategies: Three Ways to Land a PR

When a PR is approved and green, clicking **Merge** writes its commits into `main`. There are **three** ways to do that, and they differ in what the history of `main` ends up looking like. Most teams pick **one** and enforce it (often via "Require linear history"), so you usually just follow the team's choice — but you should know what each does.

Say your PR has three messy commits: `wip`, `fix typo`, `actually fix it`.

**1. Create a merge commit** (`--no-ff`). Keeps all three of your commits *and* adds a fourth "merge commit" that ties your branch back into `main`.

```text
main:  …──A──B────────────M       ← M is the merge commit
                \         /
   your branch:  wip─typo─fix
```

*Result:* full history preserved, including every messy step. The graph has branches and merges in it. Honest, but noisy.

**2. Squash and merge.** Collapses all three commits into **one** new commit on `main`, with a single tidy message you write (usually the PR title).

```text
main:  …──A──B──S                 ← S = one clean commit = the whole PR
```

*Result:* one commit per PR. `main`'s history reads like a changelog — one line per feature/fix — and the `wip`/`typo` noise disappears. **This is the most common default**, and a good one for juniors to assume unless told otherwise.

**3. Rebase and merge.** Replays your three commits *on top of* `main` individually, with no merge commit.

```text
main:  …──A──B──wip'──typo'──fix' ← your 3 commits, linear, no merge node
```

*Result:* a straight line that keeps each individual commit. Cleaner graph than a merge commit, but only worth it if your individual commits are themselves meaningful.

| Strategy | Commits on `main` per PR | History shape | Good when |
|---|---|---|---|
| **Merge commit** | All of them + a merge node | Branchy graph | You want the complete, literal history |
| **Squash** | **One** | Straight line, one-per-PR | You want a tidy, readable `main` (most common) |
| **Rebase** | Each commit, replayed | Straight line | Your individual commits are each clean & useful |

> **Key insight:** the merge strategy is a decision about **what `main`'s history should read like** — a tidy changelog (squash), or a complete record (merge commit). There is no universally "correct" one; there is only the one *your team chose*. As a junior, find out which it is (it's set in the repo's settings and often the only button available) and use it consistently. Don't argue the choice on day one — just follow it.

---

## Core Concept 5 — The Merge Queue: Why Two Green PRs Can Still Break `main`

Here is a subtle problem that surprises almost everyone the first time. Two PRs are both reviewed and both have **green checks**. You merge PR #1, then merge PR #2. `main` breaks. *How, when both were green?*

Because each PR's checks ran against the `main` that existed **when the checks ran** — and that's not the same `main` after the *other* PR merged.

```text
Both branch off the same main:

  PR #1:  renames the function  getUser()  →  fetchUser()
          (updates every caller it can see) ......... GREEN ✓

  PR #2:  adds new code that calls  getUser()
          (getUser still exists in PR #2's view of main) ... GREEN ✓

Merge #1, then #2:
  main now has PR #2's new call to getUser()…
  …but getUser() no longer exists — #1 renamed it.   main is BROKEN ✗
```

Each PR was tested in isolation and was genuinely fine. Their *combination* is broken, and neither set of checks could have caught it, because neither PR could see the other's changes. This is sometimes called a **semantic merge conflict** — git merges the text without complaint, but the *meaning* is broken.

The blunt fix is **"Require branches to be up to date before merging"** (Core Concept 2): before #2 can merge, it must pull in #1's changes and re-run its checks — which would now fail on the renamed function, catching the problem. But on a busy repo this turns into misery: every time *anyone* merges, everyone else's PR is out of date and must update and re-test. With ten people merging, you spend all day updating branches.

The **merge queue** automates exactly this, without the misery. Instead of merging directly, you mark a PR as ready and it joins a **queue**:

```text
Merge queue:   [ PR #1 ] → [ PR #2 ] → [ PR #3 ]
                  │            │            │
   For each, in order:
     1. take the latest main
     2. add this PR's changes on top
     3. run the required checks against THAT combination
     4. if green → merge into main;  if red → kick it out, tell the author
```

The queue processes PRs **one at a time, each tested against the real, latest `main`** (including every PR merged just ahead of it). So #2 is tested *with* #1 already applied — and the broken combination is caught *before* it reaches `main`, not after. `main` stays green continuously, and contributors don't have to manually rebase against a constantly-moving target. GitHub offers this as **merge queue**; GitLab has **merge trains**; the idea is identical.

> **Key insight:** "green in isolation" is not the same as "green when combined." Two correct changes can be wrong *together*. The merge queue exists for one reason: to test the *actual combination* that will land on `main` — latest `main` + your PR — instead of trusting checks that ran against a `main` that no longer exists. On a small, low-traffic repo you may never need it; on a busy one it's what keeps `main` from breaking several times a day.

---

## Real-World Examples

**1. The Friday-evening force-push that didn't happen.** A developer, rushing to "fix" history, types `git push --force origin main`. On an unprotected repo this would rewrite the shared history, and every teammate's next `git pull` would fail with a wall of conflicts. Here the server rejects it instantly: `remote: error: GH006: Protected branch update failed... Cannot force-push to this branch.` The "Block force pushes" checkbox turned a team-wide afternoon of cleanup into a one-line error nobody else ever saw.

**2. The payments change that got the right eyes.** A frontend engineer fixes a display bug but, in doing so, edits a file under `/src/payments/`. Because CODEOWNERS maps that path to `@acme/payments-team` and "Require review from Code Owners" is on, the PR auto-requests the payments team and *cannot merge* until they approve. They spot that the "display fix" also changed a rounding behavior in a currency calculation — exactly the kind of thing only the owning team would catch. The gate did its job: the right humans looked.

**3. The two green PRs that a merge queue saved.** On a busy service repo, PR #1 renames a config key and PR #2 starts reading that config key — both reviewed, both green, queued within minutes of each other. The merge queue tests #2 *on top of* #1, the build fails on the renamed key, and #2 is bounced back to its author with a clear message *before* `main` ever broke. Without the queue, `main` would have gone red and blocked the other dozen engineers branching off it.

---

## Mental Models

- **`main` is a building with a front desk, not an open field.** Without protection, anyone walks in and rearranges the furniture. Protection installs a front desk: you check in (open a PR), show ID (pass checks), get signed in by the right person (required + code-owner approval), and only *then* are you admitted. The rules apply to the CEO too.

- **Each checkbox plugs one leak.** Picture `main` as a boat. "Require approvals" plugs the unreviewed-code leak; "block force pushes" plugs the rewritten-history leak; "require status checks" plugs the broken-build leak. You tick the boxes for the leaks your boat actually has.

- **CODEOWNERS is a routing table for trust.** "Require approvals: 1" asks *how many* signatures; CODEOWNERS asks *whose*. It routes each part of the codebase to the people who'll be paged when it breaks — so the people approving a change are the people who'll own its consequences.

- **Squash vs merge-commit is "changelog vs diary."** Squash gives `main` a clean changelog — one readable line per PR. A merge commit gives `main` a full diary, every `wip` and `typo` included. Neither is wrong; pick the reading experience your team wants and be consistent.

- **The merge queue is a single-file turnstile.** Instead of everyone shoving through the door at once (and two people getting wedged together), PRs go through one at a time, and each is checked *against whoever just went through* — so the jam is caught at the turnstile, never inside.

---

## Common Mistakes

1. **Trying to `git push` directly to `main`.** On a protected repo this is rejected: `remote: error: GH006: Protected branch update failed`. The fix is not to fight it — it's to do what protection wants: make a branch, open a PR, get it reviewed and green, merge. If you ever feel you *need* to push to `main` directly, that's a [07 — break-glass](../07-break-glass-and-bypass/junior.md) conversation, not a `--force`.

2. **Pushing more commits and wondering why your approval vanished.** With "Dismiss stale approvals" on, every new push clears existing approvals — by design, so reviewers vouch for what actually merges. The fix is to re-request review after your final change, not to merge around it.

3. **Ignoring "this branch is out of date."** Merging a stale branch means your checks ran against an old `main`. Click **Update branch** (or the queue does it for you), let the checks re-run, *then* merge. Skipping this is how two green PRs break `main`.

4. **Editing an owned file and not understanding the new required reviewer.** If a code-owner suddenly appears as a *required* reviewer, you touched a file they own. That's expected. Don't try to remove them — get their approval; that's the whole point of CODEOWNERS.

5. **Fighting the team's merge strategy.** If the **Merge** button only offers "Squash and merge," that's the team's deliberate choice for a clean history — not a bug. Use it. Mixing strategies is what produces a messy, inconsistent `main`.

6. **Assuming admins are exempt, so the rules "don't really count."** If "Do not allow bypassing" / "apply to admins" is ticked, the rules bind *everyone*. Good teams tick it precisely so the rules are real. Don't ask an admin to merge around a gate; if a gate genuinely must be bypassed, that's the explicit break-glass path, which is *logged*.

7. **Leaving review conversations unresolved.** With "Require conversation resolution" on, an open comment thread blocks the merge. Reply, resolve, and only then merge — an unresolved thread is a reviewer's question that hasn't been answered.

---

## Test Yourself

1. On a brand-new, unconfigured repo, what's stopping you from running `git push origin main` with untested code? What rule fixes that?
2. A teammate approves your PR. You then push two more commits. With "dismiss stale approvals" on, what is now true about that approval, and why is that the safe behavior?
3. What's the difference between *requiring 1 approval* and *requiring a CODEOWNERS review*? When would you want the second?
4. Your PR has three commits: `wip`, `fix`, `done`. Under **squash and merge**, how many commits land on `main`, and what do they look like? Under a **merge commit**?
5. PR #1 and PR #2 both have green checks and both get merged, but `main` breaks. Explain how that's possible, and name the mechanism designed to prevent it.
6. You try to merge but the button is greyed out with "Required statuses must pass" and "1 review required." List what you actually need to do to merge — without bypassing anything.

<details>
<summary>Answers</summary>

1. **Nothing** stops you — on an unprotected repo, write access lets you push straight to `main`. The fix is **"Require a pull request before merging"** (plus required status checks so the PR has to be green), which makes direct pushes to `main` be rejected by the server.
2. The approval is **dismissed** — it no longer counts, and you need a fresh approval. That's safe because the reviewer only vouched for the earlier version; the two new commits are unreviewed, and without dismissal they'd merge with a stale "approved" stamp.
3. "Require 1 approval" only checks that *someone* approved (quantity). "Require CODEOWNERS review" requires the specific **owner of the affected files** to approve (expertise). You want the second for critical areas — payments, auth, migrations — where the responsible team's eyes matter, not just any teammate's.
4. **Squash:** **one** commit on `main`, a single tidy message (usually the PR title) — the `wip`/`fix`/`done` noise is gone. **Merge commit:** **all three** of your commits *plus* a fourth merge commit, so the full (messy) history and a branch/merge node are preserved.
5. Each PR's checks ran against the `main` that existed *before the other merged*, so neither saw the other's changes; combined, they conflict in meaning (a **semantic merge conflict**). The **merge queue** (GitLab: merge trains) prevents it by re-testing each PR against the *latest* `main` — including PRs just merged ahead of it — before it lands.
6. (a) Get **one approving review** (re-request if needed); (b) make the **required status checks pass** — push fixes until `build`/`test`/`lint` are green; (c) if "branch out of date," click **Update branch** and let checks re-run; (d) resolve any open conversations; (e) then click the (now enabled) **Merge** using the team's strategy.

</details>

---

## Cheat Sheet

```text
WHAT PROTECTION PREVENTS (read each box as "no more ___")
  require pull request          → no direct pushes to main
  require N approvals           → no unreviewed code
  dismiss stale approvals       → no "approved v1, merged v5"
  require CODEOWNERS review      → no merging an owned area without its owner
  require status checks pass     → no broken builds on main
  require branch up to date      → no testing against a stale main
  require conversation resolved  → no merging with open reviewer questions
  block force pushes             → no rewritten history
  restrict deletions             → main can't be deleted
  apply to admins / no bypass    → no "rules for thee, not for me"

CODEOWNERS (.github/CODEOWNERS — last match wins)
  *                  @org/platform        # default
  /src/payments/     @org/payments-team   # owned area
  /src/auth/         @alice @bob          # specific people
  → auto-requests owners; REQUIRES them only if "require code owner review" is on

MERGE STRATEGIES (commits landing on main per PR)
  merge commit  = all your commits + 1 merge node   (full diary)
  squash        = ONE clean commit                   (tidy changelog ← common default)
  rebase        = your commits replayed, linear      (clean graph, meaningful commits)

MERGE QUEUE — why two green PRs can break main
  green-in-isolation ≠ green-combined
  queue: take latest main + this PR → re-run checks → merge if green
  catches broken COMBINATIONS before they hit main

YOUR JOB AS A CONTRIBUTOR
  branch → PR → get required approvals → make checks green
  "update branch" if asked → resolve conversations → merge with the team's strategy
```

---

## Summary

- **Branch protection** is platform-enforced rules on an important branch (usually `main`) that make careless or accidental damage *impossible* rather than merely discouraged. On an unprotected repo, anyone can push directly, force-push, or merge red, unreviewed code — protection closes each of those holes.
- Read the **checkboxes** as "no more ___": require a PR (no direct pushes), require approvals (no unreviewed code), dismiss stale approvals (no approved-v1-merged-v5), require status checks (no broken builds — the enforcement of [01 — Required CI Checks](../01-required-ci-checks/junior.md)), block force pushes (no rewritten history), and apply-to-admins (no exemptions).
- **CODEOWNERS** maps paths to responsible people/teams. It always auto-requests them; with "require code owner review" on, it *requires* the right humans — not just enough humans — to approve changes to critical areas.
- **Merge strategies** decide what `main`'s history reads like: **merge commit** (full record), **squash** (one tidy commit per PR — the common default), or **rebase** (linear, individual commits). Teams pick one; you follow it.
- A **merge queue** exists because two green PRs can break `main` when combined. It tests each PR against the *latest* `main`, one at a time, so the actual landing combination is verified before it merges — keeping `main` continuously green without endless manual rebasing.
- Your contributor workflow under protection: **open a PR, earn the required approvals, make the checks green, update your branch if asked, resolve conversations, and merge with the team's strategy.** You cannot push to `main` — and that's the point.

Everything here protects the one thing a team can't function without: a `main` that is always reviewed, tested, and intact, so every person branching off it can trust it.

---

## Further Reading

- [GitHub Docs — *About protected branches*](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — the authoritative list of every rule and exactly what it enforces.
- [GitHub Docs — *About code owners*](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — CODEOWNERS syntax, file location, and matching rules.
- [GitHub Docs — *Merging a pull request with a merge queue*](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) — how the queue tests and lands PRs.
- [GitLab Docs — *Protected branches*](https://docs.gitlab.com/ee/user/project/protected_branches.html) and [*Merge trains*](https://docs.gitlab.com/ee/ci/pipelines/merge_trains.html) — the same concepts in GitLab's terms.
- The [middle.md](middle.md) of this topic, which goes deeper on rulesets vs legacy rules, required-check edge cases, bypass/admin policy, and tuning merge queues for large repos.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/junior.md) — *what* the checks are; branch protection is *how* they become required to merge.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/junior.md) — the next gate after merge: approving the *release* of what's now on `main`.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/junior.md) — the *deliberate, logged* way to get past these rules in a real emergency.
- [Code Review](../../code-review/) — branch protection *requires* review; this covers how to actually review well.
- [Release Engineering](../../release-engineering/) — how a protected, green `main` becomes a safe, shippable release.
