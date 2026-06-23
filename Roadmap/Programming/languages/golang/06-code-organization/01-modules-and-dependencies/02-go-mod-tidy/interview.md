# `go mod tidy` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does `go mod tidy` do?

**Model answer.** It synchronises `go.mod` and `go.sum` with what the source code actually imports. Concretely it: (a) adds `require` directives for packages that are imported but missing from `go.mod`, (b) removes `require` directives for modules no longer reached by any import in the module's package graph, (c) updates `go.sum` so every module version in the build list has a matching checksum line, and (d) marks transitive-only dependencies with the `// indirect` comment. Internally it walks the import graph, runs Minimum Version Selection (MVS) over the resulting `require`s, and writes the canonical result back to disk.

**Common wrong answers.**
- "It downloads dependencies into `vendor/`." (No — that is `go mod vendor`.)
- "It upgrades every dependency to the latest version." (No — it does not change versions unless an import demands it; for upgrades use `go get -u`.)
- "It only modifies `go.mod`." (No — `go.sum` is rewritten too.)

**Follow-up.** *If my code does not compile, will `tidy` still run?* — Often yes for missing imports, but errors elsewhere (syntax errors, unresolved references) can stop it. Tidy needs enough source to compute the import graph.

---

### Q2. What is the difference between `go mod init`, `go mod tidy`, and `go get`?

**Model answer.**
- `go mod init <path>` creates a fresh `go.mod`. Local-only, runs once at project birth.
- `go mod tidy` reconciles `go.mod` / `go.sum` with the current import graph. Adds missing, removes unused, populates checksums.
- `go get <module>[@version]` adds, removes, or changes a specific module version in `go.mod`. It is the imperative way to bump versions; `tidy` is the declarative reconciliation.

A typical sequence: `go mod init` once, `go get` to upgrade specific things, `tidy` after editing imports.

**Follow-up.** *If I run `go get foo@v1.5.0` and then `go mod tidy`, will tidy revert my pin?* — No. Tidy keeps the highest selected version that satisfies the graph. If your pin is at least as new as anyone's transitive requirement, it stays.

---

### Q3. Should I commit `go.sum`?

**Model answer.** Yes, always. `go.sum` is the cryptographic ledger: it maps each `<module> <version>` to a hash of its zip and `go.mod`. Without it, `go build` cannot verify the module cache against tampering, and CI builds become non-reproducible. `go.sum` is generated and maintained by `go mod tidy` (and `go get`, `go build`); the developer's only responsibility is to commit it.

**Follow-up.** *Should I edit `go.sum` by hand?* — Never. Hand edits will not match the hashes the toolchain computes and will fail verification on the next command.

---

### Q4. I just added `import "github.com/x/y"` to my Go file. What is the next command I run?

**Model answer.** `go mod tidy`. It resolves `github.com/x/y` to a module, downloads it, adds a `require` line to `go.mod`, and adds checksum lines to `go.sum`. Alternatives are `go get github.com/x/y` (more explicit; lets you pin a version) or simply `go build` (which will pull the dep but will not prune unused ones).

**Follow-up.** *What if I want a specific version?* — Either `go get github.com/x/y@v1.4.0` first, then `tidy`; or edit `go.mod`'s `require` line and run `tidy`.

---

### Q5. Does `go mod tidy` need internet?

**Model answer.** Sometimes. If every needed module version is already in the local module cache (`$GOMODCACHE`), tidy is offline. Otherwise it contacts `GOPROXY` to download `.mod` and `.zip` files and consults the checksum database (`GOSUMDB`) for new versions. In CI without a warm cache, expect network traffic.

**Follow-up.** *How do I force tidy to use only the cache?* — `GOFLAGS=-mod=mod GOPROXY=off go mod tidy`. It will fail loudly if anything is missing.

---

## Middle

### Q6. What does `// indirect` mean in `go.mod`, and when does `tidy` add it?

