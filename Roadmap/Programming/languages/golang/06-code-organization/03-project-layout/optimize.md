# Project Layout — Optimization

> Honest framing: project layout itself does not slow your program at runtime. What it slows or speeds is *humans and toolchains* — the time spent finding code, the time `go build` spends compiling, the time `gopls` spends indexing, the time CI spends re-running tests, the time reviewers spend untangling imports. Each entry below states the problem, shows a "before" layout, an "after" layout, and the realistic gain.

---

## Optimization 1 — Break up the `util/` god-package

**Problem:** A single `internal/util/` package with 50+ files imported by every other package in the codebase. Every change to `util/` invalidates the build cache for every importer; CI rebuilds dozens of packages for a one-line fix. Worse, `util/` accretes unrelated functions, so changes to "log helpers" force a rebuild of code that only uses "string helpers."

**Before:**
```
internal/
└── util/
    ├── log.go
    ├── time.go
    ├── strings.go
    ├── http.go
    ├── slice.go
    └── ...           (45 more files)
```
A change to `log.go` invalidates the cache for *every* package importing `util`.

**After:**
```
internal/
├── slogutil/         (logging helpers)
├── timeutil/         (time helpers)
├── stringsutil/
├── httputil/
└── sliceutil/
```
A change to `slogutil/` only invalidates the cache for packages importing `slogutil` — usually a small subset.

**Gain:** On a moderate-size project (~150 packages, ~5 of which import `util`), incremental CI builds drop from 60–90 seconds to 10–20 seconds. The dependency graph also becomes readable: `go list -deps ./...` shows clearly which packages need logging vs which need time helpers.

---

## Optimization 2 — Domain layout for a feature-heavy service

**Problem:** A service with 15 features uses technical layout (`handlers/`, `services/`, `repositories/`). Adding one feature touches 4 directories and 6+ files. PRs are scattered; reviewers have to mentally re-assemble the feature. CI cache hit rate is low because changes touch many packages.

**Before:**
```
internal/
├── handlers/         (15 files)
├── services/         (15 files)
├── repositories/     (15 files)
└── models/           (15 files)
```
A feature change: edit `handlers/billing.go`, `services/billing.go`, `repositories/billing.go`, `models/billing.go`. Four packages, four cache invalidations.

**After:**
```
internal/
├── billing/          (handler, service, repository, types — all in one package)
├── user/
├── order/
└── ... (12 more)
```
A feature change: edit one or two files inside `internal/billing/`. One package, one cache invalidation.

**Gain:** Cache hit rate jumps; feature-PR build time drops by 30–50%. PR diffs become readable as "this is the billing feature" instead of "this is changes spanning all four layers." Onboarding to a feature accelerates because the feature *is* a directory.

---

## Optimization 3 — Multi-binary repo with shared `internal/`

**Problem:** A repo ships three binaries (server, worker, CLI) but each has its own duplicated copy of "load config", "set up logging", "open Postgres." Updates to common setup take three PRs, and copy-paste drift accumulates.

**Before:**
```
cmd/
├── server/
│   └── main.go       (200 lines: config + log + DB + HTTP)
├── worker/
│   └── main.go       (200 lines: config + log + DB + Kafka)
└── cli/
    └── main.go       (200 lines: config + log + DB + commands)
```
Three copies of the same setup boilerplate. Any change has to be applied three times.

**After:**
```
cmd/
├── server/main.go    (15 lines: parse flags, call app.RunServer())
├── worker/main.go    (15 lines: parse flags, call app.RunWorker())
└── cli/main.go       (15 lines: parse flags, call app.RunCLI())
internal/
├── app/
│   ├── app.go        (config, log, DB setup — shared)
│   ├── server.go
│   ├── worker.go
│   └── cli.go
```
Each binary's `main.go` is a thin wrapper. Common setup lives once in `internal/app`.

**Gain:** Boilerplate maintenance is constant-time instead of three-times. New binaries cost 15 lines of `main.go` instead of 200. Bug fixes apply uniformly. Container build size for each binary drops slightly (less duplicate code in the binary).

---

## Optimization 4 — Split a fast and slow test suite via build tags

**Problem:** `go test ./...` takes 18 minutes. Most of that is integration tests against a real Postgres and Kafka. Engineers wait for CI; PR throughput suffers.

