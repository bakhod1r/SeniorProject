# `go mod vendor` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does `go mod vendor` do?

**Model answer.** It copies every package required by the current module — direct and transitive — into a `vendor/` directory at the module root. It also writes `vendor/modules.txt`, a manifest that records which modules and which packages are present. After it runs, the project carries a self-contained snapshot of its dependency source tree. From Go 1.14 onward, when `vendor/` exists and the `go` directive in `go.mod` is 1.14+, the toolchain automatically prefers `vendor/` over the module cache for builds.

**Common wrong answers.**
- "It downloads dependencies into the module cache." (No — that is `go mod download`. `vendor` populates a folder *inside* the project.)
- "It edits `go.mod`." (No — `go.mod` is read, not written.)
- "It vendors only direct dependencies." (No — transitives too, otherwise builds would fail.)

**Follow-up.** *What does the command do if `vendor/` already exists?* — It rewrites it from scratch (effectively a sync), keeping it consistent with `go.mod` and `go.sum`.

---

### Q2. Should I commit `vendor/` to source control?

**Model answer.** It depends. If you choose to vendor, then yes — commit `vendor/` and `vendor/modules.txt`. The whole point of vendoring is that the dependency source travels with the repo, so a build never needs to reach a proxy. If you do not commit it, you have only paid the disk cost without buying any reproducibility benefit.

**Common wrong answers.**
- "Always commit it." (No — many teams do not vendor at all.)
- "Never commit it; add to `.gitignore`." (Wrong if vendoring is the chosen strategy.)
- "Commit `vendor/` but ignore `modules.txt`." (No — `modules.txt` is required for consistency checks.)

**Follow-up.** *How big does `vendor/` typically get?* — Tens of MB is common, hundreds of MB possible for kubernetes-scale projects. Plan repo size and review tooling accordingly.

---

### Q3. What is the difference between `go mod vendor` and `go mod tidy`?

**Model answer.** They solve different problems.
- `go mod tidy` reconciles `go.mod` and `go.sum` with the actual import statements in the source. It adds missing requirements and removes unused ones. It does not create `vendor/`.
- `go mod vendor` reads the already-tidied `go.mod` and copies the resulting dependency set into `vendor/`. It does not change `go.mod` or `go.sum`.

A normal flow is `go mod tidy` first, then `go mod vendor`.

**Follow-up.** *What if I run `go mod vendor` without running `go mod tidy` first?* — It still produces a vendor folder, but it may include unused dependencies, or `go mod vendor` may complain about unresolved imports. Tidy first.

---

### Q4. What is `vendor/modules.txt`?

**Model answer.** A plain-text manifest that lists every module copied into `vendor/`, the version of each, and the explicit packages from each module that the build uses. The toolchain reads this file to verify the vendor folder matches `go.mod`. If the file is missing or out of sync, builds fail with an "inconsistent vendoring" error.

A few lines look like:

```
# github.com/google/uuid v1.3.0
## explicit; go 1.12
github.com/google/uuid
```

The leading `#` lines describe modules; bare lines list packages.

**Follow-up.** *Can I edit `modules.txt` by hand?* — Don't. Treat it as machine-generated. Re-run `go mod vendor` to regenerate.

---

### Q5. After running `go mod vendor`, do I still need internet to build?

**Model answer.** No, not for the build itself — assuming the toolchain auto-detects the vendor folder. The compiler reads source from `vendor/`, never the module cache or the network. You do still need internet for `go get`, `go mod tidy`, or `go mod vendor` itself.

**Follow-up.** *What about `go test`?* — Same as build: `go test` honours `vendor/` and runs offline.

---

## Middle

### Q6. When does Go automatically use `vendor/`?

**Model answer.** Three conditions must all hold:
1. A `vendor/` directory exists at the module root.
2. The `go` directive in `go.mod` is 1.14 or higher.
3. No flag overrides it (`-mod=mod` or `-mod=readonly` would force module mode).

When all three hold, the default `-mod` becomes `vendor`. You can verify with `go env GOFLAGS` and by running `go list -m all` — under vendor mode it reads from `modules.txt`.

**Follow-up.** *What happens if `go.mod` says `go 1.13`?* — Vendor is not auto-used. You must pass `-mod=vendor` explicitly, or bump the `go` directive.

