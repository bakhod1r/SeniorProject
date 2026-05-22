# go mod — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — "missing go.sum entry" in CI

```
go: github.com/foo/bar@v1.2.3: missing go.sum entry; to add it: go mod download github.com/foo/bar
```

**Bug:** `go.sum` is stale — a dependency was added without updating `go.sum`, and CI runs `-mod=readonly`.
**Fix:** run `go mod tidy` (or `go mod download`) locally and commit the updated `go.sum`. Do **not** delete `go.sum`.

---

## Bug 2 — Local replace merged to main

```
// go.mod
replace example.com/shared => ../shared
```

CI fails: `../shared` does not exist on the runner.

**Bug:** a development-only `replace` to a local path was committed; it cannot resolve in CI or for consumers.
**Fix:** remove the `replace` before merging; use `go.work` locally for multi-module development instead.

---

## Bug 3 — Expecting the latest version

```bash
go get github.com/foo/bar       # then surprised it's not the newest minor
```

**Bug:** plain `go get pkg` (or MVS resolution) selects the minimum satisfying version, not the latest. People expect "latest."
**Fix:** to upgrade, use `go get github.com/foo/bar@latest` or `go get -u`.

---

## Bug 4 — Deleting go.sum to "fix" errors

```bash
rm go.sum && go build ./...     # regenerates, but loses integrity history
```

**Bug:** deleting `go.sum` discards integrity guarantees and can mask a tampered cache; regeneration silently trusts whatever is now downloaded.
**Fix:** `go mod tidy` to reconcile `go.sum` correctly; investigate why entries were missing rather than wiping the file.

---

## Bug 5 — Library author's replace ignored by consumers

A library has `replace example.com/x => example.com/x v1.0.1`, but consumers still get `v1.0.0`.

**Bug:** `replace` only applies to the **main module**; a dependency's `replace` is ignored by importers.
**Fix:** the library should use `require`/`exclude`/`retract` (which propagate) instead of relying on `replace`.

---

## Bug 6 — Build mutates go.mod unexpectedly

```bash
go build ./...    # changes go.mod on a teammate's machine but not in CI
```

**Bug:** `-mod=mod` (or an older default) lets `go build` update the graph; behavior differs from `-mod=readonly` CI.
**Fix:** set `GOFLAGS=-mod=readonly` everywhere; change dependencies only via explicit `go get`/`go mod tidy`.

---

## Bug 7 — Vendor directory out of sync

```bash
go get github.com/foo/bar@v2.0.0   # updated go.mod but forgot vendor
go build -mod=vendor ./...          # builds with the OLD vendored version
```

**Bug:** `vendor/` was not regenerated, so the build uses stale vendored sources despite the updated `go.mod`.
**Fix:** `go mod tidy && go mod vendor` together; verify with `go mod vendor && git diff --exit-code vendor` in CI.

---

## Bug 8 — Private module leaked to the public sum DB

```
go: verifying git.internal.example.com/team/lib@v1.0.0: ... sum.golang.org: 404
```

**Bug:** a private module is being checked against the public checksum database, which cannot see it.
**Fix:** set `GOPRIVATE=git.internal.example.com,github.com/yourorg/*` so private modules skip the public sum DB and proxy.

---

## Bug 9 — Huge indirect churn after a go directive bump

```bash
go mod tidy -go=1.17   # go.mod suddenly grows many // indirect lines
```

This looks like a mistake.

**Bug:** none — module graph pruning (1.17+) records more indirect requirements so the pruned graph is self-contained.
**Fix:** accept the churn; commit it in an isolated "bump go directive" PR so reviewers understand it.

---

## How to approach these
1. `go.sum` errors? → `go mod tidy`, never delete the file.
2. Wrong version? → MVS picks the minimum; use `@latest`/`-u` to upgrade.
3. `replace` not working? → only the main module's replaces apply.
4. Build mutating the graph? → `-mod=readonly`.
5. Vendor weirdness? → re-run `go mod vendor`.
6. Private module errors? → set `GOPRIVATE`.
