# Dependency & License Scanning — Senior Level

> **Roadmap:** [Static Analysis](../README.md) → Dependency & License Scanning

*Anyone can run a scanner. A senior turns 800 findings into a ranked queue of the ten that matter, and keeps a thousand dependencies current without the team noticing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Designing an SCA program, not running a tool](#core-concept-1--designing-an-sca-program-not-running-a-tool)
5. [Core Concept 2 — Prioritization: severity x reachability x exploitability](#core-concept-2--prioritization-severity-x-reachability-x-exploitability)
6. [Core Concept 3 — EPSS and CISA KEV: probability and proof](#core-concept-3--epss-and-cisa-kev-probability-and-proof)
7. [Core Concept 4 — PR-gating without strangling the team](#core-concept-4--pr-gating-without-strangling-the-team)
8. [Core Concept 5 — Managing the update treadmill at scale](#core-concept-5--managing-the-update-treadmill-at-scale)
9. [Core Concept 6 — Vendoring vs proxy vs direct](#core-concept-6--vendoring-vs-proxy-vs-direct)
10. [Core Concept 7 — License governance as risk management](#core-concept-7--license-governance-as-risk-management)
11. [Core Concept 8 — The "are we affected, and where" capability](#core-concept-8--the-are-we-affected-and-where-capability)
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

> Focus: **building an SCA program — prioritization (reachability + EPSS + KEV), sane gating, the treadmill at scale, vendoring strategy, license governance, and the "affected-and-where" capability.**

At the middle tier you learned to triage one repo. At the senior tier you own the *system*: dozens or hundreds of services, multiple ecosystems, a security team that wants zero criticals, and product teams that don't want to spend their sprints on dependency PRs. Both can't fully win; your job is to design the program that keeps real risk low while keeping engineering velocity high.

The core senior insight: **SCA is a prioritization problem, not a detection problem.** Detection is solved — tools find everything. The hard part is deciding, out of hundreds of findings, which ten you fix this week and which you defensibly defer. Get that wrong and you either burn the team out or get breached on something you'd flagged and ignored.

---

## Prerequisites

- Solid middle-tier grasp: reachability, transitive fixes, license policy, auto-update bots.
- You've operated a service in production and felt an incident.
- Familiarity with CVSS, and ideally exposure to EPSS / CISA KEV.
- You understand CI gating, branch protection, and why a flaky gate gets disabled.
- Cross-ref: [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) for SBOMs.

---

## Glossary

| Term | Meaning |
|------|---------|
| **SCA program** | The org-wide system of policy, tooling, gating, SLAs, and metrics around dependency risk. |
| **EPSS** | Exploit Prediction Scoring System — probability (0–1) a CVE is exploited in the next 30 days. |
| **KEV** | CISA's Known Exploited Vulnerabilities catalog — CVEs confirmed exploited in the wild. |
| **SLA** | Service-level agreement — e.g. "patch criticals within 7 days." |
| **MTTR** | Mean Time To Remediate — average time from disclosure to fix deployed. |
| **SBOM** | Software Bill of Materials — machine-readable inventory of every component you ship. |
| **Vendoring** | Committing dependency *source* into your repo. |
| **Proxy / mirror** | An internal registry caching/gating external packages (Artifactory, Nexus). |
| **Reachability** | Whether vulnerable code is callable from your app. |
| **Exception / waiver** | A documented, time-boxed decision to accept a known risk. |

---

## Core Concept 1 — Designing an SCA program, not running a tool

A junior runs `osv-scanner`. A senior designs a *program* with these moving parts:

1. **Inventory** — you cannot secure what you can't enumerate. Every service, every ecosystem, an SBOM per artifact. (Cross-ref [Supply-Chain Security](../../release-engineering/09-supply-chain-security/).)
2. **Policy** — written, agreed: which severities block a merge, which block a release, the SLA to remediate each tier, and how exceptions work.
3. **Tooling** — a primary scanner per ecosystem, ideally reachability-aware, plus a license checker, plus update bots. Centralized results, not 50 separate dashboards.
4. **Gating** — where in the SDLC you enforce (PR? release? runtime?), and the failure mode (block vs warn).
5. **Remediation flow** — who owns a finding, how it becomes a ticket, the SLA clock.
6. **Metrics** — MTTR, % of deps current, open criticals over time, exception count and age.

A starter policy table:

| Severity | Block PR? | SLA to remediate | Notes |
|----------|-----------|------------------|-------|
| Critical (and KEV) | Yes (new), warn (existing) | **7 days** | KEV overrides CVSS. |
| High | Warn | 30 days | Block if reachable + internet-facing. |
| Medium | Warn | 90 days | Batch into update PRs. |
| Low | No | Best effort | Sweep during normal upgrades. |
| Forbidden license | **Yes** | Immediate | No merge. |

The point of writing it down: it removes per-finding arguments and gives engineers a defensible "we are following policy" answer to auditors and to a 2 a.m. pager.

---

## Core Concept 2 — Prioritization: severity x reachability x exploitability

CVSS alone is a terrible queue order — it's a static property of the vuln, not of *your* risk. A senior prioritizes on **three axes**:

```
priority ≈ severity (CVSS)  ×  reachability  ×  exploitability (EPSS/KEV)
                                ×  exposure (internet-facing? attacker-controlled input?)
```

Worked example — same CVSS, very different priority:

| Finding | CVSS | Reachable? | EPSS | KEV? | Internet-facing? | Real priority |
|---------|------|-----------|------|------|------------------|---------------|
| A | 9.8 | No (symbol not called) | 0.02 | No | n/a | **Low** — defer |
| B | 7.5 | Yes (hot path) | 0.78 | **Yes** | Yes | **Drop everything** |
| C | 9.1 | Yes | 0.01 | No | Internal only | Medium |
| D | 5.3 | No | 0.40 | No | Yes | Low |

Finding **B** — a *lower* CVSS than A and C — is the emergency, because it's reachable, actively exploited (KEV), likely to be exploited (high EPSS), and reachable from the internet. A team that sorted by CVSS would fix A and C first and leave B burning. This is the single most valuable reframe a senior brings: **stop sorting by CVSS; sort by real risk.**

Operationalize it: pipe scanner output through a script that joins each CVE with its EPSS score and KEV membership, then sorts. Most mature platforms (Snyk, GitHub, Endor) now surface EPSS/KEV inline.

---

## Core Concept 3 — EPSS and CISA KEV: probability and proof

Two data sources turn "how bad in theory" into "how likely / proven in practice":

**EPSS (Exploit Prediction Scoring System)** — a FIRST.org model that outputs, for each CVE, the **probability it will be exploited in the next 30 days** (0.0–1.0). It's trained on real-world exploitation telemetry. Most CVEs score very low (< 0.01); a handful spike high. EPSS is how you justify *deprioritizing* a scary-looking CVSS 9 that nobody is actually exploiting.

```bash
# Pull EPSS for a CVE from the FIRST API
$ curl -s "https://api.first.org/data/v1/epss?cve=CVE-2021-44228" | jq '.data[0]'
{
  "cve": "CVE-2021-44228",
  "epss": "0.94400",        # 94% chance of exploitation in 30 days
  "percentile": "0.99988"   # higher than 99.99% of all CVEs
}
```

**CISA KEV (Known Exploited Vulnerabilities)** — a free, authoritative catalog of CVEs **confirmed exploited in the wild**. This is not a prediction; it's proof. KEV membership should **override CVSS** in your policy: any KEV finding is treated as critical, full stop. U.S. federal agencies are *legally required* to patch KEV entries on a deadline — a good bar for anyone.

```bash
# Is a CVE in KEV?
$ curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json \
  | jq '.vulnerabilities[] | select(.cveID=="CVE-2021-44228") | {cveID, dueDate}'
{ "cveID": "CVE-2021-44228", "dueDate": "2021-12-24" }
```

Decision rule a senior bakes into policy:

```
if CVE in KEV:                  → critical, patch within SLA, no debate
elif reachable and EPSS > 0.5:  → high priority
elif reachable:                 → normal queue
else (not reachable):           → low / batch with routine updates
```

---

## Core Concept 4 — PR-gating without strangling the team

The naive gate — "fail CI on any vuln" — gets disabled within a month, because a *transitive* CVE with no available fix shouldn't block an unrelated feature PR. A senior designs a gate that's strict on what the developer *introduced* and lenient on the ambient noise.

Principles:

- **Gate on the diff, not the world.** Block the PR only if it *adds* a new vulnerable/forbidden dependency. Pre-existing findings go to a backlog with an SLA — they don't block unrelated work. (`osv-scanner`'s and Snyk's "only new issues" modes; GitHub's dependency-review action does exactly this.)
- **Hard-fail on forbidden licenses and new criticals/KEV; warn on the rest.**
- **Make the gate fast and deterministic** — a slow or flaky security gate trains people to retry-until-green or bypass.
- **Provide the fix in the failure message** (the patched version, the override snippet). A gate that only says "no" is sabotage.

GitHub `dependency-review-action` (gates the PR diff):

```yaml
# .github/workflows/dep-review.yml
name: Dependency Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: critical          # block only new criticals
          deny-licenses: GPL-3.0, AGPL-3.0     # block forbidden licenses
          comment-summary-in-pr: always
```

`osv-scanner` "new vulns only" in CI:

```bash
# Compare PR branch against base; non-zero exit only on NEW findings
$ osv-scanner scan source --recursive . --diff-base origin/main
```

Pair this with **scheduled full-tree scans** (nightly/weekly) that feed the backlog and trip the SLA clock — so existing issues still get attention without blocking every PR.

---

## Core Concept 5 — Managing the update treadmill at scale

One repo with Renovate is easy. Two hundred repos is an operational discipline.

- **Auto-merge the safe tier.** Patch/minor bumps that pass full CI should auto-merge with no human. This is where strong test coverage pays for itself; it's the only way the volume is survivable.
- **Group and schedule.** Batch dev-dependency and minor bumps into grouped weekly PRs; isolate majors for human review. Cap concurrent PRs so the bot doesn't bury teams.
- **Centralize config.** A shared Renovate preset (`config:base` + org overrides) so 200 repos behave consistently and you change policy in one place.
- **Track dependency age, not just vuln count.** Median/95p dependency lag is a leading indicator: rising age means a future painful jump and slower emergency patching. Keep it low and the *next* Log4Shell is a one-line bump.
- **Budget the treadmill.** Make routine updates a standing, small allocation (e.g. a rotating "dependency duty"), not a heroic quarterly purge.

The strategic payoff: **currency is a security control.** A fleet that's never more than two weeks behind can absorb an emergency CVE in hours, because the upgrade path is short and well-tested. A fleet that's a year behind faces breaking-change archaeology *during* the incident.

---

## Core Concept 6 — Vendoring vs proxy vs direct

How packages reach your build is a security and reliability decision:

| Approach | What it is | Pros | Cons |
|----------|-----------|------|------|
| **Direct** | Pull from public registry at build | Simple | Registry outage breaks builds; no gate; left-pad risk. |
| **Vendoring** | Commit dependency *source* into the repo (`go mod vendor`, `npm`'s bundled deps) | Reproducible, auditable in PRs, offline builds, you scan exactly what ships | Big repos, manual update churn, easy to drift. |
| **Internal proxy/mirror** | Artifactory/Nexus/GitHub Packages caches and **gates** external packages | Central policy chokepoint, caching, can block known-bad versions org-wide, survives upstream takedowns | Infra to run; can become a bottleneck. |

Senior guidance: at scale, an **internal proxy is usually the right backbone** — it's a single point where you can enforce "no package with a critical KEV," cache against upstream outages, and get a fleet-wide view of what's pulled. **Vendoring** shines for high-assurance / air-gapped builds and for making dependency changes reviewable in the same PR as the code (Go vendoring is excellent here). Pure **direct** is fine for small teams but leaves you exposed to upstream availability and supply-chain attacks at install time.

---

## Core Concept 7 — License governance as risk management

At the senior level, license scanning is **legal risk management**, owned jointly with legal:

- **Codify the policy as code** so it's enforced uniformly, not per-reviewer judgment (see [Static Analysis in CI](../09-static-analysis-in-ci/) and policy-as-code generally).
- **Distinguish use models.** GPL via dynamic linking vs static linking vs SaaS-network-interaction (AGPL) have *different* obligations. A blanket "ban all copyleft" is sometimes too blunt; LGPL dynamically linked may be acceptable. Encode the nuance with legal's sign-off.
- **The AGPL/SaaS trap remains the headline risk.** One AGPL package in a backend can obligate you to release your whole service's source. Deny by default; require legal review for any exception.
- **Generate and ship attribution.** Permissive licenses (MIT, BSD, Apache) require preserving copyright/notice. Automate `NOTICE` generation in the build so compliance isn't a manual scramble before a release.
- **Watch for relicensing and dual licenses.** Packages change licenses across versions (several high-profile moves to SSPL/BSL). Your scan should alert when a dependency's license *changes*, not just check the current one.
- **M&A reality:** acquisition due diligence *will* run a deep license scan (FOSSA/ScanCode). A clean, governed dependency set is a tangible asset; a GPL-tainted codebase is a deal risk.

---

## Core Concept 8 — The "are we affected, and where" capability

The defining test of a mature program: when a new critical drops at 9 a.m., **how fast can you answer "are we affected, and exactly where?"** The answer should be *minutes*, and it depends on infrastructure you build *before* the incident:

- **An SBOM per artifact**, stored centrally and queryable. (Generate at build, attach to the release — see [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) and [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/).)
- **A query interface** over all SBOMs: "which deployed services contain `log4j-core` at version < 2.15?" returns a list of services, versions, and owners in seconds.

```bash
# Query a stored SBOM (CycloneDX) for an affected component
$ cat service-x.cdx.json | jq -r '
  .components[] | select(.name=="log4j-core") | "\(.name)@\(.version)"'
log4j-core@2.14.1     # ← this service is affected

# Across a fleet of stored SBOMs:
$ grype sbom:./sboms/ --only-fixed | grep CVE-2021-44228
```

Without this, "are we affected?" means SSHing into boxes and grepping under deadline — the exact scramble Log4Shell exposed across the industry. The senior deliverable isn't the answer to one CVE; it's the *capability* to answer any future CVE in minutes. That capability is the bridge between static dependency scanning and supply-chain security at large.

---

## Real-World Examples

**Log4Shell as a program test.** Mature orgs queried their SBOM inventory and had the list of affected services — with owners — within the hour, then drove patches against a KEV-deadline SLA (CISA set 2021-12-24). Immature orgs spent days manually inventorying. The difference wasn't the fix (a version bump); it was the *pre-built capability to find affected systems*. EPSS for CVE-2021-44228 hit ~0.94 and it entered KEV almost immediately — a textbook "drop everything regardless of reachability nuance" case.

**Sorting by CVSS, missing the KEV.** A team with a "fix all CVSS ≥ 9" policy spent a sprint on high-CVSS-but-unexploited findings while a CVSS 7.5 *KEV-listed, reachable, internet-facing* vuln sat in the backlog and was exploited. The lesson encoded afterward: **KEV overrides CVSS in the queue.**

**The proxy that paid off.** During an upstream registry incident (and separately, a package takedown), teams pulling direct had broken builds; teams behind an internal proxy/mirror kept building from cache. The same proxy later let security block a malicious package version org-wide with one rule.

---

## Mental Models

- **"SCA is a prioritization problem, not a detection problem."** Tools find everything; value is in the ranking.
- **"KEV overrides CVSS; EPSS reranks the rest."** Proven exploitation beats theoretical severity; probability orders the remainder.
- **"Currency is a security control."** A fleet two weeks behind patches in hours; a fleet a year behind patches in weeks.
- **"Build the capability, not the answer."** The deliverable is "affected-and-where in minutes for *any* CVE," not a fix for *this* one.
- **"Gate the diff, backlog the world."** Block what the PR introduces; SLA-track the ambient noise.

---

## Common Mistakes

- **Sorting the remediation queue by CVSS.** Ignores reachability, EPSS, KEV, and exposure — the things that determine real risk.
- **A binary "fail on any vuln" gate.** It gets disabled; it blocks unrelated work on un-fixable transitive noise.
- **No exception process.** Engineers either lie ("not applicable") or bypass the gate when there's genuinely no fix.
- **Measuring scan count, not MTTR / dependency age.** Activity metrics, not outcome metrics.
- **No SBOM inventory before an incident.** "Are we affected?" becomes a manual fire drill.
- **Banning all copyleft bluntly OR ignoring AGPL entirely.** Both are failures of nuance; govern with legal.
- **Letting dependency age drift.** Trades small steady pain for a giant breaking-change jump during an emergency.

---

## Test Yourself

1. List the components of an SCA *program* beyond "run a scanner."
2. Two findings: CVSS 9.8 unreachable vs CVSS 7.5 reachable + KEV + internet-facing. Which is the emergency, and why?
3. What does EPSS measure, and how does it differ from CVSS? What does KEV add that EPSS doesn't?
4. Design a PR gate that's strict but won't get disabled. What does it block vs warn?
5. Why is "currency is a security control"? Connect dependency age to incident response time.
6. When would you choose vendoring over an internal proxy, and vice versa?
7. What infrastructure must exist *before* an incident for "are we affected, and where" to take minutes?
8. Why must license governance be owned jointly with legal, and what's the AGPL/M&A risk?

---

## Cheat Sheet

```bash
# Prioritization data
curl -s "https://api.first.org/data/v1/epss?cve=CVE-2021-44228" | jq '.data[0].epss'   # EPSS
# CISA KEV catalog: known_exploited_vulnerabilities.json  (KEV overrides CVSS)
govulncheck ./...                          # reachability (Go)

# Gate the diff, not the world
osv-scanner scan source -r . --diff-base origin/main
# GitHub: actions/dependency-review-action  (fail-on-severity, deny-licenses)

# Treadmill at scale: shared Renovate preset, auto-merge passing patch/minor
# Track: MTTR, % deps current, median dependency age, open criticals, exceptions

# Affected-and-where (pre-built SBOM inventory)
jq '.components[] | select(.name=="log4j-core")' service.cdx.json
grype sbom:./sboms/
```

| Policy lever | Default |
|--------------|---------|
| New critical / KEV in PR | **Block** |
| Forbidden license in PR | **Block** |
| Existing high/medium | Backlog + SLA (warn) |
| Patch/minor update, CI green | **Auto-merge** |
| No-fix-available critical | Time-boxed exception + mitigation |

---

## Summary

- An **SCA program** = inventory + written policy (block/SLA/exceptions) + tooling + gating + remediation flow + metrics. Detection is solved; **prioritization is the job.**
- Rank by **severity x reachability x exploitability x exposure**, not CVSS alone. **KEV overrides CVSS**; **EPSS** reranks the rest by exploitation probability.
- **Gate the PR diff** (block new criticals/KEV and forbidden licenses), **backlog the rest** under an SLA via scheduled full scans. A binary gate gets disabled.
- Run the **treadmill at scale** with auto-merge of safe updates, grouped/scheduled PRs, shared config, and **dependency-age** tracking. **Currency is a security control.**
- Choose **vendoring vs proxy vs direct** deliberately; a gating proxy is a strong fleet backbone.
- **License governance is legal risk management** (AGPL/SaaS, attribution, relicensing, M&A), owned with legal.
- Build the **"affected-and-where in minutes"** capability via a queryable **SBOM inventory** *before* the next Log4Shell.

---

## Further Reading

- FIRST.org EPSS model documentation and API
- CISA Known Exploited Vulnerabilities (KEV) catalog and BOD 22-01
- GitHub `dependency-review-action`; `osv-scanner` `--diff-base`
- Renovate shared presets and `config:base`
- CycloneDX / SPDX SBOM specifications (cross-ref supply-chain-security)
- "Govulncheck" Go blog; Snyk/Endor reachability whitepapers

---

## Related Topics

- [SAST Security Scanners](../04-sast-security-scanners/) — first-party code scanning, complementary risk
- [Static Analysis in CI](../09-static-analysis-in-ci/) — gating, policy-as-code, fast deterministic checks
- [Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOMs and fleet inventory (the "where" capability)
- [Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/) — trusting the artifacts you scan and ship
- Professional tier: org-wide policy/SLA design, exceptions governance, metrics program, legal partnership
