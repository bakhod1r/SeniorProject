# Supply-Chain Security — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Supply-Chain Security
>
> *Run a program, not a checklist: generate-store-query SBOMs, policy-as-code admission, continuous monitoring, and an incident drill that answers "are we affected, and where" in minutes.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — An org supply-chain program, end to end](#core-concept-1--an-org-supply-chain-program-end-to-end)
5. [Core Concept 2 — SBOM lifecycle: generate, store, query at scale](#core-concept-2--sbom-lifecycle-generate-store-query-at-scale)
6. [Core Concept 3 — Policy-as-code admission](#core-concept-3--policy-as-code-admission)
7. [Core Concept 4 — Continuous monitoring and the maturity ladder](#core-concept-4--continuous-monitoring-and-the-maturity-ladder)
8. [Core Concept 5 — Incident response: "are we affected, and where?"](#core-concept-5--incident-response-are-we-affected-and-where)
9. [Core Concept 6 — Vendor risk: you inherit your dependencies' posture](#core-concept-6--vendor-risk-you-inherit-your-dependencies-posture)
10. [Core Concept 7 — Measuring the program](#core-concept-7--measuring-the-program)
11. [Core Concept 8 — The cost/maturity ladder and where to spend](#core-concept-8--the-costmaturity-ladder-and-where-to-spend)
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

> Focus: **building and running an organization-wide supply-chain program — SBOM lifecycle, policy-as-code admission, continuous monitoring, incident response, vendor risk, and the metrics that prove it works — at a maturity level matched to blast radius and budget.**

The senior tier secured a pipeline. The professional tier secures *the organization*: dozens of pipelines, hundreds of services, an SBOM corpus, an admission policy, a monitoring loop, and an on-call who can answer the only question that matters during an incident — **"are we affected by this, and exactly where?"** — before the news cycle does.

This is a program-design and operations problem as much as a security one. The recurring tension is **assurance vs. velocity**: every control either fails closed (and risks blocking delivery) or fails open (and risks being theater). The art is sequencing controls so the program raises the floor without becoming the thing engineers route around. Signing/provenance *mechanics* stay in [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/); this file is the program view.

---

## Prerequisites

- Senior tier: build integrity, provenance, verification gates, SLSA/SSDF.
- Experience operating production systems and an on-call rotation.
- Familiarity with policy engines (OPA/Rego, Kyverno) and admission control.
- Working knowledge of [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) and [Registries & Distribution](../05-registries-and-distribution/).

---

## Glossary

| Term | Meaning |
|------|---------|
| **Supply-chain program** | The org-wide system of policy, tooling, and process that secures source → build → publish → consume. |
| **SBOM corpus** | The stored, indexed collection of SBOMs across all artifacts and versions, queryable in aggregate. |
| **Policy-as-code** | Admission/security rules expressed as versioned, testable code (OPA/Rego, Kyverno, CUE). |
| **Admission control** | A gate (e.g. Kubernetes admission webhook) that allows/denies deploys against policy. |
| **VEX** | Vulnerability Exploitability eXchange — machine-readable affected/not-affected statements. |
| **MTTR (patch)** | Mean time to remediate a known vulnerability across the fleet. |
| **MTTD** | Mean time to detect that you're affected by a new vulnerability/compromise. |
| **Break-glass** | A controlled, audited override for when a gate must be bypassed in an emergency. |
| **Blast radius** | How far a single compromise propagates. |
| **Crown jewels** | The highest-value artifacts/systems warranting the strongest controls. |

---

## Core Concept 1 — An org supply-chain program, end to end

A program is the set of controls placed along the chain, plus the process and metrics that keep them honest. The map:

```
 SOURCE ──────────▶ BUILD ──────────▶ PUBLISH ──────────▶ CONSUME ──────────▶ RUN
   │                  │                  │                   │                   │
 signed commits    hermetic +        provenance +        admission           continuous
 2-person review   ephemeral +       attestation +       policy-as-code      monitoring of
 branch protection OIDC secrets      trusted publish     (verify-before-      deployed SBOMs
   │              digest-pinned         (OIDC)             admit, fail closed)    │
   └── Scorecard ──┴── SLSA L? ────────┴─────────────────┴── SBOM corpus ───────┘
                                                                  │
                                            INCIDENT RESPONSE: "affected? where?" + MTTR
```

The professional contribution is **coherence and operability**: the controls compose (provenance generated at build is *verified* at admission), they're measured (Scorecard, % signed, MTTR), and they degrade gracefully (break-glass exists and is audited). A program isn't a pile of tools; it's a system with feedback loops and an owner.

Three design principles run through it:
1. **Match assurance to blast radius.** Crown-jewel, internet-facing artifacts get L3-class controls; an internal batch job gets the basics. Uniform maximum controls bankrupt velocity for no risk reduction.
2. **Every gate fails closed *and* is fast.** A slow gate gets disabled "temporarily"; a fail-open gate is theater.
3. **Build for the incident before the incident.** The SBOM corpus and the rehearsed drill are what convert a five-day audit into a five-minute query.

---

## Core Concept 2 — SBOM lifecycle: generate, store, query at scale

One SBOM is a file. A *program* needs the full lifecycle across hundreds of artifacts:

**Generate** at build time, per artifact, per version — and attach it as a signed attestation so the SBOM's own integrity is verifiable:

```bash
syft "$IMAGE@$DIGEST" -o cyclonedx-json=sbom.cdx.json
cosign attest --predicate sbom.cdx.json --type cyclonedx "$IMAGE@$DIGEST"  # mechanics: topic 04
```

**Store** in a queryable system, not a folder of JSON. Dependency-Track (OWASP) is the common open choice: it ingests CycloneDX SBOMs, tracks components across all projects, continuously matches them against new advisories, and exposes the corpus over an API. The store must answer aggregate questions across *every deployed version of every service*.

**Query** — this is the payoff. Two query modes:
- *Reactive (incident):* "Which deployed artifacts contain `log4j-core` < 2.17?" → answered against the corpus in seconds.
- *Proactive (continuous):* the store re-matches the whole corpus against the advisory feed on every update, so a *new* CVE on an *old* SBOM surfaces without a rebuild.

```bash
# Reactive query against a Dependency-Track-style API (illustrative)
curl -s "$DT/api/v1/component?purl=pkg:maven/org.apache.logging.log4j/log4j-core" \
  -H "X-Api-Key: $DT_KEY" | jq '.[].project.name'
```

**Govern.** Decide retention (keep SBOMs for as long as the artifact may run, plus audit horizon), accuracy (validate generators — a generator that misses components produces a confidently wrong inventory), and freshness (regenerate when the artifact changes; an SBOM that drifts from reality is worse than none because it's trusted).

---

## Core Concept 3 — Policy-as-code admission

Verification (senior tier) becomes a *program* when the policy is **code**: versioned, reviewed, tested, and enforced uniformly across every deploy. Express it in OPA/Rego, Kyverno, or Sigstore policy-controller, and run it as a fail-closed admission gate.

A representative policy (the *intent*, not signing internals — those are in [topic 04](../04-artifact-signing-and-provenance/)):

```rego
# Deny any image that fails the supply-chain bar (illustrative Rego)
package admission

deny[msg] {
  not input.image.signed
  msg := sprintf("%s is unsigned", [input.image.ref])
}

deny[msg] {
  input.image.provenance.builder != "https://github.com/yourco/.github/workflows/release.yml"
  msg := sprintf("%s built by unexpected builder %s",
                 [input.image.ref, input.image.provenance.builder])
}

deny[msg] {
  some v in input.image.vulns
  v.severity == "CRITICAL"
  not v.vex_not_affected
  msg := sprintf("%s ships unmitigated CRITICAL %s", [input.image.ref, v.id])
}
```

Program-level requirements that separate this from a one-off gate:
- **Tested.** Policies have unit tests (`opa test`, `conftest`) and CI; a policy bug can either let everything through or block all deploys.
- **Staged rollout.** Run new policy in *audit/dry-run* (log violations, don't block) across the fleet first, fix the long tail, *then* enforce. Flipping straight to deny org-wide is how you cause an outage and lose buy-in.
- **Break-glass.** A documented, audited, time-boxed override for emergencies (a Sev1 fix can't be blocked by a policy outage). Break-glass usage must page security and auto-expire. (Branch-protection/gate break-glass patterns sit alongside this in the quality-gates material.)
- **Exceptions as data.** "Service X is exempt from rule Y until date Z" lives in version control with an owner and expiry — never as a quietly disabled check.

---

## Core Concept 4 — Continuous monitoring and the maturity ladder

A point-in-time scan answers "are we clean today." A *program* answers "are we still clean," continuously, because the threat changes even when your code doesn't — a dependency you shipped clean last month gets a CVE today.

The monitoring loop:
1. Advisory feeds (OSV, GitHub Advisory DB, vendor feeds) update constantly.
2. Your SBOM corpus re-matches against them on every update (Dependency-Track does this natively).
3. New matches generate tickets/alerts routed to the owning team, prioritized by severity *and reachability/exposure* (a CRITICAL in unreachable code outranked by a HIGH on the auth path).
4. Remediation (usually a Renovate/Dependabot bump) flows through the normal gated PR process; MTTR is tracked.

Crucially, monitor the **deployed** corpus, not just repos — what's running can differ from what's in `main`. Tie monitoring to your deployment inventory so "affected" means "affected *in production*," not "vulnerable somewhere in git history."

This loop is what makes the maturity ladder real (Concept 8): each rung adds either coverage (more artifacts in the corpus), assurance (higher SLSA, stricter admission), or speed (lower MTTD/MTTR).

---

## Core Concept 5 — Incident response: "are we affected, and where?"

When the next xz or Log4Shell breaks, the entire program is judged on one capability: **how fast can you answer "are we affected, and exactly where, and what's the blast radius?"** A rehearsed runbook:

**1. Scope (minutes).** Query the SBOM corpus for the affected PURL/version range across *all deployed artifacts*. This is the moment the corpus pays for itself — minutes vs. days. If you can't query it fast, the rest of the runbook stalls.

```bash
osv-scanner --sbom=stored/each-deployed.cdx.json   # or one corpus query
# "show me every production service shipping the affected component+range"
```

**2. Assess reachability.** Present? Reachable? Exploitable in *your* configuration? Record a VEX verdict for each affected artifact so the conclusion is machine-readable and survives re-scans.

**3. Contain.** If exploitable and exposed: pull the artifact / block via admission policy / apply WAF or config mitigation while the real patch is built. For an *active compromise* (a malicious dependency, not just a vuln): rotate any secret the build or app could have touched (assume exfiltration — Codecov), revoke tokens, and audit for the compromise's indicators.

**4. Remediate and verify.** Patch (bump + rebuild + re-provenance), redeploy, then *re-query the corpus* to confirm zero affected artifacts remain in production. "We patched the repo" is not "we're no longer affected in prod."

**5. Learn.** Postmortem the *detection-to-remediation* timeline; the metric that matters is MTTR across the fleet, and the deliverable is a faster runbook next time.

Two compromise-specific notes the pros internalize: (a) for a *malicious* dependency, integrity of the build is already in question — assume the worst about anything the compromised code could reach; (b) **practice the drill** with a tabletop on a fictional CVE. The first time you run this should not be during a real incident.

---

## Core Concept 6 — Vendor risk: you inherit your dependencies' posture

A hard truth to operationalize: **your security posture is the union of your own and every dependency's.** A flawless internal program with a backdoored dependency is backdoored. So vendor/dependency risk is a first-class program function:

- **Evaluate before adopting.** New direct dependencies (and key vendors/SaaS) get a posture check: maintenance activity, maintainer count (bus factor — xz was effectively *one* exhausted maintainer), signed releases, OpenSSF **Scorecard**, security policy/responsiveness, and transitive footprint.

```bash
scorecard --repo=github.com/candidate/library --show-details
```

- **Reduce the surface.** Prefer fewer, better-maintained dependencies; inline trivial ones (the left-pad lesson); remove unused deps continuously. Every dependency is a standing trust grant you renew on every install.
- **Tier vendors by blast radius.** A dependency in your auth path or build pipeline warrants deeper scrutiny than a leaf utility. Spend review budget accordingly.
- **Plan for vendor failure.** What if a critical dependency is abandoned, compromised, or pulled (left-pad availability)? Vendoring, forks you can patch, and an exit plan for critical SaaS are part of the program.
- **Contractual/compliance angle.** If you *sell* software, EO 14028-style requirements mean your customers inherit *your* posture and will demand SBOMs and attestations — so your program is also a sales/compliance asset.

The reframing: you don't just consume dependencies, you **adopt their security teams (or lack thereof)**. Choose what you inherit.

---

## Core Concept 7 — Measuring the program

A program you can't measure is a program you can't defend or improve. The metrics that matter:

| Metric | What it tells you | Healthy direction |
|--------|-------------------|-------------------|
| **% artifacts with stored SBOM** | Coverage of your inventory | → 100% of deployed artifacts |
| **% artifacts signed + provenance-verified at admission** | Real enforcement, not just generation | → 100% of crown jewels, rising for the rest |
| **MTTD** (new vuln → "we know we're affected") | Speed of the monitoring loop | Hours, not weeks |
| **MTTR (patch)** | Vuln known-affected → patched in prod | Days for CRITICAL, trending down |
| **% deps pinned by hash / from private mirror** | Tampering & confusion exposure | → high |
| **OpenSSF Scorecard** (own repos) | Posture trend over time | Rising; no regressions on key checks |
| **Open CRITICAL/HIGH age distribution** | Backlog health | Few, young |
| **Break-glass frequency** | Whether gates are realistic | Rare; spikes mean gates are wrong |

Two cautions from the metrics literature (and the engineering-metrics material): **don't let a metric become the target** (Goodhart) — "100% signed" with a fail-open verifier is a green number on a broken control; and **pair coverage with effectiveness** — high SBOM coverage is worthless if MTTD is weeks. Report the *outcome* (could we answer "affected, where" fast, and did we patch fast) alongside the *coverage*.

---

## Core Concept 8 — The cost/maturity ladder and where to spend

Maturity is a ladder, and the professional skill is knowing *which rung is worth buying next* given finite budget:

| Rung | Controls | Marginal cost | Buys |
|------|----------|---------------|------|
| **0 — Ad hoc** | Manual, inconsistent | — | Nothing reliable |
| **1 — Hygiene** | Lockfiles enforced, scanning gated, Dependabot, SBOMs generated+stored | Low | Catches *known* vulns; basic inventory |
| **2 — Controlled** | Private mirror, hash pinning, OIDC publish, SBOM corpus + continuous monitoring | Moderate | Stops confusion/token theft; "affected, where" in minutes |
| **3 — Verified** | Provenance + fail-closed admission policy-as-code; ephemeral builds; SLSA L2+ on releases | Higher | Resists authentic-lie / build tamper at the gate |
| **4 — Assured** | Hermetic + reproducible crown-jewel builds (SLSA L3), formal SSDF mapping, rehearsed IR, full metrics | Highest | Defends the build itself; audit-ready |

The guidance: **buy rungs in order, and buy higher rungs only for higher-blast-radius artifacts.** Most orgs get the largest risk reduction per dollar from rungs 1–2 (hygiene + corpus + monitoring) — that's where Log4Shell-class pain actually lives. Rung 3–4 (provenance, hermetic builds) is where you spend on crown jewels and where compliance/sales pull you. Track the gap between current and target rung *per artifact tier* as explicit, owned risk — not as a vague aspiration. The worst outcome is a half-built rung 3 (provenance generated, never verified) that *looks* mature and isn't.

---

## Real-World Examples

- **Log4Shell (2021).** The program test, fleet-wide. Orgs with an SBOM corpus + continuous monitoring scoped impact in minutes and patched on a known timeline; orgs without spent days, missed deployed-but-not-in-`main` instances, and re-discovered affected systems for weeks. The single strongest argument for Concepts 2, 4, and 5 together.

- **SolarWinds (2020).** A *signed* build was the compromise. At the program level this is why admission must verify *provenance* (expected source + builder), not just a signature, and why build integrity (senior tier) is a program control, not a team choice.

- **Codecov (2021).** Secret exfiltration from CI. Program responses: OIDC short-lived secrets (nothing long-lived to steal), least-privilege runners, and an IR playbook that *assumes* secret exposure and rotates automatically.

- **xz/liblzma (2024).** A single, socially-engineered maintainer (bus factor of ~1) nearly backdoored SSH globally. The vendor-risk lesson is concrete: maintainer count and burnout are *security signals*; Scorecard-style evaluation and reducing critical single-maintainer dependencies are program controls.

- **event-stream / dependency confusion.** Maintainer-handoff and name-collision attacks that a controlled tier (private mirror, namespacing, gated dependency review) neutralizes at the program level rather than per-team.

---

## Mental Models

- **The program is judged by the incident.** All the SBOMs and policies exist to make "are we affected, and where" a five-minute answer.
- **Coverage × effectiveness.** A control on 100% of artifacts that fails open scores zero. Measure both.
- **Match assurance to blast radius.** Uniform maximum controls is a budget bonfire; spend on the crown jewels.
- **You inherit your dependencies' security team.** Choose dependencies like you're hiring them.
- **A fail-open gate is a green light wearing a stop sign.** Worse than no gate, because it's trusted.
- **Build for the incident before the incident.** The corpus and the rehearsed drill are pre-paid response time.

---

## Common Mistakes

- **Generating SBOMs nobody stores or queries** — inventory with no incident payoff.
- **Provenance generated but never verified** at admission — a half-built rung 3 that looks mature.
- **Flipping admission policy straight to enforce** org-wide with no audit-mode rollout → outage and lost trust.
- **No break-glass,** so a policy outage blocks a Sev1 fix and engineers permanently disable the gate.
- **Monitoring repos, not deployments** — missing what's actually running in prod.
- **Chasing one vanity metric** ("% signed") while MTTD is weeks (Goodhart).
- **Uniform top-tier controls** everywhere, exhausting budget and velocity for no marginal risk reduction.
- **Never rehearsing the incident** — the first real run of the runbook happens during the real fire.

---

## Test Yourself

1. Draw the org program across source → build → publish → consume → run, and name the control at each stage.
2. Describe the SBOM lifecycle (generate, store, query, govern). What makes the corpus valuable during an incident?
3. What separates *policy-as-code admission* from a one-off verification gate? Why audit-mode first?
4. Walk the IR runbook for a new CRITICAL CVE in a transitive dependency. Where does the corpus save days?
5. How does IR differ for a *malicious* dependency vs. a *vulnerable* one?
6. Why is "you inherit your dependencies' posture" a program statement, and what controls follow? (Reference xz.)
7. Give six program metrics and one Goodhart trap for each tendency.
8. Lay out the maturity ladder and justify which rung gives the most risk reduction per dollar for most orgs.

---

## Cheat Sheet

```bash
# SBOM lifecycle
syft "$IMAGE@$DIGEST" -o cyclonedx-json=sbom.cdx.json
cosign attest --predicate sbom.cdx.json --type cyclonedx "$IMAGE@$DIGEST"   # mechanics: topic 04
# store in Dependency-Track; query the corpus by PURL on incident

# Policy-as-code admission (test before enforce)
opa test policy/                       # unit-test policies
conftest test deploy.yaml              # check manifests
# roll out in audit/dry-run fleet-wide, fix tail, then enforce (fail closed)

# Continuous monitoring + IR query
osv-scanner --sbom=stored/<artifact>.cdx.json
# corpus query: "every prod artifact with affected PURL+range"

# Vendor risk
scorecard --repo=github.com/candidate/library --show-details
```

| Program function | Tooling |
|------------------|---------|
| SBOM corpus + monitoring | syft + Dependency-Track + OSV/GHSA feeds |
| Admission policy-as-code | OPA/Rego + conftest, Kyverno, Sigstore policy-controller |
| Provenance/signing | cosign, SLSA generator (mechanics: topic 04) |
| Vendor evaluation | OpenSSF Scorecard |
| Metrics | % SBOM, % verified-at-admission, MTTD, MTTR, Scorecard trend |

---

## Summary

A professional supply-chain capability is a **program**: controls placed along source → build → publish → consume → run, composed so provenance generated at build is *verified* at admission, measured so you can defend and improve it, and operable so it degrades via audited break-glass instead of getting disabled. Run the full **SBOM lifecycle** — generate per artifact, store in a queryable corpus, monitor continuously, govern for accuracy — because the corpus is what turns the incident question "are we affected, and where" from days into minutes. Enforce **policy-as-code admission** that fails closed, ships in audit-mode first, and has a break-glass. Treat **vendor risk** as inheriting your dependencies' security team (xz's bus factor of one is a security metric). **Measure** coverage *and* effectiveness without worshipping a single number (Goodhart). And climb the **maturity ladder** in order, buying higher rungs only for higher-blast-radius artifacts — most of the risk reduction per dollar lives in hygiene, the corpus, and a *rehearsed* incident drill.

---

## Further Reading

- OWASP Dependency-Track — SBOM ingestion, corpus, continuous monitoring.
- CISA — SBOM minimum elements, VEX guidance, and vulnerability-management resources.
- NIST SP 800-218 (SSDF) and Executive Order 14028 — secure development attestations.
- OpenSSF — Scorecard, the Supply-chain Security best-practices guides, and SLSA.
- Open Policy Agent (Rego), Kyverno, and Sigstore policy-controller documentation.

---

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — the signing/attestation/SLSA mechanics this program consumes.
- [Registries & Distribution](../05-registries-and-distribution/) — admission, registry policy, and distribution at scale.
- [Release Automation](../08-release-automation/) — wiring the program's gates into pipelines.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/) — containment options during a supply-chain incident.
- [Build Systems](../../build-systems/) and [Static Analysis](../../static-analysis/) — adjacent assurance.
- Adjacent tiers: [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Interview](interview.md).