**Model answer.** `// indirect` marks a module that is *not directly imported by this module's packages* but is still required for the build — usually because a direct dependency needs it transitively. Tidy adds the marker when the module appears in the build list but no source file in the current module imports any of its packages.

A `require` line without `// indirect` therefore means "I import this directly." A line with `// indirect` means "I depend on this only through someone else." Removing direct usage of a package will, on the next tidy, demote its `require` line to `// indirect` — or remove it entirely if no transitive requires it either.

**Follow-up.** *Why does my `go.mod` have so many `// indirect` lines? They feel like noise.* — They appear when (a) one of your transitive deps lacks its own `go.mod` or has incomplete requires, or (b) you ran `go get -u all`. Tidy lifts transitive requires up to keep MVS reproducible. They are not bugs.

---

### Q7. What happens if I delete an import from a Go file but never run `go mod tidy`?

**Model answer.** The build still succeeds because the corresponding `require` line in `go.mod` is harmless — Go will not fail because of an unused dependency. However:
1. `go.mod` accumulates dead lines, and the dependency keeps appearing in SBOMs, license scans, and supply-chain audits.
2. `go.sum` retains stale checksum lines.
3. CI tidy-drift checks (`git diff --exit-code` after `go mod tidy`) will fail, blocking the merge.
4. The next developer who runs tidy locally will produce a noisy diff that is unrelated to their actual change.

So functionally the build works, but operationally the repo rots.

**Follow-up.** *Can I configure CI to auto-tidy?* — You can, but auto-commits from CI complicate review and PR signatures. Most teams prefer a fail-fast drift check.

---

### Q8. How does `go mod tidy` handle build tags and cross-platform code?

**Model answer.** By default tidy considers the *union* of all build configurations the module's source could compile under, so an import that only appears in `//go:build linux` files is still tracked even when you run tidy on macOS. Tidy walks all platforms and tags it can discover and unions the import sets.

In Go 1.17+, the `-compat=<version>` flag controls how aggressively tidy retains modules used only by the older Go's stricter analysis. The default behaviour ensures tidy on Go 1.17+ does not break a Go 1.16 user's build, by keeping requires that the older toolchain would have needed.

**Follow-up.** *What if a dependency only compiles on Windows and I never test on Windows?* — Tidy will still add it to `go.mod`. Whether the build *works* on Windows is a different question; tidy only reasons about graph membership, not compilability per platform.

---

### Q9. What does `go mod tidy -compat=1.17` do, and when do I use it?

**Model answer.** Since Go 1.17, `go.mod` lists all transitive dependencies (the "lazy module loading" change). The `-compat=N` flag tells tidy to verify the resulting `go.mod` would also be valid for Go version N's loading semantics, retaining extra `// indirect` requires if they would have been needed.

Use cases:
- A library whose `go.mod` declares `go 1.17` or older but is consumed by users on a wide Go version range.
- Migrating a module's `go` directive upward and wanting to preserve compatibility for laggards.

The default `-compat` value is one minor version below your `go` directive, which is usually what you want.

**Follow-up.** *What is the cost of bumping `-compat=1.21`?* — A potentially smaller `go.mod` (fewer indirect lines), but anyone still on Go 1.20 or earlier may see a build error from missing transitive requires.

---

### Q10. How is `go mod tidy` used as a CI drift check?

**Model answer.** Standard pattern:

```yaml
- run: go mod tidy
- run: git diff --exit-code -- go.mod go.sum
```

If tidy changes either file, the working tree is dirty and the CI step fails with a diff. The contract is: every commit lands a `go.mod` / `go.sum` already in tidy form, so production builds (using `-mod=readonly`) cannot drift silently.

Variations:
- Run `go mod tidy -compat=<min Go version>` to pin the comparison semantics.
- Add `go mod verify` to confirm checksum consistency.
- Run `go vet ./...` afterwards to catch tidy-induced surface changes.

