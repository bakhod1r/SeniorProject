# Package Import Rules — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is the difference between an import path and a package name?

**Model answer.** The *import path* is the string in quotes after the `import` keyword — it identifies a directory, e.g. `"github.com/alice/lib/json"`. The *package name* is the identifier declared at the top of every `.go` file in that directory, e.g. `package json`. The compiler uses the import path to *find* the directory, and the package name to *refer* to symbols inside the importing file.

By convention they match (folder `json/` contains `package json`), but they need not. A folder named `json-utils/` may declare `package json` and be imported as `"github.com/alice/lib/json-utils"`, then referenced as `json.Marshal`.

**Common wrong answers.**
- "They must always match." (No — convention, not requirement.)
- "The import path is the package name with a URL prefix." (No — it identifies a directory.)
- "Both are derived from the file name." (No — file names are irrelevant to imports.)

**Follow-up.** *If the package name does not match the folder, what does `goimports` do?* — It inserts an explicit alias at the import site so the symbol references compile.

---

### Q2. What is a blank import (`_ "path"`) and when do you use one?

**Model answer.** A blank import imports a package solely for its side effects — typically the running of its `init()` functions — without binding any of its exported symbols into the importing file's namespace. Common uses:

- Database drivers: `_ "github.com/lib/pq"` registers the driver with `database/sql`.
- Image format decoders: `_ "image/png"` registers PNG with `image.Decode`.
- Profiling: `_ "net/http/pprof"` adds `/debug/pprof/` handlers to `http.DefaultServeMux`.

Without the blank, the unused import would be a compile error.

**Follow-up.** *Why is an unused import an error in Go but a warning in C?* — Go enforces minimal, intentional dependencies; an unused import suggests dead code or a refactor mistake.

---

### Q3. What is a dot import (`. "path"`) and why is it usually discouraged?

**Model answer.** A dot import places every exported symbol of the imported package into the current file's namespace, so you can write `Marshal(...)` instead of `json.Marshal(...)`. It is discouraged because:

- It hides where each symbol came from, hurting readability.
- It can collide with local identifiers, producing confusing errors.
- It defeats `goimports` and IDE go-to-definition heuristics.

The canonical legitimate use is inside test files, particularly with Ginkgo or other DSL-style test libraries that read like English when their verbs are unqualified.

**Follow-up.** *Why is a dot import in production code a code smell?* — It signals the author wanted to avoid typing a prefix, at the cost of every future reader having to guess.

---

### Q4. How do I import a sub-package of my own module?

**Model answer.** Use the full import path: `<module-path>/<sub-folder>`. If `go.mod` declares `module github.com/alice/app` and you have a folder `internal/auth/`, the import is `"github.com/alice/app/internal/auth"`. Relative imports (`"./auth"`) are not allowed in modules-mode.

**Follow-up.** *What if I rename my module path?* — Every internal sub-package import must be updated to the new prefix. A find-and-replace across the repo is typical.

---

### Q5. What does the `internal/` folder do?

**Model answer.** Any package whose import path contains an `internal/` segment can only be imported by packages rooted at the parent of that `internal/`. So `github.com/alice/app/internal/secret` can be imported by `github.com/alice/app/...` but not by `github.com/bob/other`.

It is the toolchain-enforced way to mark code as "private to this module/sub-tree".

**Common wrong answers.**
- "It is just a naming convention." (No — the compiler enforces it.)
- "Anything under `internal/` is unexported." (No — exporting and visibility are different axes.)

**Follow-up.** *Where does the boundary sit if I have `a/b/internal/c/d`?* — Any package under `a/b/` can import `a/b/internal/c/d`. Anything outside `a/b/` cannot.

---

## Middle

### Q6. What is a cyclic import error and how do you refactor around it?

**Model answer.** Go forbids import cycles: if `pkgA` imports `pkgB`, then `pkgB` (directly or transitively) cannot import `pkgA`. The compiler refuses to build such a graph.

Refactor strategies, in order of preference:

1. **Extract a shared third package.** Common types and helpers move to `pkgC`, which both A and B import. The cycle dissolves.
2. **Define an interface in the consumer.** If A needs a behaviour from B, A declares an interface; B's type implicitly satisfies it. A no longer imports B at all.
3. **Move the offending function.** Sometimes a helper sitting in the wrong package created the cycle; relocate it.
4. **Merge.** If A and B are mutually inseparable, perhaps they are one package.

**Follow-up.** *Which refactor most preserves layering?* — Interface-in-consumer (option 2) — it inverts the dependency rather than entangling layers.

---

### Q7. When do you use an import alias?

**Model answer.** An alias renames an import locally: `import jsonv2 "github.com/team/json/v2"`. Use cases:

