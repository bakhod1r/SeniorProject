# Minimal Version Selection (MVS) — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is Minimal Version Selection, in one sentence?

**Model answer.** MVS is the algorithm Go uses to choose dependency versions: for each module, it selects the **highest version that any `require` directive in the dependency graph asked for** — the highest of the minimums — and nothing higher. A `require` line is a *floor* (a minimum), not a pin, and the selected version is the maximum of all the floors for that module.

**Common wrong answers.**
- "Go uses the latest version of each dependency." (No — it uses the minimum that satisfies everyone, never the latest available.)
- "It uses the exact version in `go.mod`." (No — `go.mod` sets a floor; a higher floor elsewhere can raise the selected version.)
- "It solves a constraint puzzle." (No — there is no SAT solver; it is a max-per-module graph walk.)

**Follow-up.** *Why is it called "minimal"?* — Because it picks the *smallest* version that still satisfies every requirement. Smaller than "latest available," larger than any single floor.

---

### Q2. If I run `go get foo@v1.2.0` but `go list -m foo` shows `v1.6.0`, is that a bug?

**Model answer.** No. Some other module in the graph requires `foo` at `v1.6.0`. MVS selects the maximum floor, so `v1.6.0` wins even though your direct require is `v1.2.0`. Your direct floor was lowered, but the *selected* version cannot drop below another module's floor. Use `go mod why foo` and `go mod graph | grep foo@` to find who sets the higher floor.

**Follow-up.** *How would you actually get v1.2.0?* — You would need to downgrade or remove the module that forces `v1.6.0` (`go get`-based downgrade, which cascades), or use `exclude`/`replace`.

---

### Q3. A new version of a dependency was released last night. After a plain `go build`, which version does my build use?

**Model answer.** The same one as before — your existing floor. MVS never auto-upgrades. A new release on the internet is invisible to selection until *you* raise a floor with `go get`. A plain build is read-only with respect to `go.mod` (since Go 1.16, `-mod=readonly` is the default) and never changes versions.

**Common wrong answer.** "It picks up the latest automatically." (That is the SAT-resolver model — npm, Cargo. Go does the opposite.)

**Follow-up.** *How do you move to the new version?* — `go get foo@latest` (or `@v1.7.0`), then `go mod tidy`.

---

### Q4. Why does MVS give reproducible builds without a lockfile?

**Model answer.** Because the selected version of every module is a pure function of the `require` floors committed in the `go.mod` files. The same module graph always produces the same build list, on any machine, at any time — there is no calendar dependency and no separate solution to cache. `go.mod` *is* the lock; the floors plus the "max per module" rule fully determine the build.

**Follow-up.** *Then what is `go.sum`?* — An integrity database: cryptographic hashes of the module bytes used. It verifies *what* you got but does not *choose* versions. It is not a lockfile.

---

### Q5. What is the build list, and how do I see it?

**Model answer.** The build list is the result of MVS: one selected version per module that the build actually uses. Print it with `go list -m all`. The first line (no version) is your main module; every other line is a `(module, version)` pair MVS chose. It is *derived* from the module graph, not stored, so it is always consistent with `go.mod`.

**Follow-up.** *How is it different from `go mod graph`?* — `go mod graph` shows the *input* (every `require` edge — a module can appear at several versions); `go list -m all` shows the *output* (one selected max version per module).

---

## Middle

### Q6. Walk me through computing a build list by hand.

**Model answer.** Given a module graph (edges `A → B v1.x` meaning A requires at least B v1.x), traverse from the main module, and for each module path keep the maximum version seen across all edges. Example: if `app → C v1.3` and `app → libB v1.0`, and `libB → C v1.4`, then `C` is required at `v1.3` and `v1.4`; MVS selects `v1.4` (the max). Repeat for every module. The set of maxima is the build list. Verify with `go list -m all`.

**Follow-up.** *Can a module appear at two versions in the final build list?* — Only if they are different *module paths* (e.g. `C` and `C/v2`). For a single path, exactly one version is selected.

