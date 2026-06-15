# Supply-Chain Integrity — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is the software supply chain?" and "How does an attacker get into my program through a dependency I never wrote?"

When you write a Go program, you write maybe a few thousand lines yourself. But the binary you ship contains hundreds of thousands of lines you did not write — the code of every dependency in your `go.mod`, plus the dependencies of those dependencies, all the way down. That chain of "code from other people that ends up in your binary" is your **software supply chain**.

Supply-chain *integrity* is the practice of making sure that every byte of that borrowed code is exactly what you think it is: the right package, the right version, untampered, and free of known vulnerabilities. If any link in the chain is compromised — a popular library gets a malicious update, a maintainer's account is hijacked, a typo in an import path pulls a look-alike package — the attacker's code runs inside *your* program, with *your* permissions, against *your* users.

This is not a hypothetical. The 2024 `xz` backdoor, the 2020 SolarWinds breach, and a steady stream of npm and PyPI incidents all share one shape: the attacker did not break into the target directly. They poisoned something the target *trusted and pulled in automatically*.

Go was designed in the post-`GOPATH` era with these threats in mind, and it ships strong built-in defenses:

```bash
# Go records a cryptographic hash of every dependency it ever downloads:
cat go.sum

# Go scans your code for known vulnerabilities — and only flags the ones
# you actually call:
govulncheck ./...
```

After reading this file you will:
- Understand what the supply chain is and why it is a security boundary
- Know the main attack categories (typosquatting, dependency confusion, compromised updates)
- Understand `go.sum` and the checksum database as Go's first line of defense
- Run `govulncheck` and read its output
- Know what "minimal, reviewed dependencies" means and why it matters
- Build a habit of treating every dependency as code you are responsible for

You do **not** yet need to understand SLSA levels, SBOM formats, cosign signing, or reproducible-build internals. Those come later. This file is about the moment you realize: *"the code I import is code I ship, and I am responsible for it."*

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. Check with `go version`. Modern supply-chain tooling assumes 1.21+.
- **Required:** A Go module — a folder with a `go.mod` file. If unsure, see [01-go-mod-init/junior.md](../01-go-mod-init/junior.md).
- **Required:** Familiarity with `go get`, `go mod tidy`, and `go.sum`. See [02-go-mod-tidy/junior.md](../02-go-mod-tidy/junior.md).
- **Required:** Comfort with the command line and basic Git.
- **Helpful:** Having added at least one third-party dependency, so you have something whose integrity to reason about.
- **Helpful:** A basic idea of what a cryptographic hash is — a short fingerprint that changes completely if even one byte of the input changes.

If `go version` prints `go1.21` or higher and you have at least one `require` line in a `go.mod`, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Software supply chain** | Everything that goes into your final binary that you did not write yourself: dependencies, transitive dependencies, build tools, and the toolchain. |
| **Dependency** | A module your code imports directly (listed in `require` in `go.mod`). |
| **Transitive dependency** | A dependency of one of your dependencies. You did not ask for it; it came along for the ride. |
| **`go.sum`** | A file recording the cryptographic hash of every module version your build has used. Tamper detection. |
| **Checksum database (sumdb)** | A global, append-only, public log (`sum.golang.org`) of module hashes. It lets Go detect if someone serves you different bytes than everyone else got. |
| **Module proxy** | A server (default `proxy.golang.org`) that caches and serves module source. Improves availability and integrity. |
| **`govulncheck`** | Go's official vulnerability scanner. Reports known vulnerabilities — but only those your code actually *calls*. |
| **Go vulnerability database** | The curated database of Go vulnerabilities at `vuln.go.dev`, built on the OSV format. |
| **Typosquatting** | Registering a package name that looks almost like a popular one (`gihub.com/...`) hoping for a typo. |
| **Dependency confusion** | Tricking a build into pulling a public look-alike of an internal/private package. |
| **CVE / vuln** | A publicly catalogued security vulnerability. |
| **Provenance** | Verifiable evidence of *where* an artifact came from and *how* it was built. |

---

## Core Concepts

### Your dependencies are your code, security-wise

The single most important idea: **importing a package is morally equivalent to copying its source into your repository.** Once `github.com/some/lib` is in your `go.mod` and you call its functions, its code runs in your process, reads your memory, makes network calls under your identity, and ships in your binary. The fact that it lives in a different GitHub repo does not make it someone else's responsibility at runtime.

So the question "is this dependency safe?" is really "would I be comfortable shipping this code if I had written it myself?"

### The chain has many links

When you `go get github.com/gin-gonic/gin`, you do not pull one package. You pull Gin, plus everything Gin imports, plus everything *those* import. A small `go.mod` with three `require` lines can expand to fifty modules in the full build list. Each of those fifty is a place an attacker could hide.

