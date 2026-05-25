# Building Executables — Senior

## 1. The shape of a release pipeline

A mature Go release pipeline has these stages, and each maps to specific tooling:

```
tag → build (matrix) → strip/trim → package → sign → attest → publish → notify
```

| Stage | Concern | Tool |
|-------|---------|------|
| Tag | Determine version (`vX.Y.Z`), changelog | git, conventional commits |
| Build | Cross-compile per (OS, arch); reproducible | `go build`, `goreleaser` |
| Package | tar.gz / zip / deb / rpm / OCI image | `goreleaser`, `nfpm`, `docker buildx` |
| Sign | Prove provenance to consumers | `cosign`, `codesign`, `signtool` |
| Attest | SLSA provenance, SBOM | `slsa-github-generator`, `syft` |
| Publish | Releases page, registries, package repos | GitHub Releases, ghcr.io, apt/yum mirrors |

The team-level question is not "how do I `go build`?" but "where does each of these run, how is the secret managed, and how does a consumer verify what we shipped?"

---

## 2. `goreleaser` in one screen

`goreleaser` codifies the matrix-build + package + sign + publish workflow. A typical `.goreleaser.yaml`:

```yaml
project_name: api
before:
  hooks:
    - go mod tidy

builds:
  - id: api
    main: ./cmd/api
    binary: api
    env: [CGO_ENABLED=0]
    flags: [-trimpath, -mod=readonly]
    ldflags:
      - -s -w
      - -X main.version={{.Version}}
      - -X main.commit={{.Commit}}
      - -X main.date={{.Date}}
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]

archives:
  - format: tar.gz
    name_template: "{{.ProjectName}}-{{.Version}}-{{.Os}}-{{.Arch}}"
    format_overrides:
      - goos: windows
        format: zip

checksum:
  name_template: checksums.txt

snapshot:
  name_template: "{{ incpatch .Version }}-next"

signs:
  - cmd: cosign
    args: ["sign-blob", "--yes", "--output-signature=${signature}", "${artifact}"]
    artifacts: all
```

`goreleaser release --clean` consumes a git tag, builds every (OS, arch) combination in parallel, signs each artifact, generates checksums and a release notes draft, and publishes to GitHub Releases (and optionally container registries, Homebrew taps, etc.).

Even if you do not adopt goreleaser, its config is a useful checklist of "what a release should contain."

---

## 3. Signing strategy by platform

| Platform | Tool | What it signs | Verification |
|----------|------|---------------|--------------|
| OCI images | `cosign sign <ref>` (keyless via Fulcio + Rekor) | Container images, blobs | `cosign verify <ref>` |
| Linux binaries / archives | `cosign sign-blob` | Raw files | `cosign verify-blob --signature ...` |
| macOS | `codesign --sign "Developer ID Application: ..."` then `xcrun notarytool submit` | `.app`, Mach-O binaries, `.dmg`, `.pkg` | Gatekeeper, `spctl --assess` |
| Windows | `signtool sign /fd SHA256 /tr <ts> /td SHA256 /a foo.exe` | PE binaries, MSI installers | SmartScreen, `signtool verify` |

Practical points:

- **macOS notarization** is required for distribution outside the App Store; without it, Gatekeeper blocks the binary. Use `notarytool` (replacement for the deprecated `altool`), then `xcrun stapler staple` to embed the notarization ticket.
- **Cosign keyless** signs using a short-lived OIDC identity (GitHub Actions, GitLab) and logs the signature to the public Rekor transparency log. There is no long-lived key to leak.
- **Windows EV certificates** are required for SmartScreen to accept new publishers without a reputation period; they live on hardware tokens (or cloud HSMs).

---

## 4. Linux packaging formats

Beyond tarballs, native Linux packages are expected for end-user CLI tools and daemons:

| Format | Tool | Used by |
|--------|------|---------|
| `.deb` | `nfpm pkg --packager deb` (or `dpkg-deb`) | Debian, Ubuntu |
| `.rpm` | `nfpm pkg --packager rpm` | RHEL, Fedora, SUSE |
| `.apk` | `nfpm pkg --packager apk` | Alpine |
| `.snap` | `snapcraft` | Ubuntu and snap-enabled distros |

`nfpm` (used by goreleaser) defines all three in one YAML:

```yaml
# nfpm.yaml
name: api
arch: amd64
platform: linux
version: ${VERSION}
section: utils
maintainer: "Acme <ops@acme.example>"
contents:
  - src: ./bin/api
    dst: /usr/bin/api
  - src: ./packaging/api.service
    dst: /lib/systemd/system/api.service
scripts:
  postinstall: ./packaging/postinstall.sh
```

