# Cross-compilation — Senior

## 1. Cross-compile or build-in-container?

You have two architectural options for producing per-target binaries:

| Approach | When it fits |
|----------|--------------|
| **Native cross-compile** (`GOOS`/`GOARCH`) | Pure-Go; fast CI; no emulation; no special hardware |
| **Build inside a target-arch container** (`docker buildx`, QEMU, native ARM runners) | Heavy cgo, target-specific test runs, distro-specific glibc, system packages |
| **Hybrid: cross-compile Go + assemble in container** | You want a multi-stage image with the smallest final layer |

For a pure-Go HTTP service, cross-compiling on a Linux/amd64 runner and `COPY`ing the binary into a `scratch`/`distroless` image is the fastest and most reproducible path. Reach for `buildx` + QEMU only when you must compile cgo C sources or run target-arch tests.

---

## 2. cgo cross-builds — zig-cc and musl

cgo cross-compilation needs a C cross-compiler that targets the same triple as `GOOS/GOARCH`. The cleanest modern option is **zig** as a drop-in C cross-compiler:

```bash
# Linux/arm64 from a Linux/amd64 host
CGO_ENABLED=1 \
  CC="zig cc -target aarch64-linux-musl" \
  CXX="zig c++ -target aarch64-linux-musl" \
  GOOS=linux GOARCH=arm64 \
  go build -o app-linux-arm64 .
```

Why musl: linking against musl produces a static binary that does not depend on the host's glibc. Pairing zig-cc with musl gives you cgo cross-builds that run on any Linux of the matching arch.

Alternatives: `aarch64-linux-gnu-gcc` (GNU cross toolchain), `osxcross` (macOS targets from Linux), or `mingw-w64` (Windows targets).

---

## 3. Reproducible cross-builds

Two builders on different machines should produce **byte-identical** binaries for the same source. The minimum recipe:

```bash
CGO_ENABLED=0 \
GOOS=linux GOARCH=amd64 \
go build \
  -trimpath \
  -buildvcs=false \
  -ldflags="-s -w -buildid= -X main.version=$VERSION" \
  -o app .
```

| Flag | Why |
|------|-----|
| `-trimpath` | Removes absolute filesystem paths from the binary (no `/home/alice/...`) |
| `-buildvcs=false` | Stops embedding git state that differs per checkout dir |
| `-ldflags="-buildid="` | Clears the build ID — otherwise it varies per build |
| `-ldflags="-s -w"` | Strips symbol/debug tables (smaller, stable) |
| Pinned toolchain | Same `go` version across builders (`go.mod` `toolchain` directive) |

Verify by hashing: `sha256sum app` on two independent runners should match.

---

## 4. Release matrices in CI

Typical GitHub Actions matrix for a release:

```yaml
name: release
on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { goos: linux,   goarch: amd64 }
          - { goos: linux,   goarch: arm64 }
          - { goos: darwin,  goarch: amd64 }
          - { goos: darwin,  goarch: arm64 }
          - { goos: windows, goarch: amd64, ext: .exe }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - env:
          CGO_ENABLED: 0
          GOOS: ${{ matrix.goos }}
          GOARCH: ${{ matrix.goarch }}
        run: |
          go build -trimpath -buildvcs=false \
            -ldflags="-s -w -X main.version=${GITHUB_REF_NAME}" \
            -o dist/myapp-${GOOS}-${GOARCH}${{ matrix.ext }} .
      - uses: actions/upload-artifact@v4
        with:
          name: myapp-${{ matrix.goos }}-${{ matrix.goarch }}
          path: dist/*
```

A separate `release` job downloads all artifacts, signs them, and attaches them to the GitHub release. Many teams just use **GoReleaser**, which wraps this entire flow.

---

## 5. Signing and attesting release artifacts

Treat unsigned binaries as untrusted. Minimum signing for cross-compiled releases:

- **Linux / generic** — **cosign** (Sigstore) with keyless OIDC signing in GitHub Actions:
  ```bash
  cosign sign-blob --yes --bundle app-linux-amd64.cosign.bundle app-linux-amd64
  ```