Run this to see the full set:

```bash
go list -m all
```

Every line is a module that contributes code to your build. Every line is part of your trust boundary.

### `go.sum` makes downloads tamper-evident

The first time Go downloads a module version, it computes a hash of its contents and records it in `go.sum`:

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Every later build re-checks the downloaded bytes against this recorded hash. If even one byte changed — because a proxy was compromised, a network was tampered with, or a maintainer force-pushed a different version under the same tag — the build **fails loudly** instead of silently compiling the attacker's code.

`go.sum` is not a wish-list of versions (that is `go.mod`). It is a **cryptographic receipt**: "these exact bytes are what we used."

### The checksum database catches the harder attack

`go.sum` protects you *after* the first download. But what about the first download itself? What if the attacker serves you bad bytes the very first time, so the bad hash gets recorded?

That is what the **checksum database** (`sum.golang.org`, configured via `GOSUMDB`) defends against. It is a global, public, append-only, tamper-evident log of module hashes. When Go fetches a module version for the first time, it asks the checksum database what hash *everyone else* recorded for that version. If your bytes do not match the global record, Go refuses.

Because the log is append-only and cryptographically verifiable (it is a Merkle-tree transparency log, like Certificate Transparency for TLS certificates), an attacker cannot quietly insert a fake hash for one victim without it being globally visible.

We recap the proxy and sumdb only briefly here — the dedicated page [05-module-proxy-and-checksum-db](../05-module-proxy-and-checksum-db/junior.md) covers their mechanics in depth.

### `govulncheck` tells you which known holes you are exposed to

Hashes prove your dependencies are *unchanged*. They do not prove your dependencies are *safe*. A dependency can be exactly the bytes everyone agreed on — and still contain a known security bug.

`govulncheck` closes that gap. It compares your dependency set against the Go vulnerability database and reports the vulnerabilities that apply to you. Its standout feature: it does **symbol-level** analysis. It does not just say "you depend on a vulnerable version of library X." It says "you depend on a vulnerable version of X, *and your code actually calls the vulnerable function.*" If the vulnerable function exists in your dependency tree but nothing in your code path reaches it, `govulncheck` tells you that too — so you do not waste time on threats you are not exposed to.

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

### Fewer, well-chosen dependencies = smaller attack surface

Every dependency is a link in the chain. Every link is a potential point of failure. The simplest, most powerful supply-chain practice available to a junior engineer is: **add fewer dependencies, and choose them carefully.** A 10-line utility function you copy into your own code is not a supply-chain risk. A 10-line utility you pull as a one-function dependency drags in a whole module — and its future updates, and its own dependencies — into your trust boundary forever.

---

## Real-World Analogies

**1. A potluck dinner.** You cook one dish. Everyone else brings the rest. The meal (your binary) is mostly food you did not prepare. If one guest's dish is contaminated, *your* guests get sick — at *your* table. Supply-chain integrity is checking that every dish is safe before it hits the buffet, not just the one you made.

**2. A sealed-tamper bottle of medicine.** `go.sum` is the foil seal under the cap. If the seal is broken, you do not take the pill. You do not assume "probably fine." The whole point of the seal is that *any* tampering is visible, and visible tampering means stop.

**3. The signature on a delivered package.** The checksum database is like a courier network where every package's contents are photographed and logged in a public ledger the moment it is created. When your package arrives, you compare it to the public photo. A package swapped in transit will not match — and because the ledger is public and append-only, the swapper cannot fake the photo without everyone noticing.

**4. A health inspection, not a bouncer.** `go.sum` is a bouncer who checks IDs — it confirms identity, not character. `govulncheck` is the health inspector who knows which specific batches have been recalled and checks whether *your kitchen actually uses* that batch. Both matter; they answer different questions.

**5. A look-alike storefront.** Typosquatting is a fake shop next door to the real one, with a near-identical sign, hoping you walk in by mistake. The defense is reading the address carefully before you enter — checking the exact import path, not the one that "looks right."

---

## Mental Models

### Model 1 — The trust boundary is your whole build list, not your repo

Your security perimeter is not "the code I wrote." It is "everything in `go list -m all`." Internalize that the perimeter is large and that most of it is code you have never read.

### Model 2 — Two separate guarantees: *unchanged* vs *not-known-bad*

- `go.sum` + sumdb answer: *"are these the exact bytes everyone agreed on?"* (integrity)
- `govulncheck` answers: *"do those agreed-upon bytes contain a known security hole I actually reach?"* (vulnerability)

Confusing the two is the most common junior mistake. Hashes do not detect vulnerabilities; vuln scanners do not detect tampering.

### Model 3 — Defense in depth, layer by layer