- **Disambiguation.** Two packages with the same name (`crypto/rand` and `math/rand`) — alias one.
- **Major versions side-by-side.** `lib/v1` and `lib/v2` both declared as `package lib`; alias them.
- **Vanity readability.** A long or awkward generated package name shortened locally.
- **Testing seams.** Aliasing a real package in one file and a fake in another (rare, usually superseded by interfaces).

Aliases are file-local — every file that needs the alias must declare it.

**Follow-up.** *Why is widespread aliasing a smell?* — It usually means the imported package's name was poorly chosen, or that the call sites are doing too much.

---

### Q8. What are build-tag-gated imports?

**Model answer.** Build tags (`//go:build linux`) at the top of a file cause the compiler to include or exclude the entire file based on the target platform, architecture, or custom tags. Imports inside that file are gated with it: a `linux_only.go` file may import `"golang.org/x/sys/unix"` without breaking Windows builds, because the file itself is excluded on Windows.

Mechanism: the toolchain resolves build tags *before* type-checking; excluded files contribute no imports.

**Follow-up.** *What is the modern syntax versus the legacy one?* — Modern: `//go:build linux`. Legacy: `// +build linux`. `go fmt` keeps both in sync; new code uses only the modern form.

---

### Q9. In what order do `init()` functions run across imported packages?

**Model answer.** Go performs a depth-first traversal of the import graph. For each package:

1. All imported packages are fully initialised first (recursively).
2. Then package-level variables are initialised in dependency order.
3. Then every `init()` function in the package runs, in the order the source files appear (sorted by file name) and in declaration order within each file.

The result: by the time `main.main` runs, every transitive dependency's `init()` has executed exactly once, in a deterministic order.

**Follow-up.** *Can I rely on the order of `init()` between two unrelated packages A and B?* — Only via an explicit import edge. If neither A nor B imports the other, their relative order is determined by how `main` reaches them and is not part of the spec for stability.

---

### Q10. How does `goimports` group imports?

**Model answer.** `goimports` (and modern `gofmt -s`) typically sort imports into three groups separated by a blank line:

1. **Standard library** — `"fmt"`, `"net/http"`.
2. **Third-party** — `"github.com/..."`, `"golang.org/x/..."`.
3. **Local module** — `"github.com/alice/app/..."`.

The third group requires telling the tool which prefix is local: `goimports -local github.com/alice/app`. Without this flag, third-party and local merge into one group.

**Follow-up.** *Why does the grouping matter?* — Diff hygiene and at-a-glance dependency awareness. A reviewer can spot "this PR adds a third-party dep" by the group it lands in.

---

### Q11. What is the difference between `package foo` and `package foo_test`?

**Model answer.** Inside a folder, two test packages can coexist:

- `package foo` test files (white-box) — same package as production code, can access unexported symbols.
- `package foo_test` test files (black-box) — a *separate* package, can only see exported symbols. Lives in the same folder but compiles as a distinct unit.

Black-box tests force the test author to use the package as an external consumer would, surfacing API ergonomics issues. They also break import cycles that would arise if a test wanted to import another package that already imports `foo`.

**Follow-up.** *Can both coexist for the same `foo`?* — Yes. The toolchain compiles them together for `go test ./...`.

---

### Q12. A teammate added `import "C"` to a file. What changed?

**Model answer.** That import enables cgo — an FFI bridge to C code. The file may now contain a special `// #include` comment block above the import, and Go code can call C functions and vice versa. Consequences:

- The build now requires a C toolchain.
- Cross-compilation becomes harder (need a C cross-compiler).
- Garbage collection rules around C-allocated memory must be respected.
- Build times increase.

`import "C"` is not a real package; it is a directive recognised by the toolchain.

**Follow-up.** *Why is `import "C"` often controversial?* — It compromises Go's build simplicity and portability; teams often try to keep cgo confined to one isolated package.

---

## Senior

### Q13. How do you express a layered architecture (domain / application / infrastructure) using imports alone?

**Model answer.** Treat the import graph as a directed acyclic graph mirroring the layers:

- `internal/domain/` — pure business types and logic. Imports only the standard library.
- `internal/app/` — use cases and orchestration. Imports `domain`. Defines interfaces it needs (e.g., `UserRepo`).
- `internal/infra/` — concrete adapters: databases, HTTP clients, file systems. Imports `app` (to satisfy its interfaces) and `domain` (for the types it persists).
- `cmd/server/` — wiring and `main`. Imports `infra` and `app`.

The rule "imports point inward" (toward the domain) makes the dependency direction explicit and machine-checkable. A linter such as `go-arch-lint` or a CI grep can fail any PR that violates the rule.

**Follow-up.** *What if the database driver type leaks into `domain`?* — That is the violation the rule exists to catch. Wrap the driver type in `infra` and expose a domain-friendly interface.

---

### Q14. What is the *blast radius* of an import, and why does it matter?

