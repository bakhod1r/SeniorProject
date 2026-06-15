# Supply-Chain Integrity — Find the Bug

> Each snippet contains a real-world supply-chain security bug — a misconfiguration, a disabled protection, or a workflow gap that lets unverified or vulnerable code into a build. Supply-chain integrity in Go rests on `go.sum` (tamper-evidence), the checksum database (`sum.golang.org`, first-download verification), `govulncheck` (known, reachable CVEs), and disciplined dependency hygiene. Find the bug, explain it, fix it.

---

## Bug 1 — `go.sum` added to `.gitignore`

```gitignore
# .gitignore
go.sum
*.log
build/
```

```bash
$ git clone repo && cd repo
$ go build ./...
go: github.com/foo/bar@v1.2.0: missing go.sum entry for module providing package
        github.com/foo/bar; to add it: go mod download github.com/foo/bar
```

**Bug:** `go.sum` was excluded from version control. `go.sum` is your tamper-evidence record — it pins the exact cryptographic hash of every dependency version. Without it, each clone re-resolves hashes from whatever it downloads, removing the guarantee that everyone builds the same, verified bytes. A poisoned proxy or a force-pushed tag would go undetected.

**Fix:** un-ignore and commit `go.sum`. It is meant to be committed; it contains public hashes, no secrets.

```gitignore
# .gitignore
*.log
build/
```

```bash
$ go mod tidy
$ git add go.sum
$ git commit -m "Commit go.sum (tamper-evidence record)"
```

---

## Bug 2 — Deleting `go.sum` to silence a checksum mismatch

```bash
$ go build ./...
verifying github.com/foo/bar@v1.2.0: checksum mismatch
        downloaded: h1:AAAAAAAA...
        go.sum:     h1:BBBBBBBB...
SECURITY ERROR
$ rm go.sum && go mod tidy   # "fixed it"
$ go build ./...             # works now
```

**Bug:** A checksum mismatch is a *security signal*: the bytes just downloaded differ from what was previously recorded. Deleting `go.sum` and regenerating it accepts whatever bytes were just served — possibly an attacker's. The "fix" is the worst possible response.

**Fix:** investigate the cause before regenerating. Legitimate causes (an upstream force-push to a tag) and malicious ones (tampering) produce the same error; you must determine which.

```bash
# Compare against the global record:
$ GONOSUMDB= GOFLAGS= go mod download -x github.com/foo/bar@v1.2.0
# Check upstream: was the tag re-pushed? Is the new content expected?
# Only if the change is verified legitimate:
$ go mod tidy
$ git diff go.sum   # review exactly what changed before committing
```

---

## Bug 3 — `GOSUMDB=off` set globally to fix one private module

```bash
$ go get git.acme.internal/team/lib@v1.0.0
git.acme.internal/team/lib@v1.0.0: reading https://sum.golang.org/...: 410 Gone
$ go env -w GOSUMDB=off    # "fixed it"
$ go get git.acme.internal/team/lib@v1.0.0   # works
```

**Bug:** The private module failed because the *public* checksum database cannot see it. Setting `GOSUMDB=off` disables checksum-database verification for **every** module — including all your public dependencies. You traded a one-namespace problem for a global integrity downgrade.

**Fix:** scope the exemption to the private namespace with `GOPRIVATE`, leaving the sumdb on for everything else.

```bash
$ go env -u GOSUMDB
$ go env -w GOPRIVATE='git.acme.internal,*.acme.internal'
$ go get git.acme.internal/team/lib@v1.0.0   # private skips sumdb; public still verified
```

---

## Bug 4 — `GOPRIVATE=*`

```bash
$ go env GOPRIVATE
*
```

**Bug:** `GOPRIVATE=*` matches every module path. It implies `GONOPROXY` and `GONOSUMDB` for *all* modules, so the public proxy is bypassed and the checksum database is never consulted — for public dependencies too. Someone wanted to exempt internal code and reached for the widest possible glob.

**Fix:** enumerate the actual private namespaces.

```bash
$ go env -w GOPRIVATE='git.acme.internal,*.acme.internal,github.com/acme-org/*'
$ go env GONOSUMDB   # now only those patterns
```

---

## Bug 5 — `govulncheck` never runs in CI

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
      - run: go test ./...
      - run: go build ./...
