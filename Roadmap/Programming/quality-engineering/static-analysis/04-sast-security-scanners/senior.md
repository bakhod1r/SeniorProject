# SAST & Security Scanners — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → SAST & Security Scanners

*Designing a SAST program that developers trust: tool selection, baselining, PR-diff gating, and triage that scales.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Choosing Tools and Rule Packs](#core-concept-1--choosing-tools-and-rule-packs)
5. [Core Concept 2 — Blocking vs Advisory: The Gating Strategy](#core-concept-2--blocking-vs-advisory-the-gating-strategy)
6. [Core Concept 3 — Baselining Legacy Code](#core-concept-3--baselining-legacy-code)
7. [Core Concept 4 — PR-Diff Scanning Done Right](#core-concept-4--pr-diff-scanning-done-right)
8. [Core Concept 5 — Triage as a System](#core-concept-5--triage-as-a-system)
9. [Core Concept 6 — Authoring High-Signal Custom Rules](#core-concept-6--authoring-high-signal-custom-rules)
10. [Core Concept 7 — Secrets as a Separate Pipeline](#core-concept-7--secrets-as-a-separate-pipeline)
11. [Core Concept 8 — Where SAST Ends and Other Controls Begin](#core-concept-8--where-sast-ends-and-other-controls-begin)
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

> Focus: **turning a scanner into a program — what blocks, what's baselined, who triages, and how to keep developer trust intact while actually reducing risk.**

A junior runs a scanner. A senior owns the *system* around it. The hard part of SAST is not the tool; it's the socio-technical design: which findings stop a deploy, what to do with ten years of pre-existing issues, who is on the hook to triage, and how to keep the false-positive rate low enough that engineers respect the output. Get this wrong and you ship the most expensive form of security theater: a red pipeline everyone has learned to override.

## Prerequisites

- Middle tier: source/sink/sanitizer, rule packs, baselining, suppression, SARIF.
- You've owned a CI pipeline and a branch-protection / required-checks setup.
- You understand pull-request workflow and how teams react to friction.
- Familiarity with taint analysis depth ([`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)) and CI integration ([`../09-static-analysis-in-ci/`](../09-static-analysis-in-ci/)).

## Glossary

| Term | Meaning |
|------|---------|
| **Blocking finding** | A finding that fails CI and prevents merge/deploy. |
| **Advisory finding** | Reported but non-blocking; surfaced for awareness. |
| **Baseline** | Recorded set of pre-existing findings, excluded from gating. |
| **Diff-aware scan** | Gate only on findings introduced by the change under review. |
| **Triage** | Per-finding decision: fix / false positive / accepted risk, with an owner and timeline. |
| **True-positive rate (TPR)** | Fraction of findings that are real bugs — the trust metric. |
| **Suppression with justification** | An explicitly documented dismissal of a finding. |
| **Quality gate** | The policy that decides whether the pipeline passes. |

## Core Concept 1 — Choosing Tools and Rule Packs

Tool selection is portfolio design, not picking a winner. Match the *class* of tool to the job:

| Need | Tool | Rationale |
|------|------|-----------|
| Polyglot baseline, fast PR scans, custom org rules | **Semgrep** | Cheap to run, taint mode, readable rules, OSS core |
| Deep interprocedural vulns, complex dataflow | **CodeQL** | Best precision on hard flows (see [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)) |
| Per-language depth in IDE/CI | `bandit`/`gosec`/`brakeman`/`spotbugs+findsecbugs` | Strong native rule sets, low setup |
| Secret detection across history | `gitleaks`/`trufflehog`/platform secret scanning | Different problem; own pipeline |
| Commercial coverage + triage workflow | Snyk Code, Checkmarx, etc. | Buy when triage tooling/SLA matters |

A common, defensible stack: **Semgrep** for fast diff-aware PR scanning with a tuned ruleset, **CodeQL** on a nightly/weekly full-repo schedule for deep flows, plus a language-native tool where it adds rules the others miss, and a **dedicated secrets pipeline**.

On rule packs: start narrow, expand on evidence. Begin with high-signal packs (`p/owasp-top-ten`, language-specific security audits), measure their true-positive rate over a few weeks, and only then widen. A rule that fires often and is always wrong is a *liability* — it spends your team's trust budget. Curate aggressively; disable, don't endure.

## Core Concept 2 — Blocking vs Advisory: The Gating Strategy

The single most important policy decision: **what fails the build?** Block too much and developers route around you; block too little and nothing gets fixed. A workable tiering:

| Severity × confidence | Policy |
|-----------------------|--------|
| High severity, high confidence (SQLi, command injection, hardcoded secret) | **Block** the PR |
| High severity, low confidence | Advisory + require human triage before merge |
| Medium | Advisory; track to SLA |
| Low / hygiene | Advisory or off in CI; surface in IDE |

The non-negotiable rule: **gate only on the diff, against the baseline** (next sections). You block on *new* high-confidence vulnerabilities, not on the accumulated history of the repo. This keeps the gate meaningful — a red build means "you just introduced something," which developers accept, rather than "this old file has issues," which they resent.

```yaml
# Conceptual gate: fail only on NEW high-severity findings in the diff
semgrep ci --config p/owasp-top-ten \
  --baseline-commit "$BASE_SHA" \
  --severity ERROR        # WARNING/INFO reported but non-blocking
```

This gating policy is itself a quality-gate design problem; the broader machinery of required checks and break-glass lives under quality-gates and [`../09-static-analysis-in-ci/`](../09-static-analysis-in-ci/).

## Core Concept 3 — Baselining Legacy Code

You will almost never start on a greenfield repo. A first full scan of a mature codebase yields hundreds to thousands of findings. You cannot fix them all before merging the next PR, and you must not block on them. The answer is a **baseline**: record today's findings as "known," and gate only on what's new.

```bash
# Semgrep: compare against a base commit; pre-existing findings are excluded
semgrep ci --config p/security-audit --baseline-commit "$(git rev-parse origin/main)"
```

```bash
# Tool-agnostic pattern: store a fingerprinted baseline file
semgrep --config p/security-audit --json -o baseline.json .   # once, committed
# later runs diff against baseline.json; only new fingerprints fail
```

Baselining buys you two things: an honest gate (new code is clean) and a *backlog* (the baseline list is your remediation queue). The discipline is to **burn the baseline down over time** — assign a portion of each iteration to clearing high-severity baseline items — rather than letting it become a permanent amnesty. A baseline that never shrinks is technical debt with a security label.

## Core Concept 4 — PR-Diff Scanning Done Right

Diff-aware scanning is the mechanism that makes gating tolerable. Done right:

- **Scope to changed code.** Surface only findings whose location intersects the diff. Semgrep's `ci` subcommand does this against the baseline commit automatically.
- **Fast feedback.** PR scans must finish in minutes. Reserve slow, deep CodeQL passes for scheduled full scans, not the blocking PR check.
- **Inline annotations via SARIF.** Findings appear on the exact changed line, not buried in logs.

```yaml
# .github/workflows/sast.yml — blocking PR check, diff-aware, inline
on: { pull_request: {} }
jobs:
  semgrep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }            # need history for baseline diff
      - uses: returntocorp/semgrep-action@v1
        with:
          config: p/owasp-top-ten
          generateSarif: "1"
      - uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: semgrep.sarif }
```

A subtle trap: **moved code looks like new code.** A refactor that relocates a pre-existing vulnerable function can re-trigger a baselined finding. Fingerprint-based baselines (hashing the finding's context, not its line number) mitigate this; line-anchored baselines do not. Know which your tool uses.

## Core Concept 5 — Triage as a System

Findings without an owner rot. Triage must be a *defined process*, not goodwill:

1. **Who triages.** Default to the PR author for diff findings (they have the context); escalate ambiguous or high-severity ones to a security champion or the security team.
2. **The three outcomes.** Every finding resolves to exactly one of: **fix** (the common case), **false positive** (suppress *with justification*), or **accepted risk** (documented, time-boxed, signed off by someone with authority to accept it).
3. **SLA by severity.** Criticals get a hard clock (e.g. fix or risk-accept within N days); mediums get a softer one. Without an SLA, "we'll get to it" means never.
4. **Make suppression auditable.** Inline `# nosemgrep: rule — reason` plus, ideally, a ticket link. A reviewer should be able to reconstruct *why* a finding was dismissed months later.

```python
# nosemgrep: tainted-path-traversal — path is constrained to ALLOWED_DIRS allow-list above; JIRA SEC-482
return open(os.path.join(base, validated_name))
```

The metric that governs the whole system is **true-positive rate**. If developers find that most blocking findings are real, they comply. If most are noise, they'll demand the gate be removed — and they'll be right. Triage data feeds rule tuning: a rule with a chronically low TPR gets rewritten or disabled.

## Core Concept 6 — Authoring High-Signal Custom Rules

Off-the-shelf packs catch generic OWASP bugs. The highest-value rules are *organization-specific* — they encode your internal safe APIs and forbidden patterns. Two archetypes:

**Forbid an unsafe internal pattern** (and point to the safe one):

```yaml
rules:
  - id: ban-raw-db-query
    languages: [python]
    severity: ERROR
    message: >
      Do not call db.raw(). Use the parameterized repository layer (db.query_safe).
      Raw queries have caused SQLi in this codebase before.
    patterns:
      - pattern: db.raw($Q)
      - pattern-not: db.raw("...")     # allow constant string literals
```

**Taint rule wired to YOUR framework's source/sink shapes:**

```yaml
rules:
  - id: internal-template-injection
    languages: [python]
    mode: taint
    severity: ERROR
    message: User input reaches our template renderer unescaped (SSTI).
    pattern-sources:
      - pattern: get_request_param(...)
    pattern-sanitizers:
      - pattern: ourlib.escape(...)
    pattern-sinks:
      - pattern: ourlib.render_unsafe(...)
```

Custom-rule authoring overlaps heavily with [`../07-custom-lint-rules-and-ast/`](../07-custom-lint-rules-and-ast/); the security twist is that you tune sources/sinks/sanitizers to your real frameworks so the rule has a high true-positive rate from day one. A rule born noisy will be suppressed into uselessness.

## Core Concept 7 — Secrets as a Separate Pipeline

Secret detection deserves its own pipeline because it has different mechanics and a different remediation:

- **Scan history, not just HEAD.** A secret committed once is exposed forever; scanning only the current tree misses it.
- **Pre-commit + push-protection.** Block secrets *before* they enter history (`gitleaks protect`, GitHub push protection) — far cheaper than cleaning up after.
- **Remediation is rotation, not deletion.** Once committed, assume the secret is compromised: **rotate it at the provider first**, then remove from code, then scrub history if warranted.

```bash
gitleaks detect --source . --redact            # scan full history
gitleaks protect --staged                       # pre-commit: block before it lands
```

```
Finding:     AWS Access Key
Secret:      AKIA****************
File:        config/settings.py:12
Commit:      a1b9f3c (6 months ago)
Rule:        aws-access-key
```

Treating that finding as "delete the line and move on" leaves a live key in history. The discipline — rotate, then remediate — is the core of the `secrets-management` skill, and it is non-negotiable.

## Core Concept 8 — Where SAST Ends and Other Controls Begin

A senior sets honest expectations. SAST is *one layer*. It is strong on injection, secrets, weak crypto, and unsafe APIs — and structurally blind to:

- **Authorization / authentication logic** (IDOR, privilege escalation) — no pattern encodes "this resource should belong to the caller."
- **Business-logic flaws** — valid-looking code, invalid intent.
- **Runtime-only issues** — actual reachability, production config, environment-specific behavior.

These need **code review** (humans reasoning about intent), **DAST / pen-testing** (runtime probing), and **threat modeling**. Selling SAST as "we're now secure" is a career-limiting move; selling it as "we've automated the boring, common, code-shaped bugs so humans can focus on logic and authz" is accurate and credible. Pair SAST with the `input-validation`, `sql-injection-prevention`, and `xss-prevention` skills on the *defensive* side, and with human review for the classes SAST can't see.

## Real-World Examples

- **The trust-budget collapse.** A team enabled five rule packs, blocking, no baseline. The PR gate failed on legacy findings; engineers got admin to make the check non-required within two weeks. Restarting required tearing it all down: one tuned pack, baseline, diff-only, advisory for a month, then block on high-confidence only. Trust is spent fast and rebuilt slowly.
- **The custom rule that paid for itself.** After a SQLi incident traced to `db.raw()`, a five-line Semgrep rule banning it caught three more instances across the org in the next quarter — bugs no generic pack would have flagged because the function was internal.
- **The moved-code false alarm.** A refactor relocated a baselined function; a line-anchored baseline re-flagged it as "new," failing an unrelated PR. Switching to fingerprint baselining fixed it permanently.

## Mental Models

- **The gate is a trust contract.** Every false-positive block is a withdrawal from developer trust; every real catch is a deposit. Run the account in surplus or the gate gets removed.
- **Baseline = freeze the past, gate the future, burn the backlog.** All three verbs matter.
- **Diff-aware turns "your repo is bad" into "your change is bad."** Only the second is actionable and acceptable.
- **TPR is the north-star metric.** It predicts whether the program survives contact with engineers.

## Common Mistakes

- **Blocking on the full repo instead of the diff** → legacy findings fail unrelated PRs → gate gets disabled.
- **No baseline burndown** → the baseline becomes permanent amnesty for real vulnerabilities.
- **No triage owner or SLA** → findings accumulate untouched; the queue is decorative.
- **Custom rules shipped without measuring TPR** → noisy rules get globally suppressed, masking real hits.
- **Line-anchored baselines** → refactors and moves cause phantom "new" findings.
- **Overselling coverage** → leadership believes authz/logic bugs are covered; they aren't.
- **Folding secrets into the generic SAST pipeline** → history isn't scanned, rotation isn't enforced.

## Test Yourself

1. Design the blocking-vs-advisory policy for a new SAST rollout. What blocks on day one, and why so little?
2. Why must gating be diff-aware *and* baselined, not one or the other?
3. What's the failure mode of a baseline that never shrinks?
4. A refactor moves a function and a baselined finding reappears as "new." Diagnose and fix.
5. Define a triage SLA and the three legal outcomes for any finding.
6. Why is a leaked secret handled by a separate pipeline with rotation, not by SAST suppression?
7. Give two vulnerability classes SAST structurally cannot catch, and the control that does.

## Cheat Sheet

```text
PROGRAM = tool portfolio + gating policy + baseline + triage + metrics

Gate policy:
  block  : high-sev + high-conf, on the DIFF, vs BASELINE
  advise : medium / low-conf (track to SLA)
   idle   : hygiene (IDE only)

Baseline: freeze past · gate future · BURN the backlog (don't let it = amnesty)
Diff-aware: scope to changed lines · fast (<minutes) · SARIF inline · fingerprint > line-anchor

Triage: owner (PR author → champion → sec team) · 3 outcomes (fix / FP+reason / accepted-risk)
        · SLA by severity · suppress with justification + ticket
North star: TRUE-POSITIVE RATE (predicts program survival)

Tools: Semgrep (PR diff) + CodeQL (nightly deep) + native + SECRETS pipeline
Secrets: scan HISTORY · push-protection · ROTATE then remediate
SAST can't see: authz/authn · business logic · runtime context → review + DAST + threat model
```

## Summary

A senior owns the SAST *program*, not the scanner. Build a tool portfolio (Semgrep for fast diff scans, CodeQL for deep flows, native tools where they help, a dedicated secrets pipeline). Gate only on **new, high-confidence findings in the diff, measured against a baseline** — block too much and developers route around you. Baseline legacy code to freeze the past, gate the future, and *burn the backlog down* rather than letting it become permanent amnesty. Make triage a system with owners, SLAs, and three documented outcomes (fix / justified false positive / accepted risk). Author org-specific high-signal rules, measured by true-positive rate — the metric that predicts whether the program survives. Run secrets as a separate, history-scanning, rotation-first pipeline. And set honest expectations: SAST automates the common, code-shaped bugs so humans and DAST can focus on the authorization, business-logic, and runtime flaws it can never see.

## Further Reading

- Semgrep CI / baseline documentation; CodeQL setup for scheduled deep scans.
- OWASP DevSecOps Guideline and the OWASP Top 10.
- `gitleaks` / `trufflehog` and platform push-protection docs.
- The `secrets-management`, `sql-injection-prevention`, `xss-prevention`, and `input-validation` skills.

## Related Topics

- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the engine behind precise findings
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating, diff scans, SARIF upload mechanics
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — authoring org-specific rules
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA, the dependency layer
- [Static Analysis (section overview)](../README.md)