```
[1] minimal dependencies        ← fewer links to attack
[2] go.sum                      ← downloads are tamper-evident
[3] checksum database           ← first downloads verified globally
[4] govulncheck                 ← known vulns surfaced at symbol level
[5] reviewed updates            ← humans look before bumping versions
```

No single layer is enough. Each catches what the others miss.

### Model 4 — An update is an untrusted code drop

When you run `go get -u`, you are accepting new code from the internet into your binary. Treat a version bump with the same seriousness as a pull request from a stranger: review it, scan it, do not merge it blindly.

### Model 5 — The attacker targets *automation*, not you

Supply-chain attacks work because builds are automatic. Nobody reads the diff of a transitive dependency on a routine `go mod tidy`. The attacker hides in the place humans never look. The defense is to add machine checks (`govulncheck`, `go.sum` verification) at exactly the spots automation flows through.

---

## Pros & Cons

These are the pros and cons of *taking supply-chain integrity seriously*, not of any single tool.

### Pros

- **Catches malicious or tampered code before it ships.** `go.sum` and sumdb make silent substitution effectively impossible.
- **Surfaces known vulnerabilities you actually use.** `govulncheck`'s call-graph analysis means high signal, low noise.
- **Built into the toolchain.** Go's defenses are on by default — you mostly have to *not turn them off*.
- **Cheap to adopt.** A few CI lines give you most of the benefit.
- **Improves auditability.** You can answer "what do we depend on, and is any of it vulnerable?" in seconds.

### Cons

- **Requires discipline.** The tools only help if you run them and act on the results.
- **Can produce friction.** A failing `go.sum` check or a `govulncheck` finding blocks a build, which is the point but feels inconvenient.
- **Does not stop a determined, novel attack.** A brand-new malicious package that nobody has flagged yet will pass `go.sum` (it is "unchanged") and `govulncheck` (it is "not known bad"). Integrity tools verify; they do not vet intent.
- **Private modules need configuration.** `GOPRIVATE` must be set correctly, or builds either leak private paths to the public proxy or fail.

The honest framing: these defenses turn *invisible* attacks into *loud* ones, and *blind* updates into *informed* ones. They do not make you immune. Nothing does.

---

## Use Cases

You should care about supply-chain integrity when:

- **You ship software to anyone** — users, customers, internal teams. Their safety depends on your dependencies.
- **You add or update a dependency.** Every `go get` is a moment to verify.
- **You run CI.** CI is the perfect place to enforce checks every contributor cannot skip.
- **You handle sensitive data or run with privileges.** A compromised dependency in a privileged process is a worst case.
- **You maintain a long-lived service.** Yesterday's safe version is tomorrow's CVE; you need ongoing scanning.
- **You operate in a regulated industry.** Finance, healthcare, government, and defense increasingly *require* supply-chain controls and evidence.

You can mostly ignore the heavier machinery (SLSA attestation, SBOM signing) when:

- You are writing a throwaway script or a learning project with no users.
- You have zero third-party dependencies (rare, but it happens for tiny tools).

Even then, running `govulncheck` once costs nothing and is a good habit.

---

## Code Examples

### Example 1 — Seeing your full trust boundary

```bash
# Direct dependencies only:
go mod edit -json | grep -A2 Require

# The complete build list — everything that ships in your binary:
go list -m all

# Count how many modules you actually depend on:
go list -m all | wc -l
```

A small CLI might show 1 direct dependency and 15 total. Those 15 are your supply chain.

### Example 2 — Inspecting `go.sum`

```bash
cat go.sum
```

```
github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=
github.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=
```

Each module version gets two lines:
- `...h1:...` — the hash of the module's source tree (the zip contents).
- `.../go.mod h1:...` — the hash of just that module's `go.mod` file.

Both are verified on every build. You never edit this file by hand; the toolchain manages it.

### Example 3 — Verifying integrity explicitly

```bash
# Re-check every module in the cache against go.sum:
go mod verify
```

Expected output:

```
all modules verified
```

If a cached module's bytes were tampered with after download, this command reports the mismatch.

### Example 4 — Running govulncheck for the first time

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

A clean result:

```
No vulnerabilities found.
```

A finding looks like:

```
Vulnerability #1: GO-2023-1840
    A flaw in ... allows ...
  More info: https://pkg.go.dev/vuln/GO-2023-1840
  Module: github.com/affected/dep
    Found in: github.com/affected/dep@v1.2.0
    Fixed in: github.com/affected/dep@v1.2.1
    Example traces:
      your-module/internal/handler.go:42:13: calls dep.Vulnerable
```

The `Example traces` line is the gold: it shows the exact spot in *your* code that reaches the vulnerable function.

### Example 5 — A vuln that exists but you do not call

