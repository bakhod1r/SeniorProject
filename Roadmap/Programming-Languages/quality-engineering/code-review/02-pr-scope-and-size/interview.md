# PR Scope & Size — Interview Level

> **Roadmap:** [Code Review](../README.md) → PR Scope & Size
> *A scope-and-size interview rarely asks "are small PRs good." It asks "your PR is 1,500 lines — split it," and then watches whether you can separate a refactor from a behavior change, name a real splitting pattern, and connect PR size to review latency, WIP, and revertibility. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Splitting a Big Change](#splitting-a-big-change)
5. [Flow Economics](#flow-economics)
6. [Unavoidable Big PRs](#unavoidable-big-prs)
7. [Scale & Scenarios](#scale--scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

PR size is the single highest-leverage variable in code review, and it's the one most candidates wave at with "smaller is better" and then can't operationalize. The interview probes whether you can do three things a senior engineer does reflexively: **justify** small PRs with the actual mechanism (not just a slogan), **split** a genuinely large change into reviewable pieces using a named pattern, and **diagnose** a team stuck in the big-PR/slow-review doom loop.

Each question below carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the distinctions they keep returning to:

- **refactor vs behavior change** (a pure restructuring vs a change in what the code does)
- **size as a cause vs a symptom** (a big PR is usually the *output* of slow reviews, not just sloppiness)
- **incomplete vs unmergeable** (half-finished work can ship safely behind a flag; it doesn't have to wait)
- **mechanical vs hand-written diff** (a 5,000-line codemod is reviewed differently from 5,000 hand-typed lines)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well name the distinction before reaching for a tactic.

---

## Prerequisites

To answer these well, be comfortable with:

- **The review workflow** — what a reviewer actually does, and why attention degrades over a long diff. See [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md).
- **Git mechanics** — branches, rebase, cherry-pick, and what a "stack" of commits/branches is.
- **Trunk-based development and feature flags** — merging to a shared mainline frequently, hiding unfinished work behind a runtime toggle.
- **Basic flow/queueing intuition** — that work-in-progress and cycle time are linked (Little's Law), even if you've never used the term.

If "expand-contract migration" or "branch by abstraction" are new, read [junior.md](junior.md) first; it builds the vocabulary these answers assume.

---

## Fundamentals

### Q: Why are small PRs better? Give me the mechanism, not the slogan.

> **Testing:** Whether you can name the *causal chain*, or just repeat "smaller is better."

**A.** Four distinct mechanisms, each independently real:

1. **Review quality.** Reviewer attention is a depleting resource. The data is consistent — SmartBear's Cisco study found defect-detection density falls off a cliff past roughly **400 lines** in one sitting, and review effectiveness drops further past **60 minutes**. A 1,000-line PR doesn't get reviewed 2.5× as hard as a 400-line one; it gets rubber-stamped, because the reviewer fatigues and starts skimming. Small PRs keep the whole diff inside the reviewer's working memory.
2. **Latency.** A small PR is a small ask, so it gets picked up and approved faster — often same-day instead of "I'll get to it tomorrow." That compounds (see flow economics below).
3. **Revertibility.** A small PR is a small, isolated unit you can `git revert` cleanly when it breaks in production. A 1,500-line PR that touched six subsystems can't be reverted without taking unrelated good work with it.
4. **Conflicts.** A small PR merges fast, so it spends little time diverging from `main` — fewer merge conflicts, less rebase pain for everyone else.

The slogan is "small PRs are better." The senior version is "small PRs convert reviewer attention into defect detection more efficiently, ship faster, revert cleaner, and conflict less — and those are four separate wins."

### Q: Is there a number? What's the "right" size for a PR?

> **Testing:** Whether you treat a guideline as a hard rule, or understand what the number is a proxy for.

**A.** The useful band is roughly **200–400 lines of *substantive* change** — the range where review stays attentive. Google's internal data shows the median CL is small and most are under ~250 lines, and they actively coach toward small CLs. But the number is a **proxy, not the goal**. The real target is *one reviewable logical change*. A 50-line PR touching three unrelated concerns is worse than a 350-line PR doing one coherent thing. And "lines" should exclude generated files, lockfiles, vendored code, and large fixtures — those inflate the count without costing review attention. So I'd phrase the rule as: *one logical change, ideally reviewable in one sitting under ~20 minutes*, and treat 400+ as a smell that asks "can this be split?" — not a hard gate that rejects.

### Q: What does "one logical change per PR" actually mean? Give a concrete violation.

> **Testing:** The single most important habit — separating concerns into separate PRs.

**A.** It means the PR has **one reason to exist** and one description that fully explains it. The canonical violation is mixing a **refactor with a behavior change** in the same diff. Say you rename a function across 40 files *and* fix a bug in its body in the same PR. Now the reviewer faces a 40-file diff where 39 files are noise (mechanical rename) and the one line that matters (the bug fix) is buried in it. They can't see the forest. Worse, if it breaks in prod, you can't revert the bug fix without also reverting the rename.

The fix is the **refactor-then-change split**: PR #1 is the pure rename — large but trivially reviewable because nothing *behaves* differently, so the reviewer just confirms it's mechanical. PR #2 is the one-line behavior change against the now-clean code — tiny, and the diff shows *exactly* what changed in behavior. Two PRs, each easy; one PR, impossible.

### Q: Why is separating refactoring from behavior changes so emphasized? Both are "just changes."

> **Testing:** Whether you understand the asymmetry in how the two are *reviewed* and *risked*.

**A.** Because a reviewer reviews them with completely different questions, and they carry different risk:

- A **pure refactor** asks: *"Did behavior stay identical?"* The reviewer scans for accidental semantic changes; tests passing is strong evidence. A 600-line rename can be approved in five minutes once you trust it's mechanical.
- A **behavior change** asks: *"Is the new behavior correct, and is it what we want?"* This needs real thought about edge cases, contracts, and intent.

When you mix them, every line forces the reviewer to ask *both* questions at once — "is this line a no-op refactor or a real change?" — which is cognitively expensive and error-prone. The mix is exactly where bugs hide: a "refactor" PR that quietly changes behavior on one line is the classic way a regression sneaks through review, because the reviewer's refactor-mode brain wasn't looking for it. Keeping them separate keeps the reviewer's question consistent across the whole diff. This is Kent Beck's "make the change easy, then make the easy change" — *and review them as two changes.*

### Q: A teammate says "splitting takes more of my time, just review my big PR." How do you respond?

> **Testing:** Whether you can frame the cost honestly and locate it correctly.

**A.** I'd concede the local truth and reframe the global cost. Yes — splitting costs the *author* time up front (rebasing, restructuring commits, writing several descriptions). But that cost is paid once by one person, while a big PR pushes a *larger* cost onto the reviewer (worse review under fatigue), onto production (un-revertable blast radius), and onto the whole team (merge conflicts, blocked dependents). It's a classic **local optimization that's a global pessimization**. I'd also point out the author's *own* downstream cost: a big PR sits in review longer, accrues more "while you're here" comments, and is more likely to need a painful rebase — so "just review my big PR" often ends up *slower for the author too*. The honest version isn't "splitting is free"; it's "splitting moves a small cost to the right place to avoid a large cost in the wrong places."

---

## Splitting a Big Change

### Q: Your feature genuinely needs 1,500 lines. Walk me through how you split it.

> **Testing:** The differentiator — do you have an actual method, or just "break it up somehow"?

**A.** I don't split by line count; I split along **seams of independent reviewability**. The first cut is almost always **vertical vs horizontal**:

- **Preparatory refactoring first.** Before adding the feature, I separate out any restructuring the feature *needs* into its own PR(s) — "make the change easy, then make the easy change." Often 1,500 lines is really 900 lines of refactor enabling 600 lines of actual feature. That refactor PR is mechanical and fast to review; what's left is the real change, now small.
- **Then slice the feature.** I prefer **vertical slices** — each PR is a thin end-to-end increment that's individually correct and mergeable (e.g., one endpoint, or the feature for one entity type), rather than horizontal layers (all DB, then all service, then all API) where no single PR does anything useful and the last one is a monster.
- **Bottom-up where layers are unavoidable.** If I must go by layer, I land the lower layers first behind a flag or simply unused, each with its own tests, so each PR is reviewable and the top layer that wires it up is small.

Concretely, that 1,500-line PR becomes maybe: PR1 extract/rename (refactor, 400 lines, trivial review); PR2 add the data model + repository with tests (300, behind nothing user-facing); PR3 service logic + tests (300); PR4 the API endpoint wiring it together behind a feature flag (200); PR5 flip the flag / docs (50). Five attentive reviews instead of one exhausted skim.

### Q: Name the patterns you'd reach for to make incomplete work safely mergeable.

> **Testing:** Whether you know the canonical Fowler/CD patterns by name, not just "use a flag."

**A.** The core toolkit:

- **Feature flags (feature toggles)** — merge code that's wired up but dormant; the flag keeps it off in production until it's complete and tested. This is what makes "merge half-finished work" safe.
- **Branch by abstraction** — when replacing a deeply-embedded component, introduce an abstraction layer over the old implementation, migrate callers to the abstraction (small PRs), build the new implementation behind it, switch, then remove the old. Lets a large replacement land in many small, always-green PRs instead of one long-lived branch.
- **Expand–contract (parallel change)** — for changing a contract/schema: *expand* (add the new form alongside the old), *migrate* consumers incrementally, *contract* (remove the old form). Each phase is a small PR and the system is releasable between them.
- **Strangler fig** — for replacing a whole subsystem/service: route traffic through a facade, incrementally reimplement behind it, shrink the old system to nothing. The macro version of the same idea.

All four share one principle: **decompose a big change in time so each step is independently reviewable, mergeable, and releasable** — the trunk stays green throughout. The enabling practice is **trunk-based development**: short-lived branches merged daily, incomplete work hidden by flags, rather than a long-lived feature branch that becomes one giant PR at the end.

### Q: What are stacked PRs, and why do people use them? What's the catch on GitHub?

> **Testing:** Awareness of the modern tooling answer to "small PRs are a pain to manage."

**A.** A **stacked PR** (stacked diff) is a chain of dependent PRs where each builds on the previous one's branch instead of on `main` — PR2's base is PR1's branch, PR3's base is PR2's, and so on. It lets you keep PRs small *without blocking yourself*: you don't have to wait for PR1 to merge before starting and sending PR2 for review. Reviewers see each small piece in order; when PR1 merges, the stack rebases down.

The catch: **GitHub has weak native support.** Its PR model assumes each PR targets `main`; stacking means re-pointing bases, and when the bottom merges you must manually rebase the rest, and the diffs get confusing (a PR shows the cumulative diff if based on `main` instead of the parent). This is why dedicated tooling exists — **Graphite**, **ghstack**, and **git-spice** manage the stack and the rebasing for you. Notably, **Gerrit** and **Phabricator** were built around the one-commit-one-review model from the start, which is why teams there split far more naturally — it's a tooling-shaped behavior. So the honest answer is: stacking is the right technique for keeping PRs small under dependencies, but on GitHub you need a tool, or you accept manual rebase pain.

### Q: A reviewer comments "this PR is too big, please split it." It's already written and tested. How do you actually split it now?

> **Testing:** The mechanical git skill, not just the principle — can you do it after the fact?

**A.** I'd split it without throwing away the work:

1. **Identify the seams** in my own diff — usually the refactor/behavior split, or independent vertical slices. If commits are already clean and logically grouped, this is easy; if it's one big "WIP" commit, I'll first reshape history.
2. **Reshape with git.** Create a fresh branch off `main`, then `git cherry-pick` the commits (or use `git checkout main -- <paths>` / `git restore --source` to pull specific files) that form the first independent piece. If history is messy, an interactive rebase (or `git reset` + staged re-commits via `git add -p`) lets me regroup hunks into coherent commits.
3. **Send the first PR** (the refactor or the foundational slice), get it reviewed and merged.
4. **Rebase the remainder** onto the new `main` and open the next PR — repeat. Stacked-PR tooling automates exactly this if I have it.

The key point I'd make to the reviewer: splitting after the fact is *more* work than splitting up front, which is the lesson for next time — but it's absolutely doable, and I'd never respond with "it's already done, just review it." I'd also confirm with the reviewer *where* they want the cut, since they're telling me what they can review well.

### Q: How do you decide between a feature flag and a stacked PR for incomplete work?

> **Testing:** Whether you understand they solve different problems and are often used together.

**A.** They're not alternatives — they answer different questions:

- **Stacked PRs** solve *"how do I keep reviewing/merging small pieces without blocking myself on dependencies?"* They're about the **review and merge workflow**.
- **Feature flags** solve *"how do I have merged code that isn't ready to be *active* in production?"* They're about **runtime behavior** after merge.

You use a stack to land the small pieces, and a flag so that the pieces — once on `main` — stay dormant until the whole feature is complete and safe to enable. A typical large feature uses *both*: each PR in the stack adds dormant code, the final small PR (or a config change) flips the flag on. If the work is small enough to land in one or two PRs and is harmless when merged (e.g., a new unused module), you may need neither. The flag earns its keep when "merged" and "live" must be decoupled.

---

## Flow Economics

### Q: Connect PR size to review latency to merge conflicts. Why is this a system, not three separate problems?

> **Testing:** Whether you see the feedback loop — this is the staff-level insight on the topic.

**A.** It's a reinforcing loop, and the cleanest lens is **flow/queueing** (Reinertsen, *Principles of Product Development Flow*):

- **Big PR → slow review.** A large PR is a daunting task, so it sits in the reviewer's queue longer (high latency) and gets a worse review when it's finally done.
- **Slow review → big PR.** Here's the loop. When review turnaround is slow, authors stop sending small PRs — why pay the round-trip cost five times? — and instead batch everything into one big PR to "do it all at once." So slow reviews *cause* big PRs, which cause slower reviews. This is the **doom loop**.
- **Both → merge conflicts.** A PR that lives longer (because it's big and slowly reviewed) diverges from `main` for longer, so it conflicts more — and resolving conflicts delays it further, feeding the loop again.

The unifying frame is **work-in-progress and cycle time**. Big PRs are big batches; large batches increase WIP and, by **Little's Law** (cycle time = WIP / throughput), increase cycle time. So the three "problems" are one queueing pathology: oversized batches inflating WIP and latency, with conflicts as a side effect of long residence time. You fix the *system* by shrinking the batch (small PRs) **and** tightening review SLA together — neither alone breaks the loop.

### Q: Your team's PRs are huge and reviews are slow. Diagnose and fix it.

> **Testing:** Whether you attack the loop at the right point instead of just nagging people.

**A.** First, **diagnose the direction of causation** — are PRs big because people are sloppy, or because reviews are slow? Usually it's the latter, and that changes the fix. I'd look at the data: median PR size, and median **time-to-first-review** and time-to-merge. If first-review latency is high (days), the big PRs are a *rational response* to slow reviews, and "please write smaller PRs" alone will fail — authors won't pay the round-trip five times.

So I'd break the loop at **review latency first**:
- Set a **review SLA** (e.g., first response within a few hours during the workday) and make reviewing a first-class, prioritized activity, not "when I get around to it." A "review before you start new work" norm.
- Reduce the number of required reviewers / use code owners so a PR isn't blocked waiting on three people.

*Then*, with reviews fast, **make small PRs the path of least resistance**:
- Coach the splitting patterns (refactor-first, vertical slices, feature flags).
- Adopt **stacked-PR tooling** so small dependent PRs aren't a workflow burden.
- Track **PR size as a team metric** (median + p90) on a dashboard — visibility alone moves it.

The sequencing matters: fix latency, *then* size. Pushing size first while reviews stay slow just frustrates everyone and the loop reasserts itself. (See [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md).)

### Q: How does small-PR discipline relate to blast radius and incident response?

> **Testing:** Connecting size to operability, not just to the review experience.

**A.** Directly — **PR size is blast radius**. When a change breaks production, the fastest, safest remediation is almost always **revert**, and a small PR is a small, clean, isolated revert: `git revert <sha>`, one logical change undone, nothing else affected. A 1,500-line PR that touched six subsystems is a *terrible* revert target — reverting it takes out unrelated good work, may itself conflict with later commits, and you may not even be sure which part of it caused the incident. So you end up hot-fixing forward under pressure, which is slower and riskier. Small PRs also make **bisection** trivial: when a regression appears, `git bisect` over small, single-concern commits points straight at the cause; over large mixed commits it only tells you "somewhere in these 1,500 lines." So small PRs aren't just a review nicety — they shrink **MTTR** (mean time to recovery) because they keep revert and bisect cheap. This is why mature teams treat "is this revertible?" as a review question.

### Q: Doesn't merging more small PRs just create more total review overhead?

> **Testing:** Whether you can rebut the surface-level "but it's more PRs" objection with the batch-size argument.

**A.** No — it *reduces* total cost, and the batch-size economics explain why. The objection assumes review cost is linear in PR count, but it's the opposite: review cost is **super-linear in PR size** because of fatigue. Reviewing one 800-line PR costs *more* total effort and finds *fewer* defects than reviewing two 400-line PRs, because in the big one the reviewer degrades to skimming. Splitting doesn't add work; it converts one bad expensive review into two good cheap ones. There's a small fixed per-PR overhead (CI runs, context-switch, the ceremony of opening/merging), so the curve isn't infinitely splittable — a 5-line-PR-per-change extreme has real overhead — but for any realistically large change, the fixed overhead is dwarfed by the fatigue savings. The Reinertsen framing: large batches have low *apparent* per-unit overhead but huge *hidden* costs (slow feedback, fatigue, conflicts, risk); reducing batch size trades a little visible overhead for a lot of hidden savings.

---

## Unavoidable Big PRs

### Q: Some big PRs can't be split — generated code, a codemod across 800 files, a framework migration. How do you make those reviewable?

> **Testing:** Whether you distinguish *mechanical* diffs from hand-written ones and review them accordingly.

**A.** The key move is recognizing that **the diff size and the review effort are decoupled** for mechanical changes. You don't review 800 changed files line by line — that's impossible and pointless. Instead:

- **Review the *generator*, not the output.** For a codemod or a mass change, the thing to review carefully is the **script/transform** that produced the diff — its logic is what's actually authored. Then **spot-check** a representative sample of the output (a handful of the 800 files, including any with unusual structure) to confirm the transform did what the script says. If the codemod is correct, all 800 files are correct by construction.
- **Label it clearly.** Mark the PR `mechanical` / `codemod` / `generated` in the title and description, and state explicitly: *"This is the output of `<script>`; review the script, spot-check the output."* That sets the reviewer's expectation and stops them from trying to read every line.
- **Separate mechanical from manual.** If a migration is 95% mechanical with a few hand-written exceptions, split those: one PR is the pure codemod (review the script), a second small PR is the manual fixups (review by hand). Never bury hand-written logic inside a giant mechanical diff — that's exactly where a real bug hides unseen.
- **Generated code:** check it in with a clear marker (header comment, `linguist-generated` in `.gitattributes`) so review tools collapse it and reviewers know not to scrutinize it; review the *input spec* (the schema/proto/OpenAPI), not the emitted code.

The principle: for mechanical changes, **review the source of truth (the generator/spec) and verify by sampling** — the line count is irrelevant.

### Q: How do you make a large database migration reviewable?

> **Testing:** Applying expand-contract to a high-risk, hard-to-revert change.

**A.** A migration is the scariest big change because the data side is *not* trivially revertible, so I make it reviewable by **decomposing it in time with expand–contract**, and reviewing each phase on its own merits:

- **Expand** (PR 1): add the new column/table *additively* — nullable, no backfill yet, no reads. This is low-risk and easy to review: it can't break existing behavior.
- **Backfill** (PR 2): a separate, batched, restartable backfill job. Reviewed for safety (batch size, throttling, idempotency), independent of schema.
- **Migrate reads/writes** (PR 3, behind a flag): switch the code to the new shape using parallel change — write both, then read new. Small, flag-gated, reversible.
- **Contract** (PR 4, much later): drop the old column once nothing references it and you're confident.

Each phase is a small PR with a *single* risk to reason about, and the system is **releasable and reversible between phases**. The anti-pattern is one giant PR that alters schema, backfills, and switches code at once — un-reviewable (mixed concerns) *and* un-revertible (the data's already moved). I'd also call out that the *schema migration itself* should be reviewed against zero-downtime rules (no blocking locks on a hot table, etc.), which is exactly the kind of thing a [Quality Gate](../../quality-gates/) can enforce automatically.

### Q: A 5,000-line auto-formatting PR (e.g., adopting a new formatter) lands the same week as feature work. What's the problem and the fix?

> **Testing:** Whether you see the conflict/blame/review cost of mass mechanical churn and how to schedule it.

**A.** The problem is three-fold: it's **un-reviewable line-by-line** (and shouldn't be reviewed that way), it **conflicts with every in-flight PR** (everyone has to rebase through a reformat), and it **pollutes `git blame`** (every line now shows the formatting commit, hiding real authorship). The fixes:

- **Treat it as mechanical:** review the *config* (the formatter version + settings) and that the command was run cleanly, not the 5,000 lines.
- **Land it at a quiet moment** — ideally when few PRs are open — and **announce it** so people merge or pause first, minimizing the conflict blast.
- **Make it a single, isolated, atomic commit** that does *only* the reformat (no behavior changes mixed in), so it's a clean revert and a clean rebase target.
- **Add the commit to `.git-blame-ignore-revs`** so `git blame` skips it and real authorship is preserved. This is the specific, professional touch that separates someone who's done this from someone who hasn't.

The meta-point: large mechanical churn is fine, but it must be **isolated, scheduled, and blame-ignored** — never dribbled into feature PRs.

---

## Scale & Scenarios

### Q: You're a tech lead. How do you build a small-PR culture without it becoming bureaucratic policing?

> **Testing:** Whether you can change behavior through enablement + metrics, not just rules.

**A.** Culture follows the **path of least resistance plus visible signal**, not edicts. My playbook:

1. **Make small the easy path.** Adopt stacked-PR tooling, set a fast review SLA (the biggest single enabler — slow reviews *cause* big PRs), and add PR templates that prompt "is this one logical change?" Remove the friction that pushes people to batch.
2. **Coach the patterns, don't just demand the outcome.** Most people write big PRs because they don't know *how* to split — so I teach refactor-first, vertical slices, feature flags, expand-contract. A lunch-and-learn beats a lint rule here.
3. **Make size visible, not punitive.** Track median and p90 PR size on a team dashboard. Visibility alone moves behavior; you rarely need a hard gate. If you do add a check, make it a *soft warning* ("this PR is 800 lines — consider splitting") not a *block*, because hard size limits backfire (people game them or resent them, and legitimately-large mechanical PRs trip them).
4. **Model it and praise it.** I write small PRs myself, and I publicly appreciate a well-split stack. Reviewers reward small PRs with fast turnaround — that's the real incentive.

The trap to avoid is turning it into compliance theater. The goal is faster, better review and shipping; if a "small PR rule" ever slows the team down or breeds gaming, it's misconfigured.

### Q: Should PR size be a tracked metric? What's the risk?

> **Testing:** Metric literacy — Goodhart's Law applied to review.

**A.** Yes, as a **health/diagnostic** metric — median and p90 PR size, alongside review latency and time-to-merge — because it surfaces the doom loop and shows whether coaching is working. But the risk is **Goodhart's Law: when a measure becomes a target, it stops being a good measure.** If you set a hard "no PR over 300 lines" target and tie it to evaluation, people will *game* it: artificially split coherent changes into nonsensical fragments (which is *worse* for review — now the reviewer can't see the whole logical change), or exclude files, or pad small PRs. So I'd track it as a **trend, never an individual target**, pair it with quality signals (defect escape rate, revert rate) so gaming shows up as worse outcomes, and use it to start conversations ("our p90 crept up — are reviews getting slow again?") rather than to grade people. The metric is a thermometer, not a thermostat you crank. (More in [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md).)

### Q: A junior keeps opening 1,200-line PRs. How do you coach them?

> **Testing:** Whether your feedback is concrete and skill-building, not "make it smaller."

**A.** "Make it smaller" is useless advice — they'd do it if they knew how. I'd make it concrete and developmental:

- **Diagnose with them on a real PR.** Open their 1,200-line PR and *together* find the seams: "These 400 lines are a pure rename — that's PR #1. This new endpoint is PR #2. See how each is reviewable alone?" Doing it once with them teaches the skill; telling them doesn't.
- **Give them the vocabulary and one default move.** The single highest-leverage habit for a junior is **refactor-first**: "Before you build the feature, land any restructuring it needs as a separate PR." That one rule eliminates most oversized PRs.
- **Pair it with the *why*.** Explain that the reviewer fatigues, so their big PR actually gets a *worse* review — they're not getting more scrutiny, they're getting less. Self-interest motivates better than a rule.
- **Make the next PR a target.** "For your next change, try to keep it under ~300 lines or tell me why it can't be split." Concrete, low-stakes, and a chance to praise the improvement.

I'd frame it as a skill they're building, not a mistake they're making — and give feedback in a way that keeps them safe to try (see [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md)).

### Q: Mid-review, you realize you also want to ask the author to fix three unrelated things you noticed. What do you do?

> **Testing:** Scope-creep awareness *from the reviewer side* — the "could you also…" anti-pattern.

**A.** I keep them **out of this PR**. The "could you also fix X while you're here?" reflex is how a clean 200-line PR balloons into 600 lines of unrelated changes, blowing the whole small-PR benefit and delaying a good change over things that aren't its job. So for each unrelated issue I'd: file a **follow-up ticket** (or a "nit:"/non-blocking comment that explicitly says "separate PR, not for this one"), and let the current PR merge on its own merits. The only things I *block* on are problems with *this* change. The discipline cuts both ways — authors shouldn't scope-creep *into* a PR ("while I'm in here I'll also…"), and reviewers shouldn't scope-creep *onto* a PR. Both inflate size and slow flow. A senior reviewer protects the PR's scope as fiercely as the author should. (This is a classic review anti-pattern — see [08 — Review Anti-patterns](../08-review-anti-patterns/interview.md).)

### Q: How do you ship a half-finished feature to production safely without waiting weeks for a long-lived branch?

> **Testing:** The trunk-based / feature-flag answer — incomplete is not unmergeable.

**A.** The core reframe: **incomplete ≠ unmergeable.** I don't sit on a long-lived feature branch (which becomes one giant unreviewable PR *and* a merge-conflict nightmare). Instead I use **trunk-based development with feature flags**:

- Merge the work to `main` in small PRs *continuously*, but keep it **behind a feature flag** that's off in production. Merged code that's dormant is safe — it's compiled, tested, and integrated, but inert.
- Each PR is small and reviewable, the trunk stays green, and the incomplete feature ships to prod *disabled* — so it's never diverging on a stale branch.
- When the feature is complete and tested (often via the flag in staging, or a canary/percentage rollout to internal users), I **flip the flag** — which is a config change, not a code deploy, so it's instantly reversible if something's wrong.

This decouples **deploy** from **release**: code reaches production continuously and safely; the *feature* goes live when the flag flips. It also gives a clean kill switch. The discipline cost is hygiene — flags must be cleaned up after rollout, or they become permanent tech debt. But it completely removes the "wait weeks then drop a 2,000-line PR" pattern, which is the thing the question is really asking me to avoid.

### Q: When is a big PR actually the right call? Argue against your own dogma.

> **Testing:** Judgment over dogma — can you find the exceptions to your own rule?

**A.** Several cases where forcing a split is counterproductive:

- **Atomic mechanical changes** — a codemod or formatter run that *must* be one commit to leave the tree consistent; splitting it adds nothing but churn (you review the script, not the lines).
- **Tightly coupled changes that break if separated** — sometimes an interface and its sole caller genuinely must change together to keep the build green; an artificial split creates a broken intermediate state, which is worse than one cohesive PR.
- **Generated code / large fixtures / lockfiles** — these inflate line count but cost ~zero review attention; "the PR is 2,000 lines" is meaningless when 1,800 are a regenerated lockfile.
- **A trivial-to-verify large change** — e.g., adding 50 nearly-identical test cases or a big but obviously-correct data table.

The meta-point: the goal is never "small lines" — it's **reviewable, revertible, low-risk change**. Usually that means small PRs, but when a change is mechanical, coupled, or trivially verifiable, a large PR can serve those goals *better* than an artificial split. The senior move is to optimize for the actual goal and *say why* the large PR is fine ("this is one atomic codemod; review the transform") rather than reflexively splitting or reflexively not.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Ideal PR size band?** A: Roughly 200–400 lines of substantive change — but the real target is *one logical change*, reviewable in one sitting.
- **Q: Where does defect detection fall off?** A: Past ~400 lines per sitting and ~60 minutes (SmartBear/Cisco study) — fatigue, not capability.
- **Q: One rule to halve PR sizes?** A: Separate refactoring from behavior changes into different PRs.
- **Q: "Make the change easy, then make the easy change" — whose?** A: Kent Beck — preparatory refactoring first, then the small behavior change.
- **Q: Feature flag in one line?** A: Merge dormant code to `main` and keep it off until it's ready — decouples deploy from release.
- **Q: Branch by abstraction is for?** A: Replacing a deeply-embedded component via many small green PRs instead of one long-lived branch.
- **Q: Expand–contract phases?** A: Expand (add new), migrate consumers, contract (remove old) — releasable between each.
- **Q: Stacked PR?** A: A chain of dependent PRs (each based on the previous) so you keep PRs small without blocking yourself.
- **Q: Why does GitHub make stacking painful?** A: Its model assumes PRs target `main`; you manually rebase the stack on merge — hence Graphite/ghstack/git-spice.
- **Q: How to review an 800-file codemod?** A: Review the *script*, spot-check a sample of the output; the line count is irrelevant.
- **Q: Keep `git blame` clean after a mass reformat?** A: Put the reformat in one isolated commit and add it to `.git-blame-ignore-revs`.
- **Q: Little's Law applied to PRs?** A: Cycle time = WIP / throughput — big PRs are big batches that raise WIP and slow everything.
- **Q: The doom loop?** A: Slow reviews → authors batch into big PRs → reviews get slower. Break it at review latency first.
- **Q: Small PR + production incident?** A: Clean `git revert` and easy `git bisect` — small PR = small blast radius = lower MTTR.
- **Q: The "could you also…" problem?** A: Scope creep onto a PR; file a follow-up ticket instead of inflating the current one.
- **Q: Track PR size as a hard target?** A: No — Goodhart's Law; track it as a trend paired with quality metrics, never an individual goal.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- "Smaller is better" with no mechanism — can't explain *why* (fatigue, latency, revert, conflicts).
- Treating 400 lines as a hard law rather than a proxy for "reviewable in one sitting."
- No actual splitting method — "just break it up" with no named pattern.
- Mixing refactors and behavior changes, or not seeing why that's a problem.
- Thinking a half-finished feature *must* wait on a long-lived branch (no feature-flag / trunk-based answer).
- Proposing to review an 800-file codemod line by line.
- Blaming authors for big PRs without checking whether slow reviews are the cause.
- "Make PR size a KPI with a hard limit" — no awareness of Goodhart / gaming.

**Green flags:**
- Naming the *distinction* (refactor vs behavior, incomplete vs unmergeable, mechanical vs hand-written) before the tactic.
- Reaching for **preparatory refactoring** ("make the change easy, then make the easy change") as the default first cut.
- Knowing the patterns by name — branch by abstraction, expand-contract, strangler fig, feature flags, stacked PRs.
- Framing size↔latency↔conflicts as **one queueing loop** and breaking it at review latency.
- Connecting small PRs to **revert/bisect/MTTR**, not just the review experience.
- `.git-blame-ignore-revs`, `linguist-generated`, "review the script not the output" — the operational touches.
- Caveating the dogma — knowing when a *large* PR (atomic codemod, coupled change, fixtures) is the right call.

---

## Cheat Sheet

| Situation | Move | Why |
|---|---|---|
| PR mixes rename + bug fix | Split: refactor PR, then behavior PR | Reviewer asks one question per PR, not two |
| 1,500-line feature | Refactor-first, then vertical slices | Each slice individually correct + reviewable |
| Half-finished feature | Trunk-based + feature flag | Merge dormant code; decouple deploy from release |
| Replacing embedded component | Branch by abstraction | Many small green PRs, no long-lived branch |
| Changing a schema/contract | Expand → migrate → contract | Releasable + reversible between phases |
| Small PRs blocked by dependencies | Stacked PRs (Graphite/ghstack) | Don't block yourself; keep each piece small |
| 800-file codemod | Review the script, spot-check output | Diff size ≠ review effort for mechanical changes |
| Mass reformat | One isolated commit + `.git-blame-ignore-revs` | Clean revert; preserve real authorship |
| Reviewer says "split it" | Cherry-pick seams onto fresh branch, stack the rest | Don't discard work; don't refuse |
| Big DB migration | Expand-contract in 4 phased PRs | One risk per PR; reversible between phases |
| Slow reviews + big PRs | Fix review **latency** first, then size | The doom loop is driven by latency |
| Noticed unrelated issues mid-review | File a follow-up ticket | Protect the PR's scope; avoid "could you also…" |

**Numbers worth remembering:** ~200–400 LOC sweet spot · defect detection falls off past ~400 lines / ~60 min (SmartBear) · Google CLs mostly under ~250 lines · Little's Law: cycle time = WIP / throughput.

**The four distinctions:** refactor vs behavior change · size as cause vs symptom · incomplete vs unmergeable · mechanical vs hand-written diff.

---

## Summary

- The bank reduces to four distinctions in costumes: **refactor vs behavior change**, **size as cause vs symptom**, **incomplete vs unmergeable**, **mechanical vs hand-written diff**. Name the distinction first; the tactic follows.
- **Fundamentals:** small PRs win on four independent axes — review quality (fatigue past ~400 lines), latency, revertibility, and fewer conflicts. The number is a proxy for "one logical change, reviewable in one sitting"; the highest-leverage habit is separating refactors from behavior changes.
- **Splitting:** have a *method* — preparatory refactoring first, then vertical slices; and a named toolkit — feature flags, branch by abstraction, expand-contract, strangler fig, all enabled by trunk-based development. **Stacked PRs** keep pieces small under dependencies (with Graphite/ghstack on GitHub's weak native support).
- **Flow economics:** size↔latency↔conflicts is one queueing loop (Little's Law / Reinertsen). Slow reviews *cause* big PRs (the doom loop); break it at **review latency first**. Small PRs shrink blast radius and MTTR via clean revert and bisect.
- **Unavoidable big PRs:** for codemods/generated code/migrations, **review the generator or spec and spot-check the output** — diff size and review effort are decoupled. Label "mechanical," isolate mass churn, and use `.git-blame-ignore-revs`. Migrations get expand-contract so each phase is one risk and reversible.
- **Scale/judgment:** build a small-PR culture by making small the *easy* path (fast SLA, stacking tools, coaching the patterns), tracking size as a *trend* not a Goodhart target, and protecting PR scope from "could you also…". And know when a *large* PR is genuinely the right call.

---

## Further Reading

- **Google Engineering Practices — "Small CLs"** (`google.github.io/eng-practices`). The authoritative, concise case for small changes and how to split them; the document this topic most directly tracks.
- **SmartBear / Cisco Systems code-review study** — the empirical source for the defect-detection-falls-off-past-~400-lines / ~60-minutes findings.
- **Martin Fowler — "Branch By Abstraction," "Feature Toggles," "Parallel Change" (expand-contract), "Strangler Fig Application"** (`martinfowler.com`). The canonical write-ups of the splitting patterns by name.
- **Donald Reinertsen — *The Principles of Product Development Flow*** — the batch-size and queueing economics behind the size↔latency↔WIP loop.
- **Kent Beck — *Tidy First?*** — preparatory refactoring and "make the change easy, then make the easy change."
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — what the reviewer does with the attention that small PRs preserve.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md) — how to ask for a split, and how to coach juniors, without friction.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md) — PR size, review latency, and the doom loop as tracked metrics.
- [08 — Review Anti-patterns](../08-review-anti-patterns/interview.md) — scope creep, the "could you also…" trap, and rubber-stamping big PRs.
- [Quality Gates](../../quality-gates/) — automating size warnings, migration-safety checks, and mechanical-diff labeling.