---

### Q7. Name the four MVS operations.

**Model answer.**
1. **Build list** — compute the selected version of every module (the base operation; runs on every build).
2. **Upgrade one** — raise one module's floor to a higher version, pulling in that version's own requirements; `go get foo@v1.5.0`.
3. **Upgrade all** — raise every module's floor to its latest version; `go get -u ./...`.
4. **Downgrade** — lower a module by lowering/removing every module that forced it higher; `go get foo@<older>`.

The asymmetry: upgrading follows requirements forward; downgrading searches backward to undo the floors that forced a higher version.

**Follow-up.** *Which is the hard one and why?* — Downgrade. It must enumerate the version history of every requiring module to find a version that releases the constraint, and it propagates (can cascade other modules down).

---

### Q8. What does `go get foo@v1.5.0` do beyond editing one line?

**Model answer.** It runs upgrade-one: floors `foo` at `v1.5.0`, reads `foo@v1.5.0`'s own `go.mod`, and adds *its* requirements as floors — which can transitively raise *other* modules (requirement tightening). It then recomputes the build list and rewrites `go.mod` (including `// indirect` lines) and `go.sum`. So "I only upgraded foo" can produce a multi-line diff, because you cannot use `foo@v1.5.0` without satisfying its minimums.

**Follow-up.** *What if v1.5.0 is lower than the current selected version?* — Then it is a downgrade, which propagates and may cascade other modules down; the toolchain reports what it lowered.

---

### Q9. Explain `// indirect` requirements.

**Model answer.** A `require` marked `// indirect` is a floor for a module your own code does not import directly. They exist for two reasons: (1) to *pin the build list* — under `go 1.17+`, every module in the build list is recorded as an indirect require so the list is computable from the main `go.mod` alone (the pruning requirement); (2) to *raise a transitive floor* deliberately, e.g. to pick up a security fix in a dependency-of-a-dependency. MVS treats indirect floors identically to direct ones. `go mod tidy` manages them; you should not hand-edit them.

**Follow-up.** *Why does a `go 1.17` module have more indirect lines than a `go 1.16` one?* — Module graph pruning requires the full build list to be pinned in `go.mod`, so tidy records every build-list module as an indirect require.

---

### Q10. What is module graph pruning and does it change which versions are selected?

**Model answer.** Pruning (`go 1.17+`) restricts *how much* of the module graph MVS loads: for dependencies that also declare `go 1.17+`, it follows only the requirements needed to provide packages your build actually imports, not their full transitive closure. To make this sound, the main `go.mod` pins the entire build list as indirect requires. Crucially, pruning **does not change the build list** for a properly tidied module — it changes the work (fewer `go.mod` files read), not the result. It is what makes MVS scale on large monorepos.

**Follow-up.** *How would you turn it on?* — Set the `go` directive to 1.17+ and run `go mod tidy`.

---

### Q11. How do `go mod graph`, `go list -m all`, and `go mod why` differ?

**Model answer.**
- `go mod graph` — the MVS *input*: every requirement edge `A B`. A module can appear at several versions (every floor anyone set).
- `go list -m all` — the MVS *output*: the build list, one selected (max) version per module.
- `go mod why -m foo` — the *justification*: the shortest import chain that pulls `foo` into the build, explaining why it is there at all.

Most version surprises live in the gap between the graph (all floors) and the list (the selected max). These three commands let you see input, output, and reason.

**Follow-up.** *A module is in the graph but `go mod why` says the main module doesn't need it — what does that mean?* — It is a floor with no package actually imported; a candidate for `go mod tidy` to prune.

---

### Q12. What is a pseudo-version, and how does MVS treat it?

**Model answer.** A pseudo-version is Go's stand-in for an untagged commit, like `v0.0.0-20230615120000-abcdef123456`: a base version, a UTC commit timestamp, and a 12-hex commit prefix. It appears when a dependency requires a specific commit with no release tag. MVS treats it as an ordinary version — it can be a floor and can be selected — ordered by its embedded base version and timestamp. It is normal, not an anomaly.

