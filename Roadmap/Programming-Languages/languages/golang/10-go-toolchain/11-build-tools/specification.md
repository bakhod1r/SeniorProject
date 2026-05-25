# Build Tools — Specification

> **Focus:** Comparison reference for third-party build/release orchestrators in the Go ecosystem.
>
> **Sources:**
> - GNU Make manual: https://www.gnu.org/software/make/manual/
> - Task: https://taskfile.dev
> - Mage: https://magefile.org
> - GoReleaser: https://goreleaser.com
> - ko: https://ko.build
> - Buf: https://buf.build/docs
> - Bazel rules_go: https://github.com/bazelbuild/rules_go

---

## 1. `make` (GNU Make)

**Role.** Universal task runner with file-based dependency declarations. Present on every Unix system; the lowest common denominator.

| Aspect | Value |
|--------|-------|
| Config file | `Makefile` (also `GNUmakefile`, `makefile`) |
| Key invocation | `make <target>` (default: first non-`.`-prefixed target) |
| Common flags | `-j N` (parallel), `-n` (dry run), `-B` (force), `-C dir` (chdir), `-f path` (alt file) |
| When to pick | Cross-team familiarity, no extra dependencies, simple linear flows |
| When to avoid | Windows-first teams, recipes growing shell `if`/loops, deep parallel dep graphs |

**Env vars.** `MAKEFLAGS`, `MAKELEVEL`, plus whatever your recipes export. All vars are strings; everything is text substitution.

**Guarantees.** Files newer than their prerequisites are rebuilt; `.PHONY` targets always run; exit code is non-zero on first failed recipe (unless `-k`).

**Non-goals.** Cross-platform abstraction, structured data, type safety, hermeticity.

---

## 2. `task` (go-task)

**Role.** Modern YAML-based task runner. Cleaner Make replacement with native Windows support and content-hash-based "up-to-date" checks.

| Aspect | Value |
|--------|-------|
| Config file | `Taskfile.yml` (or `Taskfile.yaml`) |
| Key invocation | `task <name>` (default: `default` task) |
| Common flags | `--list`, `--summary`, `--parallel`, `--dry`, `--watch`, `-t path` |
| When to pick | Want Make semantics with cleaner syntax; mixed Windows/Linux/macOS team; content-based skip |
| When to avoid | Logic grows beyond shell snippets — switch to `mage` instead |

**Env vars.** `TASK_TEMP_DIR`, plus per-task `env:` and `dotenv:` files. Variables are typed (`vars:` with `sh:` resolution).

**Guarantees.** `sources:`/`generates:` skip via content hash, not mtime. `deps:` run in parallel; `cmds:` run sequentially. Cross-platform (no `bash` required).

**Non-goals.** Replacing real programming for complex logic; orchestrating releases (use `goreleaser`).

---

## 3. `mage`

**Role.** Build script in Go. Each exported function is a target. Compiled and cached on first run.

| Aspect | Value |
|--------|-------|
| Config file | `magefile.go` (or any `*.go` with `//go:build mage`) |
| Key invocation | `mage <Target>` (target name is case-insensitive) |
| Common flags | `-l` (list), `-h` (help per target), `-v` (verbose), `-compile path`, `-init` |
| When to pick | Build logic needs real control flow, error handling, type-checked deps, cross-platform |
| When to avoid | Team unfamiliar with Go; trivial 5-line flows where Make would do |

**Required tag.** Magefile MUST start with `//go:build mage` to hide it from `go build ./...`.

**Env vars.** `MAGEFILE_VERBOSE`, `MAGEFILE_DEBUG`, `MAGEFILE_CACHE` (default `~/.magefile`), plus whatever your Go code reads.

**Guarantees.** Each target runs at most once per invocation (deduplicated via `mg.Deps`). Build binary cached by source hash. Cross-platform automatically.

**Non-goals.** Replacing release tooling, container build, proto generation.

---

## 4. `goreleaser`

