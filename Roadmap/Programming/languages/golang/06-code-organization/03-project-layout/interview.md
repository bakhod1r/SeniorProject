# Project Layout — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What folders do you typically see at the root of a Go project?

**Model answer.** The most common are:
- `cmd/<binary>/main.go` — one folder per binary the repo produces.
- `internal/` — packages private to this module (toolchain-enforced).
- `pkg/` — optional public packages (convention only, no enforcement).
- `api/` — API specs (OpenAPI, Protobuf).
- `configs/`, `scripts/`, `docs/` — supporting artifacts.

For a small project, none of these are required. A flat `main.go + go.mod` is a perfectly valid layout.

**Common wrong answers.**
- "You always need `cmd/`." — No, only when you have multiple binaries.
- "`pkg/` is required for public packages." — `pkg/` is convention; the toolchain treats it like any other folder.

**Follow-up.** *Which two folder names does the toolchain actually treat specially?* — `internal/` and `vendor/`.

---

### Q2. Why does Go have an `internal/` directory?

**Model answer.** `internal/` is enforced by `go build`: a package whose import path contains the segment `internal` can only be imported by code rooted at the parent of that `internal` segment. It exists to let module authors expose a deliberate public API while keeping implementation details unreachable to outside consumers.

**Follow-up.** *What error do you get if you try to import a package's `internal/` from outside?* — `package <path> is not allowed`.

---

### Q3. Where does `main.go` go?

**Model answer.** For a single-binary project, at the module root. For a multi-binary project, at `cmd/<binary-name>/main.go` — one folder per binary, each with its own `main.go` that defines `package main`.

**Common wrong answer.** "Always under `cmd/`." — Premature for a single binary.

**Follow-up.** *Can two `main` packages live in the same directory?* — No. One `main` per directory; one `func main()` per package.

---

### Q4. Where do test files go?

**Model answer.** Right next to the code they test, in the same directory, with `_test.go` suffix. Tests can be in the same package (white-box) or `package_test` (black-box). There is never a separate `tests/` folder in idiomatic Go.

**Follow-up.** *What about test fixtures?* — A `testdata/` subdirectory. The toolchain ignores it for package discovery, so it can hold any kind of file.

---

### Q5. What does the import path look like for a package inside your project?

**Model answer.** It is the module path (from `go.mod`) plus the directory path relative to the module root. So if `go.mod` says `module example.com/myapp`, then the package at `internal/store/` has the import path `example.com/myapp/internal/store`.

**Follow-up.** *What if I rename the module?* — Every internal import that uses the old prefix must be rewritten. Tools like `gopls` automate this.

---

### Q6. What happens if I put `_old.go` in my package?

**Model answer.** Files starting with `_` (or `.`) are skipped by `go build`. Same for directories. This is useful for parking code without compiling it. `_old/main.go` is invisible to `go build ./...`.

**Follow-up.** *What about `testdata/`?* — Also skipped. Three exclusions: leading underscore, leading dot, exactly `testdata`.

---

## Middle

### Q7. When should I introduce `internal/` to a project?

**Model answer.** Three concrete triggers:
1. Your repo's `go.mod` path is one outside consumers might `go get`. You want to control your public surface.
2. Your repo lives in a workspace (`go.work`) with sibling modules and you want to prevent them from importing your internals.
3. You have multi-team subtrees and want to enforce team isolation via nested `internal/` folders.

For a small CLI tool with no external consumers, `internal/` adds noise without benefit.

**Follow-up.** *Can `internal/` appear at any depth?* — Yes. It is always relative to its parent. `internal/foo/internal/bar` is reachable only by `internal/foo/*`.

---

### Q8. What is the case for and against `pkg/`?

**Model answer.**
- **For:** It clearly delineates public packages from binaries (`cmd/`) and private code (`internal/`). Useful when a repo also contains non-Go content (a Python sub-tree, a frontend) — `pkg/` says "the Go module's library code lives here."
- **Against:** In a Go-only repo, `pkg/` is redundant — anything not under `internal/` is already public. It adds a directory level to every import path (`example.com/foo/pkg/bar` instead of `example.com/foo/bar`) for no compiler benefit. The Go standard library does not use `pkg/`.

The right choice is team-and-context dependent. Both are defensible.

**Follow-up.** *What does the Go team think?* — They have explicitly distanced themselves from `golang-standards/project-layout`. The standard library does not use `pkg/`, which is the closest thing to an official position.

---

### Q9. Domain layout vs technical layout — which do you prefer?

**Model answer.** Domain layout (group by feature: `internal/billing/`, `internal/user/`) scales better than technical layout (group by role: `internal/handlers/`, `internal/services/`) once the project has more than ~10 features. Technical layout fragments every feature change across multiple folders; domain layout localizes change.

