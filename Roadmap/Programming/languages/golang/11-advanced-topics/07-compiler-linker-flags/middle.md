# Compiler & Linker Flags — Middle

## 1. The package pattern

```bash
go build -gcflags='all=-N -l' ./cmd/app           # all packages
go build -gcflags='main=-N -l' ./cmd/app          # only main
go build -gcflags='example.com/proj/...=-m' .     # subtree
```

The `pattern=flags` form selects which packages get the flags. Useful when you want to debug only your code and let stdlib be optimized.

---

## 2. Common `-gcflags`

| Flag | Effect | When |
|------|--------|------|
| `-N` | Disable optimizations | Debugger compatibility |
| `-l` | Disable inlining | Source-level debugging |
| `-m`, `-m=2`, `-m=3` | Print compiler decisions | Escape/inline diagnostics |
| `-S` | Print assembly | Performance investigation |
| `-d=<key>=<value>` | Debug knob | Specific runtime features |
| `-spectre=all` | Spectre mitigations | Hardened environments |
| `-trimpath` | Remove paths | Reproducible builds |

`-gcflags='all=-N -l'` is the standard "delve-friendly build" combo.

---

## 3. Common `-ldflags`

```bash
go build -ldflags="-s -w -X main.ver=1.2.3 -B 0xdeadbeef" ./cmd/app
```

| Flag | Effect |
|------|--------|
| `-s` | Omit symbol table |
| `-w` | Omit DWARF debug info |
| `-X pkg.var=val` | Inject string into a string var |
| `-B id` | Set build ID |
| `-linkmode=internal\|external` | Pure-Go vs system linker |
| `-extldflags="..."` | Pass flags to the external linker |
| `-r path` | rpath for dynamic linking |

`-X` only works on declared `var` of type `string`. Constant strings can't be injected.

---

## 4. Reproducible builds

```bash
go build -trimpath -buildvcs=false \
  -ldflags="-buildid='' -s -w -X main.ver=v1.2.3" \
  -o app ./cmd/app
```

To get the same binary across machines:

- `-trimpath`: remove file system paths.
- `-buildvcs=false`: skip git metadata embedding.
- `-buildid=''`: don't include a random build ID.
- Pin Go toolchain version (e.g., `go.mod`'s `go 1.24.2`).
- Build with identical `GOOS`/`GOARCH`/`GOMOD`/`CGO_ENABLED`.

Verify with `sha256sum` of the binary on two machines.

---

## 5. Build modes

```bash
go build -buildmode=c-shared -o libapp.so .       # for C to call Go
go build -buildmode=pie -o app .                  # position-independent
go build -buildmode=plugin -o plugin.so .         # plugin (Linux/macOS)
```

Each changes the output format:

- `exe` (default): standard executable.
- `pie`: hardened, address-randomization-friendly.
- `c-archive` / `c-shared`: for cgo embedding.
- `plugin`: for the `plugin` package.

---

## 6. Profile-guided optimization

```bash
# Step 1: capture a profile (e.g., from production or load test)
curl http://localhost:6060/debug/pprof/profile?seconds=60 > default.pgo

# Step 2: rebuild with the profile
go build -pgo=auto -o app ./cmd/app
```

The compiler uses the profile to make better inlining and devirtualization decisions. Typical gains: 2–10% CPU. PGO support is GA in Go 1.21+.

For multi-binary projects, place `default.pgo` next to `main.go`. For external profiles, use `-pgo=/path/to/file`.

---

## 7. Stripping symbol info for size

```
-s   strip the symbol table
-w   strip DWARF debug info
```

After stripping:

- Stack traces still readable (function names embedded in `runtime`).
- `delve` and other source-level debuggers won't work.
- `go tool nm` produces less info.
- Binary is 10–20% smaller.

For production releases where you don't need on-the-fly debugging, strip; for staging/dev, don't.

---

## 8. Build cache and flags

Each combination of flags creates a separate cache entry. Switching between two flag sets repeatedly:

- First switch: cold cache, full rebuild.
- Second switch back: cache is warm, fast.
- Long-term flag stability minimizes cache thrash.

Tip for CI: build with the *exact same* flag string every time. Variations (e.g., a date in `-X`) cause unnecessary cache misses.

---

## 9. The `-x` and `-work` debugging duo

```bash
go build -x -work ./cmd/app
```

Output:

```
WORK=/tmp/go-build1234567
mkdir -p /tmp/go-build1234567/b001/
...
/usr/local/go/pkg/tool/darwin_arm64/compile -o ... main.go
...
```

You see the exact compile/link commands. `-work` keeps the workdir so you can inspect the intermediate files.

Use case: "why is my build picking up an old file?" Step through the printed commands.

---

## 10. `go env GOFLAGS`

```bash
go env -w GOFLAGS='-trimpath -ldflags=-s\ -w'
```

Sets a default for every subsequent `go build`. Be careful — this affects *every* invocation including `go test`.

Better: write a `Makefile` or shell function that bundles flags explicitly.

---

## 11. Cross-compilation

```bash
GOOS=linux GOARCH=amd64 \
  CGO_ENABLED=0 \
  go build -ldflags="-s -w" -o app-linux ./cmd/app
```

The env vars select the target. Build flags work the same. For cgo, you need a cross-compiler.

Multi-target script:

```bash
for goos in linux darwin windows; do
  for goarch in amd64 arm64; do
    out="bin/app_${goos}_${goarch}"
    [[ $goos == windows ]] && out="${out}.exe"
    GOOS=$goos GOARCH=$goarch go build -ldflags="-s -w" -o $out ./cmd/app
  done
done
```

---

## 12. Inspecting a built binary

```bash
go version -m ./app                # build info
go tool nm ./app | head            # symbols (none if -s)
go tool objdump ./app | head       # disassembly
file ./app                         # static/dynamic, ELF/Mach-O
ldd ./app                          # dynamic deps (Linux)
```

`go version -m` is gold for figuring out "was this built with cgo? what tags? what go version?"

---

## 13. Common combos

```bash
# Production release
go build -trimpath -ldflags='-s -w -X main.ver=v1.0.0' -o app ./cmd/app

# Development (debugger-friendly)
go build -gcflags='all=-N -l' -o app ./cmd/app

# Show escape decisions
go build -gcflags='-m=2' ./pkg

# Race-detect testing
go test -race ./...

# PGO release
go build -pgo=default.pgo -trimpath -ldflags='-s -w' -o app ./cmd/app

# Static cgo (Alpine)
CGO_ENABLED=1 go build -ldflags='-linkmode=external -extldflags="-static"' -o app ./cmd/app

# WASM
GOOS=js GOARCH=wasm go build -o app.wasm ./cmd/web
```

Memorize the two or three you use daily; reach for the docs for the rest.

---

## 14. Summary

`go build`'s flag system is small but expressive: `-gcflags` for the compiler, `-ldflags` for the linker, plus a handful of top-level switches like `-trimpath`, `-pgo`, `-race`. Cache awareness, package patterns, and the `-x`/`-work` debug duo round out the toolkit. Most projects can settle on 2–3 standard incantations and forget the rest.

---

## Further reading
- `go help build`, `go help buildflags`
- `go tool compile -h`, `go tool link -h`
- PGO docs: https://go.dev/doc/pgo
