# Build Tools — Middle

## 1. The decision matrix

The mid-level skill is **picking the right tool**, not knowing all of them. Use this table as a default; deviations need a reason.

| Need | Default pick | Why |
|------|--------------|-----|
| Cross-platform task runner, no extra deps | `make` | Already on every dev/CI box |
| Want clean YAML, Windows support, parallel deps | `task` | Modern Make, no tabs trap |
| Build steps are getting complex (loops, errors, env detection) | `mage` | Use Go as the build language |
| Cut a versioned release with binaries + archives + checksums | `goreleaser` | Solves that exact problem |
| Build container images of Go services for k8s | `ko` | No Dockerfile, deterministic, fast |
| Manage protobufs (lint, breaking-change, codegen) | `buf` | The standard now |
| Polyglot monorepo with strict hermeticity | `bazel` + `rules_go` | Only one that scales there |
| Programmable CI pipeline in Go | `dagger` | Type-checked CI, runs in containers |

Picking is not exclusive — most repos use 2–3 of these. A common combo: `task` for the dev/CI front-door, `goreleaser` for releases, `ko` for images, `buf` for proto.

---

## 2. `make` — the universal denominator

```makefile
BIN     := bin/server
PKG     := ./cmd/server
VERSION ?= $(shell git describe --tags --always --dirty)
LDFLAGS := -X main.version=$(VERSION)

.PHONY: build test lint cover

build:
	go build -ldflags="$(LDFLAGS)" -o $(BIN) $(PKG)

test:
	go test -race -count=1 ./...

lint:
	golangci-lint run

cover:
	go test -coverprofile=cover.out ./...
	go tool cover -html=cover.out -o cover.html
```

Strengths: zero install on Unix. Weaknesses: tab-only indentation, weak quoting, painful on Windows, no native parallel-dep graph beyond `-j`, every variable is a string.

Reach for `make` first when the project is small and the team is comfortable with it.

---

## 3. `task` — Make minus the foot-guns

```yaml
version: '3'

vars:
  BIN: bin/server
  PKG: ./cmd/server
  VERSION:
    sh: git describe --tags --always --dirty

tasks:
  build:
    deps: [lint]
    cmds:
      - go build -ldflags="-X main.version={{.VERSION}}" -o {{.BIN}} {{.PKG}}
    sources:
      - "**/*.go"
    generates:
      - "{{.BIN}}"

  lint:
    cmds:
      - golangci-lint run

  test:
    cmds:
      - go test -race ./...
```

`sources:`/`generates:` give you a real "skip if up to date" check by file hash, not by mtime. Tasks run in parallel via `deps:`. Windows works without WSL.

Reach for `task` when teammates use Windows or your Makefile is starting to grow `ifeq` blocks.

---

## 4. `mage` — Go as the build language

```go
//go:build mage

package main

import (
    "fmt"
    "os"

    "github.com/magefile/mage/mg"
    "github.com/magefile/mage/sh"
)

var Default = Build

// Build compiles the server with embedded version info.
func Build() error {
    mg.Deps(Lint)
    version, _ := sh.Output("git", "describe", "--tags", "--always", "--dirty")
    ldflags := fmt.Sprintf("-X main.version=%s", version)
    return sh.Run("go", "build", "-ldflags="+ldflags, "-o", "bin/server", "./cmd/server")
}

// Test runs the test suite with race detection.
func Test() error {
    return sh.RunV("go", "test", "-race", "./...")
}

// Lint runs static analysis.
func Lint() error {
    if _, err := os.Stat(".golangci.yml"); err != nil {
        return nil
    }
    return sh.RunV("golangci-lint", "run")
}
```

Strengths: real conditionals, error handling, file I/O, libraries you already know. Cross-platform automatically. Weaknesses: requires `mage` installed; build script itself must compile.

Reach for `mage` when your Makefile recipes start invoking `bash -c '...if [[ ... ]] then ... fi...'`. At that point, just write Go.

---

## 5. `goreleaser` — releasing binaries

A custom Makefile that does "build for 6 platforms, archive, checksum, sign, upload to GitHub" is roughly 200 lines of bash. `goreleaser` is a config:

```yaml
# .goreleaser.yaml
version: 2

before:
  hooks:
    - go mod tidy

builds:
  - id: server
    main: ./cmd/server
    binary: server
    env: [CGO_ENABLED=0]
    goos:   [linux, darwin, windows]
    goarch: [amd64, arm64]
    ldflags:
      - -s -w -X main.version={{.Version}} -X main.commit={{.Commit}}

archives:
  - formats: [tar.gz]
    name_template: "{{ .Binary }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}"
    format_overrides:
      - goos: windows
        formats: [zip]

checksum:
  name_template: 'checksums.txt'

snapshot:
  version_template: "{{ .Tag }}-next"

changelog:
  sort: asc
  filters:
    exclude: ['^docs:', '^test:', '^chore:']
```

