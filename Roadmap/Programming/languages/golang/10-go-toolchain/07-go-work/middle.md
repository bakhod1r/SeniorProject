# go work — Middle

## 1. The four subcommands

`go work` has four operational subcommands plus `vendor` (rarely used at this level):

| Subcommand | Purpose |
|------------|---------|
| `go work init [dirs...]` | Create a fresh `go.work` listing the given module directories |
| `go work use [dirs...]` | Add (or remove) module directories from an existing `go.work` |
| `go work edit [flags]` | Programmatically edit `go.work` (add/drop `use`, set `go`, add `replace`) |
| `go work sync` | Push the workspace's resolved versions back into each member's `go.mod` |

You will type `init` and `use` daily, `edit` occasionally (in scripts), and `sync` rarely but meaningfully.

---

## 2. `go work use`

`go work use` adds a module directory after the workspace exists:

```bash
go work use ./mod-c              # add a new member
go work use -r .                 # recursively add every module under the current dir
go work use ./old-stub -        # NOT a flag; use `go work edit -dropuse ./old-stub` to remove
```

To **remove** a member, use `go work edit -dropuse=./old-stub`. There is no `go work use -drop` shorthand.

`-r` is handy in monorepos:

```bash
go work init
go work use -r .   # add every directory that has a go.mod
```

---

## 3. `go work edit`

Same idea as `go mod edit`: a non-interactive way to modify `go.work` from scripts and Makefiles.

```bash
go work edit -use=./mod-d                       # add a use
go work edit -dropuse=./mod-c                   # remove a use
go work edit -replace=example.com/x=../forks/x  # workspace-wide replace
go work edit -dropreplace=example.com/x
go work edit -go=1.22                           # set the workspace Go version
```

Flags compose: you can pass several `-use=` flags in one call. A dry-run-friendly form is `-print` (write to stdout instead of the file) and `-json` (emit the parsed representation).

---

## 4. `go work sync`

`go work sync` walks the workspace, computes a single consistent set of dependency versions (the workspace build list), and writes those versions back into each member's `go.mod`. It is the bridge between "the workspace currently builds" and "each module individually builds with the same versions."

Run it when:

- You added or upgraded a dependency in one workspace module and you want the others to agree.
- You are about to publish one of the modules and want its `go.mod` to reflect the versions you have actually been testing against.

```bash
go work sync
```

`sync` does **not** add new `require` entries to modules that did not import the dependency; it only aligns versions for modules that already require it.

---

## 5. When `go.work` is in effect (overrides `replace`)

Workspace mode activates when `go` finds a `go.work` walking up from the current directory (same algorithm as `go.mod`). While active:

- Imports for paths covered by `use` directives resolve to the local source.
- `replace` directives in **member `go.mod`** files are **ignored** for paths the workspace handles. The workspace's own `replace` block (if any) takes precedence.
- `require` versions in member `go.mod` files are upgraded as needed to a single workspace-wide build list.

This is the precise reason workspaces are cleaner than `replace`: the override lives in a separate, local-only file instead of being smuggled into committed `go.mod`s.

---

## 6. `.gitignore` convention

Treat `go.work` as a **developer-local** file unless the whole team has agreed otherwise:

```gitignore
# .gitignore
go.work
go.work.sum
```

Two reasons:

1. Workspaces describe **your** disk layout (paths like `../lib`), which differs per developer.
2. CI and downstream consumers must build against published versions, not your local checkout.

Some teams *do* commit a `go.work` — typically in a monorepo where every module lives in the same repo at known paths. In that case the file is a deliberate part of the build, and CI must be designed around it (see `senior.md`).

---

## 7. `GOWORK=off` and explicit paths

The `GOWORK` env var controls workspace mode:

| Value | Behavior |
|-------|----------|
| (unset) | Auto-discover by walking up from CWD |
| `off` | Disable workspace mode entirely; build as if no `go.work` exists |
| `/path/to/go.work` | Use exactly this workspace file, regardless of where you run from |

The two real-world uses:

```bash
# Verify your module builds clean against the published deps
GOWORK=off go test ./...

# Force a specific workspace from anywhere on disk
GOWORK=$HOME/dev/myworkspace/go.work go build ./...
```

---

## 8. Comparison with `replace` directives

| Concern | `replace` in `go.mod` | Workspace (`go.work`) |
|---------|-----------------------|------------------------|
| Where it lives | Committed in module sources | Separate file, typically gitignored |
| Scope | One module at a time | Many modules at once |
| Visible downstream | Yes (until removed) | No — workspace state is local |
| Easy to forget | Yes (must remove before publish) | No (gitignored, never published) |
| Multi-module dev loop | Tedious | Native |

A practical rule: use `replace` only for permanent forks you publish (e.g., a security patch fork). For "I'm developing two related modules and want them to see each other," use a workspace.

---

## 9. Inspecting the workspace

```bash
go env GOWORK             # path to the active go.work, or "off"
cat go.work               # the current directives
go work edit -json        # the parsed representation
go list -m -f '{{.Path}} {{.Version}} {{.Dir}}' all   # see which dir each module resolves from
```

In `go list` output, workspace-resolved modules show their **local directory** as `Dir`, which is how you confirm the overlay is doing its job.

---

## 10. Summary

`go work {init,use,edit,sync}` create and maintain a workspace; `go.work` lives next to your module checkouts and overrides `replace`/`require` for the listed paths. Default policy: gitignore `go.work` because it describes your local disk; use `GOWORK=off` to verify the published-only path; prefer workspaces over committed `replace` directives for parallel development of related modules.

---

## Further reading
- `go help work`, `go help work init`, `go help work edit`
- Workspaces reference — https://go.dev/ref/mod#workspaces
- The original proposal — https://go.googlesource.com/proposal/+/master/design/45713-workspace.md
