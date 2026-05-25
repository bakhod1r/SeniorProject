# Plugins & Dynamic Loading — Junior

## 1. What "plugins" mean

Your program normally compiles into one binary that contains all the code you wrote. **Plugins** let you load extra code at run time — after the main program is already running.

Why? A few reasons:

- Let users extend your app without rebuilding it.
- Ship a small core that can be augmented per-customer.
- A/B test new features by loading them on demand.

Go has several ways to do this, each with different trade-offs.

---

## 2. The five mechanisms

| Mechanism | What it is |
|-----------|-----------|
| `plugin` package | Load a `.so` (shared library) into your running process |
| `c-shared` | Build Go code as a C-callable library |
| RPC / subprocess | Launch a separate program; talk over gRPC or stdin/stdout |
| WebAssembly | Load a sandboxed WASM module |
| `exec.Command` | Just run another binary |

Most production systems with real plugin support use RPC or WASM, not the `plugin` package. We'll cover each briefly.

---

## 3. The `plugin` package, quick tour

```go
import "plugin"

// host.go
func main() {
    p, _ := plugin.Open("./greeter.so")
    sym, _ := p.Lookup("Greet")
    greet := sym.(func(string) string)
    fmt.Println(greet("World"))
}
```

```go
// greeter/greeter.go (built separately)
package main

func Greet(name string) string {
    return "Hello, " + name
}
```

Build the plugin:

```bash
go build -buildmode=plugin -o greeter.so ./greeter
```

Run the host. It loads `greeter.so` and calls `Greet`.

---

## 4. The catch: it's fragile

The `plugin` package has many gotchas:

- **Linux/macOS only.** No Windows support.
- **No unloading.** Once loaded, the plugin stays.
- **Toolchain version must match.** Host built with Go 1.24? Plugin must also be Go 1.24.
- **Same build tags, same vendored deps.** Mismatches cause cryptic crashes.

For these reasons, the `plugin` package is rarely used outside specific projects where the entire build pipeline is controlled.

---

## 5. The "subprocess plugin" alternative

```go
cmd := exec.Command("./myplugin", "do-thing", "--arg=value")
out, _ := cmd.Output()
fmt.Println(string(out))
```

The plugin is a separate program. The host runs it. They communicate over stdin/stdout, command-line args, or a structured protocol.

Used by `git`, `kubectl`, `terraform` (via go-plugin). Cross-platform, easy to debug, naturally sandboxed.

---

## 6. WebAssembly: a portable alternative

```go
import "github.com/tetratelabs/wazero"

ctx := context.Background()
r := wazero.NewRuntime(ctx)
defer r.Close(ctx)

mod, _ := r.InstantiateModuleFromBinary(ctx, wasmBytes)
greet := mod.ExportedFunction("greet")
result, _ := greet.Call(ctx, ...)
```

WebAssembly modules are small, sandboxed, and portable. Plugins can be written in Go, Rust, AssemblyScript, etc.

Limitations: slower than native (~10–100×), limited stdlib in WASM.

---

## 7. The RPC plugin pattern (HashiCorp's approach)

```
┌─────────┐         ┌─────────────┐
│  Host   │ ◄──gRPC─► │   Plugin    │
│ Process │         │ Subprocess  │
└─────────┘         └─────────────┘
```

The host launches the plugin as a subprocess. They speak gRPC over an internal channel. The host loads many plugins, supervised independently.

Used by Terraform, Vault, Consul. Library: `github.com/hashicorp/go-plugin`.

Pros: cross-platform, isolated crash domains, language-agnostic.
Cons: more boilerplate, IPC overhead.

---

## 8. When to use what (rule of thumb)

| You want... | Use... |
|------------|--------|
| Quick experiment, single platform | `plugin` package |
| Cross-platform user plugins | RPC (go-plugin) or WASM |
| Tight integration, fast IPC | `c-shared` library |
| Sandboxed third-party code | WASM |
| Simple "run another command" | `exec.Command` |
| Add Go to a C/C++ host | `c-shared` |

---

## 9. A first-do task

For most beginners, the right starting point isn't to write a plugin — it's to write a program with a well-defined interface and an `exec.Command`-based "plugin" that anything (even a shell script) can implement.

```go
type Plugin interface {
    Name() string
    Process(input string) (string, error)
}

// Implementation backed by exec.Command:
type ExecPlugin struct{ path string }

func (e *ExecPlugin) Name() string { return e.path }
func (e *ExecPlugin) Process(input string) (string, error) {
    cmd := exec.Command(e.path, "process")
    cmd.Stdin = strings.NewReader(input)
    out, err := cmd.Output()
    return string(out), err
}
```

This works on every platform, with any language, today.

---

## 10. Summary

"Plugins" in Go is a misleading word — there isn't one obvious answer. The `plugin` package exists but is narrow. RPC plugins (HashiCorp's pattern) and WebAssembly are the modern, cross-platform choices. For most cases, `exec.Command` plus a structured protocol is plenty.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- `hashicorp/go-plugin`: https://github.com/hashicorp/go-plugin
- `wazero`: https://wazero.io
