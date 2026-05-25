# Compiler & Linker Flags — Professional

## 1. The release-build incantation

For most production Go services, this is the build line:

```bash
go build \
  -trimpath \
  -ldflags="-s -w \
    -X 'example.com/pkg/buildinfo.Version=${VERSION}' \
    -X 'example.com/pkg/buildinfo.GitCommit=${COMMIT}' \
    -X 'example.com/pkg/buildinfo.BuildTime=${BUILD_TIME}'" \
  -o ./bin/app \
  ./cmd/app
```

Components:

- `-trimpath`: clean paths.
- `-s -w`: strip symbol and debug info.
- `-X`: embed version, commit, build time.
- Output path standardized.

Codify this as a Makefile target or shell script and never type it by hand.

---

## 2. The buildinfo package pattern

```go
// pkg/buildinfo/buildinfo.go
package buildinfo

import "fmt"

var (
    Version   = "dev"
    GitCommit = "unknown"
    BuildTime = "unknown"
    GoVersion = "unknown"
)

func String() string {
    return fmt.Sprintf("%s (%s) built %s with %s", Version, GitCommit, BuildTime, GoVersion)
}
```

```go
// cmd/app/main.go
import _ "example.com/pkg/buildinfo"

func main() {
    if showVersion {
        fmt.Println(buildinfo.String())
        return
    }
    // ...
}
```

Inject via `-ldflags="-X ..."`. The benefit: every binary tells you what it is, helpful for "which version is in prod?"

---

## 3. CI/CD recipe

A standard CI/CD pipeline for a Go service:

```yaml
- name: Test (with race)
  run: go test -race ./...

- name: Lint
  run: golangci-lint run

- name: Build
  env:
    VERSION: ${{ github.ref_name }}
    COMMIT: ${{ github.sha }}
    BUILD_TIME: $(date -u +%FT%T)
  run: |
    go build \
      -trimpath \
      -ldflags="-s -w -X 'main.version=${VERSION}' -X 'main.commit=${COMMIT}'" \
      -o ./bin/app ./cmd/app

- name: Embed PGO (optional)
  if: hashFiles('default.pgo') != ''
  run: |
    go build -pgo=default.pgo \
      -trimpath \
      -ldflags="-s -w" \
      -o ./bin/app ./cmd/app
```

The PGO step is conditional — if `default.pgo` is committed, use it; otherwise build normally.

---

## 4. Distroless / static recipe

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY go.* ./
RUN go mod download
COPY . .
ENV CGO_ENABLED=0
RUN go build \
    -trimpath \
    -ldflags="-s -w" \
    -tags="netgo,osusergo" \
    -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
USER 65532:65532
ENTRYPOINT ["/app"]
```

`CGO_ENABLED=0` + `netgo,osusergo` produces a fully static binary suitable for distroless `static` images.

---

## 5. PGO in production

A complete PGO workflow:

1. Deploy a non-PGO release.
2. Capture a CPU profile during representative load (e.g., 60 seconds at peak).
3. Commit the profile as `default.pgo`.
4. Future builds use `-pgo=auto`.
5. Periodically refresh the profile (every release or month).

```bash
curl http://app:6060/debug/pprof/profile?seconds=60 > default.pgo
git add default.pgo
git commit -m "pgo: refresh production profile for v1.3"
```

The profile is binary; commit it directly. Don't profile from artificial benchmarks — they don't match real call patterns.

---

## 6. Verifying release builds

```bash
go version -m ./bin/app
```

Output includes:

- Module path and version.
- Build settings (tags, ldflags, trimpath, vcs info).
- Go toolchain version.

Add a CI check that fails if `go version -m` doesn't show your expected flags. Catches "someone removed `-trimpath`" regressions.

---

## 7. Binary size as a budget

Track binary size across releases:

```bash
ls -l ./bin/app | awk '{print $5}'
```

A 30% jump usually means a heavy dependency was added. Investigate.

```bash
go tool nm -size -sort=size -n ./bin/app | tail -20
```

Lists the largest symbols. Useful to find "what's bloating my binary?"

```bash
go-bindata-listing (or similar) tools
```

For embedded assets, `embed.FS` is the standard mechanism; they contribute to binary size directly.

---

## 8. Defaulting flags via `go.work` and `go env`

For a multi-module workspace, `go.work` doesn't set build flags. `go env -w GOFLAGS=...` sets a default for the current user.

Better: a `Makefile` or `Taskfile.yml` at repo root with named targets:

```makefile
.PHONY: build release debug

