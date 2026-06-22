# Required CI Checks — Interview Level

> **Roadmap:** [Quality Gates](../README.md) → Required CI Checks
> *A required-checks interview rarely asks "what is CI." It asks "PRs are stuck on a check that isn't even running — diagnose it," and then watches whether you understand that a required check keyed on a job name, a path filter, and an empty merge result conspire to wedge a repo forever. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Mechanics & Gotchas](#mechanics--gotchas)
5. [Speed & Flakiness](#speed--flakiness)
6. [Security Gates](#security-gates)
7. [Scale & Scenarios](#scale--scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

Each question below carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **required vs advisory** (blocks the merge button vs just reports)
- **enforced vs bypassable** (server-side rule vs local hook anyone can `--no-verify`)
- **status check vs check run** (two different GitHub API shapes that both gate)
- **keyed on a name vs keyed on a result** (why a rename or a skip wedges a PR)
- **fast vs slow on the critical path** (every required check is paid on *every* PR)

Nearly every question in this bank is one of those distinctions wearing a costume. Candidates who do well *name the distinction* before reaching for a config knob, and they treat the required set as a product with a cost — latency, flake tax, maintenance — not a pile of checkboxes that's always safe to grow.

---

## Prerequisites

You should be comfortable with: what a CI pipeline is (jobs, stages, a status reported back to the commit/PR); Git branching and pull/merge requests; the idea of branch protection on a default branch; and the difference between a *unit test*, a *linter*, a *type checker*, and a *security scanner*. If "the build is green" doesn't yet mean a specific, queryable state to you, read [junior.md](junior.md) first — this page assumes you can already configure a basic required check and want to reason about the failure modes, the math, and the design tradeoffs an interviewer probes.

---

## Fundamentals

### Q: What's the difference between a *required* CI check and an *advisory* one?

> **Testing:** Whether you understand that "required" is an enforcement property, not a CI property.

**A.** A check is just a status reported back to a commit — pass, fail, or pending. What makes it **required** is a **branch-protection rule** (GitHub) or **merge-request rule** (GitLab) that says "this status must be green before merge is allowed." The CI job is identical either way; the difference lives entirely in the *protection config*, not the pipeline. An **advisory** check runs and reports the same result, but the merge button stays enabled regardless — it's information, not a gate. The practical consequence: making a check required is a one-line config change that suddenly puts that job on the critical path of every single PR. So the question "should this be required?" is really "is this worth blocking everyone's merges, every time, including when it's flaky?" — a much higher bar than "is this check useful?"

### Q: What is the "green-build contract," and why protect `main` specifically?

> **Testing:** Whether you can articulate the *invariant* required checks exist to defend.

**A.** The green-build contract is the invariant: **every commit on `main` builds, passes tests, and meets the quality bar — always, no exceptions.** Anyone can branch from `main` at any time and trust they're starting from a known-good base; releases can be cut from any green commit; `git bisect` is meaningful because "broken" is a real, locatable transition rather than ambient noise. Required checks are how you *enforce* that contract mechanically instead of hoping people remember. You protect `main` (and release branches) specifically because they're the **shared source of truth** — a broken `main` blocks or misleads *everyone*, while a broken feature branch only inconveniences its author. The asymmetry of blast radius is the whole justification: you spend the gate's cost where a regression is most expensive.

### Q: What's in a typical *required* set, and what should stay advisory?

> **Testing:** Whether you have a calibrated default, not "turn everything on."

**A.** A sane required set is the small list of checks that are **fast, deterministic, and catch defects that must never reach `main`**:

- **Build / compile** — if it doesn't build, nothing else matters.
- **Unit tests** (and fast integration tests) — the core correctness gate.
- **Lint** — catches real bug classes (`errcheck`, unused, shadowing), not just style.
- **Format check** — `gofmt -l`, `prettier --check`; cheap, deterministic, zero false positives.
- **Type check** — `tsc --noEmit`, `mypy`; whole-program correctness for typed languages.
- **Security: secret scanning + critical SAST/dependency findings** — block the things that are catastrophic and unambiguous.

What stays **advisory**: slow end-to-end suites, full performance benchmarks, the *long tail* of SAST findings (style-ish, low-confidence), license reports, coverage *deltas* you're still calibrating. The litmus test: **required = fast + deterministic + clearly-blocking-worthy.** Anything slow or noisy belongs in a nightly/advisory lane until you've earned the right to gate on it.

### Q: Status checks vs check runs — what's the difference and why care?

> **Testing:** Whether you've actually wired this up, or only seen the green checkmark.

**A.** They're two different GitHub APIs that both surface as gateable statuses. The **Commit Status API** is the older model: an external system POSTs `state` (`success`/`failure`/`pending`) plus a `context` string (e.g. `ci/circleci: build`) to a commit. The **Checks API** is richer: a GitHub App creates a **check run** with a name, a conclusion, annotations tied to specific lines, and a re-run button in the UI. GitHub Actions uses check runs; many external CIs (CircleCI, Jenkins via plugins) use commit statuses. Why care: in branch protection you select required checks **by their reported name/context**, and the two systems name things differently — which is exactly where the "I marked it required but it doesn't show up to select" confusion comes from. You also need at least one *completed* run of a check on a recent commit before its name even appears in the protection UI to be selected.

### Q: How do pre-commit hooks and CI checks differ, and why isn't a hook a substitute for a required check?

> **Testing:** The enforced-vs-bypassable distinction — the single most common junior misconception.

**A.** A **pre-commit hook** (or Husky/`pre-commit` framework) runs **locally, before the commit lands**, giving fast feedback at the keyboard. A **required CI check** runs **server-side, after the push**, and gates the merge. The decisive difference is **enforcement**: a local hook is *advisory by nature* — `git commit --no-verify` skips it, a fresh clone hasn't installed it, and CI in another context never sees it. So a hook is a **convenience** (catch the typo before you push) but **never a guarantee**. The correct architecture is **both, layered**: run the same fast checks (format, lint, quick tests) as a local hook for speed *and* as a required CI check for enforcement. If a rule actually matters, it must be enforced where it *can't* be bypassed — which is the server, not the developer's machine.

---

## Mechanics & Gotchas

### Q: A required check is keyed on the job's *name*. Why is that a footgun?

> **Testing:** The single most common way a well-meaning rename wedges a repo.

**A.** Branch protection stores the required check as a **literal string** — the job/context name like `test (ubuntu, 1.21)`. It does **not** track the job by ID or by file. So the day someone renames the job in the workflow (say `test` → `unit-tests`, or bumps the matrix from `1.21` to `1.22`), the new pipeline reports a status under the **new** name while protection is still waiting for the **old** name. That old name will now *never* report again — so every open PR sits **pending forever**, blocked on a check that no longer exists. There's no error; the UI just says "waiting." This is why renaming a required job is a **two-step migration**: add the new name to the required list (run both, or accept transient duplication), let the new check report green, *then* remove the old name. Treat required-check names as a **public contract** with the protection config, not as free-to-refactor strings.

### Q: Walk me through the "required check + path filter" deadlock. How do you fix it?

> **Testing:** The deepest mechanics gotcha in the topic — the differentiator question.

**A.** You add `paths:` filters so the expensive job only runs when relevant files change:

```yaml
on:
  pull_request:
    paths: ["frontend/**"]
```

Now a PR touching only `docs/` arrives. The job **doesn't run** — but here's the trap: a **skipped required job reports no status at all**, and branch protection treats "no status for a required check" as **not-yet-satisfied**, i.e. *pending*. So the docs-only PR is **stuck forever** waiting on a check that, by design, will never run for it. The result is a repo where path filters and required checks are mutually exclusive — a classic foot-gun.

The fix is an **aggregate gatekeeper job**. You make the *individual* jobs not required, and instead require a single small job that always runs and depends on the rest, succeeding when its dependencies either passed or were legitimately skipped:

```yaml
jobs:
  frontend:
    if: ${{ ... }}
    # ...
  gate:
    if: ${{ always() }}
    needs: [frontend, backend, lint]
    runs-on: ubuntu-latest
    steps:
      - name: Verify gates
        run: |
          # fail only if a needed job actually FAILED (not if it was skipped)
          if echo '${{ join(needs.*.result, " ") }}' | grep -qE 'failure|cancelled'; then
            echo "A required upstream job failed"; exit 1
          fi
```

You require **`gate`** and nothing else. `gate` always runs (so a status always reports), and it goes green when the real jobs passed *or* were skipped, red only when one truly failed. This breaks the deadlock and gives you one stable required-check name to maintain — which incidentally also solves the rename problem, since the matrix can churn underneath while `gate` stays constant.

### Q: "Require branches to be up to date before merging" — what does it cost, and what's the modern answer?

> **Testing:** Whether you connect a single checkbox to throughput collapse at scale.

**A.** That setting (GitHub's "Require branches to be up to date") forces a PR to be **rebased/merged onto the latest `main` and re-tested** before it can merge. It defends against the **semantic merge conflict**: two PRs that are each green in isolation but break when combined (A deletes a function, B adds a caller — neither's CI saw the other). The cost is **serialization**: if N PRs are ready, only one can merge, then everyone else must update-and-re-run, one at a time. On a busy repo this collapses throughput — developers spend the day clicking "Update branch" and waiting for a 20-minute pipeline only to get bumped again. The modern answer is a **merge queue** (GitHub Merge Queue, Mergify, GitLab Merge Trains): the queue speculatively builds each PR **on top of the others ahead of it**, tests that combination, and merges in order if green — preserving the up-to-date guarantee **without** forcing humans to serialize manually. Merge queue is the correct way to get "always tested against latest" without paying it in human latency.

### Q: What are the inclusion criteria for "make this required" vs "leave it advisory"?

> **Testing:** Whether you have an explicit policy or just vibes.

**A.** I gate on three properties, all of which must hold:

1. **Deterministic** — same input, same result. A flaky check as a *required* gate taxes every PR with spurious failures (see the flake math below). If it can't be made deterministic, it stays advisory until it can.
2. **Fast enough for the critical path** — it runs on every PR, so its latency is added to everyone's merge time. A 30-minute check has to *really* earn required status.
3. **Blocking-worthy signal** — a failure means "this genuinely must not merge," not "FYI." Low-confidence, high-false-positive checks (much of SAST's long tail, opinionated style nits) report as advisory; people tune them out as required and then disable them entirely.

The inverse policy matters just as much: **periodically demote** required checks that never catch anything. A gate that's been green on 100% of the last 5,000 PRs is pure latency tax with no defended invariant — it should be advisory or deleted. Required status is a budget, not a ratchet that only goes up.

### Q: A check shows up as required but the merge button is grey with no failing check. Where do you look?

> **Testing:** Systematic triage of the "stuck PR" failure family.

**A.** I classify before poking. The signature is "required check, no red X, button still blocked" — that's almost always a check that's **pending or absent**, not failing. Triage in order:

1. **Was the job skipped?** Check the Actions run — a `paths:`/`if:` filter that evaluated false means no status reported → stuck (the path-filter deadlock). Fix: the gatekeeper-job pattern.
2. **Was the job renamed?** Compare the required-check **name** in branch-protection settings against the **actual** job name reporting now. A mismatch means protection waits on a dead name forever. Fix: update the required list.
3. **Does the check exist for this event?** A check required on `push` but the PR only triggers `pull_request` (or vice versa) reports under a different context. Fix: align the trigger.
4. **Is it genuinely still running / queued?** Runner starvation or a stuck queue → it's honestly pending. Fix: capacity.

The discipline is reading the **Actions tab and the protection rule as ground truth** before assuming the code is wrong — the code almost never is in this failure family.

---

## Speed & Flakiness

### Q: Why must required checks be *fast*, and what are the levers to make them so?

> **Testing:** Whether you connect required status to critical-path latency.

**A.** Every required check is on the **critical path of every PR** — its wall-clock time is added directly to how long *every* developer waits to merge, multiplied by the number of merges a day. A 40-minute required pipeline doesn't cost 40 minutes; it costs 40 minutes × every PR × the context-switch cost of waiting, plus the queue it creates. So required-check latency is one of the highest-leverage numbers in a dev org. The levers, in rough ROI order:

- **Cache** — dependencies, build artifacts, compiled outputs (`actions/cache`, remote build cache). The biggest single win for most pipelines.
- **Parallelize** — run independent jobs (lint, type-check, test) concurrently, not in a chain.
- **Shard** — split a big test suite across N runners (`--shard`, `jest --shard`, `gotestsum` splitting). Linear speedup until coordination overhead.
- **Run-affected (test selection)** — only build/test what the diff actually touches (Nx/Turborepo affected graphs, Bazel's `--query`, test-impact analysis). The biggest win in a large monorepo, where most PRs touch a small slice.

The order matters: cache and parallelize first (cheap, broad), then shard and run-affected (more setup, huge at scale).

### Q: There's a "flake math" reason to keep the required set small. Explain it.

> **Testing:** Whether you can quantify why more required checks compound spurious failures.

**A.** If a single required check passes with probability `p` (i.e. fails spuriously with probability `1−p`), and you have `k` **independent** required checks, the probability the *whole* pipeline goes green is `p^k`. Spurious-failure probability is `1 − p^k`. Concretely:

| per-check pass rate `p` | `k=1` | `k=10` | `k=50` |
|---|---|---|---|
| 0.99 | 99.0% | 90.4% | 60.5% |
| 0.999 | 99.9% | 99.0% | 95.1% |
| 0.995 | 99.5% | 95.1% | 77.8% |

Read the `p=0.99, k=50` cell: even with each check "99% reliable," a 50-check required pipeline **fails spuriously ~40% of the time**. Every spurious failure costs a re-run (more latency) and erodes trust in the gate. Two consequences fall out of the math: **(1)** keep the required set **small** — each added required check multiplies the failure surface; **(2)** drive per-check reliability *up*, because the exponent punishes you hard — going from `p=0.99` to `p=0.999` rescues the 50-check pipeline from 60% to 95% green. This is the quantitative case against "make everything required."

### Q: A required test is flaky. What do you do — and what do you explicitly *not* do?

> **Testing:** Whether you reach for the safe lever and avoid the destructive ones.

**A.** First, **quarantine, don't block the org.** A flaky *required* test holds the whole team hostage — so the immediate move is to **remove it from the required/blocking set** (mark it non-required, tag it `@flaky`/`quarantine`, route it to an advisory lane) so it stops failing innocent PRs, while keeping it running and *visible* so it's still tracked. Then **fix the root cause** — flakiness is real signal (a race, an order dependency, a time/timezone assumption, a shared-state leak, an external dependency). File it, assign it, fix it, and only then return it to required.

What I explicitly do **not** do:

- **Add a blanket auto-retry** as the *first* move. Retrying a required check masks the flake and slows the pipeline; it can be a *temporary* bridge but it's not a fix, and reflexive retries breed a culture where flakiness is invisible and unbounded.
- **`git commit --no-verify` / disable the check globally / merge with admin override as routine.** That trades a flaky gate for *no* gate and trains everyone to bypass.
- **Delete the test** because it's annoying. The test is failing for a reason; deleting it deletes the coverage and the signal. Quarantine preserves both while unblocking people.

The framing I want to convey: there's a **flaky tax** — the engineering time, lost trust, and re-run latency a flaky required suite imposes on everyone — and quarantine-then-fix is how you pay it down without either blocking the org or going blind.

### Q: When *is* an automatic retry acceptable, and how do you keep it honest?

> **Testing:** Nuance — retries aren't categorically evil, they're categorically *abusable*.

**A.** A bounded retry is acceptable for failures with a known, genuinely **non-deterministic external cause** you don't control — a flaky network call to a third party, a container registry hiccup — *and* only as a stopgap while the real fix is in flight. The way you keep it honest is to make the flake **visible and bounded**: cap retries (e.g. 2), and crucially **record every retry as a metric** (flaky-test dashboard, re-run counter) so retries don't silently hide a worsening problem. A retry that's logged and trended is a managed risk; a retry that's invisible is how a suite rots until "just re-run it" becomes the team's reflex. The tell of a senior answer is "retry with a counter and an alert when the flake rate rises," not "add `retries: 3` and move on."

---

## Security Gates

### Q: How do you decide *block* vs *warn* for security findings (SAST, secrets, dependency scans)?

> **Testing:** Whether you can gate security without making it the thing everyone bypasses.

**A.** The principle is **block the catastrophic-and-unambiguous, advise the rest**:

- **Secret scanning → block, always.** A committed credential is unambiguous and high-severity; it must never reach `main` (and ideally never reach the remote at all — see push protection). Near-zero false positives, infinite downside.
- **Dependency scanning → block on *critical/high with a known exploit path*, advise on the long tail.** A critical CVE in a dependency you actually call is blocking; an info-level advisory in a transitive dev dependency is noise as a gate.
- **SAST → block the high-confidence/high-severity rules, advise the rest.** SAST has a real false-positive rate; gating on its *entire* output is the fastest way to get the whole gate disabled.

The reason the split matters is the **false-positive death spiral**: a security gate that fires constantly on noise gets **ignored**, then **bypassed**, then **disabled outright** — at which point you have *worse* security than a smaller gate that people trust. So the design goal is a security gate with a **low enough false-positive rate that a red result is always taken seriously.** Block a small set of things that are unambiguously bad; everything else reports as advisory and feeds triage, not the merge button.

### Q: What is *push protection* and why is it better than scanning in CI?

> **Testing:** Whether you understand "shift the gate as early as possible" for secrets specifically.

**A.** Push protection (GitHub Secret Scanning push protection, or a server-side pre-receive hook) blocks the **push itself** when it detects a credential pattern — the secret never reaches the remote at all. CI-based secret scanning, by contrast, fires *after* the secret has already landed on the server, which means it's **already leaked**: it's in the remote's history, possibly already cloned/cached, and "rotate the credential" is now mandatory even after you delete the commit. Push protection is strictly better for secrets because the only truly safe place to stop a secret is **before it leaves the developer's machine / before it's accepted by the remote**. CI scanning remains a valuable backstop (push protection isn't perfect and history predates it), but the *primary* secret gate should be as early as possible. This is the secret-specific version of the general "shift left" principle: the earlier the gate, the cheaper the failure.

### Q: A dependency scan blocks merges on a critical CVE, but there's no fix available and you don't call the vulnerable path. Now what?

> **Testing:** Whether you can handle the real-world "the gate is right but I still need to ship" case without just disabling it.

**A.** I don't disable the scanner and I don't merge blind. The path is **documented, time-boxed suppression with justification**: most scanners support a suppression file (`.grype.yaml` ignore, `osv-scanner` ignore, Dependabot `dismiss` with a reason) where I record *this specific CVE*, *why it's not exploitable here* (e.g. "vulnerable function unreachable; no fix upstream"), and ideally an **expiry** so the suppression is re-reviewed rather than permanent. That keeps the gate live for *every other* finding, creates an auditable trail, and forces a future revisit instead of a silent forever-ignore. The anti-patterns I'd call out: a blanket `--severity high` downgrade (turns off the whole class), or disabling the job (turns off all findings). A scoped, justified, expiring suppression is how you respect a correct gate while still shipping — and it's exactly the kind of decision that should be visible in the PR, not buried in a config.

---

## Scale & Scenarios

### Q: Org-wide rulesets vs per-repo branch protection — when do you reach for each?

> **Testing:** Whether you think about gates as fleet policy, not one repo at a time.

**A.** **Per-repo branch protection** is the right granularity when requirements genuinely differ — a legacy repo with a different test setup, a prototype with a lighter bar. But it **drifts**: across 200 repos, settings diverge, new repos get created with *no* protection, and "is secret scanning required everywhere?" becomes unanswerable. **Org-level rulesets** (GitHub repository rulesets / org rules, or enforced via Terraform/`gh api`) let you assert a baseline across all repos at once — "every default branch requires the `gate` check and secret-scanning push protection" — with per-repo overrides only where justified. At scale I want the policy expressed **as code** (rulesets, Terraform), version-controlled and reviewable, so the gate config itself goes through review and can't silently rot. The judgment: defaults and non-negotiables (secrets, build, basic tests) belong in **org rulesets**; genuinely repo-specific extras stay local. The failure mode to avoid is 200 hand-edited protection rules nobody can audit.

### Q: Why is "make everything required" an anti-pattern? Argue both the math and the culture.

> **Testing:** Whether you can resist the intuition that more gates = more safety.

**A.** It's seductive — every check *feels* like more safety — but it backfires on three axes:

- **Math.** As shown, total green probability is `p^k`; piling on required checks drives the spurious-failure rate up exponentially. A 50-check required pipeline at `p=0.99` is red ~40% of the time *for no real reason*, so the gate's signal drowns in noise.
- **Latency.** Each required check is critical-path time on every PR. "Everything required" is also "everything is slow for everyone, always."
- **Culture.** When the gate is constantly, spuriously red, people learn to **ignore it** and lobby for **admin bypass** — so the *effective* gate is weaker than a small, trusted one. A gate people respect catches more than a gate people route around.

The mature stance: the required set is a **carefully chosen minimum** — fast, deterministic, blocking-worthy — and everything else is advisory, run in parallel/nightly lanes that inform without blocking. Safety comes from a **trusted** gate, not a *maximal* one.

### Q: How do you review and prune the required set over time? How do you know a gate is worth its cost?

> **Testing:** Whether gates are a living system to you, or fire-and-forget config.

**A.** I treat each required check as having a **cost** (latency × PR volume + flake tax + maintenance) and a **benefit** (defects actually caught × their severity), and I review the ledger periodically. Concretely:

- **Catch rate.** Instrument how often each required check *fails for a real reason* vs passes vs flakes. A check green on the last several thousand PRs with zero real catches is pure tax — **demote it to advisory or delete it.**
- **Flake rate.** Track spurious-failure rate per check; anything chronically flaky gets quarantined and fixed or removed, because the exponent punishes the whole pipeline.
- **Latency contribution.** Know which required job is the long pole and whether its cost is justified by its catches.
- **Redundancy.** Two checks that catch the same class of defect don't both need to be required.

The mindset to convey: gates are a **portfolio you actively manage**, not a ratchet that only tightens. The willingness to *remove* a gate that isn't earning its keep is, paradoxically, a senior signal — it shows you understand the cost side, not just the comforting feeling of more checkmarks.

### Q (Scenario): "PRs are stuck on a required check that isn't running." Diagnose it end to end.

> **Testing:** The flagship scenario — calm, ordered triage of the stuck-PR family.

**A.** Classify first: "required check, not running, PRs wedged" → the status is **absent**, not failing. The usual root cause is one of three, and I check them in order against the Actions tab + protection rule as ground truth:

1. **Path-filter / `if` skip.** The required job has `paths:` or an `if:` that evaluated false for these PRs, so it was **skipped** — and a skipped required job reports *no status*, which protection reads as pending forever. **Fix:** introduce the **aggregate gatekeeper job** that `always()` runs and goes green on pass-or-skip, and require *that* instead of the filtered jobs.
2. **Renamed job / matrix bump.** The required-check **name** in protection no longer matches the name the pipeline reports (`test` → `unit-tests`, or `go 1.21` → `1.22`). Protection waits on a name that will never report again. **Fix:** update the required list to the new name (two-step migration so nothing's unguarded in between), and going forward require a *stable* gatekeeper name so matrices can churn safely.
3. **Wrong trigger / event mismatch.** The check is required under one event (`push`) but these PRs only fire `pull_request` (or the check only runs on a different branch pattern), so it never reports in this context. **Fix:** align the trigger.

If none of those, it's an honest pending: **runner starvation / stuck queue** — check the queue and runner capacity. The throughline of a good answer: read the **pipeline run and the protection config** before touching code, because in this failure family the code is virtually never the problem.

### Q (Scenario): "Your required pipeline takes 40 minutes. How do you cut it?"

> **Testing:** Whether you optimize the *critical path* systematically, not randomly.

**A.** I'd profile first — get the per-job/per-stage timing so I optimize the **long pole**, not whatever's most familiar. Then, in ROI order:

1. **Cache aggressively** — dependency installs, build outputs, Docker layers, a remote build cache. Reinstalling/recompiling from scratch every run is usually the biggest chunk and the cheapest to fix.
2. **Parallelize** — split the serial chain (build → lint → type-check → test) into concurrent jobs so the wall-clock is the *max*, not the *sum*.
3. **Shard the test suite** across N runners — a 20-minute test phase becomes ~4 minutes across 5 shards (until coordination overhead).
4. **Run only what's affected** — in a monorepo, use the dependency graph (Nx/Turborepo affected, Bazel, test-impact analysis) so a PR touching one package doesn't rebuild/test the world. This is often the single biggest win at scale because most PRs touch a small slice.
5. **Move the slow-but-not-blocking-worthy work off the critical path** — full e2e and perf suites become advisory/nightly, not required on every PR.

The framing: the goal isn't "make CI faster" in the abstract, it's "shrink the **required** critical path" — fast feedback where it gates merges, with slower comprehensive checks running where they don't block humans.

### Q (Scenario): "A required check is flaky and the team is merging with admin override to get unblocked." What's your move?

> **Testing:** Whether you treat the override as a symptom and fix the system, not the people.

**A.** The override is a **symptom** — people route around a gate they can't trust, which is rational under a flaky required check, but it silently disables the gate for everyone. My move, in order: **(1)** immediately **quarantine** the flaky check out of the required set (advisory lane, still running and tracked) so people stop needing the override to do honest work; **(2)** **remove/restrict the routine admin override** once the legitimate reason to use it is gone, so it goes back to being a break-glass, not a daily habit; **(3)** **fix the flake's root cause** and only then return it to required; **(4)** add **flake-rate instrumentation** so the next flaky check is caught and quarantined *before* it trains the team to bypass. The principle I'd state: when people are bypassing a gate, the bug is in the *gate's reliability or design*, not in the people — fix the system so the right path is also the easy path, rather than scolding the team for the override.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: What makes a check "required"?** A: A branch-protection / merge rule referencing that check's name — not anything in the CI job itself.
- **Q: Required vs advisory in one line?** A: Required blocks the merge button on failure; advisory just reports.
- **Q: Why protect `main` over feature branches?** A: `main` is the shared source of truth — a regression there blocks everyone; a feature branch only inconveniences its author.
- **Q: Commit Status API vs Checks API?** A: Older context-string statuses (external CIs) vs richer named check runs with annotations (GitHub Actions/Apps).
- **Q: Why isn't a pre-commit hook a substitute for a required check?** A: A hook is local and bypassable (`--no-verify`); only a server-side required check is enforced.
- **Q: What wedges a PR when a required job is renamed?** A: Protection waits on the old literal name, which never reports again → pending forever.
- **Q: Why does a path-filtered required job deadlock a PR?** A: A skipped required job reports no status, and protection reads "no status" as not-satisfied → stuck.
- **Q: The fix for that deadlock?** A: An aggregate gatekeeper job that `always()` runs and passes on pass-or-skip; require only that.
- **Q: What does "require branches up to date" cost?** A: Serialization of merges — the modern fix is a merge queue / merge train.
- **Q: The flake math for k independent required checks?** A: Green probability is `p^k`; spurious-failure rate climbs fast as `k` grows.
- **Q: Flaky required test — first move?** A: Quarantine it out of the required set (keep it running, fix the root cause), don't block the org.
- **Q: What do you NOT do with a flaky test?** A: Reflexively auto-retry, delete it, or make admin-bypass the routine.
- **Q: Which security finding always blocks?** A: A committed secret — unambiguous and catastrophic.
- **Q: Push protection vs CI secret scanning?** A: Push protection stops the secret before it reaches the remote; CI scanning fires after it's already leaked.
- **Q: The danger of a noisy security gate?** A: False positives → ignored → bypassed → disabled; worse than a smaller trusted gate.
- **Q: Org rulesets vs per-repo protection?** A: Rulesets assert a baseline fleet-wide as code; per-repo is for genuine exceptions and tends to drift.
- **Q: Why is "everything required" an anti-pattern?** A: `p^k` flake explosion, critical-path latency, and a gate people learn to ignore.
- **Q: How do you know a required check should be removed?** A: It's been green with zero real catches for thousands of PRs — pure tax, no defended invariant.
- **Q: The fastest single lever to cut required-pipeline time?** A: Usually caching, then parallelize, then shard, then run-affected.
- **Q: Why must required checks be fast specifically?** A: They're on the critical path of *every* PR, so their latency multiplies across all merges.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Thinking "required" is a property of the CI job rather than of the protection rule.
- Believing a pre-commit hook *enforces* anything (forgetting `--no-verify` and fresh clones).
- Not knowing why a renamed or path-filtered required job wedges PRs — or "fixing" it by removing the requirement.
- "Just make everything required" — no sense of the `p^k` flake cost or critical-path latency.
- Reaching for blanket auto-retry, test deletion, or routine admin-override to deal with a flaky required check.
- Gating on the *entire* SAST output and being surprised when the team disables it.
- Treating gate config as fire-and-forget — never reviewing whether a required check still catches anything.
- Debugging a stuck PR by editing the code instead of reading the pipeline run and protection rule.

**Green flags:**

- Naming the *distinction* (required/advisory, enforced/bypassable, name-keyed/result-keyed) before reaching for config.
- Reaching for the **gatekeeper job** pattern unprompted to solve the path-filter deadlock *and* the rename fragility.
- Quantifying with `p^k` and concluding "keep the required set small + drive per-check reliability up."
- **Quarantine-then-fix** as the reflex for flaky required tests, with retries logged and bounded, never reflexive.
- Block secrets + unambiguous criticals, advise the noisy tail — and naming the false-positive death spiral.
- Knowing push protection beats CI scanning for secrets because it stops the leak *before* the remote.
- Framing the required set as a **managed portfolio with a cost** that you prune, not a ratchet that only tightens.
- Reaching for org rulesets / gate-config-as-code at scale, and a merge queue instead of manual serialization.

---

## Cheat Sheet

| Concept | One-line answer |
|---|---|
| **Required vs advisory** | Protection rule blocks merge vs check just reports. |
| **Green-build contract** | Every commit on `main` builds + passes + meets the bar, always. |
| **Typical required set** | build, unit tests, lint, format, type-check, secrets + critical security. |
| **Status vs check run** | Commit Status API (context string) vs Checks API (named, annotated). |
| **Hook vs required check** | Local & bypassable vs server-side & enforced — layer both. |
| **Name-keyed footgun** | Rename a required job → old name never reports → PRs pending forever. |
| **Path-filter deadlock** | Skipped required job = no status = stuck; fix with a `always()` gatekeeper job. |
| **Up-to-date requirement** | Serializes merges; modern fix = merge queue / merge train. |
| **Flake math** | k independent required checks → green probability `p^k`; small set + high `p`. |
| **Flaky required test** | Quarantine → fix root cause → re-promote; never reflexive-retry/delete/override. |
| **Speed levers** | Cache → parallelize → shard → run-affected; shrink the *required* critical path. |
| **Secret gate** | Block always; prefer **push protection** over after-the-fact CI scanning. |
| **Security block vs warn** | Block catastrophic/unambiguous (secrets, exploitable criticals); advise the tail. |
| **Org rulesets** | Fleet-wide baseline as code; per-repo only for real exceptions. |
| **Prune gates** | Demote/delete required checks that catch nothing — required is a budget, not a ratchet. |

---

## Summary

- The bank reduces to a few distinctions in costumes: **required vs advisory**, **enforced vs bypassable**, **status vs check run**, **keyed on a name vs a result**, **fast vs slow on the critical path**. Name the distinction first; the config follows.
- **Fundamentals:** "required" is a *protection-rule* property, not a CI property. Required checks enforce the **green-build contract** on `main` because that branch's blast radius is the whole team. The default required set is fast + deterministic + blocking-worthy; hooks are convenience, required checks are enforcement.
- **Mechanics & gotchas:** required checks are keyed on the literal **job name** (rename → stuck PRs), a path-filtered required job **skips → reports no status → wedges the PR forever**, and the fix for both is an **aggregate gatekeeper job** that `always()` runs and you require alone. "Require up to date" serializes merges; **merge queues** are the modern answer.
- **Speed & flakiness:** required checks are on **every PR's critical path**, so latency multiplies — cache, parallelize, shard, run-affected. The `p^k` math means more required checks **compound** spurious failures, so keep the set small and per-check reliability high. For a flaky required test: **quarantine, then fix the root cause** — never reflexive-retry, delete, or routine override.
- **Security gates:** **block** secrets (prefer **push protection**) and unambiguous criticals; **advise** the noisy tail — a false-positive-heavy gate gets ignored, bypassed, then disabled. Suppress unfixable-but-unreachable findings with scoped, justified, expiring entries, not by killing the scanner.
- **Scale & judgment:** prefer **org rulesets / config-as-code** for fleet baselines; resist "everything required" (math + latency + culture); and actively **prune** required checks that never catch anything — the required set is a managed portfolio with a cost, not a ratchet.

---

## Further Reading

- GitHub Docs — *About protected branches* and *Require status checks before merging*. The authoritative reference for required-check behavior, including the skipped-vs-pending and name-matching semantics.
- GitHub Docs — *Repository rulesets* and *Managing a merge queue*. Org-wide gate policy as code, and the modern fix for "require branches up to date."
- GitHub Docs — *Checks API* vs *Commit statuses* and *Secret scanning push protection*. Why two status shapes both gate, and the earliest secret gate.
- Google Testing Blog — *Flaky Tests* series, and Spotify/Dropbox engineering posts on flaky-test quarantine and the flaky tax. The empirical case for quarantine-then-fix and `p^k` intuition.
- The [junior.md](junior.md), [middle.md](middle.md), and [senior.md](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — Branch Protection & Merge Policies](../02-branch-protection-and-merge-policies/interview.md) — the rule layer that turns a check into a required one, and merge-queue mechanics.
- [03 — Coverage & Quality Thresholds](../03-coverage-and-quality-thresholds/interview.md) — coverage and metric gates, the most-debated checks to make required.
- [05 — Gate Design: Speed vs Safety](../05-gate-design-speed-vs-safety/interview.md) — the explicit tradeoff this whole bank circles: a trusted minimal gate vs a maximal slow one.
- [Testing](../../testing/) — where the test suites behind the required test check are designed, including flakiness at the source.
- [Static Analysis & Linting](../../static-analysis/) — the lint, type-check, and SAST tools that supply many required and advisory checks.
