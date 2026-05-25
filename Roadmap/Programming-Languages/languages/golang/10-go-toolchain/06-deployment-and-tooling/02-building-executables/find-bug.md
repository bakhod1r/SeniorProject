# Building Executables — Find the Bug

Each scenario shows a command or setup that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — Stripped binary, but no pprof source lines

```bash
go build -ldflags="-s -w" -o api ./cmd/api
# later, in production:
curl http://prod/debug/pprof/profile?seconds=30 > prof.out
pprof -http=:8080 prof.out
# flame graph shows function names but no source lines, no inlining detail
```

**Bug:** `-w` stripped DWARF, and `-s` stripped the symbol table. `pprof` falls back to `.gopclntab`, which gives function names but not full source-line/inlining info.
**Fix:** keep an **unstripped** build artifact (same build ID) and symbolize the profile against it offline: `pprof -http=:8080 ./api.unstripped ./prof.out`. Archive unstripped binaries by build ID for every release.

---

## Bug 2 — Developer home directory in panic traces

```
panic: runtime error: index out of range [3] with length 2

goroutine 1 [running]:
main.handle(...)
        /Users/alice/projects/secret-startup/internal/server/handler.go:42
```

**Bug:** the build did not pass `-trimpath`, so absolute file system paths from the build machine were embedded in stack traces and `BuildInfo`.
**Fix:** always build releases with `-trimpath`. Stack traces then show paths like `secret-startup/internal/server/handler.go:42`, module-relative and free of build-host details.

---

## Bug 3 — Version variable not overridden

```go
package version
const Version = "dev"
```

```bash
go build -ldflags="-X github.com/me/proj/version.Version=v1.2.3" -o api ./cmd/api
./api
# prints "dev"
```

**Bug:** `Version` is a `const`. `-X` can only set package-level **string variables**, not constants. The linker silently does nothing for the wrong kind of symbol.
**Fix:** make it a `var`:
```go
package version
var Version = "dev"
```
Rebuild; the override now takes effect.

---

## Bug 4 — `runtime/debug.BuildInfo` is empty

```go
info, ok := debug.ReadBuildInfo()
fmt.Println(ok, info)
// false <nil>
```

**Bug:** the binary was not built via `go build` from a module — for example, it was built by a custom tool that invoked `cmd/compile` and `cmd/link` directly, or via `go build` in `GOPATH` mode, or it was a test binary in an odd configuration. The `BuildInfo` section is only emitted by the standard module-aware `go build`.
**Fix:** build via `go build ./cmd/api` inside the module. For diagnostic builds, also confirm with `go version -m ./api` that the build info section is present; if it is not, your build path skipped the standard linker invocation.

---

## Bug 5 — Container image fails on Alpine because of dynamic libc

```dockerfile
FROM golang:1.23 AS build
COPY . .
RUN go build -o /out/api ./cmd/api   # CGO_ENABLED defaults to 1 with gcc present

FROM alpine:3.20
COPY --from=build /out/api /api
ENTRYPOINT ["/api"]
```

```
$ docker run --rm api:dev
exec /api: no such file or directory
```

**Bug:** the build image has gcc, so `CGO_ENABLED` defaulted to 1 and produced a dynamically linked binary against glibc. Alpine has musl, not glibc, so the dynamic linker cannot resolve the binary and reports the misleading "no such file or directory."
**Fix:** force a pure-Go build with `CGO_ENABLED=0 go build ...`. Better, move to `gcr.io/distroless/static-debian12:nonroot` as the final image so the static binary lives in an environment that matches it.

---

## Bug 6 — Cross-compile overwrites previous output

```bash
for target in linux/amd64 linux/arm64 darwin/arm64; do
  GOOS=${target%/*} GOARCH=${target#*/} go build -o bin/api ./cmd/api
done
ls bin/
# bin/api  ← only the last build survives
```

**Bug:** the output name `bin/api` is identical for every iteration; each cross-build overwrites the previous one. The final file is whichever target ran last (darwin/arm64), which is useless on Linux.
**Fix:** include `${GOOS}` and `${GOARCH}` (and version) in the output name:
```bash
out="bin/api-${VERSION}-${GOOS}-${GOARCH}"
[ "$GOOS" = "windows" ] && out="${out}.exe"
go build -o "$out" ./cmd/api
```