```
=== Informational ===

There is 1 vulnerability in modules that you require that is not
imported by a called function. You may not be affected.

Vulnerability #1: GO-2022-0646
  Module: github.com/some/lib
    Found in: github.com/some/lib@v0.4.0
    Fixed in: github.com/some/lib@v0.4.1
```

This is the "Informational" section. The vulnerable code is in your tree, but nothing you call reaches it. Lower priority — but worth fixing on your next routine update.

### Example 6 — Configuring a private module correctly

If you import `git.mycompany.internal/team/lib`, the public proxy and sumdb cannot (and should not) see it:

```bash
# Tell Go this namespace is private: skip the proxy and sumdb for it.
go env -w GOPRIVATE='git.mycompany.internal,*.mycompany.internal'
```

Now `go get git.mycompany.internal/team/lib` fetches directly over your authenticated Git connection, and Go does not leak the path to `sum.golang.org`.

### Example 7 — A minimal CI check

```yaml
# .github/workflows/supply-chain.yml
name: supply-chain
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - name: Verify go.sum
        run: go mod verify
      - name: Scan for vulnerabilities
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          govulncheck ./...
```

Three small steps and every push is now checked for tampering and known vulnerabilities.

---

## Coding Patterns

### Pattern: scan before you ship

Make `govulncheck ./...` part of your definition of "done." Run it locally before opening a PR; enforce it in CI. A green scan is a precondition for merge.

### Pattern: review the diff on every dependency bump

When you bump a version, look at what actually changed:

```bash
go get github.com/some/lib@v1.4.0
go mod tidy
# Inspect what the version change pulled in:
git diff go.mod go.sum
```

A bump that adds five new transitive modules deserves a closer look than a patch-level bump that changes nothing else.

### Pattern: pin, do not float

Always commit `go.mod` and `go.sum`. They pin exact versions. Never rely on "latest" resolving the same way tomorrow as today. Reproducibility is a security property.

### Pattern: prefer copying tiny utilities over importing them

If a dependency is a single small function, consider writing it yourself. The "left-pad" lesson: a trivial dependency is still a full link in the supply chain, with all the risk and none of the leverage.

### Pattern: keep `GOPRIVATE` accurate

Set `GOPRIVATE` (or `GONOSUMDB`/`GOINSECURE` as appropriate) for every private namespace, and no more. Over-broadening it (see Pitfalls) silently disables protections for code that should be checked.

---

## Clean Code

- **Commit `go.sum` always.** Treat a missing or `.gitignore`d `go.sum` as a bug. It is your tamper-evidence record.
- **Run `go mod tidy` before committing** so `go.mod`/`go.sum` reflect exactly what you use — no stale or phantom dependencies hiding in the chain.
- **Do not disable security to make an error go away.** `GONOSUMCHECK`, `GONOSUMDB=*`, or `GOFLAGS=-insecure` "fix" the symptom by removing the guard. Almost never the right move.
- **Keep CI checks fast and mandatory.** A `govulncheck` step that everyone skips because it is slow or flaky protects nothing.
- **Name the reason for any exception.** If you must suppress a finding, document *why* in code or config, not in someone's memory.

---

## Product Use / Feature

When you ship software professionally, supply-chain integrity touches:

- **Release confidence.** "Did we ship a known-vulnerable dependency?" becomes a question you can answer with a command, not a guess.
- **Incident response.** When a new CVE drops, you can scan instantly to learn whether you are affected, instead of manually auditing.
- **Customer trust.** Increasingly, customers and procurement teams ask for evidence (scans, SBOMs) that your supply chain is managed.
- **Compliance.** Regulated industries require documented supply-chain controls. The Go toolchain gives you the primitives.
- **Onboarding.** New engineers inherit a repo where "the supply chain is checked in CI" is just how things work — the safe path is the default path.

For some industries — finance, healthcare, defense, critical infrastructure — supply-chain controls are not a nice-to-have. They are a contractual or legal requirement.

---

## Error Handling

The supply-chain tooling fails in specific, recognizable ways. Each failure is usually *protecting* you.

### `verifying module: checksum mismatch`

```
verifying github.com/foo/bar@v1.2.0: checksum mismatch
        downloaded: h1:AAAA...
        go.sum:     h1:BBBB...
SECURITY ERROR
```

The bytes you just downloaded do not match what `go.sum` recorded. **Stop.** This means either the module was tampered with, the network was compromised, or (innocently) the upstream tag was force-pushed to different content. Do not "fix" it by deleting `go.sum`. Investigate. If you genuinely intended new content, regenerate `go.sum` deliberately with `go mod tidy` and review the change.

### `missing go.sum entry`