**Before:**
```go
// internal/store/integration_test.go (no build tag)
func TestAgainstRealPostgres(t *testing.T) {
    // 30 seconds of setup, runs against real DB
}
```
Every PR runs the integration test.

**After:**
```go
//go:build integration

package store_test

func TestAgainstRealPostgres(t *testing.T) { /* ... */ }
```

CI splits:
- **PR pipeline:** `go test ./...` (no tag → fast unit tests only).
- **Nightly pipeline:** `go test -tags integration ./...` (full suite).

Layout-wise, integration tests can also live in their own subtree:

```
internal/
├── store/
│   ├── store.go
│   └── store_test.go              (unit; runs always)
└── integration/
    └── store/
        └── store_integration_test.go   (build tag: integration)
```

**Gain:** PR build time drops from 18 minutes to 3 minutes. Engineers iterate faster; CI cost on PRs drops proportionally. Integration tests still run, just on a schedule.

---

## Optimization 5 — Lift architectural rules from prose to compiler

**Problem:** A `README.md` says "the domain layer must not import the database layer." Two years later, `git log -p internal/domain/` reveals six accidental violations from late-night PRs. The prose rule fails the way prose rules always fail.

**Before:** Prose rule in `README.md`. PR reviewers expected to enforce.

**After:** Convert to compile-time enforcement. Two options:

1. **Layout enforcement.** Move domain into a sub-tree where sibling layers have no path to it:
   ```
   internal/core/
   ├── domain/
   └── internal/
       └── pure/        ← only core/* may import
   ```
   The `pure/` sub-tree is unreachable from `internal/store/`, `internal/http/`, etc.

2. **Linter enforcement.** Configure `golangci-lint` with `depguard`:
   ```yaml
   depguard:
     rules:
       domain-purity:
         files: ["**/internal/domain/**"]
         deny:
           - pkg: "database/sql"
           - pkg: "github.com/jackc/pgx/v5"
   ```
   Run in CI.

3. **Custom analyzer.** Write a tiny `go/analysis.Analyzer` and invoke from a `_test.go` file with `analysistest.Run`.

**Gain:** The rule cannot rot. New violations are rejected at PR-time, not discovered six months later. Engineering time spent on architectural drift drops to near zero.

---

## Optimization 6 — Smaller binary images via per-binary build

**Problem:** A monorepo's Dockerfile copies the entire source tree and runs `go build ./...`, producing a single multi-binary image with all binaries packed in. Each container ships every binary even if it only runs one. Pull time, disk usage, and attack surface all suffer.

**Before:**
```dockerfile
FROM golang:1.22 AS build
COPY . .
RUN go build -o /out/ ./cmd/...     # builds everything
FROM gcr.io/distroless/static
COPY --from=build /out/ /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/server"]
```
Container is 80 MB. Three binaries baked in. The worker container also has the CLI baked in even though it never runs it.

**After:**
```dockerfile
FROM golang:1.22 AS build
COPY . .
ARG TARGET=server
RUN go build -o /out/app ./cmd/${TARGET}

FROM gcr.io/distroless/static
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```
Build args produce per-binary images. The server container has only the server, etc.

