# Module Versioning — Interview

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Junior Questions](#junior-questions)
3. [Middle Questions](#middle-questions)
4. [Senior Questions](#senior-questions)
5. [Staff / Architect Questions](#staff--architect-questions)
6. [System-Design Style Questions](#system-design-style-questions)
7. [Whiteboard Code Questions](#whiteboard-code-questions)
8. [Red-Flag Questions for Interviewers](#red-flag-questions-for-interviewers)

---

## How to Use This File

These are typical questions about Go module versioning across levels. Junior questions test definitional knowledge. Middle adds workflow and tooling. Senior probes design decisions and trade-offs. Staff questions push into ecosystem reasoning.

For each question, the canonical answer is followed by a brief commentary on what the interviewer is actually checking.

---

## Junior Questions

**Q1.** What does `v1.2.3` mean?

A. A Go module version. `1` is the major version, `2` is the minor, `3` is the patch. The leading `v` is required syntax.

*Checks:* basic vocabulary.

**Q2.** Why does `go get example.com/lib@1.2.3` fail?

A. Go versions require a leading `v`. Use `@v1.2.3`.

*Checks:* knows the `v` prefix is mandatory.

**Q3.** What is the difference between a minor and a patch bump?

A. A minor bump (`v1.2.3` → `v1.3.0`) adds backwards-compatible features. A patch bump (`v1.2.3` → `v1.2.4`) fixes bugs without adding features. Both should be safe to upgrade.

*Checks:* understands semver semantics.

**Q4.** What happens to the major version number when you rename an exported function?

A. Renaming an exported function is a breaking change. The next release must be a major bump (`v1.x.x` → `v2.0.0`).

*Checks:* recognises breaking changes.

**Q5.** How do you publish a new version of your module?

A. Tag the commit with the version (e.g., `git tag v1.2.3`) and push the tag (`git push --tags`). There is no upload step. The Go module proxy discovers the version on the next `go get`.

*Checks:* knows that tags = versions.

**Q6.** What is `go.sum` for?

A. `go.sum` records cryptographic hashes of every dependency (and its `go.mod`) at the version `go.mod` pins. The toolchain verifies downloads against `go.sum` to detect tampering.

*Checks:* understands the security boundary.

**Q7.** Should you commit `go.sum`?

A. Yes. `go.sum` is part of the lockfile; without it, builds are not reproducible and tampering is not detected.

*Checks:* basic hygiene.

**Q8.** What is the difference between `v0` and `v1`?

A. `v0` versions have no stability promise — any release may break the API. `v1.0.0` is the first major version that promises backwards-compatibility within `v1.x.x`.

*Checks:* understands the v0 → v1 transition.

---

## Middle Questions

**Q9.** What is a pseudo-version?

A. A synthetic version Go generates for a commit that has no semver tag, for example `v0.0.0-20240612103515-abc123def456`. It encodes a base version, a UTC commit timestamp, and the first 12 hex characters of the commit hash.

*Checks:* understands non-tagged dependency states.

**Q10.** When does `@latest` skip a version?

A. `@latest` skips pre-release versions (e.g., `v1.0.0-rc.1`) and `retract`-ed versions. It picks the highest non-pre-release, non-retracted tagged version.

*Checks:* understands pre-release and retraction semantics.

**Q11.** What does the `replace` directive do?

A. It redirects an import path to a different module path or to a local filesystem path. Used during local development to point a dep at a sibling folder, or during a critical patch to redirect to a fork.

*Checks:* knows the development workflow.

**Q12.** Does a `replace` directive in a library's `go.mod` apply to consumers?

A. No. `replace` is honoured only in the *main* module being built. A `replace` in a library is invisible to its consumers.

*Checks:* a common gotcha. Many engineers think replace propagates.

**Q13.** What does `go mod tidy` do?

A. It rewrites `go.mod` and `go.sum` to match the current source: adds missing requires, removes unused ones, updates indirect requirements, and re-derives `go.sum` entries.

*Checks:* knows the standard cleanup command.

**Q14.** What is MVS?

A. Minimum Version Selection: Go's algorithm for resolving the dependency graph. For each module, it picks the highest version anyone in the graph requires. The resolution is deterministic and free of backtracking.

*Checks:* knows the resolver name.

**Q15.** How do you upgrade all dependencies to their latest versions?

A. `go get -u ./...` upgrades direct dependencies to their latest minor or patch within the same major. `go get -u=patch ./...` constrains the upgrade to patches only. Then run `go mod tidy` and the test suite.

*Checks:* knows upgrade tooling.

**Q16.** What does `retract` do?

A. `retract` is a directive in your *own* module's `go.mod` that flags a previously-released version as broken. Consumers running `go list -m -u all` see the retraction; `@latest` skips retracted versions. The bytes remain in the proxy.

*Checks:* knows the publisher-side rollback mechanism.

**Q17.** What is `+incompatible`?

A. A marker Go appends to versions of modules that ignored the `/vN` import-path rule for `v2+`. For example: `v2.5.0+incompatible`. It signals that the maintainer did not adopt Semantic Import Versioning.

*Checks:* recognises the rule and its escape hatch.

**Q18.** Two of your dependencies require different versions of the same module. What does Go do?

A. MVS picks the higher of the two versions. Both dependencies get that version. Because semver promises minor/patch bumps are non-breaking, this is normally safe. If the dependencies require *different majors*, they would normally have different import paths (`/vN`) and coexist; if they share an import path, MVS picks one and the loser may break.

*Checks:* understands MVS in practice.

---

## Senior Questions

**Q19.** Why does Go require `/v2` in the import path for major versions ≥ 2?

A. Two reasons. First, to prevent silent API breakage: a consumer running `go get -u` cannot accidentally jump from v1 to v2 because the import paths differ. Second, to allow multi-major coexistence: `lib` (v1) and `lib/v2` are technically different modules, so a large codebase can migrate file-by-file.

*Checks:* understands SIV's design rationale.

**Q20.** When would you avoid bumping major version, even though some change is breaking?

A. If the change can be expressed as a deprecation: introduce a new function alongside the old, mark the old `// Deprecated:`, and remove it in a future major. Most "breaking" changes (renames, replaced helpers) qualify. Major bumps are reserved for changes that cannot be expressed additively.

*Checks:* judgement on when to break vs deprecate.

**Q21.** How do you migrate a popular library from v1 to v2 without breaking consumers overnight?

A. Pre-release `v2.0.0-rc.1` and ask for testers. Maintain v1 on a `release-v1` branch with security fixes for at least 6 months. Publish a `MIGRATING.md` with concrete before/after examples. Optionally ship a `v2/compat` package that mirrors the v1 API. Coordinate the release with announcements two to four weeks ahead.

*Checks:* understands the social / release engineering side.

**Q22.** What is the trade-off between subfolder layout and branch layout for v2+?

A. Subfolder (`v2/` directory inside the same branch) means one branch to maintain and easy refactoring across versions, at the cost of a noisier source tree. Branch (`release-v1` for v1, `main` for v2) means cleaner per-major source trees at the cost of branch hygiene and per-branch backporting. Choose subfolder for small libraries, branch for libraries with long-lived parallel majors.

*Checks:* practical trade-off awareness.

**Q23.** Why is moving a Git tag dangerous?

A. The Go module proxy caches the bytes that the tag pointed at on first fetch. After a force-push, the tag points at different bytes, but the proxy still serves the original. Some consumers get the old bytes; some the new (depending on cache state). Builds with `go.sum` entries from before the move fail with a checksum mismatch. There is no recovery — always tag a new version instead.

*Checks:* understands proxy / cache semantics.

**Q24.** A consumer reports `module declares its path as github.com/foo/bar but was required as github.com/foo/bar/v2`. What is wrong?

A. The library was tagged `v2.x.x` but its `go.mod` still says `module github.com/foo/bar` (no `/v2`). The fix is to update the module path to `module github.com/foo/bar/v2` and re-tag a new release. The `+incompatible` marker exists for cases where the maintainer cannot or will not adopt SIV.

*Checks:* diagnoses an SIV violation.

**Q25.** What happens if you publish a v0 release after a v1 release?

A. Go does not forbid it, but it is highly unusual. `@latest` will return the highest version, which is still v1.x.y. The v0 release is reachable explicitly by version. Some tooling may report it as a downgrade. Almost always a mistake — fix it by skipping forward to the next v1 patch.

*Checks:* edge-case awareness.

---

## Staff / Architect Questions

**Q26.** Compare Go's MVS to npm's resolver. What problems does each solve well?

A. npm allows multiple versions of the same package in a single dependency tree (each consumer gets its own copy). This avoids version conflicts but bloats `node_modules` and makes cross-version interactions impossible. Go's MVS picks one version per module path globally, which forces semver discipline (consumers depend on minor/patch compatibility) but produces smaller, deterministic builds and simpler debugging. Go's `/vN` rule is a pressure valve — when one version cannot satisfy everyone, you bump major and the import path changes. Trade-off: Go is simpler and more deterministic; npm is more flexible at the cost of complexity.

*Checks:* ecosystem-level comparison.

**Q27.** A monorepo has 50 internal Go modules. Each releases independently. What versioning strategy do you recommend?

A. Each module gets its own `go.mod` and its own tags (with subdirectory prefix: `tools/foo/v1.2.3`). MVS resolves each top-level binary's closure independently. For shared infrastructure (logging, metrics), consider one or two "core" modules at v1 with a strict compatibility policy; the rest can iterate at v0 or follow shorter cadences. Encourage `replace` directives during cross-module refactors and ship them only when both sides are tagged.

*Checks:* multi-module monorepo design.

**Q28.** How would you detect breaking-change violations before they ship?

A. Run `gorelease` in CI between the previous release tag and `HEAD`. It reports incompatible changes (removed exported symbols, changed signatures, etc.) and recommends the appropriate version bump. Combine with a contract test suite that exercises every documented use case at the API level. For subtle behavioural breaks (timing, error types), maintain example tests in `examples_test.go` that fail loudly if behaviour changes.

*Checks:* CI / quality engineering.

**Q29.** A consumer reports their build slowed by 30 seconds after upgrading to your latest minor. What do you investigate?

A. Performance is not part of the semver contract by default, but consumers expect minor releases to be roughly equivalent in performance. Investigate: did internal allocation patterns change? Was a sync primitive added? Is it a build-time slowdown (more dependencies pulled in)? Reproduce, profile, and fix. If the slowdown is intentional and large, document it in the changelog and consider whether it should have been a major bump.

*Checks:* awareness of the grey zone.

**Q30.** Your library's downstream consumers include a fork that diverged at v1.5.0 and added local features. They want to merge upstream's v1.7.0. How should they version their fork?

A. Two reasonable options. (1) Keep the upstream module path and tag locally as `v1.7.0-myorg.1`, treating it as a pre-release ahead of `v1.7.0`. Reconcile when upstream advances. (2) Re-host as `github.com/myorg/lib` and tag normally; consumers must adopt the fork path. Option 2 is cleaner long-term; option 1 is easier short-term if the fork plans to merge back.

*Checks:* fork management.

---

## System-Design Style Questions

**Q31.** Design a CI policy that prevents accidental major-version bumps.

A. (1) On every PR, run `gorelease -base=<latest-tag>` against `HEAD`. Fail the build if `gorelease` reports incompatible changes that the PR did not declare. (2) Require a "BREAKING CHANGE:" footer in commit messages for incompatible PRs; lint enforces it. (3) On merging to main, a release script computes the suggested version based on commit footers (Conventional Commits style) and prepares a tag. (4) A human reviewer approves the tag before push. (5) Tag-push triggers the release workflow (build, test, publish, warm proxy cache).

*Checks:* full release pipeline thinking.

**Q32.** Design a private module proxy for an enterprise.

A. Use `Athens` (open-source) or a vendor's offering (e.g., JFrog) at `proxy.corp.example.com`. Set `GOPROXY=https://proxy.corp.example.com,direct` for engineering machines. The proxy caches public modules transparently and serves private modules from internal Git. Combine with a private sumdb (or `GOSUMDB=off` for paths matching `GOPRIVATE`). Audit logs show every module fetched. Mirror critical public modules locally to survive upstream outages.

*Checks:* corporate Go infrastructure.

**Q33.** A library author asks: should I tag `v1.0.0` now or stay at `v0.x.y` for another year?

A. The decision is not "is the code ready" but "am I willing to commit to backwards compatibility?" Answer key questions: Has the API stabilised over the last 3-6 minor releases? Are there active production consumers asking for v1? Do you have time to maintain v1 alongside v2 development for 12-18 months after v2? If yes to all three, tag v1. If no, stay at v0 — but consider whether your project deserves more frequent v0 releases to signal momentum.

*Checks:* product-level judgement.

---

## Whiteboard Code Questions

**Q34.** Write a function that compares two Go version strings.

```go
package version

import (
    "strconv"
    "strings"
)

// Compare returns -1 if a < b, 0 if equal, +1 if a > b.
// Both must be canonical Go module versions (with "v" prefix).
func Compare(a, b string) int {
    a = strings.TrimPrefix(a, "v")
    b = strings.TrimPrefix(b, "v")
    aMain, aPre := splitPre(a)
    bMain, bPre := splitPre(b)
    if c := compareDottedNumeric(aMain, bMain); c != 0 {
        return c
    }
    return comparePre(aPre, bPre)
}

func splitPre(s string) (main, pre string) {
    if i := strings.Index(s, "-"); i >= 0 {
        return s[:i], s[i+1:]
    }
    return s, ""
}

func compareDottedNumeric(a, b string) int {
    aParts := strings.Split(a, ".")
    bParts := strings.Split(b, ".")
    for i := 0; i < 3; i++ {
        ai, _ := strconv.Atoi(aParts[i])
        bi, _ := strconv.Atoi(bParts[i])
        if ai != bi {
            if ai < bi { return -1 }
            return 1
        }
    }
    return 0
}

func comparePre(a, b string) int {
    if a == "" && b == "" { return 0 }
    if a == "" { return 1 }   // no pre-release > with pre-release
    if b == "" { return -1 }
    aIDs := strings.Split(a, ".")
    bIDs := strings.Split(b, ".")
    for i := 0; i < len(aIDs) && i < len(bIDs); i++ {
        if c := compareIdent(aIDs[i], bIDs[i]); c != 0 { return c }
    }
    if len(aIDs) < len(bIDs) { return -1 }
    if len(aIDs) > len(bIDs) { return 1 }
    return 0
}

func compareIdent(a, b string) int {
    aNum, aErr := strconv.Atoi(a)
    bNum, bErr := strconv.Atoi(b)
    switch {
    case aErr == nil && bErr == nil:
        if aNum < bNum { return -1 }
        if aNum > bNum { return 1 }
        return 0
    case aErr == nil:
        return -1   // numeric < alphanumeric
    case bErr == nil:
        return 1
    default:
        return strings.Compare(a, b)
    }
}
```

*Checks:* understands the semver comparison rules well enough to implement them. Real production code uses `golang.org/x/mod/semver`.

**Q35.** Given a `go.mod`, write code that lists every module that has an indirect requirement.

```go
package main

import (
    "fmt"
    "os"
    "golang.org/x/mod/modfile"
)

func main() {
    data, _ := os.ReadFile("go.mod")
    f, _ := modfile.Parse("go.mod", data, nil)
    for _, r := range f.Require {
        if r.Indirect {
            fmt.Println(r.Mod.Path, r.Mod.Version)
        }
    }
}
```

*Checks:* familiarity with the module-parsing library.

---

## Red-Flag Questions for Interviewers

If a candidate gets these wrong, dig deeper before extending an offer.

- *"Is `1.0.0` a valid Go version?"* The candidate should immediately answer "no, missing the v prefix."
- *"What is the difference between v1 and v2 of a Go module?"* They should mention the `/v2` import path rule, not just "v2 is newer."
- *"Can you have two versions of the same module in your build?"* They should distinguish "no, at the same major" from "yes, at different majors."
- *"What is `go.sum`?"* They should call out integrity, not just "lockfile."
- *"Should I commit `go.mod` to git?"* If they hesitate, the gap is worse than basic Go.
