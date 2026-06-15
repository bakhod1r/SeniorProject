# Module Proxy & Checksum Database — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Trust Model: What You Are Actually Trusting](#the-trust-model-what-you-are-actually-trusting)
3. [The Transparency Log: Why It Is Tamper-Evident](#the-transparency-log-why-it-is-tamper-evident)
4. [The Certificate-Transparency Analogy](#the-certificate-transparency-analogy)
5. [TOFU and the Supply-Chain Threat Surface](#tofu-and-the-supply-chain-threat-surface)
6. [Running a Private Proxy: Athens, Artifactory, and `file://`](#running-a-private-proxy-athens-artifactory-and-file)
7. [Air-Gapped and Restricted Environments](#air-gapped-and-restricted-environments)
8. [Proxy and Sumdb vs Vendoring: Choosing a Boundary](#proxy-and-sumdb-vs-vendoring-choosing-a-boundary)
9. [Privacy: What Leaks to the Public Proxy and Sumdb](#privacy-what-leaks-to-the-public-proxy-and-sumdb)
10. [Designing GOPROXY/GOPRIVATE Policy for a Team](#designing-goproxygoprivate-policy-for-a-team)
11. [Failure Modes and Operational Resilience](#failure-modes-and-operational-resilience)
12. [Anti-Patterns](#anti-patterns)
13. [Senior-Level Checklist](#senior-level-checklist)
14. [Summary](#summary)

---

## Introduction

A senior engineer's relationship with the module proxy and checksum database is not "do they work" but "what trust am I extending, to whom, and what happens when the trusted party is unavailable or hostile." The proxy decides *where bytes come from*; the checksum database decides *whether everyone in the world got the same bytes*. Both are infrastructure you inherit by default — and both are things you may need to replace, mirror, or reason about under adversarial assumptions.

This file is about *design and trade-offs*. The protocol mechanics live in [middle.md](middle.md); the wire-level and Merkle-tree internals live in [professional.md](professional.md).

After reading this you will:
- Articulate the precise trust boundaries the proxy and sumdb establish
- Explain *why* a transparency log is tamper-evident, by analogy to Certificate Transparency
- Reason about TOFU and where it leaves you exposed
- Decide between the public proxy, a private mirror, and vendoring for a given org
- Design a `GOPROXY`/`GOPRIVATE`/`GOSUMDB` policy that balances security, privacy, and availability
- Operate Go module infrastructure through outages and air-gaps

---

## The Trust Model: What You Are Actually Trusting

When you run `go build` with default settings, you are extending trust to several distinct parties. Naming them is the first step to reasoning about them.

| Party | What you trust them for | What breaks if they are compromised |
|-------|-------------------------|-------------------------------------|
| **The module author** | That the code does what it claims, is not malicious. | A backdoor ships in your binary. (Neither proxy nor sumdb defends against this.) |
| **The proxy (`proxy.golang.org`)** | To serve the *correct, immutable* bytes for each version. | It could serve tampered bytes — but the sumdb catches that. It could refuse service (availability). |
| **The checksum database (`sum.golang.org`)** | To report the *one true hash* for each `(module, version)`, append-only. | If it could lie *undetectably*, a tampered module could pass. The transparency-log design makes lying *detectable*. |
| **TLS / the CA system** | To authenticate the proxy and sumdb servers. | MITM of the fetch — mitigated by HTTPS and, for content, by the sumdb. |

The key insight: **the proxy is only trusted for availability, not integrity.** Even a fully malicious proxy cannot feed you bad bytes that pass verification, because the sumdb provides an independent, tamper-evident hash. The proxy's real power is *denial* — it can refuse to serve, or serve nothing, which is an availability problem, not an integrity one.

The sumdb is the integrity root. Its credibility rests entirely on the property that it cannot be made to lie selectively without detection. That property comes from the transparency-log construction.

---

## The Transparency Log: Why It Is Tamper-Evident

The checksum database is not a plain key-value store. It is a **Merkle-tree-backed, append-only transparency log**, the same class of data structure used by Certificate Transparency and by Git's commit graph.

### The construction

Every `(module, version) → h1:hash` record is a leaf in a Merkle tree. Internal nodes hash their children; the single root hash at the top is a cryptographic commitment to *the entire set of records below it*. Change any leaf — alter one module's recorded hash — and the root hash changes. There is no way to modify history without the root changing.

Periodically the log publishes a **signed tree head (STH)**: the current root hash, the tree size, and a signature from the log's private key. Clients (your `go` command) remember the STHs they have seen.

### Two cryptographic proofs

The log supports two kinds of proof, both small (logarithmic in the tree size):

1. **Inclusion proof.** "Record R is a leaf in the tree committed to by root H." Lets `go` verify that the hash it received for a module is genuinely *in* the log — not fabricated on the fly by a man-in-the-middle.
2. **Consistency proof.** "The tree committed to by root H₂ (size n₂) is an append-only extension of the tree committed to by root H₁ (size n₁ < n₂)." Lets `go` verify that the log only *grew* — nothing was removed or rewritten — between two STHs it has observed.

### Why this is tamper-evident

Suppose an attacker controls the sumdb and wants to feed *you* a different hash for `github.com/popular/lib@v1.0.0` than everyone else gets — so a tampered version passes verification only for you (a "split view" or "equivocation" attack).

To do so, the attacker must present you a different leaf, which requires a different tree, which requires a different signed root. But:
- The consistency proofs you (and others, and independent auditors/`gossip`) demand would expose that your root is *inconsistent* with the root everyone else sees.
- The log cannot produce a valid consistency proof between two roots that are not append-only extensions of each other.

So the attacker cannot serve you a forked history without it being *detectable* by anyone who compares notes. The log is not *prevented* from lying — it is *caught* lying. That is the essence of "tamper-evident": misbehavior leaves cryptographic evidence.

The `go` client caches verified tree state under `$GOMODCACHE/cache/download/sumdb/`, so it can perform consistency checks across invocations.

---

## The Certificate-Transparency Analogy

The cleanest way to understand the sumdb is by analogy to **Certificate Transparency (CT)**, which solves the same problem for TLS certificates.

| Certificate Transparency | Go Checksum Database |
|--------------------------|----------------------|
| Certificate Authorities issue TLS certs. | Module authors publish module versions. |
| A malicious/compromised CA could issue a fraudulent cert for `yourbank.com`. | A malicious proxy could serve tampered bytes for a module. |
| CT logs record every issued certificate in a public, append-only Merkle log. | The sumdb records every `(module, version, hash)` in a public, append-only Merkle log. |
| Browsers require an SCT (proof of inclusion) before trusting a cert. | `go` requires an inclusion proof before trusting a hash. |
| Auditors/monitors watch the logs for fraudulent certs. | Anyone can audit the sumdb; `go` clients gossip STHs implicitly via the proxy. |
| Result: a CA *can* misbehave, but cannot do so *invisibly*. | Result: the sumdb (or a proxy) *can* misbehave, but cannot do so *invisibly*. |

The shared principle: **you do not need to trust the issuer to be honest; you need misbehavior to be publicly detectable.** CT made the web's CA system auditable. The sumdb makes Go's dependency supply chain auditable. If you understand CT, you understand the sumdb — they are the same idea applied to different artifacts.

The Go team designed the sumdb explicitly with CT as the model, using the same underlying transparency-log library (`golang.org/x/mod/sumdb` and the Trillian-style tile-based log).

---

## TOFU and the Supply-Chain Threat Surface

"Trust On First Use" is the pragmatic compromise at the heart of the system. The *first* time you encounter `M@V`, you have no local `go.sum` entry, so you must trust *something*. Go's answer: trust the global checksum database, verify the download against it, and record the result in `go.sum`. Every subsequent use is verified against that recorded hash — no more trust required.

### What TOFU + sumdb defends well

- **Post-publication tampering.** Once recorded, a version's bytes are pinned. Moving a Git tag, a compromised proxy, a corrupted mirror — all caught.
- **Split-view attacks.** The transparency log makes selectively lying to one victim detectable.
- **Accidental corruption.** Bit-rot, truncated downloads, cache poisoning.

### What it does *not* defend against

- **A malicious version published in the first place.** If `M@V` was hostile from the moment it was published, the sumdb faithfully records its hash and you faithfully build the backdoor. Integrity is not safety.
- **Typosquatting / dependency confusion.** Choosing `github.com/reaal/lib` instead of `github.com/real/lib` is a *selection* error; the proxy and sumdb serve the wrong package perfectly.
- **A compromised author account** pushing a malicious new version that you then upgrade to.
- **Build-time code execution** outside the module system (`go generate`, cgo, build constraints invoking tools).

The senior framing: **the proxy and sumdb guarantee you get the bytes you (and the world) agreed on. They say nothing about whether those bytes are trustworthy.** That second problem — vetting dependencies, scanning for vulnerabilities, pinning known-good versions, reviewing upgrades — is the subject of [07-supply-chain-integrity](../07-supply-chain-integrity/). This topic is the *integrity foundation*; supply-chain security is the *safety layer* built on top of it.

---

## Running a Private Proxy: Athens, Artifactory, and `file://`

Most organizations of any size eventually run their own module proxy. The reasons: caching, availability, access control, audit, and serving private modules uniformly.

### Why run one

- **Availability.** Decouple your builds from `proxy.golang.org` uptime and from upstream VCS hosts.
- **Caching.** A regional or on-prem mirror is faster and survives upstream takedowns.
- **Governance.** Allow-list or deny-list modules; require approval before a new dependency can be fetched.
- **Private + public in one place.** The proxy serves internal modules and mirrors public ones, so developers configure a single `GOPROXY`.
- **Air-gap bridge.** A proxy on the network edge can be populated from outside and serve an isolated network.

### The common options

| Tool | Nature | Notes |
|------|--------|-------|
| **Athens** | Open-source, Go-native module proxy. | Purpose-built; pluggable storage (disk, S3, GCS, Mongo). The canonical self-hosted choice. |
| **JFrog Artifactory** | Commercial artifact manager with a Go-modules repo type. | Integrates with existing enterprise artifact governance; remote + virtual repos. |
| **Sonatype Nexus** | Commercial/free artifact manager with Go support. | Similar enterprise positioning to Artifactory. |
| **GoProxy.io / goproxy** | Hosted and self-hostable proxies. | Lightweight; good regional mirrors. |
| **`file://` + the module cache** | The `cache/download/` tree served over `file://`. | The simplest possible proxy; great for one-off air-gap transfers. |

### Pointing the team at it

```bash
# Corporate mirror serves both public mirrors and internal modules:
GOPROXY=https://athens.corp.example.com
GONOSUMDB=*                       # the mirror handles integrity, or scope this
GOPRIVATE=github.com/yourco/*     # belt-and-braces for internal paths
```

If the mirror serves *everything* (public + private), `GOPROXY` can be a single URL with no `direct` fallback — which also enforces that *all* fetches go through governance. If you want resilience, add `,direct` and accept that a developer could bypass the mirror for VCS-reachable modules.

### Sumdb behind a proxy

A proxy can also *proxy the checksum database* (the sumdb is itself fetched over the same HTTP namespace, under `/sumdb/`). This lets an air-gapped or restricted network keep sumdb verification working without direct access to `sum.golang.org`. Athens and Artifactory both support proxying the sumdb. The alternative — `GOSUMDB=off` plus `GONOSUMDB=*` — trades integrity for simplicity and should be a deliberate decision, not a default.

---

## Air-Gapped and Restricted Environments

Networks without outbound internet at build time cannot reach `proxy.golang.org` or `sum.golang.org`. Three strategies, in increasing operational weight.

### Strategy 1 — Vendoring

Commit `vendor/` and build with `-mod=vendor`, `GOPROXY=off`, `GOSUMDB=off`. No proxy, no sumdb, no network. Simplest for a single repo. See [03-go-mod-vendor](../03-go-mod-vendor/senior.md). The trade-off is repo size and PR-diff noise.

### Strategy 2 — Pre-populated module cache

On a connected machine, `go mod download` everything, then ship the `$GOMODCACHE` (specifically `cache/download/`) into the air-gapped network and serve it as a `file://` or static-HTTP proxy:

```bash
# connected machine
go mod download all
tar -czf modcache.tgz -C "$(go env GOMODCACHE)" cache/download

# air-gapped machine
tar -xzf modcache.tgz -C /srv/goproxy
GOPROXY="file:///srv/goproxy/cache/download" GOSUMDB=off go build ./...
```

Because `cache/download/` *is* the proxy protocol, this "just works." Disable the sumdb (or proxy it too) since the global log is unreachable.

### Strategy 3 — An internal mirror at the edge

Run Athens/Artifactory with one foot in a DMZ (can reach upstream) and serve the air-gapped network. Most scalable for a fleet of builders, but the most operational surface. The mirror can also proxy the sumdb, preserving integrity verification inside the air-gap.

### The sumdb question in air-gaps

If you cannot reach the sumdb and do not proxy it, you must `GOSUMDB=off`. You then fall back to TOFU-against-your-cache: `go.sum` still protects you against *changes*, but the *first* recording of a hash is no longer cross-checked against a global log. For a fully controlled air-gap that received its cache from a verified source, this is acceptable. Document the decision; do not let it be accidental.

---

## Proxy and Sumdb vs Vendoring: Choosing a Boundary

Both vendoring and "proxy + sumdb" give you reproducible, integrity-checked builds. They draw the trust boundary in different places.

| Dimension | Proxy + `go.sum` + sumdb | Vendoring |
|-----------|--------------------------|-----------|
| Where bytes live at build time | Module cache (fetched from proxy) | `vendor/` in your repo |
| Network needed at build time | Yes (on cache miss) | No |
| Integrity mechanism | sumdb (first use) + `go.sum` (always) | git history + `go.sum` consistency |
| Repo size | Small | Large |
| PR-diff for a dep bump | A few `go.mod`/`go.sum` lines | Thousands of `vendor/` lines |
| Survives upstream takedown | Yes, if the proxy cached it | Yes, always (bytes are in repo) |
| Audit surface | `go.sum` + tooling against the cache | Source in the repo, reviewable in PRs |
| Best for | Most teams, with a reliable proxy | Air-gapped, regulated, audit-driven |

The senior take: **a healthy private proxy plus committed `go.sum` covers most reproducibility and availability needs without vendoring's diff cost.** Reach for vendoring when you need bytes-in-repo for audit/air-gap reasons, or when you cannot guarantee a proxy at build time. The two are not mutually exclusive — some regulated shops vendor *and* mirror, belt and braces.

---

## Privacy: What Leaks to the Public Proxy and Sumdb

Every fetch through `proxy.golang.org` and every sumdb lookup tells Google's servers which module paths you are requesting. For *public* modules this is usually acceptable. For *private* ones it is a leak with real consequences.

### What can leak without `GOPRIVATE`

- **Internal module paths** — `github.com/acme/project-thunderbird-billing` reveals product names, team structure, unreleased features.
- **Existence of private repos** — even a 404 from the sumdb for a private path confirms the path was requested.
- **Dependency relationships** — the set and timing of fetches can hint at architecture.

### The fix

```bash
go env -w GOPRIVATE='github.com/acme/*,git.acme.internal/*'
```

`GOPRIVATE` ensures matching paths never reach the public proxy *or* sumdb — Go fetches them directly from VCS and skips the global checksum lookup. This is not only a functionality fix (private modules would 404 on the public proxy) but a **privacy and information-security control**.

The privacy-conscious can go further:
- `GONOSUMDB=*` to never consult the public sumdb at all (you lose its protection for public modules too).
- Route everything through a private proxy you control, so no fetch metadata leaves your network.
- Note the public proxy and sumdb's privacy policy explicitly states module paths are logged; treat that as the default for anything you do not exclude.

---

## Designing GOPROXY/GOPRIVATE Policy for a Team

A real policy is a few coordinated settings, applied uniformly (via `go env -w` in dev environments, env vars in CI, and documentation in `CONTRIBUTING.md`).

### A balanced enterprise default

```bash
GOPROXY=https://athens.corp.example.com,direct
GOPRIVATE=github.com/acme/*,git.acme.internal/*
GOSUMDB=sum.golang.org
GONOSUMDB=                          # (inherits from GOPRIVATE)
GOFLAGS=-mod=readonly
```

Rationale:
- **`GOPROXY` = corp mirror, then `direct`.** Public modules come through the governed mirror (cached, audited); private/internal modules fall to `direct` VCS (matched by `GOPRIVATE`). The comma means a mirror outage *surfaces* rather than silently bypassing governance — unless you deliberately add the public proxy as a fallback.
- **`GOPRIVATE`** scopes the internal paths once, covering both proxy and sumdb exclusion.
- **`GOSUMDB` on** keeps integrity verification for everything public.
- **`-mod=readonly`** prevents builds from silently mutating `go.mod`/`go.sum`, surfacing drift in code review.

### Decisions a policy must make explicitly

1. **Is the mirror authoritative or a fallback?** Single-URL `GOPROXY` enforces governance; `mirror,public,direct` favors resilience.
2. **Comma or pipe?** Comma surfaces mirror failures; pipe hides them. Prefer comma for a governed mirror.
3. **Public sumdb on or off?** Keep it on for public modules unless you have a strong privacy or air-gap reason to proxy or disable it.
4. **Who approves new dependencies?** A governed mirror can gate this; document the process.
5. **How is the cache warmed in CI?** Mirror + CI cache of `$GOMODCACHE` is the usual answer.

---

## Failure Modes and Operational Resilience

The proxy and sumdb introduce network dependencies. Design for their failure.

### Proxy outage

If `GOPROXY`'s first entry is down and the separator is a comma, the build *fails* on any non-404 error — which is good (you find out) but blocks builds. Mitigations:
- A CI cache of `$GOMODCACHE` so already-fetched modules build without the proxy.
- A `direct` fallback for VCS-reachable modules (accepting the governance trade-off).
- A multi-region mirror or a health-checked load balancer in front of the corporate proxy.

### Sumdb outage

If `sum.golang.org` is unreachable, *new* `go.sum` entries cannot be verified and `go get`/`go mod tidy` for new versions fails. *Existing* builds (entries already in `go.sum`) are unaffected — they verify against the local cache, not the sumdb. Mitigations:
- Proxy the sumdb through your mirror.
- Accept that adding *new* dependencies requires sumdb reachability; cache existing ones.

### Upstream VCS takedown

A deleted GitHub repo breaks `direct` fetches but not proxy fetches *if the proxy cached the version*. This is a strong argument for routing through a caching mirror rather than `direct`.

### Cache corruption

`go clean -modcache && go mod download` rebuilds. In CI, a corrupted persistent cache can wedge every job — make cache-clear an easy operational lever.

---

## Anti-Patterns

- **Disabling the sumdb (`GOSUMDB=off`) to silence a checksum error.** You are turning off the security mechanism instead of investigating a real signal. Almost always wrong.
- **Using `GOPROXY=direct` for everything in CI.** Slow, fragile (full clones), and exposes you to upstream takedowns and tag-moving. Use a caching proxy.
- **Pipe (`|`) separators in front of a governance mirror.** Silently bypasses the mirror on any error, defeating the point of having it.
- **Not setting `GOPRIVATE`, leaking internal paths to the public proxy/sumdb.** A privacy and information-disclosure bug.
- **Reaching for the removed `GONOSUMCHECK`.** It does nothing; the underlying problem remains. Use scoped modern variables.
- **`GOINSECURE` for public modules.** Permits MITM. Reserve strictly for trusted internal hosts.
- **Treating the sumdb as a safety guarantee.** It is an *integrity* guarantee. Malicious-but-consistent code passes. You still need dependency vetting.
- **No CI cache of `$GOMODCACHE`, then complaining the proxy is slow.** You are re-downloading every job.
- **Mixing a private proxy, the public proxy, and `direct` with no documented policy** about which is authoritative when. Pick a stance and write it down.
- **Committing `go.mod` without `go.sum`.** Drops the integrity record for everyone who clones.

---

## Senior-Level Checklist

- [ ] Articulate that the proxy is trusted for *availability*, the sumdb for *integrity*
- [ ] Explain why a Merkle-tree transparency log is tamper-evident (inclusion + consistency proofs)
- [ ] Draw the Certificate-Transparency analogy precisely
- [ ] State what TOFU + sumdb does and does *not* defend against
- [ ] Set `GOPRIVATE` for all internal paths to prevent leakage to the public infrastructure
- [ ] Choose comma vs pipe in `GOPROXY` deliberately, based on whether the mirror is authoritative
- [ ] Decide between public proxy, private mirror, and vendoring for the org's needs
- [ ] Run or evaluate Athens/Artifactory as a caching, governing mirror
- [ ] Have an air-gap strategy (vendor, cache-ship, or edge mirror) with an explicit sumdb decision
- [ ] Design CI cache of `$GOMODCACHE` and resilience to proxy/sumdb outages
- [ ] Never disable verification to silence an error; investigate instead
- [ ] Keep the proxy/sumdb policy documented and uniform across dev and CI

---

## Summary

The module proxy and the checksum database divide responsibility cleanly: the proxy is trusted only for *availability* — it serves bytes but cannot feed you bad ones undetectably — while the checksum database is the *integrity root*, a Merkle-tree-backed, append-only transparency log whose tamper-evidence comes from inclusion and consistency proofs. The design is Certificate Transparency applied to Go modules: you do not need the log to be honest, only its dishonesty to be publicly detectable. TOFU is the pragmatic bootstrap — trust the global log once, then enforce the recorded `go.sum` hash forever — and it defends well against tampering and split-view attacks but not at all against malicious-yet-consistent code, which is the domain of supply-chain vetting.

The senior responsibilities are policy and resilience: set `GOPRIVATE` so internal paths never leak to or fail against the public infrastructure; choose comma-vs-pipe and mirror-vs-fallback deliberately; run a caching, governing private proxy (Athens, Artifactory) when scale or compliance demands it; have a deliberate air-gap strategy with an explicit decision about the sumdb; and design CI and proxy topology to survive outages. The defaults are excellent for individuals. At team and enterprise scale, the proxy and sumdb become infrastructure you own, govern, and reason about adversarially — and the integrity guarantees they provide are the foundation on which real supply-chain security is built.
