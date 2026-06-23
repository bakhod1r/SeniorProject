# SAST & Security Scanners — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → SAST & Security Scanners

*Running SAST as an org-wide program: metrics, SLAs, compliance, vuln-management integration, and build-vs-buy.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Operating Model of a SAST Program](#core-concept-1--the-operating-model-of-a-sast-program)
5. [Core Concept 2 — Metrics That Matter](#core-concept-2--metrics-that-matter)
6. [Core Concept 3 — SLAs and Vulnerability Management Integration](#core-concept-3--slas-and-vulnerability-management-integration)
7. [Core Concept 4 — Compliance Drivers: PCI, SOC 2, and Friends](#core-concept-4--compliance-drivers-pci-soc-2-and-friends)
8. [Core Concept 5 — Build vs Buy](#core-concept-5--build-vs-buy)
9. [Core Concept 6 — The Human-in-the-Loop Reality](#core-concept-6--the-human-in-the-loop-reality)
10. [Core Concept 7 — Rolling Out Across Many Teams](#core-concept-7--rolling-out-across-many-teams)
11. [Core Concept 8 — Failure Modes at Scale](#core-concept-8--failure-modes-at-scale)
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

> Focus: **operating SAST as a measurable, audited, organization-wide program — the metrics, SLAs, compliance posture, integrations, and economics that turn a scanner into a security control leadership can trust.**

At this tier the questions are no longer technical: *Is the program reducing risk? Can we prove it to an auditor? What does it cost versus what it catches? Who owns remediation across forty teams?* SAST stops being a tool you run and becomes a control you operate — with budgets, SLAs, dashboards, and a story you can defend to a PCI assessor and a CFO in the same week.

## Prerequisites

- Senior tier: gating policy, baselining, diff-aware scanning, triage as a system.
- You've owned a cross-team initiative and reported metrics to leadership.
- Familiarity with vulnerability management and at least one compliance framework.
- Context on CI integration ([`../09-static-analysis-in-ci/`](../09-static-analysis-in-ci/)) and dataflow depth ([`../08-taint-and-dataflow-analysis/`](../08-taint-and-dataflow-analysis/)).

## Glossary

| Term | Meaning |
|------|---------|
| **MTTR** | Mean Time To Remediate — clock from finding detected to fixed/risk-accepted. |
| **Escaped vulnerability** | A vuln that reached production despite the program (the failure metric). |
| **TPR / FPR** | True/False Positive Rate — precision of the findings. |
| **Vuln management** | The system of record tracking all findings to closure (e.g. DefectDojo, Snyk, ASPM). |
| **ASPM** | Application Security Posture Management — aggregates findings across tools. |
| **SLA** | Contractual time-to-fix by severity (e.g. critical = 7 days). |
| **PCI DSS / SOC 2** | Compliance regimes that mandate code-security review. |
| **Coverage** | Fraction of repos/services actually onboarded and scanning. |

## Core Concept 1 — The Operating Model of a SAST Program

An org-wide program has five moving parts, and the program's health is the weakest one:

| Component | Question it answers | Owner |
|-----------|---------------------|-------|
| **Coverage** | What % of repos are scanning? | AppSec / platform |
| **Gating** | What blocks deploys, where? | AppSec + eng leads |
| **Triage** | Who decides fix/FP/accept? | Dev teams + champions |
| **Remediation** | Who fixes, by when? | Owning team, SLA-bound |
| **Measurement** | Is risk going down? | AppSec, reported up |

The central design tension is **friction vs. coverage**: a strict, high-friction gate that 5 of 40 teams adopt protects less than a lighter program that all 40 run. Professionals optimize for *risk reduction across the fleet*, which usually means: broad coverage in advisory mode, hard blocking reserved for the highest-confidence/highest-severity classes (injection, secrets), and a credible remediation SLA behind everything. A scanner enabled on 100% of repos and blocking on nothing dangerous-but-noisy beats a perfect gate nobody turns on.

The second structural decision is **centralized vs. federated ownership**. Centralized — one AppSec team owns scanning, gating, and triage — gives consistency and a single throat to choke, but bottlenecks at scale; AppSec cannot triage forty teams' findings. Federated — teams own their own gating and triage with AppSec setting policy — scales but drifts without strong guardrails. The mature pattern is **centralized policy, federated execution**: AppSec owns the ruleset, the gate definitions, and the SLA matrix *as code*; teams own remediation of their own findings, supported by embedded security champions. Policy is versioned and reviewed centrally; the work happens at the edge.

## Core Concept 2 — Metrics That Matter

You cannot manage what you don't measure, and you cannot defend a program to leadership on vibes. The metrics that actually run a SAST program:

| Metric | What it tells you | Healthy direction |
|--------|-------------------|-------------------|
| **True-positive rate** | Are findings real? (trust) | High and stable |
| **MTTR by severity** | How fast do we fix? | Down, within SLA |
| **Escaped vulnerabilities** | Did real bugs reach prod anyway? | Near zero, trending down |
| **Coverage** | Are we even scanning everything? | Toward 100% |
| **Backlog age** | Is the baseline burning down? | Shrinking |
| **Findings per KLOC introduced** | Are devs writing safer code over time? | Down (the leading indicator) |

Two cautions. First, **Goodhart's law**: if you reward "findings closed," people close them as false positives. Pair any throughput metric with a quality metric (TPR, audited FP rate). Second, the metric that proves *value* is **escaped vulnerabilities** — vulns found in prod, pen-tests, or bug bounties that SAST *should* have caught. A program that drives escapes toward zero is working; a program with great dashboards and rising escapes is theater.

```text
Risk story to leadership (one line):
  "Critical MTTR down 40d→9d, coverage 62%→94%, escaped criticals 7→1 YoY."
```

A worked trap: a team proudly reports "92% of findings remediated this quarter." Drill in and 70% of those "remediations" are suppressions, half of them unjustified — real bugs swept under a `# nosemgrep`. The headline metric looked healthy while risk *increased*. This is why every program needs an **audited sample**: periodically re-review a random slice of suppressions and closed findings to compute the *true* false-positive rate, independent of what teams self-report. Trust the audited number, not the dashboard total.

## Core Concept 3 — SLAs and Vulnerability Management Integration

Findings must flow into a **system of record**, not live in CI logs and PR comments. SAST output (SARIF) feeds a vulnerability-management platform (DefectDojo, Snyk, or an ASPM tool) that deduplicates across scanners, tracks each finding to closure, and enforces SLA clocks.

A typical SLA matrix:

| Severity | Remediate or risk-accept within |
|----------|--------------------------------|
| Critical | 7 days |
| High | 30 days |
| Medium | 90 days |
| Low | best effort / next touch |

The SLA only means something if breaches escalate: an overdue critical pages the owning team's lead, then the director. Risk acceptance is a *formal* path — documented, time-boxed, and signed by someone with the authority to accept it — not a quiet suppression. Integration also handles **deduplication**: the same SQLi flagged by Semgrep and CodeQL is one finding, not two; an ASPM layer correlates them so teams aren't triaging duplicates. This vuln-management plumbing is what makes the program auditable and is the difference between "we scan" and "we manage application risk."

## Core Concept 4 — Compliance Drivers: PCI, SOC 2, and Friends

Often the budget for a SAST program comes from compliance, and a professional speaks that language fluently:

- **PCI DSS** (handling card data): Requirement 6 mandates secure development and reviewing custom code for vulnerabilities before release — SAST is the standard automated satisfier, with documented remediation of identified issues.
- **SOC 2**: under the Security trust-services criteria, you must demonstrate a vulnerability-management process. SAST + tracked remediation + SLAs is direct evidence for auditors.
- **ISO 27001 / SSDF (NIST 800-218) / FedRAMP**: similarly expect secure-SDLC controls; SAST is a recognized control. SSDF's `PW.7`/`PW.8` (review and test code) and `RV` (respond to vulnerabilities) map almost directly onto a SAST program with tracked remediation.
- **OWASP ASVS / SAMM**: maturity frameworks you map your program against to show progression — ASVS gives you a verification checklist, SAMM a maturity ladder you can report movement against quarter over quarter.

The auditor's questions are pointed and you must have artifacts ready: *Show me your scan coverage. Show me findings remediated within SLA. Show me your risk-acceptance records.* This reframes earlier-tier discipline: baselining, triage records, and SLA tracking aren't just hygiene — they are the **audit evidence** that keeps the company compliant. A program without exportable remediation records will fail an audit no matter how good its scans are.

## Core Concept 5 — Build vs Buy

A recurring professional decision. The honest framing:

| | Build (OSS: Semgrep + gitleaks + native) | Buy (Snyk, Checkmarx, Veracode, GitHub Advanced Security) |
|--|------------------------------------------|-----------------------------------------------------------|
| **Cost** | Low license, high engineering time | High license, low setup |
| **Triage workflow** | You build it (or bolt on DefectDojo) | Included, polished |
| **Rule depth** | Strong (CodeQL/Semgrep), DIY tuning | Vendor rules + support |
| **Coverage breadth** | You stitch languages together | One pane of glass |
| **Compliance reporting** | You assemble it | Often turnkey |
| **Lock-in** | Low | Higher |

The pragmatic answer is usually **hybrid**: OSS engines (Semgrep, CodeQL, gitleaks) for the scanning, a commercial or open vuln-management/ASPM layer for triage, dedup, SLA, and compliance reporting. Pure-build underestimates the cost of the *workflow* around findings — triage, dedup, reporting are 80% of the operational effort and the part vendors actually sell. Pure-buy can be cost-effective for small orgs but expensive and rule-opaque at scale. Decide on the *workflow and reporting* burden, not on scan quality alone, which OSS now matches.

Three forces push the decision beyond a spreadsheet. **Scale**: per-developer or per-repo commercial pricing that's trivial at 20 engineers becomes a six-figure line item at 500 — at which point engineering OSS tooling is cheaper than the license. **Rule transparency**: commercial scanners are often black boxes; when a finding is wrong you can't inspect or patch the rule, whereas an OSS Semgrep/CodeQL rule is readable and forkable. **Compliance reporting**: if you need turnkey PCI/SOC 2 evidence tomorrow, a vendor's reporting saves months; if you have the engineering capacity, you can assemble equivalent reports from OSS output. Map these to your org's actual constraints rather than the vendor's demo.

## Core Concept 6 — The Human-in-the-Loop Reality

The uncomfortable, essential truth a professional internalizes and communicates upward: **SAST does not fix anything, and it cannot decide what matters.** Every program is bottlenecked on *human triage and remediation capacity*. Implications:

- **Volume must match human capacity.** Tuning rules to a high TPR isn't perfectionism — it's flow control. Findings that exceed triage capacity become a backlog that decays into noise.
- **Security champions scale the humans.** You cannot have one AppSec team triage forty teams' findings. Embed and train champions; AppSec owns hard cases, tooling, and policy.
- **AI-assisted triage and autofix** (Semgrep Assistant, CodeQL autofix, vendor copilots) raise throughput but do **not** remove the human — a suggested fix still needs review, and an AI-dismissed finding still needs accountability.
- **SAST's structural blind spots remain human work.** Authorization, business-logic, and runtime flaws need code review, threat modeling, DAST, and pen-testing. The program's honest scope is "automate the common, code-shaped bugs"; the rest is people. Pair the program with the `sql-injection-prevention`, `xss-prevention`, `input-validation`, and `secrets-management` skills on the engineering side.

## Core Concept 7 — Rolling Out Across Many Teams

A fleet rollout is change management, not a config push. A staged playbook:

1. **Observe (advisory everywhere).** Turn scanning on across all repos in non-blocking mode. Measure TPR and volume; this is your tuning data and your coverage baseline.
2. **Baseline each repo.** Freeze existing findings so day-one gating only sees new code.
3. **Tune to the fleet.** Disable globally noisy rules; keep high-TPR packs. Publish the ruleset as code so it's versioned and reviewable.
4. **Block narrowly.** Enable blocking only for the highest-confidence/highest-severity classes (injection, secrets) once TPR is proven.
5. **Establish champions + SLAs.** Embed owners; wire findings into vuln management with SLA clocks.
6. **Burn down baselines.** Allocate capacity to clear high-severity legacy findings.
7. **Report and iterate.** Dashboard coverage, MTTR, escapes; expand rules on evidence.

Centralize *policy* (which rules, which gates, the SLA matrix) as code; let teams own *remediation*. A break-glass path — a documented, audited override for emergencies — is mandatory, because a hard gate with no escape hatch will be ripped out the first time it blocks a production hotfix.

## Core Concept 8 — Failure Modes at Scale

| Failure | Symptom | Cause | Fix |
|---------|---------|-------|-----|
| **Trust collapse** | Devs demand the gate be removed | Low TPR / blocking on noise | Tune ruleset; block only high-confidence |
| **Backlog amnesty** | Baseline never shrinks | No remediation capacity allotted | SLA + burndown budget |
| **Coverage gap** | Dashboard green, breach happens | Critical repos never onboarded | Coverage as a tracked metric |
| **Goodhart gaming** | "Findings closed" up, escapes up | Rewarding throughput | Pair with TPR / audited FP rate |
| **Audit failure** | Can't produce remediation records | No vuln-management system of record | Integrate ASPM/DefectDojo |
| **Override sprawl** | Break-glass used routinely | Gate too strict / too noisy | Re-tune; audit overrides |

The meta-failure is treating SAST as a *project* (turn it on, declare victory) rather than a *program* (operated, measured, and tuned forever). Security debt accrues continuously; a program that isn't maintained silently decays back to noise.

## Real-World Examples

- **Compliance-funded, value-justified.** AppSec gets PCI budget to deploy SAST. They satisfy the auditor with coverage and SLA reports — *and* drive escaped criticals from 7 to 1 year over year, converting a compliance checkbox into a defensible risk-reduction story that survives the next budget cycle.
- **The hybrid stack.** A mid-size SaaS runs Semgrep + CodeQL + gitleaks (build) feeding DefectDojo (buy-ish/open) for dedup, SLA, and SOC 2 evidence. Cheaper than a full commercial suite, with the workflow vendors charge most for.
- **The champion network.** A 40-team org couldn't scale central triage. Embedding one trained champion per team, with AppSec owning policy and hard cases, cut critical MTTR from 40 to 9 days without growing the AppSec headcount.

## Mental Models

- **Coverage × TPR × remediation capacity = risk reduced.** Any factor near zero and the product is near zero — a perfect gate on 5% of repos protects almost nothing.
- **The auditor is a user.** Design the program to *produce evidence* (coverage, SLA adherence, risk acceptances), not just findings.
- **Escaped vulns are the only honest scorecard.** Everything else can be gamed; a bug in production that SAST should have caught cannot.
- **Build the scan, buy the workflow.** Scan quality is commoditized; triage/dedup/reporting is where money and effort actually go.

## Common Mistakes

- **Optimizing the gate, not the fleet** → high friction, low coverage, low total risk reduction.
- **No system of record** → findings scattered, audits fail, dedup impossible.
- **Throughput metrics without quality metrics** → Goodhart gaming; escapes rise while dashboards look great.
- **Treating SAST as a project** → no maintenance, ruleset rots, noise returns, program dies.
- **Pure-build economics** → underestimating the triage/reporting workflow that dominates real cost.
- **No break-glass** → first production-hotfix block gets the gate removed permanently.
- **Selling SAST as full coverage** → leadership underinvests in review/DAST for the flaws SAST can't see.

## Test Yourself

1. Why can a lighter program at 95% coverage reduce more risk than a strict gate at 15%?
2. Name the metric that proves the program's *value* (not just activity), and why it resists gaming.
3. How do PCI and SOC 2 each create demand for SAST, and what artifacts must you produce for an auditor?
4. Frame the build-vs-buy decision in one sentence — what's the real cost driver?
5. Why is SAST permanently human-bottlenecked, and what two mechanisms scale the humans?
6. Give a Goodhart-style failure for a "findings closed" metric and its mitigation.
7. Why is a break-glass override mandatory for a hard SAST gate?

## Cheat Sheet

```text
PROGRAM HEALTH = coverage × TPR × remediation-capacity  (weakest factor wins)

Metrics: TPR · MTTR-by-severity · ESCAPED VULNS (value) · coverage · backlog age · findings/KLOC
  Pair throughput metrics with quality metrics (Goodhart).

SLA: Crit 7d · High 30d · Med 90d · breaches ESCALATE · risk-accept = formal+signed
Vuln mgmt: SARIF → DefectDojo/Snyk/ASPM → dedup · track-to-closure · audit evidence

Compliance: PCI Req-6 · SOC2 vuln-mgmt criteria · ISO27001 · NIST SSDF → produce remediation records

Build vs buy: build the SCAN (Semgrep/CodeQL/gitleaks), buy the WORKFLOW (triage/dedup/report)
  → hybrid is the usual answer; workflow = 80% of effort

Human-in-loop: SAST fixes nothing · tune TPR = flow control · champions scale · AI assists ≠ replaces
Rollout: advisory-everywhere → baseline → tune → block-narrow → champions+SLA → burndown → report
Mandatory: break-glass (audited) · coverage-as-metric · system of record
SAST blind to: authz · business logic · runtime → review + DAST + threat model
```

## Summary

At the professional tier, SAST is a measured, audited, organization-wide *program*, not a scanner. Its health is the product of **coverage × true-positive rate × remediation capacity** — so broad coverage in mostly-advisory mode, with hard blocking reserved for the highest-confidence classes, usually reduces more total risk than a strict gate few teams adopt. Run it on metrics that matter — MTTR by severity, coverage, and above all **escaped vulnerabilities**, the one scorecard that resists gaming — while pairing any throughput metric with a quality metric to dodge Goodhart. Feed findings into a vulnerability-management system of record with SLA clocks and formal risk acceptance; that plumbing is also your **compliance evidence** for PCI, SOC 2, and the rest. Decide build-vs-buy on the *workflow and reporting* burden, not scan quality (build the scan, buy the workflow). And never lose the honest framing: SAST is permanently human-bottlenecked, scaled by champions and SLAs, and structurally blind to authorization, business-logic, and runtime flaws — which remain the work of code review, DAST, and threat modeling.

## Further Reading

- PCI DSS Requirement 6; SOC 2 / Trust Services Criteria; NIST SP 800-218 (SSDF).
- OWASP SAMM and ASVS for maturity self-assessment.
- DefectDojo / ASPM documentation for vuln-management integration.
- Vendor docs: Snyk Code, GitHub Advanced Security, Checkmarx, Veracode (for build-vs-buy comparison).
- The `secrets-management`, `sql-injection-prevention`, `xss-prevention`, and `input-validation` skills.

## Related Topics

- [Static Analysis in CI](../09-static-analysis-in-ci/) — pipeline mechanics behind the program
- [Dependency & License Scanning](../06-dependency-and-license-scanning/) — SCA, the other half of AppSec scanning
- [Taint & Dataflow Analysis](../08-taint-and-dataflow-analysis/) — the precision engine
- [Custom Lint Rules & AST](../07-custom-lint-rules-and-ast/) — org-specific rule authoring
- [Static Analysis (section overview)](../README.md)