**Follow-up.** *What is the most common failure mode of this gate?* — A developer adds an import, runs `go build` (which pulls the dep but does not prune), and pushes. CI's tidy then prunes unrelated dead deps from a previous careless merge, and the diff looks unrelated. Solution: discipline + a pre-commit hook that runs tidy locally.

---

### Q11. Why does `go mod tidy` sometimes touch `go.sum` even when I did not change any imports?

**Model answer.** Several legitimate reasons:
1. **Missing checksum lines.** `go.sum` may not yet cover every module/version pair `tidy` analyses for the build list. Tidy fills the gaps.
2. **`-compat` change.** Bumping the `go` directive changed which transitive requires count, which changed which checksums are needed.
3. **Toolchain upgrade.** Newer Go versions can require checksums for additional `.mod` files of dependencies they did not previously inspect.
4. **Module cache repopulation.** A cleared `$GOMODCACHE` forces tidy to re-fetch and re-verify, adding lines for `go.mod`-only entries.
5. **Retraction or proxy refresh.** A module retracted upstream changes the resolved version, indirectly altering the build list.

Tidy never removes a `go.sum` line that the *current* build list needs. So new lines are net-additive in the typical case.

**Follow-up.** *My `go.sum` shrank after tidy — is that a bug?* — No. Tidy also prunes lines for module versions no longer in the build list. A shrink is a sign your dependency graph got smaller.

---

### Q12. After `go mod tidy`, my CI fails with "checksum mismatch." What is happening?

**Model answer.** Tidy wrote new checksums based on what it just downloaded. CI is verifying against what is in `go.sum`. A mismatch means one of:
1. **Tampered cache.** A man-in-the-middle or compromised proxy served a different artefact than the one tidy computed locally.
2. **Stale `GOSUMDB` cache.** The checksum database returned a cached value that contradicts the proxy.
3. **A module retag.** Someone force-pushed a tag upstream so the artefact at `v1.2.3` differs from what `go.sum` recorded. This is a strong signal of supply-chain fraud or developer error.
4. **A `replace` directive missing on one side.** The local replace pointed at a fork; CI without the replace pulled the upstream and got a different hash.

Diagnose by running `go mod download -x <module>` to see what URL was hit and what hash was computed.

**Follow-up.** *If the module truly was retagged, what is the fix?* — Pin to a commit hash via `go get <module>@<commit>`, file a security report, and consider `replace` to a known-good fork.

---

## Senior

### Q13. How does `go mod tidy` behave in a multi-module monorepo?

**Model answer.** Each module is independent — tidy operates on the `go.mod` in the current working directory only. In a monorepo with N modules, you must run tidy N times, once per module root. If module A imports module B and B is also in the repo:
- Without `go.work`: A's `go.mod` references B via a tagged version (or `replace` directive).
- With `go.work`: the workspace stitches modules together and tidy in A still resolves B through the version pin, but local development uses the workspace overlay.

CI orchestration typically uses `find . -name go.mod` to enumerate modules and run tidy in each. Coordinated edits across modules require tagging B and then bumping A's require.

**Follow-up.** *What if a developer only runs tidy in module A but A's import of B implies a require change for both?* — A's `go.mod` is correct, but B's may still need its own tidy run for its own imports. Tidy is local to one module; CI must enforce per-module gates.

---

### Q14. How do `replace` directives interact with `go mod tidy` in production?

**Model answer.** Tidy honours `replace` directives — it computes the build list using the replacement target rather than the original module. The replacement's checksums are written to `go.sum`; the replaced version is omitted (since it is never downloaded). This means:
1. A `replace foo => ../local/foo` works for local development and tidy will not complain that `foo` is unreleased.
2. A `replace foo => github.com/team/foo-fork v1.0.1` redirects to a fork; tidy resolves transitively through the fork's `go.mod`.
3. Removing a `replace` requires re-running tidy so the original's checksums repopulate `go.sum`.

