# WASI & `GOOS=wasip1` — Find the Bug

> Each snippet contains a real-world bug related to building and running Go-compiled WebAssembly on WASI. `GOOS=wasip1 GOARCH=wasm go build` produces a `.wasm` module that runs on a WASI preview-1 runtime (Wasmtime, wazero, WasmEdge, Node) with no ambient authority — capabilities (preopened directories, env, args) are granted explicitly at run time. Find the bug, explain it (symptom → root cause), and fix it.

---

## Bug 1 — Assuming full POSIX file access

```go
package main

import ("fmt"; "os")

func main() {
	data, _ := os.ReadFile("/etc/hosts")
	fmt.Println(len(data))
}
```

```bash
$ GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
$ wasmtime main.wasm
0
```

**Symptom:** Prints `0`; the file is never read (and the ignored error hides it).

**Root cause:** `wasip1` has no ambient filesystem authority. `/etc` is not preopened, so there is no descriptor to resolve `/etc/hosts` against — the open fails and the ignored error masks it.

**Fix:** never ignore the error, and grant only what you actually need. `/etc/hosts` is not yours to read in a sandbox; pass input through a preopened directory you control:

```go
data, err := os.ReadFile("/data/hosts.txt")
if err != nil { fmt.Fprintln(os.Stderr, "read failed (did you pass --dir?):", err); os.Exit(1) }
```
```bash
$ wasmtime --dir=./data::/data main.wasm
```

---

## Bug 2 — `net.Listen` on `wasip1`

```go
func main() {
	ln, err := net.Listen("tcp", ":8080")
	if err != nil { log.Fatal(err) }
	http.Serve(ln, handler)
}
```

```bash
$ wasmtime main.wasm
Error: unknown import: `wasi_snapshot_preview1::sock_accept`
```

**Symptom:** Instantiation fails on an `unknown import` for a socket function.

**Root cause:** WASI preview 1 has no general networking. `net.Listen` pulls in socket syscalls the standard runtime does not provide to a preview-1 guest. The module cannot even instantiate.

**Fix:** `wasip1` is not for network servers. Either move the server behind a `//go:build !wasip1` boundary, or rethink the target. The platform (edge/serverless host) must route requests in; the wasm function should be pure compute:

```go
//go:build wasip1
func Serve() error { return errors.New("no networking on wasip1") }
```

---

## Bug 3 — Guest path does not match the preopen mapping

```go
data, err := os.ReadFile("/input/config.json")
```

```bash
$ wasmtime --dir=./config::/data main.wasm
read failed: open /input/config.json: no such file or directory
```

**Symptom:** "Not found" even though `--dir` was passed and the file exists on disk.

**Root cause:** The directory was preopened at *guest* path `/data`, but the code asks for `/input/...`. The host advertises `/data`; nothing resolves `/input`.

**Fix:** match the guest path on both sides — either change the code to `/data/config.json` or the flag to `--dir=./config::/input`:

```bash
$ wasmtime --dir=./config::/input main.wasm   # now guest path matches the code
```

---

## Bug 4 — Building the browser target by mistake

```bash
$ GOOS=js GOARCH=wasm go build -o main.wasm .
$ wasmtime main.wasm
Error: unknown import: `gojs::runtime.wasmExit`
```

**Symptom:** A wasm runtime rejects the module with imports from a `gojs`/`go`/JavaScript namespace.

**Root cause:** `GOOS=js` is the *browser* target. It imports JavaScript glue, not WASI. Wasmtime is a WASI host and cannot satisfy those imports.

**Fix:** use the WASI target for non-browser runs:

```bash
$ GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
$ wasmtime main.wasm
```

---

## Bug 5 — `wasip1` on Go older than 1.21

```bash
$ go version
go version go1.20.5 darwin/arm64
$ GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
go: unsupported GOOS/GOARCH pair wasip1/wasm
```

**Symptom:** The build refuses the GOOS/GOARCH pair.

