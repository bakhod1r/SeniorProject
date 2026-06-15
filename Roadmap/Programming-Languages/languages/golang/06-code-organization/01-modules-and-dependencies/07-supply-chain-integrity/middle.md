# Supply-Chain Integrity — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Threat Model in Concrete Terms](#the-threat-model-in-concrete-terms)
3. [Go's Built-In Defenses: A Working Recap](#gos-built-in-defenses-a-working-recap)
4. [`govulncheck` and the Go Vulnerability Database](#govulncheck-and-the-go-vulnerability-database)
5. [How Symbol-Level Detection Actually Works](#how-symbol-level-detection-actually-works)
6. [Integrating `govulncheck` into CI](#integrating-govulncheck-into-ci)
7. [Vendoring for Integrity and Auditability](#vendoring-for-integrity-and-auditability)
8. [Dependency Hygiene: Pinning, Minimizing, Reviewing](#dependency-hygiene-pinning-minimizing-reviewing)
9. [Automated Updates: Dependabot and Renovate](#automated-updates-dependabot-and-renovate)
10. [Inspecting a Built Binary: `go version -m`](#inspecting-a-built-binary-go-version-m)
11. [Private Modules and the `GOPRIVATE` Family](#private-modules-and-the-goprivate-family)
12. [A Practical Hardened CI Pipeline](#a-practical-hardened-ci-pipeline)
13. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
14. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the headline: your dependencies are your code, `go.sum` makes downloads tamper-evident, and `govulncheck` finds known holes you actually call. The middle-level question is *how to operationalize that* — how to wire these defenses into CI so the safe path is the automatic path, how `govulncheck`'s analysis really works, when vendoring earns its keep for integrity, and how to keep a real, evolving dependency tree honest.

This file is about turning principles into a pipeline. After reading you will:
- Map each named threat (typosquatting, confusion, malicious update, build-time attack) to a concrete defense
- Run `govulncheck` in CI in the supported, non-flaky way and understand its exit codes
- Explain how its call-graph analysis distinguishes "you call this" from "this merely exists"
- Use vendoring deliberately as an integrity and audit mechanism
- Configure Dependabot/Renovate so updates are reviewable, not blind
- Inspect a shipped binary's embedded module info with `go version -m`
- Configure `GOPRIVATE`/`GONOSUMDB`/`GOINSECURE` correctly and narrowly

---

## The Threat Model in Concrete Terms

Supply-chain security is risk management, and risk management starts with naming the threats. Five categories dominate.

### Typosquatting

An attacker publishes a package whose name is one keystroke from a popular one — `github.com/sirupsen/logru`, `golang.org/x/crpyto`. A developer mistypes an import, or copies it from a poisoned blog post, and pulls the attacker's code. The defense is mechanical: copy import paths from the project's canonical page (`pkg.go.dev`), and let code review and `go mod tidy` surface unexpected new modules.

### Dependency confusion

Your build references an internal module name, say `acme.io/internal/auth`. An attacker registers that *same name* on a public source, betting that a misconfigured resolver fetches the public impostor instead of your private one. Go's defense is `GOPRIVATE`: it tells the toolchain that a namespace is private, so Go never tries the public proxy or sumdb for it and always fetches directly from your authenticated source.

### Compromised maintainer / hijacked account

A legitimate maintainer's account is phished or their token leaked, and a malicious version is published under a trusted name. This is the `event-stream` (npm, 2018) shape. `go.sum` does not stop the *first* malicious publish, but the checksum database makes it globally visible and unforgeable, and `govulncheck` flags it the moment it is catalogued. Pinning versions means you do not auto-adopt the bad release.

### Malicious update

The most common shape, and the one behind `xz` (2024): a trusted package ships a poisoned *new version*. The original code was clean; the update is not. The defense is to treat every bump as untrusted code: pin versions, review update diffs, scan after every change, and never auto-merge dependency bumps without checks.

### Build-time attack

The malicious code runs not at your program's runtime but during *your build* — a poisoned `go generate` step, a compromised build tool, a malicious linker flag. This is the SolarWinds shape (the build system itself was subverted). Defenses are hermetic builds (no surprise network, pinned toolchain), `-trimpath` and reproducibility (so a tampered build is detectable), and minimizing build-time tooling.

The lesson threaded through all five: **the attacker exploits trust that is granted automatically.** Every defense works by inserting a verification step into a flow that was previously unverified.

---

## Go's Built-In Defenses: A Working Recap

A compact recap; depth lives in [05-module-proxy-and-checksum-db](../05-module-proxy-and-checksum-db/middle.md).

- **`go.sum`** records two hashes per module version (the source tree and the `go.mod`). Every build re-verifies the cache against it. A mismatch is a hard error.
- **The module proxy** (`GOPROXY`, default `https://proxy.golang.org,direct`) caches module content. It improves availability and is the first place Go looks. `direct` is the fallback to fetch from the VCS host.
- **The checksum database** (`GOSUMDB`, default `sum.golang.org`) is a public, append-only, Merkle-tree transparency log of module hashes. On first download of a version, Go verifies the bytes against this global record before trusting them.
- **`GOPRIVATE`** marks namespaces as private, implying `GONOPROXY` (skip the proxy) and `GONOSUMDB` (skip the sumdb) for those patterns. **`GOINSECURE`** permits plain HTTP for matching modules (rarely advisable). **`GOFLAGS`** can carry defaults like `-mod=mod`.

Together these answer the *integrity* question: are these the exact, globally-agreed bytes? They say nothing about *vulnerability* — that is `govulncheck`'s job.

---

## `govulncheck` and the Go Vulnerability Database

`govulncheck` is Go's official vulnerability scanner, maintained by the Go security team.

```bash
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

It queries the **Go vulnerability database** at `vuln.go.dev`, a curated, reviewed database of vulnerabilities affecting Go modules. Each entry follows the **OSV** (Open Source Vulnerability) schema — the same machine-readable format used across ecosystems — and carries a `GO-YYYY-NNNN` identifier, the affected module(s), the affected version ranges, the *fixed* version, and crucially the affected **symbols** (specific functions/methods).

That symbol-level data is what sets the Go database apart. Most ecosystems can only say "module X version Y is vulnerable." The Go database says "function `X.Vulnerable` in module X versions [a, b) is vulnerable," which lets `govulncheck` answer the much more useful question: *do you actually call it?*

Output has two sections:
- **Actionable vulnerabilities** — your call graph reaches the vulnerable symbol. These come with a trace showing the exact call site. Fix these.
- **Informational** — the vulnerable code is in your dependency tree but no called function reaches it. Lower urgency, but worth clearing on your next update.

Exit codes matter for CI: `govulncheck` exits non-zero when it finds actionable vulnerabilities (or errors), and zero when clean. That makes `govulncheck ./...` a natural CI gate.

---

## How Symbol-Level Detection Actually Works

The value of `govulncheck` is its low false-positive rate, and that comes from static analysis of your call graph.

1. **Load the package graph.** It builds the SSA (static single assignment) form of your program and its dependencies, the same intermediate representation the compiler-adjacent tooling uses.
2. **Compute reachability.** Starting from your `main` (and test entry points), it walks the call graph to determine which functions are *actually reachable*.
3. **Intersect with the vuln database.** For each vulnerability, it checks whether any of the affected symbols is in the reachable set.
4. **Classify.** Reachable affected symbol → actionable, with a representative trace. Affected symbol present but unreachable → informational.

This is why the *same* vulnerable dependency at the *same* version can be actionable in one repo and informational in another: it depends entirely on whether *your* code path touches the bad function.

Limitations to know:
- **Reflection and `interface{}` dispatch** can make a call look unreachable to static analysis when it is reachable at runtime. `govulncheck` is conservative but not omniscient.
- **`cgo` and assembly** are partially opaque to the analysis.
- It scans the symbols the database *records*. If a vulnerability is not yet catalogued, there is nothing to find.

You can also scan a **compiled binary** (covered below), in which case it falls back to module-level detection — it knows the versions baked in, but without source it cannot do full symbol reachability.

---

## Integrating `govulncheck` into CI

The supported pattern is a dedicated step that installs (or uses a cached) `govulncheck` and runs it across all packages.

```yaml
# .github/workflows/vuln.yml
name: vuln
on:
  push:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'   # weekly: catch CVEs against code you already shipped
jobs:
  govulncheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - name: Install govulncheck
        run: go install golang.org/x/vuln/cmd/govulncheck@latest
      - name: Run govulncheck
        run: govulncheck ./...
```

Three details that separate a real gate from a fake one:

- **Run it on a schedule, not only on change.** New vulnerabilities are disclosed against versions you already ship. A `push`-only scan never re-examines unchanged code.
- **Use the official GitHub Action if you prefer pinning** — `golang/govulncheck-action` — which manages installation and version pinning for you.
- **Decide your policy on informational findings.** By default, only actionable findings fail the build. If you want to surface informational ones too, parse the JSON output (`govulncheck -json ./...`) and apply your own policy.

For machine consumption (dashboards, policy engines), `-json` emits a structured stream you can pipe into tooling. The `-format sarif` option (newer versions) integrates with code-scanning UIs.

---

## Vendoring for Integrity and Auditability

Vendoring — copying every dependency's source into a top-level `vendor/` directory — is covered mechanically in [03-go-mod-vendor](../03-go-mod-vendor/middle.md). From a *supply-chain* angle it buys two specific things:

- **Auditable code in your repo.** Every byte of every dependency is a file under version control. A reviewer, a license scanner, or a security tool can examine the dependency tree without ever contacting a proxy. A dependency *update* shows up as a concrete diff in a pull request — malicious changes become visible to human review instead of invisible behind a version number.
- **Build-time isolation.** With `vendor/` present and `GOPROXY=off`, the build cannot reach the network, which removes the proxy and VCS hosts from the critical path at build time. A compromised or unavailable proxy cannot affect a build whose bytes are already on disk and already reviewed.

Vendoring does **not** replace `go.sum` (still committed and verified) or scanning (`govulncheck` works fine over vendored code). It is an integrity and audit layer, not a substitute for the others. And it has costs — repository size, PR-diff noise — that the dedicated page covers. The middle-level takeaway: reach for vendoring when *auditability of every dependency byte* or *hermetic offline builds* is a concrete requirement, not as a default.

---

## Dependency Hygiene: Pinning, Minimizing, Reviewing

Three habits do most of the work.

**Pin.** `go.mod` and `go.sum` pin exact versions and exact bytes. Commit both. Never depend on `@latest` resolving identically over time — reproducibility is a security property, because a build you cannot reproduce is a build you cannot audit.

**Minimize.** Every dependency is a link in the chain. Before adding one, ask: is this worth a permanent entry in my trust boundary? For a trivial utility, copying the code (license permitting) may be safer than importing a whole module. Periodically prune: `go mod tidy` removes unused requires; `go mod why <module>` justifies why each one is present.

```bash
go mod why github.com/some/lib       # why is this in my graph?
go mod graph | grep some/lib         # who pulls it in?
```

**Review.** Read what an update changes. A patch bump that changes nothing else is low risk; a bump that pulls in five new transitive modules deserves scrutiny.

```bash
go get github.com/some/lib@v1.4.0
go mod tidy
git diff go.mod go.sum               # what did this actually change?
```

For deeper scrutiny, **capslock** (from Google) analyzes the *capabilities* a dependency exercises — does this logging library suddenly make network calls or touch the filesystem? A capability the library never needed appearing after an update is a strong red flag.

---

## Automated Updates: Dependabot and Renovate

Manual dependency updates rot — security patches you never apply are exposure you carry. Bots fix the cadence problem without sacrificing review.

**Dependabot** (built into GitHub) opens a PR per outdated dependency:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "gomod"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

**Renovate** (more configurable, self-hostable) does the same with richer grouping, scheduling, and auto-merge policies.

The supply-chain point is *not* "auto-merge everything." It is:
- Each bump is an isolated, reviewable PR — small diff, clear changelog.
- Your CI (including `govulncheck`) runs on each bump PR, so a malicious or vulnerable update is caught *before* merge.
- You can auto-merge only the low-risk class (patch updates that pass all checks) and require human review for the rest.

Pair the bot with **GitHub's dependency review** action, which comments on PRs that introduce dependencies with known vulnerabilities or problematic licenses — a second, independent check on every change to the dependency graph.

---

## Inspecting a Built Binary: `go version -m`

Every Go binary embeds its own module build information. You can read it back from the compiled artifact — no source required:

```bash
go version -m ./myapp
```

```
./myapp: go1.23.2
        path    example.com/myapp
        mod     example.com/myapp       (devel)
        dep     github.com/google/uuid  v1.6.0  h1:NIvaJDM...
        dep     golang.org/x/sys        v0.18.0 h1:...
        build   -trimpath=true
        build   vcs.revision=abc123...
        build   vcs.time=2026-01-10T...
```

This is a powerful supply-chain primitive:
- **Verify what actually shipped.** The `dep` lines list every module *baked into the binary*, with versions and hashes — the ground truth, independent of any `go.mod` that might have drifted.
- **Feed SBOM and scanning tools.** This embedded data is exactly what `govulncheck <binary>`, `syft`, and `cyclonedx-gomod` read to analyze a binary you did not build from source.
- **Confirm build settings.** The `build` lines record flags like `-trimpath` and VCS provenance (`vcs.revision`, `vcs.time`), which matter for reproducibility and incident response.

When someone hands you a binary and asks "what's in it?", `go version -m` answers without trusting any external claim.

---

## Private Modules and the `GOPRIVATE` Family

Private code must bypass the *public* proxy and sumdb — both because they cannot see it and because you do not want internal module paths leaking to a public service. The controls:

| Variable | Effect |
|----------|--------|
| `GOPRIVATE` | Glob patterns of private modules. Implies `GONOPROXY` and `GONOSUMDB` for matches. The one knob most teams need. |
| `GONOPROXY` | Patterns to fetch *directly* (skip the proxy). |
| `GONOSUMDB` | Patterns to skip checksum-database verification. |
| `GOINSECURE` | Patterns allowed over plain HTTP and without TLS verification. Rarely justified. |
| `GONOSUMCHECK` | (Legacy/obsolete) disables sum checking entirely; a sharp footgun. Avoid. |

The correct pattern is narrow scoping:

```bash
go env -w GOPRIVATE='git.acme.internal,*.acme.internal,github.com/acme-org/*'
```

This exempts exactly your namespaces and nothing else. The dangerous anti-pattern is broadening it to `*` or to an over-wide glob, which silently disables checksum verification for public modules too — re-opening the integrity hole you were trying to keep closed.

`go.sum` still applies to private modules within your project: their hashes are recorded and verified locally. `GONOSUMDB` only skips the *public database* lookup, not local `go.sum` checking.

---

## A Practical Hardened CI Pipeline

A single workflow that enforces integrity, scans for vulnerabilities, and builds reproducibly:

```yaml
# .github/workflows/supply-chain.yml
name: supply-chain
on:
  push:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'
permissions:
  contents: read
jobs:
  integrity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }

      # 1. go.sum must be consistent and verifiable
      - name: Verify modules against go.sum
        run: go mod verify

      # 2. go.mod/go.sum must be tidy (no phantom or missing deps)
      - name: Check go.mod is tidy
        run: |
          go mod tidy
          git diff --exit-code -- go.mod go.sum

      # 3. No known, called vulnerabilities
      - name: Vulnerability scan
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          govulncheck ./...

      # 4. Reproducible, provenance-trimmed build
      - name: Build with -trimpath
        run: go build -trimpath -o /tmp/app ./...
```

Each step closes a specific gap: `go mod verify` catches cache tampering, the tidy check catches drift and stowaway dependencies, `govulncheck` catches known holes, and `-trimpath` removes absolute paths from the binary (a reproducibility and minor information-leak improvement). The `permissions: contents: read` line is itself a supply-chain control — it limits what a compromised step can do.

---

## Common Errors and Their Real Causes

### `checksum mismatch` / `SECURITY ERROR`

The downloaded bytes differ from `go.sum`. Real causes: an upstream force-push to a tag, a proxy/cache serving stale or wrong content, or genuine tampering. Diagnose before "fixing." Never reflexively delete `go.sum`.

### `missing go.sum entry`

A newly imported package has no recorded hash. Cause: someone added an import without `go mod tidy`. Fix: `go mod tidy`, commit.

### `verifying ...: 410 Gone` (private module)

A private module was checked against the public sumdb. Cause: `GOPRIVATE` not set (or not matching). Fix: set `GOPRIVATE` to cover the namespace. Do not disable the sumdb globally.

### `govulncheck` non-zero exit in CI

Working as intended: actionable vulnerabilities were found. Read the trace, upgrade to the "Fixed in" version, re-run. If the finding is a false positive you cannot avoid, document a suppression policy — do not blanket-disable the step.

### `govulncheck` fails to analyze (`loading packages`)

Usually a build error in your own code — `govulncheck` needs your code to compile. Fix the build first; a project that does not compile cannot be analyzed for reachability.

---

## Best Practices for Established Codebases

1. **Run `govulncheck` on every PR *and* on a schedule.** Change-triggered scans miss CVEs disclosed against unchanged code.
2. **Gate merges on `go mod verify` plus a tidy check.** Catches tampering and stowaway dependencies in one shot.
3. **Adopt Dependabot or Renovate** so updates are continuous, isolated, and CI-checked — not a quarterly fire drill.
4. **Add GitHub dependency review** to flag vulnerable or badly-licensed deps at PR time.
5. **Scope `GOPRIVATE` precisely.** One namespace too wide re-opens the integrity hole.
6. **Build with `-trimpath`** in CI to improve reproducibility and strip absolute paths.
7. **Use `go version -m` to verify shipped artifacts** match expectations during release.
8. **Keep the dependency set minimal** and periodically prune with `go mod tidy` / `go mod why`.
9. **Vendor only when auditability or offline builds are real requirements**, and keep scanning even when you vendor.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — A `push`-only vuln scan that never re-checks shipped code

CVEs land against versions you already deployed months ago. Without a scheduled scan, you only learn about them when you happen to touch the code. Add a `schedule:` trigger.

### Pitfall 2 — Auto-merging dependency bumps without `govulncheck` in the PR checks

Convenient, until a malicious update sails through. Auto-merge is fine *only* if your full check suite (scan included) runs and passes on the bump PR.

### Pitfall 3 — `GOPRIVATE` over-broadened to silence one error

Someone hits a sumdb error on an internal module and "fixes" it with `GONOSUMDB=*`. Now every public module skips checksum-database verification. Scope it to the namespace.

### Pitfall 4 — Trusting `govulncheck` as the only layer

It only knows catalogued vulnerabilities you call. A novel malicious package passes both `go.sum` (it is "unchanged") and `govulncheck` (it is "not known bad"). Defense in depth still applies.

### Pitfall 5 — Letting the build break `govulncheck`

`govulncheck` needs compiling code. A repo that does not build cleanly silently turns the scan into a no-op error. Keep the build green so the scan is meaningful.

### Pitfall 6 — Vendoring and assuming you are now safe

Vendored code can still be vulnerable, and a stale vendor tree freezes you on old, unpatched versions. Vendoring is integrity/audit, not vulnerability management. Re-vendor and re-scan on a cadence.

### Pitfall 7 — Ignoring informational findings indefinitely

"We do not call it" is true today. A refactor next sprint might start calling it. Clear informational findings on your routine update cycle instead of accumulating debt.

### Pitfall 8 — Not pinning the toolchain

`vendor/` and `go.sum` pin dependencies, not the Go compiler. A build-time attack or a behavior change can enter through an unpinned toolchain. Use the `toolchain` directive and pin the CI image.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Map each of the five threat categories to a concrete Go defense
- [ ] Explain what the Go vuln database records that lets `govulncheck` do symbol-level analysis
- [ ] Describe how call-graph reachability separates actionable from informational findings
- [ ] Wire `govulncheck` into CI with both change and schedule triggers
- [ ] State exactly what vendoring adds (and does not add) to supply-chain security
- [ ] Configure Dependabot/Renovate so updates are reviewable and CI-checked
- [ ] Read a binary's embedded module info with `go version -m` and explain its use
- [ ] Scope `GOPRIVATE`/`GONOSUMDB`/`GOINSECURE` correctly and explain the over-broadening risk
- [ ] Build a hardened CI pipeline combining verify, tidy-check, scan, and trimpath
- [ ] Diagnose every error in the "Common Errors" section from its message

---

## Summary

Middle-level supply-chain integrity is operational: turning Go's defenses into a pipeline where the safe path is the default. Name the threats — typosquatting, dependency confusion, compromised maintainers, malicious updates, build-time attacks — and each maps to a concrete control: `GOPRIVATE`, pinning, `go.sum`, the checksum database, hermetic builds. `govulncheck` adds the vulnerability dimension on top of integrity, and its symbol-level call-graph analysis (powered by the OSV-format Go vuln database) keeps signal high by separating "you call this" from "this merely exists." Wire it into CI on both change and schedule triggers, gate merges on `go mod verify` and a tidy check, let Dependabot or Renovate keep updates continuous and reviewable, and inspect shipped binaries with `go version -m`. Vendoring earns its place when auditability of every byte or offline builds are real requirements — as an integrity layer, never a replacement for `go.sum` or scanning. The throughline: every defense inserts a verification step into a flow that automation previously trusted blindly.