**Model answer.** When package A imports package B, A's compiled output and binary size include B's symbols, B's transitive imports, and B's `init()`-time cost. A change in B forces a recompile of A (and everything that imports A).

Blast radius is the set of packages affected by a change in one package. Wide blast radius signals an over-shared utility module that becomes a bottleneck:

- Every change requires re-running every test in the closure.
- A breaking change in the central package fans out across the codebase.
- Bloat: leaf binaries pull in transitively-imported but locally-unused dependencies.

Mitigations: split fat packages, prefer narrow interfaces over fat structs, isolate optional features behind sub-packages so consumers opt in.

**Follow-up.** *How would you measure blast radius?* — `go list -deps -reverse` (via tooling) or scripts walking `go list -json` output. Several CI systems track it as a metric.

---

### Q15. How do you carve a sub-module out of a single-module repo without breaking consumers?

**Model answer.** Multi-step, additive plan:

1. Identify a leaf-ish sub-tree with no inbound edges from the rest of the module — say, `pkg/charts/`.
2. Create `pkg/charts/go.mod` declaring `module github.com/team/main/pkg/charts` (note the path matches its folder for compatibility).
3. Update the sub-tree's internal imports if any used short forms.
4. In the parent module, replace local references with the new module's tagged version: `require github.com/team/main/pkg/charts v0.1.0` plus a `replace` for development.
5. Tag the sub-module: `git tag pkg/charts/v0.1.0`.
6. Push, verify `go get` resolves it.
7. Iterate: each sub-module after the first is easier because the discipline is in place.

The hard part is ordering — start with the sub-tree that has the fewest cross-package callers.

**Follow-up.** *What does `replace` give you during the transition?* — Local-edit-friendly development; the parent module sees the sub-module's `HEAD` rather than a fixed tag.

---

### Q16. When *is* a dot import acceptable?

**Model answer.** Three legitimate cases:

1. **DSL-style test frameworks.** Ginkgo's `Describe`, `It`, `BeforeEach` read as English when imported `.`-style. The framework is designed for it.
2. **Generated test scaffolding** that intentionally imports verbs into scope.
3. **Math/scientific code** where domain symbols (`Sum`, `Prod`, `Inv`) are universally understood and qualifying them adds no clarity. Rare in practice.

Outside these, dot imports are nearly always a mistake.

**Follow-up.** *Should I dot-import my own package's helpers in a sibling file?* — No. Sibling files in the same package already share scope; no import is needed.

---

### Q17. Describe the plugin/registry pattern using blank imports.

**Model answer.** A central package exposes a registry — typically a `map[string]Factory` populated via `Register()` — and consumers blank-import plugin packages, each of which calls `Register()` from its own `init()`.

```go
// in main.go
import (
    "myapp/codec"
    _ "myapp/codec/json"   // calls codec.Register("json", ...)
    _ "myapp/codec/proto"  // calls codec.Register("proto", ...)
)

func main() {
    enc := codec.Lookup("json")
    ...
}
```

Trade-offs:

- **Pros:** decoupling — main does not reference each plugin's symbols; build flags can swap plugin sets.
- **Cons:** init-time magic; no compile-time check that the requested plugin name was registered; harder to debug.

**Follow-up.** *How would you make plugin registration explicit instead?* — Replace blank imports with explicit `codec.Register(jsoncodec.New())` calls in `main`. Verbose but visible.

---

### Q18. How do you handle two major versions of the same library coexisting in one binary?

**Model answer.** Semantic Import Versioning makes them distinct modules: `lib` and `lib/v2`. A single binary can import both, alias one or both, and use them side by side:

```go
import (
    libv1 "github.com/team/lib"
    libv2 "github.com/team/lib/v2"
)
```

This is essential during migration: the new code paths use `v2`, the old ones still use `v1`, and they coexist until the migration completes. Costs: binary size grows, two `init()` chains run, and any global state inside the library is doubled.

**Follow-up.** *What if both versions register handlers on the same global default mux?* — A subtle conflict — they may overwrite each other or produce duplicate-handler panics. The library should not use shared globals for this reason.

---

## Staff / Architect

### Q19. You are writing a code generator that emits Go source files. How do you decide which imports to add programmatically?

**Model answer.** Use the `go/ast`, `go/parser`, and `go/printer` toolchain (and `golang.org/x/tools/go/ast/astutil`). Algorithm:

1. Parse the destination file (or a synthetic template) into an AST.
2. As you generate code that references a symbol, track the symbol's package path.
3. Use `astutil.AddImport(fset, file, "path/to/pkg")` — it inserts the import if missing, idempotently. `AddNamedImport` handles aliases.
4. After generation, run `astutil.UsesImport` on the result to confirm and `astutil.DeleteUnusedImports` to clean up.
5. Emit via `format.Node` so the output is canonical.

