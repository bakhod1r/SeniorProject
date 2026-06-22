# SAST & Security Scanners — Interview Level

> **Roadmap:** [Static Analysis](../README.md) → SAST & Security Scanners

*A question bank for interviews where SAST, secure-SDLC, and AppSec tooling come up.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Signal vs Noise](#signal-vs-noise)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering SAST questions the way a senior engineer does — precise about what it catches, honest about what it doesn't, and program-minded about noise, gating, and remediation.**

Interviewers use SAST questions to separate people who *ran a scanner once* from people who *operated a security program*. The tell is almost always honesty about limits: a candidate who claims SAST "makes the app secure" loses; one who says "SAST automates the common code-shaped bugs and is blind to authz and logic" wins. Answer with the source→sink model, the noise problem, and the human-in-the-loop reality.

## Prerequisites

- All four content tiers (junior → professional) of this topic.
- Comfort with the OWASP Top 10 by name.
- Basic taint intuition (see [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)).

## Fundamentals

**Q1. What is SAST, and how does it differ from DAST and SCA?**
*What's really being tested: do you know the three tools aren't interchangeable?*
**A.** SAST (Static Application Security Testing) analyzes your own source or bytecode *without running it*, matching it against security rules to find code-shaped vulnerabilities (injection, hardcoded secrets, weak crypto). DAST tests a *running* application from the outside, finding runtime behavior. SCA scans your *third-party dependencies* for known CVEs. SAST sees your code, DAST sees your behavior, SCA sees your supply chain — different inputs, different bugs. A serious program runs all three.

**Q2. Give three vulnerability classes SAST catches well and three it's bad at.**
*What's really being tested: do you understand its structural strengths and blind spots?*
**A.** Catches well: SQL injection, command injection, hardcoded secrets (also XSS, weak crypto, path traversal) — all *local, code-shaped* bugs visible in structure. Bad at: authorization/authentication logic (IDOR, privilege escalation), business-logic flaws, anything needing runtime context. The reason is fundamental: SAST sees *shapes*, not *meaning* — it can flag a dangerous operation but not a *missing* authorization check, because nothing in the syntax says "this resource should belong to the caller."

**Q3. What does "shift-left" mean for SAST?**
*What's really being tested: do you grasp the economic argument?*
**A.** Moving security detection earlier in the lifecycle — into the IDE and pull request rather than a late pen-test or production. The cost of a vulnerability grows the further right it escapes: a finding fixed in a PR costs minutes; the same flaw exploited in production is an incident. SAST shifts left by scanning the diff at code-review time.

**Q4. Why is a clean SAST report *not* the same as "secure"?**
*What's really being tested: humility about tool limits.*
**A.** It means no *known patterns* fired. It says nothing about authorization, business logic, design flaws, or runtime configuration — all invisible to static pattern/dataflow analysis. A clean report plus no code review, no DAST, and no threat modeling is a false sense of security. It can even mean the rules for *your* framework simply don't exist yet — coverage of a finding class depends on someone having written a rule for the specific source/sink shapes your code uses.

## Technique

**Q5. Explain the source/sink/sanitizer model.**
*What's really being tested: do you understand how findings are computed, not just that they appear?*
**A.** A **source** is where untrusted input enters (`request.args.get`); a **sink** is a dangerous operation (`cursor.execute`, `os.system`); a **sanitizer** neutralizes the danger (parameterization, escaping, allow-list validation). A finding is a *tainted path*: data flows from a source to a sink with no sanitizer in between. SQL injection = (request param) → (SQL query) with no parameter binding. This model is the heart of taint analysis (full theory in [`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)).

**Q6. Pattern matching vs dataflow analysis — what's the trade-off?**
*What's really being tested: do you know why some tools are noisier?*
**A.** A pattern rule matches syntactic shape ("flag every `execute()`") — fast and simple but high false-positive rate, because it doesn't know whether the argument is tainted. A dataflow/taint rule fires only when input *actually flows* from a source to the sink unsanitized — far more precise, but slower and harder to write. Bandit/gosec are pattern-based; Semgrep adds light taint; CodeQL does deep interprocedural dataflow. The trade-off is precision vs speed/simplicity.

**Q7. Walk me through a Semgrep taint rule.**
*What's really being tested: can you actually author a rule?*
**A.** It declares `mode: taint` with three lists: `pattern-sources` (untrusted inputs), `pattern-sinks` (dangerous operations), and `pattern-sanitizers` (neutralizers). The engine reports a finding only when a source reaches a sink without crossing a sanitizer.

```yaml
rules:
  - id: tainted-sql
    mode: taint
    languages: [python]
    severity: ERROR
    pattern-sources: [{ pattern: flask.request.args.get(...) }]
    pattern-sanitizers: [{ pattern: sqlalchemy.text(...) }]
    pattern-sinks: [{ pattern: $C.execute(...) }]
```

This is dramatically lower-noise than "flag every `.execute()`."

**Q8. Name SAST tools and what class each belongs to.**
*What's really being tested: breadth of practical knowledge.*
**A.** Semgrep (polyglot, pattern + light dataflow, easy custom rules); CodeQL (query-based, deep dataflow); Bandit (Python, pattern); gosec (Go, pattern); Brakeman (Rails-aware); SpotBugs + FindSecBugs (JVM bytecode); Snyk Code (commercial, ML-assisted). For secrets specifically: gitleaks, trufflehog — a different problem because they scan git history.

## Signal vs Noise

**Q9. SAST is "famously noisy." Why, and why does it matter?**
*What's really being tested: do you understand the make-or-break of every SAST program?*
**A.** Pattern rules over-fire (no flow awareness), and a first scan of a mature repo can produce thousands of findings, most false or irrelevant. It matters because **noise is itself a security risk**: every false positive erodes trust until engineers ignore *all* findings, including real ones. The classic failure is "a wall of 4,000 findings nobody reads." A tool the team has learned to ignore is worse than no tool.

**Q10. How do you keep signal-to-noise manageable?**
*What's really being tested: practical program design.*
**A.** Four levers: (1) **baseline** legacy code so only new findings gate; (2) **scan only the diff** in PRs; (3) **tune rule packs** — disable chronically-wrong rules; (4) **suppress false positives with justification**, never silently. Use taint-mode rules over pattern rules where possible. The governing metric is **true-positive rate**: if most blocking findings are real, developers comply.

**Q11. How should false positives be suppressed?**
*What's really being tested: do you know suppression is a documented decision, not a mute button?*
**A.** Inline, with a reason, ideally a ticket link — e.g. `# nosemgrep: rule-id — query is constant; col from allow-list; SEC-482`. A reviewer must be able to reconstruct *why* it was dismissed months later. A blanket unexplained suppress is a smell; it hides real bugs as easily as false ones.

**Q12. A finding is high-severity but low-confidence. Block the build?**
*What's really being tested: nuance about confidence vs severity.*
**A.** No — don't auto-block on low confidence. Confidence and severity are different axes. Block on high-severity *and* high-confidence; for high-severity/low-confidence, surface it and require human triage before merge. Auto-blocking on low-confidence findings is how you train developers to route around the gate.

## Scenarios

**Q13. You're rolling out SAST on a 10-year-old monorepo. First scan: 4,000 findings. What do you do?**
*What's really being tested: do you avoid the classic graveyard?*
**A.** Do **not** turn on blocking against all 4,000 — that fails every PR on legacy issues and gets the gate disabled. Instead: (1) **baseline** the existing findings; (2) enable **diff-aware** scanning so only *new* code gates; (3) tune the ruleset to the highest-TPR packs; (4) run advisory for a few weeks to measure noise; (5) then block on high-confidence/high-severity classes only; (6) treat the baseline as a backlog and burn it down with allocated capacity. Freeze the past, gate the future, fix the backlog over time.

**Q14. SAST flags a hardcoded AWS key in a commit from six months ago. What's the remediation?**
*What's really being tested: do you know secrets ≠ suppress?*
**A.** Not "delete the line." Once committed, the secret is in git history forever and must be assumed compromised. **Rotate the credential at the provider first**, then remove it from code, then scrub history if warranted, and add push-protection / pre-commit secret scanning to prevent recurrence. Suppressing the finding leaves a live, exploitable key in history. This is the core of the `secrets-management` discipline.

**Q15. A developer asks why SAST didn't catch an IDOR bug that caused a breach. How do you answer?**
*What's really being tested: can you explain blind spots without sounding defensive?*
**A.** IDOR is an *authorization* flaw — "any user can access another user's resource." SAST sees code shape, not intent; nothing in the syntax of `db.get(account_id)` says that `account_id` should belong to the caller. That's a class SAST is structurally blind to, alongside business-logic and runtime flaws. Those need code review, DAST/pen-testing, and threat modeling. SAST's honest job is the common code-shaped bugs; it doesn't replace human reasoning about access control.

**Q16. How would you measure whether a SAST program is actually working?**
*What's really being tested: program-level thinking and Goodhart-awareness.*
**A.** Headline metric: **escaped vulnerabilities** — bugs found in prod/pen-test/bug-bounty that SAST should have caught; drive it toward zero. Support with MTTR by severity, coverage (% of repos scanning), true-positive rate, and backlog burndown. Crucially, pair throughput metrics ("findings closed") with quality metrics (audited FP rate) — otherwise people game the number by closing real findings as false positives (Goodhart).

**Q17. Build vs buy for SAST — how do you decide?**
*What's really being tested: senior judgment on economics.*
**A.** Decide on the *workflow*, not scan quality — OSS engines (Semgrep, CodeQL, gitleaks) match commercial scan quality. The real cost is triage, deduplication across tools, SLA tracking, and compliance reporting — 80% of operational effort and what vendors actually sell. The common answer is **hybrid**: build the scan with OSS, buy (or adopt open ASPM/DefectDojo) the vuln-management workflow. Pure-build underestimates workflow cost; pure-buy gets expensive and rule-opaque at scale.

**Q17b. The same SQL-injection bug is reported by both Semgrep and CodeQL. How should your program handle that?**
*What's really being tested: do you understand multi-tool deduplication?*
**A.** It's one vulnerability, not two. Findings from every scanner should flow into a single vulnerability-management/ASPM layer that **deduplicates by fingerprint** (rule-equivalent + location/context) so a team triages it once. Without dedup, multi-tool stacks double the triage burden and inflate metrics — engineers see two tickets for one fix and lose trust. The system of record is what makes multiple scanners additive rather than annoying.

**Q17c. A team wants to refactor a file; doing so re-triggers a previously baselined finding as "new" and blocks their unrelated PR. What's wrong and how do you fix it?**
*What's really being tested: do you understand baseline fingerprinting?*
**A.** The baseline is **line-anchored** — it keys findings by file+line, so moving code makes a known finding look new. Switch to a **fingerprint-based baseline** that hashes the finding's surrounding context rather than its line number, so relocated code keeps its baseline identity. This is a classic operational gotcha that erodes trust in the gate if left unfixed.

## Rapid-Fire

**Q18.** SAST input? → Source code or bytecode, analyzed without running.
**Q19.** SARIF? → Standard JSON format for scanner output; ingested by GitHub/GitLab to render findings inline.
**Q20.** Why scan git history for secrets? → A committed secret persists in history even after deletion; HEAD-only scanning misses it.
**Q21.** Diff-aware scanning gates on what? → Findings introduced by *this change*, not the whole repo.
**Q22.** One reason taint rules beat pattern rules? → They fire only on real source→sink flow, cutting false positives.
**Q23.** Tool for deep interprocedural dataflow? → CodeQL.
**Q24.** Bandit is for which language? → Python. gosec? → Go. Brakeman? → Rails.
**Q25.** What does a baseline do? → Records existing findings so only new ones gate.
**Q26.** Critical-finding SLA, typical? → Remediate or formally risk-accept within ~7 days.
**Q27.** Compliance regimes driving SAST? → PCI DSS (Req 6), SOC 2, ISO 27001, NIST SSDF.
**Q28.** Does autofix/AI remove the human? → No — suggested fixes and dismissals still need review and accountability.
**Q29.** What's the program's north-star trust metric? → True-positive rate.
**Q30.** SpotBugs+FindSecBugs analyzes what artifact? → JVM bytecode (not source).
**Q31.** Why run CodeQL nightly but Semgrep on every PR? → CodeQL's deep dataflow is slow; reserve it for scheduled full scans, keep PR gates fast.
**Q32.** Two outcomes besides "fix" for a triaged finding? → Justified false positive, and documented/time-boxed accepted risk.
**Q33.** What makes a baseline survive refactors? → Fingerprint (context-hash) keying, not line-number keying.
**Q34.** Why is "findings per KLOC introduced, trending down" valuable? → It's a leading indicator that developers are writing safer code, not just fixing after the fact.

## Red Flags / Green Flags

**Green flags (in a candidate):**
- States plainly that SAST is blind to authz and business-logic flaws.
- Frames findings as source → (no sanitizer) → sink.
- Treats noise as a first-class risk; knows baseline + diff-only + tuning + justified suppression.
- Says secrets must be *rotated*, not suppressed.
- Distinguishes severity from confidence in gating.
- Cites escaped vulnerabilities as the value metric and warns about Goodhart.

**Red flags:**
- "SAST makes the app secure" / can't name a blind spot.
- Wants to block CI on every finding from the first full scan.
- Treats a leaked secret as a line to delete.
- Confuses SAST/DAST/SCA.
- No notion of triage ownership, SLA, or false-positive management.
- Thinks more rules / more findings is strictly better.

## Cheat Sheet

```text
SAST=your code (static) · DAST=running app · SCA=dependencies
Catches: SQLi, cmd-inj, XSS, secrets, weak crypto, path traversal
Blind to: authz/authn, business logic, runtime context (→ review + DAST + threat model)

Finding = SOURCE ──(no SANITIZER)──► SINK    (taint path)
Pattern (Bandit/gosec) noisy · taint (Semgrep) balanced · deep dataflow (CodeQL) precise

Noise levers: baseline · diff-only · tune packs · suppress-with-justification
Gate on: high-sev AND high-conf, on the DIFF, vs BASELINE   (severity ≠ confidence)
Secrets: scan HISTORY, ROTATE (never just suppress)
Metrics: escaped-vulns (value) · MTTR · coverage · TPR (trust); beware Goodhart
Build the SCAN, buy the WORKFLOW (hybrid). SAST fixes nothing → human-in-the-loop.
```

## Summary

In an interview, SAST competence shows as *honesty plus systems thinking*. Know the three-tool taxonomy (SAST = your code, DAST = runtime, SCA = dependencies) and the bug classes SAST catches (injection, secrets, weak crypto) versus the ones it's structurally blind to (authorization, business logic, runtime). Explain findings via source → sanitizer → sink, and know why taint rules beat pattern rules on noise. Treat signal-to-noise as the make-or-break: baseline, diff-only gating, rule tuning, and justified suppression, gating only on high-severity *and* high-confidence findings. Handle secrets by rotation, not suppression. At the program level, measure escaped vulnerabilities, watch for Goodhart, and frame build-vs-buy around workflow cost. Above all, never claim SAST makes an app secure — it automates the common code-shaped bugs so humans, review, and DAST can handle the rest.

## Further Reading

- OWASP Top 10 and OWASP DevSecOps Guideline.
- Semgrep rule-writing and taint-mode docs; CodeQL query documentation.
- SARIF specification; GitHub/GitLab code-scanning guides.
- The `sql-injection-prevention`, `xss-prevention`, `secrets-management`, and `input-validation` skills.

## Related Topics

- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the engine behind findings
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA questions
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — rule authoring
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating and pipeline integration
- [Static Analysis (section overview)](../README.md)
