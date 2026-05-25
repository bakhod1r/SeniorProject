# Plugins & Dynamic Loading — Interview

Common interview questions about Go plugins.

---

## Q1. What mechanisms does Go offer for runtime extensibility?

The `plugin` package (Linux/macOS only), `c-shared` libraries (cgo bridge), RPC plugins (`hashicorp/go-plugin`), WebAssembly modules (e.g., `wazero`), and subprocess plugins via `exec.Command`. Each has different trade-offs.

---

## Q2. What's the main limitation of the `plugin` package?

It's Linux/macOS only — no Windows support. Plus: plugins can't be unloaded, host and plugin must use identical Go toolchain version, build flags, and dependencies. Type identity is strict.

---

## Q3. Why is `go-plugin` (HashiCorp's) often chosen over the `plugin` package?

Cross-platform support, language-agnostic possibility (any language that can speak gRPC), crash isolation (plugin runs as a subprocess), version flexibility (protobuf protocol), and hot reload (kill and relaunch subprocess).

---

## Q4. How does the `plugin` package handle type identity?

Strictly. Two values are interchangeable iff they have the same `reflect.Type` value. Different vendored copies of the same package produce different types — assertions fail. Host and plugin must share the exact same on-disk copy of any shared types.

---

## Q5. What's the WASM plugin story in Go?

`wazero` is the production-grade pure-Go WASM runtime. Plugins can be written in Go (via TinyGo), Rust, AssemblyScript, etc. Pros: cross-platform, sandboxed, multi-language. Cons: 10–100× slower than native, limited stdlib.

---

## Q6. How do you build a `.so` plugin?

```bash
go build -buildmode=plugin -o foo.so ./pkg/foo
```

The package must have `package main`, no `func main()`, and exported symbols.

---

## Q7. How do you call a Go function from C?

Either via `c-shared` build mode (`go build -buildmode=c-shared -o libfoo.so ./pkg`), which produces a `.so` and a `.h`, or via `c-archive` for static linking. Mark exported functions with `//export FuncName`.

---

## Q8. What's the cost difference between in-process and out-of-process plugins?

In-process (`plugin` direct call): ~5 ns.
WASM (wazero): ~1 µs.
RPC over UDS: ~50 µs.
`exec.Command` (one-shot fork): ~5 ms.

Pick the cheapest that meets your isolation needs.

---

## Q9. How do you handle plugin crashes?

For in-process plugins: panic in the plugin can take down the host. `recover()` may help, but memory corruption is unrecoverable. For out-of-process plugins: OS kills the subprocess; host detects via gRPC error and decides to restart.

---

## Q10. Can plugins be reloaded?

The `plugin` package: no. Once loaded, code stays in memory. RPC plugins: yes (kill subprocess, relaunch). WASM: yes (instantiate a new module). `exec`: yes (next call uses the new binary).

---

## Q11. How do you define a stable plugin protocol?

For RPC plugins, use protobuf with versioned services. Don't remove fields; add new ones with new numbers. For schema evolution: capability negotiation at handshake. Document compatibility guarantees explicitly.

---

## Q12. What's the magic cookie in `go-plugin`?

A handshake mechanism. The host expects the plugin to identify itself via an environment variable matching a magic cookie. Prevents accidentally launching the wrong binary as a plugin.

---

## Q13. Is the `plugin` package suitable for untrusted code?

No. In-process plugins have full host access. They can read host memory, corrupt state, launch goroutines, etc. For untrusted code: use WASM (real sandboxing) or RPC with OS-level isolation (chroot, seccomp).

---

## Q14. How does `c-shared` differ from `plugin`?

`c-shared` produces a C-callable library (`.so`/`.dll`) with a generated `.h`. Works on Windows. Calls cross the cgo boundary. The `plugin` package is Go-to-Go and doesn't go through cgo.

---

## Q15. What's the typical RPC plugin architecture?

A host process launches plugin binaries as subprocesses. They communicate over gRPC on a Unix domain socket. The host uses `Dispense(name)` to get a typed client for a particular service. Plugins implement gRPC services defined by a shared protobuf.

---

## Q16. How would you handle plugin discovery?

Scan a directory at startup (`*.so`, `*.wasm`, executable binaries). For each, attempt to load and register. Skip failures with logging. For production, additional steps: verify signatures, check version compatibility, register with the host's metric/log systems.

---

## Q17. What's the issue with calling `plugin.Open` multiple times on the same `.so`?

It works — but you get the same `*Plugin` back. The plugin's `init()` runs only once. Subsequent calls return the cached plugin handle.

---

## Q18. Can the host pass complex objects to a plugin?

For in-process plugins, yes — any Go value, as long as types match across the boundary. For RPC plugins, only what protobuf supports (or use `bytes` for arbitrary blobs). For WASM, only primitives plus shared memory (with explicit serialization).

---

## Q19. How does `exec.Command` compare to a "real" plugin system?

Simpler, cross-platform, language-agnostic. Works for cases like `git`'s subcommand model or `kubectl`'s plugin model. Cost: fork+exec per call is ~5 ms. Use a process pool for higher throughput.

---

## Q20. Bonus — describe a plugin system you'd design.

Open-ended. Strong answers cover: mechanism choice based on trust/perf/portability, protocol versioning, plugin discovery, crash isolation, observability (logs, metrics, traces), reload strategy, and security (signatures, sandboxing). Reference real systems (Terraform, Vault) where relevant.

---

## Cheat sheet

- `plugin` package: Linux/macOS only, no unload, strict type identity.
- `c-shared`: bridge via cgo, Windows-capable.
- `go-plugin`: RPC, cross-platform, the production default.
- WASM (wazero): cross-platform, sandboxed, multi-language.
- `exec.Command`: simplest, language-agnostic.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- `hashicorp/go-plugin`
- `wazero`
