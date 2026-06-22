# Release Automation — Professional Level

> **Roadmap:** [Release Engineering](../README.md) → Release Automation

*Designing the org-standard release pipeline as a paved road: governed, audited, measured by DORA, and migrated from manual without a big bang.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Release automation as a paved road](#core-concept-1--release-automation-as-a-paved-road)
5. [Core Concept 2 — Reusable workflows: the implementation of the paved road](#core-concept-2--reusable-workflows-the-implementation-of-the-paved-road)
6. [Core Concept 3 — Release as a governed action](#core-concept-3--release-as-a-governed-action)
7. [Core Concept 4 — Audit trail and non-repudiation](#core-concept-4--audit-trail-and-non-repudiation)
8. [Core Concept 5 — Measuring release automation with DORA](#core-concept-5--measuring-release-automation-with-dora)
9. [Core Concept 6 — Migrating manual → automated without a big bang](#core-concept-6--migrating-manual--automated-without-a-big-bang)
10. [Core Concept 7 — Failure handling and SLOs for the release system](#core-concept-7--failure-handling-and-slos-for-the-release-system)
11. [Core Concept 8 — Buy vs build vs assemble](#core-concept-8--buy-vs-build-vs-assemble)
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

> Focus: **owning release automation as an organizational capability — a paved-road pipeline that every team adopts, governed and audited for compliance, measured against DORA, and rolled out incrementally.**

A senior engineer makes one team's release pipeline excellent. A staff/principal engineer or platform lead makes *every* team's release pipeline excellent without writing each one, and does it in a way that satisfies security, compliance, and audit while still being fast enough that teams *want* to use it. That is a fundamentally different problem: it is about leverage, standardization, governance, and change management across an org, not about YAML for one repo.

The central tension at this tier: **governance vs. velocity.** Add too much control and teams route around the paved road; add too little and you fail your SOC 2 audit. The professional's job is to make the compliant path also the *easiest* path — so the secure, audited, automated release is the one of least resistance.

---

## Prerequisites

- Full command of the [senior tier](./senior.md): monorepos, idempotency, partial-release recovery, keyless signing, trusted publishing.
- Experience operating CI/CD at org scale; familiarity with the `ci-cd-pipeline-design` skill.
- Working knowledge of DORA metrics — see [Engineering Metrics and DORA](../../engineering-metrics-and-dora/).
- Exposure to a compliance regime (SOC 2, ISO 27001, FedRAMP) and what "auditable" means.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Paved road** | The supported, easy, well-lit default path teams are nudged toward. |
| **Reusable workflow** | A centrally-owned CI workflow other repos call, inheriting its logic. |
| **Golden path** | Synonym for paved road; the recommended end-to-end way to do a task. |
| **Separation of duties** | The person who triggers a release isn't the sole author/approver. |
| **Non-repudiation** | Cryptographic proof of who did what; they can't credibly deny it. |
| **Change-failure rate** | Fraction of releases that cause a degradation requiring remediation. |
| **Lead time for changes** | Time from commit to running in production. |
| **Break-glass** | An emergency override of normal controls, heavily logged. |
| **Policy-as-code** | Governance rules expressed as enforceable code (e.g. OPA). |

---

## Core Concept 1 — Release automation as a paved road

In an org with 200 services, you do not write 200 release pipelines, and you do not let 200 teams each invent one. You build a **paved road**: one excellent, centrally-maintained release capability that teams adopt with minimal config. The metaphor is deliberate — the road is paved (smooth, fast, supported), not walled (mandatory, restrictive). Teams *can* go off-road, but the paved road is so much easier and better that almost nobody does.

What the paved road provides that individual pipelines can't:

- **Consistency.** Every service releases the same way, so on-call, security, and audit reason about one model, not 200.
- **Centralized hardening.** Keyless signing, trusted publishing, provenance, SBOM generation — implemented once, inherited everywhere. When a new supply-chain requirement lands, you change it in one place.
- **Fast propagation of fixes.** A bug or CVE in the release tooling is patched centrally; every team gets the fix on their next release.
- **Low adoption cost.** A team onboards with ~10 lines of config, not a week of pipeline authoring.

The economics: a 5-line adoption × 200 teams beats a 300-line pipeline × 200 teams, and the centralized version is more secure because experts maintain it. This is platform engineering applied to release: **release-as-a-service.**

> The paved road only works if it is genuinely the path of least resistance. The moment your golden path is slower or more painful than a team's hand-rolled script, you've lost — they'll route around it and your governance evaporates. Invest in DX as heavily as in controls.

---

## Core Concept 2 — Reusable workflows: the implementation of the paved road

The concrete mechanism (in GitHub Actions; GitLab has `include`, others have templates) is the **reusable workflow** — a workflow that other repos call, inheriting all its logic while exposing only a few knobs.

The platform team owns this once, in a central repo:

```yaml
# org/.github/.github/workflows/release.yml  (the paved road, owned by platform)
name: Org Release
on:
  workflow_call:
    inputs:
      language: { required: true, type: string }   # node | go | rust
      package-path: { required: false, type: string, default: "." }
    secrets: {}    # none needed — OIDC throughout

permissions:
  contents: write
  id-token: write     # signing + trusted publishing
  packages: write
  attestations: write # provenance

jobs:
  release:
    runs-on: ubuntu-latest
    environment: production-release   # ← gate: required reviewers, audit
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Derive version & changelog
        uses: org/release-actions/derive@v3
      - name: Build (${{ inputs.language }})
        uses: org/release-actions/build@v3
      - name: Sign + attest (keyless)
        uses: org/release-actions/sign@v3
      - name: Publish (trusted publishing)
        uses: org/release-actions/publish@v3
      - name: Create release + notify
        uses: org/release-actions/finalize@v3
      - name: Emit DORA metrics
        if: always()
        uses: org/release-actions/metrics@v3
```

A product team adopts the entire hardened pipeline in a few lines:

```yaml
# any-product-repo/.github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    uses: org/.github/.github/workflows/release.yml@v3   # the paved road
    with:
      language: node
    permissions:
      contents: write
      id-token: write
      packages: write
```

Two design decisions make this robust:

- **Version the paved road (`@v3`).** Teams pin a major; you ship `v3.1` improvements they get automatically and `v4` breaking changes they migrate to deliberately. The road evolves without breaking everyone at once.
- **Pin the inner actions, too.** `org/release-actions/*@v3` should themselves pin their dependencies to SHAs — the paved road must not be a supply-chain hole.

> The reusable workflow is where every senior-tier concept (idempotency, keyless signing, provenance, partial-release recovery) gets implemented *once* and distributed to the whole org. It is the highest-leverage artifact a release-platform engineer produces.

---

## Core Concept 3 — Release as a governed action

A release is a privileged action: it puts code in front of users and customers. Governance answers *who may trigger it, under what approvals, and how that's enforced* — without reintroducing the manual bottleneck automation removed.

The controls, from lightest to heaviest:

1. **Who can trigger.** Restrict the release branch/tag and the workflow's `environment` so only authorized identities initiate a release. Branch protection + environment reviewers, not tribal knowledge.
2. **Approvals (gated environments).** A protected `environment: production-release` can require a named reviewer to approve before the job proceeds. This is the automated equivalent of a change-approval board — the pipeline pauses, an approver clicks, it continues. Crucially, the *work* is still automated; only the *go decision* is human.
3. **Separation of duties.** For high-assurance contexts, the person who triggers the release must not be the sole author of the change. Enforce via CODEOWNERS + required reviews + the approval gate being a different identity.
4. **Policy-as-code.** Encode "no release without a passing security scan / signed provenance / linked changelog" as machine-checked policy (OPA/Conftest, or required status checks) so it can't be skipped. See [Quality Gates](../../quality-gates/).

```yaml
# Gated environment in the reusable workflow
jobs:
  release:
    environment:
      name: production-release   # configured with: required reviewers,
                                 # wait timer, deployment-branch policy
```

> The art is calibrating control to risk. A `fix:` to an internal library needs near-zero gating; a release of the payment service needs separation of duties and an approval. A good paved road expresses *risk tiers* so low-risk releases stay frictionless while high-risk ones get the controls auditors require. Uniformly heavy governance is how you kill velocity and drive teams off-road.

---

## Core Concept 4 — Audit trail and non-repudiation

For any regulated org, "we released it" is not enough; you must *prove* who released what, when, from which source, approved by whom — and prove it to an auditor who assumes you're lying. The automated pipeline is actually *better* at this than manual releases ever were, because every step is logged by machines.

What a complete release audit trail captures:

| Question | Evidence source |
|----------|-----------------|
| What was released? | git tag + commit SHA + artifact digest |
| From what source? | SLSA provenance (signed build statement) |
| Who triggered it? | CI run actor + OIDC identity |
| Who approved it? | environment-approval record |
| What signed it? | Sigstore cert identity + Rekor transparency-log entry |
| When? | immutable CI run + Rekor timestamps |
| Did controls pass? | required-check + policy-as-code results, retained |

**Non-repudiation** is the strong form: the Sigstore/Rekor signature ties the artifact to the specific workflow identity in a public, append-only transparency log. The org can't later claim a different build produced the artifact, and a leaked artifact can be traced to its exact build. This is dramatically stronger than a manual "Jane said she built it on her laptop."

> Make the audit trail a *byproduct* of the pipeline, not a separate logging effort. If your release workflow already emits provenance, environment-approval records, and Rekor entries, the SOC 2 evidence collection becomes "export these artifacts," not "reconstruct what happened." Design for the auditor up front; it's nearly free once the security controls (senior tier) are in place.

---

## Core Concept 5 — Measuring release automation with DORA

You manage what you measure. Release automation's value shows up directly in the [DORA metrics](../../engineering-metrics-and-dora/), and instrumenting them proves (or disproves) that your investment paid off.

| DORA metric | How release automation moves it |
|-------------|---------------------------------|
| **Deployment frequency** | Automation makes releases cheap → frequency rises (the headline win). |
| **Lead time for changes** | Removing manual steps shrinks merge→production time, often by hours. |
| **Change-failure rate** | Smaller, more frequent, reproducible releases fail less; but watch it doesn't *rise* if you ship faster than your testing supports. |
| **Time to restore (MTTR)** | Automated, idempotent releases make roll-forward fast; pairs with rollback automation. |

Instrument them at the source — the release pipeline already knows everything needed:

```yaml
- name: Emit DORA events
  if: always()
  run: |
    org-metrics emit release \
      --service "${{ github.repository }}" \
      --version "${VERSION}" \
      --commit-sha "${{ github.sha }}" \
      --first-commit-ts "${FIRST_COMMIT_TS}" \   # for lead-time
      --released-ts "$(date -u +%s)" \
      --status "${{ job.status }}"
```

> Two cautions. First, **beware Goodhart**: if you reward deployment frequency, teams game it with trivial releases. Pair frequency with change-failure-rate so quality stays honest. Second, release frequency is an *outcome* of good automation, not the goal — the goal is safe, fast delivery. Measure to learn, not to rank teams.

---

## Core Concept 6 — Migrating manual → automated without a big bang

You inherit an org of hand-cranked releases. A big-bang cutover ("everyone switches Monday") fails — too much risk, too much resistance, too many edge cases discovered at once. Migrate incrementally with the **strangler** approach.

A pragmatic sequence:

1. **Pick a low-risk pilot.** An internal library with frequent, low-stakes releases. Make its automated release excellent and visible. Goal: a reference success, not coverage.
2. **Run automation in shadow mode first.** Have the pipeline compute the version and changelog and *open a PR* (release-please style) without publishing. Teams compare the automated output to what they'd have done by hand. Builds trust before you hand over the publish.
3. **Establish the contract incrementally.** Roll out commitlint as warn-only, then required. Teams adapt to conventional commits before automation depends on it.
4. **Automate one step at a time** where teams are nervous: first auto-changelog, then auto-tag, then auto-publish to a *test* registry, finally auto-publish for real. Each step earns the next.
5. **Extract the paved road from the pilot.** Once two or three teams' pipelines look the same, factor the commonality into the reusable workflow. Now onboarding the next team is a config change.
6. **Make adoption pull, not push.** Publish the wins (release time dropped from 2h to 4min; zero botched releases this quarter). Teams ask to onboard. Mandate only the last laggards, and only with leadership air cover.
7. **Keep a manual escape hatch initially**, well-logged, for the long tail of weird releases — then close it as the paved road covers more cases.

> The migration is a change-management problem more than a technical one. The technical work (write the reusable workflow) is a few weeks; getting 200 teams to adopt it and write conventional commits is the year-long part. Lead with trust-building (shadow mode), prove value (DORA before/after), and let success pull adoption.

---

## Core Concept 7 — Failure handling and SLOs for the release system

When release automation is org infrastructure, *its* reliability is a production concern. A broken paved road blocks every team's releases — a far bigger incident than one team's manual hiccup.

Treat the release platform as a product with SLOs:

- **Availability SLO.** "The release pipeline succeeds for valid inputs 99.x% of the time." Track and alert on the failure rate; a spike means *your* tooling broke, not the teams' code.
- **Latency SLO.** "Merge to published release in under N minutes (p95)." Releases that drag erode the "make it boring/frequent" benefit.
- **Blast-radius control.** A bad change to the reusable workflow can break every team simultaneously. Mitigate with: versioned workflow (`@v3`), canary rollout of new workflow versions to a few repos first, and the ability to fast-revert the central workflow.
- **Partial-release recovery as a supported operation** (senior tier), with a documented, on-call-owned runbook — because now it's the platform team's pager, not the product team's.
- **Break-glass.** A logged emergency path to release when the normal controls are themselves broken (e.g. the OIDC provider is down). Heavily audited, time-boxed, reviewed after the fact. See break-glass patterns in [Quality Gates](../../quality-gates/).

> The cruel irony: by centralizing, you've created a single point of failure for all releases. Earn that centralization by operating the release platform with the same rigor as any tier-1 service — SLOs, canaries, runbooks, on-call.

---

## Core Concept 8 — Buy vs build vs assemble

A professional decides not just *how* to automate but *what to own*. The spectrum:

- **Assemble from OSS** (semantic-release/changesets/goreleaser + your reusable workflow). Lowest build cost, full control, you own integration and maintenance. The right default for most orgs.
- **Buy a platform** (a CD/release product). Faster to a baseline, less to maintain, but constrained to the vendor's model and a recurring cost; governance/audit may or may not fit your regime.
- **Build bespoke.** Only when your release model is genuinely unusual (specialized signing, regulatory constraints no tool meets). Expensive to build *and* maintain; choose deliberately.

The deciding factors: how standard your stack is (standard → assemble), your compliance constraints (strict → you may need control buy can't give), team capacity to maintain tooling, and whether release is a differentiator (it rarely is — so don't over-invest in building).

> The most common mistake here is building bespoke release infrastructure that re-implements goreleaser/changesets badly. Assemble from battle-tested OSS and spend your build budget on the *paved-road integration and governance* — the part that's actually specific to your org.

---

## Real-World Examples

**A 300-engineer SaaS platform team.** One versioned reusable workflow (`org/.github@v4`) implements keyless signing, trusted publishing, SLSA provenance, and DORA emission. 180 services adopt it in ~8 lines each. A new supply-chain control (mandatory SBOM) shipped to all 180 by releasing `@v4.3`; teams got it on their next release with zero changes.

**A bank under SOC 2 + internal audit.** Releases run through a gated `production-release` environment requiring a separate approver; every release produces signed provenance logged to a private Rekor instance. The annual audit's "show me how release X reached production" is answered by exporting the run record, approval, and transparency-log entry — evidence assembled in minutes, not a fire drill.

**A migration that worked.** A company with 60 hand-released services started with one internal SDK in shadow mode (PR-only) for a month, made commitlint warn-only org-wide, then required, then automated publish for the pilot, extracted the paved road, and published a dashboard showing release time dropping from a 90-minute median to 5 minutes. Within two quarters, teams were requesting onboarding; the last holdouts were migrated with a deprecation deadline.

**A botched centralization.** A platform team shipped a breaking change to the *unversioned* shared workflow on a Friday. Every team's release broke simultaneously. The fix that prevented recurrence: version the workflow, canary new versions to five repos, and never auto-bump consumers.

---

## Mental Models

- **Paved road, not walled garden.** Make the compliant path the easy path; mandates are a last resort and a sign your DX failed.
- **Governance is calibrated to risk.** Frictionless for low-risk releases, controlled for high-risk ones. Uniform heavy control drives teams off-road.
- **The audit trail is a byproduct, not a project.** If your security controls emit provenance and approval records, compliance evidence is an export.
- **Centralization creates a tier-1 dependency.** The release platform earns its leverage by being operated like a production service (SLOs, canaries, on-call).
- **Migration is change management.** The YAML is weeks; the org adoption is a year. Lead with trust and proof, not mandates.
- **Assemble, don't reinvent.** Spend build budget on org-specific governance, not on re-implementing mature OSS tools.

---

## Common Mistakes

- **A golden path slower than the hand-rolled script.** Teams route around it; governance evaporates. DX is not optional.
- **Unversioned reusable workflow.** One central change breaks every team at once. Version it; canary it.
- **Uniform heavy governance.** Treating an internal-library patch like a payments release. Calibrate to risk tiers.
- **Audit as an afterthought.** Scrambling to reconstruct release history at audit time instead of emitting evidence continuously.
- **Big-bang migration.** Forcing 200 teams to switch at once. Strangle it: pilot, shadow, incremental, pull.
- **Optimizing deployment frequency in isolation.** Goodhart's law — pair it with change-failure-rate.
- **Building bespoke what OSS already does.** Re-implementing goreleaser/changesets instead of assembling them.
- **No break-glass.** When the controls themselves break, teams either can't ship a critical fix or bypass everything unlogged.

---

## Test Yourself

1. Why is a *versioned* reusable workflow essential, and what failure does an unversioned one cause?
2. Explain "paved road, not walled garden." What happens when the paved road is slower than a team's own script?
3. How do you add an approval gate to an automated release *without* reintroducing the manual bottleneck?
4. List four pieces of evidence a complete release audit trail captures and where each comes from.
5. Which DORA metrics does release automation most directly improve, and which one must you watch doesn't worsen?
6. Outline a strangler migration from manual to automated releases for a 60-service org.
7. Why must the release platform itself have SLOs and a canary strategy?
8. Give the deciding factors for assemble vs buy vs build.

---

## Cheat Sheet

```text
PAVED ROAD
  one versioned reusable workflow (@v3) → teams adopt in ~8 lines
  central hardening (keyless sign, trusted publish, provenance) inherited everywhere
  must be the EASIEST path or teams route around it

GOVERNANCE (calibrate to risk)
  who-can-trigger: branch protection + environment
  approvals: gated environment (human go-decision, automated work)
  separation of duties: author ≠ approver ≠ trigger
  policy-as-code: no release without scan + provenance + changelog

AUDIT / NON-REPUDIATION
  what=tag+digest  source=SLSA provenance  who=OIDC actor
  approved-by=env record  signed-by=Sigstore cert + Rekor log
  byproduct of security controls, not a separate project

DORA
  ↑ deploy frequency  ↓ lead time  watch change-failure-rate (Goodhart)
  instrument from the pipeline itself

MIGRATION (strangler, not big-bang)
  pilot → shadow mode (PR-only) → commitlint warn→required →
  automate step-by-step → extract paved road → let success pull adoption

PLATFORM RELIABILITY
  release pipeline = tier-1 service: SLOs, canary @v-bumps, runbook, on-call, break-glass

BUY vs BUILD vs ASSEMBLE
  default = assemble OSS + own the governance integration
```

---

## Summary

At the professional tier, release automation is an organizational capability. You build it as a paved road — one versioned, centrally-hardened reusable workflow that every team adopts in a few lines, inheriting keyless signing, trusted publishing, provenance, and DORA instrumentation — and you keep it the path of least resistance so teams choose it freely. You make release a governed action calibrated to risk: who can trigger, gated approvals that keep the work automated while making the go-decision human, separation of duties, and policy-as-code, all producing an audit trail and non-repudiation as a byproduct of the security controls rather than a separate effort. You prove value with DORA (frequency and lead time up, change-failure-rate watched against Goodhart), and you migrate from manual without a big bang via a strangler approach that leads with trust-building shadow mode and lets success pull adoption. Finally, because centralization creates a tier-1 dependency, you operate the release platform itself with SLOs, canaries, runbooks, on-call, and break-glass — and you assemble from mature OSS rather than reinventing it, spending your budget on the governance that is genuinely specific to your org.

---

## Further Reading

- *Accelerate* — Forsgren, Humble, Kim (DORA research foundation)
- [GitHub reusable workflows](https://docs.github.com/actions/using-workflows/reusing-workflows)
- [SLSA framework](https://slsa.dev/) and [Sigstore](https://www.sigstore.dev/)
- [Open Policy Agent / Conftest](https://www.openpolicyagent.org/) for policy-as-code
- [Team Topologies](https://teamtopologies.com/) — platform teams and paved roads
- [Google SRE Workbook — Canarying Releases](https://sre.google/workbook/canarying-releases/)

---

## Related Topics

- [Versioning and SemVer](../01-versioning-and-semver/) — standardized across the paved road.
- [Changelogs and Release Notes](../02-changelogs-and-release-notes/) — generated consistently org-wide.
- [Artifact Signing and Provenance](../04-artifact-signing-and-provenance/) — the centralized hardening teams inherit.
- [Registries and Distribution](../05-registries-and-distribution/) — trusted publishing as org default.
- [Rollback and Roll-forward](../07-rollback-and-roll-forward/) — failure handling for the release system.
- [Supply-chain Security](../09-supply-chain-security/) — policy-as-code and provenance verification.
- [Engineering Metrics and DORA](../../engineering-metrics-and-dora/) — measuring the automation's impact.
- [Quality Gates](../../quality-gates/) — required checks, policy-as-code, break-glass.
