# WASI & `GOOS=wasip1` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end.

---

## Easy

### Task 1 — Build and run a `wasip1` module on two runtimes

Write a `main.go` that prints a line. Build it with `GOOS=wasip1 GOARCH=wasm`, then run the *same* `main.wasm` on two different runtimes (e.g. Wasmtime and wazero).

Success:
- One `.wasm` artifact runs unchanged on both runtimes.
- Output is identical.

**Goal.** See that a `wasip1` module is a portable artifact, not runtime-specific.

---

### Task 2 — Observe deny-by-default

Write a program that reads `/data/in.txt` and prints its size. Run it three ways:

```bash
wasmtime main.wasm                       # no preopen
wasmtime --dir=./data::/data main.wasm   # preopen granted
```

Confirm the first fails ("not found"/"not permitted") and the second works after you create `./data/in.txt`.

**Goal.** Internalise that the filesystem is invisible until a directory is preopened.

---

### Task 3 — Pass args and env explicitly

Write a program that prints `os.Args`, `os.Getenv("TOKEN")`, and `os.Getenv("PATH")`. Run it with and without `--env TOKEN=...`.

Observe: `TOKEN` is empty until granted; `PATH` is always empty (your shell environment is not inherited); args appear only after the module name.

**Goal.** See that args, env, and files are three independent capability grants.

---

### Task 4 — Set up the `go run` / `go test` exec wrapper

Configure the toolchain so `go run .` works for `wasip1`:

```bash
export PATH="$PATH:$(go env GOROOT)/lib/wasm"
export GOWASIRUNTIME=wasmtime
GOOS=wasip1 GOARCH=wasm go run .
```

Then deliberately unset `PATH`'s wasm entry and observe the failure (an "exec format error" or "no such file").

**Goal.** Understand why `go run`/`go test` need the exec wrapper and `GOWASIRUNTIME`.

---

### Task 5 — Diagnose a guest/host path mismatch

Take Task 2's program but change the code to read `/input/in.txt`. Run it with `--dir=./data::/data`. It fails even though the directory is preopened. Fix it by either changing the code to `/data/in.txt` or the flag to `--dir=./data::/input`.

**Goal.** Recognise that "preopened but still not found" is almost always a guest-path mismatch.

---

## Medium

### Task 6 — A portable filter as a `.wasm`

Write a stdin→stdout filter (e.g. uppercase each line, or count words). Build it for `wasip1`. Pipe input through it on a runtime:

```bash
echo "make me loud" | wasmtime upper.wasm
```

Confirm it behaves as a Unix filter, shipped as one architecture-independent module.

**Goal.** See that filter-shaped programs port to `wasip1` with zero changes.

---

### Task 7 — Prove networking does not work, then guard it

Write a program that calls `net.Dial("tcp", "example.com:80")`. Build for `wasip1` and run. Observe the failure (an `unknown import` socket error at instantiation, or a runtime error). Then refactor: put the networking behind an interface with a `//go:build !wasip1` native implementation and a `//go:build wasip1` implementation that returns a clear "not supported on wasip1" error.

**Goal.** Internalise the no-networking reality and the build-tag fix.

---

### Task 8 — `go:wasmimport` against a standalone runtime (and watch it fail)

Write a program with a `go:wasmimport` declaration:

```go
//go:wasmimport env log_message
func hostLog(ptr unsafe.Pointer, n uint32)
```

Build and run it on a stock `wasmtime main.wasm` with no embedder. Observe instantiation fail with `unknown import: env::log_message`. This is the expected behaviour — the host must supply the import.

**Goal.** Understand that `go:wasmimport` requires a host that provides the function.

---

### Task 9 — Inspect the import surface

For any `wasip1` binary you built, dump its imports:

```bash
wasm-tools print main.wasm | grep '(import'
```

List the `wasi_snapshot_preview1` functions present. For Task 7's networking binary, find the socket import that the stock runtime cannot satisfy.

**Goal.** Learn to read the module's contract — the import list is the truth about host obligations.

---

### Task 10 — Strip and measure the binary

Build the same program twice: once plain, once with `-ldflags="-s -w" -trimpath`. Compare sizes with `ls -l` / `du -h`. Note the reduction and that the runtime is still embedded (it is still MB-scale).

**Goal.** Know the size levers and that Go `wasip1` binaries are large by nature.

---

### Task 11 — Test the `wasip1` path in CI