```
missing go.sum entry for module providing package github.com/foo/bar
        run 'go mod tidy' to add it
```

You imported something not yet recorded. Fix with `go mod tidy`. This is bookkeeping, not an attack.

### `checksum database lookup ... 410 Gone` for a private module

```
git.acme.internal/team/lib@v1.0.0: reading https://sum.golang.org/...: 410 Gone
```

Go tried to verify a *private* module against the *public* checksum database, which cannot see it. Fix by setting `GOPRIVATE` for that namespace (Example 6). Do **not** fix it by disabling the sumdb globally.

### `govulncheck` reports a vulnerability

This is not a tool error — it is the tool working. Read the trace, find the call site, and upgrade to the fixed version:

```bash
go get github.com/affected/dep@v1.2.1   # the "Fixed in" version
go mod tidy
govulncheck ./...                         # confirm it is gone
```

### `govulncheck: no Go files`

You ran it outside a module or in an empty directory. Run it from your module root with `govulncheck ./...`.

---

## Security Considerations

- **`go.sum` is tamper-evidence, not tamper-prevention.** It tells you something changed; it cannot stop a maintainer from publishing malicious code in the first place.
- **The checksum database does not vet code quality.** It records what was published. A malicious-but-consistent package passes it.
- **`govulncheck` only knows *catalogued* vulnerabilities.** A zero-day or an as-yet-unreported malicious package will pass. Absence of findings is not proof of safety.
- **Disabling protections is a security decision.** `GONOSUMDB`, `GONOSUMCHECK`, `GOINSECURE`, `GOFLAGS=-insecure` all reduce your defenses. Use them narrowly and deliberately, never globally to silence an error.
- **Private modules need `GOPRIVATE`,** or you risk either leaking internal paths to the public proxy/sumdb or failing builds. Set it precisely.
- **Updates are the riskiest moment.** Most supply-chain compromises arrive as a *new version* of a trusted package. Scan and review on every bump.
- **Transitive dependencies are easy to forget.** The package you imported is one link; the dozen it pulled in are the rest. `govulncheck` checks all of them.

---

## Performance Tips

- **`go mod verify` is fast and local** — it just re-hashes the cache. Run it freely in CI.
- **`govulncheck` is fast enough for CI** — typically seconds to low minutes, because it analyzes your call graph, not every line of every dependency.
- **Install `govulncheck` once and cache it** in CI rather than reinstalling on every job, to shave startup time.
- **The checksum database adds negligible latency** — it is consulted only on first download of a version, then `go.sum` handles the rest offline.
- **Scanning does not slow your *runtime*.** All of this is build-time and CI-time work; your shipped binary is unaffected.

---

## Best Practices

1. **Commit and never ignore `go.sum`.** It is your integrity record.
2. **Run `govulncheck ./...` in CI** and fail the build on actionable findings.
3. **Keep dependencies minimal.** The smallest supply chain is the safest.
4. **Review every dependency update** — read the `go.mod`/`go.sum` diff, do not bump blindly.
5. **Set `GOPRIVATE` for private namespaces** precisely; never disable the sumdb globally to work around it.
6. **Leave Go's defaults on.** `GOPROXY`, `GOSUMDB`, and `go.sum` verification are secure by default. Turning them off is the exception, with a documented reason.
7. **Pin versions; never rely on `latest` in production builds.** Reproducibility is security.
8. **Scan on a schedule, not just on change.** New CVEs land against code you already shipped.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Deleting `go.sum` to "fix" a checksum error

A checksum mismatch is a security signal. Deleting `go.sum` and regenerating it accepts whatever bytes you were just served — possibly the attacker's. Investigate first; regenerate only when you understand the cause.

### Pitfall 2 — Over-broadening `GOPRIVATE`

Setting `GOPRIVATE=*` or `GONOSUMDB=*` disables checksum-database verification for *every* module, public ones included. You meant to exempt one internal namespace; you accidentally turned off a global protection. Scope it tightly: `GOPRIVATE='git.acme.internal,*.acme.internal'`.

### Pitfall 3 — Typosquatting in import paths

`github.com/sirupsen/logrus` is real; `github.com/Sirupsen/logrus` (capital S, an old redirect) and any near-miss are traps. Always copy import paths from the project's official page, never type them from memory.

### Pitfall 4 — Assuming `govulncheck` covers everything

It covers *catalogued* vulnerabilities in your *call graph*. It does not detect novel malware, license problems, or code quality. It is one layer, not the whole defense.

### Pitfall 5 — Ignoring the "Informational" section forever

A vuln you do not currently call is still in your tree. A future code change might start calling it. Clear informational findings on your regular update cadence; do not let them pile up.

### Pitfall 6 — Disabling the sumdb in CI for convenience