```

**Bug:** The pipeline tests and builds but never scans for known vulnerabilities. `go.sum` proves the dependencies are *unchanged*; it says nothing about whether they contain *known security holes*. A dependency can be perfectly consistent and still have a published CVE your code calls.

**Fix:** add a `govulncheck` step.

```yaml
      - name: Vulnerability scan
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          govulncheck ./...
```

---

## Bug 6 — Vuln scan only on push, never scheduled

```yaml
# .github/workflows/vuln.yml
on: [push]
jobs:
  scan:
    steps:
      - run: govulncheck ./...
```

**Bug:** Vulnerabilities are disclosed continuously against versions you already shipped and have not touched. A push-only trigger re-scans code *only when it changes*. A CVE published next month against a stable, deployed dependency is invisible until someone happens to edit that area.

**Fix:** add a scheduled trigger so unchanged code is re-checked against the latest database.

```yaml
on:
  push:
  pull_request:
  schedule:
    - cron: '0 6 * * 1'   # weekly
```

---

## Bug 7 — Typosquatted import path

```go
import "github.com/sirupsen/logru"   // missing the trailing 's'
```

```bash
$ go mod tidy
go: finding module for package github.com/sirupsen/logru
go: downloading github.com/sirupsen/logru v0.0.1
```

**Bug:** The real module is `github.com/sirupsen/logrus`. `logru` is a typosquat — a package registered under a near-identical name to catch typos. It downloaded *something*, which is exactly the danger: an attacker's look-alike now compiles into your binary.

**Fix:** always copy import paths from the project's canonical `pkg.go.dev` page, never type from memory. Correct it and re-tidy:

```go
import "github.com/sirupsen/logrus"
```

```bash
$ go mod tidy
$ go mod why github.com/sirupsen/logru   # confirm the squat is gone
```

A review checklist item: scrutinize every *new* module a PR adds to `go.mod`.

---

## Bug 8 — `GOINSECURE` / `-insecure` to "fix" an HTTPS error

```bash
$ go get git.acme.internal/team/lib
... x509: certificate signed by unknown authority
$ go env -w GOINSECURE='*'
$ go env -w GOFLAGS='-insecure'   # belt and suspenders, "just make it work"
```

**Bug:** `GOINSECURE='*'` permits plain-HTTP and unverified-TLS fetches for *all* modules, and `-insecure` disables transport verification. A certificate error is a real security signal (here, a missing internal CA). Disabling transport security globally to bypass it exposes every fetch to man-in-the-middle tampering.

**Fix:** install the internal CA properly; if a narrow exemption is truly needed, scope it to the one host and never globally.

```bash
$ go env -u GOFLAGS
$ go env -u GOINSECURE
# Install the corporate CA into the system trust store, OR if unavoidable:
$ go env -w GOINSECURE='git.acme.internal'   # one host, not '*'
```

---

## Bug 9 — Ignoring `govulncheck` findings in CI

```yaml
- name: Vulnerability scan
  run: govulncheck ./... || true   # don't fail the build
```

**Bug:** `|| true` swallows the non-zero exit code, so the build is always green even when actionable vulnerabilities are found. The scan runs but enforces nothing — security theater. The team *feels* covered while shipping known-vulnerable, reachable code.

**Fix:** let the scan gate the build. If a specific finding must be temporarily accepted, document it explicitly rather than blanket-suppressing all findings.

```yaml
- name: Vulnerability scan
  run: govulncheck ./...   # non-zero exit fails the build, as intended
```

For documented, time-boxed exceptions, parse `-json` output and apply a reviewed allowlist policy — never `|| true`.

---

## Bug 10 — Auto-merging dependency bumps without scanning

```yaml
# .github/dependabot.yml + auto-merge action
- if: steps.metadata.outputs.update-type != 'version-update:semver-major'
  run: gh pr merge --auto --merge "$PR_URL"
```

```yaml
# CI that runs on the bump PR:
jobs:
  test:
    steps:
      - run: go test ./...     # no govulncheck, no go mod verify
