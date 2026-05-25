# Plugins & Dynamic Loading — Professional

## 1. The production checklist

Before shipping a plugin system:

- [ ] **Mechanism chosen** (`plugin`, RPC, WASM, `exec`) and documented.
- [ ] **Protocol versioned** (capabilities or explicit version field).
- [ ] **Crash isolation** is real (out-of-process for untrusted plugins).
- [ ] **Reload story** documented (subprocess restart? WASM re-instantiation? host restart?).
- [ ] **Authentication** between host and plugin (RPC handshake, signed binaries).
- [ ] **Logging/metrics** of plugin calls included.
- [ ] **Resource limits** (timeouts, memory caps, concurrency caps).
- [ ] **Plugin discovery and listing** for ops visibility.

---

## 2. Production-grade RPC plugins (HashiCorp pattern)

```go
import "github.com/hashicorp/go-plugin"

var handshake = plugin.HandshakeConfig{
    ProtocolVersion:  1,
    MagicCookieKey:   "MYAPP_PLUGIN_COOKIE",
    MagicCookieValue: "0xDEADBEEF",
}

var pluginMap = map[string]plugin.Plugin{
    "greeter": &GreeterPlugin{},
}

func main() {
    plugin.Serve(&plugin.ServeConfig{
        HandshakeConfig: handshake,
        Plugins:         pluginMap,
        GRPCServer:      plugin.DefaultGRPCServer,
    })
}
```

The handshake prevents accidental connection to the wrong plugin. The protocol version lets you evolve gradually. The map allows multiple services per plugin.

---

## 3. WASM in production: wazero

`wazero` is the production WASM runtime for Go ecosystem usage:

- Pure Go (no cgo).
- Cross-platform.
- Sandboxed by default.
- Composable host import surface.

Pattern:

```go
runtime := wazero.NewRuntime(ctx)
defer runtime.Close(ctx)

// Add host imports (the surface plugins can use)
_, err := wasi_snapshot_preview1.Instantiate(ctx, runtime)
hostMod, err := runtime.NewHostModuleBuilder("env").
    NewFunctionBuilder().WithFunc(logFromWasm).Export("log").
    Instantiate(ctx)

// Load plugin bytes (from disk, embed, network, etc.)
mod, err := runtime.InstantiateModuleFromBinary(ctx, wasmBytes)

// Call
fn := mod.ExportedFunction("process")
results, err := fn.Call(ctx, ptrToInputBuf, lenOfInputBuf)
```

WASM plugins can be written in Go (using TinyGo), Rust, AssemblyScript, etc.

---

## 4. Subprocess plugins via `exec`

For the simplest case (`kubectl`-style):

```go
type Plugin struct {
    path string
    sub  *exec.Cmd
}

func (p *Plugin) Run(input []byte) ([]byte, error) {
    cmd := exec.Command(p.path, "--mode=process")
    cmd.Stdin = bytes.NewReader(input)
    cmd.Stderr = os.Stderr
    out, err := cmd.Output()
    if err != nil {
        if ee, ok := err.(*exec.ExitError); ok {
            return nil, fmt.Errorf("plugin exit %d: %s", ee.ExitCode(), ee.Stderr)
        }
        return nil, err
    }
    return out, nil
}
```

Add timeouts, resource limits, structured logging. For high throughput, keep a process pool warm rather than forking per call.

---

## 5. Resource limits

For any plugin you don't fully trust:

```go
ctx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
defer cancel()
cmd := exec.CommandContext(ctx, plugin.Path)
```

Plus OS-level limits:

- `setrlimit` (Linux) for memory, file descriptors.
- `cgroups` for CPU and memory caps.
- `seccomp` to restrict syscalls.

WASM sandboxing handles much of this for free. With RPC, OS isolation is your responsibility.

---

## 6. Observability for plugins

Each plugin call should be:

- **Logged** with plugin name, method, latency, outcome.
- **Metric'd** (counter + histogram) for ops dashboards.
- **Traced** (OpenTelemetry span) for end-to-end visibility.

