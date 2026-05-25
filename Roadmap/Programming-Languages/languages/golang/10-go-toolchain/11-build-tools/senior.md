# Build Tools — Senior

## 1. The architectural question

At senior level, the question is not "which tool do I use?" but **"what is the contract between my code, my build tool, and my deploy target?"** The build tool is the boundary between:

- Source repo (Go modules, protos, configs)
- Artifacts (binaries, container images, archives, SBOMs, signatures)
- Deploy targets (Kubernetes, GitHub Releases, package registries)

A senior engineer chooses tools that make that boundary explicit, reproducible, and replaceable. A junior chooses by familiarity.

---

## 2. Replacing a 400-line release Makefile with `goreleaser`

The "I want to ship binaries" Makefile inevitably grows tentacles: cross-compile loops, version embedding, tarball naming, checksum files, GitHub release upload, draft/pre-release flags, signing, SBOM generation. By month 6 it is unreadable.

`goreleaser` is the right replacement when:

- You produce **binary releases** (CLIs, agents) consumed by humans or `apt`/`brew`.
- You want changelog + signatures + SBOM + Homebrew tap from one config.
- The CI tag → release flow needs to be the same locally and remotely (`--snapshot`).

It is the **wrong** replacement when:

- You only produce container images for one platform → use `ko`.
- You produce binaries that are immediately consumed by your own service (no human in the loop) → a Makefile is enough.

Migrating: keep the old Makefile, add `make release` that shells out to `goreleaser`, delete the old loops once parity is proven on a snapshot.

---

## 3. Replacing a Dockerfile with `ko`

A typical Go service Dockerfile is:

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static
COPY --from=build /out/server /server
ENTRYPOINT ["/server"]
```

That is **exactly** what `ko build ./cmd/server` does — minus the shell, minus the `docker` daemon, minus the layer churn from `COPY . .` busting cache.

Replace with `ko` when:

- The image is pure Go binary on a static/distroless base.
- You care about deterministic, reproducible layers and digest stability.
- You ship multi-arch.

Keep a Dockerfile when:

- You need `apt-get install` for system packages (e.g., ImageMagick).
- The image runs more than just your Go binary (sidecar scripts, init shell).
- You need to support team members who don't want a second build tool.

`ko` images have one beautiful property: the binary layer is byte-identical for byte-identical Go source. Two `ko build`s of the same commit yield the same digest. Dockerfiles rarely achieve this without effort.

---

## 4. The `bazel` decision

`bazel` + `rules_go` is sometimes pitched as "the proper way to build Go." It is not. It is **the proper way to build a polyglot monorepo at scale.** The break-even points:

| Signal | Lean toward `bazel` | Lean away |
|--------|---------------------|-----------|
| Languages in repo | Go + Java + Python + protos + frontend | Go only |
| Build time | > 10 min on a clean CI | < 2 min |
| Engineers | 100+ | 5 |
| Need remote execution / RBE | Yes | No |
| Need surgical "only test what changed" | Yes | No |
| Existing platform team for `bazel` | Yes | No |
| `go install ./...` still feels fast | — | Yes — stay |

If your repo is a handful of Go modules, `bazel` will cost more in `BUILD.bazel` maintenance, CI complexity, and "why doesn't gopls work" tickets than it gives back. Cost of entry is roughly one full-time engineer-quarter for a non-trivial codebase.

The flip side: if you have rules_go and rules_oci wired up well, you get hermetic builds, content-addressed cache hits across machines, and "this binary was built from exactly these sources" attestation effectively for free.

---

## 5. `mage` as the Go-native escape hatch

Reach for `mage` when **shell becomes the problem**:

- Recipes need real loops, error handling, parsing JSON.
- Cross-platform support matters (no `bash` on Windows).
- The build script needs to import Go libraries you already wrote.
- You want type-checked targets.

A senior pattern: keep a tiny `Makefile` that delegates to `mage` for the gnarly bits, so the front door is still familiar:

```makefile
.PHONY: build release
build:
	mage build