**Role.** Release pipeline orchestrator for Go projects: cross-compile matrix → archive → checksum → SBOM → sign → publish to GitHub/GitLab/Gitea releases, container registries, Homebrew, Scoop, etc.

| Aspect | Value |
|--------|-------|
| Config file | `.goreleaser.yaml` (or `.yml`) |
| Key invocation | `goreleaser release` (full release from a Git tag); `goreleaser build` (just binaries); `goreleaser check` (validate config) |
| Common flags | `--snapshot` (no tag, no publish), `--clean` (wipe `dist/`), `--skip=publish,sign,sbom`, `--single-target` |
| When to pick | Shipping binary releases of CLIs/agents; multi-platform; want changelog + SBOM + signing for free |
| When to avoid | Pure container service (use `ko` directly); internal-only artifact (a Makefile is enough) |

**Env vars.** `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GITEA_TOKEN`, `FURY_TOKEN`, `HOMEBREW_TAP_GITHUB_TOKEN`, `GORELEASER_KEY` (Pro). Build env passes through to `go build`.

**Guarantees.** Deterministic build matrix from config. `--snapshot` produces release-shaped artifacts without publishing. `dist/artifacts.json` describes every produced file.

**Non-goals.** Replacing your dev Makefile; managing protos; running tests (use it after CI passes).

---

## 5. `ko`

**Role.** Build OCI container images for Go programs without a Dockerfile. Cross-compiles statically, layers binary on a small base, pushes via OCI distribution API (no `docker` daemon required).

| Aspect | Value |
|--------|-------|
| Config file | `.ko.yaml` (optional) |
| Key invocation | `ko build ./cmd/server` (push); `ko publish` (alias); `ko apply -f k8s.yaml` (k8s manifest substitution); `ko resolve` (print resolved manifest) |
| Common flags | `--bare` (no path-derived tag suffix), `--local` (load to local docker), `--push=false`, `--platform=linux/amd64,linux/arm64`, `--tags=v1.2.3,latest`, `--tarball=out.tar` |
| When to pick | Pure-Go service, distroless/static base, deterministic multi-arch images, no shell in image |
| When to avoid | Image needs `apt-get` packages, non-Go runtime files, or sidecar scripts |

**Env vars.** `KO_DOCKER_REPO` (required — push target), `KO_DEFAULTBASEIMAGE`, `KO_DEFAULTPLATFORMS`, `KO_DATA_DATE_EPOCH` (for reproducible timestamps), `KOCACHE`.

**Guarantees.** Single application layer per platform. Same Go source + same base digest = same image digest. Multi-arch via manifest list, not QEMU.

**Non-goals.** Building images for non-Go programs; installing system packages; replacing complex Dockerfiles.

---

## 6. `buf`

**Role.** Protobuf workflow: parse, lint, breaking-change detection, dependency management, code generation. Replaces `protoc` + shell scripts.

| Aspect | Value |
|--------|-------|
| Config files | `buf.yaml` (modules/lint/breaking config), `buf.gen.yaml` (codegen plugins), `buf.lock` (pinned remote deps) |
| Key invocation | `buf lint`, `buf format`, `buf breaking --against <ref>`, `buf generate`, `buf dep update`, `buf push` (to BSR) |
| Common flags | `--config path`, `--path file/dir` (subset), `--exclude-path`, `--error-format=json` |
| When to pick | Any project using protobuf; want pinned plugin versions, CI breaking-change guards, no `protoc -I` juggling |
| When to avoid | One-off `.proto` with no team or CI dimension — `protoc` will do |

**Env vars.** `BUF_TOKEN` (BSR auth), `BUF_INPUT_HTTPS_USERNAME`/`PASSWORD`, `BUF_CACHE_DIR`.

**Guarantees.** Deterministic codegen given pinned plugin versions. `buf.lock` ensures every developer gets identical remote proto deps. `buf breaking` enforces wire-compat rules.

**Non-goals.** Replacing your Go build; running tests; non-protobuf codegen.

---

## 7. `bazel` + `rules_go`

**Role.** Hermetic, scalable build system for polyglot monorepos. Declares the Go build graph explicitly so Bazel can cache and parallelize across machines.

