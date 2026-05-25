# go work — Junior

## 1. What is a Go workspace?

A **workspace** is a local, on-disk overlay that lets one `go` invocation see **multiple modules at once** as if they were a single project. You point the workspace at a few module directories on your laptop, and from then on every `go build`, `go test`, and `go run` resolves imports between those modules through your local source — not through the published versions on a module proxy.

Workspaces were added in **Go 1.18** to solve one specific problem: developing two related modules in parallel without the `replace`-directive shuffle.

```bash
go work init ./mod-a ./mod-b
```

That single command writes a `go.work` file describing the workspace. From any directory inside it, `go` now treats `mod-a` and `mod-b` as the live sources for their import paths.

---

## 2. The problem it solves

Imagine you maintain two modules:

- `example.com/lib` — a library
- `example.com/app` — an app that imports the library

You want to edit `lib` and immediately try the change in `app`, **without** publishing a new version of `lib` first. Pre-1.18 the only knob was a `replace` directive in `app/go.mod`:

```go
// app/go.mod (the old way)
replace example.com/lib => ../lib
```

That worked but had two annoyances: you had to remember to remove the `replace` before publishing, and the redirect was committed in `go.mod`, polluting history. Workspaces move that overlay to a separate, local-only file.

---

## 3. Prerequisites

- Go **1.18 or newer** (`go version`).
- Two or more module directories on disk (each with its own `go.mod`).
- Comfort with basic `go mod` commands.

---

## 4. Glossary

| Term | Meaning |
|------|---------|
| **Module** | A unit with its own `go.mod` and import path |
| **Workspace** | A local overlay grouping several modules under one `go.work` |
| **`go.work`** | The workspace file (lists `use` directives, Go version, optional `replace`) |
| **`go.work.sum`** | Checksums for modules pulled in only by the workspace (analogous to `go.sum`) |
| **`use`** | A directive in `go.work` naming a local module directory |
| **`replace`** | A directive (in `go.mod` or `go.work`) that redirects an import path |
| **`GOWORK`** | Env var controlling workspace mode (`off`, a path, or auto-discover) |

---

## 5. A minimal worked example

Lay out two modules side by side:

```
workspace/
  mod-a/
    go.mod       module example.com/mod-a
    a.go         package a; func Greet() string { return "hello from a" }
  mod-b/
    go.mod       module example.com/mod-b
    main.go      package main; uses example.com/mod-a
```

`mod-b/main.go`:

```go
package main

import (
    "fmt"
    "example.com/mod-a"
)

func main() {
    fmt.Println(a.Greet())
}
```

Without a workspace, `mod-b` cannot find `mod-a` because `example.com/mod-a` is not published. Create the workspace:

```bash
cd workspace
go work init ./mod-a ./mod-b
go run ./mod-b
# hello from a
```

`go work init` wrote a `go.work` file in `workspace/` listing both modules. Now `go run` builds `mod-b` and resolves `example.com/mod-a` from `./mod-a` on disk.

---

## 6. The `go.work` file

After `go work init` the file looks like:

```
go 1.21

use (
    ./mod-a
    ./mod-b
)
```

Key points:

- `go 1.21` is the workspace-level Go version (separate from each module's own `go` line).
- Each `use` path is a directory containing a `go.mod`.
- The file is plain text; you can edit it by hand or via `go work edit`.

Alongside it you may see `go.work.sum`, which holds checksums for any *extra* dependencies the workspace introduces beyond what each individual module's `go.sum` already covers.

---

## 7. Where the workspace takes effect

`go` looks for a `go.work` starting in your current directory and walking up to the filesystem root (just like `go.mod`). If it finds one, **workspace mode is on** for that invocation. From inside `workspace/`, `workspace/mod-a/`, or any subdirectory, `go build/test/run` will use the workspace.

If you want to run commands as if the workspace did not exist (for example to check how things look against the *published* versions of your modules), set:

```bash
GOWORK=off go build ./...
```

---

## 8. What you do **not** need to change

- The individual `go.mod` files are untouched by `go work init`.
- No `replace` directives are needed in any `go.mod`.
- You do **not** commit `go.work` for personal/local workspaces — convention is to add it (and `go.work.sum`) to `.gitignore`. See `middle.md` for nuance.

---

## 9. A common beginner mistake

Editing `mod-a` and expecting `mod-b` to see the change... but `mod-b/go.mod` still has `require example.com/mod-a v0.1.0`. With the workspace in effect this is fine — the workspace overrides the `require` and uses your local copy. Without the workspace (or under `GOWORK=off`) the require pulls v0.1.0 from the proxy and your local edits are invisible. If something feels wrong, check `go env GOWORK` first.

---

## 10. Summary

A workspace is a local overlay that joins several modules under one `go.work` file so they build against each other from on-disk source. Use `go work init ./mod-a ./mod-b` to create one, leave each module's `go.mod` alone, and treat `go.work` as a developer-local artifact (gitignore it). It replaces the old `replace`-directive trick for multi-module local development.

---

## Further reading
- `go help work`
- Tutorial: Get started with multi-module workspaces — https://go.dev/doc/tutorial/workspaces
- Workspaces reference — https://go.dev/ref/mod#workspaces
