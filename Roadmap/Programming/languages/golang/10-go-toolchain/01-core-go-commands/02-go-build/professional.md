# go build — Professional

## 1. Standardize the release build

The single most valuable team decision is to make every build identical and reproducible. Centralize the flags so no one builds "their own way":

```makefile
VERSION ?= $(shell git describe --tags --always --dirty)
COMMIT  ?= $(shell git rev-parse --short HEAD)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT)

.PHONY: build
build:
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/app ./cmd/app
```

Now `make build` produces the same binary on every machine and in CI. Code review should reject ad-hoc `go build` invocations in scripts that bypass this.

---

## 2. Policy: which flags are mandatory where

| Context | Required | Forbidden |
|---------|----------|-----------|
| Local dev | none (default `go build`) | — |
| CI fast check | `-o /dev/null ./...` or `go vet` | leaving artifacts |
| Release | `-trimpath`, pinned ldflags, `CGO_ENABLED=0` (if pure-Go) | unstripped debug builds shipped |
| Debug build | `-gcflags="all=-N -l"` | `-s -w` (strips symbols) |

Document this matrix so reviewers and pipeline authors apply it consistently.

---

## 3. Reproducibility as a guarantee

Treat reproducible builds as a deliverable, not a nicety. Requirements:

- Pin the toolchain: `go` directive in `go.mod` plus `GOTOOLCHAIN` policy.
- Pin dependencies: committed `go.sum`, `-mod=readonly` (the default) so a build never silently mutates the graph.
- `-trimpath` to strip developer paths.
- `-ldflags="-buildid="` to zero the build ID where strict bit-for-bit reproducibility is needed.

Verification step in CI: build twice, diff the binaries; or rebuild a tagged release and confirm it matches the published artifact's checksum.

---

## 4. CI caching strategy

Builds dominate CI time; cache aggressively.

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/go-build      # GOCACHE
      ~/go/pkg/mod           # GOMODCACHE
    key: go-${{ runner.os }}-${{ hashFiles('**/go.sum') }}
```

Pair with `go mod download` early (after copying only `go.mod`/`go.sum`) so dependency download caches independently of source changes — the same layering you use in Dockerfiles.

---

## 5. Supply-chain and binary provenance

- Embed `version`/`commit` via `-ldflags -X` so deployed binaries are traceable; verify with `go version -m`.
- Keep VCS stamping on where possible (`go version -m` shows `vcs.revision`, `vcs.modified`); use `-buildvcs=false` only when `.git` is genuinely unavailable, and note it.
- Run `govulncheck` against the built binary or module in CI to catch known-vulnerable dependencies before release.
- Generate and store checksums (and ideally signatures, e.g., cosign) for release artifacts.

---

## 6. Container images

Mandate multi-stage, static, distroless images in review:

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/app

FROM gcr.io/distroless/static:nonroot
USER nonroot
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

Review checklist: no `go run` entrypoint, `CGO_ENABLED=0` for static linking, distroless/scratch base, non-root user, dependency layer cached separately from source.

---

## 7. Reviewing for misuse

| Smell | Why it's wrong | Fix |
|-------|----------------|-----|
| Shipping `-N -l` debug builds | huge, slow, unoptimized | release builds without those gcflags |
| `-s -w` on a binary you must debug | no symbols | drop strip for debug artifacts |
| Hardcoded `version` string in source | drifts from the actual tag | inject via `-ldflags -X` |
| Per-engineer build flags in scripts | non-reproducible | centralize in Makefile/CI |
| `CGO_ENABLED=1` for a pure-Go app in a scratch image | dynamic libc, broken image | `CGO_ENABLED=0` |
| `go build -a` in CI "to be safe" | defeats caching, slow | rely on cache; `go clean -cache` only if corrupt |

---

## 8. Multi-platform releases

Drive a matrix from one place (Make or a tool like GoReleaser):

```bash
for target in linux/amd64 linux/arm64 darwin/arm64 windows/amd64; do
  GOOS=${target%/*} GOARCH=${target#*/} \
  CGO_ENABLED=0 go build -trimpath -ldflags="$LDFLAGS" \
    -o "dist/app-${target/\//-}" ./cmd/app
done
```

GoReleaser is the common team standard: it handles the matrix, checksums, signing, changelogs, and reproducible flags from a single config.

---

## 9. Summary

At team scale, `go build` should never be invoked ad hoc. Centralize flags (`-trimpath`, pinned `-ldflags`, `CGO_ENABLED=0`) in a Makefile or GoReleaser config, guarantee reproducibility via pinned toolchain and dependencies, cache `GOCACHE`/`GOMODCACHE` in CI, embed version/VCS provenance, run `govulncheck`, and ship static distroless images. Enforce all of this in code review.

---

## Further reading
- GoReleaser: https://goreleaser.com
- `govulncheck`: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Reproducible builds: https://go.dev/blog/rebuild