---

### Q7. How do I force a build to ignore `vendor/`?

**Model answer.** Pass `-mod=mod` to the build command, e.g. `go build -mod=mod ./...`. Or set `GOFLAGS=-mod=mod`. This tells the toolchain to consult `go.mod` and the module cache as if `vendor/` were not there. Useful when you suspect the vendor folder is stale and want to confirm against fresh sources.

**Common wrong answer.** "Delete `vendor/`." That works, but is destructive. `-mod=mod` is non-destructive and reversible.

**Follow-up.** *What does `-mod=readonly` do?* — Same as module mode but forbids implicit edits to `go.mod`. Common in CI to detect drift.

---

### Q8. Are test files of dependencies vendored?

**Model answer.** No. `go mod vendor` copies only the source files needed to *build* the packages your module actually imports. Dependency test files (`_test.go`) and dependency test-only helpers are excluded by default. If you need them — for example, you want to run a dependency's test suite from your repo — pass the `-include-test` flag in the relevant Go versions, or fork the dependency.

**Follow-up.** *Why is the default to exclude tests?* — They balloon the vendor size, and consumers rarely need them. Builds and your own tests do not require them.

---

### Q9. Are `//go:embed` files of dependencies vendored?

**Model answer.** Yes. As of Go 1.14+, `go mod vendor` copies any non-Go files referenced by `//go:embed` directives in dependency packages, so that `embed.FS` resolves correctly during build. This is essential — without embedded assets, dependency code that uses templates, SQL files, or static resources would fail at compile or runtime.

**Follow-up.** *What about non-embedded data files (e.g., a dependency reads `testdata/foo.json` at test time)?* — Not vendored. Tests are excluded, and arbitrary file reads outside `embed` are not tracked.

---

### Q10. How does `go mod vendor` interact with `replace` directives?

**Model answer.** Replace directives are resolved before vendoring. If `go.mod` says `replace github.com/foo/bar => ../localfork`, then the source copied into `vendor/github.com/foo/bar/` comes from `../localfork`, not from the upstream. The `vendor/modules.txt` records the *target* path so the toolchain knows the substitution is in effect.

The build itself, after vendoring, reads only from `vendor/`. The `replace` is "baked in."

**Common wrong answer.** "Replace breaks vendoring." (No — it works, but with one constraint: the replacement target must exist when `go mod vendor` runs.)

**Follow-up.** *What if `replace` points to a path that does not exist?* — `go mod vendor` errors out. Fix the replace target before vendoring.

---

### Q11. What is "inconsistent vendoring" and how do you fix it?

**Model answer.** A build error meaning the contents of `vendor/` (or `vendor/modules.txt`) do not match `go.mod`. Causes:
- Adding a `require` to `go.mod` without re-running `go mod vendor`.
- A merge that brought new requires into `go.mod` from another branch.
- Hand-editing `modules.txt`.
- A partial commit that included `go.mod` but not the `vendor/` changes.

Fix: run `go mod tidy` then `go mod vendor`. Commit the result. Add a CI check that runs `go mod vendor` and fails if `git diff` is non-empty.

**Follow-up.** *Is there a way to detect this without running vendor?* — Yes: `go mod verify` plus comparing `modules.txt` to `go.mod` requirements. But the simplest check is the CI gate above.

---

### Q12. When do you reach for `go mod vendor` versus `go mod download`?

**Model answer.** They serve different goals.
- `go mod download` populates the *module cache* (`$GOMODCACHE`, default `~/go/pkg/mod`) on the developer machine or CI runner. It is per-machine and per-user. Useful for warming caches in CI before the actual build.
- `go mod vendor` populates the *vendor folder* inside the project. It is per-repo and shipped with the source.

`download` is a cache-warming tool; `vendor` is a source-distribution tool. Many teams `download` in CI to avoid re-fetching dependencies on every test job, but never vendor. Other teams vendor and skip download entirely.

**Follow-up.** *Can I do both?* — Yes, but it is redundant. With vendor present, the cache is bypassed at build time.

---

## Senior

### Q13. When do you choose to vendor versus relying on `go.sum` plus a module proxy?

**Model answer.** The trade-off is between repository weight and supply-chain control.