Add a `_test.go` that exercises a function reading a fixture from `testdata/`. Run `go test ./...` under `wasip1` via the exec wrapper, ensuring `testdata/` is preopened (through the runtime's flags). Confirm the test passes on wasm, not just natively.

**Goal.** Build the CI habit that catches build-tag and ABI mistakes the native build hides.

---

## Hard

### Task 12 — Embed a Go guest in a Go host with wazero

Write a Go *host* program using wazero that:

1. Reads a `.wasm` plugin file.
2. Instantiates WASI preview-1 host functions.
3. `CompileModule` once.
4. Instantiates the module with stdin set to some input and stdout captured.
5. Returns the captured output.

Then write a Go *guest* (built for `wasip1`) that reads stdin, transforms it, and writes stdout. Run the guest through your host.

**Goal.** Build the canonical Go-host-embeds-Go-guest plugin pattern.

---

### Task 13 — Add a custom host function (`go:wasmimport` + wazero)

Extend Task 12: in the host, register a `host.emit(ptr, len)` function via `HostModuleBuilder` that reads the guest's memory (`m.Memory().Read`) and logs it. In the guest, declare `//go:wasmimport host emit` and call it with a pointer+length. Confirm the host logs the guest's message.

**Goal.** Implement the inbound interop ABI end-to-end with safe memory reads.

---

### Task 14 — Bound an untrusted plugin

Extend Task 12 so a misbehaving guest cannot harm the host:

1. Write a guest with an infinite loop.
2. In the host, wrap instantiation in `context.WithTimeout(ctx, 1*time.Second)`.
3. Confirm the guest is interrupted and the host receives a trap/cancellation error rather than hanging.
4. Add a memory limit and confirm an unbounded-allocation guest traps instead of OOMing the host.

**Goal.** Practise resource containment for untrusted code — what the sandbox does not give you for free.

---

### Task 15 — `go:wasmexport` reactor (Go 1.24+)

On Go 1.24 or newer, write a guest that exports a function:

```go
//go:wasmexport process
func process(ptr unsafe.Pointer, n uint32) uint32 { /* ... */ }
```

In a wazero host, instantiate the module, ensure `_initialize` runs, then call `process` *multiple times* with different inputs without re-instantiating. Verify the first call works and subsequent calls reuse the same instance.

**Goal.** Build the request/response (reactor) plugin model and see the difference from a run-once command.

---

### Task 16 — Capability scoping per invocation

Extend the plugin host so each invocation gets a *fresh per-call scratch directory* preopened at a fixed guest path, and only a contractually-defined env set. Run two invocations and confirm one cannot see the other's scratch files, and that neither can read a directory you did not grant.

**Goal.** Implement capability scoping as a host responsibility.

---

## Bonus / Stretch

### Task 17 — Compile-once, instantiate-many benchmark

Benchmark two host designs: (A) `CompileModule` + `InstantiateModule` on every request; (B) `CompileModule` once, `InstantiateModule` per request. Measure throughput. Quantify how much compilation dominates.

**Goal.** Prove the "compile once" rule with numbers.

---

### Task 18 — Deterministic execution with injected clock and seed

Using wazero, inject a *fixed* wall clock and a *seeded* random source into the module config. Run a guest that prints `time.Now()` and a random number twice. Confirm both runs produce identical output.

**Goal.** Make `wasip1` execution deterministic by controlling the host — the basis for replay/consensus systems.

---

### Task 19 — Cross-runtime portability matrix

Take one non-trivial `.wasm` (file I/O + clock + random, no networking) and run it on Wasmtime, wazero, and WasmEdge with each runtime's path-mapping syntax. Document the syntax differences and confirm identical behaviour for the standard feature set.

**Goal.** Experience real cross-runtime portability and its syntax caveats.

---

### Task 20 — AOT precompile and cold-start comparison

For a runtime that supports it (Wasmtime), `wasmtime compile main.wasm -o main.cwasm`. Time a cold run from the `.wasm` (compile + instantiate) versus from the `.cwasm` (instantiate only). Quantify the cold-start improvement.

**Goal.** Understand AOT caching as the edge/serverless cold-start lever.

---

## Solutions (sketched)

### Solution 1
```bash
go mod init example.com/w
cat > main.go <<'EOF'
package main
import "fmt"
func main() { fmt.Println("portable wasm") }
EOF
GOOS=wasip1 GOARCH=wasm go build -o main.wasm .
wasmtime main.wasm
wazero run main.wasm
```
Same bytes, same output — it uses only standard preview-1 functions.

### Solution 2
No `--dir` → no descriptor for `/data` → the open fails. `--dir=./data::/data` creates a preopen the `os` package resolves against.

### Solution 3
`PATH` is empty because the shell environment is never inherited; `TOKEN` is empty until `--env TOKEN=...`; args follow the module name. Three independent grants.

### Solution 4
The wrapper `go_wasip1_wasm_exec` lives in `$(go env GOROOT)/lib/wasm`; it reads `GOWASIRUNTIME`. Without it on `PATH`, the OS cannot launch a `.wasm`.

### Solution 5
The directory is preopened as guest path `/data`, but the code asked for `/input/...`. Match the guest path on both sides. "Preopened but not found" is a mapping bug.

### Solution 6
```go
s := bufio.NewScanner(os.Stdin)
for s.Scan() { fmt.Println(strings.ToUpper(s.Text())) }
```
Filters port for free because they use only stdio.

### Solution 7
`net.Dial` lowers to a socket import the stock runtime cannot satisfy → `unknown import`. Guard:
```go
//go:build wasip1
func dial(addr string) (net.Conn, error) {
    return nil, errors.New("dial: not supported on wasip1")
}
```

### Solution 8
`unknown import: env::log_message` is correct and expected — `go:wasmimport` only resolves against a host that provides the function. Run it through your own embedder (Task 13), not a stock CLI.

### Solution 9
```bash
wasm-tools print main.wasm | grep '(import "wasi_snapshot_preview1"'
```
You will see `fd_write`, `clock_time_get`, `random_get`, `args_get`, etc. The networking binary shows an extra `sock_*` import the stock runtime rejects.

### Solution 10
```bash
GOOS=wasip1 GOARCH=wasm go build -o plain.wasm .
GOOS=wasip1 GOARCH=wasm go build -ldflags="-s -w" -trimpath -o slim.wasm .
ls -l plain.wasm slim.wasm
```
`slim.wasm` is smaller but still MB-scale; the runtime is embedded. TinyGo is the next lever.

### Solution 11
```bash
export PATH="$PATH:$(go env GOROOT)/lib/wasm"
export GOWASIRUNTIME=wazero
GOOS=wasip1 GOARCH=wasm go test ./...
```
Ensure the runtime args preopen `testdata/`. A native-only pass is not proof the `wasip1` build works.

### Solution 12
```go
r := wazero.NewRuntime(ctx); defer r.Close(ctx)
wasi_snapshot_preview1.MustInstantiate(ctx, r)
compiled, _ := r.CompileModule(ctx, wasmBytes)   // once
cfg := wazero.NewModuleConfig().WithStdin(in).WithStdout(&out)
mod, _ := r.InstantiateModule(ctx, compiled, cfg); defer mod.Close(ctx)
```
`out` holds the guest's output.

### Solution 13
Host:
```go
r.NewHostModuleBuilder("host").NewFunctionBuilder().
  WithFunc(func(_ context.Context, m api.Module, ptr, n uint32) {
      b, _ := m.Memory().Read(ptr, n); log.Printf("guest: %s", b)
  }).Export("emit").Instantiate(ctx)
```
Guest: `//go:wasmimport host emit` + call with `unsafe.Pointer(&b[0]), uint32(len(b))`. `Memory().Read` validates bounds.

### Solution 14
`context.WithTimeout` interrupts the guest; instantiation returns an error instead of hanging. A memory limit makes unbounded allocation trap. Memory isolation is free; resource limits are your job.

### Solution 15
On Go 1.24+, `//go:wasmexport process` makes the module a reactor. The host calls `_initialize` once, then `process` repeatedly. On Go < 1.24 the directive is rejected — check `go version`.

### Solution 16
Per call, `os.MkdirTemp` a host dir and `WithFSConfig`/`WithDir` it at a fixed guest path; pass only contractual env. Each invocation sees only its own scratch dir.

### Solution 17
Design B wins decisively; `CompileModule` dominates. The measured ratio is the argument for caching the compiled module.

### Solution 18
wazero config injects a fixed walltime and a deterministic random source; both runs print identical time and random values. This is the determinism opt-in.

### Solution 19
Wasmtime `--dir=host::guest`, wazero `-mount=host:guest`, WasmEdge reverses order. Standard-feature behaviour is identical; only the invocation syntax differs.

### Solution 20
```bash
wasmtime compile main.wasm -o main.cwasm
time wasmtime run main.wasm     # compile + instantiate
time wasmtime run --allow-precompiled main.cwasm
```
The `.cwasm` path skips compilation — the edge cold-start win.

---

## Checkpoints

After the easy tasks: you can build and run a `wasip1` module on multiple runtimes, grant capabilities, set up the exec wrapper, and diagnose a path mismatch.
After the medium tasks: you can ship a portable filter, guard networking with build tags, use `go:wasmimport`, inspect the import surface, strip binaries, and test the wasm path in CI.
After the hard tasks: you can embed a Go guest in a Go host with wazero, implement a custom host function, bound untrusted execution, and build a `go:wasmexport` reactor with per-invocation capability scoping.
After the bonus tasks: you have measured compile-once gains, achieved deterministic execution, verified cross-runtime portability, and quantified AOT cold-start improvements.
