# Freshness & Rot Metrics — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → Freshness & Rot Metrics
> *The junior page explained that docs rot and why it hurts. This page makes rot a number you can compute, a check that fails in CI, and a bot that files the issue before a human notices — because "we should keep docs fresh" is a wish, and a failing pipeline is a policy.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Freshness Metrics You Can Actually Compute](#freshness-metrics-you-can-actually-compute)
4. [Mining Staleness from Git](#mining-staleness-from-git)
5. [The Review-By / Freshness-Date Pattern](#the-review-by--freshness-date-pattern)
6. [Automated Rot Detection in CI](#automated-rot-detection-in-ci)
7. [Tying Doc Updates to Code Changes](#tying-doc-updates-to-code-changes)
8. [Rot as a Trend, Not a Snapshot](#rot-as-a-trend-not-a-snapshot)
9. [Worked Example — From Git Log to a Freshness Bot](#worked-example--from-git-log-to-a-freshness-bot)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I measure doc rot, and how do I make CI catch it before a reader does?**

The junior page gave you the intuition: docs drift away from the code, and stale docs are worse than none because they actively mislead. That intuition is correct but unactionable — you can't put "feels stale" on a dashboard or block a pull request on it.

This page converts the intuition into machinery. Rot has **measurable signals** — how long since a doc was meaningfully edited, how its age compares to the code it describes, what fraction of pages are past a review date, how many links are dead, how many snippets no longer compile. Each signal can be **computed from git**, **checked in CI**, or **enforced by a bot**. By the end you'll have three concrete things: a freshness front-matter contract, a link-check job that fails the build, and a git query that ranks your stalest docs. The senior page later turns these into an org-wide rot-budget program; here we build the instruments.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain *why* a wrong doc is worse than a missing one.
- **Required:** Comfortable with `git log` and basic shell pipelines (`awk`, `sort`, `xargs`).
- **Required:** You've configured at least one CI job (GitHub Actions, GitLab CI, or similar).
- **Helpful:** You've seen front-matter (the YAML block at the top of a Markdown file).
- **Helpful:** You've used a link checker or a prose linter once, even casually.

---

## Freshness Metrics You Can Actually Compute

"Freshness" is vague until you pin it to a definition with a clock and a data source. Four metrics carry most of the weight, and each is cheap to compute.

**1. Staleness age** — `now − last_meaningful_edit`. The single most useful number. The trap is the word *meaningful*: a bulk reformat, a license-header sweep, or a Prettier run touches every file and resets a naïve "last modified" to today, hiding real rot. You want the last *content* edit, which means filtering out known-cosmetic commits (more in the git section below).

**2. Doc-age-to-code-age ratio** — `staleness_age(doc) / staleness_age(code_it_documents)`. Absolute age lies: a stable, finished page on a frozen subsystem can be two years old and perfectly correct. What screams rot is a doc that is *old relative to the code it describes*. If `api-reference.md` was last touched 14 months ago but `api/handlers.go` changed last week, the ratio is large and the doc is suspect. A ratio near 1 means doc and code move together; a ratio ≫ 1 means the doc is lagging.

**3. Percentage past review-by date** — of all docs carrying a `last_reviewed` date, the fraction whose review interval has elapsed. This is your *expired* count, and unlike raw age it encodes human judgment about how fast each doc decays (a security runbook might be reviewed quarterly; a glossary, yearly).

**4. Orphan rate** — fraction of docs nobody has touched in *N* months (commonly 12). Orphans aren't automatically bad — see the ratio caveat — but a *rising* orphan rate, especially on docs that *do* have churning code behind them, is a leading indicator of an abandoned docs estate.

> **Key insight:** Absolute age is a weak signal; **age relative to the thing being documented** is a strong one. A two-year-old page on a frozen module is fine; a two-week-old page on an API that shipped a breaking change yesterday is already rotten. Always normalize freshness against the churn of the underlying code, or you'll flag stable docs and miss the dangerous ones.

---

## Mining Staleness from Git

Git already records every edit with a timestamp and an author — it is the freshness database you don't have to build. The primitive is one command:

```bash
# Last commit date (author date, ISO) that touched a specific file
git log -1 --format=%ad --date=short -- docs/api-reference.md
# → 2025-03-11
```

Wrap it into a ranking of your stalest docs:

```bash
# Every Markdown file, sorted oldest-edit first, with days since last touch
git ls-files '*.md' | while read -r f; do
  last=$(git log -1 --format=%at -- "$f")          # last edit, unix epoch
  days=$(( ( $(date +%s) - last ) / 86400 ))
  printf '%5d days  %s\n' "$days" "$f"
done | sort -rn | head -20
```

The output is an immediate, prioritized rot backlog — the twenty pages most likely to be lying. Two refinements separate a senior engineer's version from a naïve one.

**Filter out cosmetic commits** so a formatting sweep doesn't reset the clock. If your team tags such commits (`style:`, `chore: format`) or records them in a `.git-blame-ignore-revs` file, exclude them:

```bash
# Last NON-cosmetic edit: skip commits whose subject starts with style:/chore:
git log --format='%at %s' -- docs/api-reference.md \
  | grep -vE '^[0-9]+ (style|chore: format|docs: typo)' \
  | head -1 | cut -d' ' -f1
```

**Compute the doc-to-code ratio** by running the same last-edit query against the code path a doc is responsible for, then dividing. You need a mapping from doc → code; the cheapest one is convention (a doc lives next to its package) or an explicit front-matter field (`covers: src/auth/**`).

```bash
doc_age=$(( ($(date +%s) - $(git log -1 --format=%at -- docs/auth.md)) / 86400 ))
code_age=$(( ($(date +%s) - $(git log -1 --format=%at -- src/auth/)) / 86400 ))
echo "ratio: $(echo "scale=2; $doc_age / ($code_age + 1)" | bc)"
# ratio > ~3  → doc is lagging its code badly; review it
```

> **Key insight:** `git log -1 --format=%at -- <path>` is the entire freshness data layer. You don't deploy a database to measure rot — you query the history you already have. The only real engineering is *defining "meaningful edit"* (filtering cosmetic churn) and *mapping each doc to the code it owns* (so you can normalize age against that code).

---

## The Review-By / Freshness-Date Pattern

Age alone can't know how fast a given doc decays. The fix is to let each doc declare its own decay rate and stamp the last time a human vouched for it — the pattern Google institutionalized as **"freshness"**: every important doc has an **owner** and a **review-by date**, and the system nags the owner when it expires.

You implement it with front-matter — structured metadata at the top of the file that tools can parse:

```yaml
---
title: Authentication Service Runbook
owner: platform-team           # who is accountable (a CODEOWNERS-resolvable handle)
last_reviewed: 2025-04-01      # last time a human confirmed it's correct
review_interval_days: 90       # how fast this doc decays; security → short
covers: src/auth/**            # code this doc is responsible for (enables the ratio)
---
```

Three fields do the work. `owner` answers *who gets the issue*. `last_reviewed` is the human-vouched timestamp — deliberately distinct from the git edit date, because *reviewing* a doc and confirming it's still correct is different from *editing* it. `review_interval_days` encodes decay rate per doc, so a fast-moving deploy runbook (30 days) and a stable architecture overview (365 days) live under one mechanism with different clocks.

A doc is **expired** when `last_reviewed + review_interval_days < today`. That single predicate drives everything downstream: the dashboard's "% past review-by," the bot's issue-filing, and an optional CI warning.

> **Key insight:** Separate **"last edited"** (git, automatic, objective) from **"last reviewed"** (front-matter, manual, a human's assertion that it's *still correct*). A doc can be edited weekly by automated tooling yet never reviewed; another can be untouched for a year because it's genuinely stable and someone confirms that yearly. You need both clocks — edited tells you about *activity*, reviewed tells you about *trust*.

---

## Automated Rot Detection in CI

Metrics tell you a doc is *probably* stale. CI checks prove specific facts are *already wrong*. Run these on every pull request that touches docs, and on a nightly cron (external URLs rot on the world's schedule, not yours).

**Link checking** — the highest-value, lowest-effort check. It catches dead internal anchors, moved files, and 404'd external URLs. [`lychee`](https://github.com/lycheeverse/lychee) is fast (async, parallel) and handles both internal and external links; `markdown-link-check` is the common Node alternative.

```yaml
# .github/workflows/docs-link-check.yml
name: docs-link-check
on:
  pull_request:
    paths: ['**/*.md', 'docs/**']
  schedule:
    - cron: '0 6 * * 1'          # Mondays — catch external rot weekly
jobs:
  links:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: lycheeverse/lychee-action@v2
        with:
          args: >-
            --no-progress
            --cache --max-cache-age 1d
            --exclude-mail
            './**/*.md'
          fail: true              # block the PR on a broken link
```

Two notes that save real pain. **Cache external results** (`--max-cache-age`) so you don't hammer third-party sites and get rate-limited into flaky reds. **Split PR vs nightly scope**: on PRs, check only changed files and internal links (fast, deterministic — an external 503 shouldn't block an unrelated change); on the nightly run, check everything including external URLs, and route failures to an issue rather than a red build nobody owns.

**Executable examples** — the strongest anti-rot check, because a code snippet that *runs in CI cannot silently drift* from the code it demonstrates. This is the entire premise of [Testable & Executable Docs](../02-testable-and-executable-docs/middle.md): doctests, Go testable examples, and `rustdoc` tests turn snippets into tests that fail the moment the API they call changes. If you adopt one rot defense beyond link checking, make it this one — it converts the worst rot (*plausible-looking but wrong code*) from a silent failure into a build failure.

**References to renamed/deleted symbols** — docs name functions, flags, and env vars that get renamed out from under them. A lightweight check greps the docs for symbol-shaped tokens and verifies they still exist in the codebase:

```bash
# Flag any `code-spanned` identifier in docs that no longer appears in src/
grep -rhoP '`\K[A-Za-z_][A-Za-z0-9_.]+(?=`)' docs/ | sort -u | while read -r sym; do
  git grep -q -- "$sym" -- 'src/*' || echo "STALE SYMBOL: $sym"
done
```

It's heuristic (false positives on prose-y backticks), but cheap and surprisingly effective at catching `--old-flag-name` long after the flag was renamed.

**Image and asset existence** — relative image links rot when files move. Most link checkers (lychee included) verify local image paths too; ensure your config doesn't exclude them.

**Terminology and spelling drift** — [`Vale`](https://vale.sh/) is a prose linter driven by a versioned style: it catches banned terms (the product was renamed but docs say the old name), inconsistent capitalization, and spelling. Because the rules live in your repo, "terminology" becomes a reviewable, enforceable artifact rather than tribal knowledge.

```yaml
# .vale.ini
StylesPath = .vale/styles
MinAlertLevel = error
[*.md]
BasedOnStyles = Vale, Google        # Google's style rules, pinned in-repo
Vale.Terms = YES                    # enforce the project term list
```

```bash
vale --no-exit docs/ | tee vale.log   # report; gate the build on error-level alerts
```

> **Key insight:** Metrics rank *suspicion*; CI checks prove *facts*. "This doc is 14 months old" is a hint to look; "this doc links to a 404 and its example fails to compile" is a defect you can block a merge on. Invest first in the checks that turn rot into a *failing build* — link checking and executable examples — because those are the only signals that catch rot at the moment it's introduced, not months later.

---

## Tying Doc Updates to Code Changes

The cheapest moment to fix a doc is the pull request that rots it — the author still has the context loaded. Two mechanisms nudge the fix there.

**`CODEOWNERS` on docs** routes review of doc changes to the people accountable for them, and (combined with branch protection) prevents docs from being edited without their owner's eyes:

```
# .github/CODEOWNERS
/docs/auth/**        @platform-team
/docs/api/**         @api-team
*.md                 @docs-guild        # catch-all reviewer for prose quality
```

**A "you changed the API — did you update its docs?" check** is the higher-leverage move. A PR check looks at the changed files; if code under a documented path changed but its associated doc did not, it posts a reminder (a *soft* nudge — a comment, not a hard block, to avoid blocking urgent fixes):

```yaml
# pseudo-logic for a docs-nudge PR check
changed = git diff --name-only origin/main...HEAD
if any(f matches 'src/auth/**' for f in changed) \
   and 'docs/auth.md' not in changed:
     post_comment("You changed `src/auth/**` but didn't touch `docs/auth.md`. "
                  "If the public behavior changed, please update or bump last_reviewed.")
```

The `covers:` front-matter field from earlier is what makes this automatable: it's the machine-readable doc↔code mapping the nudge needs to know *which* doc to ask about.

> **Key insight:** Rot prevention beats rot detection. Detection finds the lie after a reader has been misled; the PR-time nudge catches the divergence in the same change that caused it, while the author still understands the code. A gentle, well-targeted "did you update the docs?" comment fixes more rot than any dashboard — and a noisy, always-firing one gets muted, so precision (via `covers:`) is what keeps it alive.

---

## Rot as a Trend, Not a Snapshot

A single "37 stale docs" number is nearly useless — you can't tell if you're winning or losing. Rot is a *flow* problem, so measure it like one.

- **Rot rate** — net change in stale-doc count per week: `(docs that became stale) − (docs that were refreshed)`. Positive means you're falling behind even if today's snapshot looks fine; negative means you're catching up.
- **Stale backlog** — the count of currently-expired docs, the inventory you're working down. Track it on the same chart as rot rate.
- **Median staleness age** — the typical doc's age. More honest than the mean, which a few ancient outliers can blow up.
- **p90 staleness** — your worst tail. The pages most likely to embarrass you live here.

The shape that matters is the *trend line*. A flat backlog with positive rot rate means refreshes are barely keeping pace with new rot — a staffing signal. A falling backlog means a cleanup is working. Snapshot the metrics weekly (a cron job appending to a CSV or a time-series store) so the line exists at all; a number with no history can't tell you whether things are getting better.

> **Key insight:** Treat docs like a bug backlog: what matters is the **inflow-vs-outflow trend**, not today's count. A team with 200 stale docs and a negative rot rate is healthier than one with 20 and a positive rate — the first is winning, the second is quietly drowning. Always plot rot over time before drawing any conclusion from a single snapshot.

---

## Worked Example — From Git Log to a Freshness Bot

Tie it together: compute staleness from git, cross-reference front-matter review dates, and have a bot file issues for expired docs. This is a self-contained nightly job.

**Step 1 — front-matter on the doc** (the contract):

```yaml
---
title: Auth Runbook
owner: platform-team
last_reviewed: 2024-12-01
review_interval_days: 90
covers: src/auth/**
---
```

**Step 2 — the freshness scanner** (run nightly in CI):

```bash
#!/usr/bin/env bash
# freshness-scan.sh — emit expired docs as "path<TAB>owner<TAB>days_overdue"
today=$(date +%s)
git ls-files '*.md' | while read -r f; do
  reviewed=$(awk -F': *' '/^last_reviewed:/{print $2; exit}' "$f")
  interval=$(awk -F': *' '/^review_interval_days:/{print $2; exit}' "$f")
  owner=$(awk -F': *' '/^owner:/{print $2; exit}' "$f")
  [ -z "$reviewed" ] && continue                      # no policy on this doc; skip
  due=$(( $(date -d "$reviewed" +%s) + interval*86400 ))
  if [ "$today" -gt "$due" ]; then
    printf '%s\t%s\t%d\n' "$f" "$owner" "$(( (today - due) / 86400 ))"
  fi
done
```

**Step 3 — the bot files (idempotent) issues** for what the scanner found:

```bash
./freshness-scan.sh | while IFS=$'\t' read -r file owner overdue; do
  title="Doc review overdue: $file ($overdue days)"
  # Idempotency: only open if no OPEN issue with this exact title exists
  if ! gh issue list --state open --search "\"$title\" in:title" | grep -q .; then
    gh issue create --title "$title" \
      --body "\`$file\` is **$overdue days** past its review-by date.
Owner: @$owner. Please verify it against \`covers:\` and bump \`last_reviewed\`, or adjust \`review_interval_days\`." \
      --assignee "$owner" --label documentation,stale-doc
  fi
done
```

**The flow as a whole:**

```
nightly cron
   └─> freshness-scan.sh        reads last_reviewed + interval from front-matter
          └─> for each EXPIRED doc:
                 └─> bot checks for an existing open issue (idempotent)
                        └─> files issue, assigns owner, labels stale-doc
   (separately) lychee + executable examples + Vale gate every PR
```

The critical design choice is **idempotency**: the job runs nightly, so it must *not* file a duplicate issue every night for the same expired doc. Keying on the issue title (or a stable doc-id label) makes re-runs safe — file once, then leave it until the owner acts. This is exactly the owner-plus-review-date discipline Google's docs culture is known for, reduced to a script you can paste into a repo today.

---

## Mental Models

- **Rot is rust, not a fire.** It doesn't announce itself; it accrues silently while everyone is busy, and you only see it when something breaks at the worst time. Like rust, the defense is *continuous, automated inspection*, not a heroic annual cleanup that's obsolete a month later.

- **Git is your freshness database.** Every doc's edit history is already recorded with timestamps. You don't build a system to measure staleness — you *query the log you already have*. The only real work is defining "meaningful edit" and mapping docs to the code they own.

- **"Edited" and "reviewed" are two different clocks.** A tool can edit a doc daily without anyone confirming it's correct; a human reviewing a stable doc yearly is keeping it fresh without editing it. Activity (git) and trust (review date) are independent — track both.

- **A doc has a half-life set by its subject.** A deploy runbook decays in weeks; a glossary in years. Per-doc `review_interval_days` is how you put fast- and slow-rotting docs under one mechanism with honest, different clocks instead of one arbitrary global threshold.

- **Prevention is a comment on a PR; detection is a 404 a reader hits.** The cheapest fix happens in the change that caused the rot. Every detection mechanism is really an admission that prevention didn't fire in time.

---

## Common Mistakes

1. **Letting cosmetic commits reset the staleness clock.** A repo-wide Prettier or license-header sweep makes every doc look edited *today*, hiding real rot. Filter out known-cosmetic commits (by message prefix or `.git-blame-ignore-revs`) when computing "last meaningful edit."

2. **Using absolute age instead of the doc-to-code ratio.** Flagging every doc older than *N* months drowns you in false positives from stable, finished pages and misses fresh-looking docs on fast-churning code. Normalize age against the code each doc covers.

3. **Blocking every PR on external link checks.** A third-party site returning 503 will turn your build red on a change that touched nothing related. Check internal links (and changed files) on PRs; check external URLs on a nightly cron that files an issue instead of breaking the build.

4. **Measuring snapshots, not trends.** "We have 37 stale docs" tells you nothing about whether you're winning. Track rot *rate* (inflow vs outflow) over time; a big backlog with negative rot rate is healthier than a small one growing.

5. **A freshness bot that re-files the same issue every night.** Non-idempotent bots train everyone to ignore them within a week. Key issue creation on a stable identifier (title or doc-id label) so each expired doc gets exactly one open issue.

6. **Expiring docs with no owner.** A review-by date with nobody accountable just produces orphaned issues. Resolve `owner` (ideally via `CODEOWNERS`) so every expiry has a name attached, and assign the issue to them.

7. **Conflating "last edited" with "last reviewed."** Auto-bumping `last_reviewed` on every commit defeats the entire purpose — it should record a *human's* assertion of correctness, set deliberately during a review, not as a side effect of editing.

---

## Test Yourself

1. Why is the *doc-to-code age ratio* a better rot signal than a doc's absolute age?
2. What single `git` command gives you the last-edit timestamp of a file, and what's the one gotcha that can make it lie?
3. Why keep `last_reviewed` (front-matter) separate from the git last-edit date — aren't they the same thing?
4. Your nightly external-link check keeps turning the build red over third-party 503s. How do you fix the flakiness without giving up external checking?
5. What makes a freshness-bot job *idempotent*, and why does it matter?
6. Of all the CI checks in this page, which two catch rot *at the moment it's introduced* rather than later, and why are those the highest-value?

<details>
<summary>Answers</summary>

1. Absolute age has many false positives (stable, finished docs are old and *correct*) and false negatives (a fresh-looking doc on an API that just had a breaking change is already rotten). The ratio normalizes a doc's age against the churn of the code it documents, so it flags docs that are old *relative to what they describe* — the actual rot condition.
2. `git log -1 --format=%at -- <path>` (last commit epoch touching the path). The gotcha: a cosmetic mass-commit (formatter, license sweep) resets it to "today" and hides real staleness, so you must filter known-cosmetic commits to get the last *meaningful* edit.
3. They measure different things. The git date is *activity* (objective, automatic — and a tool can bump it without anyone checking correctness). `last_reviewed` is *trust* — a human's deliberate assertion that the content is still correct. A doc can be edited often but never reviewed, or unedited for a year yet reviewed and confirmed correct.
4. Split scope: on PRs check only internal links (and changed files), which are deterministic; run external-URL checks on a nightly cron with result caching (`--max-cache-age`) and route failures to an issue rather than a failing build. External rot is the world's problem on the world's schedule — it shouldn't block an unrelated merge.
5. Idempotent means re-running it produces no duplicate side effects — it checks for an existing open issue (keyed on a stable title or doc-id label) before filing, so a doc that stays expired gets exactly one issue, not one per night. It matters because duplicate-spamming bots get muted, which silently kills the whole mechanism.
6. **Link checking** and **executable examples** (doctests / Go examples / rustdoc tests). Both run on the PR that introduces the change, so a broken link or a snippet that no longer compiles fails *that* build — catching rot while the author still has context, instead of as a metric weeks later. Executable examples specifically catch the most dangerous rot: plausible-looking but wrong code.

</details>

---

## Cheat Sheet

```
FRESHNESS METRICS (compute these)
  staleness age      now − last MEANINGFUL edit (filter cosmetic commits)
  doc/code ratio     age(doc) / age(code it covers)   >~3 → review it
  % past review-by   expired docs / docs with a last_reviewed date
  orphan rate        docs untouched in N months (watch the TREND)

GIT AS THE FRESHNESS DB
  git log -1 --format=%at -- path        last-edit epoch (the core primitive)
  ... | sort -rn | head                  rank stalest docs = rot backlog
  filter style:/chore: commits           so a format sweep doesn't reset the clock

FRESHNESS FRONT-MATTER
  owner:                 who gets the issue (CODEOWNERS-resolvable)
  last_reviewed:         human says "still correct" (NOT the edit date)
  review_interval_days:  per-doc decay rate (runbook 30, glossary 365)
  covers:                code path → enables ratio + PR nudge
  EXPIRED when  last_reviewed + interval < today

CI ROT CHECKS
  lychee / markdown-link-check    dead links + missing local images
  doctest / go test / rustdoc     executable examples → snippet can't drift
  grep symbols vs git grep src    references to renamed/deleted identifiers
  Vale (.vale.ini)                terminology + spelling drift, rules in-repo
  PR: internal links only · nightly cron: external URLs → file an issue

PREVENTION (beats detection)
  CODEOWNERS on docs              route doc review to the accountable team
  "changed API, not docs?" nudge  soft PR comment, targeted via covers:

TREND, NOT SNAPSHOT
  rot rate = became_stale − refreshed   (per week; positive = drowning)
  track backlog + median + p90 over time; one number tells you nothing
```

---

## Summary

- Freshness becomes actionable once you pin it to **computable metrics**: staleness age (last *meaningful* edit), the **doc-to-code age ratio** (the strong signal — age relative to the code documented), percent past review-by, and orphan rate.
- **Git is the freshness database.** `git log -1 --format=%at -- <path>` is the whole data layer; the only engineering is filtering cosmetic commits and mapping each doc to the code it owns so you can normalize age.
- The **review-by pattern** — front-matter `owner`, `last_reviewed`, `review_interval_days` — lets each doc declare its own decay rate and records a *human's* assertion of correctness, kept deliberately separate from the automatic git edit date.
- **CI proves rot, doesn't just suspect it.** Link checking (lychee), executable examples ([02 — Testable & Executable Docs](../02-testable-and-executable-docs/middle.md)), stale-symbol greps, asset checks, and Vale terminology lint each turn a class of rot into a failing build — with internal checks on PRs and external checks on a nightly cron.
- **Prevention beats detection:** `CODEOWNERS` on docs plus a targeted "you changed the API — did you update the docs?" PR nudge fixes rot in the change that caused it, while the author still has context.
- Measure rot as a **trend** (rot rate, backlog, p90 over time), not a snapshot — and wire it together with a **freshness bot** that idempotently files an issue for each expired doc and assigns its owner.

---

## Further Reading

- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the "maintaining documentation" chapter on rot, ownership, and review cadence.
- [Google Developer Documentation Style Guide](https://developers.google.com/style) and Google's writing-culture material on doc owners + freshness/review dates.
- [`lychee`](https://github.com/lycheeverse/lychee) and [`markdown-link-check`](https://github.com/tcort/markdown-link-check) — link checkers; read the caching and exclude options before wiring them into CI.
- [`Vale`](https://vale.sh/) — prose linter; the docs on building a versioned, in-repo style for terminology enforcement.
- `git log`, `git ls-files`, and `.git-blame-ignore-revs` — the primary sources for everything in the staleness-from-git section.

---

## Related Topics

- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/middle.md) — the strongest anti-rot check: snippets that run in CI and fail when the code they demonstrate drifts.
- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/middle.md) — the complementary axis: rot asks *is what we have still true?*, coverage asks *what's missing entirely?*
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to write and maintain docs (docs-as-code, ADRs, runbooks) whose freshness this page measures.
- [junior.md](junior.md) — why a wrong doc is worse than a missing one, and the intuition behind rot.
- [senior.md](senior.md) — turning these instruments into an org-wide rot budget, SLOs on doc freshness, and the economics of when *not* to fix a stale doc.