A CI step that sets `GONOSUMDB=*` or `GOFLAGS=-insecure` to make a flaky network "work" silently disables integrity verification for the whole pipeline. Fix the network or scope the exemption; do not blanket-disable.

### Pitfall 7 — Forgetting transitive dependencies exist

You audit your three direct dependencies and feel safe. The vulnerability is in one of the forty transitive ones. `go list -m all` and `govulncheck` see all of them; your manual review of `go.mod` does not.

### Pitfall 8 — Treating a version bump as risk-free

The most common real-world supply-chain compromise is a *malicious update to a previously trusted package*. "It was fine last week" is not evidence it is fine today. Re-scan after every bump.

---

## Common Mistakes

- **`.gitignore`-ing `go.sum`.** Removes your tamper-evidence. Always commit it.
- **Deleting `go.sum` to silence a checksum error.** Accepts unverified bytes.
- **Setting `GOPRIVATE=*` or `GONOSUMDB=*` globally.** Disables protection for everything to fix one private module.
- **Never running `govulncheck`.** The tool only helps if you run it.
- **Running `govulncheck` but ignoring findings.** A scan you do not act on is theater.
- **Typing import paths from memory.** Invites typosquats.
- **Bumping dependencies with `go get -u` and committing without review.** Blind acceptance of new code.
- **Auditing only direct dependencies.** Ignores the larger transitive surface.
- **Using `GOFLAGS=-insecure` to work around HTTPS issues.** Disables transport security.

---

## Common Misconceptions

> *"`go.sum` checks that my dependencies are safe."*

No. `go.sum` checks that your dependencies are *unchanged* from what was first recorded. Safe and unchanged are different properties. Malicious-but-stable code passes `go.sum`.

> *"If `govulncheck` finds nothing, I have no vulnerabilities."*

No. `govulncheck` finds *catalogued* vulnerabilities you *call*. Unreported issues, novel malware, and uncalled vulnerable code (which it reports separately, as informational) are different categories.

> *"The checksum database can see my private code."*

No, and it should not. Private modules must be exempted via `GOPRIVATE`. The public sumdb only knows public modules.

> *"Vendoring replaces the need for `go.sum` and scanning."*

No. Vendoring copies dependency source into your repo (see [03-go-mod-vendor](../03-go-mod-vendor/junior.md)) for offline, auditable builds. `go.sum` still verifies integrity, and you still need to scan the vendored code for vulnerabilities.

> *"Supply-chain attacks only happen to big companies."*

No. Automated attacks hit everyone who pulls dependencies. Small projects are *easier* targets because they rarely have checks in place.

> *"Once my dependencies pass a scan, I am done."*

No. New vulnerabilities are disclosed continuously against versions you already ship. Scanning is ongoing, not one-time.

---

## Tricky Points

- **`go.sum` has two lines per module version** — one for the source tree (`h1:`), one for the `go.mod` file (`/go.mod h1:`). Both are verified.
- **The sumdb is consulted only on the *first* download** of a version; after that `go.sum` handles verification offline.
- **`GOPRIVATE` is a convenience that sets several variables at once** — it implies `GONOSUMDB` and `GONOPROXY` for the listed patterns. Setting it correctly is usually all you need for private code.
- **`govulncheck` analyzes the call graph**, so the *same vulnerable dependency* can be "actionable" in one project and "informational" in another, depending on whether the vulnerable function is reached.
- **A checksum mismatch can be innocent** (an upstream force-push) or malicious. The tool cannot tell you which; you must investigate.
- **`go.sum` is not encryption.** It is hashing. Anyone can read it; that is fine. Its value is integrity, not secrecy.
- **Removing a dependency is a security improvement.** Fewer links, smaller surface. `go mod tidy` after deleting an import shrinks the chain.

---

## Test

Try this in a scratch folder.