For aliases, decide once: if your generator may produce identifier collisions (e.g., the user has a local `json`), it should always alias generator-emitted imports under a stable prefix.

**Follow-up.** *Why not append `import "..."` lines manually?* — Brittle. Hand-edited imports break ordering, break aliasing, and create merge conflicts. AST manipulation lets the generator be re-runnable and idempotent.

---

### Q20. Your security team wants a CI gate that audits transitive imports for forbidden dependencies. How do you implement it?

**Model answer.** Layered audit:

1. **Snapshot the transitive closure.** `go list -deps -json ./...` emits one JSON object per package in the build graph, including its imports.
2. **Maintain a forbidden-list** — module paths you never want to ship (e.g., `github.com/banned/lib` or anything matching `*/v0.0.0-*` for a specific path).
3. **CI step** parses the JSON, checks every package's `Module.Path` against the list, and fails the build on any match. Include the *importer chain* in the failure message so the offender can be traced.
4. **Allow-list mode** for stricter teams — fail on anything *not* explicitly approved.
5. **SBOM export.** Generate a CycloneDX or SPDX SBOM as a build artefact for downstream auditors.
6. **License audit** as a sister gate — `go-licenses report` or similar — fails on copyleft licences in proprietary builds.

The gate must run on PRs (not just main) and on every `go.mod` change, since transitive deps shift silently.

**Follow-up.** *How do you handle a forbidden transitive that arrives via a legitimate direct dep?* — Either pin the direct dep to a version that does not transitively pull the forbidden one, or coordinate with the direct dep's maintainers, or `replace` it with a fork.

---

### Q21. You publish a library. A consumer imports it at v1 and v2 simultaneously. What is your obligation?

**Model answer.** The consumer is permitted by Semantic Import Versioning. Your obligations as maintainer:

1. **Keep both majors importable.** Do not delete the v1 branch upon v2 release; consumers may take years to migrate.
2. **Declare distinct module paths.** v1 at `lib`, v2 at `lib/v2`, no overlap.
3. **Avoid shared global state.** Singletons, package-level variables, default registries — any of these will misbehave when both majors load. Push state into explicit objects the caller constructs.
4. **Document migration.** A `MIGRATION.md` mapping v1 symbols to v2 equivalents is the most-requested asset.
5. **Maintain v1 with security patches** for a stated window.
6. **CI both majors** so neither bit-rots.

**Follow-up.** *Can the same Go file import both?* — Yes, as long as one is aliased. The compiler treats them as distinct packages with distinct types.

---

### Q22. Design a policy for when to use a vanity import path versus the raw VCS host path.

**Model answer.** Vanity paths add a layer; only adopt them when the layer pays for itself. Decision factors:

- **Mobility.** Will this code ever move hosts (GitHub to self-hosted, GitLab to corp)? If yes, vanity. If no, raw is fine.
- **Branding.** Public-facing OSS where the org's identity matters more than the host? Vanity (`go.uber.org/zap` over `github.com/uber-go/zap`).
- **Internal consistency.** Corporate codebases where every module path starts with `corp.example/...` look uniform regardless of repo location. Vanity scales.
- **Single-purpose tooling.** A repo intended only for one team's use does not need vanity.

Operational cost of vanity: serve a static page with `<meta name="go-import">` and `<meta name="go-source">`, plus DNS. For a corp `corp.example/`, this is one shared server and one wildcard pattern.

**Follow-up.** *What is the cheapest way to test a vanity setup?* — `GOPROXY=direct go get yourpath/yourmod` from a fresh machine. If it resolves, the meta tags are correct.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| What does `_ "x"` do? | Imports `x` for side effects only. |
| What does `. "x"` do? | Imports `x`'s exported symbols into local scope. |
| Are relative imports allowed in modules? | No. |
| Can two files in one package have different imports? | Yes — imports are per file. |
| What folder name restricts imports? | `internal/`. |
| What is the suffix for v3 of a module? | `/v3`. |
| Can `init()` order across unrelated packages be relied on? | No. |
| Black-box test package suffix? | `_test`. |
| Default `goimports` group count? | Three (with `-local`) or two (without). |
| Does `import "C"` import a Go package? | No — it activates cgo. |

---

## Mock Interview Pacing

A 30-minute interview on Go package imports might cover:

- 0–5 min: warm-up — Q1, Q2, Q5.
- 5–15 min: middle topics — Q6 (cycle refactor), Q9 (init order), Q10 (groupings), Q11 (test packages).
- 15–25 min: a senior scenario — Q13 (layering) or Q15 (sub-module carve-out) or Q17 (plugin registry).
- 25–30 min: a curveball — Q19 (AST generation) or Q20 (CI audit).

If the candidate is sharp, skip the warm-ups and open with Q6 or Q13. If they confuse import path with package name, stay in junior territory until the distinction is solid — every senior topic depends on it.
