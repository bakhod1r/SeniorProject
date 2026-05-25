# Build Tools — Professional

## 1. How `goreleaser` actually orchestrates a release

`goreleaser release` is not magic; it is a deterministic pipeline that you can name step by step:

1. **Setup** — read `.goreleaser.yaml`, run `before.hooks` (typically `go mod tidy`).
2. **Build matrix** — for every `(goos, goarch, goamd64)` tuple in `builds`, fork an isolated build env (its own `GOOS`/`GOARCH`/`CGO_ENABLED`) and call `go build` with the configured `-ldflags`, `-trimpath`, `-tags`. Result: N binaries in `dist/`.
3. **Universal binaries** (optional) — for Darwin, fuse `amd64` + `arm64` into one fat Mach-O.
4. **Archive** — for each binary, produce `tar.gz`/`zip` per template, including extras (LICENSE, README, completions).
5. **Linux packaging** — call `nfpm` to produce `.deb`/`.rpm`/`.apk` from each binary.
6. **Checksums** — produce `checksums.txt` (SHA256 by default).
7. **SBOM** — call `syft` to emit SPDX/CycloneDX for each artifact.
8. **Signing** — call `cosign`/`gpg` to sign archives, checksums, SBOMs.
9. **Container images** (optional) — call `ko` or `docker` to build/push images for each platform.
10. **Manifest** — combine per-arch images into a multi-arch OCI index.
11. **Publish** — upload to GitHub Releases (or GitLab, Gitea), push container manifests, post to Slack/Discord, update Homebrew/Scoop taps.

Every step is opt-in via config. Everything except step 1 is parallelisable. `--snapshot` skips publishing; `--skip=sign,sbom` skips named steps; `--single-target` builds only the host platform. The artifact set is durably described by `dist/artifacts.json` for later analysis.

---

## 2. `ko` — how it builds an OCI image without a Dockerfile

`ko build ./cmd/server`:

1. Resolve `./cmd/server` to a Go import path.
2. For each requested platform (`--platform`, default `linux/amd64,linux/arm64`), call `go build` with `CGO_ENABLED=0` and `-trimpath`, writing to a temp dir.
3. Pull the base image (default `cgr.dev/chainguard/static`) by **digest** from the configured registry (cached locally).
4. Construct a new OCI image as `(base image layers) + (single new layer containing only the Go binary at /ko-app/<name>)`. The binary layer's content is the deterministic tar of one file; its hash is reproducible.
5. Set `Entrypoint: ["/ko-app/<name>"]`, copy `User`, `Env` from base, add labels (`org.opencontainers.image.source`, etc.).
6. For multi-arch, build per-arch images then a manifest list referencing all digests.
7. Push to `$KO_DOCKER_REPO` over the OCI distribution API (no `docker` daemon).

Why this is faster than `docker build`:

- No `Dockerfile` parser, no layer cache miss from `COPY . .`, no shell.
- The new layer is just one file → trivially deterministic.
- Cross-arch is built on the host with Go cross-compilation, not QEMU.

Why this is more deterministic:

- Base pinned by digest (you should pin yours in `.ko.yaml`).
- Single content-addressed layer per platform.
- Same source + same ko + same base = same image digest. You can audit it.

---

## 3. `mage` — how it actually runs

A `magefile.go` is a normal Go program with a magic build tag. When you run `mage build`:

1. `mage` scans the working directory for files with `//go:build mage`.
2. It generates a `main.go` shim that imports your magefile package and switches on `os.Args[1]` to call your exported functions.
3. It writes the generated file to a temp dir, runs `go build` on `(your magefile + the shim)`, producing a binary.
4. The binary is cached at `~/.magefile/<hash>` keyed on the source content. Subsequent runs reuse it (`mage -compile` lets you ship this binary).
5. The binary executes the requested target. `mg.Deps(F)` runs `F` first (each target runs at most once per invocation, like make).

Why `//go:build mage` is mandatory: without it, `go build ./...` in your repo would try to compile your magefile (which has functions named `Build`, `Test`, etc.) as part of your real program, producing duplicate symbols. The tag hides the file from normal Go tooling.

Why it is fast in practice: the binary is cached. `mage build` after the first invocation is essentially "exec a tiny Go binary," not "compile Go then exec."

---

## 4. `bazel rules_go` — reimplementing the Go build graph

Stock `go build` discovers dependencies dynamically by walking imports. Bazel cannot tolerate that — it needs the dependency graph **declared up front** so it can hash inputs and decide what to rebuild.

`rules_go` therefore reimplements Go compilation as a Bazel rule set:

- **`go_library`** — corresponds to one Go package. Declares `srcs`, `deps`, `importpath`.
- **`go_binary`** — links one main package + its transitive `go_library` deps.
- **`go_test`** — like `go_binary`, but for `*_test.go`.

Bazel feeds each `go_library` to the Go compiler in **isolation** (only its declared deps are on the import path). Output is a `.a` archive that becomes an input to the next `go_library`. The link step assembles archives into a binary.

Hermeticity guarantees:

- Toolchain is downloaded by Bazel at a pinned version (`go_register_toolchains`).
- Every input is content-addressed; cache hits are cross-machine via RBE.
- `CGO_ENABLED=0` by default; cgo requires a declared C toolchain.

The cost: a `BUILD.bazel` per directory. `gazelle` generates and updates them from your Go imports, but you must run `bazel run //:gazelle` after adding/removing imports. Forgetting this is the #1 broken-build cause in `rules_go` shops.

---

## 5. `buf` — what it does that `protoc` does not

`protoc` is a single-file compiler; everything else (lint, breaking-change detection, dependency management) was DIY shell scripts. `buf` provides:

