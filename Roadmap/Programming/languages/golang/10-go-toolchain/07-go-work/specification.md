# go work — Specification

> **Focus:** Precise reference for the `go work` command family and the `go.work` file — synopsis, subcommands, flags, file syntax, environment, and behavioral guarantees.
>
> **Sources:**
> - `go help work`, `go help work init`, `go help work use`, `go help work edit`, `go help work sync`
> - Workspaces reference: https://go.dev/ref/mod#workspaces
> - cmd/go documentation: https://pkg.go.dev/cmd/go

---

## 1. Synopsis

```
go work init [moduledir...]
go work use [-r] [moduledir...]
go work edit [editing flags] [go.work]
go work sync
go work vendor [-e] [-v] [-o outdir]   # Go 1.22+
```

`go work` manages a workspace, an on-disk overlay that lets `go` commands resolve imports across multiple modules to local source instead of published versions.

---

## 2. Subcommands

| Subcommand | Effect |
|------------|--------|
| `init` | Create a new `go.work` in the current directory listing the given module directories under `use` |
| `use` | Add (or with `-r`, recursively add) module directories to `go.work` |
| `edit` | Programmatically edit `go.work` (add/drop use/replace, set `go`, set `toolchain`); `-print` and `-json` are dry-run helpers |
| `sync` | Realign each member `go.mod`'s `require` versions to the workspace's resolved (MVS) versions |
| `vendor` | Write a unified `vendor/` directory from the workspace's merged build list (Go 1.22+) |

A workspace is **created** by `init` and **modified** by `use`/`edit`. `sync` writes back; `vendor` materializes.

---

## 3. `go work init` flags

`go work init` takes only positional module directory arguments. There are no init-specific flags beyond global build flags. Each argument must be a directory containing a `go.mod`.

---

## 4. `go work use` flags

| Flag | Effect |
|------|--------|
| `-r` | Recursively walk the given directories and add every directory that contains a `go.mod` |

Removing a `use` entry is done via `go work edit -dropuse=<dir>`, not via `use`.

---

## 5. `go work edit` flags

| Flag | Effect |
|------|--------|
| `-go=<version>` | Set the workspace's `go` directive |
| `-toolchain=<name>` | Set the workspace's `toolchain` directive (Go 1.21+) |
| `-use=<path>` | Add a `use` directive |
| `-dropuse=<path>` | Remove a `use` directive |
| `-replace=<old>[=<new>]` or `-replace=<old>@<v>=<new>@<v>` | Add a workspace-level `replace` |
| `-dropreplace=<old>[=<v>]` | Remove a `replace` |
| `-godebug=<key>=<value>` | Add a `godebug` directive (Go 1.23+) |
| `-dropgodebug=<key>` | Remove a `godebug` directive |
| `-fmt` | Reformat `go.work` without other edits |
| `-print` | Write the modified file to stdout instead of disk |
| `-json` | Print the parsed representation as JSON |

Flags compose: multiple `-use=` flags in one invocation apply in order.

---

## 6. `go.work` file syntax

```
go 1.21

toolchain go1.22.3        // optional

godebug (                 // optional, Go 1.23+
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

Directives:

| Directive | Meaning |
|-----------|---------|
| `go <version>` | Workspace's Go language version (separate from each member's `go` line) |
| `toolchain <name>` | Toolchain selection (e.g., `go1.22.3`) |
| `godebug <key>=<value>` | Default GODEBUG settings applied workspace-wide |
| `use <path>` | A directory containing a `go.mod`; the workspace overlays its module |
| `replace <old>[ <version>] => <new>[ <version>]` | Workspace-level redirect (wins over member `replace` and the module graph) |

Parser: `golang.org/x/mod/modfile` (`WorkFile` type), shared with `go.mod`.

---

## 7. The `go.work.sum` file

A companion file holding cryptographic checksums for modules introduced by the workspace beyond what any single member's `go.sum` covers. Treated like `go.sum`: append-only, machine-managed, mandatory for reproducible builds. If you commit `go.work`, commit `go.work.sum` too.

---

## 8. The `GOWORK` environment variable

| Value | Behavior |
|-------|----------|
| (unset) | Auto-discover: walk up from CWD looking for `go.work` (same algorithm as `go.mod`) |
| `off` | Disable workspace mode entirely; commands behave as if no `go.work` exists |
| `<path>` | Use exactly this `go.work` file, regardless of CWD |

`GOWORK` is consulted by **every** `go` subcommand that loads modules, not just `go work`. Setting it to `off` is the standard way to test the published-only path.

---

## 9. Interaction with `GOFLAGS`

`GOFLAGS` is unioned into every `go` invocation. A common pattern:

```
GOFLAGS=-mod=readonly
```

This applies in workspace mode too — the workspace does not bypass `-mod=readonly` or other module-mode flags. If a workspace member needs to update its `go.mod`, you must opt in (e.g., run `go mod tidy` or `go get` without `-mod=readonly`, or use `GOWORK=off go mod tidy`).

---

## 10. Behavioral guarantees

- **Local-only.** Workspaces are never published. `go install path@version`, `go get`, and the proxy ignore workspace state by design.
- **Override semantics.** When the workspace is active, member `replace` directives are ignored for paths the workspace handles via `use`; workspace-level `replace` wins over both.
- **Single build list.** All workspace members are built with one MVS-resolved set of versions for non-`use` dependencies.
- **Cache compatibility.** Workspace builds use the same `GOCACHE` and `GOMODCACHE` as non-workspace builds; workspace members bypass the module cache for their own paths only.
- **Tooling compatibility.** `gopls`, `golangci-lint`, and `go vet` honor the workspace because they share the loader (`cmd/go/internal/modload`).
- **`go.work.sum` covers gaps.** Checksums needed only because the workspace elevated a transitive version land in `go.work.sum`, not `go.sum`.

---

## 11. Non-goals / limitations

- Not a packaging format: workspaces cannot be published, vendored into a downstream module, or referenced by `go get`.
- Not a substitute for proper `go.mod` requirements: each module's `go.mod` must still be correct for standalone consumers (verify with `GOWORK=off`).
- Not a way to fork a published module permanently for consumers: that needs a `replace` in your own `go.mod` (and you must own it).
- Not effective for `go install path@version`: that command always ignores workspaces.
- Not retroactive: pre-1.18 toolchains do not understand `go.work` and will error or warn.

---

## 12. Related references
- Workspaces reference: https://go.dev/ref/mod#workspaces
- Tutorial: https://go.dev/doc/tutorial/workspaces
- Original proposal: https://go.googlesource.com/proposal/+/master/design/45713-workspace.md
- `golang.org/x/mod/modfile`: https://pkg.go.dev/golang.org/x/mod/modfile
- `cmd/go/internal/workcmd` source: https://cs.opensource.google/go/go/+/master:src/cmd/go/internal/workcmd/
