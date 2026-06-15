# Reproducible Builds — Professional Level

> **Roadmap:** [Build Systems](../README.md) → Reproducible Builds
> *Reproducibility stops being a property you achieve on your laptop and becomes a property an organization — or an entire distribution — operates: rebuilders that re-derive thousands of packages, CI gates that fail when a leak regresses, a supply-chain threat model with named attacks, and the hard-won judgment of where the investment pays for itself and where it's theater.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Rebuild-and-Diff Gate as Standing Infrastructure](#the-rebuild-and-diff-gate-as-standing-infrastructure)
3. [How the Big Projects Actually Do It](#how-the-big-projects-actually-do-it)
4. [Independent Rebuilders and Verifiable Builds](#independent-rebuilders-and-verifiable-builds)
5. [The Supply-Chain Framing: SLSA, Provenance, and the SolarWinds Lesson](#the-supply-chain-framing-slsa-provenance-and-the-solarwinds-lesson)
6. [Signing Reproducible Artifacts](#signing-reproducible-artifacts)
7. [Cost/Benefit: Where Reproducibility Earns Its Keep](#costbenefit-where-reproducibility-earns-its-keep)
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

> Focus: **Operationalizing reproducibility at org and distro scale — gates, rebuilders, the supply-chain threat model, signing, and the cost/benefit calculus of when to bother.**

At the senior level reproducibility was a property of the whole toolchain and a gate you *could* build. At the professional level the questions are organizational: *Who runs the rebuild, and how often? How does Debian verify tens of thousands of packages? What does it actually buy you against a real attacker, and what attack does it not stop? How do you sign artifacts so the reproducibility claim is also non-repudiable? And — the question everyone eventually asks — is this worth the engineering cost for my software, or am I gold-plating a build nobody will ever independently verify?*

This page is the accumulated operational judgment: the standing infrastructure that keeps reproducibility from rotting, the methods the largest real-world programs (Debian, Arch, NixOS, Bitcoin) use to run it at scale, the SLSA/provenance vocabulary your security org will speak, the SolarWinds attack that made executives care, and an honest accounting of where the cost is justified and where it isn't.

---

## The Rebuild-and-Diff Gate as Standing Infrastructure

A one-off "I built it twice and the hashes matched" proves nothing tomorrow. The professional artifact is a **standing gate**: a job that rebuilds released artifacts and *fails loudly* when reproducibility regresses, run continuously, owned by a team, with the `diffoscope` output wired into the alert.

The shape of a real gate (expanding the senior sketch into an operational job):

```bash
#!/usr/bin/env bash
set -euo pipefail
EPOCH=$(git -C "$SRC" log -1 --pretty=%ct)

# Build A: the "official" build, in the canonical hermetic environment.
docker run --rm -v "$SRC:/src:ro" \
  -e SOURCE_DATE_EPOCH="$EPOCH" -e LC_ALL=C -e TZ=UTC \
  build-image@sha256:<digest> /src/build.sh /out-a

# Build B: SAME source + SAME pinned toolchain, but DELIBERATELY VARY
# everything reproducibility promises is irrelevant — different dir, time,
# user, hostname, locale-ish env, parallelism. If any of these leak, B differs.
sudo unshare -r faketime '+213 days' \
  docker run --rm -v "$SRC:/src:ro" --hostname builder-2 \
  -e SOURCE_DATE_EPOCH="$EPOCH" -e LC_ALL=C -e TZ=UTC -e USER=mallory \
  build-image@sha256:<digest> /src/build.sh /out-b   # build dir /elsewhere, -j1

# Compare. Identical → pass. Different → fail WITH a diagnosis as a CI artifact.
if ! cmp -s /out-a/app /out-b/app; then
  diffoscope --html /out/report.html /out-a/app /out-b/app || true
  echo "REPRODUCIBILITY REGRESSION — see report.html" >&2
  exit 1
fi
```

Operational decisions that separate a real gate from box-ticking:

- **Run it on a schedule, not only per-PR.** Reproducibility breaks from *external* drift — a base image rebuilt, a transitive dependency republished, a CA cert bundle updated — with zero code change. A nightly rebuild of the *last released* artifact catches the drift that a per-commit gate, which only sees code, never will.
- **Vary the irrelevant aggressively.** Building twice *identically* (same dir, same second) masks the two biggest leak classes — paths and time. `faketime`/`libfaketime` to skew the clock, a different build directory, a different `$USER`/`$HOSTNAME`, `-j1` vs `-jN`. You are *attacking* your own reproducibility claim.
- **Make the diff the bug report.** When the gate fails, attach the `diffoscope` HTML. The diff names the cause (`DW_AT_comp_dir` leak → `-ffile-prefix-map`; archive mtime → `tar --mtime`) so triage is minutes, not a day.
- **Budget the cost honestly.** A rebuild-and-diff *doubles* build time for the gated artifact. For a 40-minute build that's a real CI bill; you gate the *release* artifact, not every intermediate.

> **Key insight:** Reproducibility you don't enforce decays to a slogan. The gate's defining move is *adversarial*: it actively varies the dimensions the build claims don't matter — time, path, user, parallelism — and asserts byte-identity. Run only per-PR, it misses external drift; run only on a schedule, it lets regressions ship for a day first. Mature programs run *both*, and treat a red gate like a failing test, not a flaky annoyance.

---

## How the Big Projects Actually Do It

Reproducibility's credibility comes from a handful of large programs that did it at a scale that proves it's achievable, not aspirational. Each illuminates a different operating model.

**Debian — the proof at distribution scale.** Debian set out to make all of its tens of thousands of source packages build reproducibly, and built the infrastructure to *measure* it: [tests.reproducible-builds.org](https://tests.reproducible-builds.org/) rebuilds every package *twice under deliberately varied conditions* (different hostname, build path, timezone, locale, even a clock skewed into the future) and publishes a per-package pass/fail dashboard. The varying is the point — `/build/1st` vs `/build/2nd`, `FUTURE` time, `et_EE` locale — so any path/time/locale leak surfaces. This drove thousands of upstream patches across the whole free-software ecosystem; most of the determinism flags in the middle/senior pages exist because Debian found the bug. Debian's model: **a central, instrumented mass-rebuilder that varies inputs and reports coverage as a percentage.**

**Arch Linux — reproducibility as a release metric.** Arch tracks the reproducible-package percentage as a published, watched number and integrates rebuild checks into its packaging tooling (`makepkg` honours `SOURCE_DATE_EPOCH`; `archlinux-repro` rebuilds a package and compares). Smaller surface than Debian, same idea: **measure the percentage, drive it up, don't regress it.**

**NixOS — reproducibility by construction, then verified.** Nix's model is different in kind: builds are *hermetic by design* (sandboxed, content-addressed inputs, no ambient environment), so determinism is the default rather than a retrofit. Nix can then *verify* it directly — `nix build --rebuild` rebuilds a derivation and checks the output hash matches, and `nix-store --query --hash` exposes the content address. The lesson: **hermeticity (the [05](../05-polyglot-hermetic-builds/professional.md) topic) makes reproducibility cheap to achieve and trivial to check** — you're confirming a property the build system already enforces rather than chasing leaks one by one.

**Bitcoin Core — adversarial reproducibility for high-stakes money.** Bitcoin Core builds release binaries with **Guix** (a hermetic, bootstrappable build system) and requires **multiple independent maintainers to each build from source and sign the resulting hashes**; the release is only published when their hashes *agree* and a quorum of detached signatures exists (the historical "Gitian", now Guix, multi-builder model). For software that controls money and is a prime tampering target, "one CI built it and signed it" is not enough — they require *independent confirmation that source maps to the published binary.* This is reproducibility used exactly as designed: as a **multi-party verification protocol**, not a single-builder checkbox.

> **Key insight:** There are two operating models and they compose. **Retrofit + measure** (Debian, Arch): take an existing ecosystem, instrument a varying mass-rebuilder, publish a percentage, drive it up. **Hermetic by construction** (NixOS, Guix/Bitcoin): make the build system enforce determinism so verification is a cheap confirmation. The highest-stakes software (Bitcoin) layers *multi-party independent rebuild* on top of the hermetic base — because the threat model includes a compromised builder, which no single-builder pipeline can defend against.

---

## Independent Rebuilders and Verifiable Builds

A reproducible build is only *useful* if someone other than the original builder actually rebuilds and checks. That second party is a **rebuilder**, and the system of multiple rebuilders cross-confirming a hash is a **verifiable build**.

The mechanism:

1. A project publishes a binary and its hash (ideally with provenance — below).
2. One or more *independent* rebuilders — different organizations, different machines, ideally different jurisdictions — fetch the *source*, build it in the same pinned hermetic environment, and compute their own hash.
3. Each rebuilder publishes an **attestation**: "I rebuilt source `X` and got hash `Y`." (Debian's [rebuilderd](https://github.com/kpcyrd/rebuilderd) does exactly this — a service that continuously rebuilds distro packages and serves signed attestations.)
4. A consumer can then require **N independent rebuilders to agree** before trusting the binary — turning a single publisher's promise into a quorum.

Why independence matters: if the official build server is compromised, its binary is poisoned *and* it will happily sign "this matches source." A rebuilder on infrastructure the attacker *doesn't* control will produce a *different* hash, and the disagreement is the alarm. The security comes from **diversity of builders**, not from any single one — which is precisely why Bitcoin requires multiple unrelated humans and Debian runs rebuilderd on separate infrastructure.

> **Key insight:** Reproducibility is the *precondition*; rebuilders are the *mechanism that cashes it in*. A reproducible build nobody independently rebuilds buys you almost nothing against a compromised build server — the attacker controls the one build and its hash. The defense is *plural*: multiple independent parties rebuild from source and must agree, so an attacker would have to compromise *all* of them simultaneously. "Verifiable" means "more than one mutually-distrusting party confirmed source maps to binary."

---

## The Supply-Chain Framing: SLSA, Provenance, and the SolarWinds Lesson

Reproducibility lives inside a larger discipline — **software supply-chain security** — and at the professional level you must speak its vocabulary, because that's how security and compliance frame the spend.

**The SolarWinds lesson (2020).** Attackers compromised SolarWinds' **build system** and injected the SUNBURST backdoor *during the build* of the Orion product. The published source was clean. The signed, shipped binary was not. Roughly 18,000 organizations — including US federal agencies — installed the trojaned update because they trusted the chain "vendor's official signed binary ⇒ vendor's source." The attack defeated source review (source was clean) *and* code signing (the binary was signed with SolarWinds' real key, because the build server itself was the compromised, trusted insider). The structural lesson: **signing proves *who built it*, not *that the binary matches the source*.** Only a reproducible build, independently rebuilt, would have exposed SUNBURST as a hash that no honest rebuild of the source could produce.

**SLSA (Supply-chain Levels for Software Artifacts).** SLSA (pronounced "salsa") is the framework that gives this a ladder of guarantees, focused on **build integrity and provenance**:

- **Build L1 — provenance exists.** The build produces machine-readable **provenance**: a signed statement of *what was built, from which source revision, by which builder, with which inputs.*
- **Build L2 — provenance is signed by a hosted build service**, so it's tamper-evident and not forgeable by the developer.
- **Build L3 — the build runs in a hardened, isolated environment** that prevents the build itself from forging its own provenance or being influenced across builds — i.e., **hermeticity and isolation**, the structural defense SolarWinds lacked.

**Provenance and attestation.** *Provenance* is the signed record of how an artifact was produced (builder identity, source commit, build parameters, materials). An *attestation* is a signed claim *about* an artifact — provenance is one kind; a rebuilder's "I rebuilt source X → hash Y" is another. The standard formats are [in-toto](https://in-toto.io/) attestations and SLSA provenance predicates, typically signed via Sigstore.

Where reproducibility fits the ladder: **SLSA raises the bar on *the build*; reproducibility lets *anyone independently check the result*.** They're complementary. SLSA L3 hermeticity makes the build hard to tamper with *and* is exactly what makes builds reproducible. Provenance says "this builder, from this source, claims this hash"; reproducibility + a rebuilder lets a third party *verify that claim is true* rather than trust it. SolarWinds had signing but neither L3 isolation nor reproducible independent rebuild — and that gap is precisely the hole the attack drove through.

> **Key insight:** Code signing answers *"who built this?"*; provenance answers *"how and from what was it built?"*; reproducibility answers *"does the binary actually match that source?"* SolarWinds passed the first, lacked the third, and the third is the only one that catches a compromised-build-server attack — because the attacker held the legitimate signing key. SLSA is the ladder that institutionalizes all three; reproducibility is the rung that makes the provenance *checkable* rather than merely *signed*.

---

## Signing Reproducible Artifacts

Reproducibility and signing solve *different halves* of trust, and a mature pipeline does both — but the order and what gets signed matter.

The two halves:

- **Signing** establishes **authenticity and integrity**: this artifact came from a holder of key `K` and hasn't been altered since. It says nothing about whether the binary matches any source.
- **Reproducibility** establishes **source ↔ binary correspondence**: anyone can rebuild the source and get this exact hash. It says nothing about who built or shipped it.

Composed, they give the full property: *this artifact came from this source (reproducibility, verifiable by anyone) and was published by this party (signature, verifiable against a key).* SolarWinds had the second and lacked the first; that's the whole story.

Operationally (cross-linking [Release Engineering › Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/professional.md)):

```bash
# 1. Reproducible build → a stable, content-derived hash.
SOURCE_DATE_EPOCH=$EPOCH LC_ALL=C TZ=UTC ./build.sh   # → app  (bit-identical every time)
sha256sum app > app.sha256

# 2. Sign the artifact (and/or the checksum file). Keyless via Sigstore/cosign:
cosign sign-blob --yes app > app.sig                  # OIDC identity, logged to Rekor

# 3. Attach SLSA provenance attesting builder + source + materials.
cosign attest --yes --predicate provenance.json --type slsaprovenance app

# 4. A verifier checks BOTH: signature valid AND (via a rebuilder) hash matches source.
cosign verify-blob --signature app.sig app
```

Two subtleties that bite:

- **Sign the *reproducible* hash, sign *consistently*.** If different builders produce different bytes, their signatures cover different artifacts and the multi-builder agreement collapses. Reproducibility is what lets *N* independent signers all sign the *same* hash — the precondition for a quorum.
- **A signature over a non-reproducible artifact is the SolarWinds shape.** It proves the publisher's build server emitted these bytes — which is exactly the link the attacker subverted. Signing is necessary, never sufficient.

> **Key insight:** Signing and reproducibility are orthogonal trust axes, and you need both: signing proves *provenance of the publisher*, reproducibility proves *provenance from the source*. The trap is treating a signature as proof the binary matches the source — it isn't, and SolarWinds is the proof it isn't. Reproducibility's contribution to signing is subtle but decisive: it's what makes a *quorum of independent signers over the same hash* possible, which is the only construction a compromised single builder can't forge.

---

## Cost/Benefit: Where Reproducibility Earns Its Keep

Reproducibility is not free. It costs engineering time to chase leaks, CI time to rebuild-and-diff, and ongoing vigilance to keep the gate green against external drift. A professional decides *where that investment pays off* — and is honest about where it's ceremony.

**Where it clearly earns its keep:**

- **Security-critical software handling money, secrets, or identity** — wallets, password managers, signing tools, VPN/crypto. The threat model explicitly includes a tampered binary; independent rebuild is a primary defense. (Bitcoin's multi-builder model exists for exactly this.)
- **Package distributions and OS images** — Debian, Arch, NixOS, container base images. Millions of users install binaries they can't audit; reproducibility lets the *distribution and its mirrors* be verified by anyone, and makes a poisoned mirror detectable.
- **Regulated and safety-critical domains** — medical, automotive, aerospace, finance. Functional-safety and audit standards require proving *exactly which source and toolchain produced the shipped artifact*; reproducibility is the auditable evidence (cross-link [Cross-Compilation › firmware](../08-cross-compilation/professional.md)).
- **Widely-redistributed open source** where users *want* to verify the published binary matches the public source — the original reproducible-builds motivation.
- **As a free side effect of caching correctness.** If you already run a hermetic, content-addressed build for [caching](../07-build-caching/professional.md), you're *most of the way* to reproducible — the marginal cost is just the gate.

**Where the investment is usually not justified:**

- **Internal-only services nobody outside rebuilds.** A microservice deployed to your own cluster, never redistributed, with no independent verifier — full bit-reproducibility buys little *security* (you control the build server and the runtime). You may still want *determinism for caching*, which is cheaper and has a different justification.
- **Rapidly-churning early-stage products** where the threat model doesn't yet include build-server compromise and engineering time is the scarcest resource. Pin the toolchain, keep builds hermetic-ish, defer the bit-exact gate.
- **Artifacts that are inherently non-deterministic for good reasons** and where the cost of forcing determinism exceeds the benefit — though this is rarer than people claim; most "inherent" nondeterminism is a fixable leak.

The honest framing: reproducibility's value is *proportional to how much someone other than you wants to verify your binary against your source.* High for distributed/security/regulated software; low for internal services you alone build and run. Determinism for *caching* is a separate, near-universal win — don't conflate "I need a reproducible release" with "I need a deterministic build for cache hits."

> **Key insight:** Bit-reproducibility's payoff is a function of **who needs to independently verify source↔binary** — distributions, security tools, and regulated firmware have many such verifiers and reap large benefits; an internal service has none and reaps mostly the *caching* benefit, which is achievable far more cheaply. Spend reproducibility effort where there's a verifier who will actually use it. And note the freebie: if you've already gone hermetic for caching, you're nearly reproducible already — the gate is the only marginal cost.

---

## War Stories

**1. SolarWinds (SUNBURST), 2020 — the canonical case for independent rebuild.** Attackers sat inside SolarWinds' build pipeline and injected a backdoor into Orion *during compilation*. The source in version control was clean; the shipped binary, signed with SolarWinds' genuine certificate, was trojaned. ~18,000 organizations installed it. Source review didn't catch it (source was clean); signature verification didn't catch it (the binary was authentically signed). **Lesson:** signing proves the publisher, not source↔binary correspondence. A reproducible build with even *one* independent rebuilder would have produced a non-matching hash and exposed the injection — which is why this attack is the standard motivating example for the entire reproducible-builds movement.

**2. The Debian package that was reproducible — until the locale changed.** A package passed Debian's reproducibility tests for months, then started failing on the rebuild dashboard with no source change. `diffoscope` showed a sorted list of strings in a generated data file ordered differently between the two builds. The cause: the first builder ran under `C` locale, the second under `et_EE.UTF-8` (Estonian) — Debian *deliberately varies the locale* to flush exactly this leak. The code sorted with the ambient collation instead of byte order. **Lesson:** a varying rebuilder finds leaks an identical rebuild never will; pin `LC_ALL=C` in the build, and be grateful the dashboard varied it for you.

**3. The "reproducible" release that nobody could actually reproduce.** A security-conscious team published binaries, hashes, and a proud "reproducible build" claim — but the build instructions assumed an internal base image that wasn't public and wasn't pinned by digest. When an external researcher tried to rebuild, the base image had since been rebuilt upstream, the embedded toolchain version had moved, and the hashes didn't match. The "reproducible" build was reproducible only *inside the company, that month.* **Lesson:** reproducibility is meaningless without a *pinned, publicly-fetchable* toolchain (base image by digest, not tag). "Reproducible by us" is not "verifiable by anyone" — and only the latter defends against a compromised builder.

---

## Mental Models

- **Reproducibility is the precondition; the rebuilder is the verifier; signing is the publisher's stamp.** Three distinct pieces. Reproducibility makes source↔binary *checkable*; an independent rebuilder *does the check*; a signature says *who shipped it*. SolarWinds had only the stamp. You want all three.

- **Security comes from *plural, independent* rebuilds, not from one reproducible build.** A single reproducible build on a compromised server is poisoned and self-attesting. The defense is diversity: N mutually-distrusting builders must agree. Bitcoin requires multiple humans; Debian runs rebuilderd on separate infra. The number that matters is "how many independent parties confirmed it," not "is it reproducible in principle."

- **Hermeticity is the cheap road in; the gate is the lock that keeps it.** NixOS/Guix get reproducibility almost for free because the build system *enforces* determinism — verification is a cheap confirmation. Retrofitting (Debian/Arch) is the expensive road: chase leaks, then measure. Either way, an *enforced gate* is what stops a green build from rotting back to red.

- **Signing answers "who," provenance answers "how/from what," reproducibility answers "does it match."** SolarWinds passed "who," and the attack lived in the gap where "does it match" should have been. SLSA is the ladder that demands all three.

- **The value scales with the number of would-be verifiers.** Distributions, wallets, regulated firmware: many verifiers, high payoff. Internal service you alone build and run: ~zero external verifiers, payoff is mostly caching — buy the cheaper thing.

---

## Common Mistakes

1. **Treating a signature as proof the binary matches the source.** It proves *who* built it, not *what from*. This is the exact SolarWinds gap. Pair signing with reproducibility + independent rebuild.

2. **A reproducible build with no independent rebuilder.** Reproducibility nobody cashes in via a second builder gives almost no defense against a compromised build server — the attacker controls the one build and its hash. Stand up (or join) a rebuilder, or require a multi-builder quorum for high-stakes artifacts.

3. **Building twice *identically* and calling it verified.** Same dir, same instant, same user masks path and time leaks. A real gate *varies* path, clock (`faketime`), user, hostname, locale, and parallelism — as Debian does.

4. **Claiming "reproducible" without pinning the toolchain publicly.** "Reproducible inside our company this month" isn't verifiable by anyone. Pin the base image *by digest*, publish the exact toolchain, or the claim is hollow (war story 3).

5. **Running the gate only per-PR.** External drift (rebuilt base image, republished dependency) breaks reproducibility with no code change. Add a *scheduled* rebuild-and-diff of the *released* artifact.

6. **Forcing bit-reproducibility on internal services for the security story it doesn't provide.** If no one outside rebuilds your binary, the security payoff is near zero; you likely wanted *determinism for caching*, which is cheaper. Spend the effort where a verifier exists.

7. **Confusing SLSA provenance level with reproducibility.** SLSA L3 hardens the *build*; it doesn't by itself make the output bit-reproducible or independently rebuildable. They're complementary rungs, not the same rung.

---

## Test Yourself

1. SolarWinds' binaries were correctly signed with the vendor's real key, and the source in version control was clean. Why did both source review and signature verification fail to catch SUNBURST, and which property *would* have?
2. Why does a reproducible build, on its own, provide little defense against a compromised build server — and what additional thing fixes that?
3. Contrast Debian/Arch's reproducibility model with NixOS/Guix's. What does each get "for free" and what does each have to work for?
4. What do the three SLSA build levels add, and where does reproducibility sit relative to them?
5. Distinguish what *signing* proves from what *reproducibility* proves. Why do you need both, and which one did SolarWinds lack?
6. Give two classes of software where bit-reproducibility clearly earns its cost and one where it usually doesn't — and say what the "doesn't" case probably wanted instead.

<details>
<summary>Answers</summary>

1. Source review failed because the **source was clean** — the backdoor was injected *during the build*, not committed. Signature verification failed because the binary was **authentically signed with SolarWinds' genuine key** (the build server itself, a trusted insider, was compromised), so the signature was valid. Signing proves *who built/shipped it*, not *that the binary matches the source*. The property that would have caught it: a **reproducible build independently rebuilt** — an honest rebuild of the clean source produces a different hash than the trojaned binary, an un-hand-waveable mismatch.

2. Because if the *one* build server is compromised, it produces the poisoned binary *and* its hash, and signs "this matches source" — a single reproducible build is self-attesting and the attacker controls it. The fix is **plural, independent rebuilders**: multiple mutually-distrusting parties rebuild from source and must *agree* on the hash; an attacker would have to compromise all of them at once.

3. **Debian/Arch:** retrofit reproducibility onto an existing ecosystem — they get a huge, varied package corpus and a measurable percentage, but must *chase leaks* across thousands of packages and run a varying mass-rebuilder to find them. **NixOS/Guix:** the build system is *hermetic by construction* (sandboxed, content-addressed, no ambient env), so determinism is the default and verification (`nix build --rebuild`) is a cheap confirmation — they get reproducibility nearly for free but had to build a whole hermetic system to get there.

4. **L1:** signed-or-not provenance *exists* (what/from-where/by-whom). **L2:** provenance is **signed by a hosted build service** (tamper-evident, not developer-forgeable). **L3:** the build runs in a **hardened, isolated/hermetic environment** preventing self-forged provenance or cross-build influence. Reproducibility is **complementary**: SLSA hardens and documents the *build*; reproducibility lets a third party *independently verify the output matches the source*. L3 hermeticity is also exactly what makes builds reproducible.

5. **Signing** proves **authenticity/integrity** — this came from key-holder `K` and wasn't altered (the *who*). **Reproducibility** proves **source↔binary correspondence** — anyone rebuilding the source gets this hash (the *what-from*). You need both because each covers a gap the other doesn't; together they give "from this source *and* published by this party." SolarWinds had signing and **lacked reproducibility/independent rebuild** — the missing half.

6. **Earns its cost:** (a) security-critical software handling money/secrets/identity (wallets, password managers) — threat model includes tampered binaries; (b) package distributions / OS / container base images — millions install un-auditable binaries, anyone can verify the distribution. (Also regulated/safety-critical firmware as auditable evidence.) **Usually doesn't:** an internal-only service nobody outside rebuilds — near-zero external verifiers, so little security payoff; it probably wanted **determinism for caching** (cheaper, different justification), not full bit-reproducibility.

</details>

---

## Cheat Sheet

```
THE THREE TRUST PIECES (you need all three)
  SIGNING          who built/shipped it      (authenticity)      ← SolarWinds HAD this
  PROVENANCE/SLSA  how + from what            (build integrity)
  REPRODUCIBILITY  does binary match source?  (verifiable by anyone) ← SolarWinds LACKED this

SOLARWINDS LESSON
  source clean + binary signed with REAL key + build server compromised
  → source review & signature BOTH pass, trojan ships to ~18k orgs
  → only reproducible + INDEPENDENT REBUILD exposes the hash mismatch

REBUILD-AND-DIFF GATE (standing infra)
  build A (canonical hermetic env, pinned toolchain@sha256)
  build B: VARY {dir, faketime, $USER, $HOSTNAME, locale, -jN}  ← attack your own claim
  cmp -s A B || { diffoscope --html report A B ; exit 1 ; }
  run PER-PR (code regressions) AND NIGHTLY (external drift)

HOW THE BIG PROJECTS DO IT
  Debian  central varying mass-rebuilder + % dashboard (retrofit + measure)
  Arch    reproducible-% as a tracked release metric ; archlinux-repro
  NixOS   hermetic BY CONSTRUCTION → nix build --rebuild confirms (cheap)
  Bitcoin Guix + MULTIPLE independent human builders must agree+sign (quorum)

VERIFIABLE BUILDS
  reproducibility = precondition ; REBUILDER (rebuilderd) = the verifier
  security from PLURAL independent rebuilds, not one reproducible build
  require N mutually-distrusting builders to agree on the hash

SLSA BUILD LEVELS
  L1 provenance exists | L2 signed by hosted builder | L3 isolated/hermetic build

SIGN THE REPRODUCIBLE HASH
  SOURCE_DATE_EPOCH/LC_ALL=C/TZ=UTC build → stable hash
  cosign sign-blob app ; cosign attest --predicate provenance.json
  repro is what lets N signers sign the SAME hash (quorum the attacker can't forge)

WORTH IT?  (∝ number of would-be verifiers)
  YES  wallets/secrets, distros/base images, regulated firmware, redistributed OSS
  NO   internal-only service nobody rebuilds → you wanted CACHING determinism (cheaper)
  FREE-ish  already hermetic for caching → gate is the only marginal cost
```

---

## Summary

- A professional reproducibility program is **standing infrastructure**, not a one-off check: a **rebuild-and-diff gate** that *adversarially varies* the irrelevant (path, clock via `faketime`, user, hostname, locale, parallelism) and fails with a `diffoscope` report — run **per-PR and on a schedule**, because external drift breaks reproducibility with no code change.
- The large programs prove it scales, via two composable models: **retrofit + measure** (Debian's varying mass-rebuilder + percentage dashboard, Arch's tracked metric) and **hermetic by construction** (NixOS, Guix), with **Bitcoin** layering **multiple independent human builders who must agree** for high-stakes money.
- Reproducibility is only cashed in by **independent rebuilders** (e.g. rebuilderd): security comes from *plural, mutually-distrusting* rebuilds agreeing — a single reproducible build on a compromised server is self-attesting and useless against that threat.
- The supply-chain framing: **SolarWinds** injected a backdoor *during the build*, defeating both clean-source review and authentic signing — proving **signing answers "who," not "does it match the source."** **SLSA** (L1 provenance exists → L2 signed by hosted builder → L3 isolated build) institutionalizes build integrity; reproducibility is the complementary rung that makes provenance *checkable*.
- **Signing and reproducibility are orthogonal and both required**: signing proves the publisher, reproducibility proves source↔binary; reproducibility is also what lets *N* independent signers sign the *same* hash (the quorum a compromised builder can't forge). Sign the *reproducible* hash, pin the toolchain *publicly by digest*.
- The cost/benefit is governed by **how many parties want to independently verify source↔binary**: high payoff for wallets/distros/regulated firmware/redistributed OSS; low for internal-only services (which usually wanted cheaper *caching* determinism). If you're already hermetic for caching, the gate is the only marginal cost.

[interview.md](interview.md) consolidates all five tiers into a question bank with model answers and design scenarios (including "design a verifiable release pipeline" and "make this build reproducible").

---

## Further Reading

- [reproducible-builds.org](https://reproducible-builds.org/) and its [Who is involved](https://reproducible-builds.org/who/) page — the project, the participating distributions, and the rebuilder ecosystem.
- [tests.reproducible-builds.org](https://tests.reproducible-builds.org/) and [rebuilderd](https://github.com/kpcyrd/rebuilderd) — Debian's varying mass-rebuilder dashboard and the independent-rebuilder service.
- [SLSA framework](https://slsa.dev/spec/) and [in-toto attestations](https://github.com/in-toto/attestation) — the build-integrity ladder and the provenance/attestation formats.
- [CISA / FireEye SUNBURST (SolarWinds) analysis](https://www.mandiant.com/resources/blog/sunburst-additional-technical-details) — the canonical motivating attack.
- [Bitcoin Core Guix build / multi-builder attestation](https://github.com/bitcoin/bitcoin/blob/master/contrib/guix/README.md) — adversarial reproducibility for high-stakes software.

---

## Related Topics

- [05 — Polyglot & Hermetic Builds › professional](../05-polyglot-hermetic-builds/professional.md) — the hermetic, pinned-toolchain foundation that makes reproducibility cheap and SLSA L3 achievable.
- [07 — Build Caching › professional](../07-build-caching/professional.md) — the *same* determinism property, the near-free on-ramp to reproducibility.
- [08 — Cross-Compilation › professional](../08-cross-compilation/professional.md) — reproducibility as auditable evidence for firmware and trust for un-runnable cross-built artifacts.
- [Release Engineering › Artifact Signing & Provenance](../../release-engineering/04-artifact-signing-and-provenance/professional.md) — signing, Sigstore/cosign, and provenance for the reproducible artifacts you ship.
- [Release Engineering › Supply-Chain Security](../../release-engineering/09-supply-chain-security/professional.md) — SLSA, the threat model, and where reproducibility sits among the defenses.
- [interview.md](interview.md) — the consolidated question bank and design scenarios.
