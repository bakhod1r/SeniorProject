# go work — Optimization

These exercises shave time and friction off multi-module Go development. Numbers are illustrative; measure on your repo.

---

## Exercise 1: Drop scattered `replace` directives in favor of one `go.work`

**Before** — each of five member modules has its own dev-only `replace` block:

```go
// each go.mod
replace example.com/lib => ../lib
replace example.com/util => ../util
```

Engineers must remember to delete these before publishing, and `git blame` is noisy.

**After:**

```bash
go work init ./lib ./util ./app1 ./app2 ./app3
echo go.work       >> .gitignore
echo go.work.sum   >> .gitignore
# remove every replace ../sibling line from each go.mod
```

| Metric | per-module `replace` | one `go.work` |
|--------|---------------------|---------------|
| Lines committed per dev change | 5+ (one per module) | 0 |
| Risk of accidentally publishing the replace | high | none (workspace is local) |
| Onboarding step | "edit 5 `go.mod` files" | "run `go work init ...`" |

One source of truth, never committed, never forgotten.

---

## Exercise 2: Share build cache across workspace modules

**Before** — engineers `cd` into each module and run `go build` separately. Cold-cache compiles per directory.

**After** — run from the workspace root once:

```bash
go build ./...      # builds every workspace member; shared GOCACHE entries
go test ./...       # likewise; one warm cache serves all members
```

| Metric | per-module cd + build | workspace-root build |
|--------|----------------------|----------------------|
| Cold-cache wall time | sum of per-module times | parallel + shared cache |
| Cache hits across modules | only via GOCACHE | same, but driven once |
| Mental overhead | "which dir am I in?" | one command |

The workspace builds the unified module graph, so a transitive dep compiled for `mod-a` is cached for `mod-b` immediately.

---

## Exercise 3: One `go test` pass from the workspace root

**Before** — CI loops over every module:

```bash
for m in mod-*; do (cd "$m" && go test ./...); done   # N invocations of `go`
```

Each invocation pays go-tool startup, module-graph load, and a fresh test binary link.

**After** — for the *integrated* workspace pass:

```bash
go test ./...   # one invocation, one graph load, shared link work
```

| Metric | N invocations | 1 invocation |
|--------|---------------|--------------|
| `go`-tool startup cost | N | 1 |
| Module graph load | N | 1 |
| Test parallelism | bounded per module | bounded across all members |

Keep the per-module pass too — with `GOWORK=off` — to catch standalone-build regressions (Exercise 4). Use both passes, not one.

---

## Exercise 4: `GOWORK=off` to validate the published state quickly

**Before** — engineers publish a module, then discover downstream consumers cannot build it because the workspace was hiding a missing `require`.

**After** — before pushing or releasing:

```bash
for m in $(find . -name go.mod -exec dirname {} \;); do
  (cd "$m" && GOWORK=off go build ./... && GOWORK=off go test ./...)
done
```

| Metric | discover at consumer | discover pre-push |
|--------|----------------------|--------------------|
| Time to fix | hours (revert/republish) | seconds (add the require) |
| Blast radius | every downstream | none |

This pass takes the same wall time as your normal build, but catches the entire class of "workspace hid it" bugs.

---

## Exercise 5: Prune unused workspace entries

**Before** — `go.work` lists ten modules; six are stale (developer moved on, repo restructured). Every `go` command loads all ten module graphs.

**After** — trim:

```bash
go work edit -dropuse=./old-mod-1
go work edit -dropuse=./old-mod-2
# ...
# or rewrite from scratch
go work init && go work use ./current-1 ./current-2 ./current-3
```

| Metric | 10 use entries | 3 use entries |
|--------|----------------|----------------|
| Module graph load time | proportional to total members | proportional to active members |
| `gopls` workspace view | indexes all 10 | indexes only what you use |
| Risk of stale-path errors | high | low |

Workspace bloat is the silent dev-loop killer in long-lived monorepos. Prune quarterly.

---

## Exercise 6: IDE setup — `gopls` is workspace-aware for free

**Before** — engineers manually configure `gopls.experimentalWorkspaceModule` or similar one-off knobs to get cross-module navigation.

**After** — just have `go.work` at the right level. `gopls` finds it by walking up from the opened file.

| Metric | manual configs per editor | rely on `go.work` |
|--------|---------------------------|--------------------|
| Per-engineer setup | non-trivial, error-prone | none |
| Cross-module rename/refs | spotty | works |
| Onboarding | "run this script then restart" | "open the folder" |

A committed `go.work` in a monorepo gives every contributor instant cross-module refactoring without per-editor config.

---

## Exercise 7: Use `go work use -r .` once instead of typing paths

**Before** — onboarding a monorepo means listing each module path by hand; new members get forgotten.

**After:**

```bash
go work init
go work use -r .   # discover every directory under . that contains a go.mod
```

| Metric | hand-listed | `-r .` |
|--------|-------------|--------|
| Effort | proportional to module count | one command |
| Drift when adding a module | manual `go work use` | one `go work use -r .` re-discovers |
| New-member errors | typos in paths | none |

For repos with stable layout this is a one-shot win; for evolving repos add `go work use -r .` to a Makefile target so the workspace is regenerated on demand.

---

## Measurement checklist
- [ ] Replace dev-only `replace` directives with one `go.work` (and gitignore it).
- [ ] Drive builds/tests from the workspace root to share cache and graph load.
- [ ] Add a `GOWORK=off` pass for per-module validation in CI and pre-push.
- [ ] Prune stale `use` entries; they cost graph-load time.
- [ ] Trust `gopls` to pick up `go.work` automatically.
- [ ] Use `go work use -r .` to onboard or refresh monorepo workspaces.