**Root cause:** The `wasip1` port was added in **Go 1.21**. Earlier toolchains have no such target.

**Fix:** upgrade. Record the floor in `go.mod` so consumers get a clear error:

```bash
$ go install golang.org/dl/go1.24@latest && go1.24 download
$ GOOS=wasip1 GOARCH=wasm go1.24 build -o main.wasm .
```
```go.mod
go 1.21
```

---

## Bug 6 — `go:wasmexport` on Go < 1.24

```go
//go:wasmexport process
func process(ptr unsafe.Pointer, n uint32) uint32 { /* ... */ }
```

```bash
$ go version
go version go1.22.0 linux/amd64
$ GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
./main.go:12:1: //go:wasmexport directive is not supported in this Go version
```

**Symptom:** The compiler rejects (or ignores) the directive.

**Root cause:** `go:wasmexport` was added in **Go 1.24**. `go:wasmimport` (Go 1.21) is available earlier, but exporting Go functions to the host is a 1.24 feature.

**Fix:** upgrade to Go 1.24+, or restructure as a run-once command (`main` + stdio) if you cannot. Most "I read this in a blog and it won't build" cases are this version mismatch.

---

## Bug 7 — `go:wasmimport` on a stock runtime

```go
//go:wasmimport env metrics_emit
func emit(ptr unsafe.Pointer, n uint32)
```

```bash
$ wasmtime main.wasm
Error: unknown import: `env::metrics_emit`
```

**Symptom:** Instantiation fails with `unknown import: env::...`.

**Root cause:** `go:wasmimport` declares a function the *host* must supply. Run on a stock CLI with no embedder, nothing provides `env::metrics_emit`.

**Fix:** run the module through the embedder that registers the import (e.g. a wazero host with `HostModuleBuilder().Export("metrics_emit")`), or for standalone runs, stub the import behind a build tag.

---

## Bug 8 — Passing a Go string across `go:wasmimport`

```go
//go:wasmimport host log
func hostLog(msg string)   // compile error
```

```bash
$ GOOS=wasip1 GOARCH=wasm go build .
./main.go:4:6: go:wasmimport: unsupported parameter type string
```

**Symptom:** The compiler rejects a `string` parameter.

**Root cause:** Only wasm-native types cross the boundary: integers, floats, `unsafe.Pointer`, and a few pointer-shaped types. A Go `string` (header + backing array) is not representable as a single wasm value.

**Fix:** pass a pointer + length and have the host read guest memory:

```go
//go:wasmimport host log
func hostLog(ptr unsafe.Pointer, n uint32)

func logMsg(s string) {
	b := []byte(s)
	if len(b) == 0 { return }
	hostLog(unsafe.Pointer(&b[0]), uint32(len(b)))
}
```

---

## Bug 9 — Passing a pointer the GC may move

```go
//go:wasmimport host store
func store(ptr unsafe.Pointer, n uint32)

func enqueue() {
	b := makePayload()         // []byte
	store(unsafe.Pointer(&b[0]), uint32(len(b)))
	// host retains the pointer and reads it LATER, asynchronously
}
```

**Symptom:** The host occasionally reads garbage; intermittent corruption that looks like a runtime bug.

**Root cause:** The host retains the guest pointer past the synchronous call. Go's GC may move or free `b` after `enqueue` returns, so the offset now points at relocated/freed memory.

**Fix:** treat cross-boundary pointers as valid only for the synchronous call. If the host must retain bytes, it must copy them during the call; if the guest must keep memory stable across operations, pin it:

```go
var p runtime.Pinner
p.Pin(&b[0])
defer p.Unpin()
store(unsafe.Pointer(&b[0]), uint32(len(b)))
```

---

## Bug 10 — `go run` without the exec wrapper

```bash
$ export GOOS=wasip1 GOARCH=wasm
$ go run .
fork/exec /tmp/go-build.../main: exec format error
```

**Symptom:** `go run` builds but cannot launch the binary.

