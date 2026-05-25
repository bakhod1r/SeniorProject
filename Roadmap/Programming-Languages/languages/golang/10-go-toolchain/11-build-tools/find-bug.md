# Build Tools — Find the Bug

Each scenario shows a config or invocation that looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — Makefile shell quoting eats the version

```makefile
VERSION := $(shell git describe --tags)
build:
	go build -ldflags=-X main.version=$(VERSION) -o bin/server ./cmd/server
```

**Bug:** the `-ldflags` value is not quoted. When `VERSION` contains a dash (e.g., `v1.2.3-4-gabc`), the shell splits on whitespace inside `-X main.version=...` and the rest is interpreted as separate arguments to `go build`. Worse, if `VERSION` ever contains spaces, the build silently uses a truncated value.

**Fix:** quote the entire `-ldflags` value.

```makefile
build:
	go build -ldflags="-X main.version=$(VERSION)" -o bin/server ./cmd/server
```

---

## Bug 2 — Makefile recipe fails: "missing separator"

```makefile
build:
    go build ./...
```

**Bug:** the recipe line is indented with **four spaces**, but `make` requires recipes to be indented with a **TAB**. The error message ("missing separator") is misleading.

**Fix:** replace the leading whitespace with a single tab character. Make your editor show whitespace, or configure it to use tabs in Makefiles. (Note: this is `make`'s gotcha — `task` uses YAML and has no such trap.)

---

## Bug 3 — `mage build` says "no Go files"

```
$ mage build
error: no Go files in /path/to/repo
```

`magefile.go` exists. The first lines are:

```go
package main

import "github.com/magefile/mage/sh"

func Build() error { return sh.Run("go", "build", "./...") }
```

**Bug:** the file is missing the `//go:build mage` build constraint at the top. Without it, `mage` does not recognize the file as a magefile (and `go build ./...` will also try to compile it alongside production code, which is a separate problem).

**Fix:** add the tag as the **first non-comment line**, followed by a blank line.

```go
//go:build mage

package main
// ...
```

---

## Bug 4 — `goreleaser` config pinned to wrong major version

```yaml
# .goreleaser.yaml
version: 1
builds:
  - main: ./cmd/server
    binary: server
    goos: [linux]
    goarch: [amd64]
```

```bash
$ goreleaser release --snapshot --clean
deprecated: this config schema is for goreleaser v1; you are running v2 ...
```

**Bug:** the file declares `version: 1` but the team is running `goreleaser` v2. v2 changed defaults (e.g., `archives.format` → `archives.formats: [tar.gz]`) and the config silently uses fallbacks that may not match expectations, or hard-fails on removed fields.

**Fix:** update the schema declaration and migrate fields. Run `goreleaser migrate` (or follow the v2 migration guide), set `version: 2`, then re-run `goreleaser check`.

```yaml
version: 2
builds:
  - main: ./cmd/server
    binary: server
    goos: [linux]
    goarch: [amd64]
archives:
  - formats: [tar.gz]
```

---

## Bug 5 — `ko` pushes to the wrong registry

```bash
$ export KO_DOCKER_REPO=gcr.io/old-project
$ ko build ./cmd/server
# image lands in gcr.io/old-project, not the new ghcr.io repo
```

The team migrated to `ghcr.io/me/myrepo` but `KO_DOCKER_REPO` was set in the user's shell rc weeks ago and overrides the team-shared config.

**Bug:** `ko` reads `KO_DOCKER_REPO` from the environment first; `.ko.yaml` cannot override it.

**Fix:** unset the env var (`unset KO_DOCKER_REPO`) and rely on CI/Makefile to set it per invocation, or move the canonical value into a Makefile/Taskfile that sets it explicitly:

```makefile
image:
	KO_DOCKER_REPO=ghcr.io/me/myrepo ko build --bare ./cmd/server
```

Also: review `~/.zshrc`/`~/.bashrc` for stale registry overrides.

---

## Bug 6 — `bazel build` broken because `gazelle` not run

```
$ bazel build //cmd/server
ERROR: /repo/cmd/server/BUILD.bazel:5:11: GoCompilePkg cmd/server failed:
   cmd/server/main.go:5:2: unknown import "example.com/internal/newpkg"
```

The developer just added an import of `example.com/internal/newpkg`. `newpkg/` has Go files but no `BUILD.bazel`. The package compiles fine with `go build`.

**Bug:** `rules_go` requires every dependency to be declared in a `BUILD.bazel`. `gazelle` generates those, but the developer forgot to run it.

**Fix:** run gazelle to regenerate the build files.

```bash
bazel run //:gazelle
bazel build //cmd/server   # now succeeds
```

Wire `bazel run //:gazelle` into a pre-commit hook or a `make tidy` target so it cannot be forgotten.

---

## Bug 7 — `buf` lockfile out of sync

```bash
$ buf generate
Failure: buf.lock has unknown digest for buf.build/googleapis/googleapis
```

`buf.yaml` lists `deps: [buf.build/googleapis/googleapis]` and a teammate bumped it last week without committing the updated `buf.lock`.

**Bug:** `buf.lock` is the source of truth for dependency digests; without a matching entry, `buf` refuses to generate to prevent silent drift.

**Fix:** regenerate the lockfile and commit it.

```bash
buf dep update
buf generate
git add buf.lock
git commit -m "chore: update buf.lock"
```

Add `buf.lock` to your team's PR template checklist when `buf.yaml` changes.

---

## Bug 8 — Two tools fight over `go build` flags

```makefile
# Makefile
VERSION := $(shell git describe --tags --always)
build:
	go build -ldflags="-X main.version=$(VERSION)" -o bin/server ./cmd/server
```

```yaml
# .goreleaser.yaml
builds:
  - main: ./cmd/server
    ldflags:
      - -X main.version=dev
```

```bash
$ make build       # produces "v1.2.3"
$ goreleaser release --snapshot --clean   # produces "dev"
```

**Bug:** the Makefile and `goreleaser` both set `-ldflags` but with different values. Local builds and release builds disagree on the version string. Users get a "dev" CLI from the official release.

**Fix:** one tool owns the flags. `goreleaser` should use its own template (`{{.Version}}`); the Makefile should delegate to `goreleaser` for the build.

```yaml
# .goreleaser.yaml
builds:
  - main: ./cmd/server
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.Commit}}
```

```makefile
# Makefile
build:
	goreleaser build --snapshot --single-target --clean
```

Now `make build` and `goreleaser release` produce binaries with consistent metadata.

---

## Bug 9 — `task` won't run a dependency in parallel

```yaml
version: '3'
tasks:
  all:
    cmds:
      - task: lint
      - task: test
      - task: build
```

The developer expected `task all` to run lint, test, and build in parallel; it runs them serially.

**Bug:** `cmds:` runs items sequentially. Parallelism requires `deps:` (which runs all of them before the task's own `cmds:`).

**Fix:**

```yaml
version: '3'
tasks:
  all:
    deps: [lint, test, build]
```

Now `lint`, `test`, `build` run in parallel and `all` waits for all of them.

---

## Bug 10 — `ko` base image silently changed under us

```yaml
# .ko.yaml
defaultBaseImage: cgr.dev/chainguard/static:latest
```

Last week's image digest: `sha256:abc...`. This week's: `sha256:def...`. Nothing in your repo changed; suddenly your image binary layout shifted and a downstream tool that pinned to last week's digest is broken.

**Bug:** `:latest` (or any floating tag) means the base can change without notice. Reproducibility is dead.

**Fix:** pin the base by digest.

```yaml
defaultBaseImage: cgr.dev/chainguard/static@sha256:abc123...
```

Update the digest deliberately, in a PR, with a changelog note. Renovate/Dependabot can automate the bumps.

---

## How to approach these
1. Quoting fails silently? → inspect the actual invoked command (`make -n`, `task --dry`).
2. "missing separator" / "no Go files" / "unknown import"? → check build constraints and per-tool file requirements first.
3. Two tools producing different artifacts? → find duplicated config (especially `-ldflags`) and put one tool in charge.
4. CI broke without source changes? → suspect floating versions (`@latest`, `:latest`) and pin them by digest/tag.
5. Lockfiles (`buf.lock`, `go.sum`, `MODULE.bazel.lock`) drifting? → regenerate, commit, enforce in CI with `git diff --exit-code`.
