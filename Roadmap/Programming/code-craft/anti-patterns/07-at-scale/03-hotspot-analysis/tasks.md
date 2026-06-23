# Hotspot Analysis — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Hotspot Analysis**
> **Covers (collectively):** Churn × complexity · Code-as-a-crime-scene · Change / temporal coupling · Knowledge maps & bus factor · Defect-density prioritization

These are **hands-on mining exercises**, not recognition quizzes. For each task you get a problem statement, the tools you need (`git`, shell, Python), acceptance criteria, and a collapsible solution with runnable code. The point is to *produce the analysis*: write the churn one-liner, join churn to complexity, compute change coupling, and turn a ranking into a justified backlog.

> **How to use this file.** Try each in a real repo *before* opening the solution — point it at any project with a year of history and watch real hotspots fall out. The reasoning under each solution (why this metric, why this caveat) matters more than the exact command. Refer back to [`junior.md`](junior.md) for the model and [`senior.md`](senior.md) for coupling and defect density.

> **Assumptions.** Commands assume you run them from the repo root, Bash/Zsh, and Python 3.8+. No external libraries are required (standard library only), so the scripts run anywhere `python3` exists.

---

## Table of Contents

| # | Task | Skill | Tools | Difficulty |
|---|---|---|---|---|
| 1 | [The churn one-liner](#task-1--the-churn-one-liner) | Mine churn repo-wide | shell + git | ★ easy |
| 2 | [Join churn × complexity into a top-N table](#task-2--join-churn--complexity-into-a-top-n-table) | The core hotspot script | Python + git | ★★ medium |
| 3 | [Change coupling between two files](#task-3--change-coupling-between-two-files) | Temporal coupling | shell + git | ★★ medium |
| 4 | [Defect density — rank by bug-fix commits](#task-4--defect-density--rank-by-bug-fix-commits) | Error-proneness | shell + git | ★★ medium |
| 5 | [Bus factor for a file](#task-5--bus-factor-for-a-file) | Knowledge map | shell + git | ★ easy |
| 6 | [Clean the data — exclude a reformat commit](#task-6--clean-the-data--exclude-a-reformat-commit) | Data hygiene | shell + git | ★★ medium |
| 7 | [Produce a prioritized hotspot list and justify #1](#task-7--produce-a-prioritized-hotspot-list-and-justify-1) | Backlog + justification | Python + git | ★★★ hard |

---

## Task 1 — The churn one-liner

**Skill:** mine the churn axis for the whole repo · **Tools:** shell + git · **Difficulty:** ★ easy

Write a **single pipeline** that ranks every file by how many commits touched it in the **last 12 months**, most-churned first, showing the top 20.

**Acceptance criteria**
- One command (a pipe is fine), no script file.
- Output is `<count> <path>`, sorted descending by count.
- Restricted to the last year (relevance decays).
- Counts **commits per file**, not lines changed (robust to reformats).

**Hint:** `--name-only` with an empty `--pretty=format:` emits just the changed paths, with blank lines between commits.

<details>
<summary>Solution</summary>

```bash
git log --since='12 months ago' --no-merges --name-only --pretty=format: \
  | grep -v '^$' \
  | sort \
  | uniq -c \
  | sort -rn \
  | head -20
```

**What each stage does:**
- `--since='12 months ago'` — the trailing window; hotspots that cooled off years ago aren't current.
- `--no-merges` — exclude merge commits so changes are attributed exactly once (avoids double-counting).
- `--name-only --pretty=format:` — print *only* the file paths that each commit changed; the empty format string suppresses the commit header lines.
- `grep -v '^$'` — drop the blank line git prints between commits.
- `sort | uniq -c` — tally identical paths into `<count> <path>`.
- `sort -rn | head -20` — rank by count, descending, top 20.

**Why commit-count, not lines:** a single `gofmt`/`prettier` reformat rewrites thousands of lines across many files; ranking by lines would shoot those stable files to the top. Counting *commits* limits that reformat to +1 per file — far more robust. (Task 6 removes such commits entirely.)

This is the **churn axis**. By itself it over-flags config/routing/strings files that *should* churn — which is why Task 2 multiplies it by complexity.
</details>

---

## Task 2 — Join churn × complexity into a top-N table

**Skill:** combine both axes into a ranked hotspot table · **Tools:** Python + git · **Difficulty:** ★★ medium

Write a Python script that:
1. Gets **churn** (commits per file, last 12 months) from `git log`.
2. Gets **complexity** (current line count) by reading each file that still exists.
3. Joins them by path, computes a `score = commits * loc`, and prints the **top 15** as a table.

**Acceptance criteria**
- Pure standard library; runnable as `python3 hotspots.py` in any repo root.
- Files that appear in history but no longer exist on disk are dropped (you only refactor code that exists).
- Output columns: rank, commits, loc, score, path.
- Skips obvious non-source noise (e.g. files under `vendor/`, `node_modules/`, `dist/`).

**Hint:** drive git from Python with `subprocess`; reuse the churn pipeline's `--name-only --pretty=format:` output and tally it in a `dict`.

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""hotspots.py — rank files by churn x complexity (Tornhill's hotspot metric)."""
import subprocess
from collections import Counter
from pathlib import Path

WINDOW = "12 months ago"
TOP_N = 15
EXCLUDE_DIRS = ("vendor/", "node_modules/", "dist/", "build/", ".git/")

def churn() -> Counter:
    """commits-per-file in the window, merges excluded."""
    out = subprocess.run(
        ["git", "log", f"--since={WINDOW}", "--no-merges",
         "--name-only", "--pretty=format:"],
        capture_output=True, text=True, check=True,
    ).stdout
    counts = Counter()
    for line in out.splitlines():
        path = line.strip()
        if path and not path.startswith(EXCLUDE_DIRS):
            counts[path] += 1
    return counts

def loc(path: str) -> int | None:
    """current line count, or None if the file no longer exists / is binary."""
    p = Path(path)
    if not p.is_file():
        return None
    try:
        with p.open("rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return None

def main() -> None:
    rows = []
    for path, commits in churn().items():
        lines = loc(path)
        if lines is None:          # deleted, moved, or unreadable -> drop
            continue
        rows.append((commits * lines, commits, lines, path))

    rows.sort(reverse=True)        # by score, descending

    print(f"{'#':>3}  {'commits':>7}  {'loc':>6}  {'score':>8}  path")
    print("-" * 60)
    for rank, (score, commits, lines, path) in enumerate(rows[:TOP_N], 1):
        print(f"{rank:>3}  {commits:>7}  {lines:>6}  {score:>8}  {path}")

if __name__ == "__main__":
    main()
```

**Sample output (illustrative):**

```
  #  commits     loc     score  path
------------------------------------------------------------
  1       64     980     62720  src/payments/gateway.py
  2       41     612     25092  src/orders/service.py
  3       29     430     12470  src/billing/invoice.py
  4      210      18      3780  config/feature_flags.yaml   <- high churn, tiny LOC: NOT a hotspot
  5       12     300      3600  src/auth/session.py
  ...
```

**Reading the result:**
- `gateway.py` tops the list — hot **and** complex. That's a genuine hotspot; start here.
- `feature_flags.yaml` has the *highest churn in the repo* (210 commits) but a tiny LOC, so its **score** is low and it sinks down the list. The multiplication automatically demotes the busy-but-simple file that a churn-only ranking (Task 1) would have put at #1. This is exactly why you multiply.

**Why current LOC, not historical:** complexity of *deleted* code is irrelevant — you can only refactor what exists. So we read the working tree, not the history, for the complexity axis, and drop paths that no longer resolve to a file.

**Limitation to state aloud:** LOC is a crude complexity proxy. To sharpen it, swap `loc()` for an indentation-depth measure (sum or max of leading-whitespace per line) or a real cyclomatic-complexity tool per language. The *join and ranking logic stays identical* — only the complexity function changes.
</details>

---

## Task 3 — Change coupling between two files

**Skill:** measure temporal coupling from history · **Tools:** shell + git · **Difficulty:** ★★ medium

Given two paths, compute how often they change **together**: the shared-commit count and both directional coupling degrees. Then explain what a high degree means.

**Acceptance criteria**
- Report `|A∩B|` (commits touching both), `|A|`, `|B|`.
- Report `degree(A→B) = |A∩B| / |A|` and `degree(B→A) = |A∩B| / |B|` as percentages.
- Explain why the two directions can differ.

**Hint:** capture each file's set of commit hashes, sort them, and intersect with `comm -12`.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# coupling.sh A B  -> change coupling between two files
set -euo pipefail
A="$1"; B="$2"

git log --no-merges --pretty=%H -- "$A" | sort > /tmp/cc_a
git log --no-merges --pretty=%H -- "$B" | sort > /tmp/cc_b

a=$(wc -l < /tmp/cc_a)
b=$(wc -l < /tmp/cc_b)
both=$(comm -12 /tmp/cc_a /tmp/cc_b | wc -l)

# integer-percent without bc:
a2b=$(( a ? both * 100 / a : 0 ))
b2a=$(( b ? both * 100 / b : 0 ))

echo "A = $A   ($a commits)"
echo "B = $B   ($b commits)"
echo "shared commits |A∩B| = $both"
echo "degree(A→B) = $a2b%   (of A's changes, this fraction also touched B)"
echo "degree(B→A) = $b2a%   (of B's changes, this fraction also touched A)"
```

**Example run:**

```
$ ./coupling.sh src/orders/service.go src/orders/service_test.go
A = src/orders/service.go        (80 commits)
B = src/orders/service_test.go   (62 commits)
shared commits |A∩B| = 58
degree(A→B) = 72%   (of A's changes, this fraction also touched B)
degree(B→A) = 93%   (of B's changes, this fraction also touched A)
```

**Why the two directions differ:** `service.go` changes 80 times but only 58 of those drag the test along (72%) — sometimes it's a refactor or internal change with no test impact. But the test (`service_test.go`) changes 62 times and **93% of those** also change the production file — the test almost never changes on its own. The asymmetry is informative: B is *dependent on* A, not vice versa.

**Interpretation:** a code↔test pair coupling at ~90% is **expected and healthy** — that contract *should* co-change. The signal to chase is *surprising* coupling: if `ui/dashboard.tsx` coupled 80% to `db/migrations/*`, that's a leaky boundary forcing shotgun surgery — a real design smell. Always pair the degree with the **absolute support** (`|A∩B|`): a 100% degree over 3 shared commits is noise; 72% over 58 is an architectural fact.
</details>

---

## Task 4 — Defect density — rank by bug-fix commits

**Skill:** isolate error-proneness from raw activity · **Tools:** shell + git · **Difficulty:** ★★ medium

Rank files by how many **bug-fix** commits touched them (not all commits). State the caveat that makes this metric only as good as your inputs.

**Acceptance criteria**
- Filter the log to fix commits by message convention, case-insensitive.
- Output `<fix-count> <path>`, top 15.
- Name the failure mode of message-based filtering.

**Hint:** `git log --grep` with `-i` filters by commit message; combine with the `--name-only` churn pipeline.

<details>
<summary>Solution</summary>

```bash
git log --since='12 months ago' --no-merges \
        -iE --grep='^(fix|bug|hotfix|patch)' \
        --name-only --pretty=format: \
  | grep -v '^$' \
  | sort | uniq -c | sort -rn | head -15
```

- `-iE --grep='^(fix|bug|hotfix|patch)'` — keep only commits whose message *starts with* a fix-ish keyword, case-insensitive (`-i`), extended regex (`-E`). The `^` anchor avoids matching "fix" inside "prefix" or "suffix".
- The rest is the Task 1 churn pipeline, now counting only fix commits per file.

**Example output:**

```
 47 src/payments/gateway.py
 19 src/orders/service.py
  8 src/billing/invoice.py
  ...
```

`gateway.py` isn't just hot — 47 of its commits in the last year were **fixes**. That's a file actively *manufacturing bugs*, the strongest possible refactor signal when combined with its churn × complexity score from Task 2.

**The caveat (state it every time):** this is **only as good as your commit-message hygiene**. If your team writes `Fix`, `fix`, `bugfix`, `BUGFIX`, or untyped messages inconsistently, the filter **under-counts** fixes — and not randomly: teams or eras with looser conventions look artificially healthy. The robust alternative is to **join commits to the issue tracker** and count those whose linked ticket is typed *Bug*; message-mining is a heuristic, the tracker is ground truth. Adopt Conventional Commits to make the message signal trustworthy.
</details>

---

## Task 5 — Bus factor for a file

**Skill:** read the knowledge map · **Tools:** shell + git · **Difficulty:** ★ easy

For a given hotspot, show how concentrated its knowledge is: each author's share of commits, and the dominant author's percentage. Explain why a hotspot with a low bus factor is doubly dangerous.

**Acceptance criteria**
- Output each author with their commit count to the file, descending.
- State what a single author owning 90%+ implies.

<details>
<summary>Solution</summary>

```bash
# Authorship by commit count for one file:
git log --no-merges --pretty='%an' -- src/payments/gateway.py \
  | sort | uniq -c | sort -rn
```

```
 58 Priya
  9 Marco
  3 Dana
```

Priya authored 58 of 70 commits — ~83% of the file's history. For *current* knowledge (who understands the code as it stands now) use line ownership instead of commit count:

```bash
git blame --line-porcelain src/payments/gateway.py \
  | grep '^author ' | sort | uniq -c | sort -rn
```

**Why a low-bus-factor hotspot is doubly dangerous:** the file is *already* complex and churning — expensive and error-prone to change. If on top of that **one person holds 80–90% of the knowledge**, then the team can't safely change the file *without that person*, and they're the bottleneck for every edit to your most-edited code. If they leave or go on holiday during an incident, you're frozen on exactly the file you can least afford to freeze. Bus factor turns a *code* risk into an *organizational* risk; a hotspot with bus factor 1 jumps up the priority list because the fix (refactor + spread knowledge via pairing/review) reduces both at once.
</details>

---

## Task 6 — Clean the data — exclude a reformat commit

**Skill:** data hygiene before you trust the ranking · **Tools:** shell + git · **Difficulty:** ★★ medium

You discover commit `b4d c0de` was a repo-wide `gofmt`/`prettier` run that rewrote 1,200 files. Produce a churn ranking with that commit's effect removed, and explain which metric it distorts most.

**Acceptance criteria**
- Exclude the specific reformat commit from the churn tally.
- Explain why it distorts **lines-changed** far more than **commit-count**.
- Note the durable fix (`.git-blame-ignore-revs` / labeled commits).

<details>
<summary>Solution</summary>

If you rank by **commit count** (Tasks 1–2), the reformat adds just +1 to each of its 1,200 files — annoying but minor, and easily excluded:

```bash
# Exclude one commit's files from the churn tally by filtering its SHA range.
# Simplest: drop the reformat commit by message when mining.
git log --since='12 months ago' --no-merges \
        --invert-grep -iE --grep='style: reformat|gofmt|prettier' \
        --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -20
```

`--invert-grep` keeps every commit whose message does *not* match — so labeled formatting commits are removed from the analysis.

**Where it bites hardest — lines-changed:** had you ranked by lines (`git log --numstat`), that single commit would add thousands of changed lines to 1,200 otherwise-stable files, catapulting them up the ranking despite **zero semantic change**. Commit-count caps the damage at +1 per file; lines-changed has no such cap. This is the headline reason to **prefer commit-count** as the default churn metric and to clean formatting commits before ever ranking by lines.

**The durable fix:** record reformat commit SHAs in a `.git-blame-ignore-revs` file (git honors it for `blame`, and you can reference it to filter history-mining), and **isolate pure-format changes into their own clearly-labeled commits** so they're trivially excludable. The same hygiene that keeps `git blame` honest keeps hotspot analysis honest. Apply the same skepticism to **bot commits** (dependency bumps, license-header sweeps): filter by author (`--perl-regexp --author='dependabot'` to exclude) so a 500-file mechanical sweep doesn't inflate churn for files nobody actually engineered.
</details>

---

## Task 7 — Produce a prioritized hotspot list and justify #1

**Skill:** turn signals into a backlog with a defensible #1 · **Tools:** Python + git · **Difficulty:** ★★★ hard

Extend Task 2 into a script that combines **three** signals — churn, complexity, and defect density — into a single ranked table, then write a short, cost-framed justification for the #1 target as you'd present it to a skeptical PM.

**Acceptance criteria**
- Columns: commits, loc, fixes, score, path.
- `score` rewards all three (e.g. `commits * loc * (1 + fixes)`), so a complex, churning, fix-heavy file rises to the top.
- A 3–4 sentence justification for #1 framed in **cost and roadmap**, not aesthetics.

<details>
<summary>Solution</summary>

```python
#!/usr/bin/env python3
"""hotspots3.py — rank by churn x complexity x defect-density."""
import re, subprocess
from collections import Counter
from pathlib import Path

WINDOW = "12 months ago"
TOP_N = 15
EXCLUDE = ("vendor/", "node_modules/", "dist/", "build/", ".git/")
FIX_RE = re.compile(r"^(fix|bug|hotfix|patch)", re.I)

def _log_paths(extra_args: list[str]) -> Counter:
    """commits-per-file for commits matching extra_args, in the window."""
    out = subprocess.run(
        ["git", "log", f"--since={WINDOW}", "--no-merges",
         *extra_args, "--name-only", "--pretty=format:"],
        capture_output=True, text=True, check=True,
    ).stdout
    counts = Counter()
    for line in out.splitlines():
        p = line.strip()
        if p and not p.startswith(EXCLUDE):
            counts[p] += 1
    return counts

def loc(path: str) -> int | None:
    p = Path(path)
    if not p.is_file():
        return None
    try:
        with p.open("rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return None

def main() -> None:
    churn = _log_paths([])                                   # all commits
    fixes = _log_paths(["-iE", "--grep=^(fix|bug|hotfix|patch)"])  # bug-fix commits

    rows = []
    for path, commits in churn.items():
        lines = loc(path)
        if lines is None:
            continue
        f = fixes.get(path, 0)
        score = commits * lines * (1 + f)   # all three signals; fixes amplify
        rows.append((score, commits, lines, f, path))

    rows.sort(reverse=True)

    print(f"{'#':>3} {'commits':>7} {'loc':>6} {'fixes':>5} {'score':>10}  path")
    print("-" * 66)
    for rank, (score, commits, lines, f, path) in enumerate(rows[:TOP_N], 1):
        print(f"{rank:>3} {commits:>7} {lines:>6} {f:>5} {score:>10}  {path}")

if __name__ == "__main__":
    main()
```

**Sample output:**

```
  # commits    loc fixes      score  path
------------------------------------------------------------------
  1      64    980    47    3010560  src/payments/gateway.py
  2      41    612    19     502520  src/orders/service.py
  3      29    430     8     112230  src/billing/invoice.py
  4      12    300     2      10800  src/auth/session.py
  ...
```

**Justification for #1 (`src/payments/gateway.py`), as pitched to a PM:**

> "`gateway.py` absorbed 64 engineering touches in the last year — more than any other source file — and 47 of those were production **bug-fixes**, meaning two of every three changes here were fixing something we'd broken. It's also our most complex payment file (980 lines). The Q3 'add Klarna + Apple Pay' work all routes through it, so at its current change-cost those features will each take longer and carry the same defect risk we've been paying all year. A scoped two-sprint refactor — pin behavior with characterization tests, extract the fee and retry logic into cohesive units, then **ratchet** the complexity so it can't creep back — pays for itself across the three payment features that follow it on the roadmap."

**Why this justification works:** it leads with **cost** (touches, fix-rate) and **roadmap alignment** (Q3 routes through it), never with "it's ugly." The numbers come from the team's *own history*, which defuses the "that's just your opinion" objection. It scopes the work (two sprints, behavior-preserving, ratcheted) rather than proposing an open-ended rewrite. That's how a hotspot ranking becomes funded work.

**Caveats to disclose with the table:** the `fixes` column trusts commit-message hygiene (Task 4's caveat); the score weighting is a *heuristic for ranking*, not a precise cost model — its job is to order candidates, and you confirm the top few by reading them and checking roadmap fit before committing the sprint.
</details>

---

## Summary

- **Task 1** mined the churn axis in one pipe (`git log --name-only --pretty=format: | sort | uniq -c | sort -rn`) — commit-count, windowed, merge-free.
- **Task 2** is the core technique: a small Python join of **churn × complexity** that automatically demotes busy-but-simple files (config, flags) a churn-only ranking would mis-rank #1.
- **Task 3** computed **change coupling** as the conditional `|A∩B| / |A|` in both directions, with absolute support as a confidence guard — surfacing relational problems per-file metrics miss.
- **Task 4** isolated **defect density** (bug-fix commits per file) — error-proneness, not mere activity — with the standing caveat that it's only as good as commit hygiene.
- **Task 5** read the **bus factor** from authorship; a hotspot owned by one person is a doubled (code + organizational) risk.
- **Task 6** enforced **data hygiene** — excluding reformat/bot commits — and showed why commit-count resists distortion that lines-changed does not.
- **Task 7** fused all three signals into a ranked backlog and a **cost-framed justification** for #1 — the form that gets refactoring funded.

> **One rule to remember:** the script finds *candidates*; you confirm the top few by reading them and checking roadmap fit, then **ratchet** each cleaned hotspot so the win sticks.

---

## Related Topics

- [`junior.md`](junior.md) — the churn × complexity model and the quadrant map.
- [`senior.md`](senior.md) — change coupling, defect density, and bus factor at scale.
- [`find-bug.md`](find-bug.md) — flawed analyses to critique; the failure modes these tasks avoid.
- [`optimize.md`](optimize.md) — make this pipeline fast on a large repo.
- [`interview.md`](interview.md) — the Q&A behind every metric here.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — ratchet a cleaned hotspot so it can't regress.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/senior.md) — fix a hotspot that spans many files.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — replace a hot, complex module incrementally.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the organizational view of the same costs.