---

## Bug 7 — CI silently bumped `go.mod`

```yaml
# CI job
- run: go build -o api ./cmd/api
```

A teammate notices that CI builds use a newer transitive dependency than local builds, and `go.sum` keeps getting updated by CI.

**Bug:** without `-mod=readonly` (or `GOFLAGS=-mod=readonly`), `go build` is allowed to update `go.mod`/`go.sum` when it discovers a new requirement. CI mutating dependencies between builds breaks reproducibility and hides regressions.
**Fix:** add `-mod=readonly` to every CI build (or set `GOFLAGS=-mod=readonly` in the job env). The build now fails loudly if dependencies would change, forcing a deliberate `go mod tidy` PR.

---

## Bug 8 — Container ships the compiler image

```dockerfile
FROM golang:1.23
COPY . .
RUN go build -o /api ./cmd/api
ENTRYPOINT ["/api"]
```

The resulting image is ~900 MB; the security team flags ~70 CVEs from the toolchain layer.

**Bug:** the final image is `golang:1.23`, which contains the full Go toolchain, GCC, build deps, and the entire source tree. Production has no need for any of that.
**Fix:** use a multi-stage build whose final stage is a minimal base:
```dockerfile
FROM golang:1.23 AS build
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
ENTRYPOINT ["/api"]
```
Final image drops from ~900 MB to ~10 MB and from ~70 CVEs to a handful.

---

## Bug 9 — Reproducible build differs on two machines

```bash
# machine A
go build -trimpath -ldflags="-s -w -X main.version=v1.0.0" -o api ./cmd/api
sha256sum api
# 3a7b...

# machine B, same commit, same Go version, same flags
go build -trimpath -ldflags="-s -w -X main.version=v1.0.0" -o api ./cmd/api
sha256sum api
# 9c14...
```

**Bug:** the link-time **build ID** differs per machine (it derives from inputs including paths and environment), so the binaries are not byte-identical even with `-trimpath`.
**Fix:** clear the build ID explicitly to enable bit-reproducibility:
```bash
go build -trimpath -ldflags="-s -w -buildid= -X main.version=v1.0.0" -o api ./cmd/api
```
Both machines now produce the same SHA-256, provided the toolchain version and `go.sum` also match.

---

## Bug 10 — macOS binary blocked by Gatekeeper on first launch

A customer downloads `api-v1.2.3-darwin-arm64.tar.gz` from your release page, extracts it, runs `./api`, and gets:

```
"api" cannot be opened because the developer cannot be verified.
```

**Bug:** the binary was signed (or not) but was never **notarized** through Apple. Gatekeeper blocks unverified binaries on first launch.
**Fix:** sign with a Developer ID certificate, submit to Apple for notarization, and staple the ticket:
```bash
codesign --sign "Developer ID Application: Acme (TEAMID)" --options runtime --timestamp api
ditto -c -k --keepParent api api.zip
xcrun notarytool submit api.zip --apple-id ... --team-id TEAMID --password ... --wait
xcrun stapler staple api
```
Ship the stapled binary. Gatekeeper now accepts it offline.

---

## How to approach these
1. Production stack trace looks wrong? → check `-trimpath` and that `-s -w` is not blocking the use case you need.
2. `-X` silently no-op? → check that the target is a `var` (not `const`) and the full import path is correct.
3. `BuildInfo` empty? → check the binary was built via the standard `go build` from a module.
4. Binary fails on Alpine/distroless? → set `CGO_ENABLED=0` and pick a base that matches your linkage.
5. Cross-compile overwriting itself? → include `${GOOS}-${GOARCH}` in `-o`.
6. CI drifting? → enforce `-mod=readonly`.
7. Image too large? → multi-stage build ending in distroless or scratch.
8. Reproducibility broken? → strip the build ID and pin everything (toolchain, sums, flags, time).
9. macOS blocked? → notarize and staple, do not just sign.