Ship a systemd unit, a config under `/etc/api/`, and pre/post-install scripts. The package manager handles upgrades, removal, and dependency declarations.

---

## 5. Distroless and minimal containers

The standard Go production image is a multi-stage Dockerfile ending in a minimal base:

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build \
    -trimpath -mod=readonly \
    -ldflags="-s -w -X main.version=${VERSION}" \
    -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```

Why `distroless/static` and not `alpine`:

- No shell, no package manager → smaller attack surface.
- `nonroot` user out of the box.
- No glibc/musl mismatch — your `CGO_ENABLED=0` binary is truly static.
- Image is ~2 MB plus your binary, vs ~5–8 MB for Alpine plus libc differences.

For cgo binaries that need glibc, use `gcr.io/distroless/base-debian12`. Never ship the `golang` image to production — it carries a full toolchain.

---

## 6. Supply-chain attestations and SLSA

A SLSA (Supply-chain Levels for Software Artifacts) attestation says, signed by your builder: "I built artifact X from commit Y at time Z using these steps." Consumers verify it with `cosign verify-attestation`. Practical setup:

- GitHub Actions has `actions/attest-build-provenance` (SLSA L3) that signs provenance automatically using the workflow identity.
- Combine with `syft` to generate an SBOM (`syft packages -o cyclonedx-json ./bin/api > sbom.json`) and attach it as an attestation.
- For container images, `cosign attest --predicate sbom.json --type cyclonedx <image>` records the SBOM in the registry alongside the image.

`go build -buildmode=...` is also relevant: `pie` for ASLR-friendly executables, `c-archive`/`c-shared` when you ship a Go library to be embedded in C/Rust/etc. (covered in `professional.md`).

---

## 7. Version policy and conventional commits

Pick a versioning policy and automate it:

- **SemVer with conventional commits** — `feat:` bumps minor, `fix:` bumps patch, `BREAKING CHANGE:` bumps major. Tools (`release-please`, `semantic-release`) compute the next version from the commit log and write the changelog.
- **CalVer (`2025.05.0`)** — works for fast-moving infrastructure tooling where SemVer compatibility promises are meaningless.
- **Release branches** — long-lived `release/v1` branch receives backports; tags `v1.2.3` flow from there. The main branch evolves toward the next major.

Public Go modules **must** use SemVer with a `v` prefix (`v1.2.3`); Go's module system rejects non-conforming tags. For `v2+`, the module path itself must include the version suffix (`/v2`).

---

## 8. Release checklist (paste into your runbook)

- [ ] `git status` clean; CI green on the commit being tagged.
- [ ] Changelog generated and reviewed.
- [ ] Version computed (`git describe` or release-please).
- [ ] Matrix build: all (OS, arch) combinations succeed.
- [ ] Binaries: `-trimpath`, `-mod=readonly`, `-ldflags="-s -w -X main.version=..."`, `CGO_ENABLED=0` (or justified).
- [ ] Archives named `<name>-<version>-<os>-<arch>.{tar.gz,zip}`.
- [ ] `checksums.txt` with SHA-256 for every artifact.
- [ ] Signatures: cosign for blobs/images, codesign+notarize for macOS, signtool for Windows.
- [ ] SBOM (`syft`) and SLSA provenance attached.
- [ ] Container image pushed to registry with `:vX.Y.Z`, `:vX.Y`, `:vX` tags.
- [ ] Native packages (`.deb`/`.rpm`) signed and published to your repo.
- [ ] Release notes published; downstream consumers (Homebrew tap, install script) updated.

---

## 9. Summary

A senior-level Go release is a pipeline, not a command. Standardize the build flags (`-trimpath`, `-mod=readonly`, `-s -w`, `-X main.version=...`, `CGO_ENABLED=0`), automate the matrix and packaging with `goreleaser` or its equivalent, sign every artifact appropriate to its platform (cosign / codesign+notarize / signtool), ship containers from `distroless/static` rather than `alpine`, and emit SLSA provenance + SBOMs so consumers can verify what you produced. Version policy, release branches, and a written runbook keep the whole process boring.

---

## Further reading
- `goreleaser` documentation: https://goreleaser.com/
- `cosign`: https://docs.sigstore.dev/
- SLSA framework: https://slsa.dev/
- Distroless images: https://github.com/GoogleContainerTools/distroless
- Apple notarization: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
