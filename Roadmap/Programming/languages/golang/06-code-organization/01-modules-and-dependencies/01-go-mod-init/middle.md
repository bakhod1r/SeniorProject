# `go mod init` — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Module Path: The Real Constraints](#module-path-the-real-constraints)
3. [The `go.mod` File in Depth](#the-gomod-file-in-depth)
4. [Modules vs Packages vs Repositories](#modules-vs-packages-vs-repositories)
5. [Auto-Detection of Module Path](#auto-detection-of-module-path)
6. [`go mod init` and the Working Tree](#go-mod-init-and-the-working-tree)
7. [Multi-Module Repositories](#multi-module-repositories)
8. [Migrating from GOPATH](#migrating-from-gopath)
9. [Renaming a Module](#renaming-a-module)
10. [Versioned Module Paths (`/v2`, `/v3`, ...)](#versioned-module-paths-v2-v3)
11. [Interaction with the Go Toolchain](#interaction-with-the-go-toolchain)
12. [Workspaces and `go.work`](#workspaces-and-gowork)
13. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
14. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

You already know the mechanical effect of `go mod init`: it creates a `go.mod` file. The middle-level question is *what does that file mean to the rest of your tooling*, and *what choices around the module path you will have to live with for years*.

This file zooms out from the command itself to the surrounding decisions: how to choose a path, how modules and repositories relate, how to migrate or split an existing project, and how `go mod init` interacts with workspaces, vendoring, and CI.

After reading this you will:
- Know the formal rules a module path must obey
- Read every directive that may appear in a non-trivial `go.mod`
- Decide between one-module-per-repo and multi-module repos, and know the cost
- Migrate a GOPATH project to modules without breaking it
- Bump a module to `/v2` correctly when its API breaks
- Understand workspaces and when not to use them

---

## Module Path: The Real Constraints

The module path is more constrained than it looks.

### Hard rules (enforced by the toolchain)

1. **At least one component must contain a dot.** `mything` is not a valid module path for *non-local* use; `example.com/mything` is.
2. **Lowercase letters, digits, `.`, `-`, `_`, `~`, `/` only.** Other characters are rejected.
3. **No leading or trailing slash.** No empty components.
4. **No `..` or `.` components.** No path-traversal tricks.
5. **No Windows-reserved characters.** Even on macOS or Linux, the module proxy will reject them.
6. **The version-suffix rule (for `v2+`):** if your major version is 2 or higher, the path **must** end with `/vN` where `N` is the major version. So `github.com/alice/lib` for v0/v1, `github.com/alice/lib/v2` for v2.x.x, and so on. (See [Versioned Module Paths](#versioned-module-paths-v2-v3).)

### Conventional rules (not enforced, strongly recommended)

- Match a real or future repository URL.
- Use the conventional VCS hostnames: `github.com`, `gitlab.com`, `bitbucket.org`, etc.
- Keep the path short; readers see it on every import line.
- Use hyphens, not underscores or camelCase.
- Avoid generic names — `util`, `helpers`, `common`. They are someone else's name too.

### Why the dot

The dot rule is a *future-proofing* convention: it lets the Go tools reliably distinguish a network-resolvable module path from a local-only name. `mything` could plausibly be a folder name on disk; `mything.com` could not.

You can write modules without a dot. They work. But:

- They cannot be `go get`-ed by anyone else.
- The Go module proxy has no way to fetch them.
- IDE jump-to-definition for cross-module references will fail unless the dependency is `replace`-d locally.

For real projects, always use a dot.

---

## The `go.mod` File in Depth

A fresh `go mod init` produces only two directives. A real project's `go.mod` may carry several more. Here is the full vocabulary you may see:

```
module github.com/alice/cooltool

go 1.22

toolchain go1.22.4

require (
    github.com/spf13/cobra v1.8.0
    golang.org/x/sync v0.6.0
)

require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
)

replace github.com/old/lib => ../newlib

exclude github.com/bad/lib v1.2.3

retract v1.0.1 // accidentally tagged

godebug default=go1.22
```

Directive-by-directive:

| Directive | Meaning |
|-----------|---------|
| `module` | The module path. Required. Exactly one. |
| `go` | Minimum Go language version this module requires. Required. |
| `toolchain` | (Go 1.21+) Suggested toolchain version, separate from the `go` directive. Optional. |
| `require` | A direct or indirect dependency at a specific version. Many allowed. |
| `// indirect` | Comment marker meaning "this dep is needed by a dep, not by us directly." |
| `replace` | Substitute one module path/version for another (often a local path). |
| `exclude` | Refuse a particular dependency version. Rare. |
| `retract` | (Go 1.16+) Pull back a previously published version of *this* module. |
| `godebug` | (Go 1.21+) Set runtime `GODEBUG` flags from the module. |

`go mod init` writes only `module` and `go`. Everything else is added later by `go get`, `go mod tidy`, or a hand edit.

### The `go` directive: more than a number

The `go` directive controls language semantics:

- Code in your module may use language features up to the version listed.
- A consumer with an older toolchain will be told to upgrade.
- (Go 1.21+) The directive selectively enables some library and runtime behaviours, including `for`-loop variable semantics.

Bumping `go 1.20` to `go 1.22` is a deliberate decision — review release notes before doing it.

### `toolchain` vs `go`

Confusing pair (added in Go 1.21):

- `go 1.22` says *the source code requires Go 1.22 or newer*.
- `toolchain go1.22.4` says *the build prefers exactly toolchain 1.22.4 (downloading it if needed)*.

Most projects do not need `toolchain`. It exists for teams that want to pin the *exact* toolchain version for reproducibility without upgrading the language minimum.

---

## Modules vs Packages vs Repositories

These three terms are often used loosely. The distinctions matter once you start designing structure.

| Concept | Definition | Example |
|---------|-----------|---------|
| **Repository** | A VCS unit (one Git repo). | `github.com/alice/cooltool` on GitHub |
| **Module** | A subtree containing `go.mod` and the code below it. | The directory whose root has `go.mod` |
| **Package** | A directory of `.go` files sharing a `package` clause. | `package greet` in `greet/` |

Relationships:

- **One repo can contain one module** (the common case). The repo root has the `go.mod`.
- **One repo can contain many modules** (multi-module repo, sub-modules in nested folders).
- **One module can contain many packages** (typically: one per sub-folder).
- **A package always belongs to exactly one module.**

A `.go` file's identity:

```
github.com/alice/cooltool   ← module path
                /greet      ← package path (also folder)
                /greet.go   ← file
```

When you read import paths, you are seeing module path + package sub-path.

---

## Auto-Detection of Module Path

If you run `go mod init` *without* an argument, Go tries to guess:

1. If the working directory is inside `$GOPATH/src/foo/bar`, it guesses `foo/bar`.
2. If a `.git` folder is present and a remote is configured, it parses the URL.
3. If there are import-comments in existing `.go` files (`// import "..."`), it uses that.
4. Otherwise it errors out.

This is *brittle*. A misconfigured Git remote or a relative `.gitconfig` can produce a wrong path. **Best practice: always pass the path explicitly.** The auto-detection is a convenience for people who already know what they are doing.

---

## `go mod init` and the Working Tree

After running `go mod init`, your working tree should look like:

```
project/
├── .git/                ← independent of Go
├── .gitignore
├── go.mod               ← created by `go mod init`
└── README.md
```

Things `go mod init` does NOT do:

- Run `git init` (do this yourself).
- Create a `.gitignore` (you should add one — `vendor/` if you vendor; `*.test` for cached test binaries).
- Create folder structure (no `cmd/`, no `internal/`, no `pkg/`).
- Run `go mod tidy` (it cannot — there is nothing to tidy yet).
- Create `LICENSE`, `README.md`, or any documentation.

A common starter recipe:

```bash
mkdir cooltool
cd cooltool
git init
go mod init github.com/alice/cooltool
cat > .gitignore <<EOF
*.test
*.out
*.exe
/bin/
/dist/
EOF
git add .
git commit -m "init"
```

---

## Multi-Module Repositories

A repository can contain more than one `go.mod`. Each one defines a module rooted at its directory.

### When this is appropriate

- A monorepo with truly independent libraries that release on separate cadences.
- A sample/example sub-folder that should not pollute the parent module's dependency graph.
- A migration period where part of a codebase has moved to modules and the rest has not.
- A `tools/` sub-module that depends on heavy build-time tools you do not want in your runtime closure.

### When it is overkill

- A single application with internal sub-packages.
- A library with examples in `examples/`.
- A project under five contributors.

### How it looks

```
repo/
├── go.mod                     ← module: github.com/alice/repo
├── go.sum
├── lib/
│   └── lib.go                 ← package lib in module github.com/alice/repo
└── tools/
    ├── go.mod                 ← module: github.com/alice/repo/tools
    └── tool.go
```

Two separate modules. They release independently. Their `require` graphs do not mix.

### Costs

- CI must run `go test ./...` *per module* — one run from the repo root won't cover both.
- IDEs sometimes get confused; you may need to open the sub-module folder as its own workspace.
- Cross-module import (the parent importing from the child) requires version-tagging the child *or* a `replace` directive.
- New contributors will not understand the layout for the first hour.

For most projects: do not start multi-module. You can always carve a sub-module out later.

---

## Migrating from GOPATH

If you maintain a pre-1.11 codebase living under `$GOPATH/src/github.com/alice/legacy`, the migration is simple:

```bash
cd $GOPATH/src/github.com/alice/legacy
go mod init   # Auto-detects path from GOPATH location
go mod tidy   # Pulls in dependencies based on existing imports
```

That is usually it. You can then `mv` the directory anywhere on disk; modules do not care.

Things to watch for:

- Old code may use `vendor/` heavily. Decide: keep vendoring (`go mod vendor` after tidy) or remove it.
- Old code may depend on packages that no longer have go-gettable paths (renamed, archived). `go mod tidy` will fail loudly. You will need `replace` directives or fork-and-update.
- Old code may use `$GOPATH/src/...` import paths that now look wrong (uppercase, camelCase). Decide on a canonical path.
- Vendor directories with hand-edited code do not fit cleanly. Prefer `replace github.com/old/lib => ./localfork`.

After migration, `go.mod` at the root and the rest of the repo continues to work. Your `import` statements do not change because module paths preserve the historical naming.

---

## Renaming a Module

Sometimes you must rename:

- A repository was moved from `github.com/alice/lib` to `github.com/team/lib`.
- A v2 boundary requires the path to end in `/v2`.
- The original path was misspelled.

Steps:

1. Edit the first line of `go.mod`:
    ```
    module github.com/team/lib
    ```
2. Run a project-wide find-and-replace on the *old* import path. Tools that help: `gopls`, `goimports`, plain `sed -i` on `.go` files.
3. Run `go build ./... && go test ./...` to confirm.
4. Communicate the rename to dependents (release notes, README banner).
5. Tag a new release.

Older clients still see the old path. Modules **do not auto-redirect**. You typically maintain a deprecation note and possibly a stub module at the old path that imports from the new one.

---

## Versioned Module Paths (`/v2`, `/v3`, ...)

This is the corner of `go mod init` that bites the most middle-level engineers.

### The rule

If your module's major version is 2 or higher, the module path **must** end with `/v<major>`:

```
v0.x.x → github.com/alice/lib
v1.x.x → github.com/alice/lib
v2.x.x → github.com/alice/lib/v2
v3.x.x → github.com/alice/lib/v3
```

`v0` and `v1` share the un-suffixed path, by Go convention.

### Why

It enforces *Semantic Import Versioning*: a breaking change must produce a new import path so consumers do not silently get incompatible code. Two majors of the same module can coexist in a single build because they are, to the toolchain, two different modules.

### How to bump to `/v2`

In the same repository:

1. Edit `go.mod`:
    ```
    module github.com/alice/lib/v2
    ```
2. Find-and-replace `github.com/alice/lib` → `github.com/alice/lib/v2` in **all your own imports** within the module.
3. Tag a release `v2.0.0` from the branch.

Two physical layouts are possible:

- **Major-branch layout:** `v2` lives on a branch (e.g. `main` is now `v2`, `v1` lives on `release-v1`).
- **Major-folder layout:** `v2` lives in a sub-folder (`v2/go.mod` with `module github.com/alice/lib/v2`). Older majors live at the repo root.

Folder layout produces less merge-pain for backports; branch layout produces a cleaner repository.

Either way: `go mod init github.com/alice/lib/v2` (in a fresh project) or an edit to the existing `module` line will set the path correctly.

---

## Interaction with the Go Toolchain

Many tools read `go.mod` directly:

- `go build`, `go run`, `go test` — find the module root, resolve imports, manage `go.sum`.
- `go list -m` — print module path.
- `go list -m -json` — print everything the toolchain knows about your module.
- `go mod graph` — print the dependency graph.
- `go mod why <pkg>` — explain why a particular package is in your build.
- `go mod edit` — programmatically edit `go.mod` (CI-friendly).
- `go env GOMOD` — print the path of the active `go.mod`. Empty if you are not in a module.

If `go env GOMOD` is empty, you are *not* in a module. `go run`, `go build`, and `go test` will fall back to "module-aware mode in a directory with no go.mod," which means: very limited; only standard library packages will resolve.

`go mod init` is the moment the toolchain *finds you*. Before, you are nobody.

---

## Workspaces and `go.work`

Go 1.18 introduced *workspaces*: a way to develop multiple modules in lockstep without pushing intermediate changes.

A workspace is a `go.work` file:

```
go 1.22

use (
    ./api
    ./worker
    ../shared-lib
)
```

Inside the listed modules, the build system stitches them together. Edits in `../shared-lib` are immediately visible in `./api` without `replace` directives or version tags.

Workspaces are *not* a substitute for `go mod init`. Each member of the workspace must still be its own module with its own `go.mod`. The workspace is an editor-and-build overlay above the modules.

When to use:

- Multi-repo development on related libraries.
- Cross-cutting refactor that spans modules.
- Testing a private fork of a dependency without committing a `replace`.

When NOT to use:

- A single application. Do not over-architect.
- Production builds. `go.work` should not be committed unless your team has agreed it is the long-term layout. Many teams `gitignore` it.

---

## Best Practices for Established Codebases

1. **Lock `go` directive at the lowest version your CI guarantees.** If your CI runs Go 1.20, do not write `go 1.22` unless you know all consumers also run 1.22+.
2. **Run `go mod tidy` in CI as a check.** A diff means someone forgot to commit changes to `go.mod` or `go.sum`. Fail the build.
3. **Pin `toolchain`** if your team has reproducibility requirements stricter than the language version.
4. **Document the module path in the README's first paragraph.** Helps newcomers and AI assistants alike.
5. **Use a single module per repo by default.** Carve out sub-modules only when versioning needs diverge.
6. **Prefer `replace` over hand-vendoring** for local forks. Vendor only at release time.
7. **Tag every release** with `v<semver>`. Untagged commits are not real versions to the Go ecosystem.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — `go.mod` drifts from the actual imports

Someone added an import but did not run `go mod tidy`. The build still works locally because Go pulls a transitive dep, but `go.mod` does not reflect intent. Fix: CI step.

### Pitfall 2 — Two `go.mod` files in the same repo by accident

A junior engineer ran `go mod init` in a sub-folder thinking it would "modularise" their code. Now `go test ./...` from the root skips that sub-tree. Fix: delete the inner `go.mod` and let the parent module own it.

### Pitfall 3 — `go.mod` committed without `go.sum`

A failed `go mod tidy` left `go.mod` updated and `go.sum` not. CI on a clean checkout fails because checksums are missing. Fix: always commit them as a pair.

### Pitfall 4 — `replace` directives leak into release builds

A `replace github.com/x/y => ../local-y` was useful for local development but accidentally landed in `main`. Consumers hit it and break. Fix: use `go.work` for local-only changes, never `replace` (unless the replace is genuinely needed for everyone).

### Pitfall 5 — Major-version mismatch on first publish

`go.mod` says `github.com/alice/lib`, but the repo has a `v2.0.0` tag. Consumers who use `go get github.com/alice/lib@v2` will get a confusing error: the major version (`v2`) requires the path to end in `/v2`, but it does not. Fix: rename the path to `/v2` and re-tag, or downgrade the tag to `v1.x.y`.

### Pitfall 6 — Inconsistent module path casing across the team

`github.com/Alice/Lib` on macOS works. On Linux CI it does not (case-sensitive), or vice versa. Always lowercase.

### Pitfall 7 — Forgetting to update `go.mod` when bumping major

Your library's API has a breaking change. Tagging `v2.0.0` is not enough — you must update the module path *and* every import inside the module to match. Otherwise `go get @v2` produces an "ambiguous import" error.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] State the formal rules a module path must obey
- [ ] Explain the difference between `module`, `go`, and `toolchain` directives
- [ ] Decide between one module per repo and a multi-module repo
- [ ] Describe the migration from GOPATH to modules
- [ ] Rename a module without breaking consumers (within reason)
- [ ] Explain why `v2+` paths must end in `/vN`
- [ ] Use `go.work` correctly and explain why it is not committed in many teams
- [ ] Diagnose every pitfall in this file from a stack trace or build error

---

## Summary

`go mod init` is a small command with large downstream consequences. The module path you choose enforces an identity — case-sensitive, hyphen-aware, version-suffixed for major bumps — that propagates to imports, build artifacts, and the public Go module graph. Around `go mod init` sits a vocabulary (`require`, `replace`, `retract`, `godebug`, `toolchain`) and a set of architectural decisions (single vs multi-module, workspace vs not, GOPATH migration) that you need to understand before designing anything beyond a personal project. Get the path right on day one; everything else has a recovery path.
