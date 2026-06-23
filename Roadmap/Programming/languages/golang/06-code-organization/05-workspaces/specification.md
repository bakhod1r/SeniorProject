# Workspaces — Specification

## Table of Contents
1. [Introduction](#introduction)
2. [`go.work` File Grammar](#gowork-file-grammar)
3. [Directives](#directives)
4. [`go work` Subcommands](#go-work-subcommands)
5. [Environment Variables](#environment-variables)
6. [Resolution Rules](#resolution-rules)
7. [`go.work.sum`](#goworksum)
8. [Differences Across Go Versions](#differences-across-go-versions)
9. [References](#references)

---

## Introduction

Go workspaces are not part of the Go *language* specification. They are part of the Go *modules* system, documented in the Go Modules Reference at `go.dev/ref/mod` (see the "Workspaces" section). This file paraphrases the authoritative documentation and the toolchain source for offline study.

The authoritative sources of truth:

1. **Go Modules Reference** — `go.dev/ref/mod`, sections "Workspaces" and "go.work file".
2. **`go help work`** — concise built-in reference for the `go work` subcommand family.
3. **The Go 1.18 release notes** — original introduction of workspaces.
4. **The toolchain source** — `cmd/go/internal/modload`, `cmd/go/internal/workcmd`. The de facto specification when the reference is silent.

---

## `go.work` File Grammar

The `go.work` file format is line-oriented, mirroring `go.mod`. The grammar (paraphrased from the modules reference):

```
WorkFile     = { Directive } .

Directive    = GoDirective
             | ToolchainDirective
             | UseDirective
             | ReplaceDirective .

GoDirective         = "go" Version Newline .
ToolchainDirective  = "toolchain" ToolchainName Newline .
UseDirective        = "use" ( UsePath | "(" { UsePath Newline } ")" ) Newline .
ReplaceDirective    = "replace" ModulePath [ Version ] "=>" FilePath [ Version ] Newline .

UsePath = FilePath .
```

- **Comments** are introduced by `//` and run to end of line.
- **Whitespace** is permissive; blank lines are allowed.
- **Block form** (`use ( ... )`) and single-line form (`use ./path`) are both legal and may mix.

### Example

```
go 1.22

toolchain go1.22.4

use (
    ./server
    ./auth
    ./shared
)

replace example.com/upstream/lib => github.com/me/lib v1.4.0-fix1
```

---

## Directives

### `go`

```
go <version>
```

Specifies the minimum Go release supported by the workspace. The toolchain rejects builds when the running Go is older than this version. Required: at least one `go` directive in `go.work`.

The version string follows the same form as in `go.mod`: `1.18`, `1.21`, `1.22.4`. The patch component is optional.

### `toolchain` (Go 1.21+)

```
toolchain <name>
```

Requests a specific Go toolchain to build the workspace. Names take the form `go1.22.4`. When `GOTOOLCHAIN=auto` (default), the running `go` will switch to the named toolchain transparently.

The `toolchain` directive in `go.work` may be overridden by a higher `toolchain` directive in any listed module's `go.mod`.

### `use`

```
use <path>
```

Adds the module at the given path to the workspace. The path may be relative (recommended) or absolute. The path must point at a directory that contains a `go.mod` file at parse time.

Multiple `use` directives may be present. The block form is equivalent:

```
use (
    ./a
    ./b
)
```

Per the reference, duplicate `use` directives for the same path are an error.

### `replace`

```
replace <module-path> [<version>] => <replacement> [<version>]
```

Substitutes a module path (and optionally a specific version) with another module path or local directory. Workspace `replace` applies workspace-wide. The semantics match `replace` in `go.mod`, except for scope (entire workspace) and lifetime (local only).

If `<replacement>` is a relative or absolute filesystem path, no version is permitted. If it is a module path, a version is required.

When both a workspace `replace` and a module `replace` target the same module path, the workspace `replace` wins. The module `replace` is silently ignored while the workspace is active.

---

## `go work` Subcommands

Per `go help work`, the family is:

| Subcommand | Purpose |
|------------|---------|
| `go work init [pathlist]` | Create a new `go.work`. Listed paths are added as `use` directives. The `go` directive is set to the highest of the listed modules' `go` directives. |
| `go work use [-r] [pathlist]` | Add the listed paths as `use` directives in the current workspace. With `-r`, recursively scans subdirectories for `go.mod` files. |
| `go work edit [editing-flags]` | Programmatically edit the `go.work` file. Flags: `-use`, `-dropuse`, `-replace`, `-dropreplace`, `-go`, `-toolchain`, `-fmt`, `-print`, `-json`. |
| `go work sync` | Push the workspace's resolved version map back into each listed module's `go.mod`. |
| `go work vendor` (Go 1.22+) | Create a top-level `vendor/` directory containing every dependency used by every listed module. |

There is no `go work tidy`. Tidying is per-module: run `go mod tidy` inside each module folder, ideally with `GOWORK=off`.

---

## Environment Variables

Per the modules reference's environment-variables section:

| Variable | Default | Effect |
|----------|---------|--------|
| `GOWORK` | unset | If unset, the toolchain searches upward from the working directory for `go.work`. If set to `off`, workspace mode is disabled. If set to a path, that file is used as the workspace. |
| `GOFLAGS` | empty | Includes flags applied to every `go` command. `-mod=...` interactions are documented in the next section. |
| `GOMODCACHE` | `$GOPATH/pkg/mod` | Module download cache. Unaffected by workspace mode. |
| `GOCACHE` | `$HOME/.cache/go-build` | Build cache. Workspace mode and module mode produce different cache keys for the same build target; entries coexist. |
| `GOTOOLCHAIN` | `auto` | Controls whether the toolchain may auto-download a different version per `toolchain` directive. |
| `GOPROXY` | `https://proxy.golang.org,direct` | Module proxy chain. Workspace mode does not change proxy semantics for non-listed modules. |

### `-mod=...` interaction

Inside a workspace:

- `-mod=readonly` (default): allowed.
- `-mod=mod`: allowed; may update `go.mod`/`go.sum` as usual.
- `-mod=vendor`: rejected unless a workspace-level `vendor/` exists (created by `go work vendor`, Go 1.22+). Per-module `vendor/` directories are ignored when the workspace is active.

`go env GOWORK` returns the resolved workspace path or empty.

---

## Resolution Rules

The toolchain enters workspace mode according to the precedence:

1. `GOWORK=off` → no workspace.
2. `GOWORK=/abs/path` → use that file. No search.
3. Upward walk from `$PWD` for `go.work` → if found, workspace mode.
4. Otherwise, upward walk for `go.mod` → module mode.
5. Otherwise, legacy GOPATH (deprecated).

Once workspace mode is selected, version resolution proceeds as:

1. Collect the union of `require` directives from every `use`d module's `go.mod`.
2. Apply workspace `replace` directives (highest priority).
3. Apply each listed module's `replace` directives, dropping any that conflict with workspace replacements.
4. Run Minimum Version Selection (MVS) over the resulting graph.
5. Substitute the local source of each `use`d module wherever its module path appears in the resolved set.

The result is a `module → resolved-version-or-local-path` map consumed by the rest of the toolchain.

---

## `go.work.sum`

The companion lockfile to `go.work`. Format identical to `go.sum`:

```
<module-path> <version> h1:<base64-encoded-hash>
<module-path> <version>/go.mod h1:<base64-encoded-hash>
```

Holds hashes for modules in the workspace's resolved set whose hashes are not present in any listed module's `go.sum`. Most often populated when workspace `replace` introduces new transitive dependencies.

The toolchain manages the file. Manual editing produces verification errors and aborts builds.

If `go.work` is committed to version control, `go.work.sum` should also be committed for reproducibility. If `go.work` is gitignored, `go.work.sum` should be gitignored as well.

---

## Differences Across Go Versions

| Go version | Workspace-related change |
|-----------|--------------------------|
| **Go 1.18** | Workspaces introduced. `go.work` file format finalised. `go work init`, `use`, `sync`, `edit` subcommands available. `GOWORK` environment variable introduced. |
| **Go 1.19** | Minor improvements to error reporting and `go work edit -json` output. |
| **Go 1.20** | `GOWORK=off` documented as the official way to disable workspace mode. |
| **Go 1.21** | `toolchain` directive introduced in both `go.mod` and `go.work`. Auto-toolchain switching activated via `GOTOOLCHAIN=auto`. |
| **Go 1.22** | `go work vendor` subcommand introduced — creates a workspace-level `vendor/`. `-mod=vendor` works at the workspace level when the workspace vendor exists. |
| **Go 1.23** | Minor stability improvements. |

The core file format (`go`, `use`, `replace`) has been stable since 1.18. The `toolchain` directive (1.21) and workspace vendor (1.22) are additive.

---

## References

- Go Modules Reference, "Workspaces" section — `go.dev/ref/mod`.
- Go Modules Reference, "go.work file" syntax — `go.dev/ref/mod`.
- Go 1.18 release notes — workspace introduction — `go.dev/doc/go1.18`.
- `go help work`, `go help work init`, `go help work use`, `go help work edit`, `go help work sync`, `go help work vendor`.
- Tutorial: "Get familiar with workspaces" — `go.dev/blog/get-familiar-with-workspaces`.
- Tutorial: "Tutorial: Getting started with multi-module workspaces" — `go.dev/doc/tutorial/workspaces`.
- Toolchain source: `cmd/go/internal/modload` (workspace and module loading), `cmd/go/internal/workcmd` (the `go work` subcommands).
