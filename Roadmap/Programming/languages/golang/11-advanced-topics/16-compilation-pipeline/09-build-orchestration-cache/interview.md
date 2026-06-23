# Build Orchestration & Cache — Interview

Around 20 questions on how the `go` command orchestrates the compiler/linker and
caches results. Answers are concise; expand with the linked tiers.

## Action graph & orchestration

**Q1. Is `go build` a compiler?**
No. It's a *driver*/orchestrator. It resolves dependencies, builds an action
graph, and shells out to the real tools: `compile` (gc), `asm`, `pack`, and
`link`, found under `$GOROOT/pkg/tool/<os>_<arch>/`.

**Q2. What is the action graph?**
A DAG of `Action`s built by `cmd/go/internal/work`. Each action has a `Mode`
(`build`, `link`, `vet`, …), a package, dependency actions (`Deps`), a scratch
`Objdir`, and a `Target`. A `Builder` runs an action once all its `Deps` are
done. It's acyclic because Go forbids import cycles.

**Q3. How do you see the action graph?**
`go build -debug-actiongraph=ag.json .` writes the DAG as JSON with per-node
`Deps`, `BuildID`, and `TimeReady`/`TimeStart`/`TimeDone` timestamps — useful for
finding the critical path.

**Q4. In what order are packages compiled, and how parallel is it?**
Dependency order: a package compiles only after everything it imports. The
`Builder` runs independent actions concurrently, capped by `-p` (default
`GOMAXPROCS(0)` ≈ NumCPU). The leaves are wide/parallel; the final `link` is a
single serial action.

**Q5. What's the per-package tool sequence?**
Optionally `asm` (if `.s` files), then `compile` producing `_pkg_.a`, optionally
`pack` to add extra `.o` objects, then `go tool buildid -w`. The `main` package
additionally gets a `link` action. `importcfg`/`importcfg.link` tell the
compiler/linker where each dependency's archive lives.

**Q6. What do `-x` and `-work` do?**
`-x` prints every command the `go` tool runs (including `WORK=` and the
`compile`/`link` invocations). `-work` prints the `$WORK` temp dir and **keeps**
it instead of deleting it, so you can inspect the intermediate files.

## The content-addressed cache

**Q7. Where is the build cache and how is it organized?**
In `GOCACHE` (`go env GOCACHE`), a per-user directory shared across projects.
It's **content-addressed**: entries are keyed by an **action ID** (hash of
inputs); outputs are stored addressed by a **content ID** (hash of output bytes),
so identical outputs are de-duplicated.

**Q8. What goes into a compile action's cache key (action ID)?**
The source/asm file contents, the import path, the **action IDs of the
dependencies**, the compiler binary hash (toolchain version), the
compiler-affecting flags (`-gcflags`, `-tags`, `-trimpath`, `-race`, …), and the
target `GOOS`/`GOARCH`/build mode (plus cgo env for cgo packages).

**Q9. Why include dependencies' action IDs instead of their source?**
It makes the key transitive and cheap: a change in a leaf package changes its
action ID, which changes the ID of every importer automatically, propagating up
the DAG exactly like staleness should — without re-reading their source.

**Q10. How does Go decide a package is stale?**
A package is stale iff its computed action ID is **not present** in `GOCACHE`.
Modern Go (since 1.10) uses content hashes, **not** timestamps — `touch`ing a
file does not trigger a rebuild.

**Q11. Why is the first build slow and the second instant?**
The first build computes and stores every action's output (often including the
std lib). The second recomputes the same action IDs, finds them in the cache, and
copies the stored outputs instead of recompiling.

**Q12. What does `go build -a` do, and why avoid it in CI?**
It forces a rebuild of **all** packages this run, including the standard library,
ignoring the cache. It's a one-off diagnostic; in CI it makes every build cold
and slow.

**Q13. How do you inspect what's in a cache key?**
`GODEBUG=gocachehash=1 go build .` prints each input mixed into the action IDs.
`go tool buildid FILE` prints an archive's `actionID/contentID`.

## Test caching

**Q14. What does `go test` cache?**
Successful test **results**, replayed as `(cached)`. The key is the test binary's
action ID plus the cacheable command-line flags plus the files/env vars the test
observed at runtime.

**Q15. Which test flags are cacheable, and what disables caching?**
A safe subset (`-run`, `-count`, `-cpu`, `-short`, `-timeout`, `-parallel`,
`-failfast`, `-v`, `-tags`, …) is cacheable. Output-producing flags like
`-coverprofile`, `-cpuprofile`, `-o`, or any flag outside the subset disable
caching for that run. A failing test is never cached.

**Q16. How do you force a test to re-run?**
`go test -count=1 ./...` (idiomatic) or `go clean -testcache`. Trace decisions
with `GODEBUG=gocachetest=1`.

## Flags & scoping

**Q17. Explain `-gcflags` scoping and the `all=` pattern.**
A bare `-gcflags='...'` applies only to packages named on the command line —
**not** dependencies or the std lib. `-gcflags='all=...'` applies to every
package; `-gcflags='pattern=...'` targets a specific package pattern. The same
`[pattern=]` rule applies to `-asmflags` and `-ldflags`.

**Q18. What is `GOFLAGS` for?**
Flags injected into every `go` invocation (e.g. `GOFLAGS='-trimpath -mod=readonly'`).
Handy for enforcing reproducible/locked builds across a team or CI.

## Reproducibility & CI

**Q19. How do you make builds reproducible?**
Pin the toolchain (`go`/`toolchain` lines in `go.mod`), build with `-trimpath`
(removes absolute paths so outputs and action IDs are machine-independent),
ideally `CGO_ENABLED=0`, and for byte-for-byte audits `-ldflags='-buildid='`.
Same source + toolchain + flags ⇒ identical bytes.

**Q20. How do you make CI builds fast, and why does cgo complicate the cache?**
Persist `GOCACHE` **and** `GOMODCACHE` across runs (key on `go.sum` + toolchain,
with `restore-keys`); build only shipped targets; avoid cache busters. cgo
complicates caching because the cache hashes the package's Go/C/H files but
**not** external system C libraries, so upgrading a system lib won't invalidate
the cache (`go clean -cache` or `-a` needed). For shared/remote caches, use
`GOCACHEPROG` and keep `-trimpath` so action IDs match across machines.

## Further reading

- `go help build`, `go help cache`, `go help test`, `go help testflag`, `go help environment`
- `cmd/go/internal/work` & `cmd/go/internal/cache`: <https://cs.opensource.google/go/go/+/refs/tags/go1.25.3:src/cmd/go/internal/>
- Build & test caching: <https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching>
