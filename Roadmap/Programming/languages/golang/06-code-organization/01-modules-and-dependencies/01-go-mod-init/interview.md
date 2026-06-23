# `go mod init` — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does `go mod init` do?

**Model answer.** It creates a `go.mod` file in the current directory, with two lines: `module <path>` and `go <version>`. That single file turns the directory into a Go module — a unit Go can build, version, and depend on. The command does nothing else: no network, no source changes, no folders.

**Common wrong answers.**
- "It downloads dependencies." (No — that is `go mod tidy` or `go get`.)
- "It creates `go.sum`." (No — `go.sum` appears later.)
- "It runs `git init`." (No — Go and Git are independent.)

**Follow-up.** *What happens if `go.mod` already exists when I run it?* — Error: `go.mod already exists in current directory`.

---

### Q2. What is a module path?

**Model answer.** The canonical name of a module — usually a URL-shaped string like `github.com/alice/cooltool`. It is the first line of `go.mod` (after the keyword `module`), and it forms the prefix of every import path inside the module.

**Follow-up.** *What is the import path of a sub-folder named `greet/` inside that module?* — `github.com/alice/cooltool/greet`.

---

### Q3. Should I commit `go.mod` to source control?

**Model answer.** Yes, always. And `go.sum` once it appears. They are part of the source code; without them, builds are not reproducible.

**Follow-up.** *What if I include `go.mod` but exclude `go.sum`?* — Builds may break in CI because checksum verification fails when the cache is empty.

---

### Q4. I want to create a new Go project. What is the first command I run?

**Model answer.** After making and entering the project directory: `go mod init <module-path>`. Often paired with `git init`.

**Follow-up.** *Does the order matter?* — Not strictly. Either `git init` first or `go mod init` first works.

---

## Middle

### Q5. Why is the module path URL-shaped (e.g. `github.com/alice/lib`)?

**Model answer.** Because the Go toolchain uses the path as a network locator: it appends the path to a configured proxy URL or attempts a direct `git clone` from `https://<path>`. URL-shaped paths let `go get` resolve the module without any registry lookup. The dot in the first component is the toolchain's signal that the path is intended to be network-resolvable.

**Follow-up.** *What if I use `mything` with no dot?* — It works locally but cannot be `go get`-ed by anyone. The toolchain treats it as a local-only module.

---

### Q6. What is the difference between a *module*, a *package*, and a *repository*?

**Model answer.**
- **Repository:** a VCS unit (one Git repo).
- **Module:** a directory subtree containing a `go.mod` at its root. The unit Go versions and ships.
- **Package:** a directory of `.go` files sharing a `package` clause. The unit Go imports.

A repo can contain one or many modules. A module always contains one or many packages.

**Follow-up.** *Can a repo contain zero modules?* — Yes — if it has no `go.mod`. Then nothing in it is buildable as Go code in modules-aware mode.

---

### Q7. What is the rule about major version suffixes in module paths?

**Model answer.** For modules with major version 2 or higher, the module path must end with `/vN` where N is the major version. So:

- `github.com/alice/lib` for v0 and v1
- `github.com/alice/lib/v2` for v2.x.x
- `github.com/alice/lib/v3` for v3.x.x

The rule enforces *Semantic Import Versioning*: a breaking change must produce a new import path, allowing two majors to coexist in one build.

**Follow-up.** *Why is `/v0` and `/v1` not allowed as suffixes?* — Because v0 and v1 share the unsuffixed path by convention; explicit suffixes would be redundant and confusing.

---

### Q8. What does the `go` directive in `go.mod` mean?

**Model answer.** It declares the **minimum Go language version** required to compile this module's source. Code can use language features up to that version. Consumers running an older toolchain will be told to upgrade. Since Go 1.21, the directive also affects some behaviours like `for`-loop variable semantics.

**Follow-up.** *If I write `go 1.22` and a user has Go 1.20, what happens?* — Their build fails with a version-mismatch message.

---

### Q9. I just ran `go mod init`. Why does my IDE not see my project's imports?

**Model answer.** Several possibilities:
1. The IDE has cached pre-init state — restart the language server.
2. The module path does not match the folder structure (for example, the import statement uses `github.com/alice/foo/sub` but the folder is named `subfolder`).
3. The IDE does not know about modules — outdated tooling.
4. `GOPATH` is misconfigured and the IDE assumed legacy mode.

**Follow-up.** *Why might the import path mismatch?* — A copy-paste error, or because the user changed the module path in `go.mod` but did not update existing imports.

---

### Q10. Can I have two `go.mod` files in the same repository?

**Model answer.** Yes — that is a *multi-module repository*. Each `go.mod` defines its own module rooted at its directory. The toolchain treats them independently. Use cases include monorepos with separately-versioned libraries, or sub-modules with isolated dependency graphs (e.g., a `tools/` directory with build-time-only dependencies).

The cost: CI must run per-module, IDE behaviour gets more complex, and cross-module imports require either tagged versions or `replace` directives.