Vendor when:
- You build in air-gapped environments (regulated industries, on-prem appliances).
- Your security policy requires every byte of third-party source be reviewable in PR.
- You want zero dependency on any external service at build time, including private proxies.
- Long-lived release branches must rebuild years later without proxy availability.

Skip vendor when:
- Network and proxy availability are a given.
- Repo size and PR-diff signal-to-noise matter.
- The team trusts `go.sum` plus a vetted proxy (e.g., Athens, JFrog, GoProxy.io).

A common default for greenfield projects is no vendor — the proxy plus `go.sum` is enough, and `vendor/` doubles or triples the repo size. Vendor is a deliberate choice paid for in maintenance.

**Follow-up.** *What if the proxy is private and corporate?* — That alone does not require vendor. But if the corporate proxy is unreliable, vendor is a hedge.

---

### Q14. Walk me through using vendor in an air-gapped CI environment.

**Model answer.**
1. On a connected developer machine: `go mod tidy && go mod vendor`. Commit both.
2. CI on the air-gapped network clones the repo. No proxy reachable; that is fine.
3. CI runs `go build -mod=vendor ./...` (or relies on auto-detection if `go` directive is 1.14+).
4. CI runs `go test -mod=vendor ./...`.
5. Optional safety: `go mod verify` to ensure `vendor/` was not tampered with by comparing against `go.sum`. Note: `go mod verify` checks the *cache* against `go.sum`; for vendor, the integrity comes from git history plus `modules.txt` consistency.

Key constraint: developers updating dependencies must do so on a connected machine, then ship the new vendor commit through the air-gap. Often this means a one-way mirror or a manual sneaker-net step.

**Follow-up.** *What if a dependency update is urgent and the connected build host is down?* — You are blocked. That is an inherent risk of air-gapped supply chains and demands a runbook with a backup connected machine.

---

### Q15. How does vendoring help with supply-chain auditing?

**Model answer.** It reifies the dependency tree. Every line of third-party code that ships in the binary is a file in your repo, visible in PRs, scannable by SAST tools, greppable, and diff-able across versions. When auditors ask "what version of OpenSSL bindings are you using?" the answer is in `vendor/modules.txt` and in the source itself.

Without vendor: the answer requires resolving `go.mod` against a proxy, trusting `go.sum`, and fetching source on demand. The chain still works but adds opacity.

The audit downside: every dependency upgrade produces a large, noisy `vendor/` diff. Reviewers are tempted to rubber-stamp. Mitigate with PR-diff hygiene — separate dependency-bump PRs from feature PRs.

**Follow-up.** *Does vendor satisfy SBOM requirements alone?* — No. SBOM tooling (e.g., syft, cyclonedx-gomod) reads `go.mod` regardless. Vendor and SBOM are complementary.

---

### Q16. How does vendoring work in a multi-module monorepo?

**Model answer.** Each module gets its own `vendor/` folder. There is no shared vendor root. So a monorepo with five modules and overlapping dependencies will have five separate copies of, say, `github.com/google/uuid`. Disk usage and PR diffs scale linearly with module count.

Workarounds:
- Share a `go.work` for development, but vendor only at the module level for releases.
- Some teams choose to vendor only the leaf service modules and not the libraries (libraries fetch from proxy, services bundle).
- Aggressive dependency consolidation: keep dependency lists small per module so duplication hurts less.

A few teams build custom tooling to deduplicate vendor folders via symlinks, but this fights the toolchain and breaks `go mod vendor` regeneration.

**Follow-up.** *Does `go.work` help vendor?* — No. Vendor is module-local. `go.work` operates at workspace level and ignores vendor folders.

---

### Q17. What is the rule about hand-editing `vendor/`, and why?

**Model answer.** **Don't.** The toolchain treats `vendor/` as derived state — a cache. `go mod vendor` will overwrite any hand-edits the next time it runs, and `vendor/modules.txt` will not reflect any local patches you made to source files.

Why people are tempted: a quick fix to a bug in a dependency, a hotpatch before upstream merges, a removed-but-needed file. The right answers:
- Fork the dependency, push to a private repo, use `replace` in `go.mod`, then re-vendor.
- Submit upstream and wait.
- Use a `replace` to a local path during dev, then vendor when the fork is stable.

