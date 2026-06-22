# Dependency & License Scanning — Professional Level

> **Roadmap:** [Static Analysis](../README.md) → Dependency & License Scanning

*At the org level, dependency risk is a governed program with budgets, SLAs, exceptions, metrics, and a legal partner — not a tool someone runs.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The org policy: severities, SLAs, and the exception process](#core-concept-1--the-org-policy-severities-slas-and-the-exception-process)
5. [Core Concept 2 — Policy-as-code and a single enforcement plane](#core-concept-2--policy-as-code-and-a-single-enforcement-plane)
6. [Core Concept 3 — The "affected, and where, in minutes" capability](#core-concept-3--the-affected-and-where-in-minutes-capability)
7. [Core Concept 4 — Risk-based prioritization at fleet scale](#core-concept-4--risk-based-prioritization-at-fleet-scale)
8. [Core Concept 5 — License governance as enterprise legal risk](#core-concept-5--license-governance-as-enterprise-legal-risk)
9. [Core Concept 6 — Metrics, SLOs, and the program scorecard](#core-concept-6--metrics-slos-and-the-program-scorecard)
10. [Core Concept 7 — The treadmill, vendoring, and registry strategy at scale](#core-concept-7--the-treadmill-vendoring-and-registry-strategy-at-scale)
11. [Core Concept 8 — Standards, audits, and the compliance overlay](#core-concept-8--standards-audits-and-the-compliance-overlay)
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

> Focus: **running dependency & license risk as a governed organizational program — policy, SLAs, exceptions, single enforcement plane, fleet-wide "affected-and-where," metrics/SLOs, legal governance, and audit/compliance.**

The professional tier is no longer about any one repo or scanner. You're accountable for dependency risk across hundreds of services, multiple languages, dozens of teams, regulators, customers' security questionnaires, and an acquirer's due-diligence team. The question shifts from "is this finding exploitable?" to "**can we prove, to an auditor and to ourselves, that dependency risk is under control, and that we can respond to the next Log4Shell in hours?**"

That requires turning the senior-tier instincts into durable institutions: written policy with teeth, automated enforcement, fleet-wide inventory, a metrics program executives trust, and a working relationship with legal. The failure mode here isn't a missed CVE in one service — it's a *program* that looks busy (thousands of scans, big dashboards) but can't answer the basic questions when it matters.

---

## Prerequisites

- Strong senior grasp: prioritization (reachability/EPSS/KEV), gating, the treadmill, SBOMs.
- Experience owning a cross-team initiative and reporting to leadership.
- Familiarity with at least one compliance regime (SOC 2, ISO 27001, FedRAMP, PCI) and security questionnaires.
- Working relationship with, or understanding of, legal/open-source-compliance functions.
- Deep cross-ref: [Supply-Chain Security](../../release-engineering/09-supply-chain-security/), [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Remediation SLA** | Contractual/internal deadline to fix by severity tier. |
| **Exception (waiver)** | Documented, time-boxed, approved acceptance of a known risk. |
| **MTTR** | Mean Time To Remediate — disclosure → fix deployed. |
| **SLO** | Service-Level Objective — the target the program holds itself to (e.g. 95% of criticals patched within SLA). |
| **Policy-as-code** | Machine-enforced policy (OPA/Conftest, vendor policy engines). |
| **Single enforcement plane** | One place policy is defined and applied across all repos/registries. |
| **OSPO** | Open Source Program Office — the org function owning open-source use, compliance, and contribution. |
| **VEX** | Vulnerability Exploitability eXchange — a statement that a product is/isn't affected by a CVE (and why). |
| **SSDF** | NIST Secure Software Development Framework (SP 800-218). |

---

## Core Concept 1 — The org policy: severities, SLAs, and the exception process

The professional artifact is a **written, ratified policy** that everyone — engineers, security, legal, auditors — can point to. Three pillars:

**1. What blocks, by stage.**

| Finding | PR (new) | Release | Notes |
|---------|----------|---------|-------|
| Critical or KEV | Block | Block | KEV overrides CVSS. |
| High, reachable, internet-facing | Block | Block | Reachability + exposure gated. |
| High, other | Warn | Block at SLA breach | |
| Medium / Low | Warn | — | Batched into routine updates. |
| Forbidden license | Block | Block | No override without legal waiver. |

**2. Remediation SLAs.**

| Severity | Remediate within |
|----------|------------------|
| Critical / KEV | 7 days (1–2 days if actively exploited + reachable) |
| High | 30 days |
| Medium | 90 days |
| Low | Best effort / next routine cycle |

SLAs must be *measurable and owned*: each finding maps to a service with an owner and a due date; the clock starts at disclosure, not discovery.

**3. The exception process — the part juniors forget and auditors scrutinize.** A finding with no available fix, or a deliberate accepted risk, must go through a *documented, time-boxed, approved* waiver:

```yaml
# exceptions/CVE-2023-1234.yaml  (reviewed in PR, expires automatically)
cve: CVE-2023-1234
package: example-lib@4.2.0
services: [billing-api]
justification: >
  Vulnerable symbol (parseLegacyXml) is not reachable; confirmed via
  govulncheck (no trace). No fixed version available upstream.
mitigations: [WAF rule WID-882 blocks the input vector]
approved_by: jane.doe (AppSec)
created: 2026-06-22
expires: 2026-09-22          # auto-reopens; no permanent waivers
```

The rule that keeps the program honest: **no permanent exceptions.** Every waiver expires and must be re-justified. A backlog of expired, never-reviewed waivers is how "accepted risk" silently becomes "breach."

---

## Core Concept 2 — Policy-as-code and a single enforcement plane

At org scale, policy enforced by human reviewers drifts: 200 repos, 200 interpretations. The professional move is **policy-as-code** applied at a **single enforcement plane** so the rule is defined once and applied everywhere.

A vendor-neutral example with OPA/Conftest evaluating an SBOM/scan result:

```rego
# policy/dependency.rego
package dependency

deny[msg] {
  v := input.vulnerabilities[_]
  v.severity == "CRITICAL"
  not exception_exists(v.id)
  msg := sprintf("CRITICAL %s in %s has no active exception", [v.id, v.package])
}

deny[msg] {
  c := input.components[_]
  forbidden := {"GPL-3.0", "AGPL-3.0", "SSPL-1.0"}
  forbidden[c.license]
  msg := sprintf("Forbidden license %s in %s", [c.license, c.name])
}
```

```bash
$ conftest test sbom.cdx.json --policy policy/
FAIL - sbom.cdx.json - dependency - Forbidden license AGPL-3.0 in fancy-lib
2 tests, 1 passed, 1 failure
```

Where the plane lives matters more than the syntax:

- **CI gate** — fast feedback on the PR diff (cross-ref [Static Analysis in CI](../09-static-analysis-in-ci/)).
- **Internal registry/proxy** (Artifactory/Nexus) — block forbidden/known-bad packages *at install time*, org-wide, so a bad version can't enter any build.
- **Admission control / release gate** — refuse to promote an artifact whose SBOM violates policy (cross-ref [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/)).

Defense in depth: the same policy, enforced at PR, at the registry, and at release. Change it in one repo; it propagates everywhere. (Secrets that scanners and registries need — registry tokens, API keys — belong in your secret manager, per the **secrets-management** discipline, never inline in pipeline config.)

---

## Core Concept 3 — The "affected, and where, in minutes" capability

The single most important professional deliverable. When a critical drops, leadership and customers ask one thing: *"Are we affected, and where?"* The mature answer is **minutes**, and it rests on infrastructure built in peacetime:

- **An SBOM for every artifact**, generated at build, **signed** and attached to the release (cross-ref [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) and [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/)).
- **A central, queryable inventory** of all SBOMs keyed by service, version, environment, and owner.
- **A standing query/runbook** that turns a CVE/component into a list of affected, deployed services with owners — in one query.

```bash
# "Which deployed services contain log4j-core < 2.16?"  (against the SBOM store)
$ sbom-query --component log4j-core --version-lt 2.16.0 --env prod
SERVICE          VERSION   ENV    OWNER          EXPOSURE
billing-api      2.14.1    prod   team-payments  internet
search-indexer   2.15.0    prod   team-search    internal
(2 services affected)
```

Add **VEX** to the picture: a VEX document lets you publish, per product, *"we ship component X but are not affected by CVE-Y because the vulnerable code is unreachable"* — so you (and your customers) can suppress noise with an auditable justification rather than a spreadsheet.

The professional reframing: you are not buying the answer to *this* CVE. You are building the *capability* to answer *any* future CVE in minutes — the difference, during the next Log4Shell, between a controlled response and a multi-day all-hands scramble.

---

## Core Concept 4 — Risk-based prioritization at fleet scale

The senior axes (severity x reachability x EPSS x KEV x exposure) scale to thousands of findings only when **automated and enriched centrally**. The professional pipeline:

1. **Ingest** scanner output from every service into one risk store.
2. **Enrich** each finding: join EPSS (probability), KEV (proven exploitation), reachability (where available), and *business context* (is the service internet-facing? does it handle PCI/PII? what's its blast radius?).
3. **Score and rank** into a single org-wide queue. The highest-business-risk findings rise regardless of which team owns them.
4. **Route** to owners with SLA clocks and auto-filed tickets.

A defensible scoring sketch:

```
risk = base(CVSS)
       × (KEV ? 3.0 : 1.0)              # proven exploitation dominates
       × (EPSS_percentile)             # probability re-ranks the rest
       × (reachable ? 1.0 : 0.2)       # unreachable strongly deprioritized
       × exposure_factor               # internet/PII/PCI multiplier
```

The win: a security team of five can defensibly steer remediation across 300 services by working *the top of one ranked queue*, instead of every team independently arguing CVSS. And you can *prove* the logic to an auditor — risk decisions are reproducible, not vibes.

---

## Core Concept 5 — License governance as enterprise legal risk

At enterprise scale, license compliance is a **legal and business** function, typically owned by an **OSPO** in partnership with legal:

- **Policy with legal sign-off**, encoding *use models*: permissive (allow), weak copyleft/LGPL dynamically linked (conditional), strong copyleft GPL/**AGPL**/SSPL (deny), unknown (deny). The nuance — dynamic vs static linking, SaaS network interaction — has real legal weight and must be decided with counsel, not by engineers guessing.
- **The AGPL/SaaS trap, institutionalized.** AGPL's network-use clause can obligate disclosure of your entire service's source. Deny by default; the *only* path to use is a legal-approved, documented waiver.
- **Deep detection, not just declared metadata.** Enterprise tools (FOSSA, Black Duck, ScanCode) scan file contents for embedded/relicensed code — catching the "declared MIT, bundled GPL" case that metadata-only checks miss.
- **Relicensing alerts.** Major projects have moved to SSPL/BSL/"Commons Clause"; your program must alert when a dependency *changes* license between versions, not just check the current one.
- **Attribution generation in the build.** Automated `NOTICE`/third-party-license bundling so every release ships compliant attribution without a manual scramble.
- **M&A and customer due diligence.** Acquirers and enterprise customers run their own license scans. A governed, clean dependency tree is a *valuation asset*; a GPL-tainted core is a deal-breaker or a forced re-write. Your SBOM + license report *is* the artifact they'll ask for.

---

## Core Concept 6 — Metrics, SLOs, and the program scorecard

You can't run a program you can't measure, and leadership funds what it can see. The professional scorecard tracks **outcomes**, not activity (number of scans is vanity).

| Metric | What it tells you | Target (SLO example) |
|--------|-------------------|----------------------|
| **MTTR (critical)** | Speed of response | < 7 days median |
| **% criticals within SLA** | Process reliability | ≥ 95% |
| **Open criticals / KEV count** | Current exposure | Trending to 0 |
| **% dependencies current** (within N versions) | Future patch-ability | ≥ 80% |
| **Median dependency age** | Treadmill health / drift | < 30 days |
| **Open exceptions / expired exceptions** | Risk-acceptance hygiene | Expired = 0 |
| **Mean time to "affected-and-where"** | Incident readiness | Minutes |
| **License violations in main** | Legal exposure | 0 |

Two SLO traps to call out:

- **Goodhart's law:** if "open criticals" is the only metric, teams will reclassify or suppress to hit zero. Pair exposure metrics with *MTTR* and *exception hygiene* so gaming one surfaces in another. (Cross-ref engineering-metrics on Goodhart.)
- **Activity vs outcome:** "10,000 scans run" is noise. "95% of criticals patched within SLA and we can locate any component in 2 minutes" is the program working.

---

## Core Concept 7 — The treadmill, vendoring, and registry strategy at scale

Operationalizing currency across the fleet:

- **Auto-merge the safe tier fleet-wide** via a centrally-managed Renovate/Dependabot preset; safe patch/minor with green CI merges without humans. This is only sound on top of trustworthy test suites — the **test-coverage dependency**, now an org-level investment.
- **Currency as a security SLO.** Median dependency age is a *leading* indicator of incident readiness: a fleet two weeks behind absorbs the next emergency in hours; a year behind faces breaking-change archaeology mid-incident.
- **The gating internal registry** is the backbone: caches against upstream outages, survives package takedowns, and enforces "no package version with an active critical/KEV" at install time across every build.
- **Vendoring** for high-assurance/air-gapped/regulated builds, where shipping and reviewing exact source matters and offline reproducibility is required.
- **Budget it.** A standing allocation (rotating dependency duty / a fraction of every sprint), not a heroic quarterly purge that never happens.

The strategic statement to leadership: *currency, registry control, and SBOM inventory together are what let us respond to the next supply-chain crisis in hours instead of weeks.*

---

## Core Concept 8 — Standards, audits, and the compliance overlay

Dependency & license scanning is increasingly a *requirement*, not a nicety:

- **NIST SSDF (SP 800-218)** and the U.S. Executive Order on supply-chain security expect SBOMs and known-vuln management for software sold to the government.
- **SOC 2 / ISO 27001** auditors ask for evidence: your policy, your scan results, your remediation SLAs and MTTR, your exception register. The program *is* the evidence.
- **Customer security questionnaires** routinely ask "do you scan dependencies, and how fast do you patch criticals?" — your scorecard answers them.
- **VEX + signed SBOMs** let you make verifiable, machine-readable claims to customers about what you ship and what you're (not) affected by.

The professional sees compliance not as overhead but as the same controls, *documented*. If your program produces SBOMs, enforces policy-as-code, tracks MTTR, and governs exceptions, the audit is mostly exporting what you already have. (Cross-ref [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) for SBOM/SLSA framing.)

---

## Real-World Examples

**Log4Shell as the program's exam.** Organizations with a signed-SBOM inventory queried the affected-services list (with owners and exposure) within the hour, opened an incident, and drove remediation against the CISA KEV deadline (2021-12-24) — tracking % patched within SLA on a live dashboard. Organizations without it manually inventoried for days. CVE-2021-44228 hit EPSS ~0.94 and entered KEV immediately: the policy correctly said "critical, patch now, regardless of reachability nuance." The post-incident retro for the unprepared became the business case for building the inventory — i.e., for the entire professional program.

**The expired-exception breach.** A team waived a "no fix available" critical with a permanent exception. Months later a fix shipped, the waiver was never revisited, the unreachable assumption stopped holding after a refactor, and the now-reachable vuln was exploited. The program lesson, encoded everywhere after: **exceptions expire and auto-reopen.**

**Due-diligence rescue.** Before an acquisition, the acquirer's lawyers ran a deep license scan. Because the target's OSPO had been generating a governed SBOM + license report all along (no AGPL, attribution bundled), diligence took days, not months, and didn't dent the valuation. The dependency program was, literally, an asset on the balance sheet.

---

## Mental Models

- **"The program is the evidence."** A real program *is* the audit answer, the customer-questionnaire answer, and the incident-response capability — same controls, documented.
- **"Buy the capability, not the answer."** Invest in inventory + policy-as-code + metrics so *any* future CVE is minutes, not days.
- **"No permanent exceptions."** Every accepted risk expires and re-justifies, or it rots into a breach.
- **"Currency is a security SLO."** Dependency age predicts how fast you survive the next crisis.
- **"Outcomes over activity; pair metrics to beat Goodhart."** Patch-within-SLA + MTTR + exception hygiene, not scan counts.

---

## Common Mistakes

- **No exception process, or permanent waivers.** Either drives engineers to bypass the gate, or lets accepted risk silently become real risk.
- **Policy in people's heads, not as code.** 200 repos drift to 200 interpretations; nothing is provably enforced.
- **No fleet-wide SBOM inventory.** "Are we affected?" is a multi-day scramble exactly when speed matters.
- **Vanity metrics.** Counting scans/findings instead of MTTR, % current, and time-to-affected-and-where.
- **Gaming a single exposure metric** (Goodhart) — reclassifying criticals to hit "zero open."
- **License policy without legal** — engineers guessing on AGPL/linking obligations; or a blunt "ban all copyleft" that's legally over- or under-inclusive.
- **Treating compliance as separate from engineering** — rebuilding evidence by hand at audit time instead of exporting the running program.

---

## Test Yourself

1. Write the three pillars of an org dependency policy, and explain why the exception process is the part auditors scrutinize most.
2. Why "no permanent exceptions"? Give the failure mode of a stale waiver.
3. Where do you enforce policy-as-code, and why at multiple planes (CI + registry + release)?
4. Describe the infrastructure that makes "affected, and where, in minutes" possible, and where VEX fits.
5. Sketch a fleet-scale risk-scoring formula and justify why KEV and reachability are weighted as they are.
6. Which metrics prove the program works, and how do you guard them against Goodhart's law?
7. Why is license governance owned with legal/OSPO, and how does a clean SBOM affect M&A?
8. How does a mature SCA program make a SOC 2 / SSDF audit mostly an export job?

---

## Cheat Sheet

```bash
# Policy-as-code over an SBOM/scan result
conftest test sbom.cdx.json --policy policy/        # OPA/Rego deny rules

# Affected-and-where (central SBOM store)
sbom-query --component log4j-core --version-lt 2.16.0 --env prod
# Publish VEX: "we ship X, not affected by CVE-Y, here's why"

# Enforce at multiple planes:
#   PR gate (dependency-review) + internal registry (block at install) + release gate
```

| Pillar | Professional standard |
|--------|----------------------|
| Policy | Written, ratified; block/SLA/exception defined per severity & stage |
| Exceptions | Time-boxed, approved, auto-expiring; zero permanent waivers |
| Enforcement | Policy-as-code at CI + registry + release |
| Inventory | Signed SBOM per artifact, central queryable store, VEX |
| Prioritization | Central enrich (EPSS+KEV+reachability+business context) → one queue |
| License | OSPO + legal; deny AGPL/SSPL by default; attribution automated |
| Metrics | MTTR, % within SLA, % current, dep age, exception hygiene, time-to-affected |

---

## Summary

- Run dependency & license risk as a **governed program**: a written policy of **block rules, remediation SLAs, and a time-boxed exception process** (no permanent waivers).
- Enforce with **policy-as-code at a single plane**, applied defense-in-depth across **CI, the internal registry, and the release gate**.
- Build the **"affected, and where, in minutes"** capability on a **signed-SBOM central inventory** plus **VEX** — the deliverable is the *capability*, not any single fix.
- **Prioritize at fleet scale** by enriching every finding centrally (EPSS + KEV + reachability + business context) into one ranked, auditable queue.
- **License governance is enterprise legal risk** (AGPL/SaaS, relicensing, deep detection, M&A), owned by an **OSPO with legal**.
- **Measure outcomes** (MTTR, % within SLA, % current, dependency age, exception hygiene); pair metrics to defeat **Goodhart**. **Currency is a security SLO.**
- A mature program *is* the **audit/compliance** evidence (SSDF, SOC 2) and the customer-questionnaire answer — same controls, documented.

---

## Further Reading

- NIST SSDF (SP 800-218); U.S. EO 14028 on supply-chain security
- CISA KEV catalog & BOD 22-01; FIRST.org EPSS
- CycloneDX VEX and SBOM specifications; SPDX
- OPA / Conftest policy-as-code; Sigstore (signed SBOMs/attestations)
- TODO Group OSPO guides; FOSSA / Black Duck / ScanCode on enterprise license governance
- DORA / engineering-metrics literature on outcome metrics and Goodhart's law

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — first-party risk, governed the same way
- [Static Analysis in CI](../09-static-analysis-in-ci/) — policy-as-code and gating mechanics
- [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOM inventory, SLSA, the "where" backbone
- [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/) — signed SBOMs/attestations, release gating
- Interview tier: the question bank across all of the above
