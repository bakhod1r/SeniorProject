# Release Automation — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Release Automation

*A question bank for interviews where release automation comes up — from "what is semantic-release" to "design our org's release platform."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Tooling Trade-offs](#tooling-trade-offs)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering release-automation questions the way a strong senior/staff candidate does — with the pipeline model, the trade-offs, and the security and governance dimensions, not just tool names.**

Release automation shows up in interviews for platform, DevOps, SRE, and senior backend roles, and inside system-design rounds ("how would you ship this service?"). Weak candidates name a tool. Strong candidates describe the pipeline as a sequence of idempotent steps, reason about failure and recovery, and bring up signing, secrets, and governance unprompted. This page is structured as model Q&A: each question states *what's really being tested* and gives an answer you can adapt.

---

## Prerequisites

- The four tier pages: [junior](./junior.md), [middle](./middle.md), [senior](./senior.md), [professional](./professional.md).
- Comfort discussing [SemVer](../01-versioning-and-semver/), [signing/provenance](../04-artifact-signing-and-provenance/), and [registries](../05-registries-and-distribution/).
- Familiarity with [DORA metrics](../../engineering-metrics-and-dora/).

---

## Fundamentals

**Q1. What is release automation and why does it matter?**
*What's tested: do you understand the goal beyond "running scripts"?*
**A.** It's encoding the whole merge-to-published-release sequence — derive version, generate changelog, tag, build, sign, publish, create the release, notify — as a pipeline, so releasing requires no manual steps. It matters because manual releases are slow, error-prone, irreproducible, and gated behind one person's laptop. The real payoff is behavioral: automation makes releasing boring and cheap, so teams release frequently in small increments, and small frequent releases are the single biggest lever for safe, fast delivery. It also turns the version and changelog into computed outputs rather than hand-maintained artifacts that drift.

**Q2. Walk me through the steps of an automated release pipeline.**
*What's tested: do you have the canonical mental model?*
**A.** Trigger (push to main, a tag, or a release-PR merge) → derive next version from commit history → generate the changelog → create and push a git tag → build artifacts for all targets → sign and attest (cosign + SLSA provenance) → publish to the registry → create the GitHub/GitLab release with notes and assets → notify. Two properties run through it: every step is idempotent, and irreversible steps (publish) come after reversible ones (build), so a build failure never strands a half-released version.

**Q3. How does a tool know whether to bump major, minor, or patch?**
*What's tested: the input contract.*
**A.** From Conventional Commits. `fix:` → patch, `feat:` → minor, and a `!` or a `BREAKING CHANGE:` footer → major. The tool reads all commits since the last release tag and takes the highest bump implied. The same commits, grouped by type, become the changelog. The catch: this only works if commit messages actually follow the format, which is why you enforce it with commitlint and a required PR-title check — under squash-merge, the PR title is the source of truth.

**Q4. What does "idempotent release" mean and why do you need it?**
*What's tested: understanding of re-run safety.*
**A.** Re-running the pipeline has the same effect as running it once — no double-publish. You need it because CI runners die, networks fail, and you must be able to re-run safely. Achieve it structurally (tag-driven trigger: a tag can only exist once, so it acts as a mutex) or logically (before publishing, check whether the version already exists on the registry and skip if so). Never rely on the registry to enforce it: npm refuses republish, but most OCI registries silently overwrite a mutable tag.

---

## Technique

**Q5. Your pipeline published the npm package, then the runner crashed before creating the GitHub Release. What now, and how do you prevent the next one being painful?**
*What's tested: partial-release handling — a senior signal.*
**A.** That's a partial release: the package is live but undocumented. To recover, re-run the pipeline if it's designed for it: every step should be skip-if-done, so the npm step sees the version exists and skips, the tag step skips, and the GitHub Release step creates the missing release. To make this reliable: build the pipeline as small discrete idempotent steps (not one monolithic script that can't resume), put irreversible steps as late as possible, alert on partial state so a human knows to re-run, and keep a runbook for cases automation can't self-heal. The honest framing: you can't make a multi-system release atomic, so you make it idempotent + resumable + observable.

**Q6. How do you sign artifacts in a fully automated pipeline without a human holding the key?**
*What's tested: keyless signing — strong supply-chain signal.*
**A.** Keyless signing via Sigstore. The CI job proves its identity with the OIDC token GitHub Actions mints automatically; Fulcio issues a short-lived certificate bound to that workflow identity; cosign signs with an ephemeral key, logs to the Rekor transparency log, and discards the key. There's no long-lived signing key to leak — which is the catastrophic single point of failure of the naive approach (a private key stored as a CI secret). Verification then pins the certificate-identity regex to your specific release workflow, so the signature attests "produced by our release pipeline," not merely "a valid key."

**Q7. How do you publish to npm/PyPI without a long-lived token in CI?**
*What's tested: trusted publishing / secrets hygiene.*
**A.** Trusted publishing via OIDC. You configure the registry to trust a specific repo + workflow; at publish time the workflow presents its OIDC token and the registry issues a short-lived publish grant. No token is stored. This eliminates the most-attacked secret in the ecosystem — leaked `NPM_TOKEN`s are exactly how several supply-chain compromises happened. On npm, `npm publish --provenance` additionally records which workflow run built the package, giving consumers verifiable build origin. The general principle, straight from the secrets-management playbook: prefer ephemeral federated identity over stored secrets everywhere.

**Q8. How do you release a monorepo with 40 packages?**
*What's tested: the release-graph problem.*
**A.** You release only what changed plus everything that depends on it. First, affected detection: which packages have diffs since the last release. Second, transitive propagation through the dependency DAG: if a shared package changed, its dependents must release too. Crucially, publish in topological order — dependencies before dependents — so a dependent never references a version that doesn't exist yet. Choose fixed versioning (all bump together; simple but phantom bumps) or independent (per-package; meaningful but needs the release graph). changesets handles this with explicit per-PR intent files and `updateInternalDependencies` to propagate bumps.

---

## Tooling Trade-offs

**Q9. semantic-release vs release-please vs changesets vs goreleaser — when do you reach for each?**
*What's tested: can you match tool to context rather than cargo-culting one?*
**A.**
- **semantic-release** — JS single package, fully automatic on every qualifying merge, version inferred from commits, no human gate. Best when you want continuous, hands-off releasing.
- **release-please** — multi-language, the release-PR model: it maintains a "release X.Y.Z" PR that accumulates changes; merging it cuts the release. Best when you want a human approval point and a reviewable preview of the next version/changelog, plus an audit trail.
- **changesets** — JS monorepos. Contributors *declare* intent in a markdown changeset file per PR; release time bumps each package independently with per-package changelogs. Best when commit-inference is too coarse because one PR spans multiple packages.
- **goreleaser** — Go, tag-driven: cross-compiles, archives, signs, generates SBOM/provenance, publishes, and updates a Homebrew tap. Best for shipping Go binaries/images.

The meta-point: pick by language and by release *philosophy* (continuous vs gated, inferred vs declared intent).

**Q10. semantic-release infers version from commits; changesets makes contributors declare it. Which is better?**
*What's tested: nuance, not dogma.*
**A.** Neither universally. Inference (semantic-release) is lower-friction at commit time and great for single packages — the version is free if commits are disciplined. Declaration (changesets) is more work per PR but far clearer in a monorepo where one PR affects several packages with different intents, and the changeset note is human-written prose rather than a terse commit. Rule of thumb: single package → infer; monorepo → declare. The trade is friction vs precision.

**Q11. Tag-driven (goreleaser) vs push-to-main (semantic-release) triggers — trade-offs?**
*What's tested: trigger-model understanding.*
**A.** Tag-driven gives you structural idempotency (a tag exists once, so the release for that version can only start once) and an explicit human decision of *when* and *what version*. Push-to-main is more continuous and removes the manual tag step, but needs an internal version-exists guard to be idempotent and computes the version for you. Tag-driven suits deliberate releases of binaries; push-to-main suits continuous library releasing. The release-PR model (release-please) is a third option: continuous accumulation, human-gated cut.

---

## Scenarios

**Q12. Design the standard release pipeline for an org of 200 services.**
*What's tested: platform thinking — the staff-level question.*
**A.** Build a paved road: one centrally-owned, *versioned* reusable workflow (`org/.github@v3`) that implements derive-version, changelog, tag, build, keyless signing, provenance, trusted publishing, release creation, and DORA emission. Teams adopt it in ~8 lines of config pinning a major version. Key decisions: version the workflow so improvements ship as minors and breaking changes as a deliberate major migration; canary new workflow versions to a few repos before org-wide; calibrate governance to risk (frictionless for internal libs, gated approvals + separation of duties for high-risk services via protected environments); emit audit evidence (provenance, approval records, Rekor entries) as a byproduct; instrument DORA. Operate the platform itself as a tier-1 service with SLOs, runbooks, on-call, and break-glass, because it's now a single point of failure for everyone's releases. The whole thing must stay the path of least resistance or teams route around it.

**Q13. We release manually today across 60 services. How do you migrate to automation?**
*What's tested: change management, not just tech.*
**A.** Strangler, not big-bang. Pilot on a low-risk internal library and make its automated release excellent and visible. Run automation in shadow mode first — compute version/changelog and open a PR without publishing — so teams trust the output before handing over publish. Roll out commitlint warn-only, then required, to establish the commit contract. Automate one step at a time where teams are nervous (changelog → tag → publish to a test registry → publish for real). Extract the paved road once a few pilots converge. Then let success pull adoption: publish the before/after (release time 90min → 5min, zero botched releases), so teams ask to onboard; mandate only the laggards. The technical work is weeks; org adoption is the year-long part.

**Q14. How do you add governance/approvals to automated releases without recreating the manual bottleneck?**
*What's tested: balancing control and velocity.*
**A.** Keep the *work* automated; make only the *go-decision* human, and only where risk warrants it. Use a gated environment (`production-release`) with required reviewers — the pipeline pauses, an approver clicks, it continues; the build/sign/publish are still fully automated. Enforce separation of duties (author ≠ approver) via CODEOWNERS and required reviews. Encode hard rules (no release without passing security scan / signed provenance) as policy-as-code so they can't be skipped. Calibrate to risk tiers: an internal-library patch needs near-zero gating, a payments release needs the full set. Uniform heavy governance is how you kill velocity and drive teams off the paved road.

**Q15. How do you prove to an auditor who released what, when, and with what approval?**
*What's tested: audit / non-repudiation.*
**A.** The automated pipeline produces this as a byproduct: the git tag + commit SHA + artifact digest say *what*; SLSA provenance says *from what source*; the CI run actor + OIDC identity says *who triggered*; the gated-environment record says *who approved*; the Sigstore certificate identity + the Rekor transparency-log entry say *what signed it* and *when*, in a public append-only log you can't repudiate. So the audit answer is "export these artifacts," not "reconstruct what happened." Design for the auditor up front; once the security controls exist, the evidence is nearly free — and it's far stronger than any manual "Jane built it on her laptop."

---

## Rapid-Fire

**Q16.** Why `fetch-depth: 0` in the checkout? — *The tool needs full git history to find the last release and read all commits since.*

**Q17.** What's a dist-tag / channel? — *A named release stream consumers subscribe to (`latest`, `next`, `beta`); map branches to channels.*

**Q18.** How do you ship a 1.x security backport while latest stays 2.x? — *Cherry-pick the fix onto the 1.x maintenance branch; the tool scopes version computation to that range and publishes to the 1.x channel.*

**Q19.** What does `--provenance` add to `npm publish`? — *A signed SLSA statement recording which workflow run built and published the package.*

**Q20.** Why must a reusable release workflow be versioned? — *So a central change doesn't break every consuming team at once; they pin a major and migrate deliberately.*

**Q21.** Two DORA metrics release automation improves? — *Deployment frequency and lead time for changes (watch change-failure-rate doesn't rise — Goodhart).*

**Q22.** What's the danger of mutable OCI tags in releases? — *Two releases can overwrite the same tag; consumers get different bits silently. Pin to digests.*

**Q23.** commitlint local hook vs CI check — which guarantees the contract? — *The CI check (required status). Local hooks improve DX but can be bypassed.*

**Q24.** What's break-glass in release context? — *A logged, time-boxed emergency path to release when the normal controls themselves are broken; reviewed after the fact.*

**Q25.** Why publish before creating the GitHub Release, not after? — *Put irreversible steps last; but recognize some step is always "last irreversible," so recovery must cover a crash right after it.*

---

## Red Flags / Green Flags

**Red flags in a candidate:**
- Names a tool but can't describe the pipeline steps or why they're ordered that way.
- Thinks a release is "just `npm publish`" — no mention of version, changelog, signing, idempotency.
- Stores long-lived signing keys / publish tokens in CI secrets and sees no problem.
- "Just re-run it" with no understanding of double-publish or partial-release risk.
- Proposes a big-bang migration of an org to automated releases.
- Treats governance as either nonexistent or uniformly heavy.

**Green flags:**
- Describes the pipeline as ordered idempotent steps with irreversible steps last.
- Brings up Conventional Commits *and* its enforcement (commitlint + required PR-title check) unprompted.
- Reaches for keyless signing and trusted publishing to eliminate long-lived secrets.
- Reasons about partial-release recovery: idempotent + resumable + observable.
- Matches tool to topology and philosophy (monorepo → changesets, continuous → semantic-release, gated → release-please).
- For org scale: paved road, versioned reusable workflow, risk-calibrated governance, audit as byproduct, strangler migration.
- Connects release automation to DORA outcomes and warns about Goodhart.

---

## Cheat Sheet

```text
PIPELINE
  trigger → version → changelog → tag → build → sign → publish → release → notify
  idempotent steps, irreversible LAST

INPUT CONTRACT
  conventional commits: fix→patch feat→minor feat!/BREAKING→major
  enforce: commitlint + REQUIRED PR-title check; squash → PR title is truth

IDEMPOTENCY / RECOVERY
  tag = mutex; check-then-skip publish; never trust registry to enforce
  partial release → re-run if every step skip-if-done; can't be atomic → resumable+observable

NO LONG-LIVED SECRETS
  sign: keyless (Sigstore/OIDC, ephemeral cert, Rekor log)
  publish: trusted publishing (OIDC); npm publish --provenance
  verify: pin cert-identity to the release workflow

TOOL PICKER
  Go→goreleaser  JS single→semantic-release  JS monorepo→changesets
  human gate→release-please  Rust→cargo-release  JVM→Maven/Gradle

MONOREPO
  release affected + dependents, in TOPOLOGICAL order; fixed vs independent

ORG SCALE
  paved road = versioned reusable workflow, adopted in ~8 lines
  governance calibrated to risk; audit = byproduct; DORA (watch Goodhart)
  migrate via strangler: pilot→shadow→incremental→pull
```

---

## Summary

Strong release-automation interview answers start from the pipeline model — ordered, idempotent steps with irreversible publishing last — and the Conventional Commits contract that feeds it, including its enforcement. They handle the hard cases honestly: idempotency via the tag-as-mutex and check-then-skip, partial-release recovery via idempotent + resumable + observable design, and the monorepo release graph requiring topological publish order. On security, the differentiator is reaching unprompted for keyless signing and trusted publishing to eliminate long-lived secrets, and being able to pin signer identity for verification. At staff level, the conversation moves to the paved road — a versioned reusable workflow adopted org-wide, governance calibrated to risk, audit evidence as a byproduct, DORA measurement with a Goodhart caveat, and a strangler migration from manual. Name tools, but lead with the model, the trade-offs, and the failure and governance dimensions.

---

## Further Reading

- [Conventional Commits](https://www.conventionalcommits.org/)
- [semantic-release](https://semantic-release.gitbook.io/), [changesets](https://github.com/changesets/changesets), [release-please](https://github.com/googleapis/release-please), [goreleaser](https://goreleaser.com/)
- [Sigstore](https://docs.sigstore.dev/) and [SLSA](https://slsa.dev/)
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
- *Accelerate* — Forsgren, Humble, Kim (DORA)

---

## Related Topics

- [Versioning and SemVer](../01-versioning-and-semver/) — what the version step computes.
- [Changelogs and Release Notes](../02-changelogs-and-release-notes/) — the changelog step's output.
- [Artifact Signing and Provenance](../04-artifact-signing-and-provenance/) — keyless signing in automation.
- [Registries and Distribution](../05-registries-and-distribution/) — trusted publishing.
- [Rollback and Roll-forward](../07-rollback-and-roll-forward/) — recovering from a bad release.
- [Supply-chain Security](../09-supply-chain-security/) — provenance verification.
- [Engineering Metrics and DORA](../../engineering-metrics-and-dora/) — measuring automation's impact.
- [Build Systems](../../build-systems/) — the build step feeding releases.
