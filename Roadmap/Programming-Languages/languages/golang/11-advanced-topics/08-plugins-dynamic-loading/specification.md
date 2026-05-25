# Plugins & Dynamic Loading — Specification

> **Focus:** Precise reference for runtime-loadable Go code — the `plugin` package, `c-shared` libraries, RPC-based plugins, and WebAssembly modules.
>
> **Sources:**
> - `plugin` package: https://pkg.go.dev/plugin
> - `cmd/go` `-buildmode=plugin`
> - HashiCorp `go-plugin`: https://github.com/hashicorp/go-plugin

---

## 1. The plugin landscape in Go

Go offers several mechanisms for loading code at runtime; each has strict trade-offs.

| Mechanism | Library boundary | Portability | Hot reload |
|-----------|-----------------|-------------|-----------|
| `plugin` package | In-process `.so` | Linux/macOS only | No (can't unload) |
| `c-shared` library | In-process `.so` via cgo | Linux/macOS/Windows | No |
| RPC plugin (HashiCorp) | Separate process | All platforms | Yes (restart subprocess) |
| WebAssembly (wazero) | In-process WASM sandbox | All platforms | Yes |
| `exec.Command` | Separate process | All platforms | Yes |

The `plugin` package is the only first-party in-process option. Most production deployments use RPC plugins or WASM.

---

## 2. The `plugin` package contract

```go
import "plugin"

p, err := plugin.Open("./myplugin.so")
if err != nil { ... }

sym, err := p.Lookup("Greet")
if err != nil { ... }

greet := sym.(func(string) string)
fmt.Println(greet("world"))
```

| Function | Purpose |
|----------|---------|
| `plugin.Open(path)` | Load the `.so`; runs its `init()` |
| `(*Plugin).Lookup(name)` | Find an exported symbol |

The returned `Symbol` is `interface{}`; you must type-assert to the real type. Mismatches panic.

---

## 3. Building a plugin

```bash
go build -buildmode=plugin -o myplugin.so ./pkg/myplugin
```

Constraints:

- The package must compile as a standalone unit.
- Must export functions or variables (capitalized identifiers).
- Cannot have a `main` function.
- Cannot be unloaded once loaded.

---

## 4. Compatibility requirements

For `plugin.Open` to succeed, the plugin and host must:

- Use the **same Go toolchain version**.
- Use the **same `GOOS`/`GOARCH`/`GOAMD64`/etc.**
- Use the **same set of build tags**.
- Use the **same `-trimpath` / `-ldflags`** for shared packages.
- Use the **same vendored dependencies** (often impossible to enforce).

If any of these differ, you get cryptic load failures or runtime crashes.

---

## 5. Platform availability

| Platform | `-buildmode=plugin` |
|----------|---------------------|
| Linux/amd64 | Yes |
| Linux/arm64 | Yes |
| macOS/amd64 | Yes |
| macOS/arm64 | Yes (Go 1.18+) |
| FreeBSD | Yes |
| Windows | **No** |
| WebAssembly | **No** |

The lack of Windows support is the main reason the `plugin` package isn't used widely in cross-platform projects.

---

## 6. The `c-shared` alternative

```bash
go build -buildmode=c-shared -o libmypkg.so ./pkg/mypkg
```

Produces a shared library callable from C, plus a `.h`. Goes through cgo. Works on Windows (as `.dll`).

Used when you want to:

- Expose Go functions to C/C++.
- Load a Go library into a non-Go host.
- Cross the language boundary instead of using RPC.

---

## 7. The `go-plugin` RPC architecture

```
┌─────────┐         ┌─────────────┐
│  host   │ ◄──gRPC─► │  plugin     │
│ process │         │ subprocess  │
└─────────┘         └─────────────┘
```

The host launches the plugin as a subprocess. They communicate over a Go-native gRPC channel. The host can spawn many plugins; if one crashes, only it dies.

Used by:

- HashiCorp Terraform, Vault, Nomad.
- HashiCorp Consul providers.
- Custom plugin ecosystems.

Library: [hashicorp/go-plugin](https://github.com/hashicorp/go-plugin).

---

## 8. WebAssembly modules

```go
import "github.com/tetratelabs/wazero"

ctx := context.Background()
r := wazero.NewRuntime(ctx)
defer r.Close(ctx)

mod, _ := r.InstantiateModuleFromBinary(ctx, wasmBytes)
result, _ := mod.ExportedFunction("greet").Call(ctx)
```

Pros:

- Cross-platform (works in pure Go).
- Sandbox (limited access to host).
- Multi-language (host can be Go; plugin can be Go, Rust, AssemblyScript, C, etc.).
- No "same toolchain" requirement.

Cons:

- 10–100× slower than native Go for compute-heavy plugins.
- Limited stdlib (WASM has no syscalls).
- I/O through host-imported functions only.

`wazero` is pure Go; `wasmer-go` and `wasmtime-go` are cgo-based.

---

## 9. Subprocess plugins via `exec`

```go
cmd := exec.Command("./plugin", "arg1")
out, _ := cmd.CombinedOutput()
```

The simplest form. Used by:

- `git` (subcommands are external binaries).
- `kubectl` plugins.
- `dotnet` SDKs.

Communication via stdin/stdout/exit codes or a structured protocol. Easy to debug, language-agnostic, naturally sandboxed.

---

## 10. Comparison: when to use which

| Use case | Choice |
|----------|--------|
| Same-team, tight integration, Linux/macOS only | `plugin` |
| C-callable library | `c-shared` |
| User-installable plugins across OSes | RPC (go-plugin) or WASM |
| Cross-language plugins | WASM |
| Sandboxed untrusted code | WASM |
| Simple CLI extensions | subprocess (`exec`) |

Most production systems with a real plugin ecosystem land on RPC or WASM. The `plugin` package is rarely the right answer outside narrow conditions.

---

## 11. `plugin` package limitations

- **Can't unload.** Once `plugin.Open` succeeds, the plugin's code stays in memory.
- **Init order is global.** The plugin's `init()` runs at `Open` time.
- **Symbol resolution is name-based.** No versioning, no compatibility checks beyond crashes.
- **Globally shared types must match exactly.** If both host and plugin import a package, they must agree on its layout — usually means same vendored copy.
- **Type identity per `reflect.Type`** is enforced; mismatches cause panic during type assertion.

---

## 12. Plugin discovery patterns

```go
files, _ := filepath.Glob("./plugins/*.so")
for _, f := range files {
    p, err := plugin.Open(f)
    if err != nil { continue }
    sym, err := p.Lookup("Init")
    if err != nil { continue }
    init := sym.(func() Plugin)
    plugins = append(plugins, init())
}
```

Standard pattern: scan a directory at startup, open each `.so`, look up a known initialization symbol, register the returned plugin.

---

## 13. Plugin API design

For an in-process plugin (`plugin` or `c-shared`):

```go
// Shared interface in a common package
package pluginapi

type Plugin interface {
    Name() string
    Process(req *Request) (*Response, error)
}

type Request struct { ... }
type Response struct { ... }
```

Host loads, plugin returns a `Plugin`. Both depend on the same `pluginapi` package — which must be identical bytes-on-disk for type identity.

---

## 14. Related references

- `plugin` package: https://pkg.go.dev/plugin
- HashiCorp `go-plugin`: https://github.com/hashicorp/go-plugin
- `wazero` WASM runtime: https://wazero.io
- The plugin package, dedicated chapter: [13-plugin-package](../13-plugin-package/)
