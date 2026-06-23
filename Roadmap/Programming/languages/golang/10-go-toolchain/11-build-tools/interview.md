# Build Tools — Interview Q&A

A mix of conceptual and practical questions across levels. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. Go has `go build` — why does any project also need `make`, `task`, or `mage`?**
`go build` compiles one package into one binary. A real project needs to orchestrate higher-level workflows: build multiple binaries, generate code first, run lint and tests, cross-compile, build container images, cut releases. Build tools name those workflows and run them in the right order.

**Q2. What is the difference between `make`, `task`, and `mage` at a high level?**
All three are task runners. `make` is the 1977 universal one (tab-indented Makefile, hostile syntax). `task` is the modern YAML replacement (clean, cross-platform). `mage` lets you write build steps as Go functions. Pick by team preference and complexity.

**Q3. What does `goreleaser` do that a Makefile cannot easily do?**
Cross-compile for many platforms, archive each binary with the right format, generate checksums, generate SBOMs, sign artifacts, create a GitHub release with a changelog, push container images, update Homebrew/Scoop taps — all from one config, in parallel. A Makefile would be 200+ lines of bash to do the same thing badly.

**Q4. What does `ko` build, and why is there no Dockerfile?**
`ko` cross-compiles your Go binary and lays it on top of a tiny base image (distroless by default), producing an OCI image. There is no Dockerfile because the image content is deterministic: `(base) + (your binary)`. No shell, no `apt-get`, no layer churn from `COPY . .`.

---

## Middle

**Q5. When would you choose `task` over `make`?**
When teammates use Windows (no `bash`), when you want native parallel `deps:`, when content-hash based skip (`sources:`/`generates:`) matters, or when the Makefile is starting to grow `ifeq`/`shell` blocks. Otherwise `make` is fine.

**Q6. When does `mage` win over `task`?**
When build logic stops being a list of shell commands and starts needing real conditionals, error handling, JSON parsing, file I/O, or your own Go helpers. At that point, writing it in Go is more honest than escaping bash inside YAML.

**Q7. What does `buf generate` give you over running `protoc` directly?**
A declarative config (`buf.gen.yaml`) pinning plugin versions, a lockfile for remote proto deps, lint and breaking-change checks (`buf lint`, `buf breaking`), and no `-I` path juggling. Everyone in the repo runs the same plugin version, so generated code is consistent.

**Q8. Your team ships a CLI for macOS/Linux/Windows. What is the minimum tool you reach for?**
`goreleaser`. It is the canonical answer for "cut a multi-platform binary release with checksums and a GitHub release page." Hand-rolling this is a waste of engineering time.

---

## Senior

**Q9. Two build steps both call `go build` with different `-ldflags`. How do you fix that architecturally?**
One tool owns `go build`. Others delegate. For releases, `goreleaser` (or `bazel`) owns it; the dev Makefile shells out to `goreleaser build --snapshot --single-target` for local builds so the flags are identical. The bug pattern is `make build` and `goreleaser release` producing binaries with different version strings; the fix is single ownership.

**Q10. Your service Dockerfile is `FROM golang:1.24 AS build / RUN go build / FROM distroless / COPY / ENTRYPOINT`. Should you switch to `ko`?**
Yes — that is the exact shape `ko` solves for. Smaller image (no toolchain), faster build (no `docker` daemon, no shell), deterministic single binary layer, easier multi-arch (no QEMU). Keep the Dockerfile only if the image actually needs `apt-get` packages or non-Go runtime files.

**Q11. When is `bazel` the wrong answer for a Go-only project?**
Almost always. `bazel` pays off on polyglot monorepos (Go + Java + Python + frontend) at scale (100+ engineers, >10 min builds), where you need remote execution and surgical incremental builds. For a pure-Go service or even 10 services, `go build` is already hermetic enough and `bazel`'s `BUILD.bazel`-per-directory tax is not worth it.

**Q12. How do you make a build "reproducible" with these tools?**
Pin everything: Go toolchain version, build-tool version (no `@latest`), plugin versions, container base images by digest, all module deps via `go.sum`. Use `-trimpath -buildvcs=false`, strip build IDs in `-ldflags="-buildid="`. Hash the artifacts and rebuild on a fresh checkout; bytes must match.

---

## Professional

**Q13. Walk through what happens when you run `goreleaser release`.**
Read config → run `before.hooks` → for each `(GOOS, GOARCH)` build a binary with the configured flags → optionally fuse Darwin universal binary → archive → produce `.deb`/`.rpm` via `nfpm` → write `checksums.txt` → generate SBOMs with `syft` → sign with `cosign`/`gpg` → optionally build container images via `ko`/`docker` → assemble multi-arch manifest → publish to GitHub Releases, container registries, Homebrew tap, etc. All driven by `.goreleaser.yaml`, all parallelisable, all opt-in.

**Q14. Why is `//go:build mage` required at the top of a magefile?**
Without it, `go build ./...` in your repo will try to compile your magefile alongside production code, producing duplicate symbols (your magefile has functions like `Build`, `Test`) and possibly a broken binary. The tag hides the file from normal Go tooling so only `mage` sees it.

**Q15. How does `ko` produce a deterministic image without a Dockerfile?**
It cross-compiles the binary with `CGO_ENABLED=0` and `-trimpath`, pulls the base image by digest, constructs an OCI image as `(base layers) + (single tar layer containing just the Go binary at /ko-app/<name>)`, and pushes it via the OCI distribution API. Same source + same `ko` + same base digest yields the same image digest — auditable byte-for-byte.

**Q16. What is the role of `gazelle` in a `rules_go` repo, and what breaks if you forget to run it?**
`gazelle` generates and updates `BUILD.bazel` files from your Go imports. If you add a new import in `.go` files but forget `bazel run //:gazelle`, Bazel still uses the stale `BUILD.bazel`, the new dependency is not declared, and the build fails with "unknown import" or links against the wrong package. Wire it into a pre-commit hook or `make tidy`.

---

## Common traps

- Choosing a tool by familiarity rather than by problem (e.g., `bazel` for a 3-service Go repo).
- Letting two build tools set `go build` flags independently — they will disagree and you will ship the wrong version string.
- Pinning the build tool itself to `@latest` and wondering why CI changes between Tuesday and Wednesday.
- Forgetting `//go:build mage` and breaking `go build ./...`.
- Pinning the `ko` base image by tag (`:latest`, `:nonroot`) instead of digest — image digest changes silently when the base is republished.
- Skipping `fetch-depth: 0` in GitHub Actions and getting empty `goreleaser` changelogs.
- Running `buf generate` but committing without `buf.lock` so teammates regenerate different code.
- Adopting `dagger`/`bazel`/`mage` to "modernise" a setup that nobody complained about.
- Putting `make build` and `goreleaser release` in the same CI without verifying they produce equivalent artifacts.
- Using `ko` for images that need system packages — it cannot install them; you must keep a Dockerfile.
- Assuming `mage` is slow because it "compiles every time" — it caches the build binary in `~/.magefile/`.
- Mixing `task` and `make` in the same repo so newcomers don't know which is the front door.