**Follow-up.** *Can two `go.mod` files exist in the same directory?* — No. One `go.mod` per directory.

---

## Senior

### Q11. You inherit a Go project that has no `go.mod`. The team wants to migrate to modules. Walk through the steps.

**Model answer.**
1. Inspect the project's import paths. They suggest the canonical module path (e.g., `github.com/oldteam/legacy`).
2. From the project root: `go mod init <path>`.
3. Run `go mod tidy` to populate `require` directives based on existing imports.
4. Resolve any errors:
    - Imports of packages that no longer exist online — choose a fork, use `replace`.
    - Imports of packages whose paths have changed — update the imports.
5. Run `go build ./...` and `go test ./...`. Fix any compile-time issues.
6. If the project used `vendor/`, decide whether to keep it: if yes, run `go mod vendor`; if no, delete `vendor/`.
7. Commit `go.mod`, `go.sum`, and (if applicable) `vendor/`.
8. Update CI to use Go modules.

**Follow-up.** *What if `go mod tidy` cannot resolve a dependency?* — Either fork and `replace`, or remove the unused import if the dependency is truly dead.

---

### Q12. Your library is at `github.com/team/lib v1.5.0`. You need to make a breaking change. What is the process?

**Model answer.**
1. Decide the new major version: `v2`.
2. Edit `go.mod` to change the module path: `module github.com/team/lib/v2`.
3. Find-and-replace all internal imports that referenced the old path.
4. Make the breaking change(s).
5. Tag the release: `git tag v2.0.0; git push --tags`.
6. Document the migration in the release notes.
7. Maintain `v1.x.x` on a separate branch for security patches.

The key insight: bumping the tag alone is not enough. The module path itself must change, because the path enforces import compatibility within a major version.

**Follow-up.** *What if I just tag `v2.0.0` without changing the path?* — Consumers who run `go get @v2` get an error: the module's declared path does not match the requested version's expected path.

---

### Q13. When would you use a vanity module path instead of `github.com/...`?

**Model answer.** When the project's *VCS host* might change but the project's *identity* should not. Examples:
- A library you may someday move from GitHub to GitLab.
- A library hosted in a private corporate repo whose URL would leak internal hostnames.
- A library shared across organisations that should be host-neutral.

Mechanism: serve a small HTML page at the vanity URL with a `<meta name="go-import">` tag pointing to the actual VCS. Consumers see only the vanity path; the toolchain resolves it transparently.

**Follow-up.** *What is the maintenance cost?* — One DNS record, one static page, indefinitely. Cheap, but it is one more thing to manage.

---

### Q14. What is `go.work` and when should I use it?

**Model answer.** `go.work` is a *workspace file* (Go 1.18+) listing multiple modules to develop in lockstep. With a `go.work` present, the toolchain stitches the listed modules together so changes in module A are immediately visible to module B without `replace` directives or version tags.

Use cases:
- Multi-repo development on related libraries.
- Refactoring across module boundaries.
- Testing a private fork of a dependency without committing.

`go.work` is typically *not* committed in production setups. Many teams `gitignore` it.

**Follow-up.** *Is `go.work` a substitute for `go mod init`?* — No. Each member of the workspace must still be its own module with its own `go.mod`. The workspace is an overlay above modules.

---

### Q15. How does Minimum Version Selection (MVS) interact with `go.mod`?

**Model answer.** When the toolchain resolves dependencies, it walks the transitive closure of `require` directives. For each module path that appears with multiple version requirements, MVS picks the *highest* required version. The result is one version per module path, deterministic given the input `go.mod` files.

The "minimum" in MVS refers to *minimum constraint satisfaction* — pick no version higher than necessary. Contrast with `npm` or `cargo`, which often pick the newest available within a range.

**Follow-up.** *What advantage does MVS have?* — Reproducibility. Two engineers with the same `go.mod` get the same build list. Adding a new dependency does not silently bump unrelated dependencies.

---

## Staff / Architect

### Q16. You are designing a Go monorepo for a 200-engineer company. What considerations drive your choice of single-module vs multi-module?

**Model answer.** Multiple axes:

1. **Release cadence.** If teams release on different cadences, multi-module — each can tag independently.
2. **Dependency graph hygiene.** A heavy dependency pulled by one team affects everyone in single-module mode. Multi-module isolates.
3. **External reusability.** Code that needs to be importable as a third-party dep must be its own module.
4. **CI complexity.** Single-module: `go test ./...` is enough. Multi-module: per-module test runs, more configuration.
5. **Atomic refactor.** Single-module: one PR can change everything. Multi-module: requires `go.work` or coordinated PRs.
6. **Security audit boundaries.** Multi-module limits which code each `go.sum` covers — auditors see narrower scopes.

In practice, a 200-engineer monorepo usually settles on multi-module with a few large bounded contexts (services, shared libraries, tools), each its own module. `go.work` provides developer ergonomics; CI runs per-module pipelines.

**Follow-up.** *How would you migrate from single-module to multi-module?* — Carve out one sub-module at a time, starting with the most independent. Each carve-out is: create `go.mod` in the sub-folder, update imports in the parent module to reference the new module's tagged versions, set up its own CI pipeline.