**Root cause:** The OS cannot execute a `.wasm` directly. `go run`/`go test` rely on the `go_wasip1_wasm_exec` wrapper being on `PATH`, which shells out to a runtime named by `GOWASIRUNTIME`.

**Fix:**

```bash
$ export PATH="$PATH:$(go env GOROOT)/lib/wasm"
$ export GOWASIRUNTIME=wasmtime
$ go run .
```

---

## Bug 11 — Forwarding the whole host environment to untrusted code

```go
cfg := wazero.NewModuleConfig()
for _, e := range os.Environ() {                 // forwards EVERYTHING
	kv := strings.SplitN(e, "=", 2)
	cfg = cfg.WithEnv(kv[0], kv[1])
}
mod, _ := r.InstantiateModule(ctx, plugin, cfg)   // plugin is untrusted
```

**Symptom:** An untrusted plugin can read `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL`, and every other host secret.

**Root cause:** Forwarding the entire environment to a sandboxed guest defeats the capability model. The sandbox limits reach, but you handed it the keys.

**Fix:** pass only the env the plugin's contract requires:

```go
cfg := wazero.NewModuleConfig().
	WithEnv("PLUGIN_MODE", "batch")   // nothing else
```

---

## Bug 12 — A confused-deputy host import

```go
// Host function exposed to the guest:
r.NewHostModuleBuilder("host").NewFunctionBuilder().
	WithFunc(func(_ context.Context, m api.Module, ptr, n uint32) uint32 {
		path, _ := m.Memory().Read(ptr, n)
		data, _ := os.ReadFile(string(path))   // opens whatever the guest asks
		// ... copies data back into guest memory ...
		return 0
	}).Export("read_file").Instantiate(ctx)
```

**Symptom:** The wasm sandbox is intact, yet a guest reads `/etc/passwd` by calling `read_file("/etc/passwd")`.

**Root cause:** The host volunteers to perform host I/O on a guest-supplied, unvalidated path. This re-introduces full ambient authority through the host ABI — the sandbox is only as tight as its weakest host import.

**Fix:** validate and scope guest-supplied arguments against a host-controlled allowlist:

```go
func(_ context.Context, m api.Module, ptr, n uint32) uint32 {
	raw, _ := m.Memory().Read(ptr, n)
	name := filepath.Base(string(raw))          // strip path traversal
	full := filepath.Join(allowedDir, name)      // confine to one directory
	if !strings.HasPrefix(full, allowedDir) { return 1 }
	// ... read full ...
}
```

---

## Bug 13 — Expecting goroutines to use multiple cores

```go
func main() {
	runtime.GOMAXPROCS(8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); crunch() }()  // CPU-bound
	}
	wg.Wait()
}
```

**Symptom:** No speedup over a single goroutine; eight CPU-bound goroutines take roughly the same wall-clock time as one.

**Root cause:** `wasip1` is single-threaded. The Go runtime schedules all goroutines cooperatively on one OS thread; `GOMAXPROCS(8)` does not create parallelism. Goroutines correctly *interleave* but never run simultaneously.

**Fix:** do not expect parallel speedup on `wasip1`. Use goroutines for I/O-bound structure, not CPU fan-out. If the workload needs cores, `wasip1` is the wrong target.

---

## Bug 14 — `os/exec` on `wasip1`

```go
out, err := exec.Command("ls", "-la").Output()
```

```bash
$ wasmtime --dir=. main.wasm
fork/exec ls: operation not supported
```

**Symptom:** Spawning a subprocess fails.

**Root cause:** `wasip1` has no `fork`/`exec`. There is no way to start another process from inside the sandbox.

**Fix:** there is no subprocess model on `wasip1`. Reimplement the needed logic in-process, or move it to the host (which can run subprocesses and pass results to the guest via a host import). Guard the native path with `//go:build !wasip1`.

---

## Bug 15 — Confusing `//go:build wasm` with `//go:build wasip1`

```go
//go:build wasm

package transport

// Intended only for the WASI server-side build, but...
func init() { registerWASIHooks() }
```

