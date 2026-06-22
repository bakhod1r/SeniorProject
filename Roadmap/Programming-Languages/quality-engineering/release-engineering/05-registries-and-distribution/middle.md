# Registries & Distribution — Middle Level

> **Roadmap:** [Release Engineering](../README.md) → Registries & Distribution

*Immutability, digests, and the rules for pulling a bad release without breaking the world.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Immutability is the contract](#core-concept-1--immutability-is-the-contract)
5. [Core Concept 2 — Tags vs digests, in practice](#core-concept-2--tags-vs-digests-in-practice)
6. [Core Concept 3 — The `latest` trap](#core-concept-3--the-latest-trap)
7. [Core Concept 4 — Yank, deprecate, unpublish: not the same thing](#core-concept-4--yank-deprecate-unpublish-not-the-same-thing)
8. [Core Concept 5 — Publish mechanics with provenance and 2FA](#core-concept-5--publish-mechanics-with-provenance-and-2fa)
9. [Core Concept 6 — Retention, untagged layers, and garbage collection](#core-concept-6--retention-untagged-layers-and-garbage-collection)
10. [Real-World Examples](#real-world-examples)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **A published version is a promise: "these exact bytes, forever, under this coordinate." Immutability makes that promise enforceable — and shapes everything about how you fix a bad release.**

At the junior level you learned to push and pull. Now you'll learn the *rules* registries enforce and why they exist: why you can't republish `1.2.3`, what `latest` actually does, and the distinct mechanisms — yank, deprecate, unpublish — for pulling back a release that shouldn't have shipped. Get these wrong and you either break other people's builds or fail to contain a security incident.

## Prerequisites

- You can publish to and pull from at least one registry ([junior.md](junior.md)).
- You understand SemVer ([Versioning & SemVer](../01-versioning-and-semver/middle.md)).
- You've seen a CI pipeline produce and push an artifact.
- Comfortable reading a `sha256:` digest and a manifest.

## Glossary

| Term | Meaning |
|------|---------|
| **Immutable version** | A published `name@version` whose bytes can never change. |
| **Manifest** | For OCI, a JSON document listing the layers + config that make up an image. |
| **Manifest digest** | `sha256` of the manifest — the canonical immutable ID of an image. |
| **Yank** | Mark a version so *new* dependencies can't select it; existing pins still resolve. |
| **Deprecate** | Mark a version/package as discouraged; it still installs, with a warning. |
| **Unpublish** | Actually remove a version from the registry (often forbidden or time-limited). |
| **Provenance** | Signed metadata linking an artifact to the source commit and build that made it. |
| **Untagged layer** | Image data no tag references anymore — a GC candidate. |
| **Retention policy** | Rules that auto-delete old/untagged artifacts. |

## Core Concept 1 — Immutability is the contract

The single most important property of a good registry: **a published version is immutable.** Once `express@4.18.2` exists, those exact bytes are what `4.18.2` means — forever, for everyone.

Why this is non-negotiable:

- **Reproducibility.** A `package-lock.json` or `go.sum` records a version (and hash). If the registry could change the bytes behind that version, the lockfile would be a lie and "works on my machine" would become "works on the machine that downloaded it before it changed."
- **Caching.** Every CI runner, CDN, and mirror caches by coordinate. If bytes could change under a fixed coordinate, caches would serve stale-but-different content with no way to know.
- **Security.** Supply-chain attacks thrive on mutable coordinates. If an attacker can replace the bytes behind a version you already trust, they win silently.

This is why **republishing the same version is forbidden** almost everywhere:

```bash
npm publish        # npm: 403 — "cannot publish over previously published version"
cargo publish      # crates.io: "crate version X.Y.Z already exists"
mvn deploy         # Maven Central: a released version can never be overwritten or deleted
```

The fix is never "force overwrite." It's **publish a new version**. Immutability is a feature, not an obstacle.

## Core Concept 2 — Tags vs digests, in practice

OCI registries layer a *mutable* naming system (tags) on top of *immutable* content (digests). Understanding the split is what separates reliable deployments from flaky ones.

- An image's true identity is its **manifest digest**: `sha256:9b2c...`.
- A **tag** (`1.4.0`, `latest`, `prod`) is just a pointer in a table: tag → digest. You can repoint it any time.

```bash
# Resolve a tag to its current digest
docker buildx imagetools inspect ghcr.io/acme/api:1.4.0
#  Name:      ghcr.io/acme/api:1.4.0
#  Digest:    sha256:9b2c4e...a17

# Deploy by digest so the running thing can never drift
kubectl set image deploy/api api=ghcr.io/acme/api@sha256:9b2c4e...a17
```

> Rule of thumb: **build and promote by tag; deploy and depend by digest.** Tags are for humans choosing what to ship. Digests are for machines guaranteeing what runs.

The same idea exists in language ecosystems via integrity hashes:

```jsonc
// package-lock.json
"node_modules/left-pad": {
  "version": "1.3.0",
  "integrity": "sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZeQGinBN9yTQT3bFlCBy/aVx2HrNcqQGsdot8ghrjyrvMCoEA=="
}
```
```
# go.sum — module + version + hash, verified on every download
github.com/acme/toolkit v0.5.0 h1:abc123...=
```

If the bytes ever changed, the recorded hash would no longer match and the tool would refuse the download. The hash *is* a digest by another name.

## Core Concept 3 — The `latest` trap

`latest` is not "the newest version." It is a **plain tag with no special meaning** that, by convention, people repoint to whatever they consider current. Three traps follow:

1. **It moves.** `docker pull app:latest` today and tomorrow can return different bytes. Caches make it worse — a node may have an old `latest` and never re-pull because the tag name didn't change.
2. **It hides what's running.** `kubectl describe pod` showing `image: app:latest` tells you nothing about *which* build is live. You lose the ability to correlate an incident with a commit.
3. **It defeats rollbacks.** "Roll back to the previous `latest`" is meaningless — the previous bytes may be gone or unidentifiable.

```bash
# Anti-pattern
docker pull myapp:latest
kubectl set image deploy/app app=myapp:latest

# Better — explicit version, pinned by digest for production
kubectl set image deploy/app app=myapp@sha256:9b2c4e...a17
```

Use `latest` (or no tag) only for throwaway local experiments. Production references a specific version, ideally a digest. Configure `imagePullPolicy: IfNotPresent` *only* with digests or immutable tags — never with a moving tag, or you'll get inconsistent nodes.

## Core Concept 4 — Yank, deprecate, unpublish: not the same thing

When a release is bad — a regression, a leaked secret, a vulnerable dependency — you need to pull it back. The mechanism differs sharply by ecosystem, and **picking the wrong one either breaks everyone or fails to protect anyone.**

**Yank (crates.io, PyPI).** A yank is *soft*. The version stays downloadable, so **existing builds and lockfiles keep working**, but it can no longer be *newly selected* by a resolver.

```bash
cargo yank --version 1.2.3          # can't be added as a new dependency
cargo yank --version 1.2.3 --undo   # reverse it
```
PyPI's equivalent is **PEP 592 yank**: a yanked release is ignored by resolvers *unless* a pin requests it exactly (`==1.2.3`). This is the right tool for "this version is broken, stop new adoption, don't break existing users."

**Deprecate (npm).** Deprecation is *advisory*. The package still installs, but every install prints your warning. Nothing breaks.

```bash
npm deprecate mypkg@"<1.2.4" "Has a memory leak; upgrade to 1.2.4+"
npm deprecate mypkg "Whole package unmaintained; use @scope/new-pkg"
```

**Unpublish (npm) — the dangerous one.** Unpublish actually *removes* the bytes. This is the [left-pad incident](https://en.wikipedia.org/wiki/Npm_left-pad_incident) of March 2016: a single developer unpublished `left-pad`, an 11-line package, and broke thousands of builds worldwide because everyone's installs suddenly 404'd. npm responded by **heavily restricting unpublish**: you can only fully unpublish within **72 hours** of publishing, and only if nothing depends on it; older versions require contacting support and meeting strict criteria. The lesson: deletion breaks the immutability contract that other people's builds rely on, so registries make it nearly impossible.

**Maven Central — immutable, period.** You *cannot* delete or overwrite a released artifact on Maven Central. A bad release is fixed only by publishing a new version (e.g. `1.2.4`) and, if needed, marking the old one deprecated in docs. There is no yank, no unpublish.

| Mechanism | Existing builds | New adoption | Bytes removed? | Use when |
|-----------|-----------------|--------------|----------------|----------|
| **Yank** (crates/PyPI) | keep working | blocked | no | broken/insecure version, don't break current users |
| **Deprecate** (npm) | keep working (warned) | allowed (warned) | no | discouraged but not dangerous |
| **Unpublish** (npm, <72h) | break (404) | blocked | yes | mistaken publish, caught fast, nothing depends on it |
| **New version only** (Maven) | keep working | should move | never | the only option on immutable registries |

> Decision rule for a *security* incident: **yank/deprecate the bad version, publish a fixed one immediately, and only unpublish if the bytes themselves are dangerous and you're inside the window.** Removing bytes that others depend on turns your incident into everyone's incident.

## Core Concept 5 — Publish mechanics with provenance and 2FA

Real publishing in a team adds three things on top of the bare command: **two-factor auth**, **scoped packages/namespaces**, and **provenance**.

**npm with provenance and 2FA:**
```bash
# Scoped package: name is @acme/widgets, owned by the acme org's namespace
npm publish --access public --provenance   # provenance requires a supported CI (e.g. GitHub Actions w/ OIDC)
```
`--provenance` makes npm attach a signed statement linking the tarball to the exact GitHub repo, commit, and workflow that built it — visible as a "published via" badge. 2FA (or an automation token with 2FA policy) gates who may publish at all.

**PyPI with trusted publishing (OIDC):** instead of a long-lived `twine` token, configure a *trusted publisher* so CI authenticates via short-lived OIDC and uploads with no stored secret:
```yaml
# GitHub Actions
- uses: pypa/gh-action-pypi-publish@release/v1   # no password — uses OIDC trusted publishing
```

**Maven Central staging → release:** `mvn deploy` uploads to a *staging* repository (a temporary, private holding area). You then **close** the staging repo (Sonatype runs validation: signatures, POM completeness, javadoc/sources) and **release** it, which promotes it to Central. This two-phase flow exists precisely because Central is immutable — staging is your last chance to catch a bad artifact before it becomes permanent.

These all connect to signing — see [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/middle.md). Provenance answers "where did this come from"; signing answers "prove it wasn't tampered with."

## Core Concept 6 — Retention, untagged layers, and garbage collection

Registries fill up. Every CI run pushes new image tags; old layers pile up; storage bills climb. Two cleanup concepts:

**Untagged manifests.** When you repoint a tag (e.g. push a new `1.4.0`... which you shouldn't, but `latest` you do), the old manifest may become *untagged* — no tag references it, but it's still stored. Untagged manifests and their layers are GC candidates.

**Retention policies.** Most registries let you auto-delete by rule. Example GHCR / generic patterns:

- Keep the last *N* versions per repo.
- Delete untagged manifests older than *X* days.
- **Never** auto-delete tags matching a release pattern (e.g. `v*` or semver) — those are referenced by deployments.

```bash
# Example: delete untagged ECR images older than 14 days, keep all release tags
aws ecr put-lifecycle-policy --repository-name api --lifecycle-policy-text '{
  "rules": [{
    "rulePriority": 1,
    "selection": {"tagStatus": "untagged", "countType": "sinceImagePushed",
                  "countUnit": "days", "countNumber": 14},
    "action": {"type": "expire"}
  }]
}'
```

> The classic mistake: a retention rule that deletes "old" images by age, sweeping away an LTS release that production still pins by digest. **Protect release tags explicitly; only auto-expire untagged or CI-scratch tags.** See the `caching-strategies` skill for how cached pulls interact with deletion.

## Real-World Examples

**Example 1 — Bad version, contained correctly.** `acme-client 2.4.0` leaks a token in its build output. The team: (1) `npm deprecate acme-client@2.4.0 "Security: upgrade to 2.4.1"`, (2) publishes `2.4.1` immediately, (3) rotates the leaked token. They do *not* unpublish — existing pinned users keep working, and the warning steers everyone forward.

**Example 2 — Deploy drift from `latest`.** A team deployed `app:latest`. Three nodes had a 2-day-old `latest` cached and never re-pulled; two had the new one. Half the fleet ran old code. Fix: deploy `app@sha256:...` and the inconsistency became impossible.

**Example 3 — Maven, no take-backs.** A library is released to Central with a broken `pom.xml` dependency. It cannot be deleted. The maintainer ships `3.1.1` with the fix, marks `3.1.0` deprecated in the README and a GitHub release note, and moves on — there is no other option.

## Mental Models

- **A version is a contract, not a filename.** Publishing `1.2.3` is signing "these bytes, forever." Republishing is forging a signed contract.
- **Tag is a label on a shelf; digest is the serial number of the box.** Move the label freely; the serial number is the truth.
- **Yank ≠ delete.** Yank says "don't recommend this anymore"; delete says "this never existed" — and breaks everyone holding a reference.
- **Staging is a quarantine.** Maven's close/release is a one-way airlock because the destination is permanent.

## Common Mistakes

- **Trying to "fix" a released version in place.** Immutable registries reject it; mutable ones that allow it corrupt everyone's caches. Always ship a new version.
- **Unpublishing to "fix" a bug.** It breaks downstream builds (the left-pad lesson). Deprecate or yank, then publish a fix.
- **Confusing yank with delete.** Yank keeps existing builds working *on purpose*. If you delete instead, you turn a quiet fix into an outage.
- **Deploying mutable tags to production.** `latest` and even moving release tags cause node drift. Pin digests.
- **Retention rules that don't exempt release tags.** Age-based cleanup can delete an image production still runs.
- **Long-lived publish tokens.** Use trusted publishing / OIDC where available so there's no secret to leak.

## Test Yourself

1. Why is republishing the same version forbidden? Give two distinct reasons.
2. What's the practical difference between *yank* and *deprecate*?
3. Explain the left-pad incident and what npm changed because of it.
4. Can you delete a release from Maven Central? What do you do instead?
5. When deploying to Kubernetes, why prefer a digest over a tag?
6. What is an *untagged manifest* and why does it matter for storage?
7. What does `--provenance` add to `npm publish`?

## Cheat Sheet

```bash
# Resolve tag -> digest, deploy by digest
docker buildx imagetools inspect repo/app:1.4.0     # shows sha256 digest
kubectl set image deploy/app app=repo/app@sha256:...

# Pull back a bad release
cargo yank --version 1.2.3           # crates.io soft-pull
npm deprecate pkg@"<1.2.4" "reason"  # npm warning (still installs)
npm unpublish pkg@1.2.3              # only <72h, only if no dependents
#   PyPI: yank in project UI (PEP 592). Maven Central: cannot delete — ship new version.

# Publish safely
npm publish --access public --provenance   # provenance + scoped
mvn deploy                                  # -> staging; then close + release
# PyPI/npm: prefer OIDC trusted publishing over long-lived tokens

# Retention (ECR example): expire untagged > 14d, keep release tags
aws ecr put-lifecycle-policy ...
```

## Summary

Immutability is the registry's core promise: a published `name@version` is fixed bytes forever, which is why republishing is forbidden everywhere. Tags are mutable pointers; **digests** (and lockfile integrity hashes) are the immutable truth — build by tag, deploy by digest, and never trust `latest` in production. To pull back a bad release, choose deliberately: **yank** (crates/PyPI) blocks new adoption while keeping existing builds working, **deprecate** (npm) warns without breaking, **unpublish** (npm, <72h only) actually deletes and is dangerous (left-pad), and **Maven Central** simply doesn't let you delete at all — you ship a new version. Modern publishing adds provenance, 2FA, and OIDC trusted publishing; retention policies clean untagged layers while protecting release tags. Next, [senior.md](senior.md) treats the registry as critical infrastructure: SPOF, HA/DR, mirrors, and scale.

## Further Reading

- npm docs — "Deprecating and undeprecating", "Unpublishing policy"
- crates.io — "Cargo: yank"
- PEP 592 — "Adding 'Yank' Support to the Simple API"
- Sonatype — "Releasing to Central / staging workflow"
- The left-pad incident — retrospectives and npm's policy response

## Related Topics

- [Versioning & SemVer](../01-versioning-and-semver/middle.md) — choosing the immutable version you publish.
- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/middle.md) — provenance and signatures on what you publish.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/middle.md) — why deploy-by-digest makes rollback deterministic.
- [Supply-Chain Security](../09-supply-chain-security/middle.md) — registries as a supply-chain entry point.
