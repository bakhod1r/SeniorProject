# Hotspot Analysis — Optimize This

> **Category:** [Anti-Patterns at Scale](../README.md) → **Hotspot Analysis**
> **Covers (collectively):** Churn × complexity · Code-as-a-crime-scene · Change / temporal coupling · Knowledge maps & bus factor · Defect-density prioritization

---

This file is about making the **mining pipeline fast enough to run.** The methodology in [`tasks.md`](tasks.md) is correct, but a naive implementation that parses full diffs over all history will crawl on a large repo — minutes to tens of minutes, sometimes gigabytes of intermediate text — and a hotspot report you can't run on every release is a report nobody runs. Here we take a slow-but-correct implementation and optimize it while **preserving the exact ranking it produces**.

> **The discipline:** the optimization must not change the *answer*, only the *cost*. We benchmark before and after, and the top-N list must be identical. Speeding up a metric by accidentally changing what it measures is not an optimization — it's a regression with a stopwatch attached.

> **How to use this file:** read the "Before," predict where the time goes *before* expanding, then compare your reasoning to the worked analysis. Throughput intuition (what's O(history) vs O(diff bytes)) is the skill.

---

## Table of Contents

1. [The naive churn miner: `git log -p` + Python diff parsing](#the-naive-churn-miner-git-log--p--python-diff-parsing)
2. [Where the time actually goes](#where-the-time-actually-goes)
3. [Optimization 1 — stop materializing diffs: `--numstat`](#optimization-1--stop-materializing-diffs---numstat)
4. [Optimization 2 — let git do the parsing: `--no-renames` + a clean record format](#optimization-2--let-git-do-the-parsing---no-renames--a-clean-record-format)
5. [Optimization 3 — restrict the window and stream](#optimization-3--restrict-the-window-and-stream)
6. [The optimized miner, end to end](#the-optimized-miner-end-to-end)
7. [Before / after — timing reasoning](#before--after--timing-reasoning)
8. [Pitfalls that quietly change the answer](#pitfalls-that-quietly-change-the-answer)
9. [Summary](#summary)
10. [Related Topics](#related-topics)

---

## The naive churn miner: `git log -p` + Python diff parsing

A first, intuitive implementation: ask git for the **full patch** of all history, read it in Python, and hand-parse the unified diff to count added/deleted lines per file.

```python
#!/usr/bin/env python3
"""churn_slow.py — naive: full-history `git log -p`, parse diffs by hand. SLOW."""
import subprocess
from collections import Counter

added = Counter()
deleted = Counter()

# -p emits the FULL unified diff for EVERY commit in ALL of history.
proc = subprocess.run(
    ["git", "log", "-p"],
    capture_output=True, text=True, check=True,   # buffers the ENTIRE output
)

current = None
for line in proc.stdout.splitlines():        # walks every diff line in the repo's life
    if line.startswith("+++ b/"):
        current = line[6:]                   # the file this hunk belongs to
    elif current and line.startswith("+") and not line.startswith("+++"):
        added[current] += 1
    elif current and line.startswith("-") and not line.startswith("---"):
        deleted[current] += 1

for path, a in added.most_common(20):
    print(a + deleted[path], path)
```

It works on a toy repo. On a real one — years of history, thousands of files — it is painfully slow and memory-hungry. Before reading on: **where does the time go?**

---

## Where the time actually goes

Three compounding costs, none of which are the part you care about:

1. **`-p` reconstructs and serializes every diff in all history.** For each commit, git computes the full textual patch against its parent and writes it out. The total volume is *the sum of every line ever added or removed in the project's lifetime* — often **hundreds of MB to multiple GB** of diff text. But the churn metric only needs **counts**, not the patch *content*. You're paying to generate, transmit, and parse every `+`/`-` line of code just to tally how many there were.

2. **`capture_output=True` buffers the entire output in memory** before Python sees a byte. A multi-GB patch stream becomes a multi-GB Python string. That alone can OOM the process or thrash swap on a big repo, and nothing starts processing until git has finished emitting *everything*.

3. **Hand-parsing the unified diff in Python is fragile and slow.** You're re-implementing, line by interpreted-Python line, work git already does in C. Worse, the naive `+++ b/` / `+`/`-` parsing **miscounts**: it counts diff *metadata*, gets confused by binary-file markers and `\ No newline at end of file`, and double-handles renames — so it's not just slow, it's subtly *wrong* relative to git's own line accounting.

The headline: the cost is **O(total diff bytes in all history)**, and the *useful output* is **O(number of (commit, file) pairs)** — usually orders of magnitude smaller. We're paying for the patches and throwing them away.

---

## Optimization 1 — stop materializing diffs: `--numstat`

git already computes per-file added/deleted counts and will hand them to you directly with **`--numstat`** — no patch body, just three columns: `added  deleted  path`.

```python
# Ask git for COUNTS, not patches. No diff body is generated or transmitted.
proc = subprocess.run(
    ["git", "log", "--numstat", "--pretty=format:"],
    capture_output=True, text=True, check=True,
)
```

A `--numstat` line looks like:

```
  12      3   src/payments/gateway.py
  -       -   assets/logo.png            # binary files show "-  -"
```

This **collapses the dominant cost**: instead of streaming every line of every diff (O(diff bytes)), git emits **one short line per changed file per commit** (O(commit×file pairs)). The patch reconstruction still happens internally, but git no longer *serializes the full text* — it serializes the tallies it computed along the way, which is a fraction of the bytes. Parsing becomes trivial and correct: split on whitespace, the first two fields are the counts (skip `-  -` binary rows), the rest is the path.

> **Answer preserved:** `--numstat`'s added/deleted are git's own line accounting — the *correct* numbers the hand-parser was approximating. So this is faster **and** more accurate. (If you rank by commit-count rather than lines — the more robust metric — you don't even need the numbers; `--name-only` alone suffices, and is cheaper still.)

---

## Optimization 2 — let git do the parsing: `--no-renames` + a clean record format

Two refinements that make the stream cheaper and unambiguous to parse:

**`--no-renames`** — by default git spends CPU on **rename detection** (similarity scoring between added and deleted files) and emits rename rows in a special `{old => new}` format that complicates parsing. For a **whole-repo aggregation**, disable it with `--no-renames` so a rename appears simply as one delete + one add of plain paths — cheaper to compute and trivial to parse. (Per-*file* history is the opposite case: there you *want* `--follow` to chase renames. Whole-repo aggregation and single-file history have opposite rename needs — see Pitfalls.)

**A delimiter you can split on** — separate commits with a sentinel so streaming code knows where one commit ends, without the ambiguity of blank lines:

```python
proc = subprocess.Popen(
    ["git", "log",
     "--no-merges",            # count each logical change once
     "--no-renames",           # cheaper + unambiguous for repo-wide aggregation
     "--numstat",
     "--format=%x00%H"],       # NUL byte + hash marks each commit boundary
    stdout=subprocess.PIPE, text=True,
)
```

`--format=%x00%H` prints a NUL (`\x00`) then the commit hash on each commit's header line; the NUL is a byte that can't appear in a path, so it's an unambiguous record separator if you later need per-commit grouping (e.g. for change coupling). For plain churn you can ignore the header lines entirely. The key gain over `git log -p`: **git emits structured, pre-counted records and we never reconstruct a diff in Python.**

---

## Optimization 3 — restrict the window and stream

Two final, large wins:

**Restrict to a trailing window with `--since`.** All-history mining is not just slow — it's *wrong for the question*: hotspots that cooled years ago aren't current (see [`interview.md`](interview.md) Q12). Bounding to `--since='12 months ago'` is both **more correct** *and* dramatically cheaper, because git stops walking once it's past the date and you process a fraction of the commits.

**Stream the output instead of buffering it.** Replace `subprocess.run(capture_output=True)` (which holds the entire output in RAM) with `subprocess.Popen` + iterating over `proc.stdout` line by line. Memory stays **O(number of distinct paths)** — just the size of the `Counter` — regardless of how much git emits, because you tally and discard each line as it arrives. This removes the OOM risk and lets processing overlap with git's output (a pipeline, not a barrier).

```python
counts = Counter()
with subprocess.Popen([...], stdout=subprocess.PIPE, text=True, bufsize=1) as proc:
    for line in proc.stdout:                 # streamed; constant memory
        # tally and forget — never hold the whole stream
        ...
```

---

## The optimized miner, end to end

Putting all three optimizations together — counts not patches, git-side parsing, windowed, streamed:

```python
#!/usr/bin/env python3
"""churn_fast.py — windowed, streamed, count-based churn miner.
Same ranking as churn_slow.py, a fraction of the time and memory."""
import subprocess
from collections import Counter

WINDOW = "12 months ago"
TOP_N = 20
EXCLUDE = ("vendor/", "node_modules/", "dist/", "build/")

commits = Counter()   # commit-count per file (robust metric)
lines   = Counter()   # added+deleted per file (granular metric)

cmd = [
    "git", "log",
    f"--since={WINDOW}",   # opt 3: trailing window — correct AND cheap
    "--no-merges",         # count each logical change once
    "--no-renames",        # opt 2: cheaper, unambiguous for repo-wide tally
    "--numstat",           # opt 1: counts, not patches — git does the work
    "--format=",           # suppress commit headers; we only want numstat rows
]

with subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True, bufsize=1) as proc:
    for line in proc.stdout:                    # opt 3: streamed, constant memory
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")                # numstat is TAB-separated
        if len(parts) != 3:
            continue
        a, d, path = parts
        if path.startswith(EXCLUDE):
            continue
        commits[path] += 1
        if a != "-" and d != "-":               # skip binary "-  -" rows
            lines[path] += int(a) + int(d)

print(f"{'commits':>7}  {'lines':>8}  path")
for path, c in commits.most_common(TOP_N):
    print(f"{c:>7}  {lines.get(path, 0):>8}  {path}")
```

This emits churn ready to join against complexity (the [`tasks.md`](tasks.md) Task 2 join is unchanged — only the *churn source* got faster). It reports both metrics so you can rank by the robust commit-count and still inspect line-volume.

---

## Before / after — timing reasoning

We reason about the costs rather than quoting machine-specific numbers (which depend on repo size, disk, and CPU), because the **scaling behavior** is the durable lesson.

| Aspect | `churn_slow.py` (`git log -p` + hand-parse, all history) | `churn_fast.py` (`--numstat`, windowed, streamed) |
|---|---|---|
| **git work** | Reconstruct + serialize **full diff text** for every commit ever | Emit **per-file counts** for commits in window only |
| **Bytes crossing the pipe** | O(total diff bytes in all history) — often **GB** | O((commit×file) rows in window) — typically **MB** |
| **Python work** | Interpret every `+`/`-` line of every patch | Split one short tab-separated line per changed file |
| **Peak memory** | O(entire output) — whole patch buffered, **OOM risk** | O(distinct paths) — just the `Counter` |
| **Correctness** | Approximate (miscounts metadata, renames, binaries) | git's own line accounting — **exact** |
| **Wall time (typical large repo)** | minutes → tens of minutes | seconds → low tens of seconds |

**Why the gap is large and not constant-factor:** the two big optimizations attack *different exponents*. Dropping `-p` for `--numstat` changes the dominant term from **diff bytes** to **changed-file rows** — for a repo where the average commit changes 5 files but rewrites 500 lines, that's a ~100× reduction in transmitted volume on its own. Adding `--since` cuts the *number of commits processed* by however much of history you exclude (often 80–95%). Streaming removes the memory ceiling so the job *finishes* on repos where the naive version would OOM. These multiply: the result is the difference between "run it on every release in CI" and "run it once and never again."

**The ordering rule still holds:** the top-N produced by `churn_fast.py` (ranked by commit-count) is identical to a correct slow miner's top-N over the same window. We made it cheaper, not different — which is the only kind of optimization worth shipping for a metric.

---

## Pitfalls that quietly change the answer

Speed optimizations on a *metric* are dangerous because a wrong number still looks like a number. Guard against these:

- **`--no-renames` is right for repo-wide aggregation but wrong for single-file history.** Whole-repo churn wants renames *off* (cheaper, and you reconcile old/new paths in post-processing). A single file's history wants `--follow` (renames *on*) so its churn isn't reset by a rename. Using the wrong one silently mis-counts (see [`find-bug.md`](find-bug.md) Case 2). They are opposite needs — don't copy one flag set into the other context.
- **Don't drop `--no-merges` for speed.** It's not a performance flag; it's a *correctness* flag that prevents double-counting merged changes (find-bug Case 3). Removing it would make the miner faster on some histories and **wrong**.
- **Windowing changes the answer *by design* — that's correct, but be explicit.** `--since` deliberately excludes old churn. That's the intended semantics (current hotspots), not a shortcut — but document the window so consumers know the ranking is "last 12 months," not "all time."
- **Still clean the inputs.** Faster mining doesn't excuse skipping the hygiene from find-bug: exclude reformat and bot commits, generated paths, and prefer commit-count. A fast pipeline over dirty inputs just produces the wrong answer sooner.
- **`text=True` and encoding.** Paths with non-UTF-8 bytes can raise on decode; for hardened tooling, read bytes (`text=False`) and decode per-line with `errors='surrogateescape'`, or set `-c core.quotepath=false` so git doesn't octal-escape non-ASCII paths into something your `startswith` filters miss.

---

## Summary

- The naive miner (`git log -p` + hand-parsed diffs, all history, buffered) is slow because it pays **O(total diff bytes in all history)** to produce a metric that only needs **O(commit×file) counts** — generating every patch line just to tally it.
- **Optimization 1 — `--numstat`:** make git emit per-file added/deleted counts directly. Collapses the dominant cost from diff *bytes* to changed-file *rows*, and is *more* accurate (git's own line accounting) than hand-parsing.
- **Optimization 2 — `--no-renames` + clean record format:** skip rename-detection CPU and emit unambiguous rows for repo-wide aggregation; let git parse, not Python.
- **Optimization 3 — `--since` window + streaming `Popen`:** process only the relevant trailing window (more correct *and* cheaper) and keep memory at **O(distinct paths)** instead of buffering the whole output (removes the OOM risk).
- Together these turn a minutes-to-tens-of-minutes, OOM-prone job into a seconds-scale one you can run **every release in CI** — with an **identical top-N ranking**.
- The governing rule: an optimization on a metric must change the **cost, not the answer**. Benchmark before/after and assert the top-N is unchanged; never trade correctness flags (`--no-merges`, `--follow` vs `--no-renames`) for speed.

---

## Related Topics

- [`tasks.md`](tasks.md) — the correct pipeline this file accelerates (the churn × complexity join is unchanged).
- [`find-bug.md`](find-bug.md) — the data-hygiene traps a fast pipeline must still respect.
- [`junior.md`](junior.md) — the churn × complexity model.
- [`senior.md`](senior.md) — change coupling and defect density, which reuse this streamed history.
- [`interview.md`](interview.md) — why windowing is correctness, not just speed (Q12).
- [Architecture Fitness Functions](../01-architecture-fitness-functions/senior.md) — run the fast miner in CI to gate against new hotspots.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/senior.md) — fix a hotspot spanning many files.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/senior.md) — replace a hot, complex module incrementally.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the organizational view of the same costs.