release:
	mage release
```

This gives newcomers `make build` muscle memory while letting the actual logic live in Go.

---

## 6. Don't let two tools fight over the same step

The single most common architectural smell: **two build tools both deciding `go build` flags.**

Example: a Makefile passes `-ldflags="-X main.version=$(VERSION)"`, and the `.goreleaser.yaml` also sets `ldflags:`, with a different value. `make release` produces v1.2.3 binaries; `goreleaser release` produces "dev" binaries. The first time you notice is when a customer reports "the CLI prints `dev` for its version."

Rules:

1. **One tool owns `go build`.** Others delegate to it.
2. The release tool (usually `goreleaser` or `bazel`) wins for releases. The dev tool (`make`/`task`/`mage`) wins for local builds.
3. Local `make build` should ideally **also** call the release tool in dry-run mode (`goreleaser build --snapshot --single-target`) so the version, ldflags, and trimpath are identical.

---

## 7. Layering — front door, body, exit

A scalable build stack has three layers:

```
front door  →  make / task / mage          (what humans type)
body        →  go, buf, golangci-lint      (what actually runs)
exit        →  goreleaser, ko, helm/k8s    (what produces artifacts)
```

The front door is for ergonomics. The body is the underlying toolchain. The exit produces shippable artifacts. Each layer should know about the layer below, but not the layer above. The exit layer (goreleaser, ko) should be invokable directly in CI without going through the front door — that decouples release automation from local dev preferences.

---

## 8. Reproducibility budget

Senior engineers should be able to answer: **"Given commit X, will tomorrow's build of it be byte-identical to today's?"**

| Tool | Default reproducibility | What to add |
|------|------------------------|-------------|
| `go build` | Mostly (timestamps, paths leak) | `-trimpath`, `-buildvcs=false`, pinned `go.mod` |
| `goreleaser` | Same as `go build` + archive timestamps | `--clean`, pin tool versions, no `@latest` |
| `ko` | Strong (deterministic image layers) | Pin base image by digest, not tag |
| `bazel` | Strong (designed for it) | Lockfiles + pinned toolchain |
| `mage` | Same as `go build` | Pin tool deps in `go.mod` |

If reproducibility is a compliance requirement (SLSA L3, supply-chain attestation), this is your starting checklist.

---

## 9. The "no, you do not need that tool" reflexes

| Someone suggests... | Push back with |
|---------------------|----------------|
| "Let's adopt `bazel` for our 3-service Go repo." | "What problem is `go build` not solving? It's already hermetic enough at our size." |
| "We need a Dockerfile for our Go service." | "We have `ko`; it produces a smaller, more deterministic image with no shell." |
| "Add `dagger` to wrap our CI." | "Our CI is 80 lines of YAML and works. What pain point justifies a new tool?" |
| "Pin `goreleaser` to `latest` in CI." | "No. Version drift breaks reproducibility. Pin to a tag." |
| "Move everything from Makefile to `task`." | "Show me what `task` enables that `make` doesn't, and weigh it against onboarding cost." |

The role is not "more tools" but "fewer, well-chosen tools."

---

## 10. Summary

Choose `goreleaser` when the Makefile release target grows tentacles. Choose `ko` when your Dockerfile is just `COPY` + `ENTRYPOINT`. Choose `bazel` only with a polyglot monorepo and a platform team to maintain it. Use `mage` as a Go-native escape hatch when shell becomes painful. Never let two tools own `go build` — one owns it, the others delegate. Layer the stack as front-door / body / exit so each piece is replaceable. Treat reproducibility as a budget you spend deliberately.

---

## Further reading
- GoReleaser internals: https://goreleaser.com/intro/
- `ko` design: https://ko.build/features/
- Bazel + Go at scale: https://bazel.build/rules/lib/repo/go
- SLSA build levels: https://slsa.dev/spec/v1.0/levels
- Reproducible Go builds: https://go.dev/ref/mod#build-list