In production code, `replace` directives are a smell: they hide what the build is really using and cannot be transitively published (consumers of your module ignore your `replace`s). Treat them as short-lived patches, not architectural choices.

**Follow-up.** *What happens if `replace` points at a directory that does not exist?* — Tidy fails with a filesystem error before it can compute anything. There is no graceful fallback.

---

### Q15. How does `go mod tidy` interact with major version bumps?

**Model answer.** When a dependency releases a new major (e.g. `foo/v2`), it lives at a different module path. Tidy alone will *not* upgrade you across majors — `foo` and `foo/v2` are distinct modules. The migration sequence:
1. Update imports in your code from `foo` to `foo/v2`.
2. Run `go mod tidy` — it adds `require foo/v2` and removes the now-unused `require foo`.
3. If both old and new are still imported (during a migration), both `require` lines coexist and both versions are linked into the binary.

This is by design: SIV (Semantic Import Versioning) lets you migrate piece by piece without a flag day.

**Follow-up.** *What if my dependency does not follow SIV (a "v2" tag without a `/v2` path)?* — Tidy will only see the `v1.x.x` line of versions. To use the v2 tag, either get the maintainer to fix it, or use a `+incompatible` version (which Go marks specifically and many linters discourage).

---

### Q16. What is the silent failure mode of retracted versions during `go mod tidy`?

**Model answer.** A *retraction* is a `retract v1.4.2` directive in a module's own `go.mod`, signalling to consumers "do not use this version." `go mod tidy` honours retractions: it will refuse to *select* a retracted version when computing the build list, but **it will not automatically rewrite an existing pin** if your `go.mod` already requires the retracted version. Instead it emits a warning to stderr.

The silent failure: in CI logs, that warning is easy to miss. The build still succeeds. You ship a binary built on a known-bad version. The fix is to run `go list -m -u all` and grep for `(retracted)`, then explicitly `go get <module>@<safe-version>`.

**Follow-up.** *Can I make tidy fail on retractions?* — Not directly. Wrap it: `go list -m -u -f '{{if .Retracted}}{{.Path}} {{.Version}}{{end}}' all` returning non-empty fails CI.

---

### Q17. How would you allow-list new direct dependencies via `go mod tidy` diffs?

**Model answer.** In CI, after `go mod tidy`, parse the diff of `go.mod` for new `require` lines that lack `// indirect`:

```sh
git diff origin/main -- go.mod \
  | awk '/^\+\t/ && !/\/\/ indirect/ {print $2}'
```

Then compare each path to a committed allow-list (e.g., `.allowed-deps.txt`). If anything is new and unlisted, fail the gate and tag the security team for review.

Stronger versions:
- Sign the allow-list with a CODEOWNER key.
- Block transitive requires (`// indirect`) only if they cross a security threshold (CVE feed, license check).
- Auto-comment the PR with the list of new modules and their licences pulled from `go list -m -json`.

**Follow-up.** *How do I avoid the gate firing on benign re-tidy noise?* — Distinguish "new direct" from "promoted from indirect" by checking whether the dep was already in the previous `go.mod` at all. Promotion-from-indirect to direct usually deserves the same review as a fully new dep — promotion means a developer is now coupling code to an internal of a transitive lib.

---

### Q18. How does `go mod tidy` relate to reproducibility, `-mod=readonly`, `go.sum`, and the `toolchain` directive?

**Model answer.** Reproducibility in Go modules is a chain:
1. `go mod tidy` produces a canonical `go.mod` / `go.sum` for a given source tree and toolchain.
2. `go.sum` cryptographically pins every module artefact in the build list.
3. `-mod=readonly` (default in CI starting Go 1.16) refuses any build that would require modifying `go.mod` or `go.sum`. So if tidy was forgotten, the build fails rather than silently editing files.
4. The `toolchain` directive (Go 1.21+) pins which Go version compiles this module. Different toolchains can produce different `go.mod` outputs (e.g., due to lazy-loading rules), so without `toolchain`, two CI runners on different Go versions could disagree about what tidy considers correct.

