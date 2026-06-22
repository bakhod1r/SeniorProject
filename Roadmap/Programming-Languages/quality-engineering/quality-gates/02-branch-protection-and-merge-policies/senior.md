# Branch Protection & Merge Policies — Senior Level

> **Roadmap:** [Quality Gates](../README.md) → Branch Protection & Merge Policies
> *The middle page taught you to click the right boxes — require reviews, require status checks, require linear history. This page is about the failure mode those boxes don't see: two pull requests that pass every check in isolation and still break `main` when merged together. Defending against that, at the throughput a large org needs, is a distributed-systems problem dressed up as a settings panel.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Semantic Merge Conflict](#core-concept-1--the-semantic-merge-conflict)
5. [Core Concept 2 — "Require Up to Date" and the Thundering Herd](#core-concept-2--require-up-to-date-and-the-thundering-herd)
6. [Core Concept 3 — Merge Queues as Speculative Execution](#core-concept-3--merge-queues-as-speculative-execution)
7. [Core Concept 4 — Merge-Queue Architectures Compared](#core-concept-4--merge-queue-architectures-compared)
8. [Core Concept 5 — History Models: Merge, Squash, Rebase](#core-concept-5--history-models-merge-squash-rebase)
9. [Core Concept 6 — Signed Commits and the Supply Chain](#core-concept-6--signed-commits-and-the-supply-chain)
10. [Core Concept 7 — CODEOWNERS at Scale](#core-concept-7--codeowners-at-scale)
11. [Core Concept 8 — Governance: Rulesets, Bypass, and Protections as Code](#core-concept-8--governance-rulesets-bypass-and-protections-as-code)
12. [Real-World Examples](#real-world-examples)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The throughput, history, and supply-chain decisions a senior engineer makes when branch protection has to hold a default branch correct across hundreds of merges a day.**

By the middle level you can configure branch protection competently: required reviews, required status checks, CODEOWNERS, "require branches to be up to date before merging," linear history. That configuration is *correct* — and on a busy repository it does not *scale*, because the very setting that guarantees correctness ("up to date before merge") serializes merges and turns the path-to-green into an O(N²) re-test storm.

The senior jump is to see branch protection as the control plane for a pipeline that must satisfy two adversarial goals at once: **never let a broken commit reach `main`**, and **let many engineers merge per hour**. Holding both forces you to confront the *semantic* merge conflict (which `git`'s three-way merge cannot detect), to reason about **merge queues** as speculative, optimistically-batched execution, to choose a **history model** with eyes open about its bisect/revert/backport consequences, and to treat the protections themselves as **supply-chain controls and code** — reviewed, versioned, and impossible to weaken with a quiet click. This page is that layer.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — required reviews, required status checks, CODEOWNERS basics, linear-history and "up to date" toggles, and who can push.
- **Required:** Fluency with `git merge` (three-way merge, merge base), `git rebase`, `git cherry-pick`, and `git bisect`. You should be able to explain what a merge commit's *second parent* is.
- **Helpful:** You've felt a "green PR broke `main`" incident and traced it to *interaction* between two changes, not a flaky test.
- **Helpful:** A working mental model of CI as the gate (see [01 — Required CI Checks](../01-required-ci-checks/senior.md)) — branch protection is the *policy* that makes those checks load-bearing.

---

## Glossary

| Term | Meaning |
|---|---|
| **Semantic / behavioral conflict** | Two changes that merge cleanly textually but produce incorrect behavior when combined. Invisible to `git`. |
| **Require up to date** | Branch-protection rule forcing a PR branch to contain the latest `main` before it may merge — serializes merges. |
| **Merge queue** | A system that orders pending PRs and tests each against the state it *will* merge into, often in speculative batches. |
| **Speculative batch** | Candidate commits `PR₁`, `PR₁+PR₂`, `PR₁+PR₂+PR₃` … built and tested in parallel before any is merged (optimistic batching). |
| **Bisection (of a batch)** | On a failing batch, splitting it to find which PR is the culprit, evicting it, and rebuilding the rest. |
| **First-parent history** | The line of merge commits on `main`; `git log --first-parent` shows one entry per merged PR. |
| **CODEOWNERS** | A file mapping path globs to required reviewers; **last matching pattern wins**. |
| **Separation of duties (SoD)** | A control requiring author ≠ approver (and often ≠ deployer). |
| **Ruleset** | GitHub's layerable, org-or-repo-level successor to classic branch protection, with bypass actor lists and an evaluate/dry-run mode. |
| **Bypass actor** | A user/team/app permitted to merge around a rule — the governed break-glass surface (see [07](../07-break-glass-and-bypass/senior.md)). |
| **SLSA** | *Supply-chain Levels for Software Artifacts*; its source track requires protected branches and two-person review for higher levels. |

---

## Core Concept 1 — The Semantic Merge Conflict

`git`'s three-way merge is a **textual** algorithm. Given the merge base `B` and two tips `O` (ours) and `T` (theirs), it computes line-level diffs `B→O` and `B→T` and combines them; a *conflict* is raised only when both sides edit the **same region** of the **same file**. That is the entire guarantee: textual consistency. It says nothing about whether the merged tree *compiles*, *passes tests*, or *behaves correctly*.

The gap between textual and semantic correctness is where green PRs break `main`. Canonical shapes:

- **Rename + new caller.** PR A renames `getUser()` → `fetchUser()` and updates all existing call sites. PR B (branched before A) adds a new call to `getUser()`. The two touch *different lines* — no textual conflict — but the merged tree references a function that no longer exists. Compilation fails on `main`.
- **Signature change + new call site.** PR A changes `charge(amount)` to `charge(amount, currency)`. PR B adds a fresh `charge(amount)` call. Clean merge, broken build (or worse, a silent default-currency bug in a dynamic language).
- **New test + a violating change.** PR A adds a test asserting balances are never negative. PR B introduces a code path that can produce a negative balance. Neither is wrong alone; together the suite goes red.
- **Lockfile vs manifest.** PR A bumps a dependency in `package.json` and regenerates `package-lock.json`. PR B independently edits `package-lock.json` for a different dependency. Git may merge both lockfile hunks "cleanly" into an internally **inconsistent** lockfile that no longer matches either manifest — an install-time or runtime failure that no human reviewed.

```text
  main:  B ────────────────────────────●  (after merging A, then B)
          \                            /
   PR A:   ●  rename getUser→fetchUser   ← touches lines 10–40
            \                          /
   PR B:     ●  add call to getUser()    ← touches line 200
                                          textually disjoint → merges clean
                                          semantically:  main no longer compiles
```

> **Key insight:** A passing CI run on a PR branch proves the PR is correct *against the base it was tested on*. It proves nothing about correctness against the base it will actually be merged into if `main` has moved. The whole discipline of merge policy exists to close that gap — and `git` itself can never close it, because the conflict is in *meaning*, not text.

This is why "all checks green" is necessary but not sufficient, and why the next concept — forcing each PR to be tested against current `main` — exists at all.

---

## Core Concept 2 — "Require Up to Date" and the Thundering Herd

The straightforward defense against the semantic conflict is **serialization**: require every PR to contain the latest `main` *and* be re-tested before it merges. GitHub spells this "Require branches to be up to date before merging"; GitLab calls the auto-variant "Merge when pipeline succeeds" with semi-linear history. The rule is correct — it guarantees each commit landing on `main` was tested against the exact tree below it — but its cost is brutal at scale.

Consider `N` PRs all green and all wanting to merge. With "up to date" enforced and **no queue**:

1. PR 1 merges. `main` advances.
2. PR 2 through PR N are now *behind*. Each must rebase/merge `main` and **re-run full CI**.
3. PR 2 merges. PR 3 through PR N are behind *again*. Re-rebase, re-test.
4. Repeat.

The result is a re-test storm: in the worst case **O(N²)** CI runs to land `N` PRs, plus a human race — engineers refreshing the page, racing to click "Update branch" then "Merge" before someone else moves `main` out from under them. On a repo merging dozens of PRs an hour, this is the dominant cost in the system, and it gets *worse* as the team grows. It is the classic thundering herd: every state change to `main` invalidates the in-flight work of everyone else, and they all stampede to recover at once.

```text
WITHOUT a queue ("up to date" on):     WITH a merge queue:
  PR2 ⟳ test → PR1 lands → stale         enqueue PR1..PRn once
  PR2 ⟳ test again → PR3 lands → stale   queue builds speculative batch,
  PR2 ⟳ test again → ...                 tests against future main in parallel,
  (humans racing the merge button)       merges the batch if green
  cost: ~O(N²) CI runs                   cost: ~O(N) CI runs, no human race
```

> **Key insight:** "Require up to date" trades throughput for correctness, and the trade is quadratic. You cannot keep the correctness and recover the throughput by hand — the human-in-the-loop *is* the bottleneck and the source of the race. You recover it with a machine that owns the serialization: a merge queue.

---

## Core Concept 3 — Merge Queues as Speculative Execution

A merge queue removes humans from the merge race and recovers throughput by treating "land these PRs" as a **speculative, optimistically-batched** pipeline. The core idea is borrowed straight from CPU speculation: don't wait to know the answer; *bet* on it, do the work in parallel, and roll back the bet that lost.

**The naïve-but-correct baseline.** Maintain a FIFO of approved PRs. For the head PR, construct the *exact tree it would produce on merge* (current `main` + that PR), run CI on **that** candidate, and merge only if green. This is fully serial and fully correct — it tests precisely what will land — but it puts CI latency between every merge: `N` PRs cost `N × (CI time)` of wall-clock serialization.

**Optimistic batching.** To beat that, the queue builds *speculative candidates* and tests them **in parallel**, betting that the queue will mostly pass:

```text
queue order:  PR1, PR2, PR3, PR4
speculative candidates built on top of main:
  C1 = main + PR1
  C2 = main + PR1 + PR2
  C3 = main + PR1 + PR2 + PR3
  C4 = main + PR1 + PR2 + PR3 + PR4
run CI on C1..C4 IN PARALLEL.

if all green:        fast-forward main to C4 → all four land in one CI window
if C3 fails (only):  PR3 is the culprit; merge up to C2 (PR1,PR2),
                     evict PR3, rebuild C3'/C4' without it, retest.
```

When the queue is healthy (most PRs pass), this lands the whole batch in roughly **one** CI window instead of `N`, an `O(N)→O(1)`-ish collapse in *latency*. The price is **wasted CI capacity** on speculation: every candidate runs the full suite, and on a failure you discard the work of every candidate built *above* the culprit.

**Failure isolation = bisection.** When a batch goes red, the queue must find *which* PR broke it, because the failing candidate `C_k` contains `k` PRs. Two strategies:

- **Linear eviction:** assume the *last-added* PR (the one only present in the failing-and-above candidates) is guilty; evict it, rebuild, retest. Cheap when failures are rare and isolated.
- **Bisection:** binary-split the failing batch and re-test halves to localize the culprit in `O(log k)` extra runs — better when batches are large and failures non-trivial. This is exactly `git bisect`'s logic applied to a pending batch.

**The throughput vs latency knob is the batch size.**

| Batch size | Throughput | Latency per PR | CI cost | Failure blast radius |
|---|---|---|---|---|
| 1 (serial) | low | high (CI per PR) | minimal | one PR, trivially isolated |
| moderate | high | low | moderate (speculation) | a handful; bisect to isolate |
| very large | highest *if green* | lowest *if green* | high; one red PR re-tests many | large; one bad PR stalls the batch |

A flaky or frequently-red queue *inverts* the economics: large batches mean a single bad PR repeatedly poisons and re-tests everyone behind it. Mature queues adapt — shrinking batch size when the failure rate rises, growing it when the queue is clean.

**Rollups.** Some systems (Rust's historic Bors workflow, several monorepo queues) let a maintainer hand-pick a set of low-risk PRs into a single **rollup** merge — one CI run, one merge commit — to drain a backlog of trivial changes (doc fixes, dependency bumps) without paying per-PR CI. It's manual batching for cases where you're confident the changes don't interact.

> **Key insight:** A merge queue is speculative execution for `main`. It bets the queue is green, tests `main + PR₁ + … + PRₖ` candidates in parallel, commits the winning bet, and bisects to evict the loser. Batch size is the single dial trading **throughput** (land many at once) against **wasted CI + blast radius** (one red PR poisons the batch). The queue's *correctness* property is the non-negotiable one: it merges only a candidate that was tested **as the exact tree that becomes `main`** — closing the semantic-conflict gap that "up to date before merge" tried to close by hand.

---

## Core Concept 4 — Merge-Queue Architectures Compared

The idea is universal; the implementations differ in where they run, how they batch, and how tightly they bind to the forge.

| System | Origin / model | Batching | Notable properties |
|---|---|---|---|
| **GitHub merge queue** | Native to GitHub; integrated with rulesets | Speculative groups with configurable min/max batch size and a build concurrency cap | Tests `merge_group` refs the forge creates; "Require merge queue" is a branch-protection rule; the queue **re-creates** the commits it lands |
| **Mergify** | SaaS app over GitHub | Configurable speculative checks / batches via YAML rules | Rich rule engine (priorities, conditions, `queue` rules) beyond merging; works without changing your forge |
| **Bors-NG** | Open-source; popularized by the Rust project | `bors r+` enqueues; serial by default, with rollups for batching | Tests a synthetic `staging` branch == "what main will be"; simple, auditable, the canonical teaching model |
| **Zuul** | OpenStack's gating system | **Pipeline of speculative dependent changes** across *multiple* repos | Gates *cross-repo* dependencies — tests change C as if A and B (its declared deps in other repos) already merged; the most sophisticated cross-project gating |
| **Aviator** | SaaS merge automation | Speculative parallel batches, affected-target awareness | Adds queue analytics, flaky-test handling, and monorepo "affected" scoping |

Two architectural axes matter most when choosing:

1. **What does the candidate represent?** All correct queues test *the future state of `main`*, but the granularity differs. Bors tests one `staging` branch; GitHub builds `merge_group` candidates per batch; Zuul builds a *speculative chain* and can span repositories — essential in a multi-repo system where a change's correctness depends on changes in sibling repos landing first.
2. **Forge-native vs external.** A native queue (GitHub) gives you the tightest integration — it *is* the merge button and the protection rule — at the cost of that forge's feature ceiling. An external system (Mergify, Aviator) gives a richer rule language and portability, at the cost of another moving part with broad repo permissions (itself a supply-chain consideration — see Concept 6).

> **Key insight:** Pick the queue by what your "unit of correctness" is. Single repo, simple flow → Bors-NG's serial-with-rollups model is enough and easy to reason about. High throughput on one forge → native GitHub merge queue. **Cross-repo** dependencies where change C only works if A and B land first → you need Zuul-style *speculative dependent pipelines*; nothing simpler will catch that class of semantic conflict.

---

## Core Concept 5 — History Models: Merge, Squash, Rebase

When a PR lands, the queue/forge writes it into `main` in one of three shapes. This choice is not cosmetic — it determines what `git bisect` can localize, how cleanly you can revert or backport, and whether "is this fix on `main`?" is answerable by SHA. Decide it deliberately, per repo.

**Merge commit (`--no-ff`).** Preserves the branch's real commits and records a merge commit whose **second parent** is the branch tip. Ancestry is *true*: `git merge-base` and `git bisect` see the actual topology.

```bash
git checkout main && git merge --no-ff feature   # creates a merge commit M with parents [main, feature]
git revert -m 1 <M>                               # revert the ENTIRE PR in one command (-m 1 = keep first parent)
git log --first-parent                            # one line per PR — the "PR-level" history
```

- **Bisect:** sees every intermediate commit; `git bisect --first-parent` narrows to the PR, then drills inside if needed. Most flexible.
- **Revert:** trivial and atomic — `git revert -m 1 <merge>` undoes the whole PR.
- **Cost:** noisier graph (every WIP commit on `main`), and naïve `git bisect` may land on a broken *intermediate* branch commit unless you constrain to first-parent.

**Squash.** Collapses the whole PR into **one new commit** on `main`; the branch's individual commits are discarded from `main`'s history.

```bash
git merge --squash feature && git commit   # ONE commit on main; branch SHAs do not appear on main
```

- **Bisect:** beautifully clean — each commit on `main` *is* exactly one PR, so bisect localizes to a PR in `O(log N)` with no broken intermediates. The best bisect granularity for "which PR did this."
- **Revert:** one `git revert <sha>` undoes the PR.
- **Cost — the big one:** the commit on `main` is a **brand-new object** that never existed on the branch. So `git cherry-pick`/backport to a release branch picks a commit whose SHA and contents differ from anything the author worked on, and **"is commit X on `main`?" by SHA is permanently false** — the branch SHAs were never merged. Teams that backport heavily, or answer "did this fix ship?" by SHA, feel this friction constantly. `git cherry` and patch-id help but don't fully restore identity.

**Rebase-and-merge.** Replays the branch's commits onto `main` with **no merge commit**, producing a linear history of the *original* commits — but **rewritten** (new SHAs, new parents).

```bash
git rebase main feature && git checkout main && git merge --ff-only feature   # linear, no merge commit
```

- **Bisect:** linear and fairly clean (per-commit), but each commit must independently build/pass or bisect hits false reds.
- **Revert:** a multi-commit PR needs multiple reverts (no single merge commit to undo).
- **Cost:** rewriting commits **invalidates GPG/SSH signatures** the author made (the commit object changed), and rewritten SHAs again break "by-SHA" identity. The cleanest *linear* history, the worst for signed-commit provenance.

**The trade-off matrix:**

| Property | Merge commit | Squash | Rebase-and-merge |
|---|---|---|---|
| History shape | branchy, true ancestry | linear, 1 commit/PR | linear, N commits/PR |
| `git bisect` granularity | per-commit (use `--first-parent`) | **per-PR (cleanest)** | per-commit |
| Broken intermediates on `main`? | possible | no | possible |
| Revert a whole PR | **`revert -m 1` (atomic)** | one `revert` | N reverts |
| Backport / cherry-pick fidelity | **high (commits preserved)** | low (new synthetic SHA) | medium (rewritten SHAs) |
| "Is X on `main`?" by SHA | **yes** | **no** | no |
| Author signatures survive | **yes** | no (new commit) | **no (rewritten)** |
| `--first-parent` = PR list | **yes** | n/a (already 1/PR) | no merge commits |

> **Key insight:** There is no free history model — you are choosing *which* operation stays cheap. **Squash** optimizes for clean per-PR bisect and an atomic-per-PR `main` at the cost of backport fidelity and SHA identity. **Merge** optimizes for true ancestry, atomic revert, and backportability at the cost of a noisier graph. **Rebase** optimizes for linear history at the cost of signatures and SHA identity. Heavy backporting → merge. Bisect-driven monorepo with little backporting → squash. And note the collision with Concept 6: squash and rebase both **create new commits**, so the *queue/forge* — not the author — is the last signer, which is exactly what the supply chain must account for.

---

## Core Concept 6 — Signed Commits and the Supply Chain

Branch protection is not only a quality gate; it is a **supply-chain control**. Its job is to ensure that what reaches `main` was *authored and reviewed by authorized humans* and *not silently injected*. Two mechanisms make that enforceable.

**Required signing + verified commits.** Require that commits on the protected branch be cryptographically signed and *verified* against a known key. Three signing technologies are in play:

```bash
# GPG (classic)
git config user.signingkey <KEYID>
git commit -S -m "..."          # GPG-signed; forge shows "Verified" if the key is on the account

# SSH signing (no GPG keyring needed; reuse your auth key)
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git commit -S -m "..."

# Sigstore gitsign — keyless, OIDC-backed, short-lived certs (Fulcio) + transparency log (Rekor)
gitsign commit -m "..."         # signs with an ephemeral cert tied to your OIDC identity; logged in Rekor
```

A ruleset can then **require signed commits**, rejecting unsigned or unverifiable pushes. This raises the bar from "had push access" to "proved identity with a key," which is what defends against a stolen-but-unsigned-token push or a fabricated author.

**The merge-queue ⨯ signing interaction — a real gotcha.** Squash, rebase, *and* merge-queue landings all **create new commit objects** server-side. The author's signature does **not** carry onto a re-created commit — so a "require signed commits" rule and an auto-merge/queue flow appear to conflict: the thing that lands isn't the thing the author signed.

The resolution is that the **forge/queue becomes a signer**. GitHub signs commits it creates on your behalf with its own key, so queue-landed and web-merged commits show as `Verified` (signed by GitHub, not the author). With gitsign-style flows, the *CI identity* signs the landed artifact. Either way, the provenance story shifts: the trustworthy claim is no longer "the author signed this exact commit" but "an authorized identity (the author via review approval + the forge via its signing key) produced this commit through a protected, reviewed path." You must design the policy to *expect* forge-signed commits, or your own rule will block your own queue.

> **Key insight:** Once a queue or squash/rebase re-creates commits, the *last signer is the platform, not the author*. Required-signing policy must therefore trust the forge/CI signing identity, and your provenance argument rests on the **protected path** (review + queue + signing) rather than on author-signature-on-final-SHA. Conflating the two produces a policy that rejects your own merges.

**Branch protection as a SLSA source control.** Frameworks like **SLSA** treat the source repository as part of the supply chain. Its source-track expectations — *two-person review*, *protected branches*, *retained history* — map directly onto branch-protection settings: required reviews (with author≠approver), no force-push, no branch deletion, required status checks, and signed/verified commits. In other words, your branch-protection ruleset is the *evidence* for a chunk of your SLSA source posture, and weakening it silently weakens that posture. (The artifact-side of provenance — signing the *build outputs* — lives in [Release Engineering](../../release-engineering/); branch protection is the *source* half.)

---

## Core Concept 7 — CODEOWNERS at Scale

`CODEOWNERS` maps path globs to owners and, wired into branch protection as **require review from Code Owners**, routes mandatory review to the people responsible for the touched code. The semantics are small but have sharp edges that only bite at scale.

**Last match wins.** Patterns are evaluated top-to-bottom and the **last** matching pattern for a path determines its owners — *not* the most specific, not the union. This is the inverse of `.gitignore`-style intuition for some, and the source of most "why wasn't the right team requested?" confusion.

```bash
# .github/CODEOWNERS  — order matters; LAST match wins
*                       @org/platform           # catch-all default owner
/services/              @org/backend
/services/payments/     @org/payments @org/security-reviewers   # overrides backend for this subtree
/services/payments/docs/ @org/tech-writers      # overrides again for docs under payments
*.tf                    @org/infra              # a LATER blanket *.tf line would override the lines above
                                                #   for ANY .tf file — even under payments. Order with care.
```

**Performance and the monorepo.** In a large monorepo, `CODEOWNERS` can grow to thousands of lines, and for *every* changed path the forge must find the last-matching pattern. Naïve linear matching is `O(patterns × files)` per PR; this is real latency on big PRs and a reason to keep the file ordered, deduplicated, and as flat as the routing allows. **Nested CODEOWNERS** (a `CODEOWNERS` file *inside* a subdirectory, supported by GitHub) lets a subtree own its routing locally, which both improves locality and lets teams manage their own ownership without editing one giant global file.

**Ownership as code — and its failure modes.** Encoding ownership in a versioned, reviewed file is the right move (it's auditable, diffable, and itself protectable). But at scale three pathologies appear:

- **Stale owners / bus factor.** An owning team reorgs or a person leaves; their glob still routes reviews to a ghost. PRs stall on a required review nobody can give. You need *tooling* to detect owners with no active members, and a policy that ownership entries are reviewed like code.
- **The overloaded-team bottleneck.** "Everything is owned by `@org/platform`" makes platform a required reviewer on every PR in the company — a throughput catastrophe and a morale one. Required ownership must be distributed to match real responsibility, or it becomes a single serialization point worse than any merge queue.
- **Routing ≠ knowledge.** Owning a path by glob does not mean the owner understands the change. CODEOWNERS routes *accountability*, not competence; pair it with the review-quality practices in [Code Review](../../code-review/).

> **Key insight:** CODEOWNERS is *required-reviewer routing as code*, governed by **last-match-wins**. Its scaling failures are organizational, not technical: stale owners block merges, and a single overloaded owner becomes the bottleneck the whole repo waits on. Treat the file as a living ownership map — reviewed, de-duplicated, nested where it helps locality — not a one-time setup you forget until it routes a critical PR to a team that no longer exists.

---

## Core Concept 8 — Governance: Rulesets, Bypass, and Protections as Code

The last senior responsibility is governing the protections themselves: layering them, controlling who may bypass, rolling them out safely, and making them un-silently-weakenable.

**Rulesets layering and separation of duties.** GitHub **rulesets** supersede classic branch protection: they're definable at the **org or repo** level, multiple rulesets *layer* (the effective policy is the union — the *most* restrictive wins per rule), and they carry explicit **bypass actor lists** and an **evaluate (dry-run) mode**. A core control to encode here is **separation of duties**: `require_review` with the *dismiss-stale* and *require-last-push-approval* options enforces **author ≠ approver**, which is both an engineering quality control and a compliance requirement (SOX/PCI/SLSA all want it). The subtlety: SoD is only real if the *bypass list* doesn't quietly readmit the author — an admin who can approve their own PR by bypassing defeats the control.

**Bypass = the break-glass surface.** Every rule with a bypass actor is a documented hole. "Include administrators" / a bypass-app entry is how the gate gets opened at 3 a.m. — legitimately, sometimes — but it is exactly the surface that must be *minimized, logged, and time-boxed*. The full treatment of doing this safely (pre-authorized, audited, after-the-fact justification) is [07 — Break-glass & Bypass](../07-break-glass-and-bypass/senior.md); the point here is that bypass is a *property of the ruleset* and must be reviewed as carefully as the rule it bypasses.

**Evaluate / dry-run for safe rollout.** Turning on a strict rule cold on a busy repo blocks people mid-flight. Ruleset **evaluate mode** records what *would* have been blocked without enforcing — you ship the rule in evaluate, read the would-have-blocked signal for a week, fix the surprises, then promote to active. This is the canary deploy for policy.

**Ring / release-branch differences.** Protection is rarely uniform. A typical layering:

- `main` (trunk): require reviews + CODEOWNERS + green checks + queue + signed commits + linear-or-merge history.
- `release/*` (stabilization): *stricter* — require a release manager's approval, possibly a CAB sign-off (see [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/senior.md)), narrower bypass list, and *no* direct pushes; only cherry-picks of already-merged fixes.
- `dev`/integration rings (if used): looser, faster, to let work converge before promotion.

The rules differ because the *cost of a bad commit* differs by branch — a broken `release/*` blocks a ship; a broken integration ring blocks only that ring.

**Protections as code — the resilience requirement.** Clicked-in settings have no review, no history, and no diff — anyone with admin can weaken them silently, and you'd learn only post-incident. Manage them as code (Terraform's GitHub provider, or the equivalent) so changes are *reviewed PRs*, *versioned*, and *drift-detectable*:

```hcl
# Terraform — github_repository_ruleset (illustrative)
resource "github_repository_ruleset" "main_protection" {
  name        = "protect-main"
  repository  = "payments-service"
  target      = "branch"
  enforcement = "active"               # flip to "evaluate" first for a safe rollout

  conditions {
    ref_name { include = ["refs/heads/main"] exclude = [] }
  }

  rules {
    pull_request {
      required_approving_review_count   = 2          # SLSA two-person review
      require_code_owner_review         = true       # CODEOWNERS routing enforced
      require_last_push_approval        = true       # author ≠ approver (SoD)
      dismiss_stale_reviews_on_push     = true
    }
    required_status_checks {
      strict_required_status_checks_policy = true     # "up to date before merge"
      required_check { context = "ci/build-and-test" }
      required_check { context = "ci/sast" }
    }
    required_signatures   = true                       # signed/verified commits
    required_linear_history = true
    non_fast_forward      = true                       # no force-push to main
    deletion              = true                        # no deleting main
    merge_queue {
      merge_method     = "SQUASH"
      max_entries_to_build = 5                          # speculative batch cap (throughput vs blast radius)
      min_entries_to_merge = 1
    }
  }

  bypass_actors {
    actor_id    = data.github_team.incident_commanders.id
    actor_type  = "Team"
    bypass_mode = "pull_request"     # the ONLY documented break-glass path → see topic 07
  }
}
```

Because this is a PR, weakening the policy (dropping `required_approving_review_count` to 1, widening `bypass_actors`) is itself a reviewable, blockable, audited change — you cannot quietly remove the gate, which is the entire point. The general discipline of expressing gate rules as versioned, testable policy is [06 — Policy as Code](../06-policy-as-code/senior.md); this is its application to the branch.

> **Key insight:** The protections must be at least as governed as the code they protect. Rulesets layer (most-restrictive-wins), **bypass actors are the break-glass surface**, **evaluate mode** is the safe-rollout canary, and managing the whole thing in **Terraform** turns "someone silently lowered the gate" into "a reviewed PR that someone had to approve." A gate you can weaken with one un-reviewed click is not a control — it's a suggestion.

---

## Real-World Examples

**1. Rust's gating (Bors → merge queue).** The Rust project popularized gated merging precisely because its CI is expensive and a broken `master` blocks thousands of contributors. `bors r+` enqueues a PR; bors tests a synthetic `auto`/`staging` branch == "what master will become," and only fast-forwards master if green — *never* merging an untested combination. **Rollups** batch many trivial PRs (doc fixes, small libs) into one CI run to drain the backlog. This is the canonical "test the future state of main, serialized, with optional manual batching" model.

**2. OpenStack's Zuul — cross-repo speculative gating.** OpenStack spans dozens of interdependent repos. Zuul's gate pipeline builds a *speculative chain* of dependent changes across repositories: a change to `nova` that declares a dependency on a `keystone` change is tested **as if** the keystone change already merged. This catches the cross-repo semantic conflict — a class no single-repo queue can see — and is why Zuul remains the reference for multi-project gating.

**3. A monorepo with native GitHub merge queue + squash + signing.** A large company sets a Terraform-managed ruleset on `main`: 2 approvals, CODEOWNERS routing, `ci/build-and-test` + `ci/sast` required, **squash** history (clean per-PR bisect across a huge tree), **merge queue** with `max_entries_to_build = 8`, **required signatures**. The queue (not authors) signs landed commits via GitHub's key; CODEOWNERS is *nested* per top-level service to keep matching fast and ownership local. Backports are rare here, so squash's SHA-identity cost is acceptable — a deliberate Concept-5 trade.

**4. A library team that backports heavily.** A platform library maintains `main` plus three supported `release/*` lines and constantly cherry-picks fixes backward. They choose **merge-commit** history specifically so `git revert -m 1` is atomic and so cherry-picks carry the *original* commits (high backport fidelity), and they answer "is this fix on `main`?" by SHA — which squash would have made impossible. Their `release/*` branches have a stricter ruleset (release-manager approval, no direct push, narrow bypass) than `main`.

---

## Mental Models

- **Git guarantees text, not meaning.** Three-way merge resolves overlapping *lines*; it has no model of compilation, tests, or behavior. Every "green PR broke main" is a semantic conflict, and every merge policy is an attempt to test *meaning* against the real target state.

- **A merge queue is a speculative CPU pipeline for `main`.** It bets the queue is green, builds `main + PR₁ + … + PRₖ` candidates, runs them in parallel, commits the winning bet, and bisects to evict the loser. Batch size is the speculation depth — deeper bets, bigger wins when green, bigger rollbacks when red.

- **"Up to date before merge" is O(N²) by hand and O(N) by queue.** The correctness it buys (each landed commit was tested against the tree below it) is the same; the queue just removes the human from the serialization loop, killing the thundering herd.

- **History is a budget — you choose which operation stays cheap.** Squash buys clean bisect and pays in backport fidelity; merge buys atomic revert and true ancestry and pays in graph noise; rebase buys linearity and pays in signatures and SHA identity. Pick by how often you bisect vs backport vs verify-by-SHA.

- **Protections are supply chain and protections are code.** Branch protection is the *source* half of SLSA (two-person review, protected branch, signed commits); managing it in Terraform is what stops the gate from being silently lowered. The last signer of a queue-landed commit is the platform, not the author — design policy to expect that.

---

## Common Mistakes

1. **Believing "all checks green" means safe to land.** Green proves the PR is correct *against the base it was tested on*. If `main` moved, a semantic conflict can still break it. Either require up-to-date testing or use a merge queue — green-on-a-stale-base is the #1 way a tested PR breaks `main`.

2. **Enforcing "require up to date" on a busy repo with no queue.** This is correct but quadratic: every merge invalidates everyone else's branch, triggering a re-test storm and a human merge race. Add a merge queue the moment merge volume makes the page-refresh race a thing.

3. **Choosing squash history while backporting heavily.** Squash creates a *new* commit on `main`; the branch SHAs were never merged, so cherry-picks are low-fidelity and "is X on `main`?" by SHA is permanently false. If you backport a lot, prefer merge-commit history.

4. **Assuming rebase/queue preserves the author's signature.** Rebase rewrites commits and the queue re-creates them — the author's GPG/SSH signature does not survive. Configure the forge/CI to sign landed commits and write your required-signing policy to trust that platform identity, or your own queue gets blocked.

5. **Misreading CODEOWNERS as most-specific-wins.** It is **last-match-wins**. A later blanket pattern (e.g. a trailing `*.tf @infra`) silently overrides earlier, more specific lines for those files. Order the file deliberately and test routing.

6. **Routing everything to one team.** "`* @org/platform`" makes one team a required reviewer on every PR — a worse serialization point than any merge queue, and a path to reviewer burnout. Distribute required ownership to match real responsibility.

7. **Leaving SoD with a self-approval bypass.** Requiring author≠approver but listing admins (who can approve their own PRs) on the bypass list defeats the control. Separation of duties is only as strong as the *narrowest* bypass actor.

8. **Clicking protections in instead of coding them.** Web-UI settings have no review, history, or diff — anyone with admin can weaken them silently. Manage rulesets in Terraform so weakening the gate is itself a reviewed, audited PR, and roll new rules out in *evaluate* mode first.

---

## Test Yourself

1. Two PRs pass all checks independently but break `main` when both merge. Name the phenomenon, give a concrete example, and explain why `git`'s merge algorithm cannot detect it.
2. Why does "require branches to be up to date before merging," with no merge queue, cost roughly O(N²) CI runs to land N PRs? What does a merge queue change?
3. Describe how a speculative merge queue lands four queued PRs in roughly one CI window, and exactly what it does when the third candidate fails.
4. What is the throughput-vs-latency knob in a merge queue, and how should it respond when the queue's failure rate rises?
5. You bisect heavily and rarely backport. Which history model do you choose and why? Now flip it: you backport constantly and answer "is this fix on main?" by SHA — which model, and what does the other one cost you?
6. A "require signed commits" rule and a merge queue seem to conflict. Why, and how is it resolved without disabling either?
7. CODEOWNERS has `*.tf @infra` as the last line and `/services/payments/ @payments @security` earlier. Who is required to review a change to `/services/payments/main.tf`, and why?
8. Why manage branch-protection rulesets in Terraform rather than the web UI, and what does *evaluate* mode buy you on rollout?

<details>
<summary>Answers</summary>

1. The **semantic (behavioral) merge conflict**. Example: PR A renames `getUser()`→`fetchUser()` and updates existing callers; PR B (branched earlier) adds a *new* call to `getUser()`. They edit different lines → no textual conflict → clean merge → `main` no longer compiles. `git`'s three-way merge is purely **textual**: it raises a conflict only when both sides edit the same region of the same file. It has no model of compilation, tests, or behavior, so a meaning-level inconsistency is invisible to it.

2. With "up to date" and no queue, every successful merge advances `main` and makes *all other* in-flight PRs stale; each must re-merge `main` and re-run full CI before it can merge — and this repeats after each merge, giving ~O(N²) CI runs plus a human race to click merge before `main` moves again. A merge queue takes ownership of serialization: it enqueues PRs once and tests them against the future state of `main` (often in speculative batches) without humans racing, collapsing the cost toward O(N).

3. Build speculative candidates `C1=main+PR1`, `C2=main+PR1+PR2`, `C3=…+PR3`, `C4=…+PR4` and run CI on all four **in parallel**, betting the queue is green; if all pass, fast-forward `main` to `C4` — four PRs land in one CI window. If **C3 fails** (and C2 passed), PR3 is the culprit: merge up to `C2` (PR1, PR2), evict PR3, rebuild `C3'/C4'` without it, and retest. (For large batches, bisect the failing batch to localize the culprit in O(log k) extra runs.)

4. The **batch size** (speculation depth). Larger batches → higher throughput and lower per-PR latency *when the queue is green*, but more wasted CI on speculation and a larger blast radius when a PR is red (it poisons and re-tests everyone above it). When the failure rate rises, the queue should **shrink** batch size (limit the damage of each red PR) and grow it again when the queue is clean.

5. Bisect-heavy, backport-light → **squash**: each commit on `main` *is* exactly one PR, giving the cleanest per-PR bisect with no broken intermediates. Backport-heavy + verify-by-SHA → **merge-commit**: it preserves the branch's real commits (high cherry-pick/backport fidelity), `git revert -m 1` undoes a whole PR atomically, and the merged SHAs actually exist on `main` so "is X on main?" by SHA works. Squash would cost you all of that — it creates a *new* synthetic commit, so backports are low-fidelity and by-SHA identity is permanently broken.

6. Squash, rebase, and queue landings all **create new commit objects** server-side, so the author's signature (made on a different commit) does not carry to the landed commit — a naïve "require signed commits" rule would reject it. Resolution: the **forge/queue signs the commits it creates** (GitHub signs with its key → shows `Verified`; gitsign-style flows have the CI identity sign). Write the policy to trust that platform/CI signing identity; provenance then rests on the protected path (review + queue + signing), not on author-signature-on-final-SHA.

7. **`@infra`** alone — because CODEOWNERS is **last-match-wins**, and `*.tf @infra` is the *last* line matching `/services/payments/main.tf`. It overrides the earlier `/services/payments/` ownership for any `.tf` file, which is precisely the ordering trap: a trailing blanket pattern silently steals ownership of matching files from more specific earlier lines.

8. Web-UI settings have no review, no history, and no diff, so any admin can silently weaken them and you'd find out only after an incident. In Terraform, the ruleset is versioned and changes are **reviewed PRs** (lowering review count or widening bypass actors is itself blockable/audited), and drift is detectable. **Evaluate mode** records what a rule *would* have blocked without enforcing — a policy canary that lets you find surprises and fix them before promoting the rule to active, instead of blocking people mid-flight.

</details>

---

## Cheat Sheet

```text
THE PROBLEM
  git merge = TEXTUAL consistency only (overlapping lines)  →  NOT semantic
  semantic conflict: two green PRs that break main when combined
    rename+caller · signature change+new call · new test+violating change · lockfile vs manifest

SERIALIZATION
  "require up to date before merge"  → correct, but O(N²) re-test storm + human merge race
  merge queue                        → owns serialization, O(N), no race

MERGE QUEUE = SPECULATIVE EXECUTION
  candidates: C1=main+PR1, C2=+PR2, C3=+PR3 …  run in PARALLEL (optimistic batch)
  all green → fast-forward to top candidate (many land in 1 CI window)
  batch red → bisect/evict culprit, rebuild above it
  batch size = throughput vs (wasted CI + blast radius);  shrink when flaky, grow when clean
  rollups = manual batch of trivial PRs into one CI run
  systems: GitHub merge queue · Mergify · Bors-NG · Zuul (cross-repo) · Aviator

HISTORY MODELS                      bisect      revert        backport     by-SHA   author-sig
  merge --no-ff (true ancestry)     per-commit  -m 1 atomic   HIGH         yes      kept
  squash (1 commit/PR)              PER-PR best one revert     low (new SHA) NO      no (new)
  rebase (linear, rewritten)        per-commit  N reverts     medium       no       NO (rewritten)
  rule of thumb: bisect-heavy→squash · backport-heavy→merge · linear-purist→rebase

SUPPLY CHAIN
  required signed commits: GPG / SSH (gpg.format ssh) / sigstore gitsign (keyless, Rekor)
  queue/squash/rebase RE-CREATE commits → FORGE/CI signs, not author → trust platform identity
  branch protection = SLSA SOURCE control: 2-person review, protected branch, no force-push

CODEOWNERS (last-match-wins!)
  later blanket pattern overrides earlier specific ones  →  order deliberately
  scale: nested CODEOWNERS for locality · watch stale owners · don't route everything to one team

GOVERNANCE
  rulesets layer (most-restrictive wins) · bypass actors = break-glass surface (topic 07)
  SoD = author≠approver (require_last_push_approval) — kill self-approval bypass
  EVALUATE/dry-run mode = policy canary · manage in Terraform (reviewed, versioned, drift-detectable)
  release/* stricter than main; integration rings looser
```

---

## Summary

- `git`'s three-way merge guarantees **textual**, not **semantic**, consistency. Two PRs that pass CI in isolation can break `main` when combined — the **semantic merge conflict** (rename+caller, signature change+call site, new test+violating change, lockfile vs manifest) — and `git` can never detect it because the conflict is in meaning, not text.
- **"Require up to date before merging"** closes that gap by serializing, but by hand it costs ~O(N²) re-test runs and a human merge race. A **merge queue** recovers throughput by owning the serialization.
- A merge queue is **speculative execution for `main`**: build `main + PR₁ + … + PRₖ` candidates, test in parallel (optimistic batching), commit the winning bet, and **bisect to evict** the loser. **Batch size** trades throughput against wasted CI and blast radius. Architectures range from serial Bors-NG (with rollups) to native GitHub merge queue to **Zuul's cross-repo speculative pipelines**.
- **History model** is a budget: **squash** = best per-PR bisect, worst backport/SHA-identity; **merge** = true ancestry, atomic revert, best backport; **rebase** = linear, but rewrites SHAs and breaks signatures. Choose by how often you bisect vs backport vs verify-by-SHA.
- **Required signed commits** (GPG/SSH/gitsign) make branch protection a supply-chain control and the **SLSA source** half — but squash/rebase/queue **re-create commits**, so the *platform* becomes the last signer; design policy to trust that.
- **CODEOWNERS** is required-reviewer routing as code with **last-match-wins** semantics; its scaling failures (stale owners, the overloaded-team bottleneck) are organizational. **Governance** — layered rulesets, minimized **bypass** surfaces, **evaluate-mode** rollout, and protections in **Terraform** — is what keeps the gate from being silently lowered.

You now reason about branch protection as a throughput-and-provenance system, not a settings panel. The next layer — [professional.md](professional.md) — is about operating these policies across an organization: migrating a busy repo onto a queue, debating history models with a release team, and defending the gate (and its bypass) in an audit.

---

## Further Reading

- [GitHub — About merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) and [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) — the native queue model (`merge_group`, batch sizing) and the layered, bypass-aware ruleset system.
- [Bors-NG documentation](https://bors.tech/documentation/) and the Rust "Not Rocket Science Rule" essay — the canonical *test-the-future-state-of-main* gating model, with rollups.
- [Zuul — Project Gating](https://zuul-ci.org/docs/zuul/latest/gating.html) — speculative, cross-repo dependent-change gating; the reference for multi-project semantic-conflict prevention.
- [SLSA — Source track requirements](https://slsa.dev/spec/v1.0/requirements) — two-person review, protected branches, and retained history as supply-chain controls that map onto branch protection.
- [sigstore gitsign](https://docs.sigstore.dev/cosign/signing/gitsign/) — keyless, OIDC-backed commit signing with a transparency log; the modern signed-commit option.
- Google's writing on [Trunk-Based Development](https://trunkbaseddevelopment.com/) and large-scale monorepo engineering — why short-lived branches, fast merges, and aggressive gating are the throughput strategy at scale.
- Pointer onward: [professional.md](professional.md) — operating merge policy across an org, migrations, audits, and incident response.

---

## Related Topics

- [01 — Required CI Checks](../01-required-ci-checks/senior.md) — the status checks branch protection makes load-bearing; flaky required checks are what poison a merge queue.
- [04 — Deploy Approvals & Sign-offs](../04-deploy-approvals-and-signoffs/senior.md) — the *deploy-time* analog of merge approvals, and where release-branch CAB sign-offs and separation of duties extend past `main`.
- [06 — Policy as Code](../06-policy-as-code/senior.md) — codifying gate rules (including these rulesets) as versioned, testable, reviewable policy instead of clicked-in settings.
- [Code Review](../../code-review/) — CODEOWNERS routes *who must review*; this is *how to review well* so the required review actually catches defects.
- [Release Engineering](../../release-engineering/) — the artifact/build half of provenance (signing outputs, SLSA build track) that complements branch protection's source half.