**Gain:** Each container drops from 80 MB to 25–35 MB. Pulls in Kubernetes are faster; pod cold-start improves. Attack surface narrows (the worker pod cannot be tricked into running the CLI's debug subcommand). CI builds in parallel: `docker build --build-arg TARGET=server`, `--build-arg TARGET=worker`, `--build-arg TARGET=cli` — three concurrent jobs.

---

## Optimization 7 — Workspace mode for cross-module local refactors

**Problem:** A multi-module monorepo. A refactor in `shared/` requires releasing a new tag, then bumping every consuming module's `go.mod`, then merging. A single change becomes 4 PRs over 2 days.

**Before:**
```
acme/
├── shared/  (module github.com/acme/shared, tagged v1.4.2)
├── service-a/ (requires shared v1.4.2)
└── service-b/ (requires shared v1.4.2)
```
Refactor `shared/`: tag v1.4.3, update service-a's `go.mod` to require v1.4.3, update service-b's, merge in sequence.

**After:**
```
acme/
├── go.work
│   use ./shared
│   use ./service-a
│   use ./service-b
├── shared/
├── service-a/
└── service-b/
```
The workspace overrides the `require` versions for local work. Edit `shared/` and `service-a/` together in one PR; the workspace makes them see each other immediately.

**Gain:** A cross-module refactor goes from 4 PRs over 2 days to 1 PR over 1 hour. Once merged, tag `shared/` once and bump consumers in one follow-up PR for production builds. The workspace stays for the next refactor.

**Caveat:** CI must still build each module independently (with `GOWORK=off` or by `cd`ing into the module), so production builds use real `go.mod` requires.

---

## Optimization 8 — Use `_legacy/` to retire code without deleting it

**Problem:** A team wants to remove a deprecated subsystem but is afraid of breaking something. They keep it around with `// DEPRECATED` comments. Engineers still import it accidentally; reviewers miss the comments.

**Before:**
```
internal/
├── newauth/
└── oldauth/        (deprecated; still imported by 3 places)
```
`go build ./...` compiles `oldauth/`. Imports are still allowed.

**After:**
```
internal/
├── newauth/
└── _oldauth/       (leading underscore — invisible to package discovery)
```
The toolchain ignores `_oldauth/` for `go build` and `go list`. Existing imports of `internal/oldauth` now fail to resolve, forcing the migration.

**Gain:** The leading-underscore rename is a one-line `git mv`, but it converts "soft deprecation" (a warning comment) into "hard removal" (compile error). Engineers fix every importer in one PR, then the directory can be deleted entirely on a follow-up. The intermediate state is debuggable: the source is right there if rollback is needed.

---

## Optimization 9 — `gopls` performance via per-module workspace

**Problem:** A 5,000-package monolithic module. `gopls` takes 90 seconds to index on editor open. Goto-definition is sluggish. Renaming a symbol can lock the editor for tens of seconds.

**Before:** One huge module. `gopls` indexes the whole graph on open.

**After:** Split into modules along team boundaries. Use `go.work` for development:

```
acme/
├── go.work
├── billing/      (module — 800 packages)
├── user/         (module — 600 packages)
├── orders/       (module — 700 packages)
└── shared/       (module — 200 packages)
```

`gopls` indexes each module independently. When you open a file in `billing/`, `gopls` loads `billing/` plus its module dependencies; `user/` and `orders/` are not loaded unless you open files in them.

**Gain:** Initial indexing per-module drops from 90 s to 10–20 s. Cross-module goto-def still works through the workspace, but only loads what is needed. Memory usage drops proportionally. Editor responsiveness improves dramatically.

**Caveat:** This is a multi-month refactor for a real codebase. Plan it as a year-long project, not a sprint task.

---

## Optimization 10 — Cluster generated code under one path

**Problem:** Generated Protobuf and OpenAPI stubs are scattered: `internal/billing/proto/`, `internal/user/proto/`, `internal/orders/openapi/`. Every team manages its own generation. Drift in version, options, and import paths is constant.

**Before:**
```
internal/billing/proto/...     (generated; team A's protoc)
internal/user/proto/...        (generated; team B's protoc — different version!)
internal/orders/openapi/...    (generated; older openapi-generator)
```

**After:**
```
api/
├── proto/billing/v1/billing.proto
├── proto/user/v1/user.proto
└── openapi/orders.yaml
internal/
└── api/
    ├── proto/billing/v1/...    (all generated by one Makefile target)
    ├── proto/user/v1/...
    └── openapi/orders/...
```
A single `Makefile` (or `go generate ./...`) regenerates everything from the contracts. One toolchain version, one set of options, one import-path convention.

**Gain:** Generated code is consistent across teams. Adding a new contract is a Makefile entry, not a per-team setup. Bumping the codegen version is one PR. Version drift between teams disappears. CI can verify "generated code is up to date" with a single `git diff --exit-code` after running the generators.

---

## Optimization 11 — Promote a hot package out of `util/`

**Problem:** Even after splitting `util/` (Optimization 1), one of the new packages — say `httputil` — turns out to be a hub: it is imported by 30 packages and changes weekly. Every change still triggers a 30-package recompile.

**Before:** `internal/httputil/` with 12 files, used everywhere.

**After:** Split `httputil/` further by *change cadence*, not just by topic:

```
internal/
├── httputil/         (stable: header helpers, status helpers)
├── httpclient/       (changes often: client config, retries)
└── httpmiddleware/   (changes often: tracing, logging middleware)
```

Stable functions live in one package; volatile functions in another. Importers of stable helpers do not pay for changes to volatile middleware.

**Gain:** The recompile cost per change drops because each focused package has a smaller importer set. The conceptual coherence also improves: "where do I put a new HTTP retry strategy?" has an obvious answer (`httpclient/`).

---

## Optimization 12 — Avoid re-running unaffected tests

**Problem:** Every PR runs `go test ./...` for the entire monorepo. Test runs take 12 minutes even for one-line README changes. CI cost is high; engineers wait.

**Before:** `go test ./...` — flat, runs everything.

**After:** Use `git diff` plus `go list` to compute the affected package set:

```bash
# pseudocode for the CI script
CHANGED_PACKAGES=$(git diff --name-only origin/main HEAD | \
    xargs -I {} dirname {} | sort -u | \
    xargs -I {} go list ./{} 2>/dev/null)

AFFECTED=$(go list -f '{{.ImportPath}} {{.Deps}}' ./... | \
    awk -v changed="$CHANGED_PACKAGES" '
        ... select packages whose Deps include any changed package ...')

go test $AFFECTED
```

Tools like `gazelle` (for Bazel projects) and `tilt` (for development) automate this.

**Gain:** PR test time drops from 12 minutes to 2–4 minutes for typical single-feature PRs. Layout-as-design pays off: when a PR touches `internal/billing/` only, only `internal/billing/` and its consumers run tests.

**Caveat:** "Affected" computation has edge cases (build tags, generated code, integration tests). Start conservative; iterate.

---

## Optimization 13 — Replace deeply nested `internal/` with a separate module

**Problem:** A subtree under `internal/billing/` has grown to 80 packages with nested `internal/` layers four levels deep. The `internal/` rule is blocking refactors that the team wants. Editor performance is bad in this subtree.

**Before:**
```
internal/billing/
├── internal/
│   ├── core/
│   │   └── internal/
│   │       └── ...
│   └── ...
└── ...
```

**After:** Promote `billing/` to its own module:

```
acme/
├── go.work
├── billing/
│   ├── go.mod              (module github.com/acme/billing)
│   ├── cmd/
│   ├── internal/           (now relative to billing/, not the parent)
│   └── pkg/                (billing's public surface)
└── ... (other modules)
```

Now `billing/internal/` is internal to the billing *module*, not the parent. Refactors are local. Editor indexes the billing module independently.

**Gain:** Refactor velocity in the billing area roughly doubles. `gopls` for files in `billing/` indexes 10x faster. The team gains independent CI, lint configs, and Go-version cadence. The cost is a one-time module split (significant) and ongoing workspace management (small).

---

## Optimization 14 — Precompute the import graph to detect drift

**Problem:** The architecture document says the import graph should be a DAG with five layers. Reality drifts; reviewers miss subtle violations. By the time anyone notices, dozens of bad edges exist.

**Before:** Architecture diagram in `docs/`. Hope.

**After:** A pre-commit or CI step that:
1. Generates the current import graph (`go list -deps ./...`).
2. Compares against an allow-list of edges (or a deny-list of forbidden patterns).
3. Fails the build on new bad edges.

```bash
# Example: forbid internal/domain/ from importing anything outside stdlib + internal/domain
go list -f '{{.ImportPath}}: {{join .Imports " "}}' ./internal/domain/... | \
    awk '
        $0 ~ /[^domain]/ { ... fail ... }
    '
```

Tools that automate this: `goda`, `arch-go`, custom `go/analysis` analyzers.

**Gain:** Architecture stays alive. New bad edges are rejected at PR-time. Engineering time on "fixing the graph" goes to zero (because nothing breaks it). The diagram becomes a living artifact, regenerable from source.

---

## Wrap-up

Layout optimization is rarely about runtime performance and almost always about *human and toolchain throughput*: faster builds, faster tests, faster CI, faster onboarding, fewer regressions, easier refactors. Every optimization above pays back over months, not minutes — but they compound. A team that invests in layout discipline ships features faster a year later because the codebase has not turned into a tar pit.

The single highest-leverage change for most projects: break up the `util/` package and replace it with focused, named packages. Do this first if you do nothing else.