**Follow-up.** *Why must tooling not string-compare versions?* — Because pseudo-versions and pre-releases (`-rc.1`) have precedence rules that naive string comparison gets wrong; use `golang.org/x/mod/semver`.

---

## Senior

### Q13. Why did Go choose MVS over the SAT-solver model that npm, Cargo, and Bundler use?

**Model answer.** Three design goals: **reproducibility**, **high fidelity**, and **simplicity**. SAT resolvers operate on version *ranges* and search for the *newest* satisfying assignment — which is non-deterministic across time (new releases shift the solution, hence the lockfile), can fail outright on conflicting ranges, and builds dependencies against versions their authors never tested. MVS uses single *floors*, selects the *minimum* that satisfies everyone, and so is: deterministic from `go.mod` alone (no lockfile), high-fidelity (you build against the versions authors declared and tested), and trivial to reason about (a max-per-module graph walk, no backtracking, no unsatisfiable case). The trade-off is that MVS never auto-upgrades — you own the currency process.

**Common wrong answer.** "MVS is just simpler/lazier." (It is a deliberate optimisation for reproducibility and fidelity, not a shortcut.)

**Follow-up.** *What failure class does MVS eliminate?* — "No satisfying assignment." Because there are no upper bounds, the max always exists; resolution never fails for lack of a solution.

---

### Q14. MVS never auto-patches. How do you handle security in an MVS world?

**Model answer.** MVS's reproducibility means a build can sit on a known-vulnerable version indefinitely — "reproducibly insecure." Because the algorithm will not patch you, you add process:
- `govulncheck ./...` in CI, on a schedule, failing the build on vulnerable *selected* versions.
- SBOM generation plus advisory feeds (`osv-scanner`) to catch transitive CVEs.
- A scheduled `go get -u=patch ./...` PR (bot or recurring task) to pull patch-level fixes with minimal behavioural risk.
- A floor-raising playbook for advisories: `go get mod@patched`, tidy, retest, ship — a reviewable diff.

MVS removes the *push* attack (silent upgrade to malicious code) but does nothing about the *stale* risk. The senior job is to cover the gap MVS deliberately leaves.

**Follow-up.** *Why is the lag the security risk and not the strength?* — Reproducibility freezes versions; if the frozen version has a CVE, you stay vulnerable until someone deliberately raises the floor.

---

### Q15. A dependency forces a popular module's version higher than I want. Walk me through diagnosing and fixing it.

**Model answer.**
1. Confirm the selected version: `go list -m golang.org/x/sys`.
2. Find every floor: `go mod graph | grep 'golang.org/x/sys@'` — the max is what is selected.
3. Identify the requirer: `go mod why -m golang.org/x/sys`, and inspect which dependency declares the high floor.
4. Options, in order of preference:
   - Accept it (newer is usually compatible within a major version).
   - Upgrade or replace the *aggressive dependency* if it is pulling in something undesirable.
   - `exclude` a specific known-bad version (skips it without cascading).
   - Downgrade (`go get x/sys@<older>`), accepting the cascade report — riskiest, can reintroduce fixed bugs in modules it lowers.

**Follow-up.** *Why prefer `exclude` over a forced downgrade?* — `exclude` removes one candidate without propagating; a downgrade lowers every module that forced the version up, which can cascade widely.

---

### Q16. Explain how `replace`, `exclude`, and `retract` relate to MVS, and the main-module-only rule.

**Model answer.**
- `exclude path version` — drops a specific version from MVS's candidate set before taking the max; MVS selects the next-highest floor.
- `replace path => other` — substitutes a different module/version (or local path) entirely, overriding selection for that path.
- `retract version` — declared by a module about its *own* releases; does not affect its own selection but warns *downstream* `go get`/`go list` to avoid the retracted version.

