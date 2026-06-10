# Hotspot Analysis — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Hotspot Analysis**
> **Covers (collectively):** Churn × complexity · Code-as-a-crime-scene · Change / temporal coupling · Knowledge maps & bus factor · Defect-density prioritization

---

This file is **critical-reading practice for *analyses*, not code.** Each entry below is a plausible piece of hotspot reasoning — a command, a ranking, a conclusion someone presented in a "tech-debt review." Your job is to read it the way a skeptical staff engineer does and answer three questions:

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

The "bug" here is never a crash — it's a **corrupted metric or an unsound inference** that would send a team's finite refactoring budget at the wrong file. These mistakes are seductive because each command *runs* and each ranking *looks* rigorous. Read slowly, then open the answer.

> **How to use this file:** read each case and write your own critique *before* expanding the collapsible. The skill you're training is distrusting a clean-looking number, not memorizing commands.

---

## Table of Contents

1. [The reformat that crowned a stable file](#case-1--the-reformat-that-crowned-a-stable-file)
2. [The file that was "born last month"](#case-2--the-file-that-was-born-last-month)
3. [The merge that counted everything twice](#case-3--the-merge-that-counted-everything-twice)
4. [The commit that touched 500 files](#case-4--the-commit-that-touched-500-files)
5. [Refactor the biggest file](#case-5--refactor-the-biggest-file)
6. [100% coupled — over three commits](#case-6--100-coupled--over-three-commits)
7. [The defect-density report that found no defects](#case-7--the-defect-density-report-that-found-no-defects)

---

## Case 1 — The reformat that crowned a stable file

> A staff engineer ranks hotspots by **lines changed** and presents the top of the list.

```bash
# "Churn = total lines added + deleted per file, last 12 months."
git log --since='12 months ago' --numstat --pretty=format: \
  | awk 'NF==3 { ch[$3] += $1 + $2 } END { for (f in ch) print ch[f], f }' \
  | sort -rn | head
```

```
184221 src/ui/theme.css        <- "our #1 hotspot, refactor first"
 90120 src/generated/api.ts
 61003 src/payments/gateway.py
   ...
```

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**The metric is lines-changed, and a single bulk reformat poisoned it.** `theme.css` and `generated/api.ts` sit at the top not because anyone *worked on* them, but because one `prettier`/`gofmt`-style commit rewrote thousands of lines with **zero semantic change** — and `--numstat` counts every one of those lines.

**Faulty conclusion:** the team refactors `theme.css` (a stable stylesheet) and a *generated* file (`api.ts`, which you shouldn't hand-edit at all), spending the entire budget on code that was never going to bite them — while the real hotspot, `gateway.py`, sits at #3.

**Methodology fix:**
1. **Prefer commit-count over lines-changed** as the default churn metric — a reformat adds only +1 commit per file, not thousands of lines.
2. **Exclude formatting commits explicitly** (`--invert-grep -iE --grep='reformat|gofmt|prettier'`, or filter recorded SHAs).
3. **Exclude generated/vendored paths** (`src/generated/`, `vendor/`, lockfiles) from the analysis entirely.

With those three fixes, `gateway.py` rises to where it belongs.
</details>

---

## Case 2 — The file that was "born last month"

> Someone audits the payment module and concludes one file is low-risk because it has almost no history.

```bash
$ git log --oneline -- src/payments/payment_gateway.py | wc -l
3
# "Only 3 commits ever — this file is calm, not a hotspot. Skip it."
```

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**A rename reset the churn count.** The file was `gateway.py` for years, accumulating ~200 commits, and was renamed to `payment_gateway.py` last month. By default `git log -- payment_gateway.py` only shows history **after** the rename — so a heavily-churned veteran file masquerades as a 3-commit newborn.

**Faulty conclusion:** the most-changed file in the payment module is dismissed as "calm" and dropped from the backlog — the exact inversion of the truth. The hotspot vanishes precisely because it was recently touched (renamed).

**Methodology fix:**
- For a single file, **`git log --follow -- payment_gateway.py`** traces through the rename and restores the full ~200-commit history.

```bash
$ git log --oneline --follow -- src/payments/payment_gateway.py | wc -l
203
```

- For **whole-repo** aggregation, `--follow` doesn't apply (it's single-path only). Instead, reconcile renamed paths in post-processing (detect renames with `git log --name-status -M` which prints `R100 old new`, and merge the old path's count into the new). Renames are the **single most common silent churn-undercount** — always assume a "suspiciously new" file in an old area was renamed until proven otherwise.
</details>

---

## Case 3 — The merge that counted everything twice

> A team uses a heavy-merge workflow (no squashing) and tallies churn including merge commits.

```bash
# Note: no --no-merges flag.
git log --since='6 months ago' --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head
```

> A reviewer notices the counts for files on a large recently-merged feature branch look inflated — every file in that branch seems to have changed once more than the actual number of feature commits.

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**Merge commits double-count the merged changes.** In a merge-heavy history, a file edited on a feature branch is counted once for its real feature commit *and* again when the merge commit re-introduces those changes into the mainline (depending on how the log walks parents). So every file on a freshly-merged branch gets a spurious +1, and a branch that merged 30 files inflates all 30.

**Faulty conclusion:** files that happened to ride in on big recently-merged branches are pushed up the ranking over genuinely hot files, biasing the backlog toward "whatever merged last," which is itself a recency artifact — the same bias intuition has, now baked into the "data."

**Methodology fix:** decide that **each logical change is counted exactly once.**
- Add **`--no-merges`** to exclude merge commits — the real edits live in the underlying feature commits, which are still counted.

```bash
git log --since='6 months ago' --no-merges \
  --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head
```

- If your workflow **squash-merges**, the squash commit *is* the single source of truth, so `--no-merges` is moot — but never count both the squash *and* the original branch commits. The principle: configure the log so each edit is attributed once, then verify against a branch whose commit count you know.
</details>

---

## Case 4 — The commit that touched 500 files

> A report ranks files by commit-count (good!) but one mechanical commit skews it.

```bash
$ git log --since='12 months ago' --no-merges \
    --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head
   31 src/payments/gateway.py
   30 LICENSE-HEADER-everywhere   # 500 files all show this +1
   29 src/orders/service.py
   ...
$ git show --stat a11ceadd | tail -1
 512 files changed, 512 insertions(+), 0 deletions(-)
# "Lots of files are churning at ~30 — broad tech debt across the codebase."
```

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**One mechanical commit inflated 512 files by +1 each.** Commit `a11ceadd` inserted a license header into every file in the repo — `512 files changed, 0 deletions`. That's a bot stamping boilerplate, not engineering. Every one of those 512 files got a fake churn point.

**Two faulty conclusions:**
1. Files that are otherwise nearly stable get lifted toward the middle of the pack, and the reviewer reads the resulting flat-ish distribution as "broad tech debt everywhere" — when really it's one boilerplate sweep plus a few real hotspots.
2. The symmetric trap: a commit touching 512 files is a **weak signal per file**. A focused 1-file bug-fix means someone actually grappled with that file; a 512-file header sweep means nobody grappled with any of them. Counting both as "+1 churn" treats them as equal engagement, which they aren't.

**Methodology fix:**
- **Filter mechanical/bot commits**: by author (`--perl-regexp --author='^(?!.*dependabot)'` to exclude, or exclude license-bot identities) and by message (`--invert-grep --grep='license header'`).
- Optionally **down-weight wide commits**: weight a commit's contribution to each file by `1 / files_touched` (or cap it), so a 512-file sweep contributes a fraction per file while a 1-file fix contributes fully. This makes per-file churn reflect *engagement*, not mere co-occurrence in a sprawling commit.
</details>

---

## Case 5 — Refactor the biggest file

> The simplest "tech-debt prioritization" of all.

```bash
# "Find our worst tech debt: the biggest files."
$ find src -name '*.py' -exec wc -l {} + | sort -rn | head
  6120 src/generated/models_pb2.py
  4200 src/data/country_codes.py
  2950 src/legacy/report_2018.py
   980 src/payments/gateway.py
# "Refactor models_pb2.py first — it's our biggest, ugliest file."
```

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**Ranking by LOC alone is the canonical hotspot mistake — it uses only the complexity axis (crudely) and carries zero churn signal.** Look at what's at the top:
- `models_pb2.py` — **generated** protobuf code. You never hand-edit it; "refactoring" it is meaningless and would be overwritten on the next codegen.
- `country_codes.py` — a 4,200-line **flat data table**. Large, but trivially simple and never edited. High LOC, ~zero complexity, ~zero churn.
- `report_2018.py` — a **dormant legacy** file. Possibly genuinely complex, but if nobody's touched it since 2018 its change-cost is zero.

**Faulty conclusion:** the team burns a sprint on generated or dormant code and never reaches `gateway.py` at #4 — the file that's actually complex *and* hot.

**Methodology fix:** LOC earns its place **only multiplied by churn**. Compute the churn axis from `git log`, join it to LOC, and rank by the **product**. A proper join drops the generated file (low churn), the data table (low complexity once you use a better proxy, and low churn), and the dormant legacy file (low churn) — leaving `gateway.py` on top. Size *prompts* a look; it never *decides* the ranking.
</details>

---

## Case 6 — 100% coupled — over three commits

> A change-coupling report flags a "tightly coupled pair" for urgent decoupling.

```
$ ./coupling.sh src/admin/export_audit.go src/admin/legacy_xml.go
A = src/admin/export_audit.go   (3 commits)
B = src/admin/legacy_xml.go     (3 commits)
shared commits = 3
degree(A→B) = 100%
degree(B→A) = 100%
# "These two are 100% coupled — top decoupling priority!"
```

> Meanwhile a different pair shows up lower:

```
$ ./coupling.sh src/orders/service.go src/orders/repo.go
degree(A→B) = 68%   (over 55 shared commits)
```

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**The 100% degree is statistical noise — it rests on only 3 shared commits.** Two files that each changed just three times, always together, will show 100% coupling, but the sample is far too small to mean anything: those three commits could be the file's initial creation plus two follow-ups. A 100% degree over a tiny **support** count is the coupling equivalent of "we flipped two coins, both came up heads, therefore the coins are linked."

**Faulty conclusion:** the team prioritizes decoupling a pair of near-dormant admin files (3 commits each) over the `service.go`↔`repo.go` pair that's coupled 68% across **55** commits — a real, load-bearing architectural relationship that costs the team on every order change. The high-confidence signal is ignored in favor of a high-percentage coincidence.

**Methodology fix:** **never rank coupling by degree alone — gate on absolute support.** A real signal needs both a high degree *and* enough shared commits to trust it (a common floor is ≥5–10 shared commits, tuned to repo activity). Report `(degree, support)` together and sort with support as a confidence filter. The `service.go`↔`repo.go` pair (68% over 55) is the one worth investigating; the admin pair (100% over 3) is noise to discard. This mirrors association-rule mining, where you require both high *confidence* and high *support*.
</details>

---

## Case 7 — The defect-density report that found no defects

> A team mines defect density and concludes the codebase is remarkably bug-free.

```bash
$ git log --since='12 months ago' --grep='^fix:' \
    --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head
  4 src/util/strings.py
  2 src/auth/login.py
  # "Only a handful of fix commits all year — our defect density is near zero!"
```

> A reviewer pulls the raw log and sees commit subjects like: `Fix login bug`, `bugfix: null pointer`, `hotfix prod`, `corrected rounding`, `FIX: retry`, and many untyped one-word subjects like `wip`, `updates`, `stuff`.

> **What's wrong with this analysis? What faulty conclusion does it produce? What's the methodology fix?**

<details>
<summary>Answer</summary>

**The filter `--grep='^fix:'` is too strict and matches almost nothing this team actually writes.** It requires the literal lowercase prefix `fix:`. The real commits say `Fix login bug` (capital F, no colon), `bugfix:`, `hotfix`, `corrected`, `FIX:` (uppercase), or nothing typed at all. The pattern silently discards nearly every genuine fix.

**Faulty conclusion:** the team congratulates itself on a "near-zero defect density" and de-prioritizes refactoring — when in reality the defect signal was thrown away by a brittle regex. **A measurement that under-counts isn't a low value; it's an unreliable one**, and the under-counting is *biased*: developers or eras with looser message conventions look artificially healthy, so the ranking is skewed toward whoever happens to write `fix:`.

**Methodology fix:**
1. **Broaden and case-fold the pattern**: `-iE --grep='fix|bug|hotfix|patch|correct'` catches the realistic variants.
2. **Acknowledge the ceiling**: message-mining is a heuristic, full stop. The reliable signal is the **issue tracker** — join commits to tickets and count those whose ticket type is *Bug*. That doesn't depend on anyone's commit prose.
3. **Always caveat defect-density results** with "as good as our commit hygiene," and fix the root cause by adopting **Conventional Commits** so the message signal becomes trustworthy going forward.

The meta-lesson: a low number from a lossy filter looks identical to genuinely good news — distrust it until you've checked the filter against the raw log.
</details>

---

## Summary — how hotspot analyses lie

The "bug" in hotspot analysis is almost never in the code — it's in the **inputs and the inference**. The repeatable ways a clean-looking analysis misleads:

- **Lines-changed gets poisoned by bulk reformats.** Prefer **commit-count**; exclude formatting commits and generated paths (Case 1).
- **Renames silently reset churn.** Use **`--follow`** for single files and reconcile renamed paths for repo-wide aggregation, or a veteran hotspot reads as a newborn (Case 2).
- **Merge commits double-count.** Add **`--no-merges`** (or trust the squash commit) so each logical change is counted exactly once (Case 3).
- **Wide mechanical commits inflate everything by +1.** Filter bot/boilerplate commits and consider **down-weighting wide commits**, so churn reflects engagement, not co-occurrence (Case 4).
- **LOC alone is half the analysis with the wrong half.** Rank by **churn × complexity**; size prompts a look but never decides (Case 5).
- **A high coupling percentage over tiny support is noise.** Gate coupling on **absolute shared-commit support**, not degree alone (Case 6).
- **A brittle `fix:` filter manufactures a fake "bug-free" codebase.** Broaden the pattern, prefer **issue-tracker links**, and always caveat with commit hygiene (Case 7).

The meta-lesson: **a metric that runs cleanly is not a metric you can trust.** Every hotspot number is downstream of git's defaults and your team's habits — clean the inputs and check the inference before you point a sprint at the top of the list.

---

## Related Topics

- [`junior.md`](junior.md) — the churn × complexity model these analyses get wrong.
- [`senior.md`](senior.md) — change coupling, defect density, and bus factor done right.
- [`tasks.md`](tasks.md) — build the correct versions of every command critiqued here.
- [`optimize.md`](optimize.md) — make the correct pipeline fast on a large repo.
- [`interview.md`](interview.md) — the data-hygiene Q&A behind these cases.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — guard a cleaned hotspot against regression.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/senior.md) — fix a hotspot spanning many files.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — replace a hot, complex module incrementally.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the organizational view of the same costs.
