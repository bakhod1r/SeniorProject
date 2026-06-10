# Shotgun Surgery - Specification

> Audience: engineers who want to detect shotgun surgery objectively, with numbers, instead of relying on the gut feeling that "this PR touches too many files." This file defines the metrics, the thresholds, and the tooling.

Fowler in `Refactoring` (2nd ed., ch. 3) names the smell but does not quantify it. Quantification came later, from the temporal-coupling research that Adam Tornhill compiled in `Your Code as a Crime Scene` (Pragmatic, 2015) and operationalized in the Codescene product. This file collects the metrics that actually matter, their thresholds, and the tools - open-source and commercial - that compute them.

## 1. Primary metric: change coupling percentage

**Definition.** For files A and B, let `commits(A)` be the set of commits that modified A, and `commits(B)` likewise. The change coupling between A and B is:

```
coupling(A, B) = |commits(A) ∩ commits(B)| / |commits(A) ∪ commits(B)|
```

This is the Jaccard index over commit sets. Some tools use a directional variant:

```
coupling_directional(A -> B) = |commits(A) ∩ commits(B)| / |commits(A)|
```

which reads as "when A changes, what fraction of the time does B also change?" The directional form is more useful for spotting shotgun surgery, because it tells you the blast radius from a specific origin file.

**Thresholds (empirical, from Codescene's published guidance and Tornhill's books):**

| Coupling % | Interpretation                                    | Action                               |
|------------|---------------------------------------------------|--------------------------------------|
| 0 - 20%    | Independent or weakly related files               | No action                            |
| 20 - 40%   | Moderate coupling; investigate if surprising      | Add to watch list                    |
| 40 - 70%   | Strong coupling; refactor candidate               | Open a refactoring ticket            |
| 70 - 100%  | Shotgun surgery confirmed                         | Refactor this iteration; do not defer|

These thresholds assume a meaningful sample - at least 30 commits per file over at least 6 months. Below that, the signal is noise.

## 2. Secondary metric: bidirectional change count

The simpler, less statistical version. Over a window (typically 3 or 12 months), count how many distinct commits touched more than N files. The distribution is the signal:

| Files per commit | Interpretation                              |
|------------------|---------------------------------------------|
| 1 - 3            | Normal change                               |
| 4 - 8            | Feature work or refactor                    |
| 9 - 20           | Suspicious - likely shotgun surgery         |
| > 20             | Almost certainly shotgun or generated code  |

Generated-code commits (formatter runs, license headers, codegen output) inflate this; filter them via `.gitattributes linguist-generated=true` or a path glob.

The metric to track over time is the **p95 of files-per-commit**. If it climbs from 6 to 14 over two quarters, shotgun surgery is accumulating somewhere even if no individual PR is alarming.

## 3. Hotspot metric (composite)

A file is a **shotgun-surgery hotspot** if it satisfies all three:

1. It appears in more than 5% of all commits in the window.
2. It has at least 3 partners with coupling >= 40%.
3. Its cyclomatic complexity exceeds the codebase median by 2x.

The third filter discriminates between "boring high-traffic file" (e.g., a constants file, low complexity) and "central tangle" (high complexity + high coupling = the real target).

Codescene reports hotspots ranked by a composite of code health (a 1-10 metric) and effort spent. The output is a prioritized list, not a flat dump.

## 4. Tools

**Codescene (commercial, hosted or on-prem).** Walks the full git history, computes coupling per pair, ranks hotspots, integrates with PR checks. Output includes the X-Ray view (function-level coupling within a file), team-knowledge maps, and code-health trend lines. Free tier exists for OSS projects. Most teams end up here once they take coupling seriously.

**CodeMaat (open-source, JVM CLI by Adam Tornhill).** The predecessor to Codescene's analysis engine. Runs as a Clojure jar against `git log` output:

```bash
git log --all --numstat --date=short \
  --pretty=format:'--%h--%ad--%aN' --no-renames > evo.log

java -jar code-maat-1.0.4-standalone.jar \
  -l evo.log -c git2 -a coupling > coupling.csv
```

