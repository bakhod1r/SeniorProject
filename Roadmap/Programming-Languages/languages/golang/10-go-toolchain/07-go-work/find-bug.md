# go work — Find the Bug

Each scenario shows a workspace setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Committed `go.work` makes CI use a local stub

```
repo/
  go.work         # COMMITTED
  service/        # the real module
  mocks/stub/     # a hand-rolled stub the team uses locally
```

`go.work`:

```
use (
    ./service
    ./mocks/stub
)
```

CI runs `go test ./...` from `repo/` and passes — but production breaks because `service` is silently using `mocks/stub` types instead of the real dependency.

**Bug:** the workspace was meant as a developer convenience for offline work, but it was committed. CI builds the workspace and the stub overlays the real import path.
**Fix:** either remove the stub from `go.work` (developers add it locally) or run CI with `GOWORK=off` to verify each module standalone. Best: gitignore `go.work` entirely and commit only what should ship.

---

## Bug 2 — Dev forgot `go work sync` after `go.mod` change

```bash
cd mod-a
go get example.com/dep@v1.5.0   # bumped here
cd ..
# tests pass under workspace
git push
```

A teammate later runs `cd mod-b && GOWORK=off go test ./...` and gets a compile error because `mod-b` requires `dep v1.2.0` and the API changed.

**Bug:** the workspace upgraded `dep` via MVS to v1.5.0 for everyone *inside* the workspace, but `mod-b/go.mod` still pinned v1.2.0. Standalone, it builds against v1.2.0 and fails.
**Fix:** after upgrading a shared dep in one member, run `go work sync` so other members that already require `dep` get realigned, then `git add` the modified `go.mod` files.

---

## Bug 3 — `replace` in `go.mod` conflicts with workspace

```go
// app/go.mod
require example.com/lib v0.0.0-00010101000000-000000000000
replace example.com/lib => ../lib-old
```

The workspace lists `./lib-new` under `use`. Developer expects edits in `lib-old` to be visible. They are not.

**Bug:** when the workspace is active, member `replace` directives are **ignored** for paths the workspace covers. The `use ./lib-new` line wins; edits in `lib-old` have no effect.
**Fix:** decide which directory is authoritative. Remove the `replace` from `go.mod` and ensure `go.work` lists the directory you actually edit (`./lib-old` *or* `./lib-new`, not both with confusion).

---

## Bug 4 — `GOWORK=off` not set in CI

A monorepo commits `go.work`. CI script:

```yaml
- run: |
    for m in $(find . -name go.mod -exec dirname {} \;); do
      (cd "$m" && go test ./...)
    done
```

All modules pass. A downstream consumer later cannot build one of the published modules.

**Bug:** the per-module loop still has `go.work` reachable by walking up, so each `go test` runs in workspace mode and the workspace patched over missing requires.
**Fix:** export `GOWORK=off` for the per-module pass:

```yaml
- run: |
    for m in $(find . -name go.mod -exec dirname {} \;); do
      (cd "$m" && GOWORK=off go test ./...)
    done
```

---

## Bug 5 — Import cycle when two workspace modules add each other

```
mod-a imports example.com/mod-b
mod-b imports example.com/mod-a   # added during refactor
```

The workspace overlays both, and `go build ./...` fails with `import cycle not allowed`.

**Bug:** without a workspace, this could not happen — `mod-b` could only import a *published* version of `mod-a`, and a cycle would manifest at publish time. The workspace lets you build both from source at once and exposes the cycle immediately.
**Fix:** break the cycle (extract the shared types into a third module, e.g., `example.com/shared`, that both depend on; or invert the direction with an interface). Workspaces did not cause the cycle — they revealed it.

---

## Bug 6 — `go mod tidy` removes a `require` the workspace was satisfying

```bash
cd mod-a
go mod tidy   # workspace active
# go.mod now missing `require example.com/helper v1.4.0`
```

Standalone, `mod-a` no longer builds.

**Bug:** under workspace mode, `mod-a` imports `example.com/helper` indirectly via another workspace member that does `require helper`. `tidy` decided `mod-a`'s own `go.mod` did not need the require because the workspace was providing it.
**Fix:** run `tidy` with the workspace disabled so it reflects standalone reality:

```bash
GOWORK=off go mod tidy
```

Then run `go work sync` to realign workspace versions.

---

## Bug 7 — Deleted module directory still in `go.work`

A developer removed `mod-c/` to clean up. Now every `go` command in the workspace fails:

```
go: workspace module ./mod-c does not exist
```

**Bug:** `go.work` still references a path that no longer exists on disk.
**Fix:** drop the stale entry:

```bash
go work edit -dropuse=./mod-c
```

Or edit `go.work` by hand to remove the line.

---

## Bug 8 — `go install` ignores the workspace by design

A developer modified `cmd-a` inside the workspace, then runs:

```bash
go install example.com/cmd-a@latest
```

The installed binary does not reflect their edits.

**Bug:** `go install path@version` deliberately bypasses the workspace; the version suffix means "install from the proxy in a reproducible way."
**Fix:** use the local-source form, which respects the workspace:

```bash
go install ./cmd-a       # builds from on-disk source via the workspace
```

For team-wide reproducibility of dev tools, prefer `go run path@vX.Y.Z` (also bypasses the workspace, intentionally) and pin the version.

---

## Bug 9 — Workspace `replace` shadowed by member `go.mod`?

```
// go.work
replace example.com/x => ../forks/x
```

```go
// mod-a/go.mod
replace example.com/x => ../forks/old-x
```

The developer expects workspace `replace` to win. It does — but `go list -m example.com/x` from inside `mod-a` shows `../forks/old-x`.

**Bug:** the user ran `go list` with `GOWORK=off` set in their shell environment and forgot. Without the workspace, the member `replace` is the only one in effect.
**Fix:** check `go env GOWORK` first; unset stale env vars (`unset GOWORK`); re-run and confirm the workspace replace wins.

---

## Bug 10 — `go.work.sum` missing causes `go.sum` mismatch on fresh clone

Teammate clones a monorepo with committed `go.work` but the repo `.gitignore` excluded `go.work.sum` while keeping `go.work`. Build fails:

```
missing go.sum entry for module providing package ...
```

**Bug:** the workspace introduces dependencies beyond what any single `go.sum` covers; those checksums live in `go.work.sum`. Committing `go.work` without `go.work.sum` strands new clones.
**Fix:** if you commit `go.work`, commit `go.work.sum` too. Treat them as a pair.

---

## How to approach these
1. Workspace surprise? → check `go env GOWORK` first.
2. CI passes but consumers fail? → add a `GOWORK=off` per-module pass.
3. `go.mod` mysteriously thinner after `tidy`? → run `tidy` with `GOWORK=off`.
4. Version drift between members? → `go work sync`.
5. Tool installs not reflecting edits? → `go install path@version` always bypasses the workspace.
6. Stale path errors? → `go work edit -dropuse=...`.
7. Committing `go.work`? → commit `go.work.sum` alongside it.
