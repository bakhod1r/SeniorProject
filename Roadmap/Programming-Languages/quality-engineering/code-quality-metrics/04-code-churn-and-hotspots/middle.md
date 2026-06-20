# Code Churn & Hotspots — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Churn & Hotspots
> *The junior page said "files that change a lot and are complex are risky." This page makes that operational: the exact churn measures and when each one lies, how to mine your own `git log` into a ranked hotspot list, and how to find the hidden dependencies — files that always change together — that no static analyzer can see.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Churn Measures — and Why They Disagree](#the-churn-measures--and-why-they-disagree)
4. [Computing Churn from `git log`](#computing-churn-from-git-log)
5. [The Hotspot Technique — Churn × Complexity](#the-hotspot-technique--churn--complexity)
6. [Change Coupling — the Dependencies No Static Tool Sees](#change-coupling--the-dependencies-no-static-tool-sees)
7. [Normalizing for Age and Recency](#normalizing-for-age-and-recency)
8. [Reading the Output](#reading-the-output)
9. [Build It Yourself vs Buy a Tool](#build-it-yourself-vs-buy-a-tool)
10. [Worked Example — A Hotspot Ranking and a Co-Change Pair](#worked-example--a-hotspot-ranking-and-a-co-change-pair)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I compute churn and hotspots correctly from version control — and what do I do with the output?**

At the junior level a hotspot is an intuition: "the file everyone keeps touching." That intuition is right, but it can't yet answer the operational questions. *Which* churn number do you rank by — commit count, lines changed, or author count? They give different answers and disagree on purpose. How do you compute it without buying a tool? Why does a brand-new file always look like a hotspot, and how do you correct for that? And the deepest one: how do you find the two files that always change together even though no `import` connects them?

This page answers those with the actual commands. Your version-control history is a behavioral log — a record of where effort and pain *actually went*, not where the architecture diagram says it should have. Static metrics describe code as it sits frozen on disk; churn describes code as it *lived*. The two together — the **hotspot** — is one of the strongest, cheapest defect predictors you can compute, and you already have the data in `.git`.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can say in one sentence why a stable, complex file is lower priority than a churning, complex one.
- **Required:** Comfortable with `git log` and a Unix pipe (`sort`, `uniq`, `awk`); you can read a column of counts.
- **Helpful:** You know roughly what cyclomatic complexity counts ([01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/middle.md)).
- **Helpful:** You've felt the pain of "I changed *this* and *that unrelated thing* broke."

---

## The Churn Measures — and Why They Disagree

"Churn" is not one number. There are three common measures, they capture different things, and choosing the wrong one quietly biases your whole analysis.

| Measure | What it counts | Captures | Biased toward |
|---|---|---|---|
| **Number of revisions** | Commits that touched the file | *How often* the file is a unit of change | Files touched in many small commits |
| **Lines added + deleted** | Raw line deltas (code churn) | *How much* text moves through the file | Large files; generated/formatted churn |
| **Distinct authors** | Unique committers over a window | *How many minds* must understand it | Shared, central, coordination-heavy files |

These genuinely disagree. A 4000-line generated `schema.pb.go` can top the *lines-changed* chart every release while being touched in one mechanical commit — high line-churn, trivial *revision* count, irrelevant risk. A 60-line `auth/permissions.rb` edited in 90 separate commits by 12 people is a screaming risk on *revisions* and *authors* but barely registers on *lines*. Same repo, three different "worst file" answers.

Which to use:

- **Number of revisions** is the default and the most robust hotspot signal. A commit is a deliberate decision to change *this file*; counting those decisions tracks where change concentrates, independent of formatting noise. This is what Tornhill ranks by, and what you should reach for first.
- **Lines added + deleted** answers "how much volume moved" — useful for sizing effort or spotting churn *spikes*, but it inflates large and auto-formatted files. Treat it as a secondary lens, not the ranking key.
- **Distinct authors** is your *coordination* and *knowledge-risk* signal. Many authors on one file means many mental models colliding — a strong correlate of defects (Nagappan & Ball found exactly this at Microsoft) and a flag for diffused ownership.

> **Key insight:** Rank by **number of revisions**, not lines. Revision count measures *frequency of decisions to change the file* and is immune to the formatting/generated-code noise that wrecks line-based churn. Keep lines-changed and author-count as secondary lenses, not the primary axis.

---

## Computing Churn from `git log`

You do not need a tool to get a revision-count ranking. The whole thing is one pipeline.

```bash
# Revision count per file: rank by how many commits touched each file
git log --format= --name-only \
  | sort \
  | uniq -c \
  | sort -rn \
  | head -20
```

Read it left to right. `--format=` blanks the commit header so only file paths print; `--name-only` lists the files each commit touched; `sort` groups identical paths together; `uniq -c` collapses each run into `count path`; `sort -rn` orders by that count, descending. Sample output:

```
    312 src/payments/gateway.go
    188 src/auth/session.go
    141 cmd/server/main.go
     96 src/payments/refund.go
     ...
      2 docs/architecture.md
```

`gateway.go` was touched by 312 commits — your top hotspot *candidate* (it's not a hotspot until you overlay complexity; see the next section). To scope to recent history, add a time window:

```bash
git log --since="12 months ago" --format= --name-only \
  | sort | uniq -c | sort -rn | head -20
```

For **distinct authors** per file, pair each touched path with its author and count uniques:

```bash
# Authors per file (most-shared files first)
git log --format='%an' --name-only \
  | awk 'NF==1 && !/\//{a=$0; next} /\//{print a"\t"$0}' \
  | sort -u \
  | awk -F'\t' '{c[$2]++} END{for(f in c) print c[f]"\t"f}' \
  | sort -rn | head -20
```

The `awk` carries the author line forward and attaches it to each following file path; `sort -u` dedupes author–file pairs; the final `awk` counts distinct authors per file. For raw **line churn**, switch to `--numstat`, which prints `added  deleted  path`:

```bash
git log --since="12 months ago" --numstat --format= \
  | awk 'NF==3 && $1!="-" {add[$3]+=$1; del[$3]+=$2}
         END{for(f in add) print add[f]+del[f]"\t"f}' \
  | sort -rn | head -20
```

The `$1!="-"` guard drops binary files, which `--numstat` reports as `-  -  path`. Three pipelines, three measures, zero tools installed.

> **Key insight:** Everything starts from `git log --name-only` (paths per commit) or `git log --numstat` (line deltas per commit). One mining pass over the log gives you all three churn measures; the only difference is what you count and how you group. Master this pipeline and you are never blocked waiting for a tool.

---

## The Hotspot Technique — Churn × Complexity

Churn alone is not a priority. A `config.yaml` or a localization file can dominate revision counts and be perfectly safe to change — high churn, *low complexity*, low risk. The signal you actually want is the **interaction** of two axes:

- **Churn (history)** — how often the file changes. Proxy: revision count from `git log`.
- **Complexity (structure)** — how hard the file is to change correctly. Proxy: anything you have — even **lines of code** works as a first cut; cyclomatic complexity is better.

Plot every file with churn on one axis and complexity on the other and you get four quadrants. This is **Adam Tornhill's hotspot technique** (*Your Code as a Crime Scene*), and it is the core idea of this whole topic:

```
 complexity
  high │  REFACTOR-WHEN-TOUCHED   │   HOTSPOTS  ◄── priority #1
       │  (complex but stable)    │  (complex AND churning)
       │                          │
  low  │  HEALTHY                 │   CHEAP CHURN
       │  (simple, stable)        │  (changes a lot, easy)
       └──────────────────────────┴──────────────────────────
                low                         high      churn
```

Only the **top-right** quadrant — high churn × high complexity — earns the name *hotspot*. That is code your team changes constantly *and* finds hard to change safely: maximum exposure to defects, maximum return on refactoring. The other quadrants are explicitly *not* urgent, which is the point — the technique tells you what to ignore as much as what to fix.

The cheapest honest version uses LOC as the complexity proxy, because you can get both numbers from the command line with nothing installed:

```bash
# Complexity proxy: lines of code per file (current tree)
git ls-files '*.go' | xargs wc -l | sort -rn
```

Join that to the revision counts from the previous section and a file ranking high on *both* is your hotspot. LOC is a crude proxy — it ignores nesting and branching — but it is monotonic enough that the *top-right quadrant barely moves* when you upgrade to cyclomatic complexity. Start with LOC; refine later if you must.

> **Key insight:** A hotspot is an **AND**, never an **OR**. High churn alone = maybe a config file. High complexity alone = stable, leave it. Only **churn × complexity** isolates the code that is both heavily changed and hard to change — and that single quadrant is where your refactoring time pays back fastest.

---

## Change Coupling — the Dependencies No Static Tool Sees

Here is the part that makes history uniquely powerful. Static analysis can only see dependencies written *in the code* — an `import`, a function call, a shared type. But files can be coupled with **no syntactic link at all**, and the only place that coupling shows up is in the commit history.

**Change coupling** (a.k.a. **temporal coupling** or **logical coupling**) is the observation: *whenever file A changes, file B also tends to change in the same commit.* If two files co-change in 80% of the commits that touch either of them, they are coupled in *practice*, whatever the code says.

Why this finds bugs no static tool can:

- **A class and its hand-written tests.** Expected and healthy — confirms the test moves with the code.
- **A serializer and a deserializer in different modules.** Change the wire format on one side, you must change the other. Forget, and you ship a runtime decode error that no compiler catches. Static analysis sees two unrelated files; history sees a hard contract.
- **Two "independent" services sharing an implicit protocol** — a magic header, a status-code convention. No shared symbol, yet they must change in lockstep. This is exactly the hidden architectural debt change coupling exposes.

You mine it by pairing files within each commit and counting how often each pair appears together. The conceptual recipe:

```bash
# Per commit, emit the set of touched files, then count co-change per pair.
git log --format='COMMIT' --name-only \
  | awk '
      /^COMMIT/ { emit(); n=0; next }
      /\//      { f[++n]=$0 }
      function emit(){ for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) print f[i]" :: "f[j] }
      END       { emit() }' \
  | sort | uniq -c | sort -rn | head -20
```

Each line of output is `count fileA :: fileB` — the number of commits in which that pair changed together. The raw count is a start, but the number that matters is the **degree of coupling**: how often they co-change *relative to how often either changes at all*.

$$\text{coupling}(A,B) = \frac{\text{commits touching both } A \text{ and } B}{\text{commits touching } A \text{ or } B}$$

Two files that each change 200 times but together only 5 times are *not* coupled (ratio ≈ 0.025); two files that each change 20 times and together 16 times are *tightly* coupled (ratio ≈ 0.8) even though the raw count is lower. Always normalize by the union, or large files manufacture false pairs.

> **Key insight:** Change coupling is the **only** way to surface dependencies that exist in behavior but not in syntax — serializer/deserializer pairs, shadow protocols, copy-paste twins. A high coupling ratio between two files in *different* modules is a red flag your architecture's boundaries are fiction. No static analyzer will ever find this, because there is nothing in the code to find.

---

## Normalizing for Age and Recency

Raw lifetime churn has a built-in bias: it rewards *old* files for simply having existed longer, and it cannot tell a file that was hot last month from one that was hot three years ago and has since stabilized. Both distortions point you at the wrong code.

Two corrections matter:

1. **Age bias.** A file present since the first commit has had years to accumulate revisions; a file added last quarter has had weeks. Comparing their lifetime totals is comparing different-length races. The simplest fix is to **window the analysis** — `--since="12 months ago"` — so every file is measured over the same recent period. Everyone competes on the same calendar.

2. **Recency weighting.** Within the window, a commit from last week is stronger evidence of *current* risk than one from eleven months ago. Code that *was* a hotspot but hasn't been touched in months has likely stabilized; it should fade. Tools like CodeScene model this explicitly as a time-decay: weight each commit by recency so recent activity dominates the score and old activity decays toward zero.

A pragmatic recency-weighted score, computable from the log, sums a decaying weight per commit instead of counting commits equally:

```bash
# Recency-weighted churn: newer commits count more (linear decay over the window)
NOW=$(date +%s)
git log --since="12 months ago" --format='C %ct' --name-only \
  | awk -v now="$NOW" '
      /^C / { age=(now-$2)/86400; w=(365-age)/365; if(w<0)w=0; next }
      /\//  { s[$0]+=w }
      END   { for(f in s) printf "%.1f\t%s\n", s[f], f }' \
  | sort -rn | head -20
```

`%ct` is the commit's Unix timestamp; the weight `w` falls linearly from 1 (today) to 0 (a year ago), so a file with ten commits last month outranks one with ten commits last winter. Production tools use smoother exponential decay, but the principle is identical and the linear version is plenty for a first pass.

> **Key insight:** Lifetime churn measures *history*; you usually want *current* risk. Always window the analysis so age bias cancels, and prefer recency-weighted churn so a file that has cooled off stops masquerading as a hotspot. Recent churn is the predictor — old churn is archaeology.

---

## Reading the Output

The numbers are worthless until you can read them like a senior. Two artifacts dominate.

**The hotspot list** is a ranking, *not* a grade. Each entry is "churn count, complexity proxy, path." The discipline is:

- Read it as a **priority queue**, not a scoreboard. The top entry is the single best place to spend the next refactoring hour — it is *not* "the worst engineer's file."
- Sanity-check the top of the list against generated and vendored paths. A `*.pb.go`, a `package-lock.json`, a `migrations/` file at the top is **noise**, not a hotspot — exclude it (`-- . ':!vendor' ':!*.pb.go'`) and re-run. Filtering noise is half the skill.
- Look at the **shape**, not the absolute numbers. Hotspots are heavily skewed: a tiny fraction of files take the overwhelming majority of changes. A long flat list means your proxy or window is wrong; a steep cliff at the top is the healthy, expected signal.

**A co-change pair** reads as `ratio (or count), fileA, fileB`. Ask three questions in order:

1. **Are they in the same module?** Same-folder coupling (a class and its test) is usually fine — expected, even reassuring.
2. **Are they in *different* modules?** Cross-boundary coupling is the alarm. `payments/refund.go` co-changing with `notifications/email.go` 75% of the time means a hidden contract crosses a boundary that was supposed to be clean.
3. **Is there a syntactic link?** If they co-change tightly but share no `import`, you have found *invisible* coupling — the highest-value finding, because nothing but history could have revealed it.

> **Key insight:** A metric output is an **invitation to investigate**, never a verdict. The hotspot list says "look here first"; the co-change pair says "these two move together — is that a healthy bond or a hidden leak?" The number opens the question; *you* close it by reading the code.

---

## Build It Yourself vs Buy a Tool

You have seen that the core analyses are a handful of `git log` pipelines. So when do you graduate to a tool?

**Build it yourself** when you want a quick read on one repo, need to script a CI check (e.g. "fail if a hotspot's complexity rises"), or want to understand exactly what the number means. The pipelines in this page are the whole engine; nothing is hidden.

| Tool | What it adds over your pipeline |
|---|---|
| **[code-maat](https://github.com/adamtornhill/code-maat)** | Tornhill's open-source miner. Feeds on `git log` and computes revisions, change coupling (normalized), authorship, and age out of the box. The reference implementation of everything above. |
| **CodeScene** | Commercial. Recency-weighted hotspots, change coupling across repos, knowledge-loss maps (churn by author who *left*), trend tracking, and the four-quadrant visual. Productizes Tornhill's research. |
| **Code Climate / SonarQube** | General quality platforms; churn is one signal among many, integrated into PR gating and the dashboard ([06 — Code Health Dashboards](../06-code-health-dashboards/middle.md)). |

The honest trade-off: the *math* is simple enough to DIY, but tools handle the tedious parts — rename tracking (a file moved across commits should keep its history), normalized coupling, multi-repo joins, decay tuning, and the visualization that makes a hotspot map land with non-engineers. Build it to learn and to script; buy it to scale across many repos and to put a picture in front of a VP.

> **Key insight:** The barrier to churn analysis is *not* the algorithm — it is `git log` and `awk`, which you have. Reach for code-maat or CodeScene when you need rename-aware history, normalized coupling at scale, or a visualization for stakeholders — not because the computation is hard.

---

## Worked Example — A Hotspot Ranking and a Co-Change Pair

Take a small service repo and go end to end with nothing but git.

**Step 1 — Rank by revision count (the churn axis), last 12 months, excluding noise:**

```bash
git log --since="12 months ago" --format= --name-only -- . ':!vendor' ':!*.pb.go' \
  | sort | uniq -c | sort -rn | head -10
```
```
    214 src/payments/gateway.go
    167 src/payments/refund.go
    151 src/auth/session.go
     88 src/orders/checkout.go
     ...
```

**Step 2 — Get the complexity proxy (LOC) for those files:**

```bash
wc -l src/payments/gateway.go src/payments/refund.go src/auth/session.go src/orders/checkout.go
```
```
   980 src/payments/gateway.go
   210 src/payments/refund.go
   430 src/auth/session.go
   120 src/orders/checkout.go
```

**Step 3 — Read the quadrant.** Cross the two columns:

| File | Revisions | LOC | Quadrant | Verdict |
|---|---|---|---|---|
| `gateway.go` | 214 | 980 | high × high | **Hotspot — priority #1** |
| `refund.go` | 167 | 210 | high × low | cheap churn — changes often, small; fine |
| `session.go` | 151 | 430 | high × high-ish | **secondary hotspot** |
| `checkout.go` | 88 | 120 | mid × low | healthy |

`gateway.go` is unambiguous: 214 changes in a year *and* 980 lines. That is where the next refactoring sprint goes — not because it has the most lines (other files might) but because it is changed constantly *and* hard to change. The verdict is "go read and untangle `gateway.go`," and from here the *prioritization* and payback decision belongs to [Technical Debt Management](../../technical-debt-management/) — this page got you to the file; that one decides the budget.

**Step 4 — Mine change coupling to explain *why* `gateway.go` churns:**

```bash
git log --format='COMMIT' --name-only \
  | awk '
      /^COMMIT/ { emit(); n=0; next }
      /\//      { f[++n]=$0 }
      function emit(){ for(i=1;i<=n;i++) for(j=i+1;j<=n;j++) print f[i]" :: "f[j] }
      END       { emit() }' \
  | sort | uniq -c | sort -rn | grep gateway.go | head -5
```
```
     71 src/payments/gateway.go :: src/payments/types.go
     58 src/payments/gateway.go :: src/billing/invoice.go
     12 src/payments/gateway.go :: test/payments_test.go
```

The second line is the finding. `gateway.go` (module `payments`) co-changes with `billing/invoice.go` (module `billing`) **58 times** — a tight cross-boundary bond. Normalize it: if `gateway.go` changed 214 times and `invoice.go` say 70 times, with 58 shared, the ratio is `58 / (214 + 70 − 58) ≈ 0.26` — strong enough to investigate. No `import` may connect them; the coupling is a *shared assumption* about the invoice format. That hidden contract is *why* `gateway.go` is a hotspot, and it's invisible to every static tool on the market. Fix the contract (make it explicit, version it) and the churn — and the risk — drops.

---

## Mental Models

- **Version history is a heat map of effort and pain.** Where the team commits over and over is where the design fights back. Churn doesn't measure code; it measures the *struggle* with code. The architecture diagram is the plan; the commit log is what actually happened.

- **A hotspot is an intersection, not a peak.** Not "the most-changed file" and not "the most-complex file" — the file in the *top-right corner* where both are true at once. Living at one extreme alone is usually fine; living at both is where defects breed.

- **Change coupling is gravity you can't see.** Two files pulled together every commit are bound by a force — even with no line of code connecting them. History is the only instrument that detects that force; static analysis is blind to it by construction.

- **Recent churn is the prediction; old churn is the obituary.** A file hot last month is a live risk. A file hot two years ago and quiet since has healed. Weight for recency or you keep re-fighting battles already won.

---

## Common Mistakes

1. **Ranking by lines changed instead of revisions.** Line churn is dominated by large and auto-formatted files; a reformatting commit can crown a stable file. Rank by **revision count**; keep lines as a secondary lens.

2. **Calling high churn a hotspot.** Churn alone is *not* risk — a config or localization file churns constantly and harmlessly. A hotspot requires churn **AND** a complexity proxy (LOC at minimum). Without the second axis you are just listing busy files.

3. **Forgetting to exclude generated and vendored paths.** `*.pb.go`, lockfiles, `vendor/`, `migrations/`, minified bundles top every churn chart and mean nothing. Filter them (`':!vendor' ':!*.pb.go'`) *before* drawing conclusions, or your whole list is noise.

4. **Using raw co-change counts without normalizing.** Two huge files appear in many commits by sheer size, manufacturing false coupling. Always divide by the *union* of commits touching either file; rank by the **ratio**, not the count.

5. **Ignoring file renames.** A file moved from `old/x.go` to `new/x.go` looks like two short-lived files to a naive pipeline, splitting and erasing its history. For serious analysis use a rename-aware tool (code-maat, `git log --follow` per file) or your hotspots vanish on every reorg.

6. **Treating lifetime totals as current risk.** Old files win on raw churn just by being old. Window the analysis (`--since`) so everyone is measured over the same period, and prefer recency weighting so cooled-off code stops ranking.

7. **Reading the ranking as a grade.** The hotspot list says "investigate here first," never "this is bad code by a bad engineer." It's a priority queue. The moment it becomes a performance scoreboard, people game it and the signal dies.

---

## Test Yourself

1. You have three churn measures — revisions, lines added+deleted, distinct authors. Which do you rank hotspots by, and why are lines a poor primary key?
2. Write (or describe) the one-line pipeline that ranks files by how many commits touched them.
3. Why is high churn *alone* insufficient to call a file a hotspot? What is the second axis and why LOC is an acceptable first proxy?
4. Two files in different modules co-change in 70% of commits but share no `import`. What is this called, why can no static analyzer find it, and why does it matter?
5. A file that was heavily changed two years ago and untouched since still tops your lifetime-churn ranking. What two corrections fix this?
6. When is it worth reaching for code-maat or CodeScene instead of a `git log` pipeline?

<details>
<summary>Answers</summary>

1. Rank by **number of revisions** — a commit is a deliberate decision to change that file, so revision count tracks where change concentrates, immune to formatting noise. **Lines added+deleted** is dominated by large and auto-formatted/generated files, so a single reformat can falsely crown a stable file. Keep lines and author-count as secondary lenses.
2. `git log --format= --name-only | sort | uniq -c | sort -rn` — blank the header, list touched files per commit, group identical paths, count them, sort descending.
3. Churn alone catches harmless busy files (config, localization). A hotspot is churn **× complexity**: the file is changed often *and* hard to change correctly. **LOC** is acceptable as a first proxy because it's monotonic enough that the top-right quadrant barely shifts when you upgrade to cyclomatic complexity — and you can get it with `wc -l`.
4. **Change coupling** (temporal/logical coupling). Static analysis only sees dependencies written in the code (imports, calls); these files share *no syntactic link*, so there is nothing for it to find — the bond exists only in commit history. It matters because cross-module co-change reveals a hidden contract (e.g. a shared wire format) that breaks at runtime when one side changes and the other is forgotten.
5. **Window** the analysis (`--since="12 months ago"`) so every file is measured over the same recent period (cancels age bias), and apply **recency weighting** (time-decay) so recent commits dominate and old activity decays toward zero — a cooled-off file then stops ranking.
6. When you need **rename-aware history** (so reorgs don't erase a file's past), **normalized change coupling at scale**, multi-repo joins, decay tuning, or a **visualization** to show stakeholders. The math is DIY-simple; the tooling handles the tedious, scaling, and presentation parts.

</details>

---

## Cheat Sheet

```
CHURN MEASURES  (rank by REVISIONS; lines & authors are secondary)
  revisions          commits touching the file   → frequency of change  [PRIMARY]
  lines added+del    raw line deltas (numstat)   → volume; biased to big/generated files
  distinct authors   unique committers           → coordination / knowledge risk

MINE IT FROM git log
  revisions   git log --format= --name-only | sort | uniq -c | sort -rn
  windowed    git log --since="12 months ago" --format= --name-only | sort | uniq -c | sort -rn
  line churn  git log --numstat --format=   (cols: added  deleted  path; skip "-" = binary)
  exclude     ... -- . ':!vendor' ':!*.pb.go' ':!*lock*'

HOTSPOT = CHURN × COMPLEXITY   (it's an AND, never an OR)
  complexity proxy:  wc -l  (LOC, cheap)  →  cyclomatic (better)
  the only quadrant that matters: HIGH churn × HIGH complexity (top-right)

CHANGE COUPLING  (the dependency static tools can't see)
  pair files per commit, count co-occurrence, NORMALIZE:
    coupling(A,B) = commits(A and B) / commits(A or B)
  cross-MODULE high ratio + no import  →  hidden contract = red flag

NORMALIZE
  age:      window with --since   (same race length for every file)
  recency:  weight commits by time-decay (recent churn > old churn)

TOOLS
  code-maat   open-source miner (revisions, coupling, authorship, age)
  CodeScene   commercial: recency-weighted hotspots, coupling, knowledge maps, viz

READ IT AS
  hotspot list = priority queue (go here first), NOT a grade
  co-change pair = "do these belong together, or is it a hidden leak?"
```

---

## Summary

- **Churn is three measures, not one.** Number of **revisions** (frequency of change — the robust default), **lines added+deleted** (volume — biased to large/generated files), and **distinct authors** (coordination/knowledge risk). Rank hotspots by revisions; use the others as secondary lenses.
- **You compute all of it from `git log`.** `git log --format= --name-only | sort | uniq -c | sort -rn` is the revision-count ranking; `--numstat` gives line churn; pairing author lines gives author counts. No tool required.
- **A hotspot is churn × complexity — an AND.** Overlay a complexity proxy (LOC works as a first cut; cyclomatic is better) and only the **high × high** quadrant earns the name. This is Tornhill's technique, and it tells you what to *ignore* as much as what to fix.
- **Change coupling finds invisible dependencies.** Mining commits for files that change together reveals contracts — serializer/deserializer pairs, shadow protocols — that have *no syntactic link* and that no static analyzer can see. Normalize by the union of commits and watch for high cross-module ratios.
- **Normalize for age and recency.** Window the analysis so age bias cancels, and weight commits by recency so cooled-off code stops ranking. Recent churn predicts; old churn is history.
- **Read the output as an invitation, not a verdict.** The hotspot list is a priority queue ("look here first"); a co-change pair is a question ("healthy bond or hidden leak?"). The number opens the investigation; you close it by reading the code — and the *prioritization* decision lives in [Technical Debt Management](../../technical-debt-management/).

---

## Further Reading

- *Your Code as a Crime Scene* — Adam Tornhill. The foundational treatment of behavioral hotspots and change coupling; this page is the practical distillation of its core technique.
- *Software Design X-Rays* — Adam Tornhill. The sequel: hotspots at scale, knowledge maps, and change coupling across architectural boundaries.
- *Use of Relative Code Churn Measures to Predict System Defect Density* — Nagappan & Ball (Microsoft Research, 2005). The empirical evidence that churn predicts defects.
- [code-maat](https://github.com/adamtornhill/code-maat) — Tornhill's open-source miner; read the README to see every measure above implemented over `git log`.
- `man git-log` — `--numstat`, `--name-only`, `--follow`, and `--since` are the primary sources for the pipelines here.

---

## Related Topics

- [junior.md](junior.md) — the intuition: why a churning, complex file beats a stable, complex one for your attention.
- [senior.md](senior.md) — defect prediction, statistically validating churn signals, and wiring hotspot trends into CI.
- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/middle.md) — the complexity axis you overlay on churn to find hotspots.
- [06 — Code Health Dashboards](../06-code-health-dashboards/middle.md) — aggregating hotspots and trends into a view the whole team reads.
- [Technical Debt Management](../../technical-debt-management/) — what to *do* with a hotspot: prioritizing, budgeting, and paying down the debt it exposes.