The CSV has columns `entity, coupled, degree, average-revs`. Filter `degree >= 40` to find pairs to refactor. CodeMaat also offers `summary`, `revisions`, `entity-effort`, `entity-ownership` analyses. Free, scriptable, CI-friendly.

**gitqualia (open-source Python).** Lightweight, generates HTML reports of coupling and hotspots. Good for a first look without setting up a JVM tool.

**git-of-theseus (open-source Python).** Plots code-age over time, complementary metric. A file whose oldest lines keep getting younger is a shotgun-surgery target.

**Custom git log scripts.** For ad-hoc investigation:

```bash
# Top 20 most-changed files in the last 12 months
git log --since="12 months ago" --name-only --pretty=format: \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -20

# Files most often changed alongside Order.java
git log --since="12 months ago" --name-only --pretty=format:"=" \
  --follow -- src/main/java/com/acme/order/Order.java \
  | awk 'BEGIN{RS="="} {for(i=1;i<=NF;i++) if($i != "Order.java") print $i}' \
  | sort | uniq -c | sort -rn | head -10
```

The second command answers the directional question: "when `Order.java` changes, what else changes?" The output ranks the shotgun radius.

## 5. Calibration warnings

Three traps that turn change coupling into noise:

**5.1 Bulk renames and large reformats.** A single commit that runs `google-java-format` on the whole repo creates artificial coupling between every pair of files in it. Filter such commits by author, message pattern, or size threshold (`--shortstat` filtering commits with > 100 files).

**5.2 Monorepo skew.** In a polyglot monorepo, `package-lock.json`, `pom.xml`, and `BUILD.bazel` files change with almost everything. They will dominate the top-coupled list. Either exclude them by path glob or analyze each language tree separately.

**5.3 Short history.** A new file with 5 commits and 5 coupled changes shows 100% coupling but no real signal. Require a minimum of 20-30 commits before trusting the percentage.

## 6. PR-level early warning

You can catch shotgun surgery before it lands by gating PRs:

- **PR size warning.** Flag PRs touching more than 15 files. Not block - warn.
- **Coupling-aware diff bot.** When a PR touches file A, the bot comments: "Historically, file A co-changes with files X, Y, Z. This PR does not touch them. Confirm intentional." Codescene ships this; CodeMaat plus a few hundred lines of Python reproduces it.
- **Module boundary lint.** ArchUnit rules that flag new edges between modules. Shotgun surgery rarely arrives in one PR; it accumulates one cross-module reference at a time.

## 7. Reporting cadence

A pragmatic rhythm:

| Cadence  | Activity                                                    |
|----------|-------------------------------------------------------------|
| Per PR   | Files-touched count visible in CI summary                   |
| Weekly   | Top-10 coupled pairs delta vs last week                     |
| Monthly  | Hotspot refresh; pick one cluster to refactor               |
| Quarterly| p95 files-per-commit trend; module-boundary review          |

Without a cadence the data is just a graph. With one, it becomes the input to the refactoring backlog.

## 8. What you write down

For each detected shotgun-surgery cluster, the ticket should capture:

```
Cluster: Order, OrderDTO, OrderMapper, OrderValidator, OrderEventV2
Window: 2025-10-01 to 2026-04-30
Commits in window: 47
Files in cluster: 5
Average coupling (pairwise): 78%
Top business reason for co-change: adding a new field to Order
Proposed fix: Inline OrderDTO into Order; move validation into Order; sealed OrderEvent
Estimated ROI: 60% reduction in files-per-commit for order changes
```

This template, repeated for every cluster, turns the abstract smell into a tracked refactoring stream.

**Memorize this:** Change coupling above 40% over a 30-commit window is the operational definition of shotgun surgery. CodeMaat or Codescene computes it; a 30-line shell script approximates it. Track p95 files-per-commit as the leading indicator, refactor the top cluster monthly, gate PR size as a guardrail.