The key rule: **`replace` and `exclude` are honoured only for the main module** — they are ignored when your module is a dependency of someone else's build. So a library author cannot use them to constrain consumers; they must use `require` floors and `retract`. Treat all three as documented policy levers, not hacks.

**Follow-up.** *A consumer ignores my library's `exclude` — bug?* — No, by design. `exclude` is main-module-only.

---

### Q17. How does the diamond dependency problem play out under MVS?

**Model answer.** The diamond (`A` and `B` both depend on `C` at different versions) is *resolved by construction* under MVS: it selects `max(C floors)` and builds both `A` and `B` against it. No conflict, no search — as long as `C` follows semver within its major version, both get a `C` at least as new as they required. The SAT-resolver "diamond of death" (incompatible *ranges* with no satisfying version) cannot occur, because there are no upper bounds. And for *breaking* changes, Go's major-version-as-path-suffix means `C` and `C/v2` are different modules that *coexist* in the build rather than conflict.

**Follow-up.** *So how do I ever get a hard conflict?* — Effectively only by `exclude`-ing the only available version of a module, which is self-inflicted.

---

### Q18. In a multi-module repo with a `go.work`, how does MVS behave?

**Model answer.** MVS runs *per main module*. Each `go.mod` has its own build list, computed independently — two modules in the same repo can select different versions of the same third-party dependency. A `go.work` workspace overlays the listed modules so they resolve *each other's* source directly during development, but it does **not** change MVS's selection of *external* dependencies — selection stays per-module. `go work sync` can push selected versions across workspace modules for consistency, but it does not make selection repo-wide. Released artefacts are built with each module's own MVS result.

**Follow-up.** *Is `go.work` a new resolution model?* — No. It is a development convenience for in-workspace module paths; MVS's rules are unchanged.

---

## Staff / Architect

### Q19. Design a dependency-currency process for a 20-service Go monorepo using MVS.

**Model answer.** MVS guarantees reproducibility but not currency, so build the currency layer on top.

**Detection.**
- `govulncheck ./...` per module in CI, failing on vulnerable selected versions.
- Aggregate `go list -m -u all` across modules into a dashboard of "updates available" and `-retracted` for retracted selected versions.

**Routine upgrades.**
- A scheduled bot (Renovate/Dependabot for Go modules, or a cron `go get -u=patch ./...`) opens per-module patch-refresh PRs monthly. Patch-only keeps behavioural risk low.
- Minor/major upgrades are deliberate, human-initiated, one reviewed PR at a time.

**Coordination.**
- For a CVE in a shared transitive dependency, a scripted bulk PR raises the floor (`go get mod@patched ./...`) across affected modules, tidies, and presents a focused diff.
- Pin the `go` directive at 1.17+ across all modules for pruning/laziness so module operations stay fast at scale.

**Governance.**
- Every `go.mod` diff is reviewed like code; `git blame go.mod` and `git bisect` make a bad upgrade traceable to one floor change.

**Follow-up.** *Why is MVS especially good for monorepo governance?* — Because version changes are explicit, reviewable, bisectable diffs — not silent lockfile regenerations.

---

### Q20. Contrast the reproducibility guarantees of Go modules vs a lockfile-based ecosystem.

**Model answer.** A lockfile ecosystem (npm, Cargo) has two artefacts: a *manifest* with version ranges, and a *lockfile* pinning one solution of those ranges. Reproducibility depends on committing and honouring the lockfile; the manifest alone is ambiguous (ranges resolve differently over time). Drift between manifest and lockfile, merge conflicts in the lockfile, and inconsistent regeneration are real failure modes.

Go modules have *one* selection artefact: `go.mod`, with single floors. MVS makes the build list a pure function of those floors — there is no second solution to pin, so no lockfile and no drift. `go.sum` is orthogonal: it is integrity (content hashes), not selection. The result is a stronger reproducibility guarantee with fewer moving parts: the versions are *in the manifest*, derivable at any commit, with no separate lock to keep in sync.