Together: `tidy` produces the canonical artefact, `toolchain` ensures every machine runs the same producer, `go.sum` pins the inputs, and `-mod=readonly` forbids drift at consumption time.

**Follow-up.** *Where does `vendor/` fit?* — `go mod vendor` after `tidy` snapshots the build list to the filesystem. With `-mod=vendor`, builds use the vendor directory and skip the proxy entirely — the strongest reproducibility guarantee, at the cost of a much larger repo.

---

## Staff / Architect

### Q19. How do you run `go mod tidy` in an air-gapped environment?

**Model answer.** Tidy needs *some* access to module artefacts. In an air-gapped network you have several choices:
1. **Pre-warmed `$GOMODCACHE`.** Run tidy on an internet-connected machine, then ship the cache (`$GOPATH/pkg/mod` and `$GOPATH/pkg/mod/cache/download`) into the air-gapped one. With `GOPROXY=off` and the cache present, tidy works offline.
2. **An internal proxy mirror.** Tools like Athens, JFrog Artifactory, or Sonatype Nexus mirror a curated subset of the public module ecosystem. `GOPROXY=https://corp.proxy/repository/go-proxy,off` directs tidy through the mirror.
3. **`vendor/` only workflow.** Once the vendor tree is committed, set `-mod=vendor` and tidy is irrelevant for builds — you only re-run it when adding deps, on a separate connected machine.
4. **`GOFLAGS=-insecure -mod=mod`.** If the proxy is internal-only without TLS, this is sometimes needed.

Operationally most regulated environments combine #2 and #3: the proxy is the only path out, and `vendor/` is the build-time artefact.

**Follow-up.** *What about the checksum database?* — Air-gapped environments usually set `GOSUMDB=off` and `GONOSUMCHECK=*`, trusting that the internal proxy is the security boundary. Doing this without a proxy that itself verifies upstream checksums is dangerous.

---

### Q20. Design CI gates around `go mod tidy` at scale (hundreds of repos).

**Model answer.** Layered controls:

1. **Tidy drift gate.** Standard `go mod tidy && git diff --exit-code` per module per PR. Cheap, blocks careless merges.
2. **Tidy compatibility gate.** Run tidy with the lowest supported `-compat=N` and verify it still produces the same file. Catches accidental requirement bumps that would break older consumers of your library.
3. **Allow-list gate** (Q17). Net-new direct deps require security sign-off.
4. **License / CVE scan post-tidy.** Run `go list -m -json all | <scanner>` after tidy succeeds, to ensure newly-added transitives do not introduce GPL or known-vulnerable code.
5. **Reproducibility gate.** Build twice with `-mod=readonly` on different runners and diff the binaries. Tidy bugs occasionally cause non-deterministic `go.mod` ordering pre-Go-1.21.
6. **Mirror staleness gate.** If you operate a private proxy, periodically run tidy in a canary repo to detect when upstream retags or retractions invalidate your mirror.
7. **Org-wide dashboard.** Aggregate the per-module `go.sum` content and flag versions that diverge across the org; consolidate to single versions where possible to shrink the supply-chain surface.

The gates compose: each one is a 10-line CI step; together they are a defensible posture.

**Follow-up.** *What is the right team to own these gates?* — Platform / Developer Experience owns the scaffolding; AppSec owns the allow-list and CVE policy; individual teams own remediation.

---

### Q21. How would you reproduce `go mod tidy` programmatically without invoking the binary?

**Model answer.** The `golang.org/x/mod` family of packages (`modfile`, `module`, `semver`, `sumdb`) gives you a library API to:
- Parse and edit `go.mod` (`modfile.Parse`, `modfile.AddRequire`, `modfile.DropRequire`).
- Manipulate `go.sum` lines (`sumdb`).
- Resolve module versions semantically (`semver`).