**Symptom:** The code also runs in the browser (`GOOS=js`) build and breaks there, or vice versa.

**Root cause:** `//go:build wasm` matches the `GOARCH=wasm` for *both* `js/wasm` and `wasip1/wasm`. The file leaks into the browser target.

**Fix:** use the specific `GOOS` tag:

```go
//go:build wasip1
// (use //go:build js for the browser-only path)
```

---

## Bug 16 — Relying on a non-standard socket extension as "portable"

```go
//go:build wasip1
// uses WasmEdge's non-standard sockets extension
conn := wasmedge_sock.Dial("tcp", addr)
```

```bash
# Works on WasmEdge:
$ wasmedge main.wasm           # ok
# Fails on Wasmtime:
$ wasmtime main.wasm
Error: unknown import: `wasi_snapshot_preview1::sock_open`
```

**Symptom:** Runs on one runtime, fails to instantiate on another.

**Root cause:** "Portable" means portable across the *standard* preview-1 feature set. WasmEdge's socket extension is non-standard; Wasmtime does not provide it. Code depending on an extension is locked to that runtime.

**Fix:** if you need networking, accept the non-portability explicitly (document and pin the runtime), or wait for preview 2's standard `wasi:sockets`. Do not ship extension-dependent code as "portable."

---

## Bug 17 — Calling a `go:wasmexport` function before `_initialize`

```go
// Host (reactor model):
mod, _ := r.InstantiateModule(ctx, compiled,
	wazero.NewModuleConfig().WithStartFunctions()) // disabled auto-init
fn := mod.ExportedFunction("process")
fn.Call(ctx, ptr, n)   // called before _initialize ran
```

**Symptom:** The exported function crashes or behaves unpredictably; the Go runtime is not ready.

**Root cause:** A reactor module must have `_initialize` run once before any export is called, so runtime and package `init` complete. Disabling start functions and calling `process` immediately skips initialisation.

**Fix:** let initialisation run (do not disable it), or invoke `_initialize` explicitly before the first export call:

```go
mod, _ := r.InstantiateModule(ctx, compiled, wazero.NewModuleConfig())
// wazero runs _initialize for a reactor automatically; then:
mod.ExportedFunction("process").Call(ctx, ptr, n)
```

---

## Bug 18 — Recompiling the module on every request

```go
func handle(input []byte) ([]byte, error) {
	r := wazero.NewRuntime(ctx); defer r.Close(ctx)
	wasi_snapshot_preview1.MustInstantiate(ctx, r)
	compiled, _ := r.CompileModule(ctx, wasmBytes)  // expensive, EVERY call
	mod, _ := r.InstantiateModule(ctx, compiled, cfg)
	defer mod.Close(ctx)
	// ...
}
```

**Symptom:** Throughput collapses under load; CPU is dominated by compilation, not the plugin's work.

**Root cause:** `CompileModule` JIT/AOT-compiles the bytes — the expensive step. Doing it per request recompiles the same module thousands of times.

**Fix:** compile once at startup, instantiate per request:

```go
// startup:
compiled, _ := rt.CompileModule(ctx, wasmBytes)   // once
// per request:
mod, _ := rt.InstantiateModule(ctx, compiled, cfg) // cheap
```

---

## Bug 19 — No execution limit on untrusted code

```go
mod, err := r.InstantiateModule(ctx, untrustedPlugin, cfg)  // ctx has no deadline
```

**Symptom:** A plugin with an infinite loop hangs the host goroutine forever; an allocation bomb OOMs the host.

**Root cause:** The wasm sandbox provides memory isolation but not resource limits. Without a deadline and a memory cap, untrusted code can deny service.

**Fix:** bound every untrusted invocation:

```go
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()
// plus a memory limit via runtime config (max pages),
// or Wasmtime fuel for an instruction budget.
mod, err := r.InstantiateModule(ctx, untrustedPlugin, cfg)
```

---

## Bug 20 — Assuming `crypto/rand` is safe without checking the runtime

