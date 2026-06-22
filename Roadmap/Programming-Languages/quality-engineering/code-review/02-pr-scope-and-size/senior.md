# PR Scope & Size — Senior Level

> **Roadmap:** [Code Review](../README.md) → PR Scope & Size
> *The earlier tiers taught you to keep PRs small. This page is about why size is the dominant variable in review economics — how it couples to latency, WIP, and merge-conflict cost — and how a senior actually decomposes a hard change: preparatory refactoring, expand/contract, branch-by-abstraction, the strangler fig, and stacked diffs with their real rebase mechanics.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Flow Economics of PR Size](#core-concept-1--the-flow-economics-of-pr-size)
5. [Core Concept 2 — The Defect-Detection Curve and the Attention Budget](#core-concept-2--the-defect-detection-curve-and-the-attention-budget)
6. [Core Concept 3 — Decomposition as the Senior Skill](#core-concept-3--decomposition-as-the-senior-skill)
7. [Core Concept 4 — Mechanical vs Semantic, and Why It Halves Review Cost](#core-concept-4--mechanical-vs-semantic-and-why-it-halves-review-cost)
8. [Core Concept 5 — The Big-Migration Patterns](#core-concept-5--the-big-migration-patterns)
9. [Core Concept 6 — Stacked Diffs in Real Depth](#core-concept-6--stacked-diffs-in-real-depth)
10. [Core Concept 7 — Trunk-Based Development and Feature Flags as the Enabler](#core-concept-7--trunk-based-development-and-feature-flags-as-the-enabler)
11. [Core Concept 8 — When Big PRs Are Unavoidable](#core-concept-8--when-big-prs-are-unavoidable)
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

> Focus: **Why size is the single highest-leverage variable in review quality, and the concrete decomposition and stacking techniques a senior uses to ship hard changes as small, reviewable units.**

The junior advice — "keep PRs under a few hundred lines" — is correct, but it is an instruction, not a model. By the senior level you need the model, because you will be the one telling a teammate that their 1,800-line migration *can* be split, showing them *how*, and defending the extra review-event count to a skeptical manager who sees ten small PRs and thinks "more overhead."

The model has two halves. The first is **flow economics**: PR size is not a code-quality knob, it is a *queueing* knob. A large PR sits longer in the review queue, and while it sits, `main` moves underneath it, so its merge-conflict and rework cost grows *superlinearly* with time-in-review. The second is **decomposition strategy**: the senior skill of taking a change that *feels* atomic and factoring it into a sequence of independently-correct, independently-reviewable, independently-revertible steps — through preparatory refactoring, parallel-change, branch-by-abstraction, the strangler fig, and stacked diffs.

This page treats both rigorously. The throughline is that small PRs are not a stylistic preference; they are the dominant term in the equation that determines how fast and how safely your organization ships, and decomposition is the engineering that makes them achievable for changes that don't *look* small.

---

## Prerequisites

- **Required:** You've internalized [professional.md](professional.md) — the review-workflow mechanics, what a reviewable PR looks like, and the basic size guidance.
- **Required:** You're fluent with `git rebase`, `git rebase --onto`, interactive history editing, and reading a three-way merge conflict without panic.
- **Helpful:** You've felt the pain of a long-lived feature branch that rebased against a moving `main` for a week — the rework that compounds is the thing this page formalizes.
- **Helpful:** A working memory of Little's Law and basic queueing intuition (throughput, WIP, latency); we use it directly.

---

## Glossary

| Term | Meaning |
|---|---|
| **Flow / WIP** | Work-in-progress: the number of changes in flight (open, in review, not yet merged). High WIP raises latency per Little's Law. |
| **Little's Law** | `L = λ × W`: average items in a system (`L`) equals arrival rate (`λ`) times average time-in-system (`W`). Rearranged: latency `W = L / λ`. |
| **Time-in-review** | Wall-clock from "PR ready" to "merged." Dominated by *scheduling latency* (waiting for a reviewer), not reading time. |
| **Stacked diff / PR stack** | A linear (or DAG) chain of PRs where each builds on the previous, reviewed and merged in dependency order. |
| **Preparatory refactoring** | Restructuring code *before* a feature so the behavioral change becomes trivial — "make the change easy, then make the easy change" (Beck). |
| **Parallel change / expand-contract** | Add the new form (expand), migrate callers, remove the old form (contract) — three PRs, never a breaking big-bang. |
| **Branch by abstraction** | Introduce an abstraction layer over the thing being replaced, swap implementations behind it incrementally, then remove the layer. |
| **Strangler fig** | Incrementally route traffic/functionality from an old system to a new one until the old one is dead and removable. |
| **Codemod / mechanical change** | A scripted, semantics-preserving transformation applied across many files (e.g., `jscodeshift`, `gofmt -r`, `comby`, OpenRewrite). |
| **Blast radius** | The scope of systems/users affected if a change is wrong. Small PRs → small blast radius → cheap, surgical reverts. |

---

## Core Concept 1 — The Flow Economics of PR Size

Treat your change-delivery pipeline as a queueing system. PRs arrive, wait for a reviewer, get reviewed, and merge. The metric that matters for the *organization* is **flow latency** — how long a unit of value takes from "I started" to "it's in `main`" — and the metric that matters for an *engineer* is how much of their day is rework versus forward progress. Size drives both.

**Little's Law gives the first-order result.** With `W = L / λ`, if reviewers process changes at a roughly fixed rate `λ` (bounded by their attention budget — Concept 2), then making PRs bigger increases `L` (each PR represents more in-flight work and sits longer) and the *latency per change* climbs. The counterintuitive part: splitting one big PR into five small ones does **not** five-times the cost, because the small ones flow through the queue with far lower per-item latency and can be reviewed *in parallel by different reviewers or interleaved into the gaps* between a reviewer's other tasks. A 400-line PR can be reviewed in one focused sitting; a 2,000-line PR requires *scheduling a block of time that doesn't exist*, so it waits — often days.

**The conflict cost is the superlinear term, and it's the one engineers underestimate.** A PR's diff is computed against a base. The longer the PR lives, the more `main` advances past that base, and the more likely an incoming commit touches the same lines. Model it roughly: if the probability that any given merged commit conflicts with your open PR is `p` (proportional to your PR's *surface area* — files and lines touched), and `n` commits land on `main` while you wait (proportional to your *time-in-review*), then your expected conflict count scales like `p × n`. Both factors grow with size: a bigger PR touches more surface (`p` up) *and* takes longer to review (`n` up). So conflict/rework cost scales roughly with the **product** of surface and time — superlinear in "bigness." This is why a week-old large branch can spend more engineer-hours on rebases than the original change took to write.

```
flow-latency  ≈  scheduling-wait(size)  +  reading-time(size)
                 └─ the dominant term ──┘    └─ the small term ─┘

rework-cost   ≈  surface(size)  ×  commits-landed-during-review(time-in-review(size))
                 └──────────── grows superlinearly with size ───────────────┘

context-switch-cost(author)  ≈  (time-in-review)  ×  (cost of paging the change back in)
```

> **Key insight:** PR size is a *queueing* variable, not a code-quality variable. It couples size → time-in-review → WIP → conflict/rework cost, and the conflict term grows with the **product** of surface area and time-in-review, which is why "one big PR" is almost always more total work than "a stack of small ones," even before you count review quality.

There's a third coupling: **author context-switch cost.** While a big PR waits, the author moves on. When review comments arrive days later, they must page the entire change back into working memory — a fixed-ish cost paid *per review round*, and big PRs generate more rounds (more surface → more comments → more back-and-forth). Small PRs merge before the author has fully unloaded the context, so each one is cheap to revisit. This is Reinertsen's core argument in *The Principles of Product Development Flow*: large batch sizes inflate cycle time, WIP, and the cost of feedback, and the right response is to **reduce batch size** — and a PR *is* the batch.

---

## Core Concept 2 — The Defect-Detection Curve and the Attention Budget

The flow argument says small PRs are cheaper to move. The defect argument says they are *better reviewed*. Both must hold for the conclusion to be robust, and they do.

The reference data is the SmartBear / Cisco study (the *Best Kept Secrets of Peer Code Review* dataset, ~2,500 reviews): **defect-detection density falls sharply as the change under review grows.** Reviewers find a high proportion of the defects present when the change is small; past a few hundred lines, detection efficiency collapses — not because the defects aren't there, but because the reviewer's attention is finite and spreads thinner over more code. The same study found the practical **inflection points**: review effectiveness degrades badly past roughly **400 LOC** in a single review, and past roughly **60 minutes** of continuous reviewing — the "fatigue cliff." Beyond those, you're not really reviewing; you're skimming and approving.

This is the attention-budget model from topic 01 made quantitative. A reviewer has a fixed budget of careful attention per session. Spread it over 200 lines and each line gets real scrutiny; spread it over 2,000 lines and each line gets a tenth of that — and the failure mode isn't uniform dilution, it's **rubber-stamping**: the reviewer hits the cliff, gives up on deep reading, and approves. The defects that ship are disproportionately in the *tail* of large PRs, where attention had already run out.

> **Key insight:** Two independent forces point the same direction — small PRs flow faster (queueing) *and* are reviewed more thoroughly per line (attention/defect-detection). The size lever is rare in that it improves latency and quality *simultaneously*; you almost never have to trade one for the other. That's why it dominates.

The corollary for decomposition: the goal isn't merely "fewer lines," it's **fewer lines that demand high attention**. A 600-line PR that is 550 lines of mechanical, tool-verifiable change plus 50 lines of genuine logic can be reviewed *well* if you make that structure obvious — because the reviewer can spend the whole attention budget on the 50 lines that matter. That insight drives Concept 4.

---

## Core Concept 3 — Decomposition as the Senior Skill

Most "this can't be split" changes can be split. The senior skill is seeing the seams. The foundational technique is **preparatory refactoring**, captured in Kent Beck's line:

> *"For each desired change, make the change easy (warning: this may be hard), then make the easy change."*

The behavioral change you actually want is often small. What makes it *look* big is that the current code shape doesn't accommodate it, so a naive PR mixes (a) reshaping the code and (b) the new behavior into one tangled diff where the reviewer can't tell which lines change behavior. Preparatory refactoring splits that into two PRs:

1. **PR 1 — refactoring, no behavior change.** Reshape the code so the new feature drops in cleanly. Because behavior is unchanged, the reviewer's question is narrow and the test suite is the safety net: *did this preserve behavior?* The existing tests passing is strong evidence. This PR can be large-ish and still review fast, because it's mechanical-leaning (Concept 4).
2. **PR 2 — the behavioral change.** Now tiny — often a few lines in the seam PR 1 created. This is where the reviewer spends real attention, and there's very little of it to scrutinize.

```
Naive (one PR, ~400 lines, hard to review):
  ┌─────────────────────────────────────────────┐
  │ reshape code  +  add new behavior  (tangled) │  reviewer can't isolate the risk
  └─────────────────────────────────────────────┘

Decomposed (two PRs):
  PR1: reshape code, behavior identical  (tests prove it)   ← fast, low-attention review
  PR2: add new behavior                  (~20 lines)        ← slow, high-attention review
```

Beyond preparatory refactoring, the senior's decomposition toolkit:

- **Vertical slicing for features.** Don't build "the whole feature" then review it. Slice it into thin end-to-end increments (smallest data model + smallest endpoint + smallest UI that does *one* real thing), each shippable behind a flag. Each slice is a small PR; the feature emerges from the sequence.
- **Separate the "move" from the "change."** Renaming/moving files *and* editing their contents in one PR produces an unreadable diff (everything shows as deleted+added). Do the pure move as one PR (the tool/diff confirms it's a move), then edit in the next.
- **Extract the dependency-free core.** A change often has a self-contained piece (a new pure function, a new validation, a new type) that can land *first* with its own tests, independent of the wiring. Land it; then the wiring PR is smaller and references already-merged, already-tested code.

> **Key insight:** Decomposition is *temporal* refactoring. Refactoring restructures code in space (modules, functions); decomposition restructures a change in *time* (a sequence of safe steps). The same instinct — "find the seam, make each piece independently correct" — applies to both, and "make the change easy, then make the easy change" is the master rule.

---

## Core Concept 4 — Mechanical vs Semantic, and Why It Halves Review Cost

The most leverage-rich distinction in PR construction is **mechanical change vs semantic change**, and keeping them in *separate PRs*.

- **Mechanical change** is semantics-preserving and, ideally, *tool-verifiable*: a rename across the codebase, a formatter run, an automated import reorder, a codemod that rewrites a deprecated call pattern, a type-only refactor. Its correctness can be argued from the *transformation* ("this rename is consistent," "the codemod's rule is sound") plus the test suite and the compiler — not from reading every site. A reviewer can process thousands of lines of mechanical change *correctly* in minutes by reviewing the *rule* and spot-checking samples.
- **Semantic change** alters behavior. It must be read carefully, line by line, and it should be *small* so the reviewer's full attention lands on it.

The failure mode is mixing them: a PR that renames `getUser`→`fetchUser` across 80 files *and* changes the caching logic in two of them. Now the reviewer must read all 80 files carefully, because any one of them *might* contain the real change — the 78 mechanical files are camouflage for the 2 semantic ones. Split it: PR 1 does the pure rename (review the rename rule, scan, approve in minutes); PR 2 changes the caching logic (20 lines, full scrutiny).

```bash
# A pure mechanical PR is one the tool can re-derive. Make that checkable:
gofmt -r 'getUser(a) -> fetchUser(a)' -w ./...     # Go: rewrite rule
comby 'getUser(:[args])' 'fetchUser(:[args])' .go -i   # language-agnostic structural rewrite
# JS/TS: a jscodeshift transform; Java: an OpenRewrite recipe.
# In the PR description, paste the exact command. The reviewer re-runs it and diffs:
#   if `git diff` after re-running is empty, the change IS the codemod — verified, not read.
```

> **Key insight:** "Mechanical vs semantic" is the practical form of the attention-budget rule. Mechanical change is verified by *argument about the transformation* (rule + tooling + tests); semantic change is verified by *reading*. Mixing them forces reading-level attention onto mechanical volume — the worst of both. Separating them lets the reviewer spend ~0 attention on the mechanical PR and ~100% on the tiny semantic one.

This is also how you make some *unavoidably large* PRs reviewable (Concept 8): if a PR is large but provably *all mechanical* — and you give the reviewer the codemod and a re-run recipe — its reviewable cost is small regardless of line count, because reviewing 5,000 lines of "the codemod did exactly this" is reviewing the codemod, not the 5,000 lines.

---

## Core Concept 5 — The Big-Migration Patterns

Large changes that *feel* atomic — schema changes, interface changes, replacing a subsystem — are where decomposition pays the most. Four named patterns, each turning a big-bang into a safe sequence of small PRs. (These are Fowler's catalog; internalize them by name.)

### Parallel Change (expand / migrate / contract)

For changing an interface, a function signature, a data shape, or a schema *without* a flag day. Three phases, each one or more small PRs:

1. **Expand** — introduce the new form *alongside* the old. Add the new method/column/field; keep the old one fully working. Nothing breaks; reviewers see purely additive code.
2. **Migrate** — move callers/writers/readers from old to new, incrementally, in as many small PRs as there are caller groups. Each is independently shippable and revertible.
3. **Contract** — once nothing uses the old form, delete it. A small, satisfying cleanup PR.

```
Interface change  doSomething(a, b)  →  doSomething(opts)

EXPAND   (PR 1):  add doSomething(opts); keep doSomething(a,b) as a thin shim → doSomething({a,b})
MIGRATE  (PRs 2..k): convert callers in small batches to the opts form
CONTRACT (PR k+1): delete the (a,b) overload once no caller remains
```

For a **database schema migration**, parallel change is the *only* safe shape under zero-downtime constraints, and it interlocks with the deploy:

```
Goal: split `users.name` into `first_name` + `last_name`.

PR 1 (expand schema):  ADD COLUMN first_name, last_name (nullable). Deploy. Old code untouched.
PR 2 (dual-write):     app writes BOTH name AND first/last on every write. Deploy. Backfill job
                       populates first/last for existing rows (run, verify the invariant:
                       every row's first/last reconstructs name).
PR 3 (switch reads):   app reads first/last (falling back to name if needed). Deploy + bake.
PR 4 (stop old write): app stops writing `name`. Deploy. Now `name` is dead data.
PR 5 (contract):       DROP COLUMN name. Deploy.
```

Five small, independently-reviewable, independently-revertible PRs, each one a safe deploy. The alternative — one PR that adds columns, backfills, switches reads/writes, and drops the old column — is unreviewable, un-revertible, and a guaranteed outage if any step is wrong. (This is the same expand/contract discipline covered in the database-migration material; here the point is that it's *also* a PR-decomposition pattern.)

### Branch by Abstraction

For replacing a *large component* that many call sites depend on, when you can't do it in one step and don't want a long-lived branch:

1. Introduce an **abstraction layer** (an interface/facade) in front of the existing implementation — one PR, behavior unchanged.
2. Point all callers at the abstraction — small PRs, still backed by the old implementation.
3. Build the **new implementation behind the same abstraction** — PRs that add code without touching callers.
4. **Flip** the abstraction to the new implementation (often flag-gated, so the flip itself is reversible) — one small, high-attention PR.
5. **Remove** the abstraction and the old implementation once the new one is proven — cleanup PRs.

The whole migration lives on `main` the entire time, integrated continuously. There is no week-long branch to rebase, and at every step the system is shippable.

### Strangler Fig

For incrementally *replacing a whole system* (a service, a legacy module) by routing functionality from old to new piece by piece, until the old one withers and is removed. Each routed slice is a small PR plus a routing/flag change; you can pause, ship, and even abandon the migration at any point with the system in a working state. The name (Fowler) is the vine that grows around a tree until the tree is gone — the new system grows around the old.

> **Key insight:** Every one of these patterns converts a single *un-revertible big-bang* into a sequence of *individually revertible small steps that keep `main` shippable at every commit*. That property — "always shippable, always revertible" — is what makes the small-PR discipline compatible with genuinely large changes. The patterns are how you get there.

---

## Core Concept 6 — Stacked Diffs in Real Depth

Decomposition produces a *sequence* of dependent changes: PR 2 builds on PR 1's code, PR 3 on PR 2's. The naive way to ship a sequence is to merge PR 1, wait, branch PR 2 off the new `main`, merge it, wait, and so on — serializing the whole feature behind review-and-merge latency. **Stacked diffs** let you author and review the *entire sequence in parallel* while preserving small-PR review quality.

### The model: a dependency DAG of PRs

A stack is a chain (usually linear, sometimes a DAG) of branches:

```
main
 └─ pr1  (branch: feat/extract-core,    base: main)
     └─ pr2  (branch: feat/wire-it,     base: feat/extract-core)
         └─ pr3 (branch: feat/new-behavior, base: feat/wire-it)
```

Each PR's *diff* is computed against its parent in the stack, so each PR shows **only its own changes** — pr2 doesn't re-show pr1's diff. Reviewers review each PR small, in isolation, exactly as if it stood alone, but you didn't have to wait for pr1 to merge before opening pr2 and pr3. That's the whole value: **small-PR review quality without serial latency.**

### The mechanics: merge order and restacking

Stacks merge **bottom-up**. You merge pr1 into `main` first. Now the stack is out of date: pr2 and pr3 are still based on the *old* pr1 branch, which no longer matches `main` (especially if `main` squash-merged pr1 into a single commit with a different SHA). You must **restack** — re-parent the rest of the stack onto the new `main`:

```bash
# pr1 just merged into main (as a squash commit). Restack pr2 onto main:
git checkout feat/wire-it
git rebase --onto main feat/extract-core feat/wire-it
#            └ new base   └ old base        └ branch to move
# This replays ONLY pr2's commits onto main, dropping pr1's now-redundant commits.

# Then cascade to pr3:
git checkout feat/new-behavior
git rebase --onto feat/wire-it <old-base-of-pr3> feat/new-behavior
git push --force-with-lease   # update each branch; --force-with-lease, never plain --force
```

`git rebase --onto NEW OLD BRANCH` is the load-bearing command of stack work: it moves `BRANCH`'s unique commits (those after `OLD`) onto `NEW`. Doing this by hand for a deep stack is exactly the toil the tooling automates.

### Conflict handling *within* a stack

When you amend a *lower* PR after review (say pr1 needs a fix), every PR above it must be rebased onto the amended pr1. Conflicts surface at the layer where the change actually collides, and you resolve them once per affected layer, bottom-up. The discipline: **make the edit at the lowest layer that owns it, then restack upward** — never duplicate a fix across layers, or you create divergence that the next restack fights.

### The tooling landscape

Stacking is old; the *ergonomics* are new:

| Tool / system | Notes |
|---|---|
| **Gerrit** (relation chains) | Pioneered review-of-stacks: one commit = one change, dependent changes form a relation chain, reviewed independently. The original model many tools imitate. |
| **Phabricator** (Differential) | Also pioneered first-class stacked review (`arc diff`); influential, now sunset but echoed by Graphite/Sapling. |
| **Sapling** (Meta) | Meta's Git-compatible VCS; stacking is native to the workflow, with `sl` commands for managing and restacking stacks. |
| **`ghstack`** | Submits a stack of dependent PRs to GitHub from a linear commit history; popular in the PyTorch world. |
| **Graphite** | Commercial layer over GitHub that manages branches-as-a-stack, auto-restacks, and tracks the DAG; the most polished GitHub-native experience today. |
| **`spr` / `git branchless`** | OSS stack tooling: `spr` maps commits to PRs; `git branchless` (`git restack`, smart logs) makes manual stack management far less painful. |

> **Key insight:** GitHub has **weak native stacking** — a PR's base can be another branch, but GitHub doesn't model the *stack*, doesn't auto-restack after a merge, and its squash-merge rewrites SHAs so the rest of the stack must be manually re-based. That gap is precisely what Graphite/ghstack/`spr` fill. If your org is on GitHub and decomposes seriously, you will adopt one of them or hand-roll the `rebase --onto` cascade.

### Stacks vs merge queues

A **merge queue** serializes merges to keep `main` green: it tests each PR *as it would land* (rebased on the queue's current tip) before merging. Stacks and merge queues interact awkwardly — a queue typically wants to merge one PR at a time, but a stack is a unit whose lower PRs must land first. Mature tooling (Graphite's queue, GitHub's merge queue with care) handles "merge the bottom of the stack, then re-queue the rest," but it's a known friction point: **the queue and the stack both want to control merge order**, and you must configure which wins. The practical rule: let the bottom of the stack enter the queue; once it merges, restack and queue the next.

### The cost

Stacking isn't free. It adds **cognitive overhead** (you hold a DAG of in-flight changes in your head) and **tooling overhead** (force-pushes, restacks, a tool to learn, and a team that understands "don't review pr3 before pr1 lands logic-wise"). For a *single* small change, a stack is over-engineering — just open one PR. The break-even is when a change naturally decomposes into 3+ dependent steps and the alternative is either one giant PR or weeks of serial merge latency. There, the flow + defect economics (Concepts 1–2) dominate the overhead, and stacking is the senior's default.

---

## Core Concept 7 — Trunk-Based Development and Feature Flags as the Enabler

Decomposition and stacking solve "how do I split *this* change." **Trunk-based development (TBD)** plus **feature flags** solve it at the *system* level by removing the conditions that produce big PRs in the first place.

The mechanism of a big-bang review is the **long-lived branch**: a feature developed for weeks on a branch, then submitted as one enormous PR because it was never integrated. TBD forbids this. Everyone integrates to `main` (trunk) continuously — at least daily — in small increments. Short-lived branches (hours to a day or two) exist only to host a single small PR, which merges and disappears. No long-lived branch ⇒ no accumulated big diff ⇒ no big-bang review. The small-PR discipline becomes the *only* available mode, not an act of willpower.

The enabler that makes "merge incomplete work to trunk" safe is the **feature flag**. You merge a vertical slice of an unfinished feature *dark* (behind a flag that's off in production), so it integrates continuously without being user-visible until it's complete and you flip the flag. This decouples **deploy** from **release**: code ships continuously in small PRs; the feature is *released* by a flag flip, independent of any merge.

```
Without flags:  feature lives on a branch for 3 weeks → 1 PR of 3,000 lines → big-bang review

With flags + TBD:
  day 1:  PR (~150 LOC) behind flag OFF — data model slice
  day 2:  PR (~120 LOC) behind same flag — endpoint slice
  day 3:  PR (~200 LOC) behind same flag — UI slice
  ...     each small, each reviewed well, each merged to trunk same-day, none user-visible
  done:   flip flag ON (a tiny config PR / runtime toggle) → release, no big merge
```

The cost is **flag debt**: flags accumulate, the code grows branchy (`if (flag) … else …`), and a stale flag is a live untested code path and a config landmine. The discipline is non-negotiable: every flag gets an **owner and an expiry**; once a feature is fully rolled out, a cleanup PR *removes* the flag and the dead branch (itself a small, mechanical-leaning PR). Treat flags as temporary scaffolding with a demolition date, not permanent architecture.

> **Key insight:** Small PRs are an *emergent property* of trunk-based development + feature flags, not a rule you enforce per-PR. If branches are short-lived and incomplete work hides behind flags, large PRs become structurally impossible to produce. The org-level lever (TBD + flags) is more durable than the per-PR lever (willpower to split), because it changes the default.

---

## Core Concept 8 — When Big PRs Are Unavoidable

Some PRs are legitimately large and *can't* be meaningfully split. The senior move is not to pretend otherwise but to make them **reviewable despite size** — which, per Concept 4, means making most of the volume *not require reading*.

- **Generated code.** Protobuf/gRPC stubs, ORM-generated models, OpenAPI clients. Don't review the generated output line by line — review the **generator input** (the `.proto`, the schema, the codegen config) and **spot-check** a couple of generated files to confirm the generator behaved. Mark the rest "generated, do not review." Ideally, *don't commit generated code at all* (generate in the build), eliminating the PR entirely.
- **Mechanical mass changes (codemods).** A 4,000-line dependency-API migration applied by a codemod across the repo. Review the **codemod itself** (the transformation rule) plus a representative **sample**; paste the re-run command so the reviewer can confirm `git diff` is empty after re-running (Concept 4). The 4,000 lines are reviewed by reviewing the ~40-line codemod.
- **Vendored dependencies / lockfile updates.** A vendored library or a `package-lock.json` churn is enormous and unreadable. You review the *decision* (which version, why, the changelog/security advisory) and the *provenance* (it's the upstream artifact, verified by hash/CI), not the vendored bytes. Mark the vendored directory as not-for-review (`.gitattributes linguist-generated`, code-owner exemptions).
- **Large data/asset additions, generated migrations, snapshot fixtures.** Same principle: review the *source of truth* and the *process that produced the artifact*, and exempt the artifact from line-by-line review.

The unifying rule for unavoidable bigness: **find the small thing that determines the big thing — the generator, the codemod, the version decision, the schema — and review *that* with full attention, then verify the large artifact derives from it mechanically.** Where the change is large *and* genuinely semantic (a hard algorithmic rewrite that resists decomposition), at minimum: land any preparatory refactoring separately first, add tests *before* the rewrite so the contract is pinned, and split off every independently-mergeable piece — shrinking the irreducible semantic core as much as possible even if you can't eliminate it.

> **Key insight:** "Unavoidably large" almost always means "large in *mechanical* volume," and mechanical volume is reviewable by argument-about-the-transformation, not by reading. The rare genuinely-large *semantic* change is the one case where size and review quality truly trade off — and the response is to shrink the semantic core (tests + preparatory refactoring + splitting off everything separable), never to ship a large semantic blob and hope.

---

## Real-World Examples

**A schema migration, decomposed into a stack.** A team must split a monolithic `address` text column into structured fields, zero-downtime, on a high-traffic table. The senior decomposes it via parallel change (Concept 5) and ships it as a stack (Concept 6): pr1 adds the new nullable columns; pr2 introduces dual-write and a backfill job that asserts the invariant (`reconstructed == original` for every row); pr3 switches reads to the new columns with a fallback; pr4 stops writing the old column; pr5 drops it. Each PR is ~50–150 lines, each is a safe independent deploy, each is independently revertible. Reviewers approve each in minutes because each does *one* clearly-correct thing. The migration that would have been one terrifying 700-line un-revertible PR becomes five boring ones — and "boring" is the goal.

**A codemod-driven API migration.** A 30,000-line monorepo must migrate off a deprecated logging API. The senior writes a `comby`/OpenRewrite recipe, runs it (3,800 lines changed across 240 files), and opens *two* PRs: PR-A is the codemod recipe itself plus a 5-file hand-applied sample, reviewed carefully (is the rule sound? does it handle the edge cases?); PR-B is the bulk mechanical application, with the exact re-run command in the description and the directory marked generated-mechanical. The reviewer approves PR-A on its merits and PR-B by re-running the recipe and confirming an empty diff. 3,800 lines reviewed *correctly* in under an hour — because only ~50 lines (the recipe) actually needed reading.

**The long-lived-branch postmortem.** A team without TBD develops a feature on a branch for five weeks. The final PR is 2,400 lines; review takes nine days of back-and-forth; the branch rebases against `main` four times, each rebase a multi-hour conflict slog; a subtle bug ships because the reviewer hit the fatigue cliff at line ~900 and skimmed the rest. The retro's conclusion is the whole of this page: the defect and the rebase-toil were *both* caused by batch size, and the fix is structural — adopt flags + TBD so the feature ships as ~18 small PRs over the five weeks, each reviewed well, none ever rebased for more than a day.

---

## Mental Models

- **A PR is a batch; size is batch size.** Everything Reinertsen says about batch size in product-development flow applies directly: large batches inflate cycle time, WIP, feedback cost, and risk. Shrinking the PR *is* shrinking the batch — the highest-leverage flow intervention you control as an individual.

- **Decomposition is refactoring in the time dimension.** Refactoring finds seams in *code* (extract a function, introduce an interface). Decomposition finds seams in a *change* (a sequence of independently-correct steps). Same instinct, different axis. "Make the change easy, then make the easy change" is the master rule for both.

- **Mechanical is verified by argument; semantic is verified by reading.** Sort every line of a diff into one bucket. Mechanical volume costs ~0 attention if you expose the transformation; semantic volume costs full attention. Mixing them taxes mechanical volume at the reading rate. Separate them, always.

- **A stack is small-PR review quality minus serial latency.** Without stacks, a dependent sequence serializes behind merge latency. With stacks, you author and review it all in parallel, each piece still small. The price is rebase/restack toil — which is why tooling exists.

- **TBD + flags make small PRs the default, not the discipline.** Short-lived branches and dark-launched slices remove the *ability* to produce a big PR. Change the system and you don't have to fight the per-PR battle.

- **Small PRs are cheap reverts.** Size ↔ blast radius ↔ revertibility are linked: a small PR is a small, surgical, low-risk revert when it's wrong. A big PR's revert is its own risky change. Small PRs are how you make `git revert` a safe everyday tool instead of an emergency.

---

## Common Mistakes

1. **Treating size as a style nit instead of a flow variable.** "It's a big PR but the code's fine" misses that the *bigness itself* degrades review quality (defect cliff) and inflates rework (superlinear conflict cost) regardless of code quality. Size is the variable; argue it on economics, not aesthetics.

2. **Mixing mechanical and semantic change in one PR.** The rename-plus-logic-change PR forces reading-level attention onto 80 mechanical files to find the 2 semantic ones. Split: pure mechanical PR (verify the rule + sample), then tiny semantic PR (full scrutiny).

3. **Doing a move and an edit in the same commit.** A renamed-and-edited file shows as delete+add — the diff is unreadable and the reviewer can't see what actually changed. Pure move first (diff confirms it's a move), edit second.

4. **One big-bang migration PR instead of expand/migrate/contract.** Adding a column, backfilling, switching reads/writes, and dropping the old column in one PR is unreviewable, un-revertible, and an outage waiting to happen. Parallel change turns it into N safe, independent deploys.

5. **Long-lived feature branches.** A branch developed for weeks *guarantees* a big-bang review and compounding rebase toil. Use flags + trunk-based development to integrate small increments daily; the big PR never accumulates.

6. **Adopting stacks for a single small change.** Stacking has real cognitive + tooling overhead. For one small PR it's over-engineering. Reach for stacks when a change naturally decomposes into 3+ dependent steps and the alternative is a giant PR or serial-merge latency.

7. **Reviewing generated/vendored/codemod output line by line.** It's the wrong target and a waste of the attention budget. Review the *source* (generator input, codemod rule, version decision) and verify the artifact derives mechanically; exempt the artifact from line review.

8. **Letting feature flags become permanent.** A flag with no owner and no expiry is a stale untested code path and a config landmine. Every flag needs an owner and a removal date; cleanup is a (small) PR, not an afterthought.

---

## Test Yourself

1. Using Little's Law and the conflict-cost model, explain *quantitatively* why splitting one 2,000-line PR into five 400-line PRs reduces total cost rather than multiplying it.
2. What are the two empirical inflection points from the SmartBear study, and what failure mode happens past them?
3. State Kent Beck's rule and walk through how it splits a "reshape + new behavior" change into two PRs with different review profiles.
4. Distinguish mechanical from semantic change. How do you verify each, and why is mixing them the worst case for the reviewer's attention budget?
5. Decompose a zero-downtime change that splits one DB column into two, using parallel change. List the PRs and the deploy between each.
6. In a stack `main → pr1 → pr2 → pr3`, pr1 just squash-merged into `main`. Give the exact `git` command to restack pr2, and explain each argument.
7. Why does GitHub's native stacking support require external tooling, and how do stacks interact with a merge queue?
8. A 4,000-line codemod migration is unavoidable. How do you make it reviewable with full confidence in under an hour?

<details>
<summary>Answers</summary>

1. **Little's Law** (`W = L/λ`): with a roughly fixed reviewer processing rate `λ`, the five small PRs each carry low per-item latency and can be reviewed in parallel / in the gaps of a reviewer's schedule, whereas the 2,000-line PR requires a contiguous block of attention that doesn't exist, so it *waits*. **Conflict cost** scales like `surface(size) × commits-landed-during(time-in-review)` — both factors grow with size, so it's *superlinear* in bigness; five small PRs each have small surface *and* short time-in-review, so their summed conflict cost is far below the one big PR's. Net: the small PRs flow faster and rebase less, so total cost drops.
2. **~400 LOC** per review and **~60 minutes** of continuous reviewing. Past them, defect-detection efficiency collapses and the reviewer **rubber-stamps** — skims and approves rather than reads — so defects in the *tail* of large PRs ship disproportionately.
3. *"Make the change easy (this may be hard), then make the easy change."* **PR 1**: reshape the code with no behavior change — reviewed fast and low-attention because the tests passing prove behavior is preserved. **PR 2**: the now-tiny behavioral change in the seam PR 1 created — reviewed slow and high-attention, but there's very little of it. The reshape (large-ish, mechanical-leaning) and the behavior (tiny, semantic) get the review profile each deserves.
4. **Mechanical** = semantics-preserving, ideally tool-verifiable (rename, format, codemod, type-only refactor); verified by *argument about the transformation* (rule + tooling + tests) plus spot-checks — re-run the codemod and confirm an empty diff. **Semantic** = changes behavior; verified by *careful reading*. Mixing them is worst-case because the mechanical volume *camouflages* the semantic change, forcing the reviewer to read *everything* at reading-level attention to find the few lines that matter.
5. (1) **Expand**: `ADD COLUMN first_name, last_name` nullable → deploy. (2) **Dual-write + backfill**: app writes both old and new; backfill job populates existing rows and asserts the invariant (new reconstructs old) → deploy + run job. (3) **Switch reads** to new columns (fallback to old) → deploy + bake. (4) **Stop writing** the old column → deploy. (5) **Contract**: `DROP COLUMN name` → deploy. Five small PRs, a safe deploy between each, every step revertible.
6. `git rebase --onto main pr1 pr2` (using branch names: `git rebase --onto main feat/pr1 feat/pr2`). `--onto main` = the **new base**; `pr1` = the **old base** (commits up to here are dropped as redundant since they're now in `main`); `pr2` = the **branch to move**. It replays only pr2's unique commits onto `main`. Then `git push --force-with-lease`.
7. GitHub models PRs individually, not as a stack: a PR's base can be another branch, but GitHub won't **auto-restack** after a merge, and squash-merge **rewrites the SHA** so the rest of the stack must be manually rebased onto the new `main`. Tools (Graphite, ghstack, `spr`) track the DAG and automate the restack cascade. With a **merge queue**, both the queue and the stack want to control merge order; the workable pattern is to queue only the *bottom* of the stack, then restack and queue the next once it lands.
8. Open two PRs. **PR-A**: the codemod/recipe itself plus a small hand-applied sample — reviewed carefully for rule soundness and edge cases. **PR-B**: the bulk mechanical application, with the exact re-run command in the description and the directory marked generated-mechanical. The reviewer approves PR-A on its merits and verifies PR-B by re-running the recipe and confirming `git diff` is empty. The 4,000 lines are reviewed by reviewing the ~50-line recipe — full confidence, minimal reading.

</details>

---

## Cheat Sheet

```
FLOW ECONOMICS (why size dominates)
  Little's Law      W = L/λ  → bigger PR = higher L = higher latency W per change
  conflict cost     ≈ surface(size) × commits-during(time-in-review)   (SUPERLINEAR)
  defect cliff      detection collapses past ~400 LOC / ~60 min → rubber-stamping
  net               small PRs flow faster AND review better — no trade-off

DECOMPOSITION (the senior skill)
  Beck's rule       make the change easy, then make the easy change
  prep refactor     PR1 reshape (behavior-identical, tests prove it) → PR2 tiny behavior
  mechanical|semantic  SPLIT them: mechanical = verify the rule+sample; semantic = read
  move vs edit      pure move PR first, edit PR second (diff stays readable)
  vertical slice    thin end-to-end increments, each behind a flag

BIG-MIGRATION PATTERNS (big-bang → safe sequence)
  parallel change   expand → migrate callers (small PRs) → contract
  schema migration  add col → dual-write+backfill → switch reads → stop old write → drop
  branch by abstr.  add facade → point callers → build new behind it → flip → remove
  strangler fig     route slices old→new until old withers, then delete

STACKED DIFFS
  model             main → pr1 → pr2 → pr3   (each diff vs its parent = stays small)
  merge order       BOTTOM-UP; after a merge, RESTACK the rest
  restack           git rebase --onto NEW_BASE OLD_BASE BRANCH ; push --force-with-lease
  tooling           Graphite / ghstack / spr / git-branchless ; Gerrit & Phabricator pioneered
  cost              cognitive + tooling overhead — worth it at 3+ dependent steps

SYSTEM-LEVEL ENABLER
  trunk-based dev   short-lived branches, integrate daily → big PRs become impossible
  feature flags     merge incomplete work dark → decouple deploy from release
  flag debt         every flag gets an OWNER + EXPIRY; removal is a (small) PR

WHEN BIG IS UNAVOIDABLE (make volume not require reading)
  generated code    review the generator input + spot-check (better: don't commit it)
  codemod           review the recipe + sample; re-run → empty diff = verified
  vendored/lockfile review the version DECISION + provenance, not the bytes
  hard semantic     pin tests first, land prep refactor separately, shrink the core
```

---

## Summary

- **PR size is a queueing variable, not a style nit.** It couples size → time-in-review → WIP → conflict cost, and the conflict/rework term grows with the *product* of surface area and time-in-review — superlinear in bigness. Little's Law and Reinertsen's batch-size argument make this rigorous.
- **Two independent forces favor small PRs and point the same way:** they flow faster through the review queue *and* are reviewed better per line (the SmartBear ~400-LOC / ~60-min defect cliff). Size is the rare lever that improves latency and quality at once.
- **Decomposition is the senior skill** — refactoring a change in the *time* dimension. Master rule: *make the change easy, then make the easy change* (Beck). Split preparatory refactoring from behavior, and **mechanical** change (verified by the transformation rule + tooling) from **semantic** change (verified by reading).
- **The big-migration patterns** — parallel change / expand-contract, branch by abstraction, strangler fig — convert un-revertible big-bangs into sequences of small, independently-revertible steps that keep `main` shippable at every commit.
- **Stacked diffs** preserve small-PR review quality without serial-merge latency by reviewing a dependency DAG in parallel; the cost is restack toil (`git rebase --onto`), which Graphite/ghstack/`spr`/Gerrit-style tooling automates. GitHub's native support is weak; merge queues and stacks contend over merge order.
- **Trunk-based development + feature flags** make small PRs the *default* at the system level by eliminating long-lived branches and decoupling deploy from release — more durable than per-PR willpower, at the cost of flag debt that demands owner-and-expiry discipline.
- **When big PRs are unavoidable**, make the *volume not require reading*: review the generator / codemod / version-decision / schema, verify the artifact derives mechanically, and exempt it from line review. The only true size-vs-quality trade-off is the rare large *semantic* change — answered by shrinking the semantic core, never by shipping a blob.

For the workflow-level practice of how these PRs move through review day to day, return to [professional.md](professional.md).

---

## Further Reading

- *The Principles of Product Development Flow* — Donald Reinertsen. The economics of batch size, WIP, and queueing applied to development; the rigorous basis for "small PRs win." Pair with any clear treatment of **Little's Law**.
- *Refactoring* (2nd ed.) and the [PreparatoryRefactoring](https://martinfowler.com/articles/preparatory-refactoring-example.html) note — Martin Fowler — including Kent Beck's "make the change easy, then make the easy change."
- [ParallelChange](https://martinfowler.com/bliki/ParallelChange.html), [BranchByAbstraction](https://martinfowler.com/bliki/BranchByAbstraction.html), and [StranglerFigApplication](https://martinfowler.com/bliki/StranglerFigApplication.html) — Martin Fowler. The canonical write-ups of the big-migration patterns.
- [Google Engineering Practices — Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google's case for small changes and how to split them.
- *Best Kept Secrets of Peer Code Review* (SmartBear / Cisco study) — the defect-detection-vs-size and time-vs-fatigue data behind the ~400-LOC / ~60-min inflection points.
- *Trunk Based Development* (trunkbaseddevelopment.com) and *Accelerate* (Forsgren, Humble, Kim) — the system-level case for continuous integration to trunk and its link to delivery performance.
- The [Graphite](https://graphite.dev/), [ghstack](https://github.com/ezyang/ghstack), and [git-branchless](https://github.com/arxanas/git-branchless) docs, plus Gerrit's relation-chains documentation — the stacked-diff tooling landscape and mechanics.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/senior.md) — the attention-budget model this page quantifies; what the reviewer spends that budget *on* once the PR is small.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/senior.md) — review latency and tempo, the queueing metrics that small PRs and fast review co-optimize.
- [08 — Review Anti-patterns](../08-review-anti-patterns/senior.md) — rubber-stamping, the big-PR failure modes, and the dysfunctions that small-PR discipline prevents.
- [Quality Gates](../../quality-gates/) — merge queues, required checks, and the automation that gates small PRs into trunk.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — batch size, lead time, and deployment frequency as org-level outcomes of the flow economics here.