```go
func (p *Plugin) Call(ctx context.Context, name string, args ...) (Result, error) {
    ctx, span := tracer.Start(ctx, "plugin.call",
        trace.WithAttributes(attribute.String("plugin.name", p.Name)))
    defer span.End()

    start := time.Now()
    result, err := p.doCall(ctx, name, args...)
    metrics.PluginCallDuration.WithLabelValues(p.Name, name, errLabel(err)).Observe(time.Since(start).Seconds())
    if err != nil { span.RecordError(err) }
    return result, err
}
```

---

## 7. The "shadow" deployment pattern

When rolling out a new plugin or major plugin update:

1. Deploy with both the old and new plugin loaded.
2. Send each request to both (shadow the new one).
3. Compare outputs; alert on divergence.
4. After a stable shadow period, switch to new and remove old.

This catches "subtle behavior change" bugs that simple tests miss. Easy with RPC plugins because they're independent processes.

---

## 8. Plugin update without host restart

For RPC plugins, hot update:

```go
oldClient := s.client
newClient := plugin.NewClient(newConfig)
if err := newClient.Start(); err != nil {
    return err
}
s.client = newClient
oldClient.Kill()
```

Take care:

- Drain in-flight requests against the old client before killing.
- Confirm the new client passes a health check before switching.
- Roll back if the new client fails.

For WASM, instantiate the new module side-by-side, atomic swap, drop the old.

---

## 9. Plugin discovery in a directory

```go
type Registry struct {
    plugins map[string]*Plugin
}

func (r *Registry) LoadDirectory(dir string) error {
    files, err := os.ReadDir(dir)
    if err != nil { return err }
    for _, f := range files {
        if f.IsDir() || !strings.HasSuffix(f.Name(), ".so") { continue }
        if err := r.Load(filepath.Join(dir, f.Name())); err != nil {
            log.Printf("skip %s: %v", f.Name(), err)
        }
    }
    return nil
}
```

In an enterprise context, plugin directories live in `/etc/myapp/plugins/`. Operations can drop in new plugins and reload.

For RPC, scan a similar directory of binaries. For WASM, scan `.wasm` files.

---

## 10. Authenticity

For internet-distributed plugins, sign them:

- **Code signing certificates** (Authenticode, Apple notarization).
- **Sigstore** for open-source signing.
- **In-band signatures** verified at load time.

```go
func (r *Registry) Load(path string) error {
    if !verifySignature(path) { return errors.New("invalid signature") }
    // ... proceed to plugin.Open / fork ...
}
```

For internal plugins built in the same CI as the host, signing is usually unnecessary — provenance is implicit.

---

## 11. Real-world examples

| Project | Mechanism | Notes |
|---------|-----------|-------|
| Terraform | RPC (go-plugin) | Cross-platform; protocol versioning |
| Vault | RPC (go-plugin) | Plus database plugin protocol |
| Caddy | In-process modules | Build-time, not runtime; uses tags |
| Hugo | None (themes are templates) | No runtime code loading |
| Envoy filters | WASM (proxy-wasm) | Cross-language; high security bar |

Studying these systems' protocol docs informs your own design.

---

## 12. The "monorepo plugin" pattern

For very tight integrations:

```
project/
  cmd/host/
  cmd/plugins/foo/
  cmd/plugins/bar/
```

Build all binaries from one repo, one CI run, one version. Plugins ship together with the host. Trade: no third-party extensibility; gain: zero compatibility risk.

This is essentially treating "plugins" as build-time configuration (file selection) rather than runtime loading. Often the right answer when the trade-off is acceptable.

---

## 13. Anti-patterns

- **Open the `plugin` package to user-provided code.** You're giving them full host access.
- **Skip the handshake.** Production go-plugin always uses one.
- **Forget timeouts.** A misbehaving plugin can hang indefinitely.
- **Trust plugin output uncritically.** Validate at the host boundary.
- **Reload without draining.** In-flight requests get mid-flight errors.

---

## 14. Summary

Production plugins need a clear mechanism choice, a versioned protocol, supervision with crash recovery, observability, resource limits, and a rollout/rollback story. The technology is the easy part; the discipline around versioning and ops is what makes a plugin ecosystem maintainable over years.

---

## Further reading
- Terraform plugin protocol docs
- HashiCorp `go-plugin` repo
- proxy-wasm spec: https://github.com/proxy-wasm/spec
- Sigstore: https://www.sigstore.dev