```

**Bug:** Non-major dependency updates auto-merge, but the PR's CI does not run `govulncheck` or `go mod verify`. Auto-merge optimizes for convenience on exactly the vector most used by real attacks — a *malicious update* to a trusted package. A poisoned minor/patch release sails straight into `main`.

**Fix:** auto-merge is acceptable *only* if the full supply-chain check suite runs and passes on the bump PR.

```yaml
jobs:
  supply-chain:
    steps:
      - run: go mod verify
      - run: go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
      - run: go test ./...
  # auto-merge gated on supply-chain succeeding
```

---

## Bug 11 — Treating `go.sum` as proof of safety

```markdown
<!-- SECURITY.md -->
Our dependencies are secure: every module is verified against go.sum,
so we know our supply chain is safe.
```

**Bug:** A category error stated as policy. `go.sum` proves dependencies are *unchanged* from what was first recorded — integrity. It does not prove they are *free of vulnerabilities* or *not malicious*. Malicious-but-stable code passes `go.sum` perfectly. Documenting this misconception means nobody runs the tools that *do* check for vulnerabilities.

**Fix:** state the two guarantees separately and back the second with tooling.

```markdown
<!-- SECURITY.md -->
- Integrity: every module is verified against go.sum and the checksum
  database (unchanged, tamper-evident).
- Vulnerability: govulncheck runs on every PR and weekly, failing the
  build on known, reachable CVEs.
These are different guarantees; both are enforced in CI.
```

---

## Bug 12 — SBOM generated from `go.mod`, not the binary

```bash
$ cyclonedx-gomod mod -json -output sbom.json   # from go.mod
$ # ... but the release build used a replace directive:
$ grep replace go.mod
replace github.com/foo/bar => github.com/acme/bar-fork v1.2.0-patched
```

**Bug:** The SBOM was generated from the module graph, but the actual build used a `replace` directive pointing at a fork. The SBOM lists `github.com/foo/bar@v1.2.0` while the binary actually ships `acme/bar-fork@v1.2.0-patched`. The bill of materials does not match the shipped artifact — useless (or misleading) for incident response.

**Fix:** generate the SBOM from the compiled binary, whose embedded build info is ground truth.

```bash
$ go build -o app ./cmd/app
$ cyclonedx-gomod bin -json -output sbom.json ./app
$ # now the SBOM reflects exactly what shipped, replace directives included
$ go version -m ./app | grep '=>'   # confirm the fork is recorded
```

---

## Bug 13 — Unpinned toolchain in a "hermetic" build

```dockerfile
FROM golang:latest AS build
WORKDIR /src
COPY . .
RUN GOPROXY=off GOFLAGS=-mod=vendor go build -o /app ./cmd/app
```

**Bug:** Dependencies are vendored and the network is off — but the builder image is `golang:latest`. The *toolchain* (compiler, standard library, build tools) is an unpinned input. Two builds weeks apart use different Go versions, producing different binaries and pulling in any standard-library changes. Vendoring and `go.sum` pin dependency *source*, never the toolchain.

**Fix:** pin the toolchain — ideally by digest — and set `GOTOOLCHAIN=local` so Go does not auto-download a different version mid-build.

```dockerfile
FROM golang:1.23.2@sha256:<digest> AS build
WORKDIR /src
COPY . .
ENV GOTOOLCHAIN=local
RUN GOPROXY=off GOFLAGS=-mod=vendor go build -trimpath -o /app ./cmd/app
```

---

## Bug 14 — `GOPROXY=direct` only, bypassing the verified proxy and cache

```bash
$ go env GOPROXY
direct
```

**Bug:** `GOPROXY=direct` fetches every module straight from its VCS host, skipping the module proxy entirely. The proxy provides immutable, cached, verified content and availability; `direct`-only means every build depends on every upstream Git host being up and serving the same tag content — and a force-pushed tag is fetched without the proxy's immutability guarantee. (The checksum database still applies, but availability and immutability are lost.)

**Fix:** use the proxy with `direct` as a *fallback*, not the only source.

```bash
$ go env -w GOPROXY='https://proxy.golang.org,direct'
# or a private proxy first:
$ go env -w GOPROXY='https://goproxy.acme.internal,https://proxy.golang.org,direct'
```

---

## Bug 15 — Vendoring assumed to mean "no scanning needed"

```yaml
- run: go mod vendor
- run: go build -mod=vendor ./...
  # no govulncheck — "we vendor, so it's all reviewed"