**Follow-up.** *Is `go.sum` a lockfile?* — No. Deleting it does not change selected versions; it only removes the integrity check. Conflating the two is a category error.

---

### Q21. How would you build tooling to simulate "what would upgrading X do" without mutating the repo?

**Model answer.** Two approaches.

1. **Drive the toolchain in a sandbox.** Copy the module to a temp dir, run `go get x@target` there, diff `go list -m all` before/after. Accurate (uses the real MVS), isolates mutation, but slower.
2. **Link `golang.org/x/mod/mvs`.** Implement a `Reqs` over the module graph (parse `go.mod` files with `x/mod/modfile`, order versions with `x/mod/semver`/`module`), and call `mvs.Upgrade` to compute the hypothetical build list. The toolchain uses this package, so results match — but you must correctly handle pruning, `replace`/`exclude`, and version ordering, which is non-trivial.

For most needs, the sandbox-driven approach is more robust because it inherits pruning and directive handling for free. Reserve linking `x/mod/mvs` for high-volume simulation where spawning `go` per query is too slow.

**Follow-up.** *Why not re-implement the build-list rule yourself?* — The `max` is trivial, but graph pruning, version ordering (pseudo-versions, `+incompatible`), and `replace`/`exclude` are easy to get subtly wrong and drift across Go releases.

---

### Q22. When is MVS the wrong fit, and what do teams do about it?

**Model answer.** MVS optimises reproducibility and fidelity at the cost of currency. It is a poor fit when a team *wants* aggressive auto-updating — e.g. a fast-moving internal ecosystem where "always newest" is the cultural norm. There is no MVS knob for "always upgrade"; the closest is a CI step that runs `go get -u ./...` and commits, which simulates newest-version behaviour at the price of reproducibility on that branch.

Teams reconcile this by separating concerns: MVS gives a stable, reproducible *floor*; a deliberate upgrade cadence (bots, scheduled `-u` PRs) provides currency on top. The discipline is to keep upgrades as reviewed events rather than fighting the algorithm. If a team truly needs range-based "newest-in-range" semantics, Go is simply not that ecosystem — but in practice the reviewed-upgrade model is what most teams want once they understand the reproducibility benefit.

**Follow-up.** *Could you bolt ranges onto Go?* — Not without abandoning the no-lockfile, no-SAT, deterministic guarantees that are the entire point. The single-floor model is load-bearing.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Does MVS pick the newest version? | No — the minimum that satisfies all floors (max of the floors). |
| Is a `require` line a pin? | No — it is a floor (minimum). |
| Does Go need a lockfile? | No — `go.mod` floors + MVS determine the build. |
| Is `go.sum` a lockfile? | No — it is integrity (content hashes). |
| Does a plain `go build` upgrade deps? | No — read-only; only `go get` raises floors. |
| The four operations? | build list, upgrade-one, upgrade-all, downgrade. |
| Which operation is hard? | Downgrade (backward search, propagation). |
| Are `foo` and `foo/v2` the same module? | No — different paths, coexist. |
| Does pruning change selected versions? | No — only the graph scope MVS walks. |
| Are `replace`/`exclude` honoured for dependencies? | No — main module only. |

---

## Mock Interview Pacing

A 30-minute interview on MVS might cover:

- 0–5 min: warm-up — Q1, Q3, Q5.
- 5–15 min: middle mechanics — Q6, Q7, Q8, Q9.
- 15–25 min: a senior design question — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q19 or Q20.

If the candidate claims hands-on Go experience, drive straight to Q2 ("I got a higher version than I asked for") and Q8 (upgrade cascades) — both are field-test questions that separate "read the docs" from "shipped Go." A candidate who cannot explain why a `require` is a floor (Q1) has not internalised MVS regardless of seniority. A staff candidate should reach the MVS-vs-SAT comparison (Q13) and the no-lockfile argument (Q20) without prompting.
