# Build Tools — Junior

## 1. What is a "build tool" in the Go world?

Go already has `go build`, `go test`, `go install`, `go generate`. So why do projects pull in extra tools like `make`, `task`, `mage`, `goreleaser`, `ko`?

Because `go build` only knows how to compile **one** Go package into **one** binary. Real projects need to orchestrate higher-level workflows:

- Build several binaries (`./cmd/server`, `./cmd/worker`, `./cmd/cli`) at once.
- Cross-compile for `linux/amd64`, `linux/arm64`, `darwin/arm64`.
- Run lint, tests, codegen, and build in the right order.
- Package a binary into a tar archive, RPM, deb, or container image.
- Cut a versioned GitHub release with changelog, checksums, signatures, SBOM.
- Generate Go code from `.proto` files before compilation.

These are **orchestration** problems, not compilation problems. A build tool is the script that glues all of it together so a teammate (or CI) can type one command and get a reproducible result.

---

## 2. The cast of characters

| Tool | One-line role |
|------|---------------|
| `make` | The 1977 universal task runner. Every Unix has it; syntax is gnarly. |
| `task` | A modern YAML-based `make` replacement. Clean and simple. |
| `mage` | "Make in Go." You write your build steps as Go functions. |
| `goreleaser` | Release automation: build matrix + archive + checksums + GitHub release. |
| `ko` | Build an OCI container image of your Go program without a Dockerfile. |
| `buf` | The Protobuf workflow tool (lint, breaking-change check, codegen). |
| `bazel` + `rules_go` | Hermetic, scalable build system for polyglot monorepos. |
| `dagger` | Programmable CI pipelines (Go SDK) that run inside containers. |

You will not use all of them in one project. The Junior job is to recognise them when you see them in someone else's repo.

---

## 3. Why not just use shell scripts?

Shell scripts work for one machine, one developer. They start to hurt when:

- Targets depend on each other (`build` needs `generate` needs `proto`).
- You want to skip work that is already done.
- The script has to run on Linux, macOS, and Windows.
- You want self-documenting commands (`make help`).

Build tools give you **named targets, dependency declarations, and parallelism** for free.

---

## 4. A minimal Makefile

```makefile
# Makefile
.PHONY: build test lint clean

build:
	go build -o bin/server ./cmd/server

test:
	go test ./...

lint:
	go vet ./...

clean:
	rm -rf bin/
```

Usage:

```bash
make build       # compiles to bin/server
make test
make build test  # runs both
```

Two things that bite newcomers:
- Recipes must be indented with a **TAB**, not spaces. The error is cryptic.
- `.PHONY` tells `make` these targets are not real files (otherwise `make build` would skip if a file named `build` exists).

---

## 5. The same thing as a Taskfile

`task` (taskfile.dev) takes the same idea but uses YAML, which is far less hostile:

```yaml
# Taskfile.yml
version: '3'

tasks:
  build:
    cmds:
      - go build -o bin/server ./cmd/server

  test:
    cmds:
      - go test ./...

  lint:
    cmds:
      - go vet ./...

  clean:
    cmds:
      - rm -rf bin/
```

```bash
task build
task test
task --list   # self-documenting
```

No tabs-vs-spaces trap. Cross-platform (Windows works without WSL). Has `deps:` for ordering.

---

## 6. The same thing as a magefile

`mage` lets you write your build script **in Go**. Each exported function is a target.

```go
//go:build mage

package main

import (
    "github.com/magefile/mage/sh"
)

// Build compiles the server binary.
func Build() error {
    return sh.Run("go", "build", "-o", "bin/server", "./cmd/server")
}

// Test runs the test suite.
func Test() error {
    return sh.Run("go", "test", "./...")
}
```

```bash
mage build
mage test
mage -l   # list targets
```

The `//go:build mage` line at the top is **mandatory**. Without it, `go build ./...` tries to compile your build script as normal code and breaks.

---

## 7. A peek at `goreleaser`

You do not write a Makefile target like "build for 6 platforms, tar them up, sign them, create a GitHub release." You write a config and let `goreleaser` do it.

```yaml
# .goreleaser.yaml
version: 2
builds:
  - main: ./cmd/server
    binary: server
    goos: [linux, darwin]
    goarch: [amd64, arm64]
archives:
  - formats: [tar.gz]
checksum:
  name_template: 'checksums.txt'
```

```bash
goreleaser release --snapshot --clean   # dry run, no upload
```

You get a `dist/` directory with six binaries, six tarballs, and a `checksums.txt`. That is one command replacing dozens of shell lines.

---

## 8. A peek at `ko`

`ko` builds a container image of your Go program **without writing a Dockerfile**. No `docker build`, no shell, no base image with apt-get.

```bash
ko build ./cmd/server
# → gcr.io/your-project/server:abc123 (pushed)
```

It cross-compiles your Go binary statically, puts it on top of a tiny base image (distroless by default), and pushes the image to the registry from `KO_DOCKER_REPO`. Fast, deterministic, no shell in the image.

---

## 9. When does a junior touch which?

| You are... | You will probably see |
|------------|------------------------|
| New on a repo | `Makefile` or `Taskfile.yml` — read it to learn the commands |
| Adding a CI step | The repo's existing build tool — extend it, don't replace it |
| Releasing v1.0 of a CLI | `goreleaser` |
| Deploying a Go service to Kubernetes | `ko` (often) |
| Working with gRPC | `buf` |
| Joining a huge monorepo | `bazel` + `rules_go` |

You almost never introduce a build tool on your first day. You learn the one your team already uses.

---

## 10. Summary

Go's built-in commands compile code; build tools orchestrate everything around it: multi-binary builds, codegen, lint, tests, releases, container images. `make` is universal but ugly; `task` is a YAML-clean alternative; `mage` lets you script builds in Go; `goreleaser` handles releases; `ko` builds container images without Dockerfiles; `buf` handles protobuf workflows; `bazel` is the heavyweight choice for polyglot monorepos. As a junior, read the build file in the repo you join — that is the documentation for "how do I build/test/run this thing."

---

## Further reading
- GNU Make manual: https://www.gnu.org/software/make/manual/
- Task: https://taskfile.dev
- Mage: https://magefile.org
- GoReleaser: https://goreleaser.com
- ko: https://ko.build
- Buf: https://buf.build/docs
- Bazel rules_go: https://github.com/bazelbuild/rules_go
