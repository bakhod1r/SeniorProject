# Using Third-Party Packages — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. How do you add a third-party package to a Go project?

**Model answer.** From inside a module (a directory with a `go.mod` at or above it), run:

```
go get github.com/owner/repo
```

The toolchain downloads the latest tagged release, adds a `require` line to `go.mod`, and writes a checksum line to `go.sum`. Then `import "github.com/owner/repo"` from your code and `go build` — done.

**Common wrong answers.**
- "Edit `go.mod` by hand." (You *can*, but `go get` is the canonical path.)
- "`npm install`-equivalent is `go install`." (No — `go install` builds binaries, not adds library dependencies since 1.17.)
- "Drop the source into `vendor/`." (That's a different workflow; not how you *add* a dep.)

**Follow-up.** *What if the project has no `go.mod`?* — Run `go mod init <path>` first.

---

### Q2. What is `pkg.go.dev` and why is it useful?

**Model answer.** It is the official Go package discovery and documentation site. For any importable Go module on a public VCS, pkg.go.dev hosts:
- generated GoDoc (rendered from source comments)
- license info
- imported-by counts (a rough popularity proxy)
- versions and release dates
- vulnerability reports

It is the first stop before adopting any library: read the docs, check activity, eyeball the license.

**Follow-up.** *What does the "imported by" number really tell me?* — How many other public modules `import` this one. A signal of adoption, not quality.

---

### Q3. What does `go get pkg` do, end to end?

**Model answer.**
1. Resolves `pkg` against `GOPROXY` (default `https://proxy.golang.org`) to find available versions.
2. Picks a version (latest by default, or whatever `@version` you specified).
3. Downloads the module zip into the local module cache (`$GOPATH/pkg/mod`).
4. Verifies the zip's hash against `sum.golang.org` and against any existing `go.sum` line.
5. Adds or updates the `require` directive in `go.mod`.
6. Adds the new `go.sum` entries.

It does *not* compile your code. It does *not* install binaries (since Go 1.17).

**Follow-up.** *Where is the downloaded source on disk?* — `$GOPATH/pkg/mod/github.com/owner/repo@v1.2.3` (read-only).

---

### Q4. Explain semantic versioning in two sentences.

**Model answer.** A version `vMAJOR.MINOR.PATCH` encodes intent: bump PATCH for backward-compatible bug fixes, MINOR for backward-compatible new features, MAJOR for breaking changes. Go enforces SemVer at the toolchain level — within one major, any minor/patch should be safe to swap.

**Follow-up.** *What does `v0.x.y` mean?* — Pre-1.0; no stability guarantees. Any release can break callers.

---

### Q5. After `go get github.com/sirupsen/logrus`, what do I write at the top of my file?

**Model answer.**
```go
import "github.com/sirupsen/logrus"
```

Then use it: `logrus.Info("hello")`. The import path matches the module path; Go resolves the package by walking the module cache.

**Follow-up.** *What if the package's name in source code differs from the last URL segment?* — You use the *package name* (the `package` clause inside the `.go` files) when calling functions, not the URL. Most libraries match the two; some don't (e.g., `gopkg.in/yaml.v3` exposes package `yaml`).

---

## Middle

### Q6. What is a *pseudo-version* in Go and when does it appear?

**Model answer.** A pseudo-version is a synthetic SemVer-shaped string used when a module has no proper tag at the requested commit. It looks like:

```
v0.0.0-20240115093012-abcdef012345
```

Three parts: a base version, a UTC timestamp, and a 12-char commit hash. The toolchain produces one whenever you `go get pkg@<branch>` or `go get pkg@<commit-sha>`.

**Follow-up.** *Why does `go get pkg@main` give me a pseudo-version instead of "main"?* — Because module versions must be SemVer. Branches are not stable references; the pseudo-version pins an exact commit.

---

### Q7. What is the difference between `go get -u`, `go get -u=patch`, and plain `go get`?

**Model answer.**
- `go get pkg` (no flag): pin to whatever version was specified. With no version, latest tagged release.
- `go get -u pkg`: upgrade the named package *and* its dependencies to the latest minor/patch within the current major.
- `go get -u=patch pkg`: upgrade only patch versions — never minor, never major.
- `go get pkg@v1.4.2`: pin to an exact version.
- `go get pkg@latest`: upgrade to latest tagged.
- `go get pkg@none`: remove the dependency.

`-u` without a target (`go get -u ./...`) upgrades *everything* — almost never what you want in CI.

**Follow-up.** *When would I want `-u=patch`?* — Conservative bumps for security fixes that promise no behavioural change.

---

### Q8. The library has reached v2. What does my import statement look like?

**Model answer.** Add the `/v2` suffix:

```go
import "github.com/owner/repo/v2"
```

This is *Semantic Import Versioning*: any major above v1 must include the `/vN` suffix in both the module path and the import path. It allows v1 and v2 to coexist in the same build (different paths → different packages → different identity).

**Follow-up.** *What does the `go.mod` line look like?* — `require github.com/owner/repo/v2 v2.3.0`.

---

### Q9. How do you swap a third-party library for a local fork?

**Model answer.** Use a `replace` directive in `go.mod`:

```
require github.com/upstream/lib v1.5.0
replace github.com/upstream/lib => github.com/yourorg/lib v1.5.1-fork
```

Or point at a local path while developing:

```
replace github.com/upstream/lib => ../lib
```

Run `go mod tidy` after editing. The toolchain still records `require` for the upstream path but resolves the actual code from the replacement.

**Follow-up.** *Does `replace` propagate to consumers of my module?* — No. `replace` is honoured only for the *main* module of a build. Library consumers must add their own replaces.

---

### Q10. What does `go list -m all` print?

**Model answer.** The full *build list* — every module that contributes packages to the current build, with the version selected by Minimum Version Selection. The first line is the main module; the rest are direct and transitive dependencies.

It's the canonical way to see "what am I actually compiling against."

**Follow-up.** *How is this different from looking at `go.mod`?* — `go.mod` shows requirements you wrote (plus indirect). `go list -m all` shows the resolved, post-MVS picture, including modules pulled in transitively that may not be in `go.mod`.

---

### Q11. What does `go mod why <pkg>` do?

**Model answer.** It traces the *shortest import-path chain* from the main module to a target package, explaining why that package is in the build. Output looks like:

```
$ go mod why github.com/x/y
# github.com/x/y
your.module/cmd/api
your.module/internal/auth
github.com/x/y
```

Read it top-down: your code imports `internal/auth`, which imports `x/y`.

**Follow-up.** *How do I drop a transitive I dislike?* — Find the direct dep that pulls it via `go mod why`, then either replace, fork, or remove that direct dep.

---

### Q12. What is `govulncheck` and how is it different from a generic vuln scanner?

**Model answer.** `govulncheck` (from `golang.org/x/vuln/cmd/govulncheck`) is the Go-team-maintained vulnerability scanner. It consults the Go vulnerability database (vuln.go.dev) and — critically — uses static analysis to report only vulns whose vulnerable *symbols* your code actually calls.

A generic scanner says "you depend on lib v1.2 which has CVE-X." `govulncheck` says "you depend on lib v1.2 which has CVE-X *and* your code reaches the affected function `lib.Vuln`."

The reachability filter dramatically reduces noise.

**Follow-up.** *Should I run it in CI?* — Yes. Many teams gate merges on `govulncheck ./...` exit code.

---

## Senior

### Q13. A teammate proposes adding a 12 KB utility library to save 30 lines of code. Walk through your build-vs-buy analysis.

**Model answer.** The size of the library is misleading. Real cost factors:

1. **Transitive surface.** A 12 KB lib with five transitive deps adds five more supply-chain attack surfaces.
2. **Maintenance posture.** Last commit, last release, open issue count, single-maintainer risk.
3. **License.** GPL/AGPL is dangerous; MIT/Apache/BSD is fine.
4. **Breakage exposure.** A dep can introduce a v2 you must follow, or be archived.
5. **Replacement cost.** 30 lines is trivially rewritable. 30,000 lines is not.

For 30 lines, the answer is almost always *write it yourself*. The bar for adoption rises sharply with code value: a parser, crypto routine, or protocol implementation passes; a string-padding helper does not.

**Follow-up.** *What if the library is `golang.org/x/...`?* — Different category. The `x/` modules are Go-team-maintained, lower-risk, and treat them almost as stdlib.

---

### Q14. Walk me through your audit checklist before adopting a new third-party Go library.

**Model answer.**

1. **Identity.** Real maintainer? Real org? Typo of a popular name? (Defense against typosquatting.)
2. **Activity.** Recent commits, issues responded to, releases tagged.
3. **License.** Compatible with your product.
4. **Security.** `govulncheck` against pinned version; check vuln.go.dev history.
5. **Code review.** Skim the source. Watch for `init()` side effects, network calls, file system writes, `unsafe`, `reflect` abuse, `cgo`.
6. **Tests.** Coverage adequate? Tests run cleanly?
7. **Dependencies.** `go mod graph` for the lib — do its transitives pass the same audit?
8. **Pin.** Exact version, never `@latest` in production `go.mod`.
9. **Vendor or proxy.** Mirror through your private proxy so an upstream takedown does not break builds.

For high-risk additions (auth, crypto, network protocols), insist on a second reviewer.

**Follow-up.** *What is an `init()` red flag?* — A library that registers global state, dials a network endpoint, or reads env vars at import time. These are unauditable side effects.

---

### Q15. How do you insulate your codebase from a third-party library?

**Model answer.** The adapter pattern. Define an interface that *you* own, expressing exactly the operations your code needs. Wrap the library in a thin adapter that implements your interface. All app code talks to the interface, never to the library directly.

```go
// Your interface.
type Cache interface {
    Get(ctx context.Context, k string) ([]byte, error)
    Set(ctx context.Context, k string, v []byte, ttl time.Duration) error
}

// Adapter wrapping go-redis.
type redisCache struct{ c *redis.Client }
func (r *redisCache) Get(...) { /* delegates to r.c */ }
```

Benefits: swap the library by writing one adapter; mock for tests; no library types leak into your domain code.

**Follow-up.** *When would I skip the adapter?* — For tiny, stable libraries (e.g., `errors`, `uuid`) — the wrapping cost outweighs the swap benefit.

---

### Q16. What supply-chain threats target the Go ecosystem specifically?

**Model answer.**

1. **Typosquatting.** Attacker registers `github.com/sirupson/logrus` (note the typo) hoping for fat-fingered `go get`.
2. **Dependency confusion.** Attacker publishes a public module with the same path as your private module; if `GOPRIVATE` is misconfigured, the public one wins.
3. **Compromised maintainer.** Original author's account is hijacked; a malicious release is tagged.
4. **Transitive sneak-in.** A trusted direct dep pulls a malicious transitive.
5. **Build-time code execution.** Less Go-specific (no preinstall scripts), but `go generate` directives and `cgo` can execute code at build time if you blindly run them.
6. **Sum-DB bypass.** Module hosted on a private path with `GOSUMDB=off` and no internal verification.

Defenses: pin exact versions, verify `go.sum`, use `GOPRIVATE` correctly, audit before adoption, run a private proxy.

**Follow-up.** *Why does Go's design make some of these harder than `npm`?* — No `postinstall` scripts. No central registry that maintainers can mutate retroactively. The checksum database (`sum.golang.org`) is append-only and transparent.

---

### Q17. Should I vendor my third-party dependencies?

**Model answer.** It's a trade-off:

**Pros of vendoring (`go mod vendor`).**
- Builds work offline / without proxy access.
- Deps are visible in code review.
- Survives upstream takedowns or repo deletions.
- Auditable: a security review knows exactly what shipped.

**Cons.**
- Bloats the repo.
- `go.sum` already gives byte-for-byte reproducibility, so vendoring is partial duplication.
- Updates create huge diffs.

For application repos with strict supply-chain requirements (regulated industries, security-sensitive products): vendor. For open-source libraries: don't — let consumers vendor if they want.

**Follow-up.** *Does vendoring imply distrust?* — Not exactly. With `GOFLAGS=-mod=vendor`, a build uses *only* the vendored copies, bypassing the network and the cache. That's a stronger reproducibility guarantee than `go.sum` alone.

---

## Staff / Architect

### Q18. How do you generate an SBOM for a Go service, and why?

**Model answer.** A Software Bill of Materials lists every component shipped in a binary. For Go:

- `cyclonedx-gomod` produces CycloneDX-format SBOMs from `go.mod`.
- `syft` (Anchore) reads compiled binaries and emits CycloneDX or SPDX.
- Go 1.18+ embeds module info in binaries via `runtime/debug.ReadBuildInfo`; `go version -m ./bin` extracts it.

Why bother:
- **Compliance.** EO 14028 (US gov), CRA (EU) require SBOMs.
- **Vuln response.** When a CVE drops at 2 a.m., you need to know in five minutes which services ship the affected version.
- **License inventory.** Audit your shipped licenses without re-scanning.

Pipeline: build → produce SBOM → ship to a central store (Dependency-Track, OSS Review Toolkit) → continuous scanning against new CVEs.

**Follow-up.** *Where do you store SBOMs?* — Per-build artifact store keyed by Git commit and image digest. Often alongside container images in OCI registries.

---

### Q19. Why might a company run a private Go module proxy, and how do you operate one?

**Model answer.** Reasons:

1. **Speed.** Cached modules served from the office network are faster than fetching from `proxy.golang.org`.
2. **Availability.** Builds keep working if upstream is down or a module is yanked.
3. **Auditability.** Every module any engineer fetches is logged.
4. **Allowlist enforcement.** Reject fetches for unapproved modules.
5. **Private modules.** Serve internal modules through the same interface as public ones.

Implementations: Athens (open source), JFrog Artifactory, Sonatype Nexus, Google Artifact Registry, GitHub Packages.

Operational concerns:
- Storage growth — modules accumulate forever.
- Authentication — engineers, CI, and the proxy must trust each other.
- Sumdb interaction — keep `sum.golang.org` in the loop, or run a private one.
- Failover — if the proxy dies, builds die; treat it as tier-0 infrastructure.

**Follow-up.** *How does `GOPROXY` handle multi-proxy fallback?* — Comma-separated list with `direct` or `off` as a sentinel: `GOPROXY=https://corp.example.com/proxy,https://proxy.golang.org,direct`. The toolchain tries each in order.

---

### Q20. Design a CI strategy for keeping third-party deps up to date.

**Model answer.** A layered approach:

1. **Daily security scan.** `govulncheck ./...` on `main`; alert on findings.
2. **Weekly Renovate / Dependabot PR.** Auto-PR for patch and minor bumps. Each PR runs full test suite.
3. **Auto-merge for low-risk classes.** Patch bumps with green CI and high test coverage merge automatically. Minor and major bumps require human review.
4. **Allowlist gate.** Any PR adding a *new* `require` line triggers a security-team review.
5. **Quarterly major upgrade sprint.** Plan major-version migrations (e.g., `lib/v2` → `lib/v3`) deliberately, not reactively.
6. **Rollback drill.** Once a quarter, intentionally roll back a dep version end-to-end to verify the process works.

Tools: Renovate is more configurable than Dependabot; both work. For binaries, integrate with Trivy or Grype for image-level scanning.

**Follow-up.** *What if a CVE drops mid-sprint?* — Out-of-band patch PR, security-reviewed, fast-tracked. Have the playbook ready before you need it.

---

### Q21. A library you depend on goes unmaintained. What's the remediation playbook?

**Model answer.**

1. **Confirm.** Last commit > 1 year, no response on issues, maintainer's GitHub inactive.
2. **Search for forks.** Active forks with merged community fixes? Soft-fork governance: who do contributors trust?
3. **Decide.**
    - **Switch.** A maintained alternative exists — adopt it. Adapter pattern (Q15) makes this cheap.
    - **Soft-fork.** Pin to a community fork via `replace`, contribute upstream if possible.
    - **Hard-fork.** Bring it in-house under your org. Now *you* maintain it.
    - **Inline.** Copy the small, stable subset you actually need into your repo with attribution.
4. **Document the decision.** Note in code or ADR why this dep is now your responsibility.
5. **Monitor.** Set a calendar alert to re-evaluate in 6 months.

The hardest part is governance: a hard-fork is a long-term commitment. Most teams underestimate the cost.

**Follow-up.** *How do you decide between fork vs inline?* — Fork preserves history and makes upstream contributions easy. Inline is simpler if you only need 200 lines of a 50,000-line library.

---

### Q22. What is the long-term maintenance risk profile of a typical Go project, and how do you mitigate it?

**Model answer.** Risks accumulate along three axes:

1. **Dependency drift.** Five years in, transitive deps have shifted, some abandoned, some flipped license. Mitigation: regular `govulncheck` + `go list -m all` audits, SBOM in CI, scheduled major upgrades.
2. **Toolchain drift.** Go version policy is "support last two." A project pinned to Go 1.18 in 2026 has missing security fixes and missing language features. Mitigation: bump the `go` directive yearly.
3. **Knowledge drift.** Engineers who chose those deps have left. New engineers don't know which adapter abstracts which library or why. Mitigation: ADRs, `internal/adapters/` naming convention, dep-choice docstrings.

The single highest-leverage mitigation is owning the *abstraction boundary*: every library wrapped in your own interface (Q15). When a library dies five years later, replacement is a localised refactor, not a re-architecture.

**Follow-up.** *How often should I audit deps?* — Continuous (CI scans), monthly (review reports), yearly (deliberate cleanup pass).

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Does `go get pkg` install a binary? | No (since Go 1.17 — use `go install` for binaries). |
| How do I remove a dependency? | `go get pkg@none`, then `go mod tidy`. |
| What does `go mod why pkg` show? | The shortest import chain from main module to that package. |
| Default `GOPROXY` value? | `https://proxy.golang.org,direct`. |
| What does the `// indirect` comment mean? | A `require` for a transitive dep, recorded for reproducibility. |
| How do you upgrade only patch versions? | `go get -u=patch ./...`. |
| Where does a downloaded module live on disk? | `$GOPATH/pkg/mod/...` (read-only). |
| What does `go mod tidy` do? | Adds missing requires, removes unused ones, syncs `go.sum`. |
| How do I pin to an exact commit? | `go get pkg@<sha>` — produces a pseudo-version. |
| Is `go.sum` safe to delete? | Yes, but you'll lose checksum verification until it's regenerated. |

---

## Mock Interview Pacing

A 30-minute interview on third-party packages might cover:

- 0–5 min: warm-up — Q1, Q3, Q5.
- 5–15 min: middle topics — Q7, Q9, Q11, Q12.
- 15–25 min: a senior scenario — Q13, Q14, or Q16.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate is sharp, skip the warm-ups and open with Q14 (audit checklist) — it reveals depth quickly. If they stumble on `go get` mechanics, stay in junior territory until they recover, then jump to Q15 (adapter pattern) which is conceptual rather than syntactic.

Watch for two failure modes: candidates who treat `go get` as magical (they've never read what it does), and candidates who underestimate supply-chain risk (they think pinning a version is enough). The strongest signal is a candidate who unprompted brings up `govulncheck`, `replace` directives, and the adapter pattern.
