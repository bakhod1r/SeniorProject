# go build — Senior

## 1. The build cache, in detail

`go build` keys every compiled package by a hash of its inputs: source contents, import graph, compiler/linker flags, build tags, toolchain version, and relevant environment (`GOOS`, `GOARCH`, `CGO_ENABLED`, `CC`). A match in `GOCACHE` is reused; a miss recompiles. This is why:

- The first build is slow, subsequent ones are fast.
- Changing **any** flag (`-tags`, `-ldflags`, `-gcflags`, `-race`) creates a new cache key, so flipping flags pays a one-time recompile.
- `go build -a` ignores the cache entirely (rarely needed; prefer `go clean -cache` for corruption).

```bash
go env GOCACHE          # cache location
go build -x ./... 2>&1 | head   # see cache hits ("[some hash]") vs compiles
```

A subtle gotcha: `-ldflags="-X main.version=$(date)"` changes the link inputs every build, so the **link** step never caches — but package compilation still does. That is fine; linking is cheap relative to compilation.

---

## 2. Reproducible builds

To make a binary byte-identical across machines and time:

```bash
CGO_ENABLED=0 \
go build -trimpath \
  -ldflags="-s -w -buildid=" \
  -o app ./cmd/app
```

- `-trimpath` strips local file system paths.
- `-buildid=` (via ldflags) zeroes the build ID so two builds match.
- A pinned toolchain (`GOTOOLCHAIN`/`go` directive) ensures the same compiler.
- Pinned dependencies (`go.sum`) ensure identical sources.

Verify with `go version -m app` and by diffing two independent builds.

---

## 3. `-buildvcs` and embedded VCS info

Since Go 1.18, `go build` embeds VCS metadata (commit, dirty flag, build time) into binaries when building from a Git/Hg repo. Read it back:

```bash
go version -m app | grep vcs
```

Control it:

```bash
go build -buildvcs=false .     # disable (needed when building outside the repo, e.g., some CI/Docker)
```

A classic CI failure is "error obtaining VCS status" when `.git` is absent in the build context; `-buildvcs=false` or copying `.git` resolves it.

---

## 4. Symbol stripping, size, and inspection

```bash
go build -ldflags="-s -w" -o app .   # strip → smaller, but panics show no symbolized stack offsets
go tool nm app | head                # symbols (empty if stripped)
go tool size app                     # text/data/bss segment sizes
go build -gcflags="-m" ./... 2>&1    # escape analysis / inlining decisions
```

Seniors weigh size against debuggability: stripping is for release artifacts, never for binaries you intend to debug or profile with symbol-aware tools.

---

## 5. Compiler and linker control

```bash
go build -gcflags="all=-N -l" -o app .   # disable optimizations + inlining (for delve debugging)
go build -gcflags="-m=2" ./pkg            # verbose escape analysis on one package
go build -ldflags="-X 'pkg.S=has spaces'" # quoting for values with spaces
go build -p 4 ./...                       # cap parallel build actions
```

The `all=` prefix applies gcflags to **every** dependency, not just your module — important for full-tree instrumentation but slower.

---

## 6. Where `go build` surprises people

- **`-o dir/` vs `-o file`.** A trailing slash means a directory (one binary per main package); without it, a file. Building `./...` with `-o file` errors when there are multiple main packages.
- **Caching version stamps.** People expect `-ldflags -X version` to "rebuild everything"; only the link changes — that is correct and fast.
- **cgo cross-compile.** `GOOS=linux go build` with `CGO_ENABLED=1` fails without a Linux C cross-compiler. The fix is usually `CGO_ENABLED=0`.
- **VCS stamping in Docker.** Missing `.git` → build error; use `-buildvcs=false`.
- **`go build` does not run tests.** It compiles `_test.go`? No — `go build` ignores test files; use `go vet`/`go test` to compile and check them.
- **GOFLAGS leakage.** A global `GOFLAGS=-mod=vendor` silently changes how `go build` resolves dependencies.

---

## 7. CI usage

A robust release build:

```bash
export CGO_ENABLED=0
go build -trimpath \
  -ldflags="-s -w -X main.version=${GIT_TAG} -X main.commit=${GIT_SHA}" \
  -o dist/app ./cmd/app
```

CI best practices:
- Cache `GOCACHE` and `GOMODCACHE` keyed on `go.sum` to speed builds.
- Build with `-trimpath` for reproducibility and to avoid leaking paths.
- Use a matrix over `GOOS`/`GOARCH` for multi-platform releases.
- Pin the toolchain (`go.mod` `go` directive + `GOTOOLCHAIN`) so CI and dev agree.
- Set `-buildvcs=false` if the build context lacks `.git`.

---

## 8. Multi-stage Docker static builds

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/app

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/app /app
ENTRYPOINT ["/app"]
```

The static binary needs no libc, so `distroless/static` or `scratch` works — tiny, secure images.

---

## 9. Summary

`go build` is governed by a content-addressed cache keyed on sources, flags, tags, toolchain, and environment. Reproducible release builds combine `CGO_ENABLED=0`, `-trimpath`, `-ldflags="-s -w -buildid="`, a pinned toolchain, and pinned dependencies. Know the surprises: `-o dir/` semantics, VCS stamping needing `.git`, cgo cross-compile pain, and that version stamping only re-links. Cache `GOCACHE`/`GOMODCACHE` in CI and ship static binaries in distroless/scratch images.

---

## Further reading
- Build and test caching: https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching
- `cmd/link` flags: https://pkg.go.dev/cmd/link
- `-buildvcs`: https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies
