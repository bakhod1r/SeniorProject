# go mod — Senior

## 1. Minimal Version Selection (MVS)

Go does **not** resolve "the latest compatible version." It uses **Minimal Version Selection**: for each module, it picks the **highest version required by any module in the graph** — the minimum that satisfies all requirements. There is no SAT solver, no lockfile-with-ranges; `go.mod` requirements are exact lower bounds and the selected version is deterministic.

Implications:
- Adding a dependency that requires `x v1.3.0` upgrades `x` to at least `v1.3.0` for everyone — automatically and reproducibly.
- Builds are reproducible without a separate lockfile because the graph + MVS fully determine versions. `go.sum` adds integrity, not version selection.

```bash
go list -m all                 # the selected version of every module (the build list)
go mod graph                   # the edges MVS computes over
```

---

## 2. Module graph pruning (Go 1.17+)

Since the `go 1.17` directive, the module graph is **pruned**: `go.mod` records the transitive requirements needed to build the packages your module imports, so the full graph need not be loaded for common operations. This is why post-1.17 `go.mod` files list more `// indirect` entries — they make the pruned graph self-contained.

Consequence: bumping the `go` directive across the 1.16→1.17 boundary changes how `go mod tidy` populates `go.mod`. Do it deliberately and review the resulting indirect churn.

---

## 3. `go.sum`, GOSUMDB, and verification

`go.sum` stores two hashes per module version: the module zip and its `go.mod`. On download, Go verifies against `go.sum`; for modules not yet in `go.sum`, it consults the **checksum database** (`sum.golang.org` by default) unless excluded.

```bash
go env GOSUMDB GONOSUMCHECK GONOSUMDB GOPRIVATE
go mod verify                  # cached modules match go.sum
GOFLAGS=-mod=readonly go build ./...   # fail if go.mod would change
```

`GOPRIVATE` (or `GONOSUMDB`/`GOINSECURE`) excludes private modules from the public sum DB so internal code is not leaked to it.

---

## 4. `-mod` modes and reproducibility

| Mode | Behavior |
|------|----------|
| `-mod=readonly` (default) | Build fails if `go.mod`/`go.sum` would need changes |
| `-mod=mod` | Allow the toolchain to update `go.mod`/`go.sum` |
| `-mod=vendor` | Use `vendor/`, ignore the network/cache |

`readonly` is the default precisely so CI builds never silently mutate the module graph. A common senior practice: `GOFLAGS=-mod=readonly` everywhere, and a separate explicit step (`go get`, `go mod tidy`) to change dependencies.

---

## 5. Replace, exclude, retract

```
replace example.com/x => ../local/x          // local development
replace example.com/x v1.2.0 => example.com/x v1.2.1   // force a version
exclude example.com/y v1.5.0                 // never select this version
retract v1.0.1                               // (in your own module) warn consumers off a bad release
```

- `replace` is a **local override** — it affects only the main module and is ignored by consumers; remove dev replaces before merging.
- `exclude` removes a version from selection.
- `retract` is published in your module's `go.mod` to tell downstream users a version is broken.

---

## 6. Where it surprises people

- **MVS picks the minimum, not the maximum.** People expect "latest"; `go get -u` is what upgrades to newer minors/patches.
- **`go mod tidy` changing indirect entries** after a `go` directive bump (pruning) looks like noise but is correct.
- **`replace` not affecting consumers.** A library author's `replace` does nothing for importers — only the main module's replaces apply.
- **`go.sum` "missing entry" in CI** when `go.sum` is stale; fix with `go mod tidy`, not by deleting `go.sum`.
- **Vendoring drift** — `vendor/` out of sync with `go.mod` causes confusing build differences; `go mod vendor` after every dependency change.
- **GOFLAGS leakage** — a global `-mod=vendor` silently changes resolution for unrelated commands (including `go install ... @version`).

---

## 7. CI usage

```bash
# integrity + cleanliness gate
go mod download
go mod verify
cp go.mod go.mod.bak; cp go.sum go.sum.bak
go mod tidy
diff go.mod go.mod.bak && diff go.sum go.sum.bak   # fail if tidy changed anything
```

Or more idiomatically with `git diff --exit-code` after `go mod tidy`. CI rules:
- `-mod=readonly` so builds never mutate the graph.
- A "tidy is a no-op" check to keep `go.mod`/`go.sum` honest.
- `go mod verify` for integrity.
- Cache `GOMODCACHE` keyed on `go.sum`.

---

## 8. Workspaces (`go.work`) — when one module is not enough

For multi-module development, `go work` (Go 1.18+) supersedes ad-hoc `replace` directives:

```bash
go work init ./serviceA ./serviceB ./sharedlib
go work use ./newmodule
```

`go.work` is local-only (do not commit it for libraries) and lets you edit several modules together without polluting each `go.mod` with `replace`. Senior teams prefer `go.work` over scattered local `replace` lines.

---

## 9. Summary

Go uses Minimal Version Selection — the highest required version, deterministically — so builds are reproducible from the graph plus `go.sum` (integrity) without a range-based lockfile. The `go 1.17+` directive prunes the graph (more indirect entries). Default `-mod=readonly` prevents silent graph mutation; `replace`/`exclude`/`retract` adjust selection (replace is main-module-only). Watch for MVS-vs-"latest" confusion, stale `go.sum`, vendor drift, and GOFLAGS leakage. For multi-module work, prefer `go.work` over local `replace`.

---

## Further reading
- Modules reference (MVS, pruning): https://go.dev/ref/mod
- Go workspaces: https://go.dev/doc/tutorial/workspaces
- Checksum database: https://go.dev/ref/mod#checksum-database
