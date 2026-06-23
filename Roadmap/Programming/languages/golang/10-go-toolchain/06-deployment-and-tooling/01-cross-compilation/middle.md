# Cross-compilation — Middle

## 1. Targets you actually ship

For most server-side and CLI work, the realistic target set is small:

| GOOS / GOARCH | Where it runs |
|---------------|---------------|
| `linux/amd64` | The default Linux server / Docker x86-64 |
| `linux/arm64` | AWS Graviton, Ampere, Raspberry Pi 4/5 64-bit |
| `darwin/amd64` | Intel Macs |
| `darwin/arm64` | Apple Silicon Macs (M1/M2/M3/M4) |
| `windows/amd64` | Windows 10/11 / Server desktops |
| `windows/arm64` | Windows on Snapdragon |
| `js/wasm` | Browsers (with the wasm exec script) |
| `wasip1/wasm` | WASI runtimes (wasmtime, wasmer) |

If your tool is open-source, this matrix is what users expect to find in release archives.

---

## 2. `CGO_ENABLED=0` — the cross-build switch you must know

By default, `CGO_ENABLED=1` on hosts where a C compiler is present. The `net` and `os/user` packages then use **cgo** for DNS and user lookups, which means the resulting binary needs the target's libc to run, and cross-compiling those parts needs a C cross-toolchain.

Set `CGO_ENABLED=0` to force pure-Go implementations. The result is a fully static binary that you can drop into a `scratch` or `distroless/static` container.

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app-linux-amd64 .
```

You almost always want this for cross-builds.

---

## 3. Output naming conventions

When you build several targets in one place, name them by target so they do not overwrite each other:

```bash
go build -o app-linux-amd64       # linux x86-64
go build -o app-linux-arm64       # linux arm64
go build -o app-darwin-arm64      # macOS Apple Silicon
go build -o app-windows-amd64.exe # Windows (note the .exe)
```

Conventional pattern: `<name>-<goos>-<goarch>[.exe]`. GoReleaser, GitHub release pages, and Homebrew tap formulas all follow this shape.

---

## 4. A simple multi-target Makefile

```make
APP    := myapp
LDFLAGS := -s -w -X main.version=$(shell git describe --tags --always)
GOFLAGS := -trimpath -buildvcs=false

TARGETS := \
  linux/amd64 \
  linux/arm64 \
  darwin/amd64 \
  darwin/arm64 \
  windows/amd64

.PHONY: all clean
all: $(TARGETS)

$(TARGETS):
	@os=$(word 1,$(subst /, ,$@)); arch=$(word 2,$(subst /, ,$@)); \
	 ext=$$( [ "$$os" = "windows" ] && echo .exe ); \
	 echo ">> $$os/$$arch"; \
	 CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
	   go build $(GOFLAGS) -ldflags="$(LDFLAGS)" \
	   -o dist/$(APP)-$$os-$$arch$$ext .

clean:
	rm -rf dist
```

`make all` produces a `dist/` directory with one binary per target.

---

## 5. Build tags — keep platform code out of the way

If you need OS-specific code (e.g., setting file ownership on Unix only), split it into per-OS files using build constraints:

```go
// file: priv_unix.go
//go:build linux || darwin

package app

import "syscall"

func setOwner(path string, uid, gid int) error {
    return syscall.Chown(path, uid, gid)
}
```

```go
// file: priv_windows.go
//go:build windows

package app

func setOwner(path string, uid, gid int) error {
    return nil // no-op on Windows
}
```

Or use the filename suffix convention recognized by the toolchain: `_linux.go`, `_windows.go`, `_amd64.go`, `_linux_arm64.go`. These are implicit build constraints.

This lets you cross-compile a single codebase to every target without `#ifdef`-style noise.

---

## 6. Runtime detection — `runtime.GOOS` / `runtime.GOARCH`

Sometimes you want to branch at run time, not compile time (e.g., printing the platform in a version banner):

```go
import "runtime"

func banner() string {
    return fmt.Sprintf("%s %s/%s", appName, runtime.GOOS, runtime.GOARCH)
}
```

Important: `runtime.GOOS` and `runtime.GOARCH` are **constants determined at compile time**. They report the **target** the binary was built for, not the host it currently runs on (which is the same thing for the binary's lifetime). Do not use them to gate `import` statements — that is what build tags are for.

---

## 7. Picking between build tags and `runtime.GOOS`

| Use build tags when... | Use `runtime.GOOS` when... |
|------------------------|----------------------------|
| You import platform-only packages | You only need a string for logging |
| Code uses syscalls that do not exist elsewhere | Behavior tweaks but same APIs |
| You want zero overhead (dead code eliminated) | Branching is rare and cheap |
| The wrong file would not even compile | All branches always compile |

A common mistake: writing `if runtime.GOOS == "windows" { import "..." }` — illegal. `import` is not a statement; you need build tags.

---

## 8. WebAssembly targets

Two distinct wasm targets exist:

```bash
# Browser
GOOS=js GOARCH=wasm go build -o app.wasm .

# Server-side wasm (WASI preview 1)
GOOS=wasip1 GOARCH=wasm go build -o app.wasm .
```

For `js/wasm` you also need the loader script that ships with Go:

```bash
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

(Or `$(go env GOROOT)/misc/wasm/wasm_exec.js` on Go versions before 1.24.)

For `wasip1/wasm`, run with a host like `wasmtime app.wasm`.

---

## 9. Inspecting what you produced

```bash
file app-linux-amd64
# app-linux-amd64: ELF 64-bit LSB executable, x86-64, statically linked

go version -m app-linux-amd64
# app-linux-amd64: go1.23.4
#         path    example.com/myapp
#         mod     example.com/myapp v0.1.0
#         build   GOOS=linux
#         build   GOARCH=amd64
#         build   CGO_ENABLED=0
```

`go version -m` reads the build info embedded in the binary — great for auditing what target and flags produced a given artifact.

---

## 10. Summary

Day-to-day cross-compilation is `CGO_ENABLED=0 GOOS=… GOARCH=… go build`, named consistently per target, driven from a Makefile. Use build tags or filename suffixes for platform-specific code, and `runtime.GOOS`/`GOARCH` only when you need a runtime string. Two wasm targets exist (`js` and `wasip1`); each needs its own runner. `go version -m` confirms how a binary was built.

---

## Further reading
- `go help build`, `go help buildconstraint`
- Build constraints: https://pkg.go.dev/cmd/go#hdr-Build_constraints
- `go tool dist list`
- WebAssembly: https://go.dev/wiki/WebAssembly
- WASI: https://go.dev/blog/wasi
