# Registries & Distribution — Interview Level

> **Roadmap:** [Release Engineering](../README.md) → Registries & Distribution

*A question bank for proving you understand where artifacts live, how immutability works, and how to pull back a bad release without breaking the world.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Fundamentals](#fundamentals)
4. [Technique](#technique)
5. [Immutability & Yanking](#immutability--yanking)
6. [Scale, Resilience & Supply Chain](#scale-resilience--supply-chain)
7. [Scenarios](#scenarios)
8. [Rapid-Fire](#rapid-fire)
9. [Red Flags / Green Flags](#red-flags--green-flags)
10. [Cheat Sheet](#cheat-sheet)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Interviewers probe registries to see if you understand immutability, the tag-vs-digest distinction, the real semantics of pulling back a release (and why deleting is dangerous), and the registry's role as both a SPOF and a supply-chain chokepoint.**

This page is a graded question bank. Each entry gives the **Q**, a note on *what's really being tested*, and an **A** model answer. Read the "what's really being tested" line first — it tells you what depth the interviewer is fishing for.

## Prerequisites

- The concepts from [junior.md](junior.md) through [professional.md](professional.md).
- Hands-on with at least one container and one language registry.
- Awareness of the left-pad incident, crates.io yank, and Maven Central immutability.

## Fundamentals

**Q1. What is a registry, and what's the difference between a tag and a digest?**
*What's really being tested: do you know the core data model, not just commands.*
**A.** A registry is an HTTP service that stores and serves built artifacts (container images, packages). An artifact's true identity is its **digest** — a `sha256` hash of its content, immutable: change one byte, the digest changes. A **tag** (`v1.4.0`, `latest`) is a *mutable pointer* in a tag→digest table; it can be repointed at any time. So `app:1.4.0` is convenient but can change what it points to; `app@sha256:9b2c...` is the exact bytes, forever. Build and promote by tag; deploy and depend by digest.

**Q2. Why can't you republish the same version number to most registries?**
*What's really being tested: do you understand immutability as a contract, not an arbitrary restriction.*
**A.** A published `name@version` is an immutable promise: those exact bytes, forever. Three things depend on it: **reproducibility** (lockfiles/`go.sum` record version+hash; mutable bytes make them lies), **caching** (every CI runner, mirror, and CDN caches by coordinate; changing bytes serves stale-but-different content silently), and **security** (mutable coordinates are how supply-chain attacks swap trusted bytes). So registries reject republishing — npm returns 403, crates.io and Maven refuse. The fix is always to publish a *new* version, never to overwrite.

**Q3. Why is depending on the `latest` tag a problem?**
*What's really being tested: practical operational judgment.*
**A.** `latest` has no special meaning — it's a plain tag people repoint by convention. It (1) moves, so pulls today and tomorrow can differ, worsened by node caches that never re-pull because the tag name is unchanged; (2) hides what's running, breaking incident-to-commit correlation; and (3) defeats rollback, since "the previous latest" may be gone or unidentifiable. Use it only for throwaway local work. Production pins a specific version, ideally a digest, with `imagePullPolicy` set so immutable refs are reused safely.

**Q4. Walk me through publishing for three different ecosystems.**
*What's really being tested: breadth and recognizing Go's exception.*
**A.** Containers: `docker build -t ghcr.io/org/app:1.0.0 .` then `docker login` then `docker push`. npm: `npm publish` (reads name+version from `package.json`; add `--provenance`, `--access public` for scoped). PyPI: `python -m build` then `twine upload dist/*` (or OIDC trusted publishing in CI). Rust: `cargo publish`. Maven Central: `mvn deploy` to a *staging* repo, then close + release. **Go is the exception** — there's no push; you tag your Git repo (`git tag v1.0.0 && git push --tags`) and the Go module proxy fetches it from VCS on first request.

## Technique

**Q5. How do you deploy something so you're certain exactly which bytes run?**
*What's really being tested: deploy-by-digest discipline.*
**A.** Resolve the tag to its digest at build/promote time (`docker buildx imagetools inspect repo/app:1.4.0` shows the `sha256`), then deploy by digest: `kubectl set image deploy/app app=repo/app@sha256:...`. A digest can't be silently repointed, so the running workload can never drift even if someone retags. In language ecosystems the analog is the lockfile integrity hash (`package-lock.json` `integrity`, `go.sum`), which the tooling verifies on every download.

**Q6. How does trusted publishing work and why is it better than a publish token?**
*What's really being tested: modern credential hygiene.*
**A.** Long-lived publish tokens are broadly scoped, rarely rotated, and catastrophic if leaked (CI logs, committed `.npmrc`). Trusted publishing replaces them: the CI provider issues a short-lived **OIDC** token asserting "this run is repo X, workflow Y," and the registry, configured to trust that claim, mints an ephemeral publish credential — no stored secret. PyPI and npm support it directly; container registries do the equivalent via cloud workload identity. Bonus: because the registry verified the OIDC claim, the provenance statement "built from repo X" is trustworthy by construction.

**Q7. What's the difference between provenance and an SBOM, and where do they live?**
*What's really being tested: supply-chain literacy.*
**A.** **Provenance** (SLSA / in-toto) is a signed attestation answering "where did this come from" — this digest was built from this commit by this builder. **SBOM** (SPDX / CycloneDX) is the dependency inventory answering "what's inside." Both are attached to the artifact in the registry, addressed by the same digest, making the registry the system of record for trust. The SBOM is what lets you answer "which of our deployed images contain the vulnerable library?" in minutes when the next big CVE drops.

## Immutability & Yanking

**Q8. Explain the difference between yank, deprecate, and unpublish.**
*What's really being tested: the single most important nuance in this topic.*
**A.** **Yank** (crates.io, PyPI per PEP 592) is soft: the version stays downloadable so **existing builds/lockfiles keep working**, but resolvers won't *newly* select it. **Deprecate** (npm) is advisory: it still installs, but prints a warning. **Unpublish** (npm) actually deletes the bytes — dangerous, and heavily restricted: only within **72 hours** of publishing and only if nothing depends on it. The decision rule: to pull back a bad version, yank/deprecate and ship a fix; only unpublish if the bytes themselves are dangerous and you're in the window. Deleting bytes others depend on turns your incident into everyone's.

**Q9. Tell me about the left-pad incident and what it changed.**
*What's really being tested: do you know the canonical cautionary tale.*
**A.** In March 2016 a developer unpublished `left-pad`, an 11-line npm package, after a naming dispute. Because thousands of packages depended on it (directly or transitively), installs worldwide suddenly 404'd and builds broke en masse. The lesson: unpublishing breaks the immutability contract other people's builds rely on. npm responded by **severely restricting unpublish** — the 72-hour window, the no-dependents rule, and support-gated removal for older versions. It's the textbook example of why "just delete the bad version" is the wrong instinct.

**Q10. Can you delete a release from Maven Central? What do you do instead?**
*What's really being tested: knowing that some registries are truly immutable.*
**A.** No. Maven Central is strictly immutable — a released artifact can never be deleted or overwritten. The staging workflow (`mvn deploy` → close → release) exists precisely because release is one-way: staging is your last chance to validate (signatures, POM, sources/javadoc) before it becomes permanent. To "fix" a bad release you publish a new version (e.g. `1.2.4`) and mark the old one deprecated in docs/release notes. There is no yank or unpublish.

**Q11. A teammate wants to "fix a typo" in a version that's already published. What do you say?**
*What's really being tested: instinct under pressure to break the contract.*
**A.** No — never republish over an existing version. Immutable registries will reject it; mutable ones that allow it corrupt every cache and lockfile that already trusts those bytes, and quietly enable supply-chain tampering. The correct fix is to bump the version and publish the corrected artifact (`1.2.4`), then yank/deprecate the bad one if it shouldn't be used. The version number is cheap; the immutability guarantee is not.

## Scale, Resilience & Supply Chain

**Q12. Why is a registry a single point of failure, and when is that worst?**
*What's really being tested: systems thinking about the critical path.*
**A.** Deploys, autoscaling, node replacement, CI, and developer installs all depend on the registry being up. It's worst during a traffic spike: the spike triggers autoscaling, which triggers image pulls, which hammer the registry — and if the registry is down or rate-limited *then*, you can't add the capacity you need exactly when you need it. The failure is correlated: the app can't recover because its recovery depends on the registry. Mitigate by ensuring steady state doesn't touch the registry (local node caches + `IfNotPresent` with digests) and recovery touches a cache you control (pull-through cache/mirror).

**Q13. What's a pull-through cache and why run one?**
*What's really being tested: practical resilience.*
**A.** A registry that proxies an upstream (e.g. `docker.io`) and caches what it fetches: first pull goes upstream, subsequent pulls are local. It decouples you from upstream rate limits (Docker Hub's anonymous pull limits routinely break CI fleets), cuts latency and egress cost, and survives upstream outages. The language analog is a dependency proxy (Artifactory/Nexus/Verdaccio, devpi, a Go `GOPROXY`), which also gives you one chokepoint to scan, enforce policy, and audit every dependency entering the org.

**Q14. What is dependency confusion and how do you defend against it?**
*What's really being tested: a current, exploited attack class.*
**A.** An attacker publishes a package to a *public* registry with the same name as one of your *private* internal packages. If your resolver is configured to fall back to public, it may grab the attacker's higher-versioned public package instead of your private one — running their code in your build. Defenses: scope internal packages (`@acme/...`), pin the scope to the private registry so it can *never* resolve from public (`@acme:registry=...` in `.npmrc`), and reserve your org names publicly.

**Q15. How would you make a private registry highly available, and what's the critical thing to back up?**
*What's really being tested: treating the registry as stateful production infra.*
**A.** Stateless front-end across AZs; the durable state is the **blob storage** (back it with replicated object storage — S3/GCS) and the **metadata DB** (tag→digest mappings and ACLs). Replicate across regions for DR, define RTO/RPO, and *test* failover. The critical asymmetry: immutable blobs are cheap to replicate and often recoverable from object-store durability, but **metadata is irreplaceable** — lose the tag→digest and permission mappings and you can't address or authorize anything. Back up metadata above all.

## Scenarios

**Q16. Scenario: a published library version leaks an API token in its build output. Walk me through your response.**
*What's really being tested: incident judgment combining yank semantics and rotation.*
**A.** (1) **Rotate the leaked token immediately** — that's the actual exposure. (2) **Contain adoption**: deprecate (npm) or yank (crates/PyPI) the bad version so no new consumers pick it up. (3) **Ship a fixed version now** so people have somewhere to go. (4) Only **unpublish** if the leaked bytes themselves must be erased *and* you're inside the 72h window with no dependents — otherwise you break existing builds (left-pad). (5) If you have an SBOM/provenance program, query blast radius. (6) Postmortem: add a secret-scanning gate so a token can't end up in published output again.

**Q17. Scenario: half your Kubernetes nodes are running old code after a deploy, even though you pushed a new image. What happened?**
*What's really being tested: the `latest`/mutable-tag drift failure.*
**A.** You almost certainly deployed a mutable tag (`latest` or a repointed tag) with a pull policy that reused cached images. Nodes that already had the tag cached never re-pulled because the tag *name* didn't change, so they kept old bytes. The fix is to deploy by **digest** (`app@sha256:...`): a digest is unique per byte-set, so a cached old digest is simply a different image and nodes pull the new one. This makes node-level drift structurally impossible.

**Q18. Scenario: your CI suddenly fails org-wide with "too many requests" pulling base images. What do you do?**
*What's really being tested: recognizing rate limits and the standard fix.*
**A.** You're hitting Docker Hub's anonymous/authenticated pull-rate limits across a shared egress IP. Short term: authenticate pulls (higher limits) and back off. Real fix: stand up a **pull-through cache** so CI pulls base images locally, decoupling the fleet from Docker Hub's limits and uptime entirely. Bonus: it also reduces latency, egress cost, and gives you a scan/policy chokepoint.

**Q19. Scenario: an auditor asks "which deployed services contain log4j 2.14?" How fast can you answer, and what determines that?**
*What's really being tested: whether you've built an SBOM program vs. ad-hoc.*
**A.** If we attach an **SBOM** to every artifact at build (keyed by digest in the registry), it's a query against our attestations — minutes, returning the exact affected digests. If we haven't, it's archaeology: rebuilding or inspecting hundreds of images, taking days and missing things. The determinant is whether provenance/SBOM is run as a *program* with a query capability, not whether we *can* generate one SBOM on demand.

## Rapid-Fire

*One-line answers expected.*

- **Tag vs digest?** Tag = mutable pointer; digest = immutable content hash.
- **Pin production by?** Digest.
- **Go publish command?** None — tag the Git repo; the proxy fetches it.
- **Maven Central: delete a release?** Impossible; ship a new version.
- **crates.io yank effect?** New deps blocked; existing builds still work.
- **npm unpublish window?** 72 hours, and only if no dependents.
- **Deprecate vs yank?** Deprecate warns but still selectable; yank blocks new selection.
- **What broke in left-pad?** An unpublish 404'd thousands of builds.
- **Trusted publishing auth?** Short-lived OIDC, no stored token.
- **Dependency confusion defense?** Scope internal pkgs + pin scope to private registry.
- **Why pull-through cache?** Beat rate limits / outages, cut latency & egress.
- **Private registry: back up what?** Metadata (tag→digest, ACLs).
- **Provenance answers?** Where it came from. **SBOM answers?** What's inside.
- **Admission control enforces?** Only signed/verified images run.
- **Immutable tags prevent?** Tag-mutation attacks / silent byte swaps.

## Red Flags / Green Flags

**Red flags (in a candidate's answers):**
- Says "just overwrite the version" or "force push the tag."
- Treats `latest` as "the newest version" with special meaning.
- Reaches for unpublish/delete as the first response to a bad release.
- Doesn't know yank keeps existing builds working *on purpose*.
- Thinks deploying by tag is as safe as by digest.
- No awareness of registries as a SPOF or supply-chain entry point.
- Stores long-lived publish tokens with no plan to eliminate them.

**Green flags:**
- Instinctively pins by digest and ships a new version to fix.
- Distinguishes yank / deprecate / unpublish precisely and cites left-pad / Maven immutability.
- Talks about pull-through caches, dependency proxies, and the autoscale-during-outage failure.
- Knows trusted publishing/OIDC and provenance/SBOM as programs, with admission control closing the loop.
- Flags dependency confusion and scopes/locks private namespaces.
- Treats a private registry as stateful production infra (HA, metadata backup, tested DR).

## Cheat Sheet

```bash
# Identity
app:1.4.0            # mutable tag (pointer)
app@sha256:9b2c...   # immutable digest (truth) — deploy by this

# Pull back a bad release
cargo yank --version 1.2.3        # crates: block new, keep existing
npm deprecate pkg@"<1.2.4" "msg"  # npm: warn, still installs
npm unpublish pkg@1.2.3           # npm: delete (<72h, no dependents) — last resort
# PyPI: yank (PEP 592). Maven Central: cannot delete — ship new version.

# Publish safely
npm publish --provenance --access public
twine upload dist/*               # or OIDC trusted publishing
git tag v1.0.0 && git push --tags # Go: no push

# Resilience
GOPROXY=https://proxy.internal,https://proxy.golang.org,direct
@acme:registry=https://npm.internal   # dependency-confusion defense
```

| Question class | One-sentence answer |
|----------------|---------------------|
| Reproducibility | Pin by digest; versions are immutable. |
| Bad release | Yank/deprecate + ship fix; delete only if bytes are dangerous & in-window. |
| Resilience | Pull-through cache + digest pin so steady state/recovery don't depend on upstream. |
| Supply chain | Sign + provenance + SBOM in registry; admission control enforces. |
| Credentials | Trusted publishing (OIDC), no long-lived tokens. |

## Summary

Registry interviews reward a small set of crisp ideas held precisely: an artifact's identity is its **immutable digest**, while tags are mutable pointers, so you **deploy by digest** and never overwrite a version. You must distinguish **yank** (block new, keep existing — crates/PyPI), **deprecate** (warn — npm), and **unpublish** (delete, dangerous, 72h — npm), cite **left-pad** for why deletion harms others and **Maven Central** for true immutability, and respond to a bad release with *yank/deprecate + ship a fix*, not deletion. At scale, articulate the registry as a **single point of failure** (worst during autoscale-driven pulls) mitigated by **pull-through caches** and digest pinning, and as a **supply-chain chokepoint** secured by **trusted publishing, provenance/SBOM programs, and admission control**, with **dependency confusion** defended by scoped, locked private namespaces. Say those clearly and you'll read as someone who has actually run releases.

## Further Reading

- npm docs — unpublish policy; crates.io — yank; PEP 592 — PyPI yank
- OCI Distribution & Image specs
- SLSA framework; SPDX / CycloneDX SBOM specs
- The left-pad incident retrospective; OWASP dependency-confusion research

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/interview.md) — the coordinates you publish under.
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/interview.md) — what admission control verifies.
- [Supply-Chain Security](../09-supply-chain-security/interview.md) — the registry as attack/defense surface.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/interview.md) — why deploy-by-digest makes rollback deterministic.