- **`buf.yaml`** — declares modules (proto roots), lint rule set, breaking rule set.
- **`buf.lock`** — pins remote proto dependencies (`deps: [buf.build/googleapis/googleapis]`).
- **`buf lint`** — applies a rule set (e.g., `STANDARD`) consistent across the team.
- **`buf breaking --against`** — compares current protos to a baseline; fails CI on breaking changes (per the `FILE`/`PACKAGE`/`WIRE` rule families).
- **`buf generate`** — invokes plugins (local or remote BSR) per `buf.gen.yaml`. Output paths are explicit.

Under the hood, `buf` parses `.proto` files itself (no `protoc` required), then either calls local plugin binaries or remote BSR plugins for code generation. The advantage is that everyone in the repo runs the same plugin **version** because `buf.gen.yaml` pins it.

---

## 6. Reproducibility expectations of each tool

| Tool | Reproducible by default? | What you must do |
|------|--------------------------|------------------|
| `go build` | No (build paths, file timestamps) | `-trimpath`, `-buildvcs=false`, fixed `go.mod`, fixed toolchain |
| `goreleaser` | Mostly | Pin `goreleaser` version in CI; do not use `@latest`; lock `Makefile` to same `-trimpath`/`-ldflags` |
| `ko` | Yes for the binary layer | Pin base image by **digest**, not tag; pin Go version; freeze `KO_DEFAULTPLATFORMS` |
| `mage` | Inherits Go's | Same flags as `go build`; pin tool deps in `go.mod` |
| `bazel rules_go` | Yes by design | Use `MODULE.bazel` with pinned versions; enable `--remote_cache` for cross-machine reuse |
| `buf` | Yes for codegen | Pin plugin versions in `buf.gen.yaml`; commit `buf.lock` |
| `task` | Inherits the commands it runs | Use `sources:`/`generates:` for content-based skip; pin tool versions in commands |

The recurring lever: **pin everything**. The toolchain, the build tool itself, the plugins, the base images, the dependencies. `@latest` is the enemy of reproducibility.

---

## 7. CI integration patterns

```yaml
# .github/workflows/release.yml
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
      id-token: write   # for cosign keyless
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # goreleaser needs full history
      - uses: actions/setup-go@v5
        with: { go-version: '1.24' }
      - uses: sigstore/cosign-installer@v3
      - uses: anchore/sbom-action/download-syft@v0
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: v2.5.0              # PINNED
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- `fetch-depth: 0` is non-negotiable for goreleaser changelogs.
- `goreleaser/goreleaser-action@v6` is the action version; `version: v2.5.0` is the goreleaser version. Both pinned.
- The `id-token` permission is for keyless cosign with Sigstore.

For `ko`:

```yaml
      - uses: ko-build/setup-ko@v0.7
      - run: ko build --bare ./cmd/server
        env:
          KO_DOCKER_REPO: ghcr.io/${{ github.repository }}
```

---

## 8. Build graph composition

When you have multiple tools, draw the graph explicitly:

```
proto sources ── buf generate ──► gen/go/*.pb.go
                                       │
                                       ▼
                                  go build ──► bin/server
                                       │
                                       ▼
                                  goreleaser archive + checksum
                                       │
                                       ▼
                                  ko build (image) + cosign sign
```

The seams are well-defined: `buf` writes `gen/go/`, Go reads from it. `goreleaser` calls `go build`. `ko` is invoked from `goreleaser` (via the `kos:` stanza) or as a separate step.

If any seam becomes implicit ("the Makefile happens to also call protoc somewhere"), find it and make it explicit. Implicit edges in a build graph are how you get the "works on my machine" bug.

---

## 9. Detecting non-reproducibility

Build twice, diff binaries:

```bash
go build -trimpath -ldflags='-buildid=' -o a ./cmd/server
go build -trimpath -ldflags='-buildid=' -o b ./cmd/server
sha256sum a b
diffoscope a b   # if hashes differ, this tells you why
```

For `ko`:

```bash
ko build --push=false --tarball=a.tar ./cmd/server
ko build --push=false --tarball=b.tar ./cmd/server
sha256sum a.tar b.tar
```

For `goreleaser`:

```bash
goreleaser release --snapshot --clean --skip=publish,sign
sha256sum dist/*.tar.gz
# rerun, compare
```

If the hashes drift, the usual culprits are: embedded timestamps, embedded paths (need `-trimpath`), `runtime.buildVersion` differences (different `go` toolchain), or the build tool itself injecting non-deterministic metadata (e.g., release date).

---

## 10. Summary

`goreleaser` is a deterministic build-matrix → archive → SBOM → sign → publish pipeline; every stage is opt-in and replaceable. `ko` cross-compiles Go and stacks the binary on a base image as a single content-addressed layer, no Dockerfile needed. `mage` compiles your build script into a cached Go binary and runs it like make. `bazel rules_go` reimplements the Go build graph with declared dependencies for hermetic, cross-machine caching. `buf` replaces `protoc` and DIY shell with a unified proto workflow (lint, breaking-check, codegen). The reproducibility lever across all of them is **pin everything**: toolchain, tool version, plugins, base images, deps. In CI, make the build graph explicit and verify by hashing the artifacts.

---

## Further reading
- GoReleaser pipeline reference: https://goreleaser.com/customization/
- ko design doc: https://github.com/ko-build/ko/blob/main/docs/configuration.md
- Mage internals: https://github.com/magefile/mage/blob/main/README.md
- rules_go architecture: https://github.com/bazelbuild/rules_go/blob/master/docs/go/core/rules.md
- buf CLI overview: https://buf.build/docs/cli/
- Reproducible builds: https://reproducible-builds.org/
- Sigstore + Go: https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