For the import-graph walk, `golang.org/x/tools/go/packages` returns the package list. Combining the two, you can write a custom tidy that, e.g., refuses to remove a require unless an annotation allows it, or marks specific deps as "always direct."

This is rare in practice — most teams use the upstream `go mod tidy` and shell out from automation. The library route matters for build systems (Bazel `rules_go`, Pants, Buck2) that want to integrate Go module resolution with their own dependency model and avoid invoking `go` per target.

**Follow-up.** *What can the library API not do?* — It will not download artefacts or run MVS for you across the network. You still need a proxy client, or you call `go list -m all -json` and consume that output.

---

### Q22. You run `go mod tidy` and get "ambiguous import" or repeating tidy churn. How do you diagnose?

**Model answer.** "Ambiguous import" usually means a package path resolves to *two* modules in the build list. Causes:
1. A repository hosts the same package under two different module paths (e.g., `github.com/foo/bar` and `github.com/foo/bar/v2/legacy`). The same import path is reachable through both module roots.
2. A `replace` directive inadvertently brings in a module whose path overlaps with another require.
3. A vendoring inconsistency where `vendor/modules.txt` contradicts `go.mod`.

Diagnosis: `go mod why -m <module>` for each candidate, plus `go list -m -json all` to inspect the build list. The fix is usually to remove one of the overlapping requires or to narrow the `replace`.

Repeating tidy churn (every developer's tidy produces a different `go.mod`) usually means:
- Different `GOFLAGS` or `-compat` values across machines.
- Different toolchain versions and no `toolchain` directive.
- A flaky proxy that returns slightly different `go.mod` files for the same `<module>@<version>` tuple.
- A `replace` to a path that exists on some machines and not others.

The remediation is to pin the toolchain (`toolchain go1.22.3` in `go.mod`), set `GOFLAGS` consistently in CI, and audit `replace` directives for portability.

**Follow-up.** *What if churn appears only in CI but not locally?* — Compare `go env` between CI and local. The usual culprits are `GOFLAGS`, `GOPROXY`, and the Go version itself.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Does `go mod tidy` need internet? | Sometimes — depends on cache. |
| Does tidy create `go.sum`? | Yes if missing or stale. |
| Can tidy remove dependencies? | Yes — unused ones are pruned. |
| What does `// indirect` mean? | Required transitively, not directly imported here. |
| Does tidy modify production code? | No — only `go.mod` and `go.sum`. |
| Does `go build` do what tidy does? | No — build can pull deps but will not prune. |
| Does tidy upgrade dep versions? | No — use `go get -u` for that. |
| Is tidy deterministic? | Yes, given same toolchain and inputs. |
| Should tidy run in CI? | As a drift check (`git diff --exit-code`), yes. |
| Does tidy honour `replace` directives? | Yes — replacements drive the build list. |

---

## Mock Interview Pacing

A 30-minute interview focused on `go mod tidy` might cover:

- 0–4 min: warm-up — Q1 and Q3 to confirm fundamentals.
- 4–12 min: middle — Q6 (`// indirect`), Q10 (CI drift), Q11 (why `go.sum` changes).
- 12–22 min: senior scenario — pick one of Q13 (monorepo), Q14 (`replace` in production), or Q16 (retractions).
- 22–28 min: a curveball — Q19 (air-gapped) or Q22 (ambiguous import).
- 28–30 min: quick-fire round to check breadth.

Heuristics for adjusting pace:
- If the candidate breezes through Q1–Q5, skip ahead to Q11 or Q13. Junior questions waste time once a level is established.
- If the candidate cannot articulate the difference between direct and indirect (Q6), do not advance to senior territory — that distinction is foundational and the rest of the senior questions assume it.
- Reserve Q18 (reproducibility chain) for staff-level candidates only; it requires synthesising `tidy`, `-mod=readonly`, `go.sum`, and `toolchain` into one mental model, which is not reasonable to expect of mid-level engineers.
