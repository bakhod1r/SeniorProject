# Plugins & Dynamic Loading — Senior

## 1. Choosing the right mechanism

The choice is mostly about three axes:

1. **Trust** — do you trust the plugin author?
2. **Performance** — how often is the plugin called and with what data volume?
3. **Deployment** — are host and plugins versioned and built together?

A simple decision matrix:

| Trust | Performance | Deployment | Choose |
|-------|-------------|------------|--------|
| Tight | High | Same build | `plugin` package |
| Tight | High | Cross-platform | `c-shared` |
| Open | Medium | Independent | RPC (go-plugin) |
| Untrusted | Medium | Independent | WASM |
| Either | Low | Independent | `exec.Command` |

Pick the simplest one that satisfies your needs. You can always migrate to a heavier solution later.

---

## 2. The `plugin` package's hidden costs

Beyond the documented constraints:

- **Build coupling**: any change in shared packages triggers full rebuild of all plugins.
- **Startup time**: each `plugin.Open` runs `init()` and resolves symbols. With many plugins, this adds up.
- **Debugging complexity**: stack traces span plugins; symbol info varies.
- **Memory non-release**: loaded plugins permanently consume memory.
- **Race detector limitations**: race detection may miss races that span plugin boundaries.

For systems that load many plugins, these costs can dominate. For systems that load 2-3 known plugins, they're acceptable.

---

## 3. `go-plugin` architecture

```
┌─────────┐   gRPC over UDS    ┌─────────────┐
│  Host   │ ◄────────────────► │ Plugin Proc │
└─────────┘                    └─────────────┘
     │
     ├──── stdout/stderr (logs)
     │
     └──── magic handshake (verify the plugin is the expected version)
```

Lifecycle:

1. Host calls `plugin.NewClient(config)`.
2. The library forks the plugin binary.
3. Plugin prints a magic line to stdout containing a port number.
4. Host connects over gRPC to that port.
5. Host calls `Dispense(name)` to get a handle to a service.
6. Service calls flow over gRPC.

Crash handling: if the plugin dies, the gRPC connection breaks; the host can decide to restart.

---

## 4. Interface stability for RPC plugins

Define your plugin interface in protobuf (or with gRPC-Go's `.proto`):

```proto
service Greeter {
  rpc Greet(GreetRequest) returns (GreetResponse);
}
```

Generate Go code for host and plugin. Both must agree on the proto definition; backwards compatibility is your responsibility.

Conventions:

- Don't remove fields; mark them deprecated.
- Add new fields with new numbers; old plugins ignore them.
- Version the service if you must make breaking changes.

This is much more robust than the `plugin` package's "type identity" requirement.

---

## 5. WASM module limits

WASM modules:

- Run in a sandbox; no syscalls, no direct file/network access.
- Get I/O only through *host-imported* functions.
- Have linear memory (no Go heap, no GC across the boundary).
- Are slower than native (factors vary by workload).

For control-plane logic (decisions, transformations) WASM is excellent. For data-plane work (image processing, parsing) it's usually too slow.

`wazero`'s pure-Go implementation makes WASM-as-plugin a viable cross-platform option in Go ≥ 1.20.

---

## 6. The "supervision" pattern for RPC plugins

```go
type Supervisor struct {
    pluginPath string
    client     *plugin.Client
    api        Greeter
}

func (s *Supervisor) Call(name string) (string, error) {
    if s.api == nil {
        if err := s.Restart(); err != nil { return "", err }
    }
    resp, err := s.api.Greet(name)
    if err != nil {
        // gRPC error often means subprocess died
        s.Kill()
        return "", err
    }
    return resp, nil
}

func (s *Supervisor) Restart() error { ... }
func (s *Supervisor) Kill() { ... }
```

Wrap each plugin with a supervisor that knows how to launch, detect death, and restart. Production systems with many plugins need this discipline.

---

## 7. Plugin security

| Mechanism | Risk |
|-----------|------|
| `plugin` package | Full host access; one bug = host crash |
| `c-shared` | Same |
| RPC | Plugin runs as a separate process; OS-level isolation |
| WASM | Sandbox; only host-imported functions accessible |
| `exec.Command` | OS-level isolation; depends on permissions |

For untrusted plugins, only WASM or `exec` give meaningful isolation. Even RPC plugins run with the host's user privileges by default (sandbox them with chroot/cgroups/seccomp if needed).

---

## 8. Crash recovery patterns

In-process plugins (panic):

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("plugin panic: %v", r)
        // Note: panic in plugin may corrupt host state; safest to restart host
    }
}()
plugin.Process(req)
```

`recover` doesn't actually save you from all plugin bugs — memory corruption, infinite goroutines, file descriptor leaks all persist after recover.

Out-of-process plugins: the OS kills the misbehaving plugin; host stays up.

---

## 9. Performance comparison

For a "small" call (10 µs of plugin work):

| Mechanism | Overhead |
|-----------|----------|
| `plugin` direct call | ~5 ns |
| WASM call (wazero) | ~1 µs |
| RPC over UDS | ~50 µs |
| `exec.Command` (one-shot) | ~5 ms (fork+exec) |

For frequent small calls, in-process wins by orders of magnitude. For larger units of work (request handling), the differences are noise.

---

## 10. Version skew across plugins

In real ecosystems (Terraform providers, Vault plugins), each plugin has its own release cadence. The host can't force-update.

Handling:

- **Capability negotiation.** Plugin advertises supported features at handshake; host uses the intersection.
- **Field-level optionality.** New host features show up as opt-in flags in the protocol.
- **Multi-version support in host.** Maintain old API alongside new for some grace period.

Terraform's plugin protocol is the canonical example — its evolution informs much of this design space.

---

## 11. Inter-plugin communication

Plugins generally shouldn't talk to each other directly. The host mediates. This:

- Keeps plugins independent.
- Allows the host to authorize/audit communication.
- Avoids version-skew cascades.

If you find yourself wanting plugin-to-plugin RPC, your "plugin" boundary is probably in the wrong place.

---

## 12. Hot reload

For configuration changes, prefer reload over restart:

```go
func (s *Supervisor) ReloadConfig(cfg map[string]string) error {
    return s.api.UpdateConfig(cfg)
}
```

For code changes:

- RPC: kill subprocess, launch new version.
- WASM: instantiate new module; let GC drop old one.
- `plugin`: not supported. Restart the whole host.

Make this part of your plugin protocol from day one.

---

## 13. Summary

Senior plugin work is mostly architectural: choose the mechanism, design the protocol, plan for crashes, version compatibility, and security. The `plugin` package is a niche tool for narrow use cases; RPC and WASM cover the vast majority of production plugin needs. Build the supervision and reload machinery up front.

---

## Further reading
- `hashicorp/go-plugin` architecture: https://github.com/hashicorp/go-plugin/blob/main/docs/architecture.md
- Terraform plugin protocol: https://developer.hashicorp.com/terraform/plugin
- `wazero` docs: https://wazero.io
