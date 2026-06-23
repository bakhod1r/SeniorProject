# Workspaces — Interview Questions

> Practice questions ranging from junior to staff. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a Go workspace?

**Model answer.** A workspace is a logical grouping of one or more Go modules controlled by a `go.work` file. While a workspace is active, the `go` toolchain treats every listed module as local source, so cross-module imports resolve to local folders rather than published versions. It was introduced in Go 1.18 to replace the awkward pattern of using `replace ../sibling` directives in every `go.mod`.

**Common wrong answers.**

- "A workspace is a single Go module." (No — it's a *grouping* of modules.)
- "A workspace is a folder with multiple Go files." (No — workspaces are about modules.)
- "A workspace is the same as a `replace` directive." (Related, but workspaces operate at a higher scope and are local-only.)

**Follow-up.** *What single command sets one up?* — `go work init ./path1 ./path2`.

---

### Q2. What does `go.work` look like?

**Model answer.**

```
go 1.22

use (
    ./api
    ./shared
)
```

A `go` directive (mandatory), one or more `use` directives listing module folders, and optionally `replace` directives or a `toolchain` directive.

**Follow-up.** *Where in the directory tree does it go?* — At the smallest directory containing every module you want grouped, typically the repo root.

---

### Q3. How do I disable a workspace temporarily?

**Model answer.**

```bash
GOWORK=off go build ./...
```

The `GOWORK` environment variable is the master override. `off` disables workspace mode entirely; the toolchain falls back to plain module mode.

**Follow-up.** *Why would I do that?* — To verify a module builds against its *published* dependency versions, exactly as a downstream consumer would see it.

---

### Q4. What is the difference between `use` and `replace` in `go.work`?

**Model answer.** `use` adds a local module folder to the workspace; the toolchain treats that folder as the live source for that module path. `replace` swaps one module path (or version) for another path or version, similar to the `replace` directive in `go.mod`. In a workspace, `use` is the common case; `replace` is for less common substitutions like redirecting to a fork's URL.

**Follow-up.** *Can I use both for the same module?* — Don't. The behaviour is undefined-feeling: pick one. Use `use` if you have a local folder, `replace` if you don't.

---

### Q5. Should I commit `go.work` to version control?

**Model answer.** It depends. Commit it for tightly coupled monorepos where every contributor uses the same on-disk layout. Gitignore it for libraries used as workspaces only during local development of forks or examples. If you commit `go.work`, also commit `go.work.sum`. If you gitignore one, gitignore both.

**Follow-up.** *What is `go.work.sum`?* — The companion lockfile, holding checksums for dependencies not covered by any listed module's own `go.sum`.

---

## Middle

### Q6. What does `go work sync` do?

**Model answer.** It propagates the workspace's resolved version map back into each listed module's `go.mod`. Inside a workspace, MVS runs over the union of every module's requirements; the resolved versions may exceed what any single `go.mod` requires. `go work sync` rewrites each `go.mod`'s `require` lines to match. This keeps published modules honest about what versions their tests have actually exercised.

**Common wrong answers.**

- "It updates `go.work`." (No — it does not modify `go.work`.)
- "It runs `go mod tidy`." (No — it does not remove unused requires.)
- "It pulls new versions from the proxy." (No — it only redistributes what is already chosen.)

**Follow-up.** *When should I run it?* — Before tagging a release. After a workspace-wide upgrade.

---

### Q7. I added a `replace ../sibling` to my `go.mod` years ago. Should I move it to `go.work`?

**Model answer.** Yes, almost always. A `replace` in `go.mod` ships with the published module — consumers who clone *only* that module and try to build it will fail because the path `../sibling` does not exist on their machine. Workspace `use` directives achieve the same dev-time effect without contaminating the published artefact.

The migration: create `go.work` at the parent folder, add `use ./sibling`, delete the `replace ../sibling` from `go.mod`, run a `GOWORK=off` build to verify the published version still works.

**Follow-up.** *Are there cases where the `replace` belongs in `go.mod`?* — Rare. Permanent substitutions to a fork that will be in every downstream user's build are the only legitimate case.

---

### Q8. How does `go.work` interact with `go.sum`?

**Model answer.** Each listed module retains its own `go.sum`. The workspace does not edit them. Where the workspace introduces dependencies not covered by any listed `go.sum` (often via a workspace `replace`), checksums end up in a separate `go.work.sum` file next to `go.work`. Both files are integrity-checked; both are managed by the toolchain; neither should be edited by hand.

**Follow-up.** *What if I see merge conflicts in `go.work.sum`?* — Accept either side, then run `go mod tidy` in each module followed by `go work sync`. The toolchain regenerates a clean file.

---

### Q9. I'm releasing a module that's part of a workspace. What checklist do I run?

**Model answer.** Five steps:

1. Verify the build passes with the workspace disabled: `GOWORK=off go build ./...` and `GOWORK=off go test ./...` from each module to release.
2. Run `go work sync` to propagate workspace versions into each `go.mod`.
3. Run `go mod tidy` (with `GOWORK=off`) in each module to remove unused requires.
4. Tag in topological order — modules with no internal dependencies first, then their consumers.
5. After each tag, bump the next consumer's `go.mod` to the new tag and re-test.

**Follow-up.** *Why `GOWORK=off` for `go mod tidy`?* — Tidy may otherwise miss requires that the workspace is silently providing. The honest tidy is the consumer-facing one.

---

### Q10. What is the `toolchain` directive in `go.work`?

**Model answer.** An optional directive (Go 1.21+) requesting a specific Go toolchain to build the workspace. When `GOTOOLCHAIN=auto` (the default), the running `go` command transparently switches to the named version, downloading it if necessary. The directive lets a workspace pin every contributor's effective Go version without forcing them to upgrade their installed Go.

**Follow-up.** *Where is the downloaded toolchain stored?* — `$GOMODCACHE/golang.org/toolchain`.

---

## Senior

### Q11. Why run *two* CI builds for a workspace project?

**Model answer.** A workspace-on build catches integration bugs across modules — exactly what local development cares about. A workspace-off build (`GOWORK=off`) catches release-time bugs that the workspace masks: a module that compiles only because the workspace is providing unpublished features of a sibling. Both are necessary. The first protects developer velocity; the second protects consumers.

A typical setup runs the workspace build once at the repo root and the `GOWORK=off` build once per module in a CI matrix.

**Follow-up.** *What kinds of bugs slip through a workspace-only CI?* — Forgotten `go work sync` (per-module `go.mod` versions are stale), unpublished sibling features, and `replace` directives that should have been deleted.

---

### Q12. When should I split one workspace into several?

**Model answer.** When the workspace stops being a help and starts being a tax. Specific signals:

- `go test ./...` at the workspace root takes longer than a coffee break.
- A module change regularly breaks tests in unrelated modules.
- More than a dozen `use` directives.
- Different teams own non-overlapping subsets and rarely cross-edit.

The split: identify natural seams (team ownership, deploy unit, dependency direction) and create one workspace per seam. Cross-workspace consumption goes through published versions, not through `use`.

**Follow-up.** *What stops me from one giant workspace forever?* — CI build times, cognitive load on contributors, and most importantly, the workspace masking real release-ordering bugs that grow as the graph grows.

---

### Q13. A workspace `replace` was added "for a week" two years ago. How do I clean it up?

**Model answer.** Audit and remove. The workflow:

1. Identify the `replace` line and the module it redirects.
2. Check whether upstream has merged the change. If yes, find the version: `go list -m -versions <upstream>`.
3. Bump the workspace's listed modules to the new upstream version: `go get <upstream>@<new-version>`, then `go work sync`.
4. Drop the workspace replace: `go work edit -dropreplace=<upstream>`.
5. Run the workspace-off build to verify each module still works against the new upstream.

If upstream never merged, decide: keep the fork as a real published module, or remove the dependency. A "temporary" workspace `replace` should not become permanent.

**Follow-up.** *How do I prevent recurrence?* — Add a CI check that comments on PRs touching `replace` lines in `go.work`, and review the file quarterly.

---

### Q14. What is the relationship between a workspace and the build cache?

**Model answer.** Workspace mode is one input to the build action's cache key. A build of `cmd/api` with `GOWORK=auto` and the same code with `GOWORK=off` produce different cache entries — each is keyed on the resolved set of inputs, which differs between modes. The two coexist without interference.

This means running the workspace-on and workspace-off builds in CI does not double the build time; the second build hits cache for any module whose effective inputs match. The build cache is content-addressed and lock-protected, safe under parallel use.

**Follow-up.** *Does the module cache differ between modes?* — No. The module cache is keyed on `(module-path, version)`. Workspace mode bypasses cache entries for `use`d modules but does not alter or invalidate them.

---

## Staff

### Q15. Design a release pipeline for a multi-module workspace with five modules and a topological dependency order.

**Model answer.** Sketch:

1. **Per-PR CI.** Two builds: workspace-on at the repo root, workspace-off per module in a matrix. Both must pass. A separate "tidy is clean" check fails if `go work sync` or `go mod tidy` produces a diff.
2. **Pre-release pipeline.** Triggered on merge to `main`. Builds with `GOWORK=off` per module. Generates SBOMs from each module's published `go.mod` + `go.sum`. Runs `govulncheck` per module.
3. **Release pipeline.** Manual trigger or version-tag push. Reads a topological order config (e.g., `release-order.yaml` listing module paths). For each module in order: re-run `GOWORK=off` build and tests, tag with the module-prefixed tag, push, wait for proxy propagation, and bump the next consumer's `go.mod` via a follow-up commit.
4. **Post-release verification.** A canary build clones a fresh checkout, sets `GOWORK=off`, and runs every module's tests. Catches "I forgot to push" mistakes.

The pipeline assumes `go.work` is committed (so `go work sync` is reproducible) and that workspace `replace` directives are forbidden in `main`.

**Follow-up.** *What if a release fails midway through the cascade?* — Don't try to undo. Tag a patch on the broken module that fixes the issue, then resume the cascade. Avoid tag deletion; it is messy in Go's proxy ecosystem.

---

### Q16. A team's workspace has grown to fifteen modules. CI takes 25 minutes. What do you do?

**Model answer.** Multiple parallel attacks:

1. **Cache the module cache by `go.sum` hash.** Saves cold-start download time per CI run.
2. **Parallelise the matrix.** The fifteen `GOWORK=off` builds run in parallel CI jobs, not serially.
3. **Skip unchanged modules.** Use Git diff to determine which modules' code (or transitives) changed in the PR; build only those.
4. **Split the workspace.** Long-term answer if the modules cluster into independent areas. Two workspaces of seven and eight modules, each with their own CI, scale better than fifteen-in-one.
5. **Audit dependencies.** Often, fifteen modules have transitive overlaps that pull every dependency into every build. A `go mod why` audit reveals the worst offenders.

The first three are tactical and quick. The fourth is architectural and takes a quarter to do well. The fifth is ongoing.

**Follow-up.** *What about merging the modules into one bigger module?* — Sometimes correct. If two modules are always released together, they probably should be one module. Workspaces can mask that anti-pattern; periodically asking "do these still need to be separate modules?" is healthy.

---

### Q17. Explain how `cmd/go` decides whether you're in a workspace and what overrides what.

**Model answer.** Precedence, decreasing:

1. `GOWORK=off` → no workspace.
2. `GOWORK=/abs/path` → that file is the workspace, no search.
3. Upward walk from `$PWD` for `go.work` → if found, workspace mode.
4. Otherwise, upward walk for `go.mod` → module mode.
5. Otherwise, legacy GOPATH (deprecated).

Once workspace mode is selected, MVS runs over the union of every listed module's requirements, with workspace `replace` directives outranking module `replace` directives for listed modules. The result is a single resolved version map consumed by the rest of the toolchain.

`GOWORK=off` is the right hook for CI that wants reproducible, consumer-equivalent builds. `GOWORK=/abs/path` is right for CI that wants to test a specific workspace that might not be discoverable from the build directory.

**Follow-up.** *Where does this live in source?* — `cmd/go/internal/modload`, particularly `InitWorkfile` and `editBuildList`.

---

### Q18. A workspace `replace` competes with a module `replace`. Which wins?

**Model answer.** Workspace `replace` wins for `use`d modules. The toolchain logs (or silently drops) the conflicting module-level `replace`. This makes the workspace a clean way to override a `replace` that lives in a `go.mod` you do not want to edit.

The exception: a module not listed under `use` is unaffected by workspace `replace` directives. Its own `replace` in `go.mod` applies as usual when MVS visits it.

**Follow-up.** *Is this documented anywhere?* — In passing, in the modules reference. The authoritative answer is `cmd/go/internal/modload/buildlist.go` and the test cases there.

---

## Bonus: Trick Questions

### Q. Can I have nested `go.work` files?

Yes, syntactically — but only the innermost `go.work` (closest to the working directory on the upward walk) takes effect. Outer workspaces are invisible. Avoid the pattern; it confuses everyone.

### Q. Does `go.work` end up in my published module?

No. It is local-only and never uploaded to the proxy.

### Q. Can `use` point at a non-Go directory?

No. The directory must contain a `go.mod` at parse time. The toolchain rejects with `directory ./X is not a module`.

### Q. Does `GOWORK=off` disable workspace `replace` directives only, or the entire workspace?

The entire workspace. `GOWORK=off` is "pretend `go.work` does not exist."

### Q. Is `go work tidy` a real command?

No. Tidying is per-module. Run `go mod tidy` inside each module, ideally with `GOWORK=off`.

---

## Summary

Workspaces are a small, well-scoped feature with disproportionate impact on multi-module workflows. Junior questions probe the file format and basic commands. Middle questions probe the day-to-day workflows and `sync` semantics. Senior questions probe CI strategy and release engineering. Staff questions probe the architectural and operational implications. The single most load-bearing concept across all levels is: **the workspace is local-only; the release boundary is real**. Every higher-level discipline derives from keeping those two views aligned.
