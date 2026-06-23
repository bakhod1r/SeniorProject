# Supply-Chain Security — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Supply-Chain Security
>
> *A question bank for the chain, the incidents, and the program — with what each question is really testing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Threat Model & Incidents](#threat-model--incidents)
6. [Scenarios](#scenarios)
7. [Rapid-Fire](#rapid-fire)
8. [Red Flags / Green Flags](#red-flags--green-flags)
9. [Cheat Sheet](#cheat-sheet)
10. [Summary](#summary)
11. [Further Reading](#further-reading)
12. [Related Topics](#related-topics)

---

## Introduction

> Focus: **answering supply-chain questions the way a strong engineer does — precise on the chain and the real incidents, fluent in SBOMs and provenance, and able to design a program that trades assurance against velocity.**

Supply-chain questions reward *precision*. Anyone can say "use SBOMs"; an interviewer is listening for whether you know an SBOM is an inventory not a guarantee, what `go.sum` actually verifies, why a *signature* didn't save SolarWinds customers, and how you'd answer "are we affected, and where" at 2 a.m. This bank uses **Q** / *what's really being tested* / **A** format. Signing *mechanics* are deferred to [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/); know the boundary and say so in an interview.

---

## Prerequisites

- The junior–professional tiers of this topic.
- Comfort with the real incidents: SolarWinds, xz/liblzma (2024), dependency confusion (2021), event-stream, Codecov, left-pad, Log4Shell.
- Working vocabulary: SBOM, SPDX/CycloneDX, PURL, SLSA, SSDF, provenance, attestation, VEX, OIDC trusted publishing.

---

## Fundamentals

**Q1. Define the software supply chain and explain why every link is an attack surface.**
*Testing: do you have the mental model, or just buzzwords?*
**A.** The supply chain is **source → build → publish → consume**, recursively across every dependency. Each edge is attackable: source (compromise the repo or a maintainer — xz), build (implant during compilation — SolarWinds), publish (account takeover, typosquat, dependency confusion), consume (a tampered or vulnerable install). The core point: you don't just trust the package you chose — you trust its authors, their credentials, the registry, the build that produced it, and *every transitive dependency*, recursively. A weakness anywhere becomes your weakness, running with your privileges.

**Q2. What is an SBOM, and what does it *not* give you?**
*Testing: whether you over-claim. Many candidates treat SBOM as a security guarantee.*
**A.** A Software Bill of Materials is a structured, machine-readable inventory of every component in an artifact — versions, ideally licenses and hashes, each named by a PURL. Formats: **SPDX** (ISO standard, license-strong) and **CycloneDX** (OWASP, security/VEX-strong). Its value is *fast queries*: "am I affected by CVE-X" in minutes, license audits, drift detection. What it is **not**: a guarantee. It says what's *in* the box, nothing about whether those components are safe, whether the build was clean, or whether the SBOM is even accurate. It's the map that makes response fast — not the defense itself.

**Q3. Precisely, what does `go.sum` protect, and what doesn't it protect?**
*Testing: the integrity-vs-quality distinction — a classic separator.*
**A.** `go.sum` stores cryptographic hashes of each module's files (`h1:`) and its `go.mod`. On build, Go verifies downloaded modules against these hashes (and, by default, against the checksum DB `sum.golang.org`); a mismatch fails the build. So it protects **integrity**: nobody — author, proxy, MITM — can alter a module's bytes after the line was recorded without detection. It does **not** protect **quality or intent**: a backdoored module with a stable hash passes perfectly. A hash proves *same*, not *safe*. Defending against malicious-from-the-start code needs review, scanning, and provenance.

**Q4. Version range vs pinned version vs hash-pinned — what does each stop?**
*Testing: understanding the controls, not just naming them.*
**A.** A **range** (`^1.2.0`) lets any matching future release flow in unreviewed — the event-stream channel. A **pinned version** stops surprise version bumps but not a content swap of that version. **Hash pinning** (lockfile `integrity`, `go.sum`, `pip --require-hashes`) stops content tampering — the bytes must match. **Vendoring** goes further: you commit the source, removing registry availability *and* tampering risk and making dependency changes reviewable diffs. Climb the ladder by blast radius.

---

## Technique

**Q5. Walk me through generating and using an SBOM in a pipeline.**
*Testing: practical fluency and the generate-vs-use split.*
**A.** Generate at build time with `syft` — and prefer the *built image* over source, because the image reflects what actually ships including OS packages: `syft "$IMAGE@$DIGEST" -o cyclonedx-json=sbom.cdx.json`. Attach it as a signed attestation so its integrity is verifiable (`cosign attest`, mechanics in [topic 04](../04-artifact-signing-and-provenance/)). Then *use* it: scan the SBOM, not the filesystem — `grype sbom:sbom.cdx.json` or `osv-scanner --sbom=...` — so you separate the slow "what's in it" (once, at build) from the fast "what's now known-vulnerable" (continuously, as advisories update). Store it in a corpus (Dependency-Track) so the whole fleet is re-matched against new CVEs without rebuilding.

**Q6. How do you defend against dependency confusion?**
*Testing: knowledge of the 2021 Birsan class and concrete mitigations.*
**A.** Dependency confusion (Birsan, 2021) exploits resolvers preferring a higher-versioned *public* package over your private one of the same name — it ran inside Apple, Microsoft, and others. Mitigations, increasing strictness: (1) **namespace/scope** internal packages (`@yourco/...`) and **explicitly route** those names to your registry so a private name is never resolvable publicly; (2) a **private mirror/proxy** (Artifactory, Nexus, `GOPROXY`) so all installs go through a registry you control; (3) an **allowlist** serving only approved packages. The principle: names aren't identity — *source* is part of the identity, so decide where deps resolve from on purpose.

**Q7. Where does provenance verification fit, and how is it different from a signature?**
*Testing: the SolarWinds insight and the verify-before-trust gate.*
**A.** A signature proves *who* signed ("the key holder"). **Provenance** proves *what* was built and *from where*: this artifact came from commit X of repo Y, built by builder Z. SolarWinds shipped a *validly signed* backdoor because the build was compromised — the signature was authentic, the artifact wasn't. So you verify provenance as a **fail-closed gate** at promote/admission — `cosign verify-attestation --type slsaprovenance` checking expected source, builder identity, and ideally workflow — rejecting anything signed by the wrong identity or built outside your sanctioned pipeline. Mechanics live in [topic 04](../04-artifact-signing-and-provenance/); the design point is *the gate must reject, not warn*.

**Q8. What makes a build hermetic, reproducible, and ephemeral — and why care?**
*Testing: build integrity depth.*
**A.** **Hermetic** = the build sees only declared inputs (pinned deps, pinned toolchain, no mid-build network) — a build that `curl`s a script isn't hermetic (the Codecov hole). **Reproducible** = same source yields bit-for-bit identical output, so an independent rebuild matching the published hash *proves* the artifact matches the source (would catch SolarWinds-style implantation). **Ephemeral** = a fresh runner per job, destroyed after, so an attacker can't persist an implant. Together they remove undeclared inputs, prove the output, and remove persistence — the preconditions that make provenance trustworthy.

---

## Threat Model & Incidents

**Q9. Walk through SolarWinds and the one lesson that reframes "just sign your artifacts."**
*Testing: do you understand why signing is necessary but insufficient?*
**A.** Attackers implanted SUNBURST during the *build*, so Orion updates compiled with the backdoor were then *correctly signed* with SolarWinds' key and shipped to ~18,000 orgs. Customers verified the signature — valid — and installed a backdoor. Lesson: **signing a compromised build gives you an authentic lie.** The fix isn't "sign harder"; it's provenance (tie the artifact to reviewed source + a sanctioned builder), build integrity (hermetic/ephemeral), and reproducibility (an independent audit), plus verifying all of it before trust.

**Q10. The xz/liblzma backdoor — what happened and what's the systemic lesson?**
*Testing: awareness of the 2024 incident and the human/maintainer angle.*
**A.** Over roughly two years an attacker built maintainer trust on `xz`, then slipped a backdoor into *release tarballs* (which differed from the git source) targeting SSH via liblzma. It was caught by luck — a Postgres engineer noticed a ~0.5s SSH slowdown — days before wide distribution. Lessons: (1) trusted upstreams are compromised through *people*, not just code; (2) maintainer **bus factor** (xz was effectively one exhausted maintainer) is a security signal; (3) a tarball-vs-source discrepancy is exactly what **reproducible builds** and source-tied provenance catch.

**Q11. Contrast event-stream, Codecov, and left-pad — three different failure modes.**
*Testing: precision; these are often blurred together.*
**A.** **event-stream (2018)** — *malicious maintainer handoff*: a popular npm package was given to a volunteer who added a malicious *transitive* dependency to steal wallets; it entered via a version range. **Codecov (2021)** — *CI script tamper*: a compromised bash uploader exfiltrated environment secrets from thousands of pipelines; lessons are no-network builds, OIDC short-lived secrets, least-privilege runners. **left-pad (2016)** — *availability, not attack*: an 11-line package was unpublished and broke thousands of builds, proving tiny transitive deps are real deps and the registry is a runtime dependency. Three distinct edges: publish-trust, build, availability.

**Q12. Why is the build the highest-value target in the chain?**
*Testing: prioritization reasoning.*
**A.** Because its output is *automatically trusted* (signed and released as legitimate), it holds source + secrets + signing keys + network simultaneously, and its output fans out to *every* downstream consumer at once. One build compromise = thousands of downstream compromises, all wearing a valid signature. That's why senior controls focus on isolating and proving the build, and why CI/CD must be treated as production infrastructure.

---

## Scenarios

**Q13. A new CRITICAL CVE drops in a widely-used logging library at 2 a.m. Walk me through your response.**
*Testing: the "are we affected, and where" muscle — the whole-program payoff.*
**A.** (1) **Scope** — query the SBOM corpus for the affected PURL + version range across *all deployed artifacts*; minutes if I built the corpus, days if I didn't. (2) **Assess reachability** — present? reachable? exploitable in our config? record a VEX verdict per artifact. (3) **Contain** — for exploitable+exposed services, block via admission policy / pull the artifact / apply config or WAF mitigation while the patch builds. (4) **Remediate** — bump, rebuild, re-provenance, redeploy, then *re-query the corpus* to confirm zero affected artifacts remain *in prod* ("patched the repo" ≠ "no longer affected"). (5) **Learn** — postmortem the detection-to-remediation timeline; the metric is fleet MTTR. I'd also mention we *rehearse* this on a fictional CVE so the first run isn't during a real fire.

**Q14. Same, but it's a *malicious* dependency (a maintainer handoff like event-stream), not a vuln.**
*Testing: do you treat compromise differently from vulnerability?*
**A.** Everything in Q13, plus: build integrity is now in question, so I **assume the worst about anything the malicious code could reach** — rotate every secret the build or running app could have touched (Codecov taught us to assume exfiltration), revoke tokens, and audit for the compromise's indicators (unexpected network calls, new transitive deps, modified scripts). Then I remediate the dependency (pin to a known-good version, fork/patch, or remove), and harden the channel that let it in (review gate on new/changed deps, private mirror).

**Q15. You join a team with no supply-chain controls. What's your 90-day plan, and how do you avoid breaking delivery?**
*Testing: sequencing, ROI sense, and the assurance-vs-velocity trade.*
**A.** Sequence by leverage and blast radius, fail-closed but staged: **Weeks 1–4 (hygiene):** enforce lockfiles + `npm ci`/`go mod verify`, gate a scanner (`osv-scanner`) in CI, turn on Dependabot/Renovate, start generating + storing SBOMs. **Weeks 5–8 (controlled):** private mirror + namespacing (kill dependency confusion), hash pinning, OIDC publish (kill long-lived tokens), SBOM corpus + continuous monitoring. **Weeks 9–12 (verified):** emit provenance, add a verification gate in **audit/dry-run** first, fix the tail, then enforce on released artifacts; require two-person review on release config. Throughout: match assurance to blast radius (crown jewels first), keep gates fast, and provide break-glass so nobody disables a control permanently. Most risk reduction per dollar is in the first two phases.

**Q16. Leadership wants "SLSA Level 3 everywhere by Q3." How do you respond?**
*Testing: pushback with judgment, not compliance theater.*
**A.** I'd reframe from a binary to a *risk-matched ladder*. L3 (hermetic, isolated builders with non-forgeable provenance) is expensive; applying it uniformly burns budget and velocity for little marginal risk on low-blast-radius artifacts. I'd propose: L1 everywhere now (emit provenance), L2 on all released artifacts this quarter (signed provenance via OIDC), L3 on **crown-jewel, internet-facing artifacts** next — tracking the gap per artifact tier as explicit, owned risk. And I'd warn against the worst outcome: a half-built L3 where provenance is generated but never *verified*, which looks mature and defends nothing.

---

## Rapid-Fire

**Q17. SPDX vs CycloneDX?** *A.* Both SBOM formats; SPDX is an ISO standard, license-strong, common in procurement; CycloneDX is OWASP, security/VEX-strong. Good tools emit both.

**Q18. What is a PURL?** *A.* Package URL — a canonical cross-tool identifier like `pkg:npm/lodash@4.17.21`, the key for matching CVEs to SBOM components.

**Q19. `npm ci` vs `npm install`?** *A.* `npm ci` installs exactly from the lockfile and fails if out of sync; `npm install` may re-resolve and mutate the lockfile. Use `ci` in pipelines.

**Q20. What does OIDC trusted publishing eliminate?** *A.* Long-lived publish tokens — CI exchanges a short-lived, identity-bound credential at job time, so there's no static secret to steal (the Codecov pattern).

**Q21. What is VEX for?** *A.* A machine-readable "affected / not affected (because X)" statement, so triage verdicts survive re-scans and reduce CVE noise.

**Q22. SSDF in one line?** *A.* NIST SP 800-218 — a secure-development practice catalog (Prepare/Protect/Produce/Respond) auditors map against; driven into contracts by EO 14028.

**Q23. What does OpenSSF Scorecard measure?** *A.* A repo's security posture — branch protection, signed releases, pinned deps, fuzzing — usable for your own repos *and* evaluating dependencies.

**Q24. in-toto vs SLSA?** *A.* in-toto is the attestation *substrate* (cryptographically attest each step); SLSA provenance is expressed *as* in-toto attestations. They compose, not compete.

**Q25. One reason to vendor dependencies?** *A.* Removes registry-availability risk (the left-pad failure) and makes dependency changes reviewable diffs.

**Q26. Why pin CI actions by SHA, not tag?** *A.* A mutable tag (`@v4`) can be re-pointed at malicious code; your CI config is a dependency graph too.

---

## Red Flags / Green Flags

**Red flags**
- Says "we use SBOMs" but can't say what they *don't* guarantee, or never queries them.
- Thinks a valid signature means a trustworthy artifact (misses SolarWinds).
- Conflates `go.sum`/hashes with "secure" (misses integrity vs. quality).
- Proposes SLSA L3 everywhere with no blast-radius reasoning.
- Generates provenance but never verifies it; verification gate fails *open*.
- Can't answer "are we affected, and where" without a multi-day manual audit.
- Stores long-lived publish tokens when OIDC is available; long-lived shared runners.

**Green flags**
- Precise on the chain and which incident maps to which edge.
- Knows SBOM = inventory/map, not guarantee; separates generate (build-time) from scan (continuous).
- States the signature-vs-provenance distinction unprompted and gates fail-closed.
- Matches assurance to blast radius; treats SLSA as a ladder.
- Has a rehearsed IR runbook and tracks MTTD/MTTR.
- Treats CI/CD as production infra (least privilege, ephemeral, two-person review, OIDC).
- Defers signing mechanics cleanly to the signing topic instead of bluffing.

---

## Cheat Sheet

```bash
# Inventory + scan
syft "$IMAGE@$DIGEST" -o cyclonedx-json=sbom.cdx.json
grype sbom:sbom.cdx.json
osv-scanner --lockfile=package-lock.json

# Integrity / pinning
go mod verify
pip install --require-hashes -r requirements.txt

# Provenance verification (mechanics: topic 04) — fail closed
cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp '^https://github.com/yourco/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com "$IMAGE" || exit 1

# Posture
scorecard --repo=github.com/yourco/service
```

| Incident | Edge | One-line lesson |
|----------|------|-----------------|
| SolarWinds | build | A signed compromised build is an authentic lie → provenance + verify. |
| xz (2024) | source/maintainer | Trusted upstreams fall to *people*; bus factor is a security signal. |
| Dep. confusion | publish/consume | Names aren't identity; control where deps resolve from. |
| event-stream | publish/maintainer | Maintainer trust transfers silently; gate new deps. |
| Codecov | build/CI | Protect CI; use OIDC short-lived secrets; assume exfiltration. |
| left-pad | availability | Tiny transitive deps are real deps; the registry is a runtime dep. |

---

## Summary

Interviewers probe supply-chain knowledge for **precision and judgment**. Be exact about the chain (source → build → publish → consume) and which incident maps to which edge. Know the distinctions that separate strong answers: SBOM is an *inventory and a map*, not a guarantee; a *hash proves same, not safe*; a *signature proves who, provenance proves what and from where* (the SolarWinds reframe); SLSA is a *ladder matched to blast radius*, not a binary. Demonstrate the operational muscle — generate SBOMs at build, scan continuously, verify provenance as a *fail-closed* gate, treat CI/CD as production, and answer "are we affected, and where" from a corpus in minutes via a *rehearsed* runbook. And know the boundary: defer signing cryptography to [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/), and say so rather than bluff.

---

## Further Reading

- SLSA (slsa.dev), NIST SP 800-218 (SSDF), Executive Order 14028.
- OWASP — CycloneDX, Dependency-Track; CISA SBOM and VEX guidance.
- OpenSSF — Scorecard and supply-chain best practices; Sigstore (cosign, Fulcio, Rekor).
- Alex Birsan — "Dependency Confusion" (2021); the Reproducible Builds project.
- Public post-incident analyses of SolarWinds, the xz backdoor (2024), and Codecov.

---

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — the signing/attestation/SLSA mechanics this bank defers to.
- [Registries & Distribution](../05-registries-and-distribution/) — registries, mirrors, admission, distribution.
- [Release Automation](../08-release-automation/) — gates and verification in the pipeline.
- [Build Systems](../../build-systems/) and [Static Analysis](../../static-analysis/) — adjacent assurance areas.
- Topic tiers: [Junior](junior.md) · [Middle](middle.md) · [Senior](senior.md) · [Professional](professional.md).