```bash
mkdir sc-test
cd sc-test
go mod init example.com/sc
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
EOF
go mod tidy
cat go.sum
go mod verify
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

Expected: `go.sum` has entries for `uuid`, `go mod verify` prints `all modules verified`, and `govulncheck` reports `No vulnerabilities found.`

Now answer:
1. How many lines does `uuid` get in `go.sum`, and what does each represent? (Answer: two — the source-tree hash and the `go.mod` hash.)
2. What does `go mod verify` actually re-hash — `vendor/`, the cache, or your code? (Answer: the module cache.)
3. If `govulncheck` found a vuln but listed it under "Informational," what does that mean? (Answer: the vulnerable code is present but your call graph does not reach it.)
4. What single environment variable would you set to use a private module at `git.acme.internal/...`? (Answer: `GOPRIVATE`.)

---

## Tricky Questions

**Q1.** I ran `govulncheck` and it found nothing. Am I safe?

A. You are free of *known, catalogued* vulnerabilities that your code *actually calls*. You are not immune to undiscovered issues, novel malware, or vulnerabilities in code you do not currently reach. "No findings" means "no known actionable holes today," not "secure forever."

**Q2.** A `go get` failed with a checksum mismatch. Can I just delete `go.sum`?

A. No. The mismatch means the bytes changed from what was recorded. Deleting `go.sum` accepts the new (possibly malicious) bytes. Investigate the cause first. If the change is legitimate and intended, regenerate `go.sum` deliberately and review the diff.

**Q3.** Why does Go refuse to verify my private module against the checksum database?

A. The public sumdb only knows public modules; it has no record of your internal code, and you would not want it to. Set `GOPRIVATE` for that namespace so Go skips the public proxy and sumdb for it.

**Q4.** What is the difference between `go.mod` and `go.sum`?

A. `go.mod` declares *which versions* you want. `go.sum` records *cryptographic hashes* of the exact bytes you used. `go.mod` is intent; `go.sum` is evidence.

**Q5.** A dependency I do not call has a CVE. Do I have to fix it right now?

A. It is lower priority — `govulncheck` puts it in the "Informational" section precisely because your call graph does not reach it. But fix it on your next routine update: a future code change could start calling the vulnerable function.

**Q6.** Is copying a small function into my own code more secure than importing it?

A. Often yes, for genuinely tiny utilities. Importing adds a permanent link to your supply chain — its updates, its dependencies, its risk. Copying twenty lines you can read and own removes that link. (Mind the license.)

**Q7.** Does committing `go.sum` leak any secrets?

A. No. `go.sum` contains hashes of public dependency content, not secrets. It is safe — and expected — to commit it.

**Q8.** Someone says "we vendor, so we do not need to scan." Are they right?

A. No. Vendoring (copying dependencies into your repo) helps with offline, auditable builds, but the vendored code can still contain known vulnerabilities. `govulncheck` works on vendored projects too. Vendoring and scanning solve different problems.

**Q9.** What is dependency confusion in one sentence?

A. Tricking your build into pulling a public package that impersonates one of your private/internal packages, usually by exploiting how names are resolved.

**Q10.** Why is an *update* riskier than the original install?

A. Because the original package was (presumably) reviewed and trusted, while an update injects new, unreviewed code from the internet — and that is exactly the vector most real-world supply-chain attacks use.

---

## Cheat Sheet

```bash
# See your full trust boundary (everything in your binary):
go list -m all

# Verify cached modules against go.sum (tamper check):
go mod verify

# Scan for known vulnerabilities you actually call:
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...

# Fix a vulnerability: upgrade to the "Fixed in" version:
go get github.com/affected/dep@v1.2.1
go mod tidy
govulncheck ./...           # confirm it's gone

# Configure a private module namespace (no proxy/sumdb leak):
go env -w GOPRIVATE='git.acme.internal,*.acme.internal'

# Inspect integrity records:
cat go.sum

# Keep go.mod/go.sum honest:
go mod tidy
```

```
The two questions, two tools:

    "Are these the exact bytes everyone agreed on?"   → go.sum + sumdb
    "Do those bytes contain a known hole I call?"     → govulncheck
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `checksum mismatch` | Bytes differ from `go.sum` | Investigate; do NOT just delete `go.sum` |
| `missing go.sum entry` | New import not recorded | `go mod tidy` |
| `sumdb 410 Gone` for private module | Private path hitting public sumdb | Set `GOPRIVATE` |
| `govulncheck` finds a vuln | Known CVE you call | Upgrade to "Fixed in" version |
| `govulncheck`: informational only | Vuln present, not called | Fix on next update |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what the software supply chain is
- [ ] Name three categories of supply-chain attack
- [ ] Explain what `go.sum` proves — and what it does *not* prove
- [ ] Explain what the checksum database adds on top of `go.sum`
- [ ] Run `govulncheck ./...` and read both the actionable and informational sections
- [ ] Distinguish "unchanged" (integrity) from "not known bad" (vulnerability)
- [ ] Configure `GOPRIVATE` for a private module correctly
- [ ] Explain why over-broadening `GOPRIVATE`/`GONOSUMDB` is dangerous
- [ ] Describe why a dependency *update* is a high-risk moment
- [ ] Add a CI step that runs `go mod verify` and `govulncheck`
- [ ] Explain why fewer dependencies is a security improvement

---

## Summary

Your software supply chain is every line of code you ship but did not write — your dependencies, their dependencies, and the tools that build them. Importing a package is morally the same as copying its source into your repo: at runtime, it is your code, with your permissions, against your users. Attackers know this, and they target the automated, unreviewed flow of dependencies into builds: typosquatting, dependency confusion, and — most commonly — malicious updates to trusted packages.

