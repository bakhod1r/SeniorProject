# Registries & Distribution — Senior Level

> **Roadmap:** [Release Engineering](../README.md) → Registries & Distribution

*The registry is critical infrastructure, a single point of failure, and a supply-chain entry point. Engineer it like one.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The registry as a single point of failure](#core-concept-1--the-registry-as-a-single-point-of-failure)
5. [Core Concept 2 — Mirrors, pull-through caches, and dependency proxies](#core-concept-2--mirrors-pull-through-caches-and-dependency-proxies)
6. [Core Concept 3 — The public/private split and vendoring](#core-concept-3--the-publicprivate-split-and-vendoring)
7. [Core Concept 4 — Distribution at scale: CDNs and regional registries](#core-concept-4--distribution-at-scale-cdns-and-regional-registries)
8. [Core Concept 5 — HA and DR for a private registry](#core-concept-5--ha-and-dr-for-a-private-registry)
9. [Core Concept 6 — The registry as a supply-chain entry point](#core-concept-6--the-registry-as-a-supply-chain-entry-point)
10. [Core Concept 7 — Auth, scopes, and namespace ownership](#core-concept-7--auth-scopes-and-namespace-ownership)
11. [Core Concept 8 — Storage, GC, and cost at scale](#core-concept-8--storage-gc-and-cost-at-scale)
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

> Focus: **Every deploy, every CI run, and every developer's `install` flows through a registry. If it's down, you can't ship; if it's compromised, you ship malware. Senior work is making it fast, available, and trustworthy at scale.**

By now you can publish, pin by digest, and pull back a bad release. The senior question is structural: *what happens when the registry itself is the problem?* A registry outage halts deploys and autoscaling; a poisoned registry distributes compromised artifacts to your entire fleet. This file treats registries as the production infrastructure they are — availability, distribution topology, and trust.

## Prerequisites

- Solid grasp of immutability, digests, and yank/deprecate semantics ([middle.md](middle.md)).
- You've operated services with availability targets (SLOs, failover).
- Familiarity with CDNs and caching (`cdn-design`, `caching-strategies` skills).
- You understand image signing/admission control concepts ([Artifact Signing & Provenance](../04-artifact-signing-and-provenance/senior.md)).

## Glossary

| Term | Meaning |
|------|---------|
| **SPOF** | Single point of failure — one component whose outage stops the whole flow. |
| **Pull-through cache** | A registry that proxies an upstream and caches what it fetches. |
| **Dependency proxy** | A caching proxy for language packages (npm/PyPI/Maven) inside your network. |
| **Mirror** | A full or partial replica of a registry's content closer to consumers. |
| **Vendoring** | Committing dependency source/artifacts into your own repo. |
| **Admission control** | A gate (e.g. K8s policy) that rejects images failing a policy (unsigned, etc.). |
| **RTO / RPO** | Recovery Time / Point Objective — how fast you recover and how much data you can lose. |
| **Regional registry** | A registry instance/replica per geography to cut latency and egress. |
| **Egress cost** | What a cloud charges to move bytes out of a region/provider. |

## Core Concept 1 — The registry as a single point of failure

Trace what depends on a registry being up:

- **Deploys** — Kubernetes can't pull the image, pods won't start.
- **Autoscaling & node replacement** — a scale-up event or node crash needs a fresh pull. If the registry is down *during an incident*, you can't add capacity exactly when you need it most.
- **CI** — every build pulls base images and dependencies.
- **Developer machines** — `npm install`, `pip install`, `go get`.

The dependency is worst at the worst time: a traffic spike triggers autoscaling, which triggers image pulls, which hammer the registry — and a registry outage during a spike means no new capacity. This is why the famous failure mode is *correlated*: the registry and your app fail together because the app's recovery depends on the registry.

Mitigations (developed below): **local caching on nodes** (so a steady-state node doesn't need the registry), **pull-through caches/mirrors** (so you don't depend on a third party's uptime), **digest pinning** (so a cache hit is guaranteed-correct), and **`imagePullPolicy: IfNotPresent` with digests** (so cached images are reused safely).

```yaml
# A node with the image already cached survives a registry outage
imagePullPolicy: IfNotPresent     # safe ONLY with immutable refs (digests/immutable tags)
image: ghcr.io/acme/api@sha256:9b2c4e...a17
```

> Senior framing: design so that *steady state* doesn't touch the registry, and *recovery* touches a cache you control, not a vendor's public endpoint.

## Core Concept 2 — Mirrors, pull-through caches, and dependency proxies

You rarely want every machine pulling directly from `docker.io` or `registry.npmjs.org`. Reasons: rate limits (Docker Hub's anonymous pull limits have bitten countless CI fleets), latency, egress cost, and third-party uptime.

**Pull-through cache (containers).** Run a registry that proxies an upstream and caches blobs locally. The first pull fetches from upstream; subsequent pulls are local.

```yaml
# containerd: route docker.io through an internal pull-through mirror
# /etc/containerd/certs.d/docker.io/hosts.toml
server = "https://docker.io"
[host."https://mirror.internal.acme.com"]
  capabilities = ["pull", "resolve"]
```

**Dependency proxy (language packages).** Artifactory/Nexus/Verdaccio (npm), devpi (PyPI), or a Go `GOPROXY` proxy the public registry, cache artifacts, and let you survive an upstream outage:

```bash
# Go: route module fetches through your proxy, then public, then direct
export GOPROXY=https://goproxy.internal.acme.com,https://proxy.golang.org,direct
# npm: point at an internal proxy that caches the public registry
npm config set registry https://npm.internal.acme.com

# PyPI: index-url to internal proxy
pip config set global.index-url https://pypi.internal.acme.com/simple/
```

Benefits beyond uptime: a single chokepoint where you can **scan, enforce policy, and audit** every dependency entering the org. The cost: you now operate that proxy and must keep it patched and available.

## Core Concept 3 — The public/private split and vendoring

Most orgs run a hybrid: public registries for open-source, a **private registry** for proprietary artifacts. Decisions:

- **What's private?** Your own images and internal libraries — always private. Build provenance and SBOMs — private.
- **How do you consume public?** Directly (simple, but exposes you to upstream outages/yanks/typosquats) vs. **through a caching proxy** (resilient, auditable, but operational cost) vs. **vendoring** (commit dependencies into your repo).

**Vendoring vs proxy** is a real trade-off:

| Approach | Resilience | Reproducibility | Cost | Best for |
|----------|-----------|-----------------|------|----------|
| Direct from public | low | depends on lockfiles | none | small teams, low stakes |
| Caching proxy | high | high (cached + locked) | run a proxy | most orgs |
| Vendoring (`go mod vendor`, committed deps) | highest (no network) | total | repo bloat, manual updates | air-gapped, ultra-high-assurance, hermetic builds |

```bash
# Go vendoring: deps live in ./vendor, builds need no network
go mod vendor
go build -mod=vendor ./...
```

Vendoring gives you a hermetic, network-free, perfectly reproducible build at the cost of bloat and update friction. A caching proxy gets you most of the resilience with far less friction and is the default for most organizations. The right answer scales with your assurance requirements.

## Core Concept 4 — Distribution at scale: CDNs and regional registries

When consumers are global, a single-region registry means high latency for distant pulls and large cross-region/cross-cloud **egress bills**. Public registries already front their blob storage with CDNs (npm, PyPI, crates.io all serve tarballs from CDN edges); at scale you do the same internally.

- **Regional replicas.** Replicate your registry (or its blob store) per region so pulls are local. ECR has cross-region replication; Artifactory has replication; cloud registries offer multi-region.
- **CDN in front of blobs.** Image *layers* and package *tarballs* are immutable and content-addressed — ideal CDN cache keys. The mutable *manifest/index* is small and changes rarely. This is exactly the split the `cdn-design` skill describes: cache the immutable bytes aggressively, serve the small mutable pointer with short TTL.
- **Egress economics.** Pulling 200 nodes × a 1 GB image across regions on every scale event is real money. Regional caches turn that into one cross-region fetch plus local serves.

```
client → regional pull-through cache (CDN-fronted) → upstream registry
            ^ cache hit on immutable layer = no egress, low latency
```

> The content-addressed nature of registries (immutable layers keyed by digest) is *why* CDNs work so well here: an immutable object can be cached forever with no invalidation problem. See `caching-strategies` for TTL and invalidation patterns on the mutable manifest side.

## Core Concept 5 — HA and DR for a private registry

If you run a private registry, it inherits production SLAs. Design it like any stateful service:

- **Stateless front, durable back.** The registry process is often stateless; the **blob storage** (S3/GCS/Azure Blob) and the **metadata DB** are the durable state. Make those HA, not the front-end pods.
- **Replicated, durable storage.** Back blobs with object storage that has its own replication/durability. Replicate metadata.
- **Multi-AZ / multi-region.** Run the front-end across availability zones; replicate storage across regions for DR.
- **Define RTO/RPO.** How long can deploys be blocked (RTO)? How much recently-pushed-but-unreplicated data can you lose (RPO)? A registry that loses the last hour of pushes may strand a release.
- **Test failover.** Pull through the failover path regularly. A DR plan you've never exercised is a hypothesis.
- **Backups of metadata.** Blob loss is often recoverable from object-store durability; *metadata* (tag→digest mappings, permissions) loss is catastrophic. Back it up.

```text
                ┌──────────────┐
   clients ───▶ │ registry LB  │ (multi-AZ, stateless front)
                └──────┬───────┘
                       ▼
        ┌──────────────────────────────┐
        │ object storage (blobs)        │  cross-region replicated
        │ metadata DB (tag→digest, ACL) │  replicated + backed up
        └──────────────────────────────┘
```

> The asymmetry to remember: immutable blobs are cheap to replicate and easy to recover; mutable metadata is the fragile, must-back-up part. (See the `high-availability-patterns` skill for failover and quorum patterns.)

## Core Concept 6 — The registry as a supply-chain entry point

Everything you deploy comes *through* the registry. That makes it the highest-leverage point for both attack and defense.

Attack surface:
- **Compromised public dependency** (typosquat, malicious version, hijacked maintainer account).
- **Tag mutation** on a registry that doesn't enforce immutability — bytes swapped under a trusted tag.
- **Registry compromise** — attacker pushes a malicious image under your namespace.

Defenses, layered:
1. **Pin by digest** everywhere — a digest can't be silently swapped (covered in middle).
2. **Sign artifacts and verify on pull/admission.** Only signed-by-us images are admitted. This is the link to [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/senior.md): the registry stores the artifact and its signature; the *admission gate* enforces "no signature, no run."
3. **Admission control.** A Kubernetes policy (e.g. Sigstore policy-controller, Kyverno) rejects images that aren't signed by your key / lack provenance / aren't from an allowed registry.
4. **Scan on entry.** Your dependency proxy/registry scans for known CVEs and blocks or flags.
5. **Immutable tags.** Configure the registry to forbid retagging release tags so a trusted tag can never be repointed.

```yaml
# Kyverno-style policy: only admit images from our registry, signed by our key
verifyImages:
  - imageReferences: ["ghcr.io/acme/*"]
    attestors:
      - entries:
          - keys: { publicKeys: |-  <our cosign public key> }
```

> Senior principle: the registry is where you *enforce* supply-chain policy because it's the one chokepoint every artifact passes through. Detail lives in [Supply-Chain Security](../09-supply-chain-security/senior.md).

## Core Concept 7 — Auth, scopes, and namespace ownership

At scale, access control is where incidents are prevented or caused.

- **Separate read and publish.** The vast majority of consumers need read-only. Publish rights belong to CI service identities, not humans, and not broadly.
- **Scoped, short-lived credentials.** Prefer OIDC / workload identity (CI authenticates per-run, no stored token) over long-lived publish tokens. A leaked long-lived publish token = attacker ships under your name.
- **Namespace ownership and squatting.** A *namespace* (`@acme/`, `ghcr.io/acme/`) asserts who owns a name. **Typosquatting** (`reqeusts` vs `requests`) and **dependency confusion** (publishing a public package with the same name as your private internal one, so resolvers grab the attacker's) are real, exploited attacks. Defenses: reserve your org names publicly, scope internal packages (`@acme/...`), and configure resolvers so private names never fall back to public.
- **Least privilege on the registry itself.** Who can delete? Who can change retention? Who can repoint a release tag? These should be tightly held and audited.

```bash
# Dependency-confusion defense (npm): force scoped names to the private registry only
# .npmrc
@acme:registry=https://npm.internal.acme.com
# never let @acme/* resolve from the public registry
```

## Core Concept 8 — Storage, GC, and cost at scale

A busy org pushes thousands of images and packages daily. Without governance, storage grows unbounded and the bill follows.

- **Untagged GC.** Run garbage collection that removes untagged manifests and unreferenced blobs (deduplicated by digest, so shared layers aren't deleted while still referenced).
- **Retention by class.** Different rules for `pr-*` / CI-scratch tags (expire fast) vs `v*` release tags (keep long / forever). **Never** age-expire something production pins.
- **Dedup awareness.** OCI blobs are content-addressed and shared across images; "delete this image" doesn't delete layers another image still uses. Measure *unique* storage, not summed image sizes.
- **Cost attribution.** Tag/label artifacts by team so storage and egress cost can be charged back, which creates the incentive to clean up.

```bash
# Distribution (the open-source registry) GC, after marking deletions
registry garbage-collect /etc/docker/registry/config.yml --delete-untagged
```

> Cost governance is a senior responsibility: set retention as policy (versioned, reviewed), automate it, exempt release tags, and attribute cost so teams own their footprint. (More in the cost-governance treatment in [professional.md](professional.md).)

## Real-World Examples

**Example 1 — Docker Hub rate limits halt CI.** A fleet pulling base images anonymously from Docker Hub hits the pull-rate limit mid-morning; builds fail org-wide. Fix: stand up a pull-through cache; CI now pulls base images locally, decoupled from Docker Hub's limits and uptime.

**Example 2 — Dependency confusion.** An attacker publishes `acme-internal-utils` to public npm matching the org's private package name. CI, mis-configured to fall back to public, installs the attacker's version. Fix: scope all internal packages (`@acme/internal-utils`) and pin the scope to the private registry so public fallback is impossible.

**Example 3 — Registry DR drill.** During a quarterly game day, the team fails the private registry to its secondary region. Pulls succeed via replicated blobs, but *pushes* fail because the metadata DB hadn't been promoted — they discover their RTO assumption was wrong before it mattered in a real incident.

## Mental Models

- **The registry is in the critical path of recovery.** Anything you need *to recover* must not depend on the thing that's down. Cache locally; control the cache.
- **Immutable bytes are CDN/replication-friendly; mutable metadata is the fragile part.** Optimize and protect them differently.
- **One chokepoint, two faces.** The single path every artifact takes is both the SPOF you must make HA and the gate where you enforce policy.
- **Least privilege scales; broad publish rights don't.** Read for many, publish for few automated identities.

## Common Mistakes

- **Pulling base images directly from public registries fleet-wide.** Rate limits and upstream outages become your outages. Cache through a proxy.
- **No HA/DR plan for the private registry.** It's production infra; treat it like the database it effectively is.
- **Backing up blobs but not metadata.** Tag→digest mappings and ACLs are the irreplaceable part.
- **Mutable release tags + admission that trusts tags.** An attacker repoints the tag; you admit malware. Pin digests and enforce immutable tags.
- **Public fallback for private package names.** Open door to dependency confusion. Scope and lock resolution.
- **Retention that age-expires release artifacts.** Production can't pull an image you deleted.
- **Never testing failover.** An untested DR path is a guess.

## Test Yourself

1. Why is a registry outage *most* dangerous during a traffic spike?
2. Explain how a pull-through cache decouples you from Docker Hub rate limits.
3. When would you vendor dependencies instead of using a caching proxy?
4. Why are image layers ideal for CDN caching while manifests are not?
5. For a private registry's DR, why is metadata the critical thing to back up?
6. Describe a dependency-confusion attack and the resolver-level defense.
7. Why is the registry the right place to enforce signing/admission policy?
8. What does "measure unique storage, not summed image sizes" mean and why?

## Cheat Sheet

```bash
# Resilience: cache/proxy upstreams
export GOPROXY=https://goproxy.internal,https://proxy.golang.org,direct
npm config set registry https://npm.internal.acme.com
# containerd pull-through mirror for docker.io via hosts.toml

# Survive registry outage in steady state
imagePullPolicy: IfNotPresent + image pinned by @sha256:...

# Hermetic build (no network)
go mod vendor && go build -mod=vendor ./...

# Dependency-confusion defense (.npmrc)
@acme:registry=https://npm.internal.acme.com

# GC untagged, keep release tags
registry garbage-collect config.yml --delete-untagged

# Admission: only signed images from our registry (cosign/Kyverno/policy-controller)
```

| Concern | Lever |
|---------|-------|
| SPOF / outage | local node cache + pull-through proxy + digest pin |
| Latency / egress | regional replicas + CDN-fronted blobs |
| Supply-chain | digest pin + sign + verify on admission + scan |
| Cost | retention by tag class + dedup-aware GC + chargeback |
| DR | replicate blobs, back up metadata, test failover |

## Summary

A registry sits in the critical path of every deploy, autoscale, CI run, and developer install — making it both a **single point of failure** and the highest-leverage **supply-chain chokepoint**. Senior engineering means designing so steady state doesn't touch the registry and recovery touches a cache you control: **pull-through caches, dependency proxies, regional replicas, and CDN-fronted immutable blobs** give resilience and cut latency/egress, while **vendoring** trades friction for hermetic, network-free builds. Run a private registry like the stateful service it is — HA front, durable replicated blobs, **backed-up metadata**, defined RTO/RPO, and *tested* failover. Use the chokepoint for defense: **pin by digest, enforce immutable tags, sign and verify on admission, scan on entry, and lock private namespaces against dependency confusion.** Govern storage with tag-class retention, dedup-aware GC, and cost attribution. Next, [professional.md](professional.md) elevates this to org-wide governance: trusted-publishing rollout, provenance programs, and cost at fleet scale.

## Further Reading

- OCI Distribution Specification
- "Docker Hub rate limits" and pull-through cache guides
- OWASP — "Dependency Confusion" research
- Sigstore policy-controller / Kyverno `verifyImages` docs
- The `cdn-design`, `caching-strategies`, and `high-availability-patterns` skills

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/senior.md) — what the admission gate verifies.
- [Supply-Chain Security](../09-supply-chain-security/senior.md) — the registry as attack/defense surface.
- [Rollback & Roll-Forward](../07-rollback-and-roll-forward/senior.md) — registry availability and rollback.
- [Release Automation](../08-release-automation/senior.md) — wiring caches and policy into pipelines.
