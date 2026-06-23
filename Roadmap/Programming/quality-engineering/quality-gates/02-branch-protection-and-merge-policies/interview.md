# Branch Protection & Merge Policies — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Branch Protection & Merge Policies
> *A branch-protection interview rarely asks "what is a protected branch." It asks "two PRs both pass CI, you merge both, and main is red — what happened," and then watches whether you can tell a textual merge from a semantic one, name the merge queue as the fix, and reason about who is allowed to bypass the rule you just designed.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Fundamentals](#theme-1--fundamentals)
3. [Theme 2 — Merge Strategies](#theme-2--merge-strategies)
4. [Theme 3 — Merge Queues & Semantic Conflicts](#theme-3--merge-queues--semantic-conflicts)
5. [Theme 4 — Supply Chain & Compliance](#theme-4--supply-chain--compliance)
6. [Theme 5 — Scale & Scenarios](#theme-5--scale--scenarios)
7. [Rapid-Fire Round](#rapid-fire-round)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize answers — internalize the *distinctions* this topic keeps returning to:

- **policy vs enforcement** (a rule you wrote down vs a gate the server refuses to merge past)
- **textual merge vs semantic correctness** (Git can merge the diff cleanly and still produce a broken `main`)
- **"up to date" vs "tested together"** (one PR being current with `main` is not the same as two PRs being tested against each other)
- **author vs approver vs admin** (three different identities, and who is allowed to override)

Nearly every question below is one of those four distinctions wearing a costume. The candidates who do well *name the distinction* before reaching for a setting toggle.

## Prerequisites

You should be comfortable with the Git history model (commits, parents, merge commits vs a linear history), what a pull request is, and what "CI" means as a required status check. If "fast-forward," "rebase," and "merge commit" don't yet mean three different shapes of history to you, read [junior.md](junior.md) first — the merge-strategy and merge-queue answers here assume that vocabulary cold.

---

## Theme 1 — Fundamentals

### Q1.1 — What is branch protection, and what does it actually prevent?

> **Testing:** Whether you see it as enforcement on the server, not a team agreement.

**A.** Branch protection is a set of **server-enforced rules** on a ref (typically `main` and release branches) that the forge refuses to let a push or merge violate — regardless of the contributor's local Git config or good intentions. The point is the word *enforced*: a convention in a `CONTRIBUTING.md` is a request; a protection rule is a gate. Concretely it prevents (a) **direct pushes** that skip review, (b) **force-pushes and deletion** that rewrite or erase shared history, and (c) **merging code that hasn't passed the required gates** — review, status checks, ownership. The mental model is a quality gate that lives where it can't be talked past: on the path into the protected branch, not in a wiki.

### Q1.2 — Name the common protection rules and what each one buys you.

> **Testing:** Breadth — do you know the toolbox, and *why* each tool exists?

**A.** The standard set, each defending a specific failure:

| Rule | What it forces | Failure it prevents |
|------|----------------|---------------------|
| Require a pull request | No direct pushes; changes go through a PR | Unreviewed code on `main` |
| Require N approvals | At least N reviewers approve | One person merging unilaterally |
| Require review from CODEOWNERS | The owning team of touched files approves | The wrong people rubber-stamping their own area |
| Require status checks | Named CI checks must be green | Merging broken/untested code |
| Require branches up to date | PR must be rebased on latest `main` before merge | Merging against a stale base |
| Dismiss stale approvals | New commits invalidate prior approvals | Approving code A, then merging code B |
| No force-push / no deletion | History can't be rewritten or the branch erased | Lost commits, destroyed audit trail |
| Require linear history | No merge commits; squash/rebase only | A tangled graph that's hard to bisect/revert |
| Require signed commits | Commits carry a verified signature | Spoofed authorship / unverifiable provenance |
| Require conversation resolution | All review threads resolved before merge | Merging with unanswered review concerns |

The judgment is *which* to turn on. "Require a PR + required checks + CODEOWNERS + dismiss-stale" is a sane default for a shared service; piling on every rule for a low-traffic internal tool just adds friction without a matching risk.

### Q1.3 — What does CODEOWNERS do, and how is it different from "require N approvals"?

> **Testing:** The distinction between *how many* approve and *who* approves.

**A.** `CODEOWNERS` is a file (in `.github/`, repo root, or `docs/`) that maps **path patterns to owning users or teams**:

```
# Last matching pattern wins
*                       @org/platform
/services/payments/**   @org/payments-team
*.tf                    @org/infra
/SECURITY.md            @org/security @org/legal
```

"Require N approvals" is a **count** — any N people with write access. "Require review from CODEOWNERS" is an **identity** requirement — the specific owning team of the files this PR touches must approve, *on top of* the count. The difference matters because a payments change approved by two frontend engineers satisfies "2 approvals" but not "the payments owners signed off." CODEOWNERS routes review to the people with the context to catch domain-specific mistakes, and (combined with protection) makes that routing mandatory rather than a polite @-mention. Last-matching-pattern-wins is the gotcha most people get wrong — order the file specific-last.

### Q1.4 — What's the difference between "dismiss stale approvals" being on vs off?

> **Testing:** The approve-A-merge-B hole, which is a real supply-chain footgun.

**A.** With it **off**, an approval sticks to the PR even if the author pushes new commits afterward — so a reviewer can approve a clean change, the author can push something entirely different, and it merges still wearing the old green check. That's the *approve-A-merge-B* attack/mistake. With "dismiss stale approvals" **on**, any new commit invalidates all existing approvals and the PR must be re-reviewed. It's the difference between "someone approved *this PR*" and "someone approved *these exact bytes*." For anything security- or compliance-sensitive you want it on; the cost is that an author pushing a one-line typo fix re-triggers review, which teams sometimes find annoying enough to disable — and that's exactly the decision an interviewer wants you to make consciously, not by default.

---

## Theme 2 — Merge Strategies

### Q2.1 — Merge commit vs squash vs rebase — what does each do to history?

> **Testing:** Whether you can describe the *shape* each produces, not just name them.

**A.** Three different histories from the same PR:

- **Merge commit** — creates a new commit with **two parents** (the base tip and the PR tip), preserving every individual commit on the branch *and* the fact that they were developed together. History is a true graph; `main`'s first-parent line shows "merged PR #123," and you can drill into the branch's commits.
- **Squash** — collapses all of the PR's commits into **one new commit** on `main`; the branch's individual commits are discarded from `main`'s history. `main` becomes a clean, linear list of one-commit-per-PR. The original commits survive only on the (usually deleted) branch.
- **Rebase** — replays the PR's commits **one by one** onto the tip of `main`, with no merge commit. You keep every commit *and* get a linear history — but each replayed commit is a *new* commit (new SHA), and intermediate commits may never have existed as a tested state.

The one-liner: merge-commit preserves branch structure, squash gives one commit per PR, rebase gives linear-but-per-commit.

### Q2.2 — What are the trade-offs — bisect, revert, "is this commit on main"?

> **Testing:** Whether you reason about history as an *operational tool*, not aesthetics.

**A.** The strategy choice is really a bet on which operations you want to be cheap:

- **`git bisect`** wants *every commit on `main` to build and pass tests*. **Squash** is best here — one commit per PR, each a known-good merged state. **Rebase** can poison bisect with intermediate commits that were never green. Merge-commit bisect works if you bisect first-parent only.
- **`git revert`** wants the change to be *one thing you can undo atomically*. **Squash** shines — revert one commit and the whole feature is gone. Reverting a **merge commit** needs `-m 1` and complicates re-merging later; reverting a **rebased** multi-commit feature means reverting several commits in order.
- **"Is commit X on `main`?"** / backporting — **merge-commit and rebase preserve original authorship per commit**, so cherry-picking a specific fix to a release branch is clean. **Squash** loses the granularity: the fix is fused with everything else in its PR, so backporting drags unrelated changes along.
- **`git blame` / debugging** — squash gives you "this line came from PR #842" (one hop to the PR's full context); per-commit histories give finer-grained but noisier blame.

So: optimize for bisect/revert → squash; optimize for backport/forensics → merge-commit or rebase. There's no universally right answer, which is the point of the question.

### Q2.3 — Which would you pick, and when?

> **Testing:** Judgment — can you tie strategy to team and repo shape?

**A.** My defaults:

- **Squash** for most application repos and any team that treats a PR as the atomic unit of change. It keeps `main` linear and bisectable, makes revert trivial, and stops "fix typo / address review / oops" noise from polluting history. Downside accepted: coarser backport granularity.
- **Merge commit** when individual commits carry real value you want to preserve — a curated patch series, a library where commits map to logical changes, or a repo that backports heavily and needs per-commit cherry-picks. Also the honest choice when you genuinely want to record that a set of commits landed together.
- **Rebase** for teams that craft clean, atomic, individually-meaningful commits *and* want linear history — common in some OSS projects. It demands discipline (every commit green) and I'd pair it with a merge queue, because rebasing onto a moving `main` is exactly where intermediate states stop being tested.

I'd also **enforce one strategy per repo** (disable the others in settings) rather than leave it to whoever clicks merge — a mix of squash and merge-commit in the same `main` is the worst of both: neither cleanly linear nor reliably per-commit.

### Q2.4 — Why does "require linear history" exist, and what does it force?

> **Testing:** Connecting a protection toggle to the merge-strategy decision.

**A.** "Require linear history" forbids merge commits on the protected branch — so it *forces* every PR to land via **squash or rebase**, never a merge commit. Teams turn it on when they want `main` to be a single clean line: easy to read with `git log --oneline`, unambiguous to bisect (no parallel branches to reason about), and simple to reason about in tooling. The trade-off is you give up the merge commit's ability to record "these commits were developed and merged as a unit," and you commit to one of the two linear strategies. It's the protection-rule expression of "I've decided this repo is squash/rebase-only."

---

## Theme 3 — Merge Queues & Semantic Conflicts

### Q3.1 — Two PRs each pass CI. You merge both. `main` is now red. What happened?

> **Testing:** The single most important question in this topic — the *semantic* merge conflict.

**A.** A **semantic merge conflict** (a "logical" conflict). Each PR was tested **against the `main` it branched from**, in isolation. They don't touch the same lines, so Git merges both **textually cleanly** — no conflict markers. But their *meaning* collides. The textbook example: PR-A renames the function `getUser` → `fetchUser` and updates all current callers; PR-B, branched in parallel, adds a *new* call to `getUser`. Neither edits the other's lines, so both merge clean and both were green. After both land, `main` calls `getUser` (from B) which no longer exists (renamed by A) → compile/test failure that **neither PR's CI could have caught**, because at the time each ran, the other's change wasn't in the tree.

The key insight to state explicitly: **passing CI proves a PR is correct against the base it was tested on — it says nothing about correctness against changes that land concurrently.** Textual mergeability and semantic correctness are different properties, and CI on the PR branch only checks the first.

### Q3.2 — Doesn't "require branches up to date before merge" fix that?

> **Testing:** Whether you see why up-to-date doesn't scale — the differentiator.

**A.** It *helps* but it doesn't scale, and that gap is the whole reason merge queues exist. "Require up to date" forces a PR to rebase onto the latest `main` and re-run CI **before** it's allowed to merge. With two PRs that works: A merges, B is now out of date, B rebases, B's CI re-runs against A's change, B's CI catches the break. The problem is it's a **race serialized by humans**: only one PR can be "up to date and green" at the instant of merge. The moment A merges, *every other open green PR is silently stale*, and they all must rebase-and-rewait. On a busy repo with dozens of PRs/day this becomes **starvation** — you rebase, wait 20 minutes for CI, and by the time it's green someone else merged and you're stale again. People either thrash forever or, worse, the rule gets disabled and the semantic conflicts come back. "Up to date" makes correctness possible but throughput collapses.

### Q3.3 — How does a merge queue solve it?

> **Testing:** Whether you can describe the mechanism, not just say "use a merge queue."

**A.** A merge queue **serializes the merge and re-tests against the actual future `main`**, automatically, so humans stop racing. The flow: when a PR is approved and green, the author adds it to the queue instead of merging directly. The queue:

1. Takes the PRs in order and, for the head of the queue, **constructs the candidate state** = current `main` + every PR ahead of it in the queue + this PR.
2. **Runs CI on that combined candidate** — i.e., it tests the exact tree that *would* become `main`, including concurrent changes, which is precisely what catches the semantic conflict.
3. If green, it **merges** and moves on; if red, it **ejects** the offending PR (kicks it back to the author) and re-tests the rest without it.

So instead of "test against the `main` you branched from," it's "test against the `main` you're about to create." The queue is the component that makes up-to-date-style correctness *throughput-safe*, because the rebasing and re-testing is done by the system in a pipeline rather than by humans one at a time.

### Q3.4 — That sounds slow — every PR waits for a full CI run in series. How do queues stay fast?

> **Testing:** Speculative / optimistic batching and bisecting a failed batch.

**A.** **Speculative (optimistic) execution.** A naive queue that tests PRs strictly one-at-a-time has throughput capped at `1 / CI_duration` — fatal if CI is 30 minutes. Real queues **test multiple candidates in parallel, assuming earlier ones will pass.** Concretely:

- For a queue `[A, B, C]`, it speculatively kicks off CI for `main+A`, `main+A+B`, and `main+A+B+C` **simultaneously**, betting A and B pass. If they do, B and C are already validated against the right state and can merge immediately — the queue drains at near-`1/CI` *latency* but full parallel *throughput*.
- **Batching:** group several PRs into one candidate (`main+A+B+C+D`) and run CI once for the batch. If green, all four merge on a single CI run — big win when CI is expensive.
- **Bisecting a failed batch:** if a batch goes red, the queue doesn't blame everyone — it **bisects** to find the culprit (split the batch, re-test halves), ejects the bad PR, and re-forms the batch with the survivors. So one bad PR costs a bisect, not a re-run of every PR behind it.

The tension is **speculation depth vs wasted CI**: deeper speculation drains faster but burns more compute on candidates that get invalidated when an early PR fails. Tuning batch size and speculation width against your CI cost and merge rate is the real operational knob. GitHub merge queue, Mergify, Graphite, and the original Bors/`bors-ng` all implement variants of this.

### Q3.5 — When is a merge queue overkill?

> **Testing:** Judgment — not cargo-culting infrastructure.

**A.** It's overkill when the **merge rate is low relative to CI time**, because then semantic conflicts are rare and "require up to date" handles them without the queue's complexity and CI cost. A repo with three contributors merging a few PRs a day rarely has two green PRs racing, so the queue mostly adds latency and burns compute on speculation that never pays off. The queue earns its keep when **PR volume is high enough that PRs routinely go stale before they merge** — that's the symptom (constant rebase thrash, occasional red `main` from concurrent merges) that says "up to date" has stopped scaling. So I'd reach for it driven by the symptom, not install it on day one by default.

---

## Theme 4 — Supply Chain & Compliance

### Q4.1 — What do signed/verified commits actually protect against?

> **Testing:** Whether you know Git authorship is unauthenticated by default.

**A.** Git's `user.name` / `user.email` are **free-text fields** — anyone can `git config user.email you@company.com` and commit *as you*; nothing verifies it. Commit signing (GPG, SSH keys, or Sigstore/`gitsign`) attaches a **cryptographic signature** binding the commit to a key the forge can verify against the author's registered keys, surfacing a "Verified" badge and letting "require signed commits" **reject unsigned/unverifiable commits at the protected branch.** It protects against **authorship spoofing** — an attacker (or a compromised CI token) pushing commits that *appear* to come from a trusted maintainer — and it's a building block for provenance: you can prove *who* (which key) produced a change, which auditors and frameworks like SLSA care about. It does **not** prove the code is good or that the human meant to sign — only that the signature matches a known key.

### Q4.2 — What is separation of duties here, and how do you enforce author ≠ approver?

> **Testing:** A core compliance control most engineers can't name precisely.

**A.** **Separation of duties** means the person who *makes* a change can't be the same person who *approves* it into production — so a single compromised or malicious account can't unilaterally ship code. In branch-protection terms it's enforced by the (default and usually mandatory) rule that **a PR's author cannot approve their own PR**, combined with **require ≥1 approval** so a self-merge is impossible. For stronger regimes you require approval from a *different team* via CODEOWNERS, and turn off admin self-approval. This is a named requirement in SOC 2, PCI-DSS, and similar audits — the control is literally "changes to production require independent review." The interview-worthy nuance: separation of duties is *why* "require 1 approval" exists even on a two-person team — not for code quality, but so no one can act alone.

### Q4.3 — How do you manage branch protection across 500 repos without it drifting?

> **Testing:** Protections-as-code and the audit trail.

**A.** **Protections-as-code** — define the rules declaratively and apply them with Terraform (or the org rulesets API), not by clicking through each repo's settings:

```hcl
resource "github_branch_protection" "main" {
  repository_id  = github_repository.svc.node_id
  pattern        = "main"
  required_pull_request_reviews {
    required_approving_review_count = 2
    require_code_owner_reviews      = true
    dismiss_stale_reviews           = true
  }
  required_status_checks {
    strict   = true               # require up to date
    contexts = ["ci/build", "ci/test"]
  }
  enforce_admins         = true   # no admin bypass
  require_signed_commits = true
  required_linear_history = true
}
```

This buys three things an audit demands: **consistency** (every repo gets the same baseline, no snowflake configs), an **audit trail** (the change to a protection rule is a reviewed, dated PR in the Terraform repo — *who* loosened the policy and *when* is in version control), and **reviewability** (loosening a rule is itself a PR someone must approve). Manual settings give you none of that; the next CVE retro asks "was force-push disabled on `main` in March?" and version-controlled config answers it definitively. Modern orgs lift this to **org-level rulesets** so the baseline is owned centrally and individual repos can't silently weaken it.

### Q4.4 — `enforce_admins` / "include administrators" — what's the trade-off?

> **Testing:** Whether you see admin bypass as a break-glass surface, not a convenience.

**A.** By default, **admins can bypass branch protection** — push directly, merge without review, force-push. "Include administrators" / `enforce_admins = true` makes the rules apply to admins *too*. The trade-off is **safety vs break-glass.** With it off, every admin account is a way to silently put unreviewed code on `main` — a huge attack surface (a phished admin token = unrestricted `main`) and a separation-of-duties hole. With it **on**, you've closed that hole, but you've also removed the legitimate emergency escape hatch (a critical hotfix when CI is down at 3am). The mature answer: **turn it on by default**, and provide a *deliberate, audited* break-glass mechanism — a separate process that logs who bypassed, why, and notifies the team — rather than leaving routine admin bypass available. Bypass should be a fire alarm you have to break the glass for, not a door anyone with the right role strolls through. (See [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md).)

---

## Theme 5 — Scale & Scenarios

### Q5.1 — Org-level rulesets vs per-repo protection — when each?

> **Testing:** Governance at scale vs local autonomy.

**A.** **Per-repo branch protection** is configured on one repository and owned by whoever administers it — flexible, but it **drifts**: 500 repos means 500 chances for someone to disable a rule, and no single place to answer "what's our policy?" **Org-level rulesets** define rules **centrally across many repos** by pattern, with **layering** (org rules apply on top of repo rules and *can't be weakened* locally) and **bypass lists** (named actors/teams allowed to bypass, recorded). Use org rulesets for the **non-negotiable baseline** every repo must meet — require PRs, signed commits, no force-push on `main` — owned by platform/security and immune to local tampering. Use per-repo rules for **team-specific additions** on top — a repo that wants stricter CODEOWNERS or extra required checks. The principle: *baseline central and tamper-proof; local rules can only add friction, never remove it.*

### Q5.2 — CODEOWNERS is causing bottlenecks — owners are slow or stale. How do you fix the policy without dropping the control?

> **Testing:** Diagnosing CODEOWNERS pathologies and fixing the policy, not removing it.

**A.** First name the failure mode, then fix the *policy*, not delete the control:

- **Too-narrow ownership / single owner** → one person is on the critical path for everything. Fix: assign ownership to a **team**, not an individual, so any team member can approve, and the round-robin/load-balanced assignment spreads it.
- **Stale owners** (people who left, teams that reorged) → PRs route to ghosts. Fix: treat `CODEOWNERS` as **maintained code** — a CI check that validates every referenced user/team still exists and has access, run on every PR that touches it.
- **Over-broad patterns** → a `*` owner gets pulled into every PR and becomes a rubber stamp. Fix: scope patterns to directories that genuinely have distinct owners; delete ownership that adds latency without adding judgment.
- **Genuine throughput** → the team really is the bottleneck. Fix: lower the *count* for low-risk paths, or split the codebase so ownership matches team boundaries.

The framing: a CODEOWNERS bottleneck is usually an **org-design smell** (ownership doesn't match how work flows) surfacing as a merge delay — fix the ownership map, don't disable mandatory review.

### Q5.3 — What does over-protection vs under-protection look like, and how do you find the balance?

> **Testing:** Whether you treat protection as a cost/risk trade, not "more is always safer."

**A.** **Under-protection** is the obvious failure: direct pushes, no required checks, self-merges, force-push allowed — unreviewed and broken code reaches `main`, and there's no audit trail. **Over-protection** is the subtler one: 4 required approvals + CODEOWNERS from three teams + every conceivable required check on a low-traffic internal tool. The cost is **velocity and shadow workarounds** — PRs sit for days, people batch huge changes to amortize the approval tax (making review *worse*), and frustrated engineers lobby to grant themselves admin bypass, which quietly destroys the whole control. The balance is **risk-proportional**: protect by blast radius. `main` of a payments service and a shared platform library get the strict set; a personal scratch repo or a docs site gets "require a PR + one check." I'd calibrate by asking "what does a bad merge here actually cost?" and set protection to match, then watch merge-time metrics — if protection is causing batching or bypass requests, it's too tight.

### Q5.4 — How do you protect *release* branches differently from `main`?

> **Testing:** Whether protection strategy varies by branch role.

**A.** Release branches (`release/2.x`, `release/2024-Q3`) carry **shipped or about-to-ship code**, so they're often protected *more strictly* than `main` and with different rules:

- **Tighter approvals / restricted pushers** — only the release-management team can merge; often a release-specific CODEOWNERS or a `restrict who can push` allowlist, because a stray change to a live release branch is a production incident.
- **Cherry-pick-only flow** — changes land as **backported cherry-picks** of already-reviewed `main` commits (which is why your merge strategy on `main` affects backport ease — see Q2.2), not fresh development.
- **Stricter required checks** — possibly a superset including release-specific suites (longer integration tests, security scans) that you don't gate every `main` PR on.
- **No deletion, ever, and signed commits** — the audit/provenance bar is highest for what customers actually run.

The general principle: **protection should scale with the branch's blast radius**, and a release branch's blast radius is "what's in production," so it gets the strictest gates and the narrowest set of people allowed through them. (See [Release Engineering](../../release-engineering/).)

### Q5.5 — Scenario: should we squash or use merge commits? Walk me through how you'd advise a team.

> **Testing:** Whether you run a decision, not recite definitions.

**A.** I'd ask what they optimize for, then map it:

- "How do you debug regressions?" — if `git bisect` is their main tool, **squash** (every `main` commit is a known-good PR). If they read merge commits / first-parent history, merge-commit is fine.
- "How often do you backport to release branches, and at what granularity?" — heavy per-commit backporting → **merge-commit or rebase** (preserves individual commits to cherry-pick). Rare or whole-PR backports → squash is fine.
- "Do your commits carry curated value, or are they 'wip / fix review / typo'?" — noisy commits → **squash** cleans `main`. Curated atomic commits → **rebase** preserves them linearly.
- "Do you want `main` linear?" — yes → squash or rebase; turn on "require linear history" to enforce it.

For a typical product team I land on **squash + linear history + delete branch on merge**: clean bisectable history, trivial revert, one strategy enforced in settings. For a library with curated patch series and heavy backports, I'd recommend **merge commits or rebase**. The deliverable is "pick *one* and enforce it in repo settings" — the failure is leaving it to whoever clicks the button and getting a mixed history that's good for nothing.

### Q5.6 — Scenario: an admin force-pushed and rewrote `main`. How do you prevent recurrence?

> **Testing:** Recovery plus the systemic fix — not just "yell at the admin."

**A.** Two parts. **Recover first:** the old commits aren't gone immediately — recover the prior `main` tip from the **reflog**, a teammate's up-to-date clone, the CI system's last-built SHA, or (on GitHub) the events/activity API, then force-push `main` back to the recovered tip and verify. **Then fix the system so it can't happen again:**

1. **Disable force-push and deletion** on `main` (the rule that would have blocked it outright).
2. **Turn on `enforce_admins` / include-administrators** — the force-push was only possible because admins bypass protection; closing that is the root fix.
3. **Move protection into org rulesets / Terraform** so the rule can't be silently toggled off, and so the change is auditable.
4. **Provide an audited break-glass path** for the legitimate emergency that tempts people to use admin bypass, so the pressure that led here has a *logged* outlet.
5. **Alert on force-push events** to the protected branch as a backstop.

The interview point: the incident isn't "an admin made a mistake," it's "the system permitted an unreviewable, irreversible action on shared history." The fix is removing the *capability*, not trusting the human. (Detail in [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md).)

### Q5.7 — Scenario: PRs are blocked because the only CODEOWNER is on vacation. Fix the policy.

> **Testing:** Diagnosing single-owner risk and fixing it durably, not with a one-off override.

**A.** The immediate unblock and the durable fix are different, and a strong answer does both:

- **Immediate:** don't reach for admin bypass (that records "we ignored the control"). Temporarily add another qualified reviewer to the CODEOWNERS team, or have an org admin add a documented, time-boxed exception — logged, with an expiry.
- **Durable fix — the policy was wrong:** ownership pointed at **one person instead of a team.** Change `CODEOWNERS` so the owner is `@org/owning-team` with **at least two active members**, so no single person's calendar is on the critical path. Add a **CI check** that flags any CODEOWNERS entry resolving to a team with fewer than N members, so this can't silently regress. Optionally enable **load-balanced/round-robin** review assignment so the work spreads.

The framing: a vacation shouldn't be able to halt merges — if it can, the bus factor of your review policy is 1, and that's the bug. Fix the ownership map so the control survives any one person being away, rather than punching a hole in the control every time someone takes leave.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What's the difference between a policy and a protection rule?** A: A policy is written intent; a protection rule is the forge *enforcing* it on the path into the branch.
- **Q: Can a PR author approve their own PR?** A: No (by default) — that's separation of duties; it's why "require 1 approval" blocks self-merge.
- **Q: What does "require branches up to date" do?** A: Forces a PR to rebase on latest `main` and re-pass CI before merging.
- **Q: Why doesn't "up to date" scale?** A: Only one PR can be up-to-date-and-green at a time; every merge re-stales all other PRs → rebase thrash.
- **Q: One-line definition of a semantic merge conflict?** A: Two PRs that merge textually clean and each pass CI, but break `main` when combined.
- **Q: What does a merge queue test against?** A: The candidate `main` = current `main` + PRs ahead in the queue + this PR — i.e., the future, not the past.
- **Q: What is speculative execution in a merge queue?** A: Running CI on stacked candidates in parallel assuming earlier PRs pass, so the queue drains at full throughput.
- **Q: What happens when a speculative batch fails?** A: The queue bisects to find the culprit, ejects it, and re-tests the survivors.
- **Q: Which merge strategy is best for `git bisect`?** A: Squash — every `main` commit is one known-good PR.
- **Q: Which is best for backporting individual fixes?** A: Merge-commit or rebase — they preserve per-commit granularity.
- **Q: What does "require linear history" force?** A: No merge commits — every PR lands via squash or rebase.
- **Q: What does "dismiss stale approvals" prevent?** A: Approve-A-merge-B — a new commit invalidates prior approvals.
- **Q: Does CODEOWNERS use first-match or last-match?** A: Last matching pattern wins — order specific patterns last.
- **Q: Why sign commits?** A: Git authorship is unauthenticated free-text; signing binds a commit to a verifiable key (anti-spoofing, provenance).
- **Q: What does `enforce_admins = true` do?** A: Makes branch protection apply to admins too — closes the admin-bypass hole.
- **Q: Org ruleset vs per-repo protection in one line?** A: Org rulesets are a central, tamper-proof baseline; per-repo rules can only *add* on top, never weaken.
- **Q: What's the right way to manage protection across many repos?** A: Protections-as-code (Terraform / rulesets API) — consistent, auditable, reviewable.
- **Q: What's break-glass?** A: A deliberate, logged emergency bypass — a fire alarm, not a routine door.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Thinking branch protection is a team convention rather than server-enforced.
- "Both PRs passed CI, so `main` is fine" — missing the semantic merge conflict entirely.
- Believing "require up to date" alone scales to a high-volume repo.
- Saying "use a merge queue" without being able to describe serialization, candidate-against-future-`main`, or speculation.
- Treating merge strategy as cosmetic ("squash looks cleaner") with no bisect/revert/backport reasoning.
- Leaving admin bypass on as a convenience, or reaching for it to unblock a stuck PR.
- A single person as a CODEOWNER, and treating their vacation as an exception to punch through rather than a policy bug.
- Configuring protection by clicking through settings on each repo, with no audit trail.

**Green flags:**
- Naming the *distinction* (policy/enforcement, textual/semantic, up-to-date/tested-together, author/approver/admin) before reaching for a toggle.
- Reaching the semantic-conflict diagnosis fast and naming the merge queue as the structural fix.
- Describing speculative batching *and* bisecting a failed batch — knowing how queues stay fast.
- Tying merge strategy to operations: bisect → squash, backport → merge-commit/rebase.
- Framing signed commits / author≠approver as supply-chain and separation-of-duties controls, citing SLSA/SOC 2 unprompted.
- Treating protection as risk-proportional — protecting by blast radius, wary of over-protection causing batching and bypass.
- Protections-as-code with an audit trail; org rulesets as a tamper-proof baseline.
- Treating admin bypass as audited break-glass, and fixing CODEOWNERS bottlenecks as an org-design smell.

---

## Cheat Sheet

| Concept | One-line answer |
|---------|-----------------|
| Branch protection | Server-enforced rules on a ref the forge refuses to merge past |
| CODEOWNERS | Path → owning-team map making the *right* people's review mandatory |
| Dismiss stale approvals | New commit invalidates approvals — closes approve-A-merge-B |
| Squash | One commit per PR — best for bisect/revert, coarse backport |
| Merge commit | Two-parent commit preserving branch — best for per-commit backport |
| Rebase | Replay commits linearly — clean per-commit history, intermediate states untested |
| Require linear history | Forbid merge commits — forces squash/rebase |
| Semantic merge conflict | Two green PRs that break `main` combined; textual merge can't catch it |
| Require up to date | Rebase + re-CI before merge — correct but doesn't scale (rebase thrash) |
| Merge queue | Serializes merges, tests each against candidate-future-`main` |
| Speculative batching | Parallel CI on stacked candidates → full throughput; bisect a failed batch |
| Signed commits | Bind commit to a verifiable key — anti-spoofing + provenance |
| Author ≠ approver | Separation of duties — no one ships alone (SOC 2 / PCI) |
| Protections-as-code | Terraform/rulesets — consistent, auditable, reviewable |
| `enforce_admins` | Apply protection to admins too — close the bypass hole |
| Org rulesets | Central, tamper-proof baseline; repos can only add friction |
| Break-glass | Deliberate, logged emergency bypass — fire alarm, not a door |

---

## Summary

- The bank reduces to four distinctions in costumes: **policy vs enforcement**, **textual merge vs semantic correctness**, **"up to date" vs "tested together"**, and **author vs approver vs admin**. Name the distinction first; the toggle follows.
- **Fundamentals:** branch protection is server-enforced, not a convention. The toolbox — require PR, N approvals, CODEOWNERS, required checks, dismiss-stale, no force-push, linear history, signed commits — each defends a specific failure; the skill is choosing risk-proportionally.
- **Merge strategies** are an operational bet: squash optimizes bisect/revert, merge-commit/rebase optimize per-commit backport and forensics. Enforce *one* per repo.
- **Merge queues** are the headline differentiator: the semantic merge conflict is two green PRs that break `main` combined, which textual merge and PR-branch CI can't catch. The queue serializes merges and tests each against the *future* `main`; "require up to date" alone is correct but collapses on throughput. Speculative batching keeps it fast; a failed batch is bisected.
- **Supply chain & compliance:** signed commits give provenance against unauthenticated Git authorship; author≠approver is separation of duties; protections-as-code gives a real audit trail; admin bypass is a break-glass surface to close and instrument, not a convenience.
- **Scale & judgment:** org rulesets are a tamper-proof baseline above per-repo rules; CODEOWNERS bottlenecks are org-design smells (own by team, validate in CI); protect by blast radius — release branches strictest; and a single CODEOWNER on vacation is a policy bug, not an exception to bypass.

---

## Further Reading

- [GitHub — About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — the canonical list of rules and what each enforces.
- [GitHub — Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) — serialization, batching, and configuration.
- [GitHub — About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) — `CODEOWNERS` syntax and pattern precedence.
- [SLSA — Supply-chain Levels for Software Artifacts](https://slsa.dev/) — where signed commits, provenance, and two-person review fit a supply-chain framework.
- [Bors-NG documentation](https://bors.tech/) — the original merge-queue design (the "not rocket science rule") that GitHub's queue and others descend from.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — the mechanics behind these answers, and the at-scale governance that extends them.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/interview.md) — the required status checks that branch protection gates on.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/interview.md) — approval gates extended to the deploy step.
- [07 — Break-glass & Bypass](../07-break-glass-and-bypass/interview.md) — auditing the admin-bypass and emergency-override surface.
- [Code Review](../../code-review/) — the human side of the approval rules CODEOWNERS routes.
- [Release Engineering](../../release-engineering/) — protecting release branches and the backport flows merge strategy enables.
