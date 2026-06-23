# Plugins & Dynamic Loading — Middle

## 1. The `plugin` package, in detail

```go
import "plugin"

p, err := plugin.Open("./plugin.so")
if err != nil { return err }

sym, err := p.Lookup("Handler")
if err != nil { return err }

h, ok := sym.(*Handler)
if !ok { return fmt.Errorf("wrong type") }

h.HandleRequest(req)
```

Returned symbols are `plugin.Symbol` (an `interface{}`). Type-assertion is required. Mismatches between host and plugin types cause panics — be defensive.

---

## 2. Building plugins

```bash
go build -buildmode=plugin -o ./plugins/foo.so ./pkg/plugins/foo
```

Constraints:

- Plugin package must have `package main` but **no** `func main()`.
- Cannot be unloaded.
- Symbols must be capitalized to be exported.

---

## 3. Type identity in plugin land

The `plugin` package enforces type identity strictly. If the host imports `example.com/api` and the plugin also imports `example.com/api`, both must use the **same bytes-on-disk** copy of that package. Different vendored copies of the same package produce two distinct types — type assertions fail.

Practical implication: host and plugins must be built from the same module tree, ideally in the same build invocation, with the same vendor directory.

---

## 4. The "shared API" pattern

```
project/
  pkg/
    api/
      api.go         # Plugin interface, shared types
  cmd/
    host/
      main.go        # imports pkg/api
  plugins/
    foo/
      main.go        # imports pkg/api, exports impl
```

Build:

```bash
go build -o host ./cmd/host
go build -buildmode=plugin -o ./plugins/foo.so ./plugins/foo
```

Both reference `pkg/api`. If the api package is unchanged, types match.

---

## 5. Plugin lifecycle

```go
type Plugin interface {
    Init(config map[string]string) error
    Run() error
    Shutdown(ctx context.Context) error
}

func loadPlugin(path string, cfg map[string]string) (Plugin, error) {
    p, err := plugin.Open(path)
    if err != nil { return nil, err }

    sym, err := p.Lookup("New")
    if err != nil { return nil, err }

    factory, ok := sym.(func() Plugin)
    if !ok { return nil, errors.New("New has wrong signature") }

    pl := factory()
    if err := pl.Init(cfg); err != nil { return nil, err }
    return pl, nil
}
```

The "factory function returning an interface" pattern decouples the host from the plugin's concrete type.

---

## 6. `c-shared` for non-Go hosts

```bash
go build -buildmode=c-shared -o libmypkg.so ./pkg/mypkg
```

Output: a `.so` (or `.dylib`/`.dll`) plus a generated `.h`. C/C++ programs can `dlopen` it.

Used to:

- Embed Go logic in a Python program (via cffi).
- Provide a shared library to a Java host (via JNI).
- Build native libraries from Go for use in Rust, Swift, etc.

The Go runtime initializes once on first call from C.

---

## 7. RPC plugins with `go-plugin`

```go
import "github.com/hashicorp/go-plugin"

// Define the shared interface
type Greeter interface {
    Greet(name string) string
}

// The host
client := plugin.NewClient(&plugin.ClientConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
    Cmd:             exec.Command("./plugin-binary"),
})
defer client.Kill()
rpcClient, _ := client.Client()
raw, _ := rpcClient.Dispense("greeter")
greeter := raw.(Greeter)
fmt.Println(greeter.Greet("World"))
```

The plugin runs in a separate process; communication is over gRPC. Crash isolation, version flexibility, cross-language support.

---

## 8. WASM with wazero

```go
import "github.com/tetratelabs/wazero"

ctx := context.Background()
r := wazero.NewRuntime(ctx)
defer r.Close(ctx)

mod, err := r.InstantiateModuleFromBinary(ctx, wasmBytes)
if err != nil { return err }

fn := mod.ExportedFunction("compute")
results, _ := fn.Call(ctx, uint64(42))
fmt.Println(results[0])   // returned value
```

`wazero` is pure Go, sandboxed by default. Plugins can be Go, Rust, AssemblyScript, C, etc. compiled to WASM.

The performance penalty (~10–100× slower than native) makes WASM unsuitable for compute-dominated plugins but fine for control-plane logic.

---

## 9. Subprocess plugins, structured

For most plugin needs, an `exec.Command` plus a JSON or gRPC protocol is enough:

```go
type Request struct {
    Method string                 `json:"method"`
    Params map[string]any         `json:"params"`
}

type Response struct {
    Result any                    `json:"result"`
    Error  string                 `json:"error,omitempty"`
}

func (p *Plugin) Call(method string, params map[string]any) (*Response, error) {
    cmd := exec.Command(p.path)
    cmd.Stdin = encodeJSON(Request{method, params})
    out, _ := cmd.Output()
    var resp Response
    json.Unmarshal(out, &resp)
    return &resp, nil
}
```

Cross-platform, debuggable, language-agnostic. Used by `kubectl plugin`, etc.

---

## 10. Plugin discovery

```go
files, _ := filepath.Glob(filepath.Join(pluginDir, "*.so"))
for _, f := range files {
    p, err := plugin.Open(f)
    if err != nil {
        log.Printf("skip %s: %v", f, err)
        continue
    }
    sym, err := p.Lookup("Register")
    if err != nil {
        log.Printf("skip %s: no Register: %v", f, err)
        continue
    }
    register := sym.(func(Registry))
    register(globalRegistry)
}
```

The plugin's `Register` function tells the host what it provides. The host doesn't need to know any plugin-specific types — just the `Registry` interface.

---

## 11. Version compatibility

The `plugin` package has no versioning. If the host expects `func() *V2API` but the plugin exports `func() *V1API`, the type assertion panics at load time.

Approaches:

- **Single-version plugins.** Rebuild all plugins when the API changes. Suitable for tightly controlled deployments.
- **Versioned symbol names.** `LookupV1`, `LookupV2`. Host probes both.
- **Schema-based protocols.** Use protobuf (RPC, WASM) where the schema enforces compatibility.

---

## 12. Crash isolation

In-process plugins (`plugin`, `c-shared`) share memory with the host. A plugin panic or memory corruption can take down the host.

Out-of-process plugins (RPC, WASM, `exec`) isolate crashes. The host detects a plugin crash and decides whether to restart, reload, or fail.

For untrusted or experimental plugins, **always** isolate.

---

## 13. Reload semantics

| Mechanism | Reloadable? |
|-----------|-------------|
| `plugin` | No |
| `c-shared` | No (some hacks exist; fragile) |
| RPC | Yes (kill + relaunch subprocess) |
| WASM | Yes (instantiate a new module) |
| `exec.Command` | Yes (next call uses new binary) |

If hot reload is a requirement, you're choosing between RPC and WASM.

---

## 14. Summary

Go's plugin story is fragmented because each mechanism is good at different things. The `plugin` package is convenient for in-tree, same-team, single-platform code. RPC plugins (go-plugin) are the production choice for user-extensible systems. WASM is the cross-platform sandboxed option. Choose based on the deployment model, not the headline "plugin" word.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- `hashicorp/go-plugin`: https://github.com/hashicorp/go-plugin
- `wazero`: https://wazero.io
- WASM in Go: https://go.dev/wiki/WebAssembly
