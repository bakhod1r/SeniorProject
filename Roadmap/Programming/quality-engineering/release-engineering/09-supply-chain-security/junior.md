# Supply-Chain Security — Junior Level

> **Roadmap:** [Release Engineering](../README.md) → Supply-Chain Security
>
> *Most of your code isn't yours. Learn who you're trusting, and how that trust gets attacked.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The chain: source, build, publish, consume](#core-concept-1--the-chain-source-build-publish-consume)
5. [Core Concept 2 — You depend on strangers](#core-concept-2--you-depend-on-strangers)
6. [Core Concept 3 — Lockfiles pin what you actually got](#core-concept-3--lockfiles-pin-what-you-actually-got)
7. [Core Concept 4 — Scanning your dependencies for known holes](#core-concept-4--scanning-your-dependencies-for-known-holes)
8. [Core Concept 5 — The cheap habits that stop most attacks](#core-concept-5--the-cheap-habits-that-stop-most-attacks)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **understanding what the software supply chain is, why every link is an attack surface, and the everyday habits — lockfiles, scanning, careful adds — that protect you.**

When you run `npm install`, `go get`, or `pip install`, you pull in code written by people you have never met, built on machines you will never see, published to registries you do not control. That borrowed code runs with the same privileges as your own. If any link in that journey is tampered with, the malicious code lands inside *your* application and *your* CI — with your credentials, your network access, your customers' data.

**Supply-chain security** is the practice of defending everything that happens between a dependency author writing a line of code and that code running inside your artifact. As a junior engineer you won't design the org program, but you make supply-chain decisions every day: which package to add, whether to commit the lockfile, whether to ignore the scanner warning. This file gives you the threat model and the cheap, high-leverage habits.

---

## Prerequisites

- You can install dependencies with a package manager (npm, pip, go, cargo, or similar).
- You understand the difference between a **direct dependency** (you asked for it) and a **transitive dependency** (your dependency asked for it).
- You have used Git and opened a pull request.
- Helpful: skim [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) and [Registries & Distribution](../05-registries-and-distribution/) afterward.

---

## Glossary

| Term | Meaning |
|------|---------|
| **Supply chain** | Everything from a dependency author → build → publish → your running artifact. |
| **Dependency** | External code your project pulls in. *Direct* = you declared it; *transitive* = pulled in by another dependency. |
| **Registry** | A server that hosts packages: npmjs.com, PyPI, crates.io, the Go module proxy. |
| **Lockfile** | A file recording the *exact* versions (and often hashes) you installed, e.g. `package-lock.json`, `go.sum`. |
| **Pinning** | Specifying an exact version (or hash) instead of a range like `^1.2.0`. |
| **CVE** | Common Vulnerabilities and Exposures — a public ID for a known security flaw, e.g. `CVE-2021-44228` (Log4Shell). |
| **SBOM** | Software Bill of Materials — a list of every component in your artifact. (Detail in [middle](middle.md).) |
| **Scanner** | A tool that compares your dependencies against databases of known vulnerabilities. |
| **Typosquatting** | A malicious package named to look like a real one (`reqeusts` vs `requests`). |

---

## Core Concept 1 — The chain: source, build, publish, consume

A dependency travels through four stages before it runs in your product. Each arrow is an edge an attacker can target:

```
  AUTHOR            REGISTRY              YOU
 ┌────────┐  push  ┌──────────┐  install ┌──────────┐  build  ┌──────────┐
 │ SOURCE │ ─────▶ │ PUBLISH  │ ───────▶ │ CONSUME  │ ──────▶ │ ARTIFACT │
 │ (git)  │        │ (npm/    │          │ (your    │         │ (deploy) │
 │        │        │  PyPI)   │          │  repo+CI)│         │          │
 └────────┘        └──────────┘          └──────────┘         └──────────┘
     ▲                  ▲                     ▲                    ▲
  compromise        account             dependency           build system
  the source        takeover            confusion /          compromised
  (xz backdoor)     typosquat           bad install          (SolarWinds)
```

The crucial mental shift: **you don't just trust the package you chose. You trust the author, their account credentials, the registry's integrity, the build that produced the artifact, and every transitive dependency underneath — recursively.** A vulnerability or a backdoor anywhere in that tree is *your* vulnerability.

This is why "I only use popular, well-maintained packages" is necessary but not sufficient. Popular packages have maintainers whose accounts get phished, and they pull in dozens of less-popular transitive deps you have never heard of.

---

## Core Concept 2 — You depend on strangers

Count your dependencies once and the scale becomes obvious:

```bash
# Node: how many packages are actually installed?
npm ls --all 2>/dev/null | grep -c '──'

# Go: list every module in the build graph
go list -m all | wc -l

# Python (poetry): everything in the lock
grep -c '^name = ' poetry.lock
```

A modest web service routinely has **hundreds to thousands** of transitive packages. You read the code of maybe three of them. The rest you trust by reputation and momentum.

Two consequences:

1. **Attack surface is huge.** Any one of those packages can ship malicious code in its next release, and you'll pull it in the next time you update — automatically, if you use version ranges.
2. **You inherit their security posture.** If a dependency leaks credentials, runs install scripts that exfiltrate environment variables, or hasn't patched a CVE, that becomes your problem at runtime.

You can't audit everything. The goal is not zero trust — it's **bounded, reviewed, and observable trust**: know what you depend on, pin it, scan it, and add new dependencies deliberately.

---

## Core Concept 3 — Lockfiles pin what you actually got

A `package.json` says `"lodash": "^4.17.0"` — *any* 4.x release from 4.17.0 up. That's a **range**. The same install on two different days, or on your machine vs CI, can resolve to different actual versions. Ranges are how a malicious new release silently enters your build.

A **lockfile** records the *exact* version you resolved, plus a cryptographic hash of the package contents:

```jsonc
// package-lock.json (excerpt)
"node_modules/lodash": {
  "version": "4.17.21",
  "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
  "integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvKw=="
}
```

That `integrity` hash is the heart of it. On install, the package manager downloads the tarball, hashes it, and **refuses to proceed if the hash doesn't match.** So even if the registry is compromised and serves you a tampered tarball, the lockfile catches it.

Go does the same with `go.sum`:

```
golang.org/x/text v0.14.0 h1:ScX5w1eTa3QqT8oi6+ziP7dTV1S2+ALU0bI+0zXKWiQ=
golang.org/x/text v0.14.0/go.mod h1:18ZOQIKpY8NJVqYksKHtTdi31H5itFRjB5/qKTNYzSU=
```

The `h1:` line is the hash of the module's *files*; the `/go.mod h1:` line is the hash of just its `go.mod`. When you build, Go verifies the downloaded module against these hashes. **`go.sum` does not say "this code is safe" — it says "this is the exact same code that was approved when the line was written."** It protects *integrity*, not *quality*. A backdoored module with a stable hash passes `go.sum` perfectly.

**The single most important junior habit:** commit your lockfile, and use the install command that *respects* it rather than re-resolving:

```bash
npm ci            # installs exactly from package-lock.json; fails if out of sync
# not: npm install (may update the lockfile)

go mod verify     # checks the module cache against go.sum
```

---

## Core Concept 4 — Scanning your dependencies for known holes

Most real-world supply-chain pain isn't a clever backdoor — it's a *known* vulnerability you never patched. Public databases (the GitHub Advisory Database, OSV, the NVD) track which package versions have which CVEs. A **scanner** matches your installed versions against those databases.

`osv-scanner` (free, from Google's OSV project) reads your lockfile directly:

```bash
# Install once, then scan a project by its lockfile
osv-scanner --lockfile=package-lock.json
osv-scanner --lockfile=go.mod
osv-scanner scan .          # auto-discovers lockfiles in the tree
```

Typical output flags a package, the vulnerable version range, and the fixed version:

```
╭─────────────────────────────────────┬──────────┬───────────╮
│ OSV ID                              │ ECOSYSTEM│ PACKAGE   │
├─────────────────────────────────────┼──────────┼───────────┤
│ GHSA-jchw-25xp-jwwc (CVE-2024-…)   │ npm      │ tar       │
╰─────────────────────────────────────┴──────────┴───────────╯
```

`grype` does the same for container images and directories:

```bash
grype dir:.                 # scan the current project
grype myorg/api:1.4.2       # scan a built container image
```

And **Dependabot** (GitHub) opens pull requests automatically when a dependency you use gets a security advisory — turning "we should patch that someday" into a reviewable PR in your inbox.

The junior takeaway: a scanner finding is not noise to dismiss. It's a to-do. When CI flags a vulnerable dependency, the fix is usually a version bump — exactly what Dependabot proposes.

---

## Core Concept 5 — The cheap habits that stop most attacks

You don't need an enterprise program to dramatically shrink your risk. Five habits:

1. **Commit the lockfile and install from it.** `npm ci`, `go mod verify`, `pip install --require-hashes`. This neutralizes tampered downloads and surprise version drift.
2. **Add dependencies deliberately.** Before `npm install some-pkg`, ask: how popular is it? When was it last published? Does the name match what I meant (typo check)? Could I write this in 20 lines instead? `left-pad` taught the industry that an 11-line package can become a single point of failure.
3. **Run a scanner in CI.** Fail the build on new high-severity findings. `osv-scanner` is one command.
4. **Turn on Dependabot/Renovate.** Let the robots open the patch PRs; you just review and merge.
5. **Never ignore install-script warnings blindly.** Many ecosystems run arbitrary code at install time (npm `postinstall`, Python `setup.py`). That code runs with your shell's environment — including secrets. Be suspicious of unexpected install scripts.

These are the cyber-hygiene basics. The middle and senior tiers build SBOMs, provenance verification, and org-wide policy on top of this foundation — but the foundation is what stops the *common* attacks.

---

## Real-World Examples

- **left-pad (2016).** A developer unpublished an 11-line npm package, and thousands of builds across the ecosystem broke instantly — including major projects. Not an *attack*, but the clearest possible demonstration that tiny transitive dependencies are real dependencies, and that the registry is a runtime dependency of your build.

- **event-stream (2018).** A popular npm package was handed off to a new "maintainer" who had volunteered to help. That maintainer added a malicious transitive dependency designed to steal Bitcoin wallets. Lesson: *maintainer trust transfers silently*, and the danger was buried in a dependency-of-a-dependency, not the package you installed.

- **Typosquatting.** Attackers publish packages like `python3-dateutil` (real: `python-dateutil`) or `crossenv` (real: `cross-env`). One typo in an install command and you've run their code. Always double-check package names.

- **Dependency confusion (Alex Birsan, 2021).** A researcher uploaded packages to *public* registries using the same names as companies' *private* internal packages. Many build tools, told to fetch `internal-auth-lib`, preferred the higher-versioned public copy — and ran the researcher's code inside Apple, Microsoft, and dozens of others. Lesson: where your packages come from matters as much as their names.

- **xz/liblzma backdoor (2024).** A patient attacker spent ~two years building maintainer trust on the `xz` compression library, then slipped a backdoor into the release tarballs that targeted SSH. It was caught by luck (a Postgres engineer noticed a half-second SSH slowdown) days before it would have shipped widely. Lesson: even a thoroughly "trusted" upstream can be compromised through *people*, not code.

---

## Mental Models

- **`npm install` is `curl | bash` with extra steps.** You are downloading and executing code from the internet. Treat it with the same caution.
- **Your dependency tree is your trust tree.** Every node is something you've decided to trust, whether you realize it or not.
- **The lockfile is a memory of what you approved.** Without it, every install is a fresh, unreviewed roll of the dice.
- **A hash proves "same," not "safe."** `go.sum` and `integrity` guarantee you got the *identical bytes* — not that those bytes are benign.

---

## Common Mistakes

- **Not committing the lockfile** (or `.gitignore`-ing it). Now everyone — and CI — resolves versions independently and unpredictably.
- **`npm install` in CI instead of `npm ci`.** The former can quietly mutate the lockfile and pull newer versions.
- **Dismissing scanner output** as "false positives" without reading it. Most findings are real, fixable version bumps.
- **Adding a dependency for a one-liner.** Every add expands the trust tree forever, including its transitive deps.
- **Copy-pasting install commands from random blogs** without checking the package name. This is exactly how typosquatting wins.
- **Assuming popular = safe.** event-stream and xz were both popular and trusted right up until they weren't.

---

## Test Yourself

1. Name the four stages of the software supply chain and give one attack against each.
2. What does the `integrity` field in `package-lock.json` actually protect against — and what does it *not* protect against?
3. Why is `npm ci` preferred over `npm install` in a CI pipeline?
4. A teammate says "`go.sum` makes our dependencies secure." What's the precise correction?
5. What is dependency confusion, and which 2021 research made it famous?
6. Why was the xz backdoor so dangerous despite xz being a "trusted" project?

---

## Cheat Sheet

```bash
# Install from the lockfile (don't re-resolve)
npm ci
pip install --require-hashes -r requirements.txt
go mod verify

# Count your real dependency footprint
go list -m all | wc -l
npm ls --all 2>/dev/null | grep -c '──'

# Scan for known vulnerabilities
osv-scanner --lockfile=package-lock.json
osv-scanner scan .
grype dir:.

# Before adding a dep, ask:
#   popular? recently maintained? name spelled right? could I inline it?
```

| Want to... | Use |
|------------|-----|
| Lock exact versions + hashes | Commit the lockfile; install with `npm ci` / `--require-hashes` |
| Find known CVEs in deps | `osv-scanner`, `grype`, Dependabot |
| Auto-PR security patches | Dependabot / Renovate |
| Verify modules unchanged | `go mod verify` |

---

## Summary

The software supply chain runs **source → build → publish → consume**, and every edge is an attack surface. You depend on hundreds of strangers transitively, and their code runs with your privileges. The highest-leverage junior habits are cheap: **commit lockfiles and install from them** (so a tampered or drifting dependency can't silently enter), **scan dependencies for known CVEs** in CI, **let Dependabot open patch PRs**, and **add new dependencies deliberately**. Remember the incidents — left-pad, event-stream, dependency confusion, xz — because each one names a specific way the chain breaks. A hash proves *same*, not *safe*; that distinction is the seed of everything in the higher tiers.

---

## Further Reading

- OWASP — "Top 10 CI/CD Security Risks" and dependency-management guidance.
- OSV-Scanner documentation (osv.dev) — running scans against your lockfiles.
- GitHub Docs — "About Dependabot" and the Advisory Database.
- Alex Birsan — "Dependency Confusion" (2021 write-up).
- The `secrets-management` skill — why install scripts having access to your environment is dangerous.

---

## Related Topics

- [Artifact Signing & Provenance](../04-artifact-signing-and-provenance/) — how signatures and provenance let you *verify* what you consume (mechanics live there).
- [Registries & Distribution](../05-registries-and-distribution/) — where packages come from and how registries are configured.
- [Release Automation](../08-release-automation/) — where scanning gates fit in the pipeline.
- [Static Analysis](../../static-analysis/) — finding bugs in *your* code, complementary to scanning your deps.
- [Build Systems](../../build-systems/) — how artifacts get built (the build is part of the chain).
- Next tier: [Supply-Chain Security — Middle Level](middle.md).