For very small projects (≤ 5 endpoints), technical layout is fine — three layers stay readable.

**Common wrong answers.**
- "Technical layout is more 'enterprise.'" — It is also more painful.
- "Domain layout is just MVC with extra steps." — No. Domain layout puts the *feature* first; MVC puts the *layer* first.

**Follow-up.** *What about hybrid layouts?* — Common and practical. `internal/domain/` for types, `internal/store/`, `internal/http/`, `internal/app/` for layers, with files inside named per feature. Most mature services land here.

---

### Q10. How do you avoid import cycles between sibling packages?

**Model answer.** Three strategies:
1. **Extract shared types** to a third package both depend on (`internal/domain/`).
2. **Define interfaces in the consumer.** Caller declares what it needs; provider satisfies the interface implicitly. The provider package no longer needs to be imported by the consumer.
3. **Merge the two packages** if they are inherently coupled.

If you find yourself with `billing → user → billing` cycles, the shape of the layout is wrong; rethink the boundary.

**Follow-up.** *Why does Go forbid import cycles in the first place?* — To keep compilation fast and dependencies analyzable. A cycle would force every package in the cycle to recompile when any one changes.

---

### Q11. You have a multi-binary monorepo. How do binaries share code?

**Model answer.** Through `internal/` packages at a level visible to all of them.

```
myrepo/
├── cmd/
│   ├── server/main.go
│   ├── worker/main.go
│   └── cli/main.go
└── internal/
    ├── app/
    └── store/
```

Each binary's `main.go` imports `internal/app`, `internal/store`, etc. Binaries never import each other.

**Common wrong answer.** "One `main.go` with a flag that selects which binary." — That ships one big binary, not three small ones, and conflates the layouts.

**Follow-up.** *What if a piece of code is binary-specific?* — Put it under `cmd/<bin>/internal/`. Then it is invisible to other binaries.

---

### Q12. What is the difference between `go.mod` and `go.work`?

**Model answer.** `go.mod` defines a module — its path, its Go version, its dependencies. `go.work` defines a *workspace* — a development-time view that combines multiple local modules. In workspace mode, imports across the listed modules use on-disk source instead of cached versions.

`go.mod` is always committed. `go.work` is committed selectively — for development convenience but never to drive production builds.

**Follow-up.** *Why is workspace mode mutually exclusive with vendor mode?* — Vendor mode locks the build to `vendor/` content; workspace mode dynamically resolves to local modules. The two answer the same question ("where does this module's source come from?") incompatibly.

---

### Q13. A teammate puts a `util/` package under `internal/`. What is your reaction?

**Model answer.** Push back. `util/` becomes a dumping ground: anything that does not fit elsewhere accumulates there. Six months in, it has 40 files and contradictory APIs, and it is imported by 50 other packages — making every change to it a 50-package recompile.

The right move is to ask: what are these helpers actually about? Promote them into focused packages with descriptive names (`slogutil`, `timeutil`, `httputil`) or merge them back into the package that needs them.

**Follow-up.** *What if they say "but we only have three helper functions"?* — Three functions usually live fine in the importer. Only extract when two or more importers share the helper, and even then, name the package by what it does.

---

## Senior

### Q14. How would you enforce "the domain layer must not import the database layer"?

**Model answer.** Three layers of enforcement:
1. **Layout.** Put the domain in `internal/domain/`, the database in `internal/store/`. Direct imports are technically allowed but visible at review time.
2. **Linter.** Configure `golangci-lint`'s `depguard` to reject imports of `internal/store` from any file under `internal/domain/`. Run the linter in CI.
3. **Custom analyzer.** Write a small `go/analysis.Analyzer` that walks the AST of every file in `internal/domain/` and fails the test if any import path matches `*/store`. Run the analyzer as a unit test.

The first is documentation; the second is best-effort; the third is unbreakable.

**Follow-up.** *Could you use nested `internal/` to enforce this?* — Partially. If `domain/` is nested deeply enough, you can prevent the *database from importing the domain*, but you cannot use `internal/` to prevent the reverse direction (which is what you want). The compiler enforces *cycles*, not *direction*.

---

### Q15. A monorepo's `go test ./...` takes 25 minutes. How does layout help?

**Model answer.** Layout lets you partition tests:
1. **Group fast tests away from slow ones.** Pure-domain packages (`internal/domain/`) typically have unit tests under 100 ms. Integration packages (`internal/integration/`) take seconds. Run them in different CI jobs.
2. **Use build tags.** `//go:build integration` lets you run unit tests on every PR and integration tests on a schedule.
3. **Cache by package.** Go's test cache is per-package; tests rerun only if a package's inputs changed. Smaller, focused packages mean fewer reruns.
4. **Multi-module.** Split into modules; each module's CI runs only its own tests.

