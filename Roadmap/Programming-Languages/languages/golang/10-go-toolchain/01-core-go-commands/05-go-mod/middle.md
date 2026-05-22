# go mod — Middle

## 1. The full subcommand map

| Subcommand | Purpose |
|------------|---------|
| `go mod init` | Create `go.mod` with a module path |
| `go mod tidy` | Sync `go.mod`/`go.sum` to actual imports |
| `go mod download` | Download modules into the module cache |
| `go mod verify` | Verify cached modules match `go.sum` |
| `go mod vendor` | Copy dependencies into a `vendor/` directory |
| `go mod edit` | Programmatically edit `go.mod` (scripts/CI) |
| `go mod graph` | Print the full module dependency graph |
| `go mod why` | Explain why a module/package is needed |

Note: adding/upgrading dependencies is done with `go get`, not `go mod`; `go mod tidy` then cleans up.

---

## 2. `go mod tidy` in depth

`go mod tidy`:
- Adds `require` entries for imports not yet listed.
- Removes `require` entries no longer imported.
- Adds/removes `go.sum` entries to match.
- Marks transitive-only requirements `// indirect`.

```bash
go mod tidy
go mod tidy -go=1.22       # also set the go directive / pruning behavior to 1.22 semantics
```

Run it after adding/removing imports and before committing. A clean PR has a `go.mod`/`go.sum` that `go mod tidy` would not change.

---

## 3. `go mod download`

Pre-fetches modules into the cache without building:

```bash
go mod download           # download everything in the build list
go mod download -x        # show the work
go mod download github.com/foo/bar@v1.2.3
```

Used in CI and Docker layers to warm the module cache independently of source code, so a code change does not re-download dependencies.

---

## 4. `go mod verify`

Confirms that the cached copies of your dependencies match the checksums in `go.sum`:

```bash
go mod verify
# all modules verified
```

If a cached module was tampered with or corrupted, this fails. Run it in CI as a lightweight integrity check.

---

## 5. `go mod vendor`

Copies all dependencies into a top-level `vendor/` directory so builds use those local copies instead of the module cache:

```bash
go mod vendor
go build -mod=vendor ./...    # (auto-detected if vendor/ exists and go.mod's go >= 1.14)
```

Trade-offs:
- **Pro:** hermetic builds with no network; everything is in the repo; auditable in PRs.
- **Con:** large repo, large diffs on dependency bumps.

When `vendor/` exists and the `go` directive is ≥ 1.14, the toolchain uses it automatically. Keep it in sync with `go mod tidy && go mod vendor`.

---

## 6. `go mod edit` (for scripts)

Edits `go.mod` without hand-editing the file — ideal for automation:

```bash
go mod edit -require=github.com/foo/bar@v1.2.3   # add/replace a require
go mod edit -droprequire=github.com/foo/bar
go mod edit -replace=example.com/x=../local/x    # local replace for development
go mod edit -dropreplace=example.com/x
go mod edit -go=1.23                              # set the go directive
go mod edit -json                                  # print go.mod as JSON
```

`-replace` to a local path is how you develop two modules together before publishing.

---

## 7. `go mod graph` and `go mod why`

Understand your dependency tree:

```bash
go mod graph                              # every module → dependency edge
go mod why github.com/foo/bar             # why is this module in the build?
go mod why -m github.com/foo/bar          # at the module level
```

`go mod why` is invaluable when you ask "why is this huge/unexpected dependency here?" — it prints the import chain that pulls it in.

---

## 8. Direct vs indirect, and the `go` directive

```
require (
    github.com/google/uuid v1.6.0
    golang.org/x/sys v0.20.0 // indirect
)
```

`// indirect` means no package in your module imports it directly — it is required by a dependency (or recorded for version selection). `go mod tidy` maintains these markers.

The `go 1.XX` directive affects language features available *and* module graph pruning (since 1.17, the graph is pruned based on this version). Bumping it is a deliberate change.

---

## 9. How it fits the dev loop

- Add an import → `go mod tidy` → commit `go.mod`/`go.sum`.
- Upgrade a dep → `go get pkg@version` → `go mod tidy`.
- Develop against a local fork → `go mod edit -replace` (remove before merging).
- CI → `go mod download` (warm cache), `go mod verify`, and a tidy check.

---

## 10. Summary

`go mod` manages module identity and dependencies: `tidy` keeps `go.mod`/`go.sum` matching your imports, `download` warms the cache, `verify` checks integrity, `vendor` makes builds hermetic, `edit` automates `go.mod` changes, and `graph`/`why` explain the dependency tree. Pair `go mod` with `go get` (which adds/upgrades versions), commit both module files, and treat a no-op `go mod tidy` as a cleanliness invariant.

---

## Further reading
- `go help mod`, `go help mod tidy`
- Managing dependencies: https://go.dev/doc/modules/managing-dependencies
- Modules reference: https://go.dev/ref/mod