If you absolutely must hand-edit (a 2 a.m. production fix), document it in a `VENDOR_HACKS.md`, add a CI check that prevents `go mod vendor` from being run by accident, and schedule a real fork.

**Follow-up.** *Is there any way to prevent re-vendor from clobbering my edit?* — No. The tool is destructive by design. The only durable mechanism is `replace` plus a fork.

---

### Q18. You maintain a release branch from two years ago. Vendor is committed. The build is breaking. What is going on?

**Model answer.** Likely "vendor drift" plus environmental shift:

1. **Toolchain version.** A current Go version may interpret old vendor folders differently (e.g., `//go:embed` vendoring rules changed in 1.14, modules.txt format evolved). Pin the build to the toolchain version recorded in `go.mod`'s `go` directive.
2. **Hidden network reads.** Some older Go versions still consulted the proxy if `vendor/modules.txt` was missing entries. Verify the file is complete.
3. **Security patches needed.** A vulnerability in a vendored dep prompted the rebuild. Now the question is whether to backport the patch into the old vendor or simply re-vendor with newer versions (which may pull breaking changes).
4. **Build environment.** OS, libc, or external C library versions have moved. Vendor protects only Go source, not cgo system dependencies.

Recovery plan: pin Go version in CI, verify `vendor/modules.txt` consistency, then either freeze and patch in place (most conservative) or take the breakage hit and update vendor with controlled upgrades.

**Follow-up.** *Is vendor a substitute for proper release-branch maintenance?* — No. Vendor preserves source; it does not preserve compatibility with future toolchains, OSes, or security expectations.

---

## Staff / Architect

### Q19. Design a CI pipeline for a vendored Go monorepo with 12 modules.

**Model answer.** Per-module pipeline with shared safety gates.

**Stage 1: drift detection (per module).**
```
go mod tidy
go mod vendor
git diff --exit-code -- go.mod go.sum vendor/
```
Fails if a developer forgot to commit vendor changes.

**Stage 2: build and test (per module).**
```
go build -mod=vendor ./...
go test -mod=vendor ./...
```
Hermetic — no network needed.

**Stage 3: cross-module integrity.**
- For modules listed in a top-level manifest, verify their `go.mod` versions are consistent (e.g., all modules pin the same major version of a shared internal library). Custom tooling.
- Run a vulnerability scan over `vendor/modules.txt` aggregated from all modules.

**Stage 4: PR hygiene gate.**
- Block PRs that mix `vendor/` updates with non-trivial code changes. Force separate dep-bump PRs.

**Performance considerations.**
- Cache the module cache (`$GOMODCACHE`) between runs even when vendoring; it speeds up `go mod tidy`.
- Run modules in parallel; matrix on changed modules only when possible.
- Pin the Go toolchain version in CI to match `go.mod`.

**Follow-up.** *How would you handle a security CVE in a single dependency across all 12 modules?* — A scripted bulk PR: bump the version in each `go.mod`, re-run `go mod vendor` per module, raise 12 PRs (or one combined PR depending on review policy).

---

### Q20. Vendor and FIPS / FedRAMP compliance — what is the architectural picture?

**Model answer.** Compliance regimes care about:
1. **Provenance.** Every artifact in the build has a known origin. Vendor satisfies this — the source is in your repo, signed by your VCS, reviewable.
2. **Reproducibility.** Builds rebuilt months later produce identical binaries. Vendor plus pinned toolchain plus deterministic build flags gets you there.
3. **Cryptographic boundaries.** FIPS-mode Go requires specific build tags or the BoringCrypto/`go-toolset` toolchain. Vendor does not interact with this directly, but a vendored crypto library must be the FIPS-validated version.
4. **No external runtime dependency.** Air-gapped operation. Vendor delivers.
5. **SBOM and CVE scanning.** Generated from `vendor/modules.txt` plus `go.mod`. Tools like `syft`, `cyclonedx-gomod`, `osv-scanner` all support vendor mode.

Architecturally, vendor is *one component* of compliance. You also need: signed releases, reproducible build infrastructure, audit logs of every dependency upgrade, formal review of `vendor/` diffs, and toolchain attestation.