- **macOS** — Apple **codesign** + **notarytool** (requires an Apple Developer ID and runs only on macOS hosts):
  ```bash
  codesign --options runtime --timestamp -s "Developer ID Application: Acme (TEAMID)" app
  xcrun notarytool submit app.zip --keychain-profile "AC_PASSWORD" --wait
  ```
- **Windows** — `signtool` with an EV/OV code-signing certificate.

Publish a `checksums.txt` alongside binaries and sign that single file rather than each artifact when possible.

---

## 6. Multi-arch container images

For container deployments you usually want one image tag that resolves to the right arch per pull:

```bash
docker buildx create --use --name multi
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/acme/myapp:v1.2.3 \
  --push .
```

Two production-friendly patterns inside the `Dockerfile`:

1. **Cross-compile in Go, copy into a target-arch base** (fast, recommended):
   ```dockerfile
   FROM --platform=$BUILDPLATFORM golang:1.23 AS build
   ARG TARGETOS TARGETARCH
   WORKDIR /src
   COPY . .
   RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
       go build -trimpath -ldflags="-s -w" -o /out/app .

   FROM gcr.io/distroless/static:nonroot
   COPY --from=build /out/app /app
   ENTRYPOINT ["/app"]
   ```
   `$BUILDPLATFORM` keeps the Go build on the native runner; `$TARGETOS/$TARGETARCH` are injected by buildx for each platform.

2. **Build natively per arch via QEMU emulation** — slower, needed if your build step itself depends on the target arch (cgo, native test runs).

---

## 7. Versioning and naming conventions

Pick one scheme and apply it everywhere:

- Artifact name: `myapp_<version>_<goos>_<goarch>.<ext>` (e.g., `myapp_1.2.3_linux_amd64.tar.gz`).
- Container tag: `ghcr.io/acme/myapp:1.2.3` (multi-arch manifest) and immutable digests for production references.
- Version variable: `var version = "dev"` overridden by `-ldflags="-X main.version=$TAG"`.
- For commit-only builds, use `1.2.3-rc.1+gabcdef0` (semver build metadata) but never depend on metadata for ordering.

Surface this in your binary:

```go
fmt.Printf("myapp %s (%s/%s, %s)\n", version, runtime.GOOS, runtime.GOARCH, runtime.Version())
```

---

## 8. Trade-offs to weigh

| Decision | Cheap option | Expensive option | Why pay more |
|----------|--------------|------------------|--------------|
| Static vs dynamic | `CGO_ENABLED=0` (pure Go) | cgo + cross C toolchain | Need a C library |
| Cross-compile vs native runner | Cross on x86_64 | ARM runner / QEMU | Run target tests in CI |
| Strip symbols (`-s -w`) | Smaller, opaque crash logs | Keep symbols | Production debugging, profiling |
| Reproducible builds | A few extra flags | Hermetic build env (Bazel, Nix) | Supply-chain attestation |

A senior choice is conscious about which trade-off applies, not a default toggle.

---

## 9. Summary

Reach for `GOOS`/`GOARCH` for pure-Go targets; reach for zig-cc + musl when cgo needs to cross; reach for `docker buildx` + QEMU only when the build itself depends on the target arch. Make builds reproducible with `-trimpath`, `-buildvcs=false`, cleared build IDs, and pinned toolchains. Drive a release matrix from CI, sign every artifact (cosign for generic, notarytool for macOS, signtool for Windows), and publish multi-arch container images so consumers do not need to think about arch.

---

## Further reading
- `go help build` and build flags: https://pkg.go.dev/cmd/go
- Reproducible builds: https://reproducible-builds.org/
- GoReleaser: https://goreleaser.com/
- Docker Buildx multi-platform: https://docs.docker.com/build/building/multi-platform/
- zig cc as a C cross-compiler: https://andrewkelley.me/post/zig-cc-powerful-drop-in-replacement-gcc-clang.html
- cosign / Sigstore: https://docs.sigstore.dev/
