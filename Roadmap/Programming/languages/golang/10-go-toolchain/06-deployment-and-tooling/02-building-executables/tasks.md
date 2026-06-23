# Building Executables — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: First release-style binary

In a new module, put your entry point at `cmd/api/main.go` that prints `"api running"`. Build with explicit output and check the result.

```bash
go build -o bin/api ./cmd/api
./bin/api
file ./bin/api
go version ./bin/api
```

**Acceptance criteria**
- [ ] `./bin/api` runs and prints `api running`.
- [ ] `file ./bin/api` reports the executable format and architecture.
- [ ] `go version ./bin/api` prints the Go toolchain that built it.

---

## Task 2: Inject a version via `-ldflags`

Add `var version = "dev"` at the top of `main` and have `main` print `version: <version>`. Inject the version from `git describe`.

```bash
VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "v0.0.0-test")
go build -ldflags="-X main.version=${VERSION}" -o bin/api ./cmd/api
./bin/api
```

**Acceptance criteria**
- [ ] Without `-ldflags`, the binary prints `version: dev`.
- [ ] With `-ldflags`, the binary prints the injected version.
- [ ] Changing `version` from `var` to `const` then rebuilding shows the value did **not** change — you understand why `-X` requires a `var`.

---

## Task 3: Verify embedded build info

Extend `main` to read `runtime/debug.BuildInfo` and print `vcs.revision`, `vcs.modified`, and `info.Main.Path`. Build with VCS info enabled and inspect with `go version -m`.

```bash
go build -buildvcs=true -o bin/api ./cmd/api
./bin/api
go version -m ./bin/api
```

**Acceptance criteria**
- [ ] `./bin/api` prints a non-empty `vcs.revision` matching `git rev-parse HEAD`.
- [ ] `go version -m ./bin/api` prints `build vcs.revision=...`, `build -trimpath=...`, the module path, and the toolchain version.
- [ ] `go build -buildvcs=false ...` makes `vcs.revision` disappear from both outputs.

---

## Task 4: Produce a stripped + trimmed binary

Build two variants and compare them on size and embedded paths.

```bash
go build -o bin/api-debug ./cmd/api
go build -trimpath -ldflags="-s -w" -o bin/api-release ./cmd/api
ls -lh bin/
strings bin/api-debug   | grep -m1 "$HOME" || true
strings bin/api-release | grep -m1 "$HOME" || true
```

**Acceptance criteria**
- [ ] `bin/api-release` is meaningfully smaller than `bin/api-debug` (typically 25–40% smaller).
- [ ] `strings bin/api-debug` shows your `$HOME` path; `strings bin/api-release` does not.
- [ ] Both binaries still print a panic stack trace with function names when forced to panic — you confirm `-s -w` does not break `.gopclntab`.

---

## Task 5: Set up goreleaser and dry-run

Install `goreleaser`. Create a minimal `.goreleaser.yaml` targeting linux+darwin, amd64+arm64. Run a snapshot build (no tag, no publish).

```bash
goreleaser init
# edit .goreleaser.yaml: builds, archives, checksum, snapshot
goreleaser release --snapshot --clean --skip=publish
ls dist/
```

**Acceptance criteria**
- [ ] `dist/` contains one archive per (OS, arch) combination.
- [ ] `dist/checksums.txt` contains a SHA-256 for each archive.
- [ ] The binaries inside the archives are named `api` (not `api-...`) and run on their target OS (smoke-test the linux/amd64 one in a container if you are on macOS).

---

## Task 6: Sign a binary with cosign

Install `cosign`. Sign your release binary keylessly (uses your OIDC identity — GitHub, Google, etc.) or with a generated keypair.

```bash
# keypair flow (no OIDC needed)
cosign generate-key-pair
cosign sign-blob --key cosign.key --output-signature bin/api-release.sig bin/api-release
cosign verify-blob --key cosign.pub --signature bin/api-release.sig bin/api-release
```

**Acceptance criteria**
- [ ] `bin/api-release.sig` is produced.
- [ ] `cosign verify-blob ...` succeeds.
- [ ] Modifying one byte of `bin/api-release` then re-verifying fails — you have seen the signature actually detect tampering.

---

## Task 7: Build a distroless container image

Write a multi-stage Dockerfile that ends in `gcr.io/distroless/static-debian12:nonroot`. Build and run the image.

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

```bash
docker build -t api:dev .
docker run --rm api:dev
docker image ls api:dev
```

**Acceptance criteria**
- [ ] The image runs and prints the expected output.
- [ ] `docker image ls api:dev` shows an image roughly the size of your binary + ~2 MB base.
- [ ] `docker run --rm --entrypoint sh api:dev` **fails** (no shell in distroless) — you have confirmed the base.

---

## Task 8: Reproduce the build on a second machine

On machine A, build with the precise reproducible flag set and record the SHA-256. On machine B (or a fresh container), check out the same commit and rebuild with identical flags. The SHA-256 must match.

```bash
# both machines, same commit, same toolchain
go build \
  -trimpath -mod=readonly \
  -ldflags="-s -w -buildid= -X main.version=v0.0.1" \
  -o /tmp/api ./cmd/api
sha256sum /tmp/api
```

**Acceptance criteria**
- [ ] Both machines produce the **same** SHA-256.
- [ ] Removing `-trimpath` or `-buildid=` on one of them causes the hashes to diverge — you have seen what breaks reproducibility.
- [ ] You can describe the four ingredients required: same source, same toolchain version, same flags, no time-dependent inputs.

---

## Task 9: Cross-arch matrix in a shell loop

Build linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64 in one script using a consistent output name.

```bash
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64; do
  GOOS=${target%/*} GOARCH=${target#*/}
  ext=""; [ "$GOOS" = "windows" ] && ext=".exe"
  out="bin/api-v0.0.1-${GOOS}-${GOARCH}${ext}"
  CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH \
    go build -trimpath -ldflags="-s -w -X main.version=v0.0.1" -o "$out" ./cmd/api
  echo "built $out"
done
ls -lh bin/
```

**Acceptance criteria**
- [ ] Five files are produced, all with distinct names (no overwrites).
- [ ] `file bin/api-v0.0.1-linux-arm64` reports ARM aarch64; `file bin/api-v0.0.1-windows-amd64.exe` reports PE32+.
- [ ] You can explain why dropping the `-o` would have made all five overwrite one another.