Combined, these can reduce a 25-minute run to 3–5 minutes for the on-PR path, with the long-running integration suite scheduled.

---

### Q16. When would you split a single-module monorepo into multi-module?

**Model answer.** Three triggers:
1. **Different release cadences.** One sub-team wants to ship daily; another monthly. A shared `go.mod` forces them onto the same Go version and dependency upgrades.
2. **Independent versioning.** A library inside the monorepo needs to be published with its own SemVer history.
3. **Editor performance.** `gopls` indexes the whole module on open. A 5,000-package module makes editor responsiveness sluggish; splitting into modules lets `gopls` work per-module.

Split *for a reason*, not for symmetry. Many large Go organizations live happily on a single-module monorepo with strict `internal/` discipline.

**Follow-up.** *What's the cost?* — More complex CI (each module is a separate build target), more `go.mod` files to keep in sync, and a `go.work` to manage.

---

### Q17. `go.work` should never be committed — true or false?

**Model answer.** False, but with caveats. Many projects commit `go.work` to give every developer a consistent workspace setup. The constraint is that *production builds must not honour it*. CI must build each module from its own directory with `GOWORK=off` or by `cd`ing into the module first. If both hold, committing `go.work` is fine and helpful.

**Common wrong answer.** "Always `.gitignore` it." — That works but creates an onboarding burden (every dev recreates the same file). Documenting the trade-off is more useful than blanket rules.

---

### Q18. Walk me through introducing `internal/` to an existing project.

**Model answer.** Steps:
1. **Inventory current public packages.** Run `go list ./...`. Anything not under `internal/` is currently public.
2. **Decide which packages should be private.** Anything that is not part of your module's intentional public API. In doubt, mark private — it is reversible.
3. **Move them.** `git mv pkg/foo internal/foo` (or just `git mv foo internal/foo` if there is no `pkg/`).
4. **Update imports.** `gopls rename` does this automatically; otherwise, `find . -name '*.go' -exec sed -i ...` plus a careful review.
5. **Verify.** `go build ./...`, `go vet ./...`, `go test ./...`.
6. **Communicate.** If the package was already public, this is a breaking change. Bump major version.

**Follow-up.** *What if a downstream consumer is depending on the old path?* — They cannot keep using it. The `internal/` rule is enforced. Either undo the move, or own the breaking change and tag v2.

---

### Q19. Critique the `golang-standards/project-layout` template.

**Model answer.** It is a community template with two strengths and several weaknesses.

Strengths: it surveys what real Go projects use, gives names to common patterns (`cmd/`, `internal/`, `api/`), and provides a starting point for newcomers.

Weaknesses:
- **Not endorsed by the Go team.** Russ Cox and other maintainers have publicly distanced themselves from it.
- **Over-engineering bias.** It lists 20+ folders. Most projects need 4–6.
- **Conflates source and infra.** `deployments/`, `init/`, `build/` are arguably outside the Go module entirely; CI/CD configs are not source code.
- **`pkg/` debate baked in.** It treats `pkg/` as standard, which is contested.

Use it as a menu of options, not a rule. Pick what matches your actual artifacts and skip the rest.

---

### Q20. Two services in a monorepo need to share a Postgres connection-pool helper. Where does it go?

**Model answer.** Depends on shape:
- **Shared in one module:** `internal/dbutil/` (or named for what it does, like `internal/pgpool/`). Both services' `cmd/<svc>/main.go` import it.
- **Shared across modules in a multi-module monorepo:** Either a workspace-level shared module (`shared/dbutil/` with its own `go.mod`), or duplicated per service if duplication is cheap.
- **Reusable beyond the monorepo:** Promote to a separate module, version it, publish it. Not worth doing until at least three independent consumers exist.

**Common wrong answer.** "Make it `pkg/dbutil`." — That makes it public. Unless you intend to support outside consumers, prefer `internal/`.

---

### Q21. How do you handle generated code (Protobuf stubs, OpenAPI clients) in your layout?

**Model answer.** The contract (`.proto`, `openapi.yaml`) lives in `api/`. Generated Go code lives under `internal/api/...` so it is not exposed to outside importers. The generation is a `go generate` directive or a Makefile target; the generated files are committed.

```
api/
└── proto/billing/v1/billing.proto
internal/
└── api/
    └── proto/
        └── billing/v1/    ← generated; committed
```

Why under `internal/`? Generated code reflects today's contract; if a consumer pinned to it directly, you would be unable to regenerate without breaking them. Force consumers to depend on a stable wrapper instead.