build:
	go build ./cmd/app

release:
	go build -trimpath -ldflags='-s -w -X main.ver=$(VERSION)' -o bin/app ./cmd/app

debug:
	go build -gcflags='all=-N -l' -o bin/app ./cmd/app
```

CI invokes `make release`; devs invoke `make build` or `make debug`.

---

## 9. Race-detector in CI

Standard CI matrix:

```yaml
- name: Unit tests
  run: go test ./...

- name: Race tests
  run: go test -race ./...
```

Race tests run slower; some teams run them only on PRs and main, not every commit. The race detector finds real bugs — make it part of your routine.

---

## 10. Avoiding common production bugs

| Mistake | Fix |
|---------|-----|
| Forgot `-trimpath`, paths leak | Add to Makefile; CI check |
| Forgot `-s -w`, binary 20% bigger | Add to release target |
| Hardcoded version "dev" | Use `-X main.version=$(VERSION)` |
| Race tests skipped in CI | Add a dedicated job |
| Cgo accidentally enabled | Set `CGO_ENABLED=0` explicitly |
| Different build per developer | Standardize via Makefile |

All preventable with disciplined CI configuration.

---

## 11. Multi-arch release

```bash
for goos in linux darwin; do
  for goarch in amd64 arm64; do
    GOOS=$goos GOARCH=$goarch \
    CGO_ENABLED=0 \
    go build -trimpath -ldflags='-s -w' \
      -o "./bin/app_${goos}_${goarch}" ./cmd/app
  done
done
```

For Windows, add `.exe` to the output name. For tarballs/checksums, follow with:

```bash
cd bin && for f in app_*; do
  tar czf "${f}.tar.gz" "$f"
  sha256sum "${f}.tar.gz" >> SHA256SUMS
done
```

Mature releases sign the checksums file with GPG or sigstore.

---

## 12. `-buildvcs` in CI

CI builds typically have detached HEADs or unusual git states. To prevent VCS-info issues:

```bash
go build -buildvcs=auto ./...    # default: best-effort
go build -buildvcs=false ./...   # explicit no
go build -buildvcs=true ./...    # fails if VCS info missing
```

For reproducible builds, `false`. For ensuring metadata is captured, `true`. For most projects, leave as default.

---

## 13. The reproducible-build checklist

- [ ] `-trimpath` set.
- [ ] `-buildvcs=false` (if you don't want VCS metadata) or `-buildvcs=true` (if you do, with a clean tree).
- [ ] `-ldflags="-buildid=''"` to clear the random build ID.
- [ ] Pinned Go toolchain version (`go.mod` `go 1.24.2`).
- [ ] Pinned `CGO_ENABLED`.
- [ ] Identical `GOOS`/`GOARCH`/`GOAMD64`/etc.
- [ ] `GOPROXY` set to a deterministic source.
- [ ] No env-var dependent timestamps in `-X` injections.

Two builds with all of the above produce byte-identical binaries.

---

## 14. Summary

Production flag use is codified and standardized: one release Makefile target, one debug target, optional PGO. CI verifies the flags actually applied (via `go version -m`). Distroless images need `CGO_ENABLED=0` plus `netgo,osusergo`. Reproducible builds require careful flag and env discipline. Treat the toolchain as part of your release engineering — flags shouldn't drift across team members or builds.

---

## Further reading
- `go help buildflags`
- PGO: https://go.dev/doc/pgo
- Reproducible builds: https://reproducible-builds.org/
- Distroless: https://github.com/GoogleContainerTools/distroless
