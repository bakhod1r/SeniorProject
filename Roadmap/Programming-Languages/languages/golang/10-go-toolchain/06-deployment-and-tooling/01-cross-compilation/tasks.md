# Cross-compilation — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: Build a Linux binary on a non-Linux host

On macOS or Windows, build a pure-Go "hello" program for `linux/amd64`.

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app-linux-amd64 .
```

**Acceptance criteria**
- [ ] `file app-linux-amd64` reports `ELF 64-bit LSB executable, x86-64`.
- [ ] Running `./app-linux-amd64` on the host fails with `exec format error` (expected).
- [ ] `scp` the binary to a Linux box (or run via `docker run --rm -v $PWD:/w -w /w alpine ./app-linux-amd64`) and it prints `hello`.

---

## Task 2: Multi-target Makefile

Write a Makefile that produces `linux/amd64`, `linux/arm64`, `darwin/arm64`, and `windows/amd64` binaries into `dist/` with names like `app-<goos>-<goarch>[.exe]`.

```make
TARGETS := linux/amd64 linux/arm64 darwin/arm64 windows/amd64
all: $(TARGETS)
$(TARGETS):
	@os=$(word 1,$(subst /, ,$@)); arch=$(word 2,$(subst /, ,$@)); \
	 ext=$$( [ "$$os" = "windows" ] && echo .exe ); \
	 CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
	   go build -trimpath -ldflags="-s -w" \
	   -o dist/app-$$os-$$arch$$ext .
```

**Acceptance criteria**
- [ ] `make all` produces four files in `dist/`.
- [ ] `file dist/app-windows-amd64.exe` reports a PE32+ executable.
- [ ] `file dist/app-darwin-arm64` reports a Mach-O 64-bit executable arm64.
- [ ] Each file size is below 5 MB (the `-s -w` strip succeeded).

---

## Task 3: Build and serve a `js/wasm` target

Build a Go program for `GOOS=js GOARCH=wasm` and load it in a browser.

```bash
GOOS=js GOARCH=wasm go build -o web/app.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" web/
```

Create `web/index.html`:

```html
<!doctype html>
<script src="wasm_exec.js"></script>
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("app.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
```

Serve it: `cd web && python3 -m http.server 8080`, open `http://localhost:8080`.

**Acceptance criteria**
- [ ] The browser console prints output from your `main()` (e.g., `fmt.Println("hello from wasm")`).
- [ ] Reloading does not 404 on `wasm_exec.js` or `app.wasm`.
- [ ] You can describe in one sentence why `python3 -m http.server` works but `file://` does not (CORS / streaming compile).

---

## Task 4: Cross-build a cgo program with zig-cc

Install `zig` (any 0.11+ build). Add a cgo dependency to your program (e.g., a trivial `import "C"` block) and cross-compile from your host to `linux/arm64`:

```bash
CGO_ENABLED=1 \
  CC="zig cc -target aarch64-linux-musl" \
  CXX="zig c++ -target aarch64-linux-musl" \
  GOOS=linux GOARCH=arm64 \
  go build -o app-linux-arm64 .
```

**Acceptance criteria**
- [ ] The build succeeds without setting up a system cross-GCC.
- [ ] `file app-linux-arm64` reports `ELF 64-bit LSB executable, ARM aarch64, statically linked`.
- [ ] You can run it under QEMU or on an arm64 box: `qemu-aarch64 ./app-linux-arm64`.

---

## Task 5: Reproducible-build verification

Two independent builders should produce byte-identical binaries.

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -buildvcs=false \
  -ldflags="-s -w -buildid=" \
  -o app .
sha256sum app
```

Run the same command on a second machine (or in a clean Docker container with the same Go version) against the same git commit.

**Acceptance criteria**
- [ ] Both runs print the **same** SHA-256.
- [ ] Pin the toolchain by adding `toolchain go1.23.X` to `go.mod`; verify the hash still matches when `go` selects that toolchain on both hosts.
- [ ] Removing `-trimpath` and rerunning produces a *different* hash (you have proven the flag matters).

---

## Task 6: GitHub Actions release matrix

Create `.github/workflows/release.yml` triggered on tag pushes. Build for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, `windows/amd64` and upload artifacts.

```yaml
on: { push: { tags: ["v*"] } }
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - { goos: linux,   goarch: amd64 }
          - { goos: linux,   goarch: arm64 }
          - { goos: darwin,  goarch: amd64 }
          - { goos: darwin,  goarch: arm64 }
          - { goos: windows, goarch: amd64, ext: .exe }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - env:
          CGO_ENABLED: 0
          GOOS: ${{ matrix.goos }}
          GOARCH: ${{ matrix.goarch }}
        run: |
          mkdir -p dist
          go build -trimpath -ldflags="-s -w -X main.version=${GITHUB_REF_NAME}" \
            -o dist/app-${GOOS}-${GOARCH}${{ matrix.ext }} .
      - uses: actions/upload-artifact@v4
        with:
          name: app-${{ matrix.goos }}-${{ matrix.goarch }}
          path: dist/*
```

**Acceptance criteria**
- [ ] Pushing a tag (`git tag v0.0.1 && git push --tags`) triggers all five matrix jobs.
- [ ] Each job uploads exactly one artifact named after its target.
- [ ] Total wall time of all jobs is under 5 minutes for a small program.

---

## Task 7: Multi-arch Docker image

Build and push one image tag that resolves to `linux/amd64` or `linux/arm64` per pull, using `docker buildx` and a cross-compiled binary inside the Dockerfile.

```dockerfile
# Dockerfile
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

```bash
docker buildx create --use --name multi
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/<you>/app:test \
  --push .
```

**Acceptance criteria**
- [ ] `docker buildx imagetools inspect ghcr.io/<you>/app:test` lists both architectures in the manifest.
- [ ] `docker run --rm --platform linux/arm64 ghcr.io/<you>/app:test` runs the arm64 variant (via QEMU on x86 hosts).
- [ ] The Go compile step runs natively on the build host (no QEMU step inside it), thanks to `$BUILDPLATFORM`.

---

## Task 8: Inspect what you built

Use `go version -m` to confirm a binary's target and build flags.

```bash
go version -m dist/app-linux-amd64
```

**Acceptance criteria**
- [ ] Output includes `GOOS=linux`, `GOARCH=amd64`, `CGO_ENABLED=0`, and the version you injected with `-ldflags="-X main.version=..."`.
- [ ] You can identify, from the output alone, which Go toolchain version produced the binary.

---

## Task 9: Sub-arch knobs

Build for 32-bit ARMv7 with hardware floating point:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm GOARM=7 go build -o app-linux-armv7 .
```

And the amd64 microarchitecture levels:

```bash
GOAMD64=v3 GOOS=linux GOARCH=amd64 go build -o app-linux-amd64-v3 .
```

**Acceptance criteria**
- [ ] `file app-linux-armv7` reports `ELF 32-bit LSB executable, ARM, EABI5 ... hardware FP`.
- [ ] The v3 binary is at most a few % smaller/faster than the default v1; you can identify *one* concrete reason you would (or would not) ship v3.
- [ ] You can explain when `GOARM=5` would be needed (older ARMv5 boards without VFP).
