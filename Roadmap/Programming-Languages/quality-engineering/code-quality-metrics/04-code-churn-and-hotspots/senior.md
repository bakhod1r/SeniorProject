# Code Churn & Hotspots — Senior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Churn & Hotspots
> *The middle page taught you to count churn and overlay it on complexity. This page is about why that overlay works at all — the empirical evidence that change history predicts defects better than any static snapshot, the full behavioral-analysis toolkit that history unlocks, and the methodological rigor that separates a real hotspot from an artifact of a reformatting commit.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Evidence — History Predicts Defects](#the-evidence--history-predicts-defects)
4. [Why Behavior Beats the Static Snapshot](#why-behavior-beats-the-static-snapshot)
5. [The Behavioral Toolkit — What Each Analysis Reveals](#the-behavioral-toolkit--what-each-analysis-reveals)
6. [Change Coupling — Temporal Dependencies the Compiler Can't See](#change-coupling--temporal-dependencies-the-compiler-cant-see)
7. [Knowledge Maps, Ownership, and Bus Factor](#knowledge-maps-ownership-and-bus-factor)
8. [Methodological Rigor — Cleaning the History](#methodological-rigor--cleaning-the-history)
9. [The Rename Problem — `-M`, `--follow`, and What Git Doesn't Store](#the-rename-problem---m---follow-and-what-git-doesnt-store)
10. [Statistical Cautions — Disentangling Churn, Size, and Activity](#statistical-cautions--disentangling-churn-size-and-activity)
11. [From Analysis to Action](#from-analysis-to-action)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The empirical research behind churn-based risk, and the rigorous behavioral analysis a senior engineer runs on a repository's history to find where the real risk lives.**

By the middle level you can compute churn from `git log`, plot it against cyclomatic complexity, and point at the upper-right quadrant. That is a genuinely useful instinct. The senior jump is in three directions at once.

First, you know *why* it works — not as folklore ("changed files have bugs") but as a result you can cite: the Microsoft Research finding that **relative** churn measures predict defect density with high accuracy, and the broader literature showing that change history is a stronger fault predictor than any property of a static snapshot. Second, you command the full behavioral toolkit that version-control history unlocks — not just hotspots, but change coupling, complexity trends over time, code age, and knowledge maps — and you know exactly what each one *reveals* and what it *can't*. Third, and most importantly, you have the methodological discipline to keep the analysis honest: normalizing churn so a big file doesn't masquerade as a risky one, excluding the reformatting commit that touched 4,000 lines and means nothing, and surviving git's lossy treatment of renames.

This page is the analysis layer — the mechanics and the evidence. What you *do* with a confirmed hotspot — how you prioritize it against everything else competing for engineering time, how you justify the refactor to a budget owner — is a different discipline; that lives in [Technical Debt Management](../../technical-debt-management/). Here we earn the number; there it spends it.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — churn as lines added/deleted/modified over a window, the churn × complexity hotspot overlay, and reading `git log --numstat`.
- **Required:** Comfort with [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/senior.md): a hotspot is *complexity × change*, so you need to trust the complexity axis.
- **Helpful:** A reading acquaintance with [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/senior.md) — change coupling is the *temporal* cousin of static coupling, and the contrast is the whole point.
- **Helpful:** Real git fluency: you know that a commit stores *snapshots* not *diffs*, that renames are *detected* not *recorded*, and that `git log` reconstructs file paths as it walks.

---

## The Evidence — History Predicts Defects

The claim "where code changes a lot, bugs accumulate" sounds like a truism. The reason a senior treats it as a load-bearing tool — rather than a hunch — is that it is one of the better-replicated empirical results in software engineering. Two studies anchor it.

**Nagappan & Ball, "Use of Relative Code Churn Measures to Predict System Defect Density" (ICSE 2005, Microsoft Research).** Studying Windows Server 2003, the authors asked whether code churn measured from version control predicts the *defect density* (defects per KLOC) of a binary. Their central finding is sharper than "churn correlates with bugs" — it is about **which** churn measure works:

- **Relative churn measures predict defect density; absolute churn measures do not, on their own.** A file or binary with 500 churned lines tells you little. The same 500 lines normalized by file size, by total lines, by number of files, by churned files per binary — *that* is strongly predictive. Their relative measures included churned LOC per total LOC, files churned per file count, churn per week of development, and similar ratios.
- The models built from these relative measures **discriminated faulty from non-faulty binaries with high accuracy** — the paper reports being able to explain a large share of the variance in defect density, dramatically more than absolute size or absolute churn alone.
- Crucially, **relative churn out-predicts absolute size (LOC).** Big files are not the problem; *churned-relative-to-their-size* files are. This is the single most important quantitative takeaway, and it is the empirical justification for everything in the "normalize your churn" section below.

> **Key insight:** Nagappan & Ball did not show "churn predicts defects." They showed that *relative* churn predicts defects and *absolute* churn largely doesn't. Any churn analysis that ranks files by raw lines-changed is using the measure the research specifically found weak. Normalization isn't a refinement — it's the finding.

**Graves, Karr, Marron & Siy, "Predicting Fault Incidence Using Software Change History" (IEEE TSE, 2000).** Working on a large telephone-switching system, they compared fault-prediction models built from *product* metrics (size, complexity — properties of the code as it stands) against models built from *process* metrics (the change history). Two results matter:

- **Change-history models outperformed product-metric models.** The number and recency of past changes to a module predicted future faults better than the module's size or complexity did.
- They introduced a **weighted-time-damp model**: recent changes carry more predictive weight than old ones, and a module's fault risk *decays* the longer it goes unchanged. Age matters — a thousand-line change two years ago is far less predictive than a hundred-line change last month. (This is the same intuition Graves' contemporaries formalized and that tools later operationalized as "code age.")

Together these give the senior two citable pillars: **process beats product** (history predicts faults better than a snapshot — Graves et al.) and **relative beats absolute** (normalized churn predicts defect density, raw churn doesn't — Nagappan & Ball). Later industrial work, most visibly Adam Tornhill's *Your Code as a Crime Scene* and *Software Design X-Rays*, turned these results into a repeatable analysis practice and the `code-maat` tooling — which is the rest of this page.

> **A note on what "predicts" means.** These are *correlational, ranking* tools, not causal oracles. The defensible reading is: a model fit on history ranks modules by fault-proneness well enough to *prioritize attention*. It does not say "this file *will* have N bugs." The value is in the ordering — point limited review, testing, and refactoring effort at the top of the ranked list rather than spreading it uniformly. Treat the output as a prioritized worklist, never as a verdict.

---

## Why Behavior Beats the Static Snapshot

A static metric — cyclomatic complexity, LCOM, a maintainability index — describes the code *as it is at one instant*. Behavioral analysis describes how the code *has been treated over time*. The latter is more predictive for a reason that becomes obvious once stated:

**A static snapshot can't distinguish dangerous code from merely-complex-but-settled code.** Consider two files, both with cyclomatic complexity of 60:

- A mature, gnarly **date/time parser** or **Unicode normalization table**. Intrinsically complex, but written once, correct, and essentially never touched. Its complexity is *paid down* — the cost was borne years ago.
- A **payment-orchestration module** with the same complexity that is edited by five people every sprint, each change followed by a hotfix.

The static metric scores them identically. They are not remotely the same risk. The first is *complex but stable*; the second is *complex and active* — and active complexity is where defects are injected, because every edit is an opportunity for a fault and complexity is what makes the edit error-prone. Change history is what tells the two apart. This is exactly Graves et al.'s result restated as an example: the *process* signal (one file is hammered, one is dormant) carries the risk that the *product* signal (identical complexity) is blind to.

This is also why a hotspot is defined as **complexity × change**, not complexity alone:

- Low complexity, low change → fine, ignore.
- High complexity, **low** change → leave it alone; it's intrinsic complexity that has stopped costing you. Refactoring it is risk with no payoff.
- Low complexity, high change → usually fine; simple code that changes often (config, a registry, a feature-flag file) is cheap to keep editing.
- **High complexity, high change → the hotspot.** Expensive to change *and* changed constantly. This is where refactoring ROI concentrates, because you pay the comprehension tax repeatedly.

> **Key insight:** Behavior beats the snapshot because risk is not a property of code, it's a property of *code under change*. The most dangerous file in the system is rarely the most complex one — it's the moderately complex one that everybody keeps editing. A static analyzer can't see "everybody keeps editing"; only the history can.

---

## The Behavioral Toolkit — What Each Analysis Reveals

Tornhill's contribution (and the `code-maat` tool that implements it) is a *family* of analyses, each mining a different signal from the same `git log`. A senior knows them by what question each answers. All of them feed off one export — get the log into a stable format once, then run each analysis over it:

```bash
# Produce a log code-maat can parse (one-time, per analysis window)
git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' \
        --no-renames --after=2024-01-01 > repo.log

# code-maat is invoked per analysis kind:
maat -l repo.log -c git2 -a revisions          # change frequency (the X-axis of a hotspot)
maat -l repo.log -c git2 -a coupling           # change/temporal coupling
maat -l repo.log -c git2 -a soc                # sum-of-coupling
maat -l repo.log -c git2 -a age                # code age (months since last touch)
maat -l repo.log -c git2 -a authors            # number of distinct authors per file
maat -l repo.log -c git2 -a main-dev           # main developer (ownership) per file
maat -l repo.log -c git2 -a entity-ownership   # ownership distribution
```

| Analysis | The question it answers | What it reveals |
|---|---|---|
| **Change frequency (revisions)** | How often does each file change? | The *change* axis of a hotspot. High frequency = a file the team keeps returning to. |
| **Hotspots** (frequency × complexity) | Where is expensive-to-change code changed most? | The prioritized refactoring target. Complexity is usually approximated by LOC or indentation as a cheap proxy, then refined with real complexity. |
| **Change coupling** | Which files change *together* even though nothing links them statically? | Hidden/temporal dependencies — copy-paste, leaky abstractions, shotgun-surgery seams. |
| **Sum of coupling (SoC)** | Which file is coupled to the *most* others, by total coupling weight? | The architectural center of gravity / the file most entangled with the rest of the system. A better "start here" than the single highest pairwise coupling. |
| **Complexity trend over time** | Is this file's complexity rising, flat, or falling across its history? | Whether a hotspot is *getting worse* (decaying) or being actively cleaned. A rising trend turns "complex" into "complex and deteriorating." |
| **Code age** | How long since each file was last modified? | Stability. Old, untouched code is low-risk (per Graves' time-damp); recently-and-repeatedly touched code is where risk concentrates. Also flags "stable code we can stop testing as hard." |
| **Knowledge map / authors** | How many people touch each file? | Coordination cost and review need. Many authors on a complex file = high coordination risk. |
| **Main developer / ownership** | Who wrote most of each file? | Truck/bus-factor and review routing. Concentrated ownership of a critical hotspot is a single-point-of-failure. |

Two of these are deep enough to warrant their own sections — **change coupling** (the most under-used and the most diagnostic of architectural problems) and the **ownership/knowledge** family (where code analysis meets org risk). The rest are summarized above.

A note on **complexity trends over time**: this is the one analysis that crosses cleanly back into [01 — Complexity](../01-cyclomatic-and-cognitive-complexity/senior.md). You compute a complexity proxy (whitespace/indentation complexity is the standard cheap one — it correlates with cyclomatic complexity and is language-agnostic) for a file *at each revision*, by checking out historical versions or reading blobs, and plot it. A file whose complexity climbs steadily over a year is accumulating debt in real time; a file whose complexity spiked then fell shows a refactor landed. This converts a single hotspot snapshot into a *velocity* — and velocity, not position, is what tells you whether to intervene now or watch.

> **Key insight:** Each behavioral analysis is one `git log` read through a different lens. Hotspots tell you *where* to look; change coupling tells you *what's secretly connected*; complexity trends tell you *which way it's moving*; ownership tells you *who and how risky the bus factor is*. None of them require anything but the history you already have.

---

## Change Coupling — Temporal Dependencies the Compiler Can't See

Static coupling ([03](../03-coupling-and-cohesion-metrics/senior.md)) is what the code *declares*: A imports B, A calls B, A's fan-out includes B. **Change coupling** (also: *temporal coupling*, *logical coupling*, *co-change*) is what the code *does over time*: A and B keep getting committed together, regardless of whether either references the other.

The mechanism: for each commit, take the set of files it touched. Across all commits, count how often each pair of files appears together, and normalize:

```
coupling(A, B) = (commits touching both A and B)
                 / (commits touching A or B)        # a Jaccard-style degree, 0..1
```

`code-maat`'s coupling analysis reports, per pair, the **degree** (this percentage) and the **average number of revisions** (so you can ignore pairs with too little evidence — two files coupled at 100% over two commits is noise; 60% over 80 commits is signal).

What change coupling *reveals* that static analysis cannot:

- **Copy-paste that isn't textually identical.** Two files with the same *logic* but different names, edited in lockstep because a rule lives in both. A clone detector ([05](../05-duplication-and-similarity/)) might miss it if the text diverged; the co-change pattern won't.
- **Leaky abstractions.** A `UserService` and a `UserController` that *must* change together every time means the boundary between them is fictional — the abstraction doesn't actually decouple them.
- **Shotgun surgery as a measured quantity.** If one logical change consistently forces edits across six files, those six are change-coupled and the design has spread one responsibility across them.
- **The most damning signal: change coupling that crosses an architectural boundary.** Two files in *different modules / services / layers* — which the architecture says are independent — that nonetheless always change together. That is an architectural smell with teeth: your module boundary is a comment, not a constraint. This is the single highest-value thing change coupling finds, because it's invisible to every static tool (the modules don't reference each other) and it's exactly the coupling your architecture promised wasn't there.

**Sum of coupling (SoC)** answers a different question. The highest *pairwise* coupling can be a trivial pair (a file and its own test, which obviously co-change). SoC sums each file's coupling across *all* its partners, surfacing the file that is entangled with the most of the system — the true center of gravity. When you want a single "where is this system most knotted together" answer, SoC beats top-pairwise; it's the better entry point into an unfamiliar codebase's architecture.

```bash
maat -l repo.log -c git2 -a coupling --min-revs 10 --min-coupling 40
#   --min-revs     drop pairs with too few shared commits (kill the small-sample noise)
#   --min-coupling drop weak pairs; you want the strong, well-evidenced ones
maat -l repo.log -c git2 -a soc                # the center-of-gravity ranking
```

> **Key insight:** Change coupling is the only metric on this page that diagnoses *architecture* rather than *files*. A hotspot says "this file is risky." A cross-boundary change-coupling pair says "these two modules are secretly one module, and your architecture is lying about it." The first is a refactoring target; the second is a design problem — and you can only see it in the history.

---

## Knowledge Maps, Ownership, and Bus Factor

The history records not just *what* changed but *who* changed it. That turns version control into an organizational instrument — and one of the few places where code analysis and team/people risk meet directly.

**Ownership** — *main developer* and the ownership distribution per file — answers "who knows this code?" The research backdrop: Bird et al. ("Don't Touch My Code! Examining the Effects of Ownership on Software Quality," Microsoft Research, FSE 2011) found that components with **many minor contributors** (people responsible for a small fraction of the changes) had **more defects**, while clear, concentrated ownership correlated with fewer. The actionable shape of this:

- **A complex hotspot with one owner** → bus-factor risk. If that person leaves or is unavailable, a high-risk file becomes unmaintainable. The fix is deliberate knowledge spreading (pairing, review, documentation) *before* the bus arrives — not after.
- **A complex hotspot with many fragmented authors and no clear owner** → coordination and quality risk (the Bird et al. finding). No one holds the whole picture; changes step on each other. The fix is to *establish* ownership or split the file so each piece has a coherent owner.

Both are bad, for opposite reasons, and only the ownership analysis distinguishes them.

**Knowledge maps** visualize ownership across the whole tree — typically a colored map where each file is tinted by its main developer (or by author count). Two patterns jump out:

- **A critical subsystem that's entirely one color** → that subsystem's knowledge lives in one head.
- **A critical subsystem that's a rainbow** → no coherent ownership; high coordination cost.

**Truck/bus factor** is the headline number people quote: the minimum number of people who'd have to be hit by a bus (or, more humanely, leave) before the project is in serious trouble — i.e., the number of people holding knowledge no one else has. Behavioral analysis estimates it from the ownership distribution: if the top-1 author owns 90% of the high-risk files, the bus factor is ~1 and that's an organizational emergency hiding in the code. The senior move is to compute this *weighted by hotspot risk* — a bus factor of 1 on a dormant utility file is irrelevant; a bus factor of 1 on the payment hotspot is a board-level risk.

> **Key insight:** Ownership analysis converts "who wrote this" into two distinct, opposite risks — *too concentrated* (bus factor) and *too fragmented* (the Bird et al. defect signal). The same map flags both. And risk is only real when weighted by the hotspot: bus-factor-1 on dead code is a non-issue; bus-factor-1 on the hottest file is the thing to fix this quarter.

---

## Methodological Rigor — Cleaning the History

This is where most churn analyses quietly go wrong, and where a senior earns the title. The raw `git log` is full of events that *look* like churn but carry no risk signal. Feed them in and your hotspots are artifacts. The discipline is to **clean the history before you analyze it**, and to be explicit about every exclusion.

**1. Exclude bulk reformatting and mechanical commits.** The day someone ran Prettier / gofmt / clang-format across the repo, every file "changed" by hundreds of lines. That is the largest churn event in your history and means *nothing* about defect risk. So does a license-header insertion, a mass import-reordering, a `dos2unix` line-ending sweep, or a find-and-replace rename of a symbol. These must be excluded:

```bash
# git's own mechanism: list bulk-formatting commits in a file, then ignore them.
echo "<sha-of-the-prettier-bomb>" >> .git-blame-ignore-revs
git blame --ignore-revs-file .git-blame-ignore-revs file.js   # blame as if it never happened
git config blame.ignoreRevsFile .git-blame-ignore-revs        # make it the default
```

For churn aggregation specifically, drop those commits from the log you export (filter by SHA, or by commit-message convention like a `style:` / `chore(format):` prefix if your team uses Conventional Commits). The principle: **churn should count *semantic* change, not whitespace.** A reformatting commit is the canonical false positive.

**2. Exclude vendored, generated, and non-authored code.** `node_modules/`, `vendor/`, `third_party/`, lockfiles (`package-lock.json`, `go.sum`), generated protobufs, minified bundles, snapshots — these churn constantly and tell you nothing about *your* code's risk. A 200,000-line `package-lock.json` that changes on every dependency bump will dominate any raw churn ranking. Exclude by path:

```bash
git log --numstat -- . \
  ':(exclude)vendor/**' ':(exclude)**/node_modules/**' \
  ':(exclude)**/*.lock' ':(exclude)**/*_pb.go' ':(exclude)**/*.min.js' \
  ':(exclude)**/generated/**'
```

(`.gitattributes` with `linguist-generated` / `linguist-vendored` marks the same files for GitHub's stats; align the two so your local analysis and GitHub agree on what's "yours.")

**3. Normalize the churn — relative, not absolute.** This is Nagappan & Ball operationalized. Never rank files by raw lines changed. Normalize by at least one denominator:

- **Churn / file size** — a 30-line file with 30 lines of churn (rewritten once) is different from a 3,000-line file with 30 lines of churn (a one-line fix). Per-line churn ratio is the closest analog to the paper's primary measure.
- **Number of commits (revisions)**, not total lines — often a *better* change axis than line count, because it counts how often the team *returned* to the file, which is robust to one giant commit. (This is why `code-maat`'s hotspot uses revision count as the change axis.)
- **Churn per unit time** — controls for the simple fact that older files have had more calendar time to accumulate changes.

**4. Control for file age.** A file that's existed for five years has had five years to accrue churn; a file added last month hasn't. Comparing their absolute churn is meaningless. Either restrict the analysis to a fixed *recent window* (e.g., last 6–12 months — which also better reflects the *current* team and codebase) or normalize churn by the file's age. Graves' time-damp insight applies: recent churn is far more predictive than old churn, so a recent window is usually the right call anyway.

**5. Control for team size and activity.** Churn scales with how many people are committing and how active the project is. A file in a 50-engineer monorepo will out-churn an identical file in a 3-person repo for reasons that have nothing to do with its quality. When comparing across teams or repos, normalize by commits-per-author or restrict to comparable activity windows — otherwise you're measuring headcount, not risk.

**6. Choose the analysis window deliberately.** "All history since the big bang" includes a different team, a different architecture, and the reformatting bombs of years past. A rolling 6–12 month window captures the *current* system's behavior and is what most behavioral analyses default to. State the window explicitly in any report — a hotspot ranking is meaningless without it.

> **Key insight:** The order of operations is non-negotiable: **clean, then normalize, then analyze.** Skipping the cleanup makes the `package-lock.json` and the Prettier commit your top "hotspots"; skipping the normalization makes your biggest files your "riskiest" — the exact mistake Nagappan & Ball showed is wrong. Every serious churn report should be able to answer: *what window, what exclusions, normalized by what?* If it can't, distrust it.

---

## The Rename Problem — `-M`, `--follow`, and What Git Doesn't Store

Here is the single most important git-mechanics fact for churn analysis, and the one most people get wrong: **git does not store renames.** A commit stores a *snapshot* of the whole tree. When you move `auth.py` to `security/auth.py`, git records that `auth.py` disappeared and `security/auth.py` appeared. The "rename" is *inferred at read time* by a heuristic, not retrieved from a record.

Why this wrecks naive churn analysis: if you walk history without rename detection, a moved or renamed file looks like a **deletion plus a brand-new file**. Its accumulated change history is severed at the rename. A genuine 5-year hotspot that was reorganized into a new directory last quarter shows up as a pristine 3-month-old file — its risk *vanishes from the ranking* exactly when you most need to see it. Renames are common (every refactor, every package reorg), so this is not an edge case.

The tools git gives you, and their sharp edges:

- **`-M` (rename detection)** turns on the similarity heuristic: git pairs a deleted path with an added path when their content is similar enough (default ~50%; `-M90%` requires 90% similarity). This is what makes `git log -M --numstat` attribute churn across a rename. **But it's a heuristic** — a file renamed *and* heavily edited in the same commit can fall below the similarity threshold and be seen as delete+add anyway. And it operates per-commit pair, so a rename plus a big edit is the failure case.
- **`-C` (copy detection)** additionally detects content copied from another file — useful for catching copy-paste origins, expensive to compute (`-C -C` searches harder, scanning unmodified files too).
- **`--follow`** follows a *single* file's history across renames — but it has real limitations: it works for **exactly one path at a time** (you can't `--follow` a whole tree or a directory), and its rename-following is itself heuristic and known to miss renames that more thorough diff settings would catch. It's a `git log <file>` convenience, **not** a basis for repo-wide churn analysis.

The consequences for analysis, and the senior's handling:

```bash
# For a single file's true history (interactive investigation):
git log --follow --numstat -- security/auth.py      # follows across the rename(s)

# For repo-wide churn, --follow doesn't apply (one path only). Decide on rename policy:
git log -M --numstat                                # detect renames; attribute churn across them
git log --no-renames --numstat                      # treat renames as delete+add (code-maat's usual input)
```

The catch that trips up tool users: **`code-maat`'s standard recipe uses `--no-renames`** (see the export command earlier). It treats a rename as the old file dying and a new one being born. This is a *deliberate, documented* choice — repo-wide cross-rename attribution is unreliable, so the tool opts for predictable behavior and asks you to be aware of it. The senior implication: after a major reorganization, your hotspot ranking will *understate* the risk of moved files for a while, because their history was reset at the move. You compensate by knowing your repo's reorg events and mentally (or via `--follow`) re-attaching the severed history for the files you care about.

> **Key insight:** Git stores snapshots, not renames — every "rename" is a *guess* made when the log is read. `-M` makes the guess; `--follow` makes it for one file only and imperfectly; `--no-renames` (what most churn tools use) declines to guess and resets a file's history at every move. There is no setting that makes rename handling perfect, so the rigorous move is to *know your repo's big reorganizations* and treat post-reorg hotspot rankings as understating moved files until enough new history accrues.

---

## Statistical Cautions — Disentangling Churn, Size, and Activity

Churn is correlated with several other things, and if you don't disentangle them you'll attribute risk to the wrong cause. This is the part that keeps the analysis intellectually honest.

**Churn correlates with size.** Bigger files have more lines to change and tend to change more in absolute terms. So *absolute* churn and LOC are entangled — and if you rank by absolute churn, you're partly just re-discovering "big files are big." Nagappan & Ball's finding that *relative* churn beats absolute is precisely the correction: normalize by size and you measure churn's *independent* contribution to risk, not its overlap with size. The practical test: if your "hotspots" are just your largest files, you forgot to normalize.

**Churn correlates with activity / importance.** A file changes a lot partly because it's *important* and *central* — the main config, the core domain model, the API surface. High churn there reflects healthy, necessary evolution, not rot. A registry or feature-flag file that gets a new entry every week is churning constantly and is *fine*. This is why churn alone is a poor risk metric and the **hotspot (churn × complexity)** exists: it's the conjunction with *complexity* that separates "important and frequently-but-cheaply edited" from "important and expensive-to-edit." Churn locates *activity*; complexity tells you whether that activity is *painful*.

**Correlation is not causation, in both directions.** Does complexity *cause* the churn (hard code needs constant fixing), or does the churn *cause* the complexity (constant edits accrete cruft)? Almost certainly both, in a feedback loop — which is *why* hotspots are good refactoring targets (break the loop) but *also* why you can't read causation off the correlation. Don't claim "this file is buggy *because* it's complex"; claim "this file is *both* complex and constantly changed, which is where defects empirically concentrate, so it's worth attention."

**Beware confounders when comparing across contexts.** Across teams, repos, or time periods, churn is confounded by headcount, team maturity, release cadence, and tooling. A spike in churn might be a new hire's onboarding, a planned migration, or a tooling change that reformats on save — none of which is a quality signal. Always ask *what else changed* before attributing a churn pattern to code quality.

**Sample size and the small-pair trap.** Two files coupled at "100%" over three commits is statistically meaningless; the `--min-revs` / minimum-shared-commits guard exists for exactly this. The same caution applies to any per-file metric computed over a short window — a file with two commits has no stable churn rate. Require enough evidence before trusting a ratio.

> **Key insight:** Churn is correlated with size *and* with importance/activity, so on its own it can't tell risk from healthy evolution. The two corrections are structural, not optional: **normalize** (to subtract out size — the Nagappan & Ball lesson) and **conjoin with complexity** (the hotspot — to subtract out cheap-but-frequent change). A churn number reported without both is a number that will mislead you.

---

## From Analysis to Action

The analyses converge on a small set of *signals*, each mapping to a specific decision. The decisions about *prioritization against everything else* — and the budgeting and stakeholder case — belong to [Technical Debt Management](../../technical-debt-management/); here is how the *analysis* points at the action.

- **Hotspot (high complexity × high change) with a *rising* complexity trend** → a refactoring target, and an urgent one. The rising trend is the tiebreaker: it means the file is actively deteriorating, so the cost of waiting compounds. Of all the signals, this is the strongest single "refactor this now" indicator, because you have evidence it's expensive *and* getting worse.
- **Hotspot with a *flat or falling* trend** → watch, don't necessarily act. It's painful but stable, or already being cleaned. Spend the refactoring budget on the rising one.
- **High complexity, low change (a "stable hotspot")** → leave it alone. Refactoring settled complex code is pure risk with no recurring payoff — you might introduce a bug into code that hasn't had one in years. This is the most common *over*-reaction the metrics tempt; resist it.
- **Change coupling across a module/service boundary** → an architectural smell. The action is not "refactor a file" but "fix the boundary" — extract the shared concept, introduce a real interface, or merge the two fictitiously-separate modules. This is design work, and it's the highest-leverage finding because the coupling is invisible to every static tool.
- **High change coupling between a file and a *distant* file (not its obvious test)** → investigate for hidden duplication or a leaky abstraction; often resolves to a missing shared abstraction or a copy-paste pair.
- **A risk-weighted hotspot with bus-factor 1** → a knowledge-distribution action (pair, review, document) *in parallel with* the refactor. The org risk and the code risk reinforce each other; address both.
- **A complex hotspot with many fragmented owners** → establish ownership or split the file along its responsibilities so each piece has a coherent owner (the Bird et al. corrective).

The throughline: **the analysis produces a prioritized, evidence-backed worklist, not a grade.** Every item points at a specific file or boundary and a specific kind of intervention. What it deliberately does *not* do is tell you whether that work clears the bar against feature work, incident risk, and everything else — that ranking, and its justification to whoever owns the budget, is the job of [Technical Debt Management](../../technical-debt-management/). The clean handoff is: behavioral analysis says *here are the highest-risk places and why*; debt management decides *which we pay down, when, and how we justify it.*

> **Key insight:** Behavioral analysis answers "where is the risk and what kind is it"; it does *not* answer "is fixing it worth more than the next feature." Keep that line crisp. The metric's job is to produce a defensible, prioritized worklist with evidence attached. The prioritization-against-everything-else and the business case live one section over, in [Technical Debt Management](../../technical-debt-management/) — and conflating the two is how good analysis turns into a metric-driven mandate nobody can defend.

---

## Mental Models

- **Risk is a property of code *under change*, not of code.** A static analyzer photographs the code; behavioral analysis films it. The dangerous file is rarely the most complex — it's the moderately complex one everybody keeps editing. Only the film shows "everybody keeps editing."

- **Relative beats absolute — that's the whole Nagappan & Ball result.** Raw lines-changed and raw LOC are weak because they're entangled with size. Normalized churn is strong. If your hotspots look like your biggest files, you skipped the normalization that *is* the finding.

- **Process beats product — that's the whole Graves et al. result.** How a module has been *treated* (change count, recency) predicts faults better than what it *is* (size, complexity). History out-predicts the snapshot.

- **A hotspot is a conjunction, not a metric.** Complexity × change. Each factor alone misleads — complexity flags settled code, churn flags healthy evolution. The product flags expensive-and-active code, which is the empirically defect-prone region.

- **Change coupling is the only architecture metric here.** Hotspots judge files; change coupling judges *boundaries*. A cross-module co-change pair is the design lying about its own structure — and it's invisible to every static tool because the modules don't reference each other.

- **Git stores snapshots, not renames.** Every rename is a *guess* made at read time. This is why a reorganized hotspot can vanish from the ranking, and why "clean and aware of reorgs" beats trusting any single rename flag.

- **Clean, then normalize, then analyze.** The reformatting commit and the lockfile are the canonical false positives. Skip the cleanup and they become your top hotspots; skip the normalization and your biggest files do.

---

## Common Mistakes

1. **Ranking files by absolute churn (raw lines changed).** This is the measure Nagappan & Ball specifically found weak, and it mostly re-discovers "big files are big." Always normalize — by size, by revision count, or per unit time. Absolute churn is a trap.

2. **Letting reformatting commits, lockfiles, and vendored code into the analysis.** The Prettier-bomb commit and the 200k-line `package-lock.json` will dominate any raw ranking and mean nothing. Exclude generated/vendored paths and bulk-format commits *before* analyzing, and say so in the report.

3. **Trusting hotspot rankings across a recent reorganization.** Git infers renames; a moved file's history is severed (especially under `--no-renames`, which most tools use). A real long-lived hotspot can masquerade as a fresh file. Know your reorg events and treat post-reorg rankings as understating moved files.

4. **Using `--follow` for repo-wide analysis.** `--follow` handles exactly one path and follows renames imperfectly. It's for investigating *one* file interactively, never the basis for a whole-repo churn report.

5. **Refactoring stable complex code because the static metric is high.** High complexity with *low* change is intrinsic complexity that's stopped costing you. Refactoring it is risk with no recurring payoff. The change axis exists precisely to stop you from doing this.

6. **Reading churn as a quality verdict instead of an activity signal.** High churn often means a file is *important* and healthily evolving (the central config, the core model). Only churn *conjoined with complexity* (a hotspot) is a risk signal. Churn alone measures activity, not rot.

7. **Claiming causation from the churn–complexity correlation.** "It's buggy because it's complex" overstates what the data supports. The honest claim is "it's both complex and constantly changed — where defects empirically concentrate — so it warrants attention." Correlation, prioritization, not causation, verdict.

8. **Trusting ratios computed over tiny samples.** A pair coupled at 100% over three commits, or a churn rate from two commits, is noise. Use the minimum-revisions / minimum-coupling guards and require enough evidence before believing a number.

---

## Test Yourself

1. State Nagappan & Ball's central finding precisely. What's the difference between what *absolute* and *relative* churn measures predict, and why does that distinction dictate how you rank files?
2. Graves et al. compared two families of fault predictors. Name them, say which won, and explain what "process beats product" means as a practical rule for churn analysis.
3. Two files both have cyclomatic complexity 60. Why might one be a top refactoring target and the other something you should explicitly *leave alone*? Which analysis distinguishes them?
4. What does change coupling reveal that static coupling cannot? Give the specific pattern that constitutes an *architectural* smell, and explain why it's invisible to static tools.
5. Git "doesn't store renames." Explain what that means mechanically and how it can make a genuine long-lived hotspot disappear from your ranking. What do `-M`, `--follow`, and `--no-renames` each do about it?
6. Your churn ranking's top three "hotspots" are `package-lock.json`, a file touched by a repo-wide `gofmt` commit, and your largest source file. Diagnose each and give the fix.
7. Churn correlates with both file size and file importance/activity. Explain how each correlation can mislead you, and the two structural corrections that address them.

<details>
<summary>Answers</summary>

1. Nagappan & Ball (ICSE 2005, Windows Server 2003) found that **relative** churn measures (churned LOC normalized by total LOC, churned files per binary, churn per week, etc.) predict **defect density** with high accuracy, while **absolute** churn measures do not on their own — and relative churn *out-predicts absolute size (LOC)*. Practical consequence: never rank by raw lines changed; normalize, because absolute churn is entangled with size and the *normalized* measure is the one with predictive power.
2. **Product metrics** (size, complexity — properties of the static snapshot) vs **process metrics** (the change history). Process won — change count and recency predicted faults better than size/complexity. As a rule: how code has been *treated over time* is a stronger risk signal than what it *is* right now, so prefer history-based ranking over snapshot-based ranking, and weight recent change more (their time-damp model).
3. One might be intrinsically complex but **stable** (e.g., a date parser written once and never touched) — leave it alone; refactoring settled code is risk with no recurring payoff. The other might be complex *and* **constantly changed** (e.g., a payment module) — that's the hotspot and a top refactoring target, because defects are injected during edits and complexity makes edits error-prone. **Change frequency** (the history) distinguishes them; the static complexity score cannot.
4. Change coupling reveals files that **change together over time** regardless of whether they statically reference each other — copy-paste, leaky abstractions, shotgun surgery. The architectural smell is **co-change across a module/service/layer boundary**: two modules the architecture says are independent that always change together. It's invisible to static tools because the modules *don't reference each other* — there's nothing in the code to detect; the dependency exists only in the history.
5. Git stores whole-tree **snapshots**, not rename records; a rename is a *deletion + addition* that tools **infer** at read time via a similarity heuristic. Without rename detection (or when a rename + heavy edit falls below the similarity threshold), a moved file looks brand-new and its accumulated history is severed — so a 5-year hotspot reorganized last quarter ranks as a fresh, low-risk file. **`-M`** turns on rename detection so churn is attributed across the move; **`--follow`** follows one path's history across renames (single file only, imperfect); **`--no-renames`** declines to detect (treats every rename as delete+add — and is what `code-maat`'s standard recipe uses).
6. `package-lock.json` → **vendored/generated noise**; exclude lockfiles and generated paths (`:(exclude)**/*.lock`, `.gitattributes linguist-generated`). The `gofmt`-touched file → a **bulk-reformatting false positive**; exclude that commit (`.git-blame-ignore-revs` / filter `style:`/`chore(format):` commits from the exported log) so churn counts semantic change, not whitespace. The largest source file → likely an **un-normalized absolute-churn artifact**; normalize by size or revision count — if it's just big, it shouldn't rank as a hotspot.
7. **Size correlation:** absolute churn rises with LOC, so ranking by it partly re-discovers "big files are big" — correction: **normalize** by size (the relative-churn lesson). **Importance/activity correlation:** central files (config, core model) churn a lot through healthy evolution, not rot — correction: **conjoin churn with complexity** (the hotspot), so you flag expensive-and-active code, not cheap-but-frequent change. Both corrections are structural: normalize, and require the complexity conjunction.

</details>

---

## Cheat Sheet

```
THE EVIDENCE (cite these)
  Nagappan & Ball 2005 (MSR, ICSE)  RELATIVE churn predicts defect density;
                                    ABSOLUTE churn / LOC does NOT (on its own)
  Graves et al. 2000 (IEEE TSE)     PROCESS (change history) > PRODUCT (size/complexity)
                                    + time-damp: recent change predicts more than old
  Bird et al. 2011 (MSR, FSE)       many MINOR contributors → more defects;
                                    clear ownership → fewer
  → ranking tool, not oracle: prioritize attention, don't read off bug counts

THE HOTSPOT
  hotspot = complexity × change       (NOT complexity alone, NOT churn alone)
  hi cx + hi change  → refactor (esp. if complexity trend is RISING)
  hi cx + LO change  → leave alone (intrinsic, settled complexity)
  lo cx + hi change  → usually fine (cheap, frequent edits)

BEHAVIORAL TOOLKIT (one git log, many lenses)  — code-maat -a <kind>
  revisions     change frequency (the X-axis)
  coupling      change/temporal coupling — files that co-change
  soc           sum-of-coupling — the entanglement center of gravity
  age           code age (stability; old+untouched = low risk)
  authors       distinct authors per file (coordination cost)
  main-dev      ownership (bus factor / review routing)

CLEAN → NORMALIZE → ANALYZE  (order is non-negotiable)
  exclude: vendored/generated, lockfiles, minified, bulk-reformat commits
    .git-blame-ignore-revs  +  :(exclude)**/*.lock  +  linguist-generated
  normalize: churn / size, OR revision count, OR churn / time  (relative!)
  control for: file age (use a recent window), team size, activity

THE RENAME TRAP (git stores SNAPSHOTS, not renames)
  -M            detect renames (similarity heuristic; rename+big-edit can miss)
  --follow      one path only, imperfect — investigation, not repo-wide analysis
  --no-renames  treat rename as delete+add (code-maat's default; severs history)
  → post-reorg rankings UNDERSTATE moved files; know your reorg events

STATISTICAL CAUTIONS
  churn ↔ size       → normalize (else you re-discover "big files are big")
  churn ↔ importance → conjoin with complexity (else healthy evolution looks like rot)
  causation unclear  → "complex AND churned" ≠ "buggy because complex"
  small samples      → --min-revs / --min-coupling guards

ACTION (analysis → worklist; prioritization → Technical Debt Mgmt)
  rising-trend hotspot          → refactor now
  cross-boundary change coupling → fix the architecture, not a file
  risk-weighted bus-factor 1     → spread knowledge + refactor
```

---

## Summary

- The practice rests on two citable results: **Nagappan & Ball** (relative churn predicts defect density; absolute churn and raw LOC largely don't) and **Graves et al.** (process/history out-predicts product/snapshot, with recent change weighted more). These make churn-based risk an evidence-backed tool, not folklore — but a *ranking* tool for prioritizing attention, never a bug-count oracle.
- **Behavior beats the static snapshot** because risk lives in *code under change*. The most dangerous file is usually the moderately complex one everyone keeps editing — which a static analyzer is structurally blind to. Hence the **hotspot = complexity × change** conjunction.
- The **behavioral toolkit** mines one `git log` through many lenses: change frequency, hotspots, change coupling, sum-of-coupling, complexity trends, code age, knowledge maps, and ownership. Each answers a distinct question; **change coupling** uniquely diagnoses *architecture* — a cross-boundary co-change pair is design lying about its own structure.
- **Ownership analysis** splits into two opposite risks: too concentrated (**bus factor**) and too fragmented (the **Bird et al.** defect signal). Both matter only when *weighted by hotspot risk*.
- **Methodological rigor is the whole game:** clean (exclude reformatting commits, lockfiles, vendored/generated code), then normalize (relative churn — the Nagappan & Ball lesson), then analyze — controlling for file age, team size, and the analysis window. Skip the cleanup and lockfiles top your ranking; skip the normalization and your biggest files do.
- **Git stores snapshots, not renames** — every rename is an inferred guess, so a reorganized hotspot can vanish from the ranking. `-M` guesses, `--follow` guesses for one file, `--no-renames` (most tools' default) declines and severs history. Rigor means knowing your repo's reorgs.
- **Disentangle the correlations:** churn tracks size (normalize) and importance/activity (conjoin with complexity). Don't claim causation from the correlation.

The analysis produces a defensible, prioritized worklist with evidence attached — *where* the risk is and *what kind*. Whether fixing it beats the next feature, and how you justify that, is a different discipline: [professional.md](professional.md) operates these analyses across an organization and over time, and [Technical Debt Management](../../technical-debt-management/) turns the worklist into funded decisions.

---

## Further Reading

- **Nagappan, N. & Ball, T. — "Use of Relative Code Churn Measures to Predict System Defect Density," ICSE 2005 (Microsoft Research).** The primary source for "relative churn predicts defect density, absolute doesn't." Read the relative-measure definitions directly.
- **Graves, T. L., Karr, A. F., Marron, J. S. & Siy, H. — "Predicting Fault Incidence Using Software Change History," IEEE TSE 26(7), 2000.** Process-vs-product, and the weighted-time-damp model that motivates code age.
- **Bird, C. et al. — "Don't Touch My Code! Examining the Effects of Ownership on Software Quality," FSE 2011 (Microsoft Research).** The ownership/fragmentation-vs-defects evidence behind the knowledge-map analyses.
- **Adam Tornhill — *Your Code as a Crime Scene* (2nd ed.) and *Software Design X-Rays*.** The industrial synthesis: hotspots, change coupling, complexity trends, knowledge maps — and the practice of running them.
- **`code-maat`** — [github.com/adamtornhill/code-maat](https://github.com/adamtornhill/code-maat). The reference implementation of every analysis named here; read its README for the exact `git log` recipe (and why it uses `--no-renames`).
- **Pro Git, "Git Internals"** and `man git-log` / `man git-diff` (the `-M`, `-C`, `--follow`, `--no-renames` sections). The ground truth on snapshots-not-deltas and rename *detection*.

---

## Related Topics

- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/senior.md) — the complexity axis of a hotspot, and the complexity-trend-over-time analysis.
- [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/senior.md) — *static* coupling, the snapshot counterpart to change coupling; the contrast is the point.
- [05 — Duplication & Similarity](../05-duplication-and-similarity/) — change coupling often surfaces clones that diverged textually and slipped past a clone detector.
- [Technical Debt Management](../../technical-debt-management/) — turning a prioritized hotspot worklist into funded, justified decisions (the application this page deliberately doesn't duplicate).
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set.