```bash
goreleaser release --snapshot --clean        # dry run, no publish
goreleaser release --clean                    # real release from a tag
```

Reach for `goreleaser` the moment you ship binaries to users. Do not hand-roll it.

---

## 6. `ko` — container images without a Dockerfile

```bash
export KO_DOCKER_REPO=ghcr.io/me/myrepo
ko build ./cmd/server --bare --tags=$(git rev-parse --short HEAD)
```

What happened:
- Cross-compiled `./cmd/server` for the configured platforms (default: linux/amd64, linux/arm64).
- Placed the binary on top of `cgr.dev/chainguard/static` (configurable).
- Built a multi-arch OCI image, pushed it, and printed the digest.

No `Dockerfile`. No `docker` daemon needed. Reproducible because the image is just `(base) + (Go binary)`.

```yaml
# .ko.yaml
defaultBaseImage: cgr.dev/chainguard/static:latest
builds:
  - id: server
    main: ./cmd/server
    env: [CGO_ENABLED=0]
    flags: [-trimpath]
    ldflags: ["-s -w -X main.version={{.Env.VERSION}}"]
```

Reach for `ko` when your Dockerfile is just `COPY ./app /app + ENTRYPOINT`. Skip it if your image needs system packages or runs anything other than your Go binary.

---

## 7. `buf` — protobuf workflow

Without `buf`, proto work is a tangle of `protoc --go_out --go-grpc_out` invocations with `-I` paths that nobody understands.

```yaml
# buf.yaml
version: v2
modules:
  - path: proto
lint:
  use: [STANDARD]
breaking:
  use: [FILE]
```

```yaml
# buf.gen.yaml
version: v2
plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen/go
    opt: paths=source_relative
  - remote: buf.build/grpc/go
    out: gen/go
    opt: [paths=source_relative, require_unimplemented_servers=false]
```

```bash
buf lint
buf breaking --against '.git#branch=main'   # block breaking changes
buf generate                                  # produce gen/go/**
```

Reach for `buf` on **any** project using protobuf. The old `protoc` flow is technical debt.

---

## 8. `bazel` + `rules_go` — the heavyweight

```python
# cmd/server/BUILD.bazel
load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library")

go_library(
    name = "server_lib",
    srcs = ["main.go"],
    importpath = "example.com/cmd/server",
    deps = ["//internal/api"],
)

go_binary(
    name = "server",
    embed = [":server_lib"],
)
```

```bash
bazel build //cmd/server
bazel test //...
```

Strengths: hermetic builds, cross-language (Go + Java + Python in the same graph), remote build cache, remote execution, surgical incremental builds at huge scale.

Costs: a `BUILD.bazel` per directory (`gazelle` generates them, but you must run it), CI complexity, slow ramp-up for the team, breaks every `go` tool that doesn't understand `bazel`.

Reach for `bazel` only if you have a real polyglot monorepo and a platform team to maintain it. For a pure-Go project, `go build` is already hermetic enough.

---

## 9. `dagger` — programmable pipelines

```go
// dagger/main.go (Go SDK)
func (m *Build) Test(ctx context.Context, src *dagger.Directory) (string, error) {
    return dag.Container().
        From("golang:1.24").
        WithMountedDirectory("/src", src).
        WithWorkdir("/src").
        WithExec([]string{"go", "test", "-race", "./..."}).
        Stdout(ctx)
}
```

Each step runs in a container. Same pipeline runs locally and in any CI. Reach for `dagger` when your CI is too tightly coupled to GitHub Actions YAML and you need it to run identically on developer laptops.

---

## 10. Summary

`make` is the universal floor; `task` is its cleaner replacement; `mage` is for when shell stops scaling and Go is more honest. `goreleaser` owns releases. `ko` replaces Dockerfiles for pure-Go services. `buf` is the protobuf workflow. `bazel` is the heavyweight monorepo build, worth its cost only at scale. `dagger` makes CI itself a Go program. Combine 2–3 tools, do not pile on all of them, and never let two of them try to own the same step.

---

## Further reading
- Task vs Make comparison: https://taskfile.dev/usage/
- Mage handbook: https://magefile.org
- GoReleaser config reference: https://goreleaser.com/customization/
- ko vs Dockerfile: https://ko.build/features/
- Buf style guide: https://buf.build/docs/best-practices/style-guide
- Bazel rules_go usage: https://github.com/bazelbuild/rules_go/blob/master/docs/go/core/rules.md