**Follow-up.** *Can a non-vendored project still pass FedRAMP?* — Yes, with a controlled proxy, signed `go.sum` workflow, and equivalent supply-chain attestation. Vendor is a simpler path, not the only path.

---

### Q21. How do you keep PR-diff signal-to-noise high when `vendor/` is committed?

**Model answer.** A few coordinated practices.

1. **Path-based code review rules.** Configure the review platform so changes under `vendor/` route to a "dependency review" path, not the main code reviewers' queue.
2. **PR templates split feature work from dependency bumps.** A PR that touches `vendor/` and `internal/foo/bar.go` gets bounced. One concern per PR.
3. **`.gitattributes` mark vendor as `linguist-vendored=true`** so GitHub language stats and review UIs treat it as auxiliary.
4. **CI bot for dependency-only PRs.** Renovate or Dependabot configured for Go modules opens a vendor-bump PR per dependency, with a focused diff and a changelog excerpt.
5. **Reviewer training.** Reviewers learn to look at `go.mod` and `vendor/modules.txt` first; the source diff is checked for surprises (e.g., unexpected files, suspicious patches).
6. **Vendor diff summarisation.** A bot script summarises which modules changed and posts as a PR comment, so reviewers do not scroll through 5000-line diffs.

The deeper truth: vendor diff noise is the cost of vendor. You manage it; you do not eliminate it.

**Follow-up.** *Should `vendor/` be excluded from `git blame`?* — Add it to `.git-blame-ignore-revs` for bulk vendor commits. Prevents the entire vendor folder pointing to one engineer who happened to run `go mod vendor`.

---

### Q22. How would you programmatically generate a vendor folder without running `go mod vendor`?

**Model answer.** You would not, in practice. But the question probes understanding of what the tool actually does.

The work is roughly:
1. Parse `go.mod`, expand the build list via MVS over the transitive graph.
2. For each (module, version) in the build list, fetch source from the module cache or proxy.
3. For each fetched module, walk packages reachable from the main module's import graph (a depth-first traversal of imports), copying exactly the files needed: `.go` non-test files, `LICENSE` files, and `//go:embed`-referenced files.
4. Skip test files and unrelated packages within each module.
5. Write `vendor/modules.txt` with the modules, versions, and explicit/implicit package markers.
6. Validate consistency: every import in the main module's source must resolve to a package present in `vendor/`.

Tools that approximate this: `gomvp`, custom scripts using `go list -m -json all` plus `go list -deps -json`. They re-implement what the toolchain does for free.

**When you might bypass `go mod vendor`.** Building a custom vendor with patches, or producing a "fat vendor" that includes test files, or generating vendor for a subset of the build (e.g., one binary out of many in a multi-binary module). Usually these cases are better solved with `replace` directives, a dedicated module, or a fork.

**Follow-up.** *Why is the toolchain's own implementation hard to replace?* — It tracks build-tag-conditional imports, cgo, generated code, embed directives, and edge cases like `//go:linkname`. Re-implementing correctly is more work than using the tool plus `replace`.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Does `go mod vendor` need internet? | Yes — to fetch missing modules. |
| Does it edit `go.mod`? | No. |
| Auto-used since Go version? | 1.14 (with `go` directive >= 1.14). |
| Are test files vendored? | No. |
| Are `//go:embed` files vendored? | Yes. |
| Force module mode? | `-mod=mod`. |
| File listing vendored modules? | `vendor/modules.txt`. |
| Hand-edit vendor source? | No. |
| Vendor in multi-module monorepo? | Per-module `vendor/`. |
| Vendor + `replace`? | Replace target is what gets vendored. |

---

## Mock Interview Pacing

A 30-minute interview on Go vendoring might cover:

- 0–5 min: warm-up — Q1, Q3, Q4.
- 5–15 min: middle topics — Q6, Q9, Q10, Q11.
- 15–25 min: a senior scenario — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q19 or Q21.

If the candidate claims hands-on vendor experience, drive straight to Q11 (inconsistent vendoring) and Q17 (hand-edit rule) — both are field-test questions. If they have only read about vendor, stay in middle territory and probe whether they understand auto-detection (Q6) and the difference between vendor and download (Q12). A staff candidate should reach Q19 within fifteen minutes.