```

```bash
$ govulncheck ./...
Vulnerability #1: GO-2023-xxxx (in a vendored dependency, called)
```

**Bug:** Vendoring copies dependency *source* into the repo for auditability and offline builds. It does **not** make that source vulnerability-free — vendored code is still code with CVEs. Worse, a stale vendor tree *freezes* you on old, unpatched versions while looking diligent. The team conflated "auditable" with "secure."

**Fix:** scan even when vendoring; `govulncheck` works fine over vendored code. Re-vendor and re-scan on a cadence.

```yaml
- run: go build -mod=vendor ./...
- run: go install golang.org/x/vuln/cmd/govulncheck@latest && govulncheck ./...
```

---

## Bug 16 — Retracted version pinned and shipping

```go.mod
require github.com/foo/bar v1.4.0
```

```bash
$ go mod tidy
go: warning: github.com/foo/bar@v1.4.0: retracted by module author:
        critical security bug, use v1.4.1+
$ go build ./...   # builds fine, ships the retracted version
```

**Bug:** The upstream author *retracted* `v1.4.0` (declared it should not be used), but `go mod tidy` only *warns* — it does not change `go.mod` automatically. The build happily uses the retracted, known-bad version. The warning scrolled past unnoticed.

**Fix:** treat retraction warnings as actionable. Move to the latest unretracted version.

```bash
$ go get github.com/foo/bar@latest
$ go mod tidy
$ go build ./...
```

Add a scheduled check so retractions surface as a failing job, not a buried warning:

```bash
$ go list -m -u -retracted all | grep -i retracted
```

---

## Bug 17 — `replace` to a local path committed and shipped

```go.mod
require github.com/me/shared v1.4.0
replace github.com/me/shared => ../shared-local
```

**Bug:** A local-path `replace` was committed. The build uses whatever `../shared-local` contains *on the build machine* — uncommitted scratch code, an unreviewed fork, anything. CI (no such path) and developers build different code, and the shipped artifact's provenance is whatever happened to be on disk. Nothing is reproducible or verifiable.

**Fix:** never commit a local-path `replace` for a release. Point at a tagged, committed version, or use a workspace for local development (workspaces are not committed and do not affect releases).

```bash
# Tag the fork and pin it:
$ go mod edit -replace=github.com/me/shared=github.com/me/shared-fork@v1.4.1
$ go mod tidy
# Or for local dev only:
$ go work init . ../shared-local   # go.work is not committed for releases
```

---

## Bug 18 — `go mod verify` confused with vulnerability scanning

```yaml
- run: go mod verify   # "this checks our deps for security issues"
  # ...and nothing else
```

**Bug:** `go mod verify` re-hashes the module *cache* against `go.sum` — it confirms cached bytes were not modified since download (integrity). It does **not** check for vulnerabilities, malicious code, or anything about *content quality*. Relying on it as the security check leaves known CVEs completely unaddressed.

**Fix:** keep `go mod verify` (it has a real, distinct purpose) but add `govulncheck` for the vulnerability dimension.

```yaml
- run: go mod verify          # integrity: cache matches go.sum
- run: govulncheck ./...      # vulnerability: known, reachable CVEs
```

---

## Bug 19 — Vendored binary blindly trusted without scanning

```dockerfile
FROM scratch
COPY vendor-supplied-tool /usr/local/bin/tool   # third-party binary, no checks
ENTRYPOINT ["/usr/local/bin/tool"]
```

**Bug:** A third-party Go binary is dropped into the image and run with no verification of what it contains. Because Go binaries embed module info, you can inventory and scan it — but nobody did. A vulnerable or malicious dependency inside that binary ships straight to production unexamined.

**Fix:** inspect and scan the binary before trusting it.

```bash
$ go version -m ./vendor-supplied-tool       # what's baked in?
$ govulncheck -mode=binary ./vendor-supplied-tool
$ syft ./vendor-supplied-tool -o cyclonedx-json > tool.sbom.json
$ osv-scanner --sbom tool.sbom.json
```

If you cannot verify a binary's contents and provenance, do not run it in production.

---

## Bug 20 — Convenience `GOFLAGS` override left in the shell

```bash
$ env | grep GOFLAGS
GOFLAGS=-mod=mod -insecure
$ go build ./...   # ignores vendor/, allows insecure transport, everywhere
```

**Bug:** A teammate set `GOFLAGS` in their shell profile to unblock one task months ago and never removed it. Now *every* build on that machine, in *every* repo, ignores `vendor/` and permits insecure transport. The override silently disables integrity protections org-wide for that developer, and "works for me, fails in CI" reports follow.

**Fix:** clear the global override; pin per-project config deliberately if needed; audit effective config.

```bash
$ go env -u GOFLAGS
$ # Audit what's actually in effect:
$ go env -json | jq '{GOFLAGS,GOPROXY,GOSUMDB,GOPRIVATE,GOINSECURE}'
```

A CI check that diffs effective `go env` against an approved baseline catches these downgrades before they cause incidents.

---

## Bug 21 — Dependency confusion via missing `GOPRIVATE`

```bash
# Internal module: acme.io/internal/billing (hosted on private VCS)
$ go env GOPRIVATE
                                  # empty!
