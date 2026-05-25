# go work — Senior

## 1. Choosing between workspace, monorepo, and single module

Workspaces are one option in a small design space. Pick deliberately:

| Layout | When it fits | Trade-off |
|--------|-------------|-----------|
| **Single module** | One coherent unit shipped as one artifact | Forces a single Go version line and one release cadence |
| **Multi-module monorepo (no workspace)** | Independent release cadences, shared infra | Cross-module work needs `replace` or workspaces |
| **Multi-module monorepo + committed `go.work`** | The repo is the unit of CI; modules are released independently | CI must respect or override the workspace; consumers do not see it |
| **Separate repos + developer-local `go.work`** | Modules ship from different repos, devs occasionally need to coordinate | Each dev clones N repos; `go.work` describes their layout |

A workspace is a tool, not an architecture. It does not change *what* you ship — it only makes the dev loop pleasant when shipping multiple modules that depend on each other.

---

## 2. Repo layouts that work well

**Layout A — separate repos, ad-hoc workspace:**

```
~/dev/lib/                  # repo 1: example.com/lib
~/dev/app/                  # repo 2: example.com/app
~/dev/workspace/go.work     # references ../lib and ../app
```

`go.work` lives in a sibling directory and lists relative paths. Each repo's `.gitignore` includes `go.work`.

**Layout B — monorepo with a committed `go.work`:**

```
monorepo/
  go.work               # COMMITTED
  modules/
    lib/   go.mod       # example.com/monorepo/lib
    cli/   go.mod       # example.com/monorepo/cli
    api/   go.mod       # example.com/monorepo/api
```

Here `go.work` is part of the repo's contract; CI uses it; every contributor sees the same workspace. The `use` paths are repo-relative, so they are stable.

Avoid Layout C: separate repos *with* a committed `go.work` that references `../neighbor`. Paths leak host-specific assumptions and CI cannot satisfy them.

---

## 3. CI implications

CI must consciously decide which world it is testing in:

- **The published world** (consumers of your modules) → `GOWORK=off`.
- **The integrated world** (the monorepo as a single unit) → committed `go.work`.

Common pattern for a monorepo:

```yaml
- name: Per-module verification (published world)
  run: |
    for m in $(find modules -name go.mod -exec dirname {} \;); do
      (cd "$m" && GOWORK=off go test ./...)
    done

- name: Integrated verification (workspace)
  run: go test ./...
```

If your team commits `go.work`, the per-module step is what catches "this module won't actually build for downstream consumers because the workspace was hiding a missing `require`." Skipping that step is a common multi-module monorepo bug.

For developer-local workspaces (gitignored `go.work`), CI never sees the file and you can rely on the normal `go test ./...` semantics — but engineers must be disciplined to occasionally run `GOWORK=off go test` locally before pushing.

---

## 4. Interaction with `go mod tidy`

`go mod tidy` operates on **one module at a time**, using the *current* module's `go.mod`. With a workspace active, a subtle hazard appears:

- The workspace satisfied an import via a sibling module on disk, so the current module never needed a `require` entry.
- Run `go mod tidy` and it may add or remove `require` entries based on what the *individual* module needs without the workspace.

Best practice: run `go mod tidy` **with `GOWORK=off`** for each member when you intend the changes to land in `go.mod`:

```bash
for m in mod-a mod-b mod-c; do
  (cd "$m" && GOWORK=off go mod tidy)
done
go work sync   # then reconcile workspace-wide versions
```

This keeps each `go.mod` honest from a published-world standpoint, then `go work sync` aligns versions inside the workspace.

---

## 5. Refactoring across module boundaries

A common workflow: extract a package from `app` into a new shared `lib` module.

1. Create `lib/` with `go mod init example.com/lib`; move the package; export the API.
2. `go work use ./lib` so the workspace sees it.
3. In `app`, change imports to `example.com/lib/...`. Build passes because the workspace overlays the local `lib`.
4. Iterate freely — `app` and `lib` co-evolve without publishing `lib` even once.
5. When stable: tag/publish `lib v0.1.0`, then `cd app && GOWORK=off go get example.com/lib@v0.1.0 && go mod tidy`. Verify with `GOWORK=off go test ./...`.

The workspace removes the friction of step 4. Without it, every change in `lib` would require a published version (or a `replace` directive to maintain by hand).

---

## 6. Deprecating the `replace` hack

Many older Go codebases have `replace` directives that exist purely for local development. Audit them:

```go
// app/go.mod — likely candidates for removal
replace example.com/lib => ../lib
```

Migration:

1. Remove the `replace` from `go.mod`.
2. Add `lib` to a workspace alongside `app` (`go work use ../lib`).
3. Add `go.work` and `go.work.sum` to `.gitignore`.
4. Verify `go test ./...` still works (workspace overlays the local lib).
5. Verify `GOWORK=off go test ./...` matches the published-world build (because `app`'s `require` is now what users see).

Keep `replace` only for forks that you intentionally publish a redirected dependency for (e.g., a security patch where you cannot wait for upstream).

---

## 7. Workspace-wide `replace` (rare but valid)

`go.work` itself can contain `replace` directives:

```
use (
    ./mod-a
    ./mod-b
)

replace example.com/external => ../forks/external
```

This is the right place for "everyone in this workspace should use my local fork of `external`" without scattering `replace` across each member's `go.mod`. Workspace `replace` wins over both `go.mod` `replace` and the normal module graph for the listed path.

---

## 8. Failure modes seniors watch for

- **Committed `go.work` in a single-repo single-module project** — pointless and confusing; remove it.
- **Workspace references paths that do not exist on a teammate's machine** — usually a sign you committed a `go.work` that should have been gitignored.
- **Tools that bypass workspaces** — `go install path@version` deliberately ignores the workspace (it installs from the proxy); do not be surprised that `go install ./cmd/foo` and `go install example.com/foo@latest` produce different things.
- **`go.sum` drift** — when the workspace pulls in a new transitive dep, the checksum goes into `go.work.sum`, not `go.sum`. If you later remove the workspace, `go.sum` may be stale.

---

## 9. Summary

Choose between single module, monorepo, and workspace based on release cadence, not convenience. Workspaces shine for parallel multi-module development; commit `go.work` only when the repo is the unit of CI, otherwise gitignore it and use `GOWORK=off` to verify the published-world build. Run `go mod tidy` with `GOWORK=off` per member, then `go work sync`. Migrate dev-only `replace` directives to workspaces — they are the right tool for that job.

---

## Further reading
- Workspaces reference — https://go.dev/ref/mod#workspaces
- Tutorial — https://go.dev/doc/tutorial/workspaces
- Russ Cox on multi-module development — https://research.swtch.com/vgo
