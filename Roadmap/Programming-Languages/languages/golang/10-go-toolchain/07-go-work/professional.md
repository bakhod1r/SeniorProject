# go work — Professional

## 1. Under the hood: where `go work` lives in `cmd/go`

The subcommand is implemented in `cmd/go/internal/workcmd` (parser, edit, sync, init, use, vendor). Workspace loading sits inside the module loader at `cmd/go/internal/modload`, which is where the *meaning* of "workspace mode is on" is enforced. The split is intentional:

- `workcmd` is the user-facing CLI surface — it parses flags, mutates `go.work`, and validates paths.
- `modload` consults `GOWORK` and the on-disk `go.work` while building the **build list** (the resolved set of module versions used by every `go` command).

When `modload.LoadModFile` runs and detects an active workspace, it constructs a single, merged module graph from every `use`d module's `go.mod`, then performs Minimum Version Selection (MVS) across all of them at once.

---

## 2. The merged module graph

Each member contributes its own `go.mod` (its `module`, `go`, `require`, `replace`, `exclude` lines) to a combined graph. The merge rules:

- For every imported path covered by a `use` directive, the **local source** is the only candidate (no version lookup).
- For every other path, the union of `require` versions across all workspace members is fed into MVS, which selects the maximum required version per module.
- `replace` directives from member `go.mod` files are **ignored** for paths the workspace handles. Workspace-level `replace` directives apply globally.

Net effect: the workspace produces *one* build list, and every package builds against the same versions of transitive dependencies — regardless of which workspace member you are inside.

---

## 3. Version selection inside the workspace

A subtle but important property: **workspace members pin their own dependency requirements via their own `go.mod`**. The workspace does not declare versions for non-`use` dependencies; it just runs MVS across all members' requirements.

Implication for upgrades:

```bash
# Upgrade golang.org/x/sys for the whole workspace by upgrading it where it's required
cd mod-a && go get golang.org/x/sys@v0.20.0 && cd ..
go work sync   # propagate the selection into other members' go.mod that already require it
```

`go work sync` does not invent new `require` lines — it only realigns existing ones to the workspace's MVS result. If `mod-b` did not require `golang.org/x/sys` before, `sync` will not add a require.

---

## 4. Interaction with the module cache

`go work` does not have a separate cache. Members of the workspace bypass the module cache for their *own* paths (they come from the source tree), but every other dependency still flows through `$GOMODCACHE` (`~/go/pkg/mod` by default). The checksum database (`GOSUMDB`) and proxy (`GOPROXY`) still gate downloads.

Source-tree pointers: a member's `Dir` field (as seen in `go list -m -json`) points at the on-disk directory, not at a cache entry. This is how `gopls` and other tooling discover the live source for navigation and refactoring.

```bash
go list -m -json all | jq 'select(.Main or .Dir != null) | {Path, Version, Dir}'
```

You will see your workspace members with `Dir` inside your checkout and everything else with `Dir` under `GOMODCACHE`.

---

## 5. Why workspaces are invisible to consumers

Workspaces are deliberately a **local construct**. There is no way to publish one. Consequences:

- A published module is exactly what its committed `go.mod` says — no workspace state leaks through `go install`, `go get`, or the proxy.
- `go install example.com/cmd/foo@latest` *ignores* the workspace by design (the installed tool must be reproducible from the proxy, not from your laptop).
- `go mod download` of a published version pulls the published `go.mod`/`go.sum`, not anything workspace-derived.

This is the same boundary as `replace`: a *published* `replace` directive is ignored by consumers (only the **main module's** `replace` applies during a build). Workspaces extend that "local-only" property to a multi-module overlay.

---

## 6. `go.work.sum`: what it covers and why it exists

Each member already has a `go.sum` listing checksums for *its* `require`d modules. The workspace can introduce extra dependencies that no single member alone pulled in (because MVS across the union of members elevates some versions, or because `replace` reroutes to a path with different transitive needs). Those extra checksums land in `go.work.sum`.

If you ever delete the workspace and rebuild against per-module `go.sum` alone, you may need `go mod download` to re-fetch checksums that previously lived only in `go.work.sum`. This is a routine source of "works on my machine" mystery — the workspace was quietly satisfying a checksum that no individual `go.sum` knew about.

---

## 7. `go.work` file syntax (precise)

```
go 1.21
toolchain go1.22.3        // optional, like in go.mod
godebug (                 // Go 1.23+
    httplaxcontentlength=1
)
use (
    ./mod-a
    ./mod-b
    ./tools/codegen
)
replace example.com/external v1.2.3 => ../forks/external
replace example.com/old => example.com/new v1.0.0
```

Parser entry point: `golang.org/x/mod/modfile` (the same library that parses `go.mod`). The `WorkFile` type round-trips edits without losing comments — that is what powers `go work edit -print -json`.

---

## 8. Tooling integration (`gopls`)

`gopls` is workspace-aware: when it sees a `go.work`, it loads every member module into a single workspace view. Cross-module Go-to-Definition, Find References, and Rename work without manual configuration. If you commit a `go.work` for a monorepo, contributors get refactoring across modules for free in any LSP-aware editor.

For a developer-local workspace (gitignored), running `gopls` from the workspace root or any subdirectory picks it up automatically — `gopls` walks up to find `go.work` exactly as `go` does.

---

## 9. Edge cases professionals encounter

- **A `use`d module path conflicts with a `require`d version.** The workspace wins; the `require` is shadowed for that path.
- **Two `use`d modules with the same module path.** Loader error — you cannot list two on-disk copies of the same import path in one workspace.
- **A workspace member with `go 1.22` and another with `go 1.18`.** The workspace's own `go` line gates language features uniformly; individual modules still declare their minimums for downstream consumers, but inside the workspace the toolchain uses the highest.
- **`vendor/` directories.** `go work vendor` (Go 1.22+) writes a unified `vendor/` from the merged build list; without it, per-module `vendor/` is ignored in workspace mode.

---

## 10. Summary

`go work` is a thin CLI over a module-loader feature: it tells the loader "treat these directories as live source and build them with a single MVS pass." The resulting state is local-only by design — published modules and consumers never see it. Understand the merged module graph, the role of `go.work.sum`, and the boundary at `go install path@version` (which always bypasses the workspace), and you can wire workspaces into multi-module pipelines without surprises.

---

## Further reading
- Source: https://cs.opensource.google/go/go/+/master:src/cmd/go/internal/workcmd/
- Source: https://cs.opensource.google/go/go/+/master:src/cmd/go/internal/modload/
- `golang.org/x/mod/modfile` (parser) — https://pkg.go.dev/golang.org/x/mod/modfile
- Workspaces reference — https://go.dev/ref/mod#workspaces
