# Cross-compilation — Find the Bug

Each scenario shows a build or run that looks fine but misbehaves. Find the defect, explain it, and fix it.

---

## Bug 1 — cgo cross-build with no C cross-toolchain

```bash
$ CGO_ENABLED=1 GOOS=linux GOARCH=arm64 go build -o app .
# runtime/cgo
gcc: error: unrecognized command line option '-marm64'
```

**Bug:** cgo is enabled, so the build invokes the host `gcc`, which only targets the host arch. There is no C cross-compiler for `linux/arm64`.

**Fix:** either turn cgo off (`CGO_ENABLED=0`) if you do not actually need C, or supply a real cross C compiler:

```bash
CGO_ENABLED=1 \
  CC="zig cc -target aarch64-linux-musl" \
  CXX="zig c++ -target aarch64-linux-musl" \
  GOOS=linux GOARCH=arm64 go build -o app .
```

---

## Bug 2 — Dynamic binary in a `scratch` container

```bash
$ GOOS=linux GOARCH=amd64 go build -o app .     # CGO_ENABLED unset; defaults to 1 on Linux host
$ docker run --rm scratch ./app
exec /app: no such file or directory
```

**Bug:** without `CGO_ENABLED=0`, `net` and `os/user` pulled in cgo, the binary is dynamically linked against the host glibc, and `scratch` has no libc. The kernel reports "no such file" because the dynamic linker is missing.

**Fix:** force pure-Go: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app .`. Confirm with `file app` showing `statically linked`.

---

## Bug 3 — Missing `GOARM` for an ARMv7 device

```bash
$ GOOS=linux GOARCH=arm go build -o app .
$ scp app pi:/tmp && ssh pi /tmp/app
Illegal instruction
```

**Bug:** `GOARM` defaulted on the build host, producing FPU instructions the target's CPU does not support (e.g., built with VFPv3, target is VFPv2).

**Fix:** specify the ABI explicitly for the target. For Raspberry Pi 2/3 32-bit userland use:

```bash
GOOS=linux GOARCH=arm GOARM=7 go build -o app .
# or for an older ARMv6 board:
GOOS=linux GOARCH=arm GOARM=6 go build -o app .
```

`GOARM=5` is software floating point — required for ARMv5/ARMv4 boards with no FPU.

---

## Bug 4 — `GOAMD64=v3` ships, then SIGILLs on an old VM

```bash
$ GOAMD64=v3 GOOS=linux GOARCH=amd64 go build -o app .
$ ssh old-vm /opt/app
SIGILL: illegal instruction
PC=0x...
```

**Bug:** `GOAMD64=v3` lets the compiler emit AVX2/BMI2 instructions; the old VM's CPU does not support them, so the program traps on the first such instruction.

**Fix:** drop the variable (defaults to `v1`, baseline x86-64) for portable binaries, or pick a level the lowest target CPU supports:

```bash
GOAMD64=v1 GOOS=linux GOARCH=amd64 go build -o app .
```

Only set `v2`/`v3`/`v4` when you own the deployment hardware.

---

## Bug 5 — "exec format error" running the cross-built binary

```bash
$ GOOS=linux GOARCH=amd64 go build -o app .
$ ./app
zsh: exec format error: ./app
```

**Bug:** the macOS host cannot execute a Linux ELF binary. Nothing is broken — the *expectation* is wrong.

**Fix:** run the binary on the target. Common workflows:

```bash
# copy to the target
scp app user@linux-host:/tmp && ssh user@linux-host /tmp/app

# or run in a same-arch container
docker run --rm -v "$PWD:/w" -w /w alpine ./app
```

---

## Bug 6 — Multi-target script overwrites its own output

```bash
for pair in linux/amd64 linux/arm64 darwin/arm64; do
  os=${pair%/*}; arch=${pair#*/}
  GOOS=$os GOARCH=$arch go build -o app .
done
# only the last target's binary remains
```

**Bug:** every iteration writes to the same `app`, so the previous artifact is replaced.

**Fix:** include the target in the output name (and `.exe` on Windows):

```bash
for pair in linux/amd64 linux/arm64 darwin/arm64; do
  os=${pair%/*}; arch=${pair#*/}
  ext=$([ "$os" = "windows" ] && echo .exe)
  GOOS=$os GOARCH=$arch go build -o "dist/app-$os-$arch$ext" .
