# `go mod init` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [What Actually Happens When You Run `go mod init`](#what-actually-happens-when-you-run-go-mod-init)
3. [The On-Disk Anatomy of a Module](#the-on-disk-anatomy-of-a-module)
4. [Module Resolution Internals](#module-resolution-internals)
5. [The Module Cache](#the-module-cache)
6. [Module Proxy Protocol](#module-proxy-protocol)
7. [Checksum Database](#checksum-database)
8. [Module Init Performance and Cost](#module-init-performance-and-cost)
9. [`go mod init` in CI/CD Pipelines](#go-mod-init-in-cicd-pipelines)
10. [Programmatic Module Init](#programmatic-module-init)
11. [Build Reproducibility and Hermetic Builds](#build-reproducibility-and-hermetic-builds)
12. [`go.mod` Lockfile Semantics](#gomod-lockfile-semantics)
13. [Edge Cases the Source Code Reveals](#edge-cases-the-source-code-reveals)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats `go mod init` as one node in a larger system: the Go module ecosystem. The command itself is a thin wrapper over a few file-system writes, but it sits on top of a resolution algorithm, a checksum database, a module cache, a public proxy, and CI conventions that determine whether builds are reproducible across machines and years.

This file is for engineers who maintain Go infrastructure, write tooling that interacts with `go.mod`, run private module registries, or are responsible for build hermeticity at scale.

After reading this you will:
- Know what `go mod init` does internally and why it almost never errors
- Reason about module resolution at the level of cache lookups and proxy round-trips
- Author tooling that programmatically creates and edits `go.mod`
- Set up CI gates that enforce reproducibility
- Run private module proxies and checksum databases
- Diagnose pathological module-resolution problems by reading internals

---

## What Actually Happens When You Run `go mod init`

The command is implemented in the [`cmd/go`](https://cs.opensource.google/go/go/+/refs/tags/master:src/cmd/go/internal/modcmd/init.go) package of the Go standard distribution. The high-level flow:

1. **Parse arguments.** Either an explicit module path or none.
2. **Locate the working directory.** Used for both auto-detection and the destination of `go.mod`.
3. **Refuse if `go.mod` already exists.** Returns an error and exits.
4. **Determine the module path.** If passed, validate it. If absent, attempt auto-detection in this order:
    - Look for `// import "..."` comments in nearby `.go` files.
    - Inspect the directory's relationship to `$GOPATH/src`.
    - Inspect Git remote URLs in `.git/config` (and similarly for Mercurial).
    - Use `go.work`'s `use` entries.
    - Fail with "cannot determine module path."
5. **Validate the module path.** Apply the path-syntax rules (lowercase, valid characters, dot in first element, version suffix consistency).
6. **Determine the Go version.** Use the toolchain's own version (e.g., the `go1.22.4` running the command writes `go 1.22`).
7. **Construct the `go.mod` text.** Two directives: `module` and `go`.
8. **Write the file.** A simple file write — no atomic-rename dance, no temp file.
9. **Print a confirmation message** to stderr.

That is it. There are no network calls. There is no `go.sum` write. No directories are created. No code is read or parsed beyond the path-detection step.

### Pseudocode

```go
func runInit(ctx context.Context, args []string) {
    if _, err := os.Stat("go.mod"); err == nil {
        return errModFileExists
    }
    var path string
    if len(args) == 1 {
        path = args[0]
    } else {
        path = guessModulePath(cwd)
    }
    if err := validatePath(path); err != nil {
        return err
    }
    goVersion := strings.TrimPrefix(runtime.Version(), "go")
    goVersion = goVersion[:strings.IndexByte(goVersion, '.')+2] // 1.22 not 1.22.4
    contents := fmt.Sprintf("module %s\n\ngo %s\n", path, goVersion)
    return os.WriteFile("go.mod", []byte(contents), 0644)
}
```

(Real implementation has more polish but the shape is identical.)

---

## The On-Disk Anatomy of a Module

Once `go mod init` has run, the on-disk state grows as you add code:

```
project/
├── go.mod                          ← created by `go mod init`
├── go.sum                          ← appears with first dependency
├── go.work                         ← appears if you `go work init`
├── go.work.sum                     ← workspace-level sums
├── vendor/                         ← if you `go mod vendor`
│   └── modules.txt
└── (your code)
```

### `go.mod` is text and ordered

The file is parsed by [`golang.org/x/mod/modfile`](https://pkg.go.dev/golang.org/x/mod/modfile). It is line-oriented. Comments and blank lines are preserved on round-trips. `require` blocks are sorted alphabetically.

### `go.sum` is hash-anchored

Each line: `<module> <version> <hash-algorithm>:<base64>`. Two lines per dependency: one for the module zip, one for the `go.mod` of that dependency. Hashes are SHA-256 expressed in `h1:` prefixed Base64.

### `go.work` overlays modules

When present, the toolchain treats workspaces as the resolution root. `go.work` adds `use ./modA` directives that override what `go.mod`'s `require` would otherwise produce.

### `vendor/modules.txt`

A reconstruction of the resolved dependency graph in plain text. Required for `-mod=vendor` to work. Generated by `go mod vendor`.

---

## Module Resolution Internals

When `go build` runs, the toolchain performs *module graph resolution* using **Minimum Version Selection (MVS)**:

1. Start with the current module's `require` set.
2. For each required module, transitively load its `go.mod` and recursively resolve.
3. For each module path that appears with multiple version requirements, pick the **highest** required version. (Not the lowest; the name "minimum" refers to the *list*, not the result.)
4. Apply `replace` and `exclude` directives.
5. Verify checksums against `go.sum`.
6. Emit the *build list* — exactly one version per module path.

`go mod init` does not invoke MVS — it predates dependencies. But every later `go build`, `go test`, or `go mod tidy` runs the algorithm with the freshly-named module as the root.

### Why MVS

MVS is **deterministic** and **stable**. Two engineers in the same repo, given the same `go.mod`, get the same build list. Adding a new dependency does not silently bump unrelated dependencies. This is a deliberate contrast with `npm` or `cargo` strategies that solve constraints more eagerly.

The cost: occasional manual upgrades, since "highest required" is not always "newest available." Consumers can `go get -u` to refresh.

### Resolution and the `go` directive

Since Go 1.21, the `go` directive of *each* module participates in resolution: a module declaring `go 1.22` cannot satisfy a consumer declaring `go 1.21` if the higher version triggered different default behaviours. This decouples the module *language version* from the *toolchain version* used to compile it.

---

## The Module Cache

Downloaded modules live in `$GOPATH/pkg/mod` (default `$HOME/go/pkg/mod`).

Inside:

```
pkg/mod/
├── cache/
│   ├── download/                   ← raw downloads, content-addressed
│   │   └── github.com/.../@v/v1.0.0.zip
│   └── lock                        ← coordination lock
└── <module>@<version>/             ← extracted source
```

### Read-only on disk

Files in the module cache are written read-only. This is not just convention — many tools rely on the assumption that once a module version is in the cache, it cannot be modified. This is what makes `go.sum` checksums meaningful.

### Cleanup

`go clean -modcache` deletes everything. Useful in CI to test that a build does not rely on stale state. For day-to-day work, the cache grows but is content-addressed, so duplicates are rare.

---

## Module Proxy Protocol

When the toolchain needs to fetch a module, it goes through a proxy. The default is `https://proxy.golang.org`.

### Endpoints

For module path `github.com/alice/lib`:

- `GET /github.com/alice/lib/@v/list` — list of versions available.
- `GET /github.com/alice/lib/@v/v1.2.3.info` — JSON metadata.
- `GET /github.com/alice/lib/@v/v1.2.3.mod` — `go.mod` of that version.
- `GET /github.com/alice/lib/@v/v1.2.3.zip` — module source archive.
- `GET /github.com/alice/lib/@latest` — latest version's metadata.

`go mod init` does **not** make any of these calls. They happen later, on first dependency resolution.

### Private proxies

Companies often run a private proxy (Athens, JFrog Artifactory, etc.) for:

- Caching popular dependencies (resilience to proxy.golang.org downtime).
- Auditing what their teams import.
- Hosting closed-source modules with auth.

`GOPROXY=https://corp.example.com/proxy,https://proxy.golang.org,direct` tells the toolchain to try the corp proxy first, fall back to the public proxy, and finally talk directly to the VCS.

### `GOPRIVATE`, `GONOPROXY`, `GONOSUMCHECK`

Comma-separated globs:

- `GOPRIVATE=corp.example.com/*` — modules matching this never go to the public proxy or sum DB.
- `GONOPROXY=...` — bypass the proxy but still check sum DB.
- `GONOSUMCHECK=...` — bypass sum DB but still use proxy.

For internal modules, `GOPRIVATE` is almost always what you want.

---

## Checksum Database

`sum.golang.org` is the global, append-only, transparently-verifiable checksum database. The toolchain consults it to verify that the bytes a proxy serves match what was originally published.

### Why this exists

A compromised proxy could otherwise serve malicious bytes for an established module. The sum DB makes such tampering globally detectable: every checksum is logged, the log is signed, and clients can verify inclusion.

### Interaction with `go.sum`

`go.sum` is the *local* record. The sum DB is the *global* record. They must agree. If a sum-DB entry exists for a module/version and `go.sum` disagrees, the toolchain refuses to build with a "checksum mismatch" error.

### Bypassing for private modules

`GONOSUMCHECK` (or `GOSUMDB=off`) disables sum-DB verification for matched paths. Necessary for modules that are not on the public sum DB (i.e., private code).

---

## Module Init Performance and Cost

`go mod init` is one of the cheapest commands in the toolchain.

### Cost breakdown

| Step | Approximate cost |
|------|------------------|
| Argument parsing | < 1 µs |
| `os.Stat("go.mod")` | ~10 µs (filesystem-bound) |
| Path validation | < 1 µs |
| `runtime.Version()` lookup | < 1 µs |
| File write | ~100 µs (filesystem-bound) |
| **Total** | **< 1 ms in practice** |

There is no network. There is no module graph traversal. There is no parsing of any source file beyond optional auto-detection.

### Comparison

| Command | Typical cost on a fresh module |
|---------|-------------------------------|
| `go mod init` | ~1 ms |
| `go mod tidy` (no deps) | ~100 ms |
| `go mod tidy` (10 deps, all cached) | ~500 ms |
| `go mod tidy` (10 deps, cold cache) | 5–60 s (network-bound) |
| `go build .` (cold cache) | seconds–minutes |

`go mod init` is effectively free. Costs come later when the module starts pulling dependencies.

---

## `go mod init` in CI/CD Pipelines

Production teams rarely run `go mod init` in CI — it is a one-time event per repo, run by humans. But several CI patterns interact with it:

### Pattern: drift detection

```yaml
- name: Verify go.mod is tidy
  run: |
    go mod tidy
    git diff --exit-code go.mod go.sum
```

If `go mod tidy` produces a diff, fail. This catches imports that were added without updating `go.mod`.

### Pattern: generated module path

In a code-generation context, you may run `go mod init` programmatically:

```bash
go mod init "$(make-module-path)"
```

The output of `make-module-path` should never be user input. Validate.

### Pattern: monorepo per-module test

In a multi-module monorepo, CI iterates:

```bash
for mod in $(find . -name go.mod -mindepth 2); do
  (cd "$(dirname "$mod")" && go test ./...)
done
```

Each `go.mod` is tested in isolation.

### Pattern: forbid `go mod` mutations

```yaml
env:
  GOFLAGS: -mod=readonly
```

`go build` and `go test` will fail rather than rewrite `go.mod`. Forces the developer to run `go mod tidy` locally and commit.

### Pattern: explicit Go version pin

```yaml
- uses: actions/setup-go@v5
  with:
    go-version-file: go.mod
```

Read the Go version from the `go.mod`'s `go` directive. CI and local developers are guaranteed to use compatible toolchains.

---

## Programmatic Module Init

Tooling that scaffolds projects often runs `go mod init` programmatically. Two approaches:

### Approach 1 — Shell out to `go mod init`

```go
cmd := exec.Command("go", "mod", "init", modulePath)
cmd.Dir = projectDir
cmd.Stdout = os.Stdout
cmd.Stderr = os.Stderr
return cmd.Run()
```

Most reliable. Equivalent to a human running the command.

### Approach 2 — Write `go.mod` directly

Using `golang.org/x/mod/modfile`:

```go
import "golang.org/x/mod/modfile"

f := &modfile.File{}
f.AddModuleStmt(modulePath)
f.AddGoStmt(goVersion)
data, err := f.Format()
if err != nil { return err }
return os.WriteFile(filepath.Join(projectDir, "go.mod"), data, 0644)
```

This is what the toolchain's own implementation does internally. Use it for tools that programmatically maintain many `go.mod` files (workspace generators, scaffolding CLIs, monorepo managers).

### Path validation

Whichever approach, validate the module path *before* writing:

```go
import "golang.org/x/mod/module"

if err := module.CheckPath(modulePath); err != nil {
    return fmt.Errorf("invalid module path %q: %w", modulePath, err)
}
```

This is the same validation the toolchain uses internally — not a re-implementation.

---

## Build Reproducibility and Hermetic Builds

A *hermetic* build produces identical output bytes given identical inputs. Achieving this in Go requires several concerns to align:

### Inputs that must be pinned

- The Go toolchain version (use `toolchain` directive or external manager).
- All dependency versions (via `go.mod` + `go.sum`).
- The state of the module cache (or fresh download against a pinned proxy).
- Compiler flags.

### `go mod init` is not the threat

The first line of defence for reproducibility is `go.sum`. `go mod init` itself does not affect reproducibility; the file it creates is deterministic given the toolchain version and module path argument.

### Reproducibility CI gate

```yaml
- name: Reproducibility check
  run: |
    go build -o build1 ./cmd/app
    go clean -cache -modcache
    go build -o build2 ./cmd/app
    diff build1 build2
```

If the binaries differ across cache states, something is non-deterministic. Common causes: build tags reading the current time, embedded git commit hashes (these are usually intentional — exclude them from the gate).

---

## `go.mod` Lockfile Semantics

`go.mod` is unusual among lockfiles:

- **Co-edited.** Both humans and the toolchain modify it.
- **Comment-preserving.** Manual annotations survive `go mod tidy`.
- **Source of truth for `require`** (not just a snapshot — it controls resolution).
- **Versioned in source control alongside code.**

This contrasts with `package-lock.json` (mostly tool-managed) or `Cargo.lock` (re-generated freely). `go.mod` is treated as part of the source code by Go culture.

### Implication for `go mod init`

What `go mod init` writes today is what consumers will read for years. The `module` line is functionally permanent. Treat the choice with the same care you would treat the package's exported API.

---

## Edge Cases the Source Code Reveals

A close reading of the toolchain source surfaces edges most users never hit:

- The `go` directive may be `go 1` (no minor) — accepted but unusual.
- The toolchain refuses to write a path that *contains* uppercase letters, but does not refuse mixed-case after `replace` resolves to a different path.
- A `go.mod` with `module .` is rejected — module paths cannot be `.`.
- An empty path argument (`go mod init ""`) errors out.
- Paths with non-ASCII characters are rejected by `module.CheckPath`.
- Paths starting with a digit are technically allowed if a dot follows: `123.com/me` works.
- Paths cannot contain `+` characters in the version-suffix position.
- The CLI accepts `--` as an end-of-options marker, so `go mod init -- -weirdname` lets you set a weird (but invalid) name.

These are not things to memorise but to *reach for the source* when something unexpected happens. The toolchain code in `cmd/go/internal/modcmd/init.go` is short and readable.

---

## Operational Playbook

A condensed reference for common operational scenarios.

| Scenario | Recipe |
|----------|--------|
| New project, you control the path | `go mod init github.com/<you>/<project>` |
| New project, vanity path | Configure DNS + meta tag, then `go mod init lib.example.com/<project>` |
| Migrate from GOPATH | `cd $GOPATH/src/...; go mod init; go mod tidy` |
| Add a major version (v2) | Edit `module` line to `<path>/v2`; rewrite imports; tag `v2.0.0` |
| Recover from accidental `go mod init` in wrong folder | Delete the wrong `go.mod`; cd to right folder; re-run |
| Transfer a module to a new owner | Update path in `go.mod`; consider vanity URL pivot; deprecate old module |
| Pull back a broken release | Add `retract v1.2.3` to current `go.mod`; tag a new minor |
| Programmatic init in scaffolding tool | Use `golang.org/x/mod/modfile`; validate with `module.CheckPath` |
| Enforce tidy in CI | `go mod tidy && git diff --exit-code go.mod go.sum` |
| Forbid module mutation in CI | `GOFLAGS=-mod=readonly` |
| Hermetic build verification | Build twice with `go clean -modcache` between; diff binaries |
| Run a private proxy | Deploy Athens; set `GOPROXY` and `GOPRIVATE` org-wide |

---

## Summary

`go mod init` is a thin wrapper over a few file-system writes and path-validation rules. The professional engineer's understanding of it includes everything around the command: the resolution algorithm that uses the file later, the proxy protocol that fetches the module, the checksum database that verifies its bytes, the cache that stores it, the CI gates that prevent drift, and the tooling that programmatically generates `go.mod` for scaffolding workflows. Master those layers and you can reason confidently about why a build fails, why a checksum mismatches, why a path resolves to the wrong code, and why a module that compiled yesterday refuses to compile today.

The simplicity of the command is by design: complexity lives in the resolution layer, not the bootstrap layer. Knowing that boundary is itself the senior insight.