| Aspect | Value |
|--------|-------|
| Config files | `MODULE.bazel` (module + deps), `BUILD.bazel` per directory (rules: `go_library`, `go_binary`, `go_test`), `WORKSPACE` (legacy) |
| Key invocation | `bazel build //...`, `bazel test //...`, `bazel run //cmd/server`, `bazel run //:gazelle` (regenerate BUILD files) |
| Common flags | `--config=ci`, `--remote_cache=URL`, `--platforms`, `--test_filter`, `--sandbox_debug` |
| When to pick | Polyglot monorepo, > 10 min builds, >100 engineers, need remote build cache/RBE, strict hermeticity |
| When to avoid | Pure-Go small/medium repo (`go build` is already hermetic enough); no platform team |

**Env vars.** `BAZEL_REMOTE_CACHE`, `USE_BAZEL_VERSION` (Bazelisk), plus toolchain-pinned via `MODULE.bazel`. Avoid mutating `GOFLAGS`/`GOOS` in the shell — Bazel manages them.

**Guarantees.** Content-addressed inputs/outputs; hermetic toolchain; cross-machine cache reuse via RBE; surgical incremental rebuilds.

**Non-goals.** Being lightweight; integrating seamlessly with `gopls`/`go test ./...`; small-team productivity.

---

## 8. Cross-cutting environment

| Variable | Affects | Notes |
|----------|---------|-------|
| `GOCACHE` | `go build`, `mage`, anything calling `go` | Persist across CI jobs |
| `GOMODCACHE` | Same | Persist across CI jobs |
| `GOFLAGS` | All Go invocations | Common: `-mod=readonly`, `-trimpath` |
| `CGO_ENABLED` | All builds | Set `=0` for static binaries (ko default) |
| `GOOS`, `GOARCH` | All cross-builds | Goreleaser/ko derive from config, not env |
| `SOURCE_DATE_EPOCH` | Reproducibility | `ko` and others respect this for timestamps |

---

## 9. Behavioural guarantees, summarised

| Tool | Reproducible | Hermetic | Cross-platform dev | Native parallelism |
|------|--------------|----------|---------------------|--------------------|
| `make` | Inherits commands | No | No (needs `bash`) | `-j N` |
| `task` | Inherits commands | No | Yes | `deps:` parallel |
| `mage` | Inherits Go | No (Go's hermeticity) | Yes | `mg.Deps` parallel |
| `goreleaser` | Strong (if pinned) | No | Builds for any platform | Build matrix in parallel |
| `ko` | Strong | No (uses host Go) | Builds for any platform | Multi-arch parallel |
| `buf` | Strong (with `buf.lock`) | Mostly | Yes | Per-file parallel |
| `bazel rules_go` | Strong (designed for it) | Yes | Yes | Designed for parallel/RBE |

---

## 10. Picking by problem statement

| Problem | Pick |
|---------|------|
| "I need one command to build/test/lint." | `make` or `task` |
| "Our Makefile has 200 lines of bash conditionals." | `mage` |
| "Cut a multi-platform CLI release on a Git tag." | `goreleaser` |
| "Ship a Go service to Kubernetes." | `ko` |
| "Manage protobuf APIs across services." | `buf` |
| "Polyglot monorepo with 50+ services and a platform team." | `bazel rules_go` |
| "Programmable CI that runs identically locally." | `dagger` |
| "I want my CI to never surprise me on a no-op rerun." | Pin every tool by version; no `@latest`, no `:latest` |

---

## 11. Related references
- `make` manual: https://www.gnu.org/software/make/manual/make.html
- Task docs: https://taskfile.dev/usage/
- Mage docs: https://magefile.org/
- GoReleaser customisation: https://goreleaser.com/customization/
- ko configuration: https://ko.build/configuration/
- Buf reference: https://buf.build/docs/reference/
- rules_go core rules: https://github.com/bazelbuild/rules_go/blob/master/docs/go/core/rules.md
- Reproducible builds: https://reproducible-builds.org/