done
```

---

## Bug 7 — `runtime.GOOS` used at "compile time"

```go
import "runtime"

func init() {
    if runtime.GOOS == "windows" {
        // try to gate a platform-only import here — does not work
    }
}
```

Or a more concrete version that compiles but fails on non-Windows:

```go
import (
    "runtime"
    "golang.org/x/sys/windows"
)

func setup() {
    if runtime.GOOS == "windows" {
        windows.SetConsoleCP(65001)
    }
}
```

**Bug:** `runtime.GOOS` is a runtime constant, but `import "golang.org/x/sys/windows"` is evaluated at *compile* time. Building this for `linux` fails because the import does not exist for that target. The `if` is too late.

**Fix:** split with build tags so the platform-only import only appears in the platform-only file:

```go
// setup_windows.go
//go:build windows
package app
import "golang.org/x/sys/windows"
func setup() { windows.SetConsoleCP(65001) }

// setup_other.go
//go:build !windows
package app
func setup() {}
```

---

## Bug 8 — Filename suffix mis-selects files

```
fileops_linux.go      // intended for all unix
fileops_windows.go
```

Then on macOS:

```bash
$ go build .
./main.go:12: undefined: chownPath
```

**Bug:** `_linux.go` is an implicit build tag for **Linux only**. macOS (`darwin`) does not match, so `fileops_linux.go` is excluded and `chownPath` is undefined.

**Fix:** use an explicit build tag for Unix-like systems instead of relying on the filename:

```go
// fileops_unix.go
//go:build unix
package app
func chownPath(p string, uid, gid int) error { /* ... */ }
```

`unix` matches all Unix-like systems (linux, darwin, freebsd, …).

---

## Bug 9 — `js/wasm` built but `wasm_exec.js` not loaded

```html
<script src="app.wasm"></script>
```

Browser console:

```
Uncaught SyntaxError: Invalid or unexpected token
```

**Bug:** the loader script that bridges Go's wasm to the browser is missing; the browser tries to parse `app.wasm` as JS.

**Fix:** ship and load `wasm_exec.js` first, then instantiate the wasm:

```bash
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
```

```html
<script src="wasm_exec.js"></script>
<script>
  const go = new Go();
  WebAssembly.instantiateStreaming(fetch("app.wasm"), go.importObject)
    .then(r => go.run(r.instance));
</script>
```

---

## Bug 10 — Non-reproducible "reproducible" build

```bash
go build -trimpath -o app .       # builder A
go build -trimpath -o app .       # builder B
sha256sum app                      # hashes differ
```

**Bug:** `-trimpath` alone is not enough. `-buildvcs=true` (default) embeds git state that differs per checkout dir, and the build ID encodes inputs that drift across hosts.

**Fix:** add the rest of the reproducible-build flags and pin the toolchain:

```bash
CGO_ENABLED=0 \
go build \
  -trimpath \
  -buildvcs=false \
  -ldflags="-s -w -buildid=" \
  -o app .
```

Plus `toolchain go1.23.X` in `go.mod` so both hosts use the same compiler.

---

## How to approach these

1. Binary won't run on host? → check `GOOS/GOARCH` vs your machine; expected for cross-builds.
2. Crash with SIGILL / illegal instruction? → check `GOAMD64`, `GOARM`, `GOMIPS` for over-specified ISA.
3. "no such file" in scratch/distroless? → `CGO_ENABLED=0` and verify `file` says statically linked.
4. cgo cross-compile failing on `gcc`? → set `CC`/`CXX` to a real cross compiler (zig-cc is easy).
5. Files not selected? → know that `_linux.go` is Linux-only; use `_unix.go` + `//go:build unix` for Unix-like.
6. Two binaries differ byte-by-byte? → `-trimpath -buildvcs=false -ldflags="-buildid="` + pinned toolchain.
7. Imports for the wrong OS? → never gate `import` with `runtime.GOOS`; that is what build tags exist for.