Go ships strong, on-by-default defenses. `go.sum` makes every download tamper-evident; the public checksum database verifies even first downloads against a global, append-only log. Those tools answer "are these the exact bytes everyone agreed on?" A separate tool, `govulncheck`, answers "do those bytes contain a known vulnerability my code actually calls?" — with high-signal, symbol-level analysis. The two are complements, not substitutes.

The junior-level job is simple to state and easy to neglect: keep your dependency set small, commit `go.sum`, scan with `govulncheck` in CI, review every update, and set `GOPRIVATE` precisely for private code — without ever disabling Go's defaults to make an error go away. Do that, and you have turned invisible supply-chain attacks into loud, catchable failures.

---

## What You Can Build

After learning this:

- **A CI pipeline that fails on tampered dependencies or known vulnerabilities** — `go mod verify` plus `govulncheck` on every push.
- **A dependency-review habit** where every version bump is scanned and its diff inspected before merge.
- **A correctly configured private-module setup** that uses internal code without leaking paths or disabling protections.
- **A vulnerability-response workflow**: scan, find the affected version, upgrade to the fix, re-scan, commit.
- **A leaner, safer dependency tree** by removing unnecessary imports and copying trivial utilities.

You cannot yet:
- Generate or sign an SBOM for your binary (next: middle and senior)
- Reason about SLSA build levels and provenance (senior)
- Set up signed releases with cosign/sigstore (professional)
- Build a fully hermetic, attested build pipeline (professional)

---

## Further Reading

- [Go Security](https://go.dev/security/) — the official hub for Go's security and supply-chain features.
- [Govulncheck: a tool for finding vulnerabilities in Go](https://go.dev/blog/govulncheck) — the announcement blog, with usage and rationale.
- [Go vulnerability database](https://vuln.go.dev) — the curated database `govulncheck` queries.
- [Vulnerability Management for Go](https://go.dev/doc/security/vuln/) — the official guide.
- [Module checksum database](https://go.dev/ref/mod#checksum-database) — how `go.sum` and `sum.golang.org` work.
- [Go Modules Reference — Private modules](https://go.dev/ref/mod#private-modules) — `GOPRIVATE` and friends.

---

## Related Topics

- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — keep `go.mod`/`go.sum` honest, the foundation of integrity
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — copy dependencies into your repo for offline, auditable builds
- [6.1.5 Module Proxy & Checksum Database](../05-module-proxy-and-checksum-db/junior.md) — the proxy and sumdb in depth
- [Minimal Version Selection](../04-minimal-version-selection-mvs/junior.md) — how `replace`/`exclude` directives steer version selection to patch dependencies safely
- 6.1.1 `go mod init` — start a module

---

## Diagrams & Visual Aids

```
The supply chain — what's really in your binary:

    your code (you wrote)          ~2,000 lines
        │ imports
        ▼
    direct dependencies            github.com/gin-gonic/gin, ...
        │ each imports
        ▼
    transitive dependencies        50+ modules you never named
        │
        ▼
    ───────────────────────────────────────
    ALL OF THIS ships in your binary and runs
    with your permissions. ALL of it is your
    trust boundary.
```

```
Two guarantees, two tools:

    integrity (unchanged?)              vulnerability (known-bad?)
    ───────────────────────             ──────────────────────────
    go.sum  + sum.golang.org            govulncheck + vuln.go.dev
        │                                     │
        ▼                                     ▼
    "exact bytes everyone agreed on"    "a known hole my code CALLS"
        │                                     │
        └──────────┬──────────────────────────┘
                   ▼
        both required — neither alone is enough
```

```
First download vs later builds:

    go get foo@v1.2.0  (first time)
          │
          ├── fetch bytes (via GOPROXY)
          ├── ask sum.golang.org: "what hash did everyone record?"
          ├── compare → match? record in go.sum : SECURITY ERROR
          ▼
    go build  (every later time)
          │
          ├── re-hash cached bytes
          ├── compare to go.sum
          ▼
        match? compile : checksum mismatch (STOP)
```

```
govulncheck call-graph filtering:

    vuln DB says: foo@v1.2.0 has GO-2023-1840 in func Vulnerable()

    Does YOUR code reach foo.Vulnerable()?
          │
          ├── yes → ACTIONABLE finding (upgrade now), with a trace
          │
          └── no  → INFORMATIONAL (present but not called; fix later)
```

```
Defense in depth:

    [1] fewer dependencies      ─┐
    [2] go.sum                   │  each layer catches
    [3] checksum database        │  what the others miss
    [4] govulncheck              │
    [5] reviewed updates        ─┘
```
