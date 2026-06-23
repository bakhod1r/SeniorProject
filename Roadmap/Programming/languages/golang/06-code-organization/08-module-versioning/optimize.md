# Module Versioning — Optimize

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Exercise 1 — Shrink `go.sum` Churn](#exercise-1--shrink-gosum-churn)
3. [Exercise 2 — Eliminate Unnecessary `replace` Directives](#exercise-2--eliminate-unnecessary-replace-directives)
4. [Exercise 3 — Choose the Right Next Version](#exercise-3--choose-the-right-next-version)
5. [Exercise 4 — Keep `go.mod` Lean Under Lazy Loading](#exercise-4--keep-gomod-lean-under-lazy-loading)
6. [Exercise 5 — Replace Pseudo-Versions with Tagged Releases](#exercise-5--replace-pseudo-versions-with-tagged-releases)
7. [Exercise 6 — Reduce Major-Bump Frequency](#exercise-6--reduce-major-bump-frequency)
8. [Exercise 7 — Streamline Pre-release Cycles](#exercise-7--streamline-pre-release-cycles)
9. [Exercise 8 — Migrate Off `+incompatible`](#exercise-8--migrate-off-incompatible)
10. [Exercise 9 — Optimise the Release Pipeline](#exercise-9--optimise-the-release-pipeline)
11. [Exercise 10 — Detect Compatibility Breaks Earlier](#exercise-10--detect-compatibility-breaks-earlier)
12. [Exercise 11 — Reduce Cold-Cache Build Time](#exercise-11--reduce-cold-cache-build-time)
13. [Exercise 12 — Consolidate Multi-Module Repos](#exercise-12--consolidate-multi-module-repos)

---

## How to Use This File

These exercises improve versioning hygiene rather than runtime performance. Each describes a "before" state, a measurement to take, and a target. Apply them in priority order to a real codebase.

---

## Exercise 1 — Shrink `go.sum` Churn

### Before

A typical `go.sum` for a busy project grows by hundreds of lines per dependency upgrade. Every reviewer scans an unreviewable diff.

### Measure

```bash
git log --oneline -- go.sum | head
git show <commit-hash>:go.sum | wc -l
git show HEAD:go.sum | wc -l
```

If `go.sum` line count grew by >50% in the last quarter without a corresponding feature explosion, you have churn.

### Optimise

1. **Run `go mod tidy` before every commit.** Many `go.sum` lines are stale entries from old MVS runs. `go mod tidy` removes them.
2. **Avoid `go get -u ./...` in mass.** Upgrade in focused batches: one library and its transitives at a time.
3. **Adopt lazy loading.** Set `go 1.17+` in `go.mod`. The pruned graph means fewer unrelated `go.mod` files contribute to `go.sum`.
4. **Avoid pulling in dependencies "just in case."** Each dep adds a tail of transitive `go.sum` entries.

Target: `go.sum` growth correlates with feature growth, not with dependency churn.

---

## Exercise 2 — Eliminate Unnecessary `replace` Directives

### Before

A long-lived application has accumulated `replace` directives. Some are old workarounds; some are forks that have since been merged upstream; some are pins to specific versions that MVS would now pick anyway.

### Measure

```bash
grep -c "^replace" go.mod
```

If your `go.mod` has more than 2 or 3 `replace` lines, audit.

### Optimise

For each `replace`:

1. **Why does it exist?** Local dev? Fork? Pin?
2. **Is the reason still valid?** Has the upstream merged the fix? Has the fork been deprecated?
3. **Can it be removed?** Try removing, run `go mod tidy`, run tests. If everything passes, the `replace` was vestigial.
4. **If it must stay, comment it.** A bare `replace` line is a future bug; a commented one is an explicit decision.

Target: every `replace` directive has a comment explaining why and a follow-up issue tracking when it can be removed.

---

## Exercise 3 — Choose the Right Next Version

### Before

A maintainer often "guesses" the next version by intuition. Sometimes minor bumps include subtle breaks; sometimes patch bumps include features.

### Measure

For your last 5 releases, ask: did `gorelease` agree with the bump category I chose?

### Optimise

1. **Adopt Conventional Commits.** `feat:`, `fix:`, `BREAKING CHANGE:` prefixes in commit messages. A tool can compute the next version from commits since the last tag.
2. **Run `gorelease` in CI.** Every PR that changes the public API surface is annotated with the recommended bump.
3. **Default to safety.** When in doubt, pick the higher category (minor > patch, major > minor). The cost of "I bumped major when I should have bumped minor" is small; the cost of the reverse is large.
4. **Document the bump in the CHANGELOG.** Two lines explaining why, before tagging.

Target: every release has a clear, defensible reason for its version category.

---

## Exercise 4 — Keep `go.mod` Lean Under Lazy Loading

### Before

A project still declares `go 1.16` in `go.mod`. The build is slow on cold caches because the loader walks the entire transitive `go.mod` graph.

### Measure

```bash
time go mod download
```

Cold-cache download time on a large project can exceed 60 seconds with eager loading.

### Optimise

1. **Bump the `go` directive to 1.17 or later.** Pruned graph activates.
2. **Run `go mod tidy`.** This adds explicit `// indirect` lines for every used transitive dep, which is a prerequisite for pruning.
3. **Remove any `// indirect` lines `go mod tidy` would not regenerate** — these are stale.

Target: cold-cache `go mod download` completes in <30s for projects with <300 transitive dependencies.

---

## Exercise 5 — Replace Pseudo-Versions with Tagged Releases

### Before

`go.mod` has lines like:

```
require github.com/foo/bar v1.5.1-0.20240612103515-abc123def456
```

These were quick fixes that have aged.

### Measure

```bash
grep "^require.*-0\.[0-9]\{14\}-" go.mod | wc -l
```

Any non-zero result is debt.

### Optimise

For each pseudo-version:

1. **Find why.** Was it a fix awaiting a release? A branch pin? An experiment?
2. **Check if the upstream has tagged it.** `go list -m -versions <path>` shows available tags.
3. **Upgrade.** `go get <path>@<tagged-version>`. Run tests.
4. **If the fix is still unreleased, file an issue with the maintainer.** Pseudo-versions are not a long-term strategy.

Target: zero pseudo-versions in committed `go.mod` of production code. (Local development or test fixtures are exceptions.)

---

## Exercise 6 — Reduce Major-Bump Frequency

### Before

A library has bumped major three times in two years (`v1` → `v2` → `v3` → `v4`). Consumers are exhausted.

### Measure

Major bumps per year. If >1 every two years for a stable library, you are bumping too often.

### Optimise

1. **Audit the last three major bumps.** For each, ask: could this have been expressed as a deprecation?
2. **Adopt the `Deprecated:` workflow.** Add new APIs alongside the old; deprecate the old; remove the old in a *single* future major.
3. **Batch breaking changes.** Hold breaking changes for a month or quarter; release them all at once in a single major bump.
4. **Pre-release before final.** Two weeks of `v3.0.0-rc.1` lets community testers find issues that would otherwise have triggered another major.

Target: ≤1 major bump per year for a mature library.

---

## Exercise 7 — Streamline Pre-release Cycles

### Before

Pre-releases sit untouched for months. Consumers do not know what to test; the maintainer loses momentum.

### Measure

For your last few RCs: how many days between `rc.1` and the final release? Did anyone outside the maintainer team test the RC?

### Optimise

1. **Set a clear RC window.** "RC.1 ships on day 0, final on day 14, unless major issues are reported." A predictable cycle invites tester engagement.
2. **Communicate the RC.** Blog post, issue tracker pin, mailing list. "Please try `v2.0.0-rc.1`."
3. **Provide a clear "what changed" for testers.** A bullet list of breaking changes plus a migration cheat sheet.
4. **Tag aggressively.** `rc.1`, `rc.2`, `rc.3` as fixes land. Each is cheap.

Target: every major bump has at least one published RC consumed by testers outside the maintainer team.

---

## Exercise 8 — Migrate Off `+incompatible`

### Before

Your library has `v2.x.x+incompatible` and `v3.x.x+incompatible` releases — you ignored SIV.

### Measure

```bash
go list -m -versions github.com/yourorg/lib | grep incompatible
```

### Optimise

1. **Plan a "SIV opt-in" release.** Decide on subfolder vs branch layout.
2. **Update `module` line.** `module github.com/yourorg/lib/v2` (or whichever current major).
3. **Update internal imports.** `gomajor` automates this.
4. **Tag `v2.X+1.0`.** This is a clean SIV release; consumers can migrate to it without `+incompatible`.
5. **Communicate.** "We have adopted SIV. New releases are at `github.com/yourorg/lib/v2`." Ideally, ship a `v1.X.0` release that documents the migration.

Target: no `+incompatible` versions in your latest line. Old versions remain in the proxy as history.

---

## Exercise 9 — Optimise the Release Pipeline

### Before

Releasing is a manual ritual: run tests, tag, push, write release notes, warm proxy. It takes 30 minutes; mistakes happen.

### Measure

Time from "decide to release" to "consumers can `go get @vX.Y.Z`" — measure across last 5 releases.

### Optimise

Automate. A release pipeline triggered by a git tag should:

1. Run the full test suite on every supported platform.
2. Run `gorelease` to confirm the version category.
3. Build any release artefacts (binaries, container images).
4. Push tag to the canonical remote.
5. Warm the proxy: `go list -m <path>@<tag>`.
6. Update CHANGELOG.md from commit messages (Conventional Commits).
7. Publish release notes to the platform (GitHub Releases).
8. Optionally: notify a chat channel.

GoReleaser, GitHub Actions, GitLab CI, and `goreleaser-action` cover most of this.

Target: from "tag pushed" to "consumers can install" takes <5 minutes, fully automated.

---

## Exercise 10 — Detect Compatibility Breaks Earlier

### Before

Every release surprises someone. Consumers report breaks weeks after a minor bump.

### Measure

For each release in the last year: how many consumers reported a "you broke me" bug within 2 weeks?

### Optimise

1. **Add `gorelease` to CI.** Every PR that changes the public API surface is checked.
2. **Maintain example tests.** `Example*` functions in `_test.go` are runnable documentation. Broken examples fail CI; consumers see only working snippets.
3. **Add API-snapshot tests.** A test that records the public API surface (every exported symbol, every signature) and fails when it changes unexpectedly. `apidiff` produces such snapshots.
4. **Run a downstream-build smoke test.** Before tagging, build a representative consumer (e.g., your own service that uses the library) against the new HEAD. If it breaks, you have a problem that affects real consumers.

Target: zero "surprise breaks" reported within 2 weeks of a minor or patch release.

---

## Exercise 11 — Reduce Cold-Cache Build Time

### Before

A new contributor clones the repo. `go mod download` takes 90 seconds. CI cold-cache builds are slow.

### Measure

```bash
go clean -modcache
time go mod download
```

### Optimise

1. **Trim transitive deps.** Audit `go.mod`'s indirect lines. Are there libraries pulling in 50 transitive deps for one helper function? Replace with stdlib or a smaller alternative.
2. **Bump `go` directive to enable lazy loading.** `go 1.17+` activates the pruned graph; less to download.
3. **Use a private proxy.** A team proxy at `proxy.corp.example.com` that mirrors public modules is faster than `proxy.golang.org` for local networks.
4. **Cache `~/go/pkg/mod` in CI.** Most CI systems support per-branch caching of the module cache. A warm cache means downloads are skipped.
5. **Pin to a stable major.** Constant minor bumps invalidate cache entries. A stable major rarely re-downloads.

Target: warm-cache build <5s startup; cold-cache <30s on a 1Gbps connection.

---

## Exercise 12 — Consolidate Multi-Module Repos

### Before

A repo has six modules, each with its own `go.mod`, each tagged separately. Consumers must remember six separate version namespaces. Maintenance is heavy.

### Measure

```bash
find . -name go.mod | wc -l
git tag --list | wc -l
```

If `go.mod` count > 3 in a single repo, ask "is this justified?"

### Optimise

For each sub-module:

1. **Does it have an independent release cadence?** If everything moves together, merge into one module.
2. **Does it have meaningfully different consumers?** If only your own apps consume it, merge.
3. **Does it have a different maintainer team?** If no, merge.

Merging:

1. Move `submod/foo.go` to `pkg/submod/foo.go`.
2. Delete `submod/go.mod`.
3. Run `go mod tidy` at the repo root.
4. Stop tagging `submod/v1.X.Y`. Use root tags `vX.Y.Z`.

Target: one module per repo unless multi-module is *demonstrably* needed (independent release cadences, separate consumer bases).

---

## Summary

Versioning optimisation is mostly hygiene: audit pseudo-versions, eliminate stale `replace`s, automate releases, detect breaks early, reduce major-bump frequency. Each exercise pays off compounding interest: a clean `go.mod` today is a smoother release next year.

Pick the two or three exercises with the highest ROI for your codebase. Re-run them quarterly. Versioning debt is real; like any technical debt, it accumulates silently and costs you on release day.
