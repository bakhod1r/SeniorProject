# Dependency Management — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Dependency Management
> *At organizational scale, dependency management is a governance problem: who's allowed to add what, how do hundreds of repos stay patched without drowning in upgrade PRs, how do you prove what's in your software, and how do you keep an attacker from publishing a package that pretends to be yours.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Dependency Governance at Org Scale](#dependency-governance-at-org-scale)
4. [Automated Updates: the Churn vs Security Trade-off](#automated-updates-the-churn-vs-security-trade-off)
5. [SBOMs, Provenance, and Knowing What You Ship](#sboms-provenance-and-knowing-what-you-ship)
6. [Dependency Confusion and Typosquatting Defenses](#dependency-confusion-and-typosquatting-defenses)
7. [Private Registries, Scoping, and License Compliance](#private-registries-scoping-and-license-compliance)
8. [War Stories](#war-stories)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running dependency management across an organization — the policy, automation, security, and legal machinery that the per-project view ignores.**

For one project, dependency management is "write good constraints, commit the lock file, upgrade thoughtfully." For an organization with hundreds of repos and thousands of engineers, every one of those decisions becomes a *policy* and a *pipeline*. Who can introduce a new dependency? How do you patch a critical CVE across 400 services in a day? How do you answer "is Log4Shell in our products?" in minutes instead of weeks? How do you stop an attacker from publishing `your-company-internal-utils` to the public npm registry and watching it get installed inside your firewall?

This page is the operational and governance layer. It assumes the senior page's grasp of resolution, integrity, and MVS, and asks the questions a staff engineer or platform team owns: the update treadmill, SBOMs and provenance, supply-chain attack classes and their defenses, private registries and license compliance — illustrated with the incidents that forced the industry to take all of this seriously.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — SAT resolution, integrity ladder, MVS, vendoring, single-version policy.
- **Required:** Experience operating CI/CD and shipping software others depend on.
- **Helpful:** Familiarity with [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/).
- **Helpful:** You've owned an incident response or a CVE remediation.

---

## Dependency Governance at Org Scale

The core tension: developer velocity (add any library, instantly) vs. organizational risk (every dependency is attack surface, license risk, and maintenance debt). Mature orgs land somewhere on a spectrum:

- **Allowlist / curated registry.** Engineers may only pull from an internally-mirrored, vetted set. New dependencies require review (security, license, maintenance health). High control, high friction — common in finance, defense, and large platform orgs.
- **Guardrails, not gates.** Anyone can add a dependency, but automated policy *flags* problems at PR time: known CVEs, disallowed licenses, abandoned packages, suspicious version jumps. Lower friction, relies on the policy engine being good.
- **Laissez-faire.** Anyone adds anything. Fast, and the default for startups — until the first incident, after which they move left on the spectrum.

The artifacts that make governance real:

```yaml
# Example: an OPA/conftest-style policy gate in CI
deny[msg] {
  dep := input.dependencies[_]
  dep.license == "GPL-3.0"               # copyleft incompatible with proprietary distribution
  msg := sprintf("disallowed license %v in %v", [dep.license, dep.name])
}
deny[msg] {
  dep := input.dependencies[_]
  dep.known_vulnerabilities[_].severity == "CRITICAL"
  msg := sprintf("critical CVE in %v", [dep.name])
}
```

The governance question that actually matters is **ownership**: a dependency added once is a *liability owned forever*. The org needs an answer to "who is responsible for upgrading and patching this, and who decides when to remove it?" Without ownership, dependencies accrete, age, and become the unpatched 0.x library nobody dares touch.

> **Key insight:** Governance is the org-scale version of "a range is intent, a lock is reality." The *policy* is the intent (what we permit); the *automated gate* is the enforcement; and *ownership* is what keeps the resolved reality from rotting. Velocity and control are a dial, not a switch — and the right setting depends on your regulatory exposure and the cost of an incident, not on ideology.

---

## Automated Updates: the Churn vs Security Trade-off

Dependencies don't stop moving. **Dependabot** and **Renovate** automate the treadmill: they watch your manifests, detect newer versions, and open PRs to bump them (often with changelogs and the lock-file diff included).

```jsonc
// renovate.json — a realistic, tuned config
{
  "extends": ["config:recommended"],
  "schedule": ["before 6am on Monday"],          // batch, don't drip all week
  "packageRules": [
    { "matchUpdateTypes": ["patch", "minor"],
      "automerge": true,                           // auto-merge low-risk if CI passes
      "matchCurrentVersion": "!/^0/" },            // ...but not for unstable 0.x
    { "matchUpdateTypes": ["major"], "automerge": false,
      "addLabels": ["breaking-change-review"] },
    { "matchDepTypes": ["devDependencies"], "automerge": true }
  ],
  "vulnerabilityAlerts": { "labels": ["security"], "automerge": true },  // patch CVEs fast
  "prConcurrentLimit": 5, "prHourlyLimit": 2                              // throttle the firehose
}
```

The trade-off is sharp and underappreciated:

- **Too aggressive** → *churn*: a flood of PRs, constant CI runs, reviewer fatigue, and the occasional auto-merged minor that wasn't actually compatible (semver violated). Teams start ignoring the bot — and then *miss the security update buried in the noise*. The tool defeated itself.
- **Too conservative** → *rot*: dependencies age, the eventual upgrade is a giant multi-major leap across breaking changes, and you're exposed to known CVEs in the meantime.

The discipline that makes it work: **separate the security path from the freshness path.** Security updates (CVE fixes) should be high-priority, fast-tracked, ideally auto-merged on green CI. Routine freshness updates should be *batched* (weekly, grouped by ecosystem), *throttled*, and allowed to auto-merge only for patch/minor on stable (≥1.0) packages with passing tests. Majors always go to a human. This keeps the signal (security) out of the noise (routine churn).

> **Key insight:** Automated updates don't eliminate the treadmill — they make it *continuous and small* instead of *deferred and catastrophic*. The failure mode isn't the tool; it's *undifferentiated* updates that train engineers to ignore the bot, which is worst precisely when a real security PR arrives. Tune for *low churn + fast security*: batch and throttle freshness, fast-track CVEs. A bot whose PRs are all auto-closed is worse than no bot, because it created the false belief that you're patched.

---

## SBOMs, Provenance, and Knowing What You Ship

When Log4Shell hit, the question every CISO asked was simple and most companies *couldn't answer*: "Are we running a vulnerable Log4j, and where?" The answer requires knowing your complete dependency inventory — including transitive — for every artifact you ship.

A **Software Bill of Materials (SBOM)** is that inventory, in a standard machine-readable format (**SPDX** or **CycloneDX**): every component, its version, its hashes, its license, and its relationships.

```bash
# Generate an SBOM from a built artifact or source tree
syft dir:. -o cyclonedx-json > sbom.json
# Or from a container image
syft my-image:latest -o spdx-json

# Then scan that SBOM against vulnerability databases
grype sbom:sbom.json
# "Is CVE-2021-44228 (Log4Shell) anywhere in here?" → answerable in seconds
```

The SBOM is only half the story; **provenance** is the other. An SBOM says *what* is in the artifact; **SLSA provenance** says *how it was built* — which source commit, which builder, which dependencies, signed so it can't be forged. Together they let a consumer (or auditor) verify the full chain: this artifact came from this source, built by this trusted CI, containing these vetted components. This is the deep link to [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/), where SBOM generation and provenance attestation live as part of the release pipeline.

The operational payoff is *response time*. With SBOMs stored per release, "are we affected by tomorrow's CVE?" becomes a database query across your artifact inventory, not a frantic multi-week grep across hundreds of repos. The org that can answer in minutes patches in hours; the one that can't is still investigating when it gets breached.

> **Key insight:** You cannot secure what you cannot inventory. An SBOM turns "what are we even running?" from an archaeology project into a query, and provenance turns "can we trust how it was built?" from faith into verification. The business case is incident *response time* — and that case only became undeniable after Log4Shell showed entire industries they didn't know their own dependency trees. Generate SBOMs at build time, store them per release, and make them queryable; the value is realized on the day of the next CVE, not the day you generate them.

---

## Dependency Confusion and Typosquatting Defenses

Three distinct attack classes target the *trust* in dependency resolution. Each has a specific defense.

**1. Typosquatting.** Publish a malicious package with a name one keystroke from a popular one — `reqeusts`, `python3-dateutil`, `electorn`. A fat-fingered install runs the attacker's `postinstall` script. Defenses: lock files (you install the *name you vetted*, not a typo), curated/allowlisted registries, and tooling that flags new/low-reputation packages and name-similarity at PR time.

**2. Dependency confusion (substitution).** This is the dangerous one. Suppose your org uses an internal package `@acme/auth-utils`, resolved from your private registry. An attacker publishes `@acme/auth-utils` to the *public* npm registry with a **higher version number**. If your resolver checks both registries and "picks the newest," it pulls the *attacker's public package* — straight inside your firewall. Alex Birsan demonstrated this against Apple, Microsoft, and dozens more in 2021, earning six-figure bug bounties.

The defenses, layered:

```jsonc
// 1. SCOPE private packages and pin the scope to the private registry
// .npmrc
@acme:registry=https://npm.internal.acme.com/    // @acme/* ONLY from here, never public
//npm.internal.acme.com/:_authToken=${NPM_TOKEN}
```

```
// 2. CLAIM your namespace on the public registry (defensive registration)
//    Own @acme on public npm so an attacker can't publish under it at all.

// 3. CONFIGURE the resolver to NOT mix registries / not prefer public-higher-version.
//    Go: GOPRIVATE=*.acme.com  → never query the public proxy/sumdb for these.
```

```bash
# Go's first-class answer to confusion: tell the toolchain what is private
go env -w GOPRIVATE=*.internal.acme.com,github.com/acme/*
# → these never hit proxy.golang.org or sum.golang.org; resolved only from your source
```

**3. Account / maintainer compromise.** An attacker takes over a *real* maintainer's account (phishing, leaked token) and publishes a malicious version of a *legitimate, popular* package. Lock files and typo defenses don't help — the name and source are real. This is where the integrity *ladder* matters: signing + provenance (rung 3) can detect that a release wasn't built by the expected CI workflow, and version-pinning + a human-reviewed upgrade process limits blast radius.

> **Key insight:** The three attacks exploit three different trust assumptions: typosquatting exploits *human typos*, confusion exploits *registry precedence rules*, compromise exploits *publisher identity*. Defenses must be matched: lock files + allowlists for typos; **scoping and namespace ownership and not mixing public/private resolution** for confusion (the most preventable and most damaging); signing/provenance + pinning for compromise. The deadliest, dependency confusion, is also the cheapest to prevent — *scope your private packages and never let the resolver prefer a public higher-versioned impostor.*

---

## Private Registries, Scoping, and License Compliance

**Private registries** (Artifactory, Nexus, GitHub Packages, Google Artifact Registry, Verdaccio) serve three jobs at once:

1. **Mirror/proxy** public registries — so a public outage or a *yank* doesn't break your builds (left-pad would have been a non-event behind a caching proxy), and so you have a single audited ingress for all external code.
2. **Host** your private/internal packages, scoped so they never leak to or get shadowed from the public world.
3. **Enforce policy** at the ingress: block known-malicious versions, quarantine new releases for a cool-down, scan on the way in.

**Scoping** (`@acme/*`, Go's module-path domains, Maven `groupId`) is what makes the private/public boundary unambiguous — and, as above, is the primary dependency-confusion defense.

**License compliance** is the legal dimension engineers love to ignore until legal escalates. Every dependency carries a license, and they're not all compatible with shipping proprietary software:

- **Permissive** (MIT, BSD, Apache-2.0): generally safe to use and ship; Apache-2.0 adds a patent grant.
- **Weak copyleft** (LGPL, MPL): usually fine if you don't modify the library and link/use it as-is; obligations on modification.
- **Strong copyleft** (GPL, AGPL): can require you to release *your* source under the same terms if you distribute (AGPL extends this to network/SaaS use) — frequently a hard "no" for proprietary products.

```bash
# Automated license inventory + policy gate in CI
license-checker --production --onlyAllow "MIT;BSD;Apache-2.0;ISC"   # npm, fail on others
go-licenses check ./...                                              # Go
# Most SBOM tools (syft/CycloneDX) emit license fields → gate in policy (see governance section)
```

The transitive trap: a permissively-licensed direct dependency can pull in a GPL transitive one, and *the obligation attaches anyway*. License scanning must walk the full tree (it's in the SBOM) — the same iceberg lesson as security.

> **Key insight:** A private registry is the org's *control point* for dependency ingress — mirroring (availability), scoping (confusion defense), and policy (security + license). License risk is real, attaches *transitively*, and the AGPL-in-a-SaaS case has cost companies dearly; gate it automatically using the SBOM you're already generating, because legal review at release time is far more expensive than a policy failure at PR time.

---

## War Stories

**left-pad (2016) — the 11-line package that broke the internet.** A maintainer, in a naming dispute, *unpublished* `left-pad` — an 11-line string-padding function — from npm. Thousands of projects (including Babel and React tooling) transitively depended on it. Builds worldwide failed instantly with `npm ERR! 404 'left-pad' not found`. Lessons: (1) the transitive tree contains trivial, critical, single-points-of-failure you've never heard of; (2) a public registry that allows un-publish is an availability risk; (3) a caching private mirror or vendoring would have made it a non-event. npm subsequently restricted un-publishing.

**The diamond that bricked CI.** A team added a new analytics SDK. It transitively required `grpc >=1.50`; an existing service-mesh client required `grpc <1.50` (an ABI-incompatible native bump). In a single-version ecosystem, resolution failed outright — CI went red across every service sharing the base image, blocking *all* deploys, for a change unrelated to most of them. The fix required either dropping the SDK or driving a coordinated `grpc` upgrade. Lesson: in a single-version world, one team's innocuous dependency add can be an org-wide diamond hard-stop — which is the case *for* a managed single-version policy with whole-graph CI rather than against it.

**Dependency confusion (Birsan, 2021).** Security researcher Alex Birsan noticed internal package names leaking in public artifacts (e.g. in `package.json` files committed to public repos). He published same-named packages to public npm/PyPI/RubyGems with sky-high version numbers; resolvers at Apple, Microsoft, Shopify, PayPal and ~35 others preferred the public higher version and *executed his code inside their networks*. No exploit, no CVE — just the resolver's "newest wins" precedence across mixed registries. Lesson: scope private packages, own your namespace publicly, and never let resolution silently choose public-over-private.

**event-stream (2018) — the maintainer-handoff attack.** A popular npm package's maintainer handed control to a volunteer who, after building trust, injected a malicious dependency targeting a specific Bitcoin wallet app. It shipped to millions before discovery. Lesson: *maintainer compromise/social engineering* defeats lock files and typo defenses (the package and name were legitimate); only provenance, version pinning with human-reviewed upgrades, and post-install-script scrutiny help.

> **Key insight:** Every war story is the *transitive iceberg* plus a *trust assumption*. left-pad: availability of code you didn't write. The diamond: the single-version trade made org-wide. Birsan: registry precedence. event-stream: publisher identity. None were "your code was wrong" — all were "the dependency *system* had a property you didn't account for." Senior engineers earn their title by accounting for these *before* the incident, via mirrors, scoping, pinning, provenance, and SBOMs.

---

## Mental Models

- **A dependency is a liability you own forever, not a feature you got for free.** Adding it is cheap; patching, auditing, license-checking, and eventually removing it is the real cost, and it never goes away. Governance is just making that ownership explicit.

- **Automation makes the treadmill continuous so it can't become a cliff.** Small frequent updates (Renovate) beat deferred giant migrations — *if* you separate the security lane from the freshness lane so the important PRs aren't drowned by routine ones.

- **You can't secure what you can't inventory.** SBOM is the inventory; provenance is the chain of custody. The value is realized as *response time* on CVE day, which is why the case felt abstract until Log4Shell made it concrete.

- **The resolver's "newest wins" is an attacker's lever.** Dependency confusion is just that heuristic turned against you across mixed registries. Scoping and not-mixing-resolution removes the lever entirely — the cheapest fix for the most damaging attack.

---

## Common Mistakes

1. **Auto-merging *all* dependency PRs.** Auto-merging majors (or unstable 0.x bumps) ships breaking changes on the bot's schedule. Auto-merge only patch/minor on stable packages with green CI; majors go to a human.

2. **Letting the update bot become noise.** A firehose of un-triaged Renovate PRs trains the team to ignore them — and then the critical security PR is ignored too. Batch/throttle freshness; fast-track security on its own labeled lane.

3. **No private/public boundary for internal packages.** Unscoped internal packages with no registry pinning are a standing invitation to dependency confusion. Scope them (`@org/*`, `GOPRIVATE`), own the namespace publicly, and never let resolution prefer a public impostor.

4. **Generating SBOMs but not storing/querying them.** An SBOM produced and discarded helps no one on CVE day. Store one per release artifact and make the corpus queryable — the whole point is fast incident response.

5. **Ignoring transitive licenses.** A permissive direct dep can drag in a copyleft transitive one, and the obligation attaches anyway. Scan the *full tree* (use the SBOM), gate at PR time, not at the lawyer's desk before a release.

6. **No caching mirror for public registries.** A yank or outage upstream becomes *your* outage. A proxying private registry turns left-pad-class events into non-events and gives you a single audited ingress.

---

## Test Yourself

1. Your Renovate setup opens 60 PRs a week and the team has stopped looking. What's the failure, and how do you restructure updates so security still gets through?
2. Walk through a dependency-confusion attack against an org using `@acme/internal-sdk`. Name the resolver behavior it abuses and the single most effective prevention.
3. A CISO asks "are we exposed to the CVE announced this morning?" What capability lets you answer in minutes, and what must you have done *before* today?
4. Distinguish typosquatting, dependency confusion, and maintainer compromise by the *trust assumption* each abuses, and give one defense matched to each.
5. Why can a permissively-licensed direct dependency still create a GPL obligation for your proprietary product, and where in the pipeline should that be caught?
6. The left-pad incident: what made an 11-line package able to break thousands of builds, and what two infrastructure choices would have neutralized it?

<details>
<summary>Answers</summary>

1. The failure is **undifferentiated churn**: routine freshness PRs flood the queue, training the team to ignore the bot — including security PRs. Fix: **separate lanes** — batch + throttle freshness (weekly, grouped, auto-merge only patch/minor on stable + green CI), and put CVE/security updates on a distinct high-priority labeled lane, fast-tracked or auto-merged on green.
2. The org resolves `@acme/internal-sdk` from a private registry. An attacker publishes `@acme/internal-sdk` to **public** npm with a higher version; a resolver that queries both registries and prefers the newest pulls the attacker's package and runs its install scripts inside the network. It abuses the resolver's **"newest version wins across mixed registries"** precedence. Most effective prevention: **scope the package to the private registry** (`@acme:registry=...`) so `@acme/*` is *never* fetched from public — plus owning the `@acme` namespace publicly.
3. A **stored, queryable SBOM per release artifact** (and ideally provenance). You answer by querying the inventory for the vulnerable component+version across all artifacts. Before today you must have **generated and retained SBOMs at build time**; you can't inventory retroactively for things already shipped.
4. **Typosquatting** abuses *human typos* (defense: lock files + allowlist/curated registry + similarity flagging). **Dependency confusion** abuses *registry precedence rules* (defense: scoping + don't mix public/private resolution + namespace ownership). **Maintainer compromise** abuses *publisher identity* — the name and source are legitimate (defense: signing/provenance + version pinning + human-reviewed upgrades + install-script scrutiny).
5. License obligations attach **transitively**: a permissive direct dep can depend on a GPL/AGPL package, and incorporating/distributing that transitive code triggers the copyleft obligation regardless of the direct dep's license. Catch it by **scanning the full tree (via the SBOM) and gating at PR/CI time**, not at legal review before release.
6. left-pad was an **11-line transitive dependency** that thousands of projects relied on without knowing (the iceberg), and the public registry **allowed un-publishing**, so removing it 404'd every dependent build. Neutralizing choices: (a) a **caching/proxying private registry** (the package stays served even if upstream removes it), or (b) **vendoring** the dependency into the repo.

</details>

---

## Cheat Sheet

```
GOVERNANCE SPECTRUM
  allowlist/curated  <—— control ———  guardrails (flag at PR)  ——— velocity ——>  laissez-faire
  every dep = a liability OWNED FOREVER → assign ownership

AUTOMATED UPDATES (Renovate/Dependabot)
  SEPARATE LANES: security = fast/auto-merge ; freshness = batch+throttle
  auto-merge only patch/minor on STABLE (>=1.0) + green CI ; majors → human
  failure mode: undifferentiated churn → team ignores bot → misses CVE PR

SBOM + PROVENANCE  ("you can't secure what you can't inventory")
  SBOM (SPDX/CycloneDX): syft → what's inside (incl. transitive, licenses, hashes)
  scan: grype sbom:sbom.json  → "is CVE-X here?" in seconds
  provenance (SLSA): HOW it was built (source/builder/signed) → trust the chain
  STORE per release + make queryable → fast CVE response

SUPPLY-CHAIN ATTACKS → DEFENSE
  typosquatting (reqeusts)     → lockfile + allowlist + similarity flag
  dependency confusion         → SCOPE private (@acme:registry / GOPRIVATE),
    (public higher-ver wins)      own namespace, don't mix public/private resolution
  maintainer compromise        → signing/provenance + pinning + human upgrade review

PRIVATE REGISTRY = ingress control: mirror (availability) + scope (confusion) + policy
LICENSE: permissive(MIT/BSD/Apache) | weak-copyleft(LGPL/MPL) | strong(GPL/AGPL=danger)
  obligations attach TRANSITIVELY → scan full tree (SBOM), gate at PR time

WAR STORIES: left-pad(unpublish/iceberg) · diamond(single-version hard-stop) ·
  Birsan(confusion precedence) · event-stream(maintainer handoff)
```

---

## Summary

- **Governance** turns per-project habits into org policy: a velocity-vs-control dial (allowlist → guardrails → laissez-faire), backed by automated PR-time gates and, crucially, *ownership* — every dependency is a liability owned forever.
- **Automated updates** (Renovate/Dependabot) make the treadmill continuous instead of catastrophic, but only if you *separate the security lane from the freshness lane*; undifferentiated churn trains teams to ignore the bot and miss the CVE PR.
- **SBOMs** (SPDX/CycloneDX) are your queryable dependency inventory and **provenance** (SLSA) is the build chain-of-custody; together they make "are we exposed to today's CVE?" a minutes-long query — but only if generated and stored *before* the incident.
- Three supply-chain attacks abuse three trust assumptions — typosquatting (typos), **dependency confusion** (registry precedence, the most damaging and most preventable), maintainer compromise (publisher identity) — each with a matched defense; scope and namespace-ownership defeat confusion cheaply.
- **Private registries** are the ingress control point (mirror for availability, scope for confusion defense, policy for security and license). **License compliance** attaches transitively (AGPL-in-SaaS is the dangerous case); gate it via the SBOM at PR time, not at the lawyer's desk.
- The **war stories** (left-pad, the bricking diamond, Birsan's confusion, event-stream) all reduce to *the transitive iceberg plus a trust assumption you didn't account for* — and accounting for them up front is the senior/staff engineer's job.

The [interview.md](interview.md) page consolidates all four tiers into a question bank with model answers, "what the interviewer is really testing" notes, and design/debugging scenarios.

---

## Further Reading

- [Alex Birsan — "Dependency Confusion"](https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610) — the original write-up of the 2021 attacks. Required reading.
- [SLSA framework](https://slsa.dev/) and [CycloneDX](https://cyclonedx.org/) / [SPDX](https://spdx.dev/) — provenance and SBOM standards.
- [Renovate docs](https://docs.renovatebot.com/) — the configuration model behind tuned automated updates.
- [The post-mortem of the npm left-pad incident](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm) — npm's own account and policy change.
- *Securing the Software Supply Chain* (CISA/NSA guidance) — the governmental framing of all of the above.

---

## Related Topics

- [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/) — SBOM generation, SLSA provenance, and signing as part of the release pipeline.
- [Release Engineering › Versioning and Semver](../../release-engineering/01-versioning-and-semver/) — how *publishing* good versions makes everyone else's dependency management sane.
- [05 — Polyglot & Hermetic Builds](../05-polyglot-hermetic-builds/senior.md) — pinned, hashed, mirrored dependencies as part of hermetic builds.
- [09 — Reproducible Builds](../09-reproducible-builds/senior.md) — verified dependencies as a precondition for reproducibility.
- [interview.md](interview.md) — the consolidated question bank across all tiers.
