# Build Constraints — Professional

## 1. The production menu

In production Go work, build constraints handle:

- Cross-compilation for multi-platform releases.
- Cgo on/off variants for distroless/static binaries.
- Region/customer-specific builds via feature tags.
- Test gating (unit vs integration vs e2e).
- Toolchain-version-conditional code in long-lived libraries.

A mature repo tends to have explicit conventions documented in the README ("we use the `cgo`, `purego`, and `integration` tags").

---

## 2. CGO_ENABLED in CI

```bash
CGO_ENABLED=0 go build -tags=purego ./...
```

The combination produces a fully static binary. Used for:

- Distroless containers (`gcr.io/distroless/static`).
- Scratch-based Docker images.
- Shipping to environments where glibc/musl versions are uncertain.

Add a CI check that the binary doesn't link against libc:

```bash
file binary | grep -q "statically linked"
```

---

## 3. Per-environment configuration via tags

```go
//go:build prod
package config
var APIBase = "https://api.prod.example.com"
```

```go
//go:build !prod
package config
var APIBase = "http://localhost:8080"
```

Trade-offs:

- **Pros**: secrets/endpoints aren't in default builds; debug builds are obviously distinct.
- **Cons**: you build a separate binary per environment; CI matrix grows.

Many teams prefer runtime config (`os.Getenv`, `viper`) so one binary serves all environments. Use build tags only when there's a security or size justification.

---

## 4. Integration test discipline

Convention used by many projects:

```bash
go test ./...                         # fast, no external deps
go test -tags=integration ./...       # adds tests that hit real services
go test -tags='integration,e2e' ./... # adds full end-to-end
```

Each tag is a separate CI job. The fast tier runs on every push; integration and e2e run on PRs and main.

Document the conventions in `TESTING.md` or the CI config so newcomers know what to invoke locally.

---

## 5. Distroless / static binary recipe

```dockerfile
FROM golang:1.24 AS build
WORKDIR /src
COPY . .
ENV CGO_ENABLED=0
RUN go build -tags='netgo,osusergo' -ldflags='-s -w' -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
USER 65532:65532
ENTRYPOINT ["/app"]
```

The `netgo,osusergo` tags tell the standard library's `net` and `os/user` packages to use pure-Go resolvers instead of going through the system's `getaddrinfo`/`getpwnam`. Required for a fully static binary.

---

## 6. Cross-platform releases

```bash
for goos in linux darwin windows; do
    for goarch in amd64 arm64; do
        out="bin/${BINARY}_${goos}_${goarch}"
        [[ "$goos" == "windows" ]] && out="${out}.exe"
        GOOS=$goos GOARCH=$goarch go build -o $out ./cmd/...
    done
done
```

Build constraints inside the source ensure each combination picks the right files. No conditionals in the build script — the constraints take care of it.

---

## 7. Pure-Go vs CGO crypto

```go
//go:build cgo && !purego
package fastcrypto
// uses boringssl via cgo
```

```go
//go:build !cgo || purego
package fastcrypto
// pure Go using crypto/...
```

Why offer both?

- Cgo: faster on amd64 (SIMD), required for FIPS compliance in some configurations.
- Pure Go: works in static binaries, cross-compiles trivially, no glibc dependency.

Document which path is the default and how callers can override.

---

## 8. Feature gates via tags

```go
//go:build experimental_v2
package handler
// new algorithm — not enabled by default in prod
```

CI builds both variants, runs the relevant test set. Production ships the default; canary or staging ships `-tags=experimental_v2`. After the canary proves itself, the tag is removed.

Caveat: feature gates baked at build time are harder to disable in production than runtime feature flags (e.g., `unleash`, GrowthBook). Use build tags for code that *can't* be runtime-toggled (cryptographic primitives, allocator choices); use runtime flags for everything else.

---

## 9. Inspecting a built binary

```bash
go version -m ./app
# Lists modules, settings, tags used
```

Modern Go embeds enough build metadata to recover the tag set. Useful for triaging "is this the prod or staging binary?" or "was this built with the experimental tag?"

For an even simpler approach: bake a version string with `-ldflags`:

```bash
go build -ldflags="-X main.buildTag=prod" ./cmd/app
```

---

## 10. The `gopls` / IDE problem

When your codebase has multiple tag sets, your editor will report errors for files outside the active set. Solutions:

- Configure `gopls` with the most common tag set (`build.buildFlags`).
- For developers working on tag-specific code, document an env var or workspace setting.
- Avoid heavy reliance on tags inside business logic; constrain them to platform glue or feature gates.

---

## 11. Cataloguing tags in the README

A short table near the top of the README:

```
Tag             Effect
─────────────────────────────────────────────────────
purego          Pure Go implementation (no cgo)
integration     Include integration tests
e2e             Include end-to-end tests
prod            Use production config defaults
experimental    Enable experimental algorithm v2
```

This is the cheapest documentation that pays back the most when on-boarding new engineers or debugging a CI failure.

---

## 12. Anti-patterns

- **"`production` build tag controls 30 different things."** Refactor — tags should be single-purpose.
- **Tests gated behind tags that nobody runs in CI.** Dead test, gone bug.
- **Tags that contradict each other (`prod` + `dev`).** Spec is silent on this; behavior may vary.
- **Mixing `runtime.GOOS` checks with `//go:build linux`.** Pick one strategy per concern.
- **A monolith `flags.go` with hundreds of `//go:build` conditions.** Split.

---

## 13. The release engineer's checklist

For a release that targets multiple platforms:

- [ ] CI matrix covers every supported (`GOOS`, `GOARCH`) combination.
- [ ] CI runs `go vet` on every combination.
- [ ] CI runs `go test` on at least the host combination.
- [ ] Build produces a `go version -m` printout per artifact.
- [ ] Each release artifact has a known-good tag set in its filename.
- [ ] The README documents the tag set used for the release build.

---

## 14. Summary

Production build constraints handle multi-platform releases, cgo/purego toggles, integration test tiers, and selective feature gates. Document your tag conventions, gate them in CI, and prefer runtime flags for anything that may need to be toggled without rebuilding. Treat tags as compile-time configuration with all the implications — discoverable, testable, and explicit.

---

## Further reading
- Distroless images: https://github.com/GoogleContainerTools/distroless
- `go version -m`: https://pkg.go.dev/cmd/go#hdr-Print_Go_version
- `golang.org/x/sys` for many platform-tag examples