---

### Q17. A teammate ran `go mod init` accidentally in `~/projects` instead of `~/projects/myrepo`. The whole `projects` folder is now a module. How do you recover?

**Model answer.**
1. **Don't panic.** The damage is local — no remote was affected.
2. Delete the unwanted `go.mod`: `rm ~/projects/go.mod`.
3. Verify no other tools tried to attach to it (e.g., gopls cache): restart the IDE / language server.
4. Run `go mod init` in the *correct* directory (`~/projects/myrepo`).
5. Verify with `go env GOMOD` from inside `~/projects/myrepo` — it should print the path to the correct `go.mod`.

If the wrong `go.mod` was committed: `git rm` it and amend.

**Follow-up.** *What if the wrong `go.mod` accumulated dependencies?* — Re-run `go mod tidy` in the correct location after recovery; transient deps will be re-discovered.

---

### Q18. You operate a private Go module proxy for your company. A team complains that `go mod init` works but `go build` fails with checksum mismatches. What is the diagnostic path?

**Model answer.** Layer by layer:

1. **Confirm `go mod init` is *not* the cause.** It writes a local file with no network. Checksum errors come later.
2. **Verify `GOPROXY` and `GOSUMDB`.**
    - `go env GOPROXY` — should include the corp proxy.
    - `go env GOSUMDB` — `sum.golang.org` for public modules; `off` or a custom DB for corp.
    - `go env GOPRIVATE` — should match corp paths.
3. **Test the proxy directly.** `curl https://corp.example.com/proxy/<module>/@v/list` — does it respond?
4. **Examine the checksum.** Compare `go.sum` line for the failing module to what the proxy serves. A diff means tampering, network corruption, or a misconfigured proxy.
5. **Module path validation.** A corp module's path must be in `GOPRIVATE` or `GONOSUMCHECK`, otherwise the toolchain consults `sum.golang.org`, which has no entry, producing an error.
6. **Cache poisoning.** `go clean -modcache` and retry.
7. **Toolchain version.** Some checksum behaviour changed in Go 1.18 and 1.21. Verify the team's Go version.

The first, second, and last steps catch ~90% of corporate cases.

**Follow-up.** *What if `go mod tidy` itself produces inconsistent `go.sum`?* — Likely a flaky proxy. Pin to a specific cached source (`GOPROXY=off` after warming up the cache) for reproducibility.

---

### Q19. Design a CI gate that catches a developer adding a new dependency without authorization.

**Model answer.**
1. **Detect new `require` directives** in PRs:
    ```yaml
    git diff origin/main -- go.mod | grep '^\+\trequire\b'
    ```
2. **Maintain an allow-list** of approved dependency paths.
3. **Fail the build** if any new `require` line introduces an out-of-list path.
4. **Slack a channel** for review when the gate fires.

Stronger: cryptographically pin the allow-list (commit a manifest signed by a security key).

A gentler variant: just *flag* new dependencies in the PR description (no failure), to give security reviewers visibility.

**Follow-up.** *What about transitive deps?* — Harder to gate, since they appear via `// indirect`. Most teams accept transitives but require periodic auditing via SBOM scans.

---

### Q20. What is the relationship between `go mod init` and reproducible builds?

**Model answer.** `go mod init` itself is reproducible — given the same toolchain version and module path argument, it always writes the same two-line file. It contributes nothing to non-determinism.

But the *module identity* it establishes is a precondition for reproducibility: without a `go.mod`, dependency versions cannot be pinned, `go.sum` cannot exist, and any future `go build` resolves dependencies non-deterministically (or at least non-portably).

So `go mod init` is the boring first step in a reproducibility chain: `init` → develop → `tidy` → commit `go.sum` → CI gate (`-mod=readonly`) → hermetic build.

**Follow-up.** *Where in this chain do most teams fail?* — Usually skipping the CI gate. Without `-mod=readonly` and a tidy-check, `go.mod` and `go.sum` drift silently.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Does `go mod init` need internet? | No. |
| What two directives go into a fresh `go.mod`? | `module` and `go`. |
| Can the module path be uppercase? | No (lowercase only). |
| Does `go mod init` create `go.sum`? | No. |
| Required suffix for v3? | `/v3`. |
| Required suffix for v1? | None. |
| One `go.mod` per ___? | Module (and per directory). |
| Time complexity of `go mod init`? | Constant — no graph traversal. |
| Does it commit anything to git? | No. |
| Where does it run? | Current directory. |

---

## Mock Interview Pacing

A 30-minute interview on Go modules might cover:

- 0–5 min: warm-up — Q1, Q2.
- 5–15 min: middle topics — Q5–Q10.
- 15–25 min: a senior scenario — Q11 or Q12 or Q17.
- 25–30 min: a curveball — Q18 or Q19.

If the candidate is sharp, skip the warm-ups and go straight to scenarios. If they stumble on terminology, stay in middle territory until they recover.