```go
b := make([]byte, 32)
rand.Read(b)            // crypto/rand
token := hex.EncodeToString(b)
```

```bash
# On a runtime whose random_get is stubbed to zeros for "determinism":
$ some-runtime main.wasm
token: 0000000000000000000000000000000000000000000000000000000000000000
```

**Symptom:** Cryptographic tokens are predictable (all zeros, or repeating).

**Root cause:** `crypto/rand` maps to WASI `random_get`. Some runtimes (or deterministic-replay configurations) stub `random_get` to a constant or seeded source. The Go code is correct; the host's randomness is not cryptographic.

**Fix:** verify `random_get` provides real entropy on the runtimes you deploy to; never run security-sensitive randomness on a runtime configured for deterministic replay. For deterministic execution you *want* a seed — but then do not use that build for real tokens.

---

## Bug 21 — Treating `os.Args[0]` as a stable path

```go
exeDir := filepath.Dir(os.Args[0])
cfg, _ := os.ReadFile(filepath.Join(exeDir, "config.yaml"))
```

**Symptom:** Works on one runtime, breaks on another; `os.Args[0]` is the bare module name (`main.wasm`) rather than a path, so `exeDir` is `.` and the config is not found.

**Root cause:** `os.Args[0]` is runtime-dependent on `wasip1` — some runtimes pass the module filename, others a path. There is no portable executable-path semantics in the sandbox.

**Fix:** do not derive paths from `os.Args[0]`. Pass config location explicitly via a preopened directory and a known guest path, or via an argument/env you control:

```go
cfg, err := os.ReadFile("/config/config.yaml")   // a preopened guest path
```

---

## Bug 22 — Confusing preview 2 docs with the `wasip1` build

```go
// Following a "WASI 0.2 / wasi:http" tutorial:
import "go.bytecodealliance.org/cm"   // component-model bindings
//go:wasmexport handle
func handle(req wasihttp.Request) wasihttp.Response { /* ... */ }
```

```bash
$ GOOS=wasip1 GOARCH=wasm go build .
# fails: wasi:http / component types are not preview-1
```

**Symptom:** Component-Model / `wasi:http` code does not build (or run) under `GOOS=wasip1`.

**Root cause:** `wasi:http`, `wasi:sockets`, WIT, and the Component Model are **preview 2**. The Go standard toolchain emits **preview 1** for `GOOS=wasip1`. The tutorial targets a different ABI.

**Fix:** for current standard-toolchain work, build to preview 1 and use its model (stdio, preopens, `go:wasmimport`/`go:wasmexport`, pointer+length). Use component/preview-2 tooling and adapters only when you are explicitly targeting that ecosystem — and know the Go standard `go build` does not produce components today.

---

## Summary

A `.wasm` from `GOOS=wasip1` looks like an ordinary binary, but it runs inside a deny-by-default sandbox whose only contract is its import list. Most `wasip1` bugs come from one of four habits:

1. **Assuming native authority.** No ambient filesystem, no networking, no threads, no subprocesses, no stable `os.Args[0]`. Grant capabilities explicitly, guard unsupported operations with `//go:build wasip1`, and never ignore the errors that reveal a missing grant.
2. **Getting the boundary wrong.** Guest-path vs host-path mismatches, passing rich Go types or unstable pointers across `go:wasmimport`, and recompiling per request. The boundary is primitive types + pointer/length + compile-once-instantiate-many; respect it.
3. **Mistaking the memory sandbox for a full sandbox.** Memory isolation is free; resource limits (timeout/fuel/memory) and the safety of host imports (confused deputy, leaked env) are your responsibility.
4. **Version and ABI confusion.** `wasip1` needs Go 1.21, `go:wasmexport` needs Go 1.24, and everything labelled Component Model / WASI 0.2 / `wasi:http` is preview 2, which the standard toolchain does not emit.

Treat the import list as the truth, the run command as the capability set, and the host as the privileged party — and the rest of `wasip1` becomes predictable.