**Follow-up.** *What if you want to publish a Go client?* — Build a hand-written `pkg/client/` package that wraps the generated stubs. The client is the stable surface.

---

### Q22. You inherited a project with `internal/util/` containing 60 files. How do you refactor?

**Model answer.** Step by step:
1. **`go list -deps internal/util`.** What does it import? What imports it?
2. **Cluster the files** by what they actually do. Logging helpers, time helpers, HTTP helpers, slice helpers — usually four or five clusters.
3. **Promote each cluster** to a focused package: `internal/slogutil/`, `internal/timeutil/`, etc.
4. **Move incrementally.** One cluster per PR. After each move, `go build ./... && go test ./...`.
5. **Watch for circular dependencies.** A cluster that depends on another cluster needs to be moved second.
6. **Delete `internal/util/`** when empty.

The whole refactor takes weeks for a real codebase. Done correctly, every commit is independently mergeable; the codebase is healthier at every step.

---

## Staff

### Q23. Design the layout for a 50-engineer organization shipping 12 microservices in Go.

**Model answer.** A multi-module monorepo:

```
acme/
├── go.work
├── shared/
│   ├── go.mod                    ← shared types, utilities
│   ├── domain/                   ← cross-team domain types
│   └── pkg/                      ← public-facing utilities (logging, tracing)
├── platform/
│   └── go.mod                    ← internal platform code (auth, audit, feature flags)
├── services/
│   ├── billing/
│   │   ├── go.mod
│   │   ├── cmd/billing/
│   │   └── internal/
│   ├── user/
│   │   ├── go.mod
│   │   └── ...
│   └── ... (10 more)
└── tools/
    └── go.mod                    ← code generators, linters
```

Key decisions:
- One `go.work` for local development; CI builds each module independently.
- `shared/` and `platform/` are explicit modules, versioned with SemVer.
- Each service is its own module, owned by one team, with its own `internal/`.
- CODEOWNERS aligned with the tree: `services/billing/` → billing team.
- Architecture lint (depguard) enforces cross-module rules: services can import `shared/`, `platform/`, but not each other.

The layout is the operating model. Team boundaries, release cadences, and CI scopes all flow from it.

---

### Q24. Defend or attack: "Every Go project should follow the same layout for consistency."

**Model answer.** I would attack the claim. Two reasons:
1. **Project size matters.** A 200-line tool does not need the same layout as a 200,000-line platform. Forcing them into the same template wastes the small one's energy on directory-fluff and starves the large one of the structure it actually needs.
2. **Team context matters.** A multi-team service with `internal/billing/internal/` makes no sense for a solo library author with five public functions. Layout is a tool for managing complexity; complexity is contextual.

What *should* be consistent across a single organization is:
- The *vocabulary* (what `cmd/`, `internal/`, `pkg/` mean).
- The *minimum hygiene* (no `util/`, tests next to code, `internal/` for private packages).
- The *enforcement mechanisms* (depguard configs, CI lint rules).

Beyond that, let teams choose layouts that fit their work.

---

### Q25. How does Go's project-layout philosophy compare to other languages?

**Model answer.**

| Language | Layout style | Trade-off |
|----------|--------------|-----------|
| Go | Disk = import graph, two enforced folders (`internal/`, `vendor/`) | Minimal, predictable, mechanical |
| Java | Build manifest (`pom.xml`, `build.gradle`) drives layout, package = directory chain matching `groupId.artifactId` | Verbose but flexible; layout independent of import rules |
| Rust | `src/main.rs` or `src/lib.rs`; modules declared via `mod foo`; `Cargo.toml` is the manifest | Explicit module declarations; less tied to filesystem |
| Python | Package = directory with `__init__.py` (3.3+ implicit); layout largely free; `setup.py`/`pyproject.toml` declares public surface | Flexible, prone to "src layout" debates |
| TypeScript | No enforced layout; `tsconfig.json` paths and bundler config decide imports | Maximum flexibility, maximum drift |

Go's approach is the most opinionated of the mainstream ecosystems: the directory tree *is* the import graph, with two compiler-enforced rules and minimal manifest. The trade-off: less flexibility, more predictability.

---

## Final tips

- The right layout is the smallest one that supports your actual artifacts. Resist decoration.
- `internal/` is the only enforcement Go gives you for free. Use it.
- Layout choices are reversible but not free. Each refactor costs review time and bug risk; design with the next refactor in mind, not against it.
- Read other people's layouts. The fastest way to develop layout intuition is to clone five popular Go projects and study their trees.
- Follow conventions in established codebases; pick deliberately in new ones; document your choice somewhere short and findable.