$ go get acme.io/internal/billing
go: downloading acme.io/internal/billing v1.0.0
verifying acme.io/internal/billing@v1.0.0: ... checksum database lookup
```

**Bug:** With `GOPRIVATE` empty, Go resolves the internal module path through the *public* proxy and checksum database. If an attacker has registered a public package at the same `acme.io/internal/billing` path (dependency confusion), the build could pull the public impostor instead of your private code — and at minimum, the private module path is leaked to public services.

**Fix:** mark the internal namespace private so it is always fetched directly from your authenticated source and never resolved publicly.

```bash
$ go env -w GOPRIVATE='acme.io/internal/*,acme.io/*'
$ go get acme.io/internal/billing   # direct fetch, no public resolution
```

In CI, set the same and ensure the runner has auth to the private host.

---

## Bug 22 — `govulncheck` silently a no-op because the build is broken

```yaml
- run: govulncheck ./...
```

```bash
$ govulncheck ./...
govulncheck: loading packages: internal/handler/handler.go:14:2:
        undefined: oldAPI.Removed
Error: matched 0 packages
```

**Bug:** `govulncheck` source mode needs your code to *compile* to build the call graph. A broken build (here, a reference to a removed API) makes the scan error out — but if the CI step does not treat that error as a failure (or runs after a build that already failed and was tolerated), the vulnerability scan effectively does nothing. The pipeline appears to scan but covers zero packages.

**Fix:** ensure the build is green before scanning, and treat `govulncheck` errors as failures (the default exit code already does this — do not mask it).

```yaml
- run: go build ./...        # must pass first
- run: govulncheck ./...     # now analyzes a compilable tree; errors fail CI
```

Monitor for `matched 0 packages` / `loading packages` errors as a signal the scan is not actually examining your code.

---

## Summary

The Go supply chain is defended by integrity (`go.sum` + checksum database), vulnerability detection (`govulncheck` + the vuln DB), and hygiene (pinning, minimizing, reviewing). Most supply-chain bugs come from one of three habits:

1. **Disabling a protection to silence an error.** Deleting `go.sum` on a mismatch, `GOSUMDB=off`, `GOPRIVATE=*`, `GOINSECURE='*'`, `-insecure`, `|| true` on scans — each "fixes" a symptom by removing the guard. The correct move is almost always to *scope narrowly* (`GOPRIVATE` to one namespace, install the internal CA) and *investigate* rather than suppress.

2. **Confusing integrity with safety.** `go.sum` and `go mod verify` prove dependencies are *unchanged*, not *vulnerability-free* or *non-malicious*. Vendoring proves *auditability*, not *safety*. Each needs `govulncheck` (and capability analysis) layered on top; none substitutes for the others.

3. **Letting the safe path be optional.** Scans that only run on push, that never fail the build, that auto-merge without checks, or that silently no-op on a broken build — all create the *appearance* of coverage with none of the substance. Make the checks mandatory, scheduled, and gating, and audit the effective `go env` so convenience overrides cannot silently downgrade the whole pipeline.

Treat every disabled protection, every suppressed finding, and every unpinned input as a security decision that must be deliberate, scoped, and documented — never an accidental side effect of making an error go away.
