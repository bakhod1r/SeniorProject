# Plugins & Dynamic Loading — Optimize

## 1. First: do you even need plugins?

Many "plugin systems" turn out to be over-engineering. Alternatives:

- **Build tags** for compile-time variants.
- **Interface-based composition** for in-tree implementations.
- **Configuration files** for behavioral toggles.
- **External programs invoked via HTTP** instead of an embedded plugin.

If the answer to "what would break if we shipped one plugin per release?" is "nothing", you don't need runtime plugin loading.

---

## 2. The cost of each mechanism

| Mechanism | Per-call cost | Startup cost | Memory cost |
|-----------|---------------|--------------|-------------|
| `plugin` direct | ~5 ns | ~ms (Open) | shared image |
| WASM (wazero) | ~1 µs | ~10–100 ms (compile) | ~MB per module |
| RPC over UDS | ~50 µs | ~10–100 ms (fork) | full subprocess |
| `exec.Command` one-shot | ~5 ms | ~5 ms per call | full subprocess |

For a "small" call (~10 µs of work), `plugin` is 10× faster than WASM, 1000× faster than RPC. For a "large" call (~10 ms of work), the differences are noise.

---

## 3. Process pooling for subprocess plugins

```go
type Pool struct {
    plugins chan *Plugin
    new     func() (*Plugin, error)
}

func (p *Pool) Call(args ...) (Result, error) {
    pl := <-p.plugins                  // wait for a free instance
    defer func() { p.plugins <- pl }() // return to pool
    return pl.Process(args...)
}
```

Avoids the 5 ms `fork+exec` per call. The pool size bounds concurrency. Each instance handles many requests; the host kills+respawns on misbehavior.

Used by Vault's database plugins, many other Go RPC plugin systems.

---

## 4. Batching across the plugin boundary

The most impactful optimization: do more work per call.

```go
// Bad: one call per item
for _, item := range items {
    result := plugin.Process(item)
    out = append(out, result)
}

// Good: one call for all items
results := plugin.ProcessBatch(items)
```

The boundary cost is amortized; the marshal/unmarshal work happens once. For RPC plugins, this can be 100× faster.

---

## 5. Streaming for large payloads

For plugins that produce or consume large data, gRPC streaming beats unary calls:

```proto
service Processor {
  rpc Stream (stream Item) returns (stream Result);
}
```

The plugin reads items as they come, processes, and emits results. No need to buffer everything in memory.

---

## 6. WASM optimization

- **AOT-compile** WASM modules: `wazero.NewRuntimeConfigCompiler()`.
- **Reuse runtimes** across calls; instantiating a module costs ms.
- **Minimize host-import calls**: each one is a context switch.
- **Tune memory growth**: configure initial memory to avoid runtime resizing.

```go
config := wazero.NewRuntimeConfig().WithCompilationCache(cache)
runtime := wazero.NewRuntimeWithConfig(ctx, config)
```

Compilation caching across program runs significantly speeds up startup.

---

## 7. Reducing plugin binary size

For `plugin` and `c-shared`:

```bash
go build -buildmode=plugin -ldflags='-s -w' -trimpath -o myplugin.so ./pkg
```

Saves a few MiB per plugin. With many plugins, this matters.

For RPC plugins, the same — they're regular Go binaries.

---

## 8. Skip unused plugins lazily

```go
type Registry struct {
    available map[string]string  // name → path
    loaded    map[string]Plugin
}

func (r *Registry) Get(name string) (Plugin, error) {
    if p, ok := r.loaded[name]; ok { return p, nil }
    path := r.available[name]
    p, err := loadPlugin(path)
    if err != nil { return nil, err }
    r.loaded[name] = p
    return p, nil
}
```

For systems with many plugins of which most are unused, lazy loading saves startup time and memory.

---

## 9. Versioned plugin caching

For WASM and `plugin` package, the loaded artifact is keyed by file content. Cache the compiled form:

```
~/.cache/myapp/plugins/
  foo-v1.2.3.wasm
  foo-v1.2.3.wasm.compiled   # AOT cache
```

On startup, check the cache before recompiling. Saves seconds on big WASM modules.

---

## 10. Connection multiplexing

For RPC plugins, one gRPC connection can carry many concurrent streams. Configure for high concurrency:

```go
grpcConn, _ := grpc.Dial(addr, grpc.WithInsecure(),
    grpc.WithMaxConcurrentStreams(1000))
```

`go-plugin` sets sensible defaults; tune only if you've measured a bottleneck.

---

## 11. Avoiding the `plugin` package's startup cost

If you must use `plugin`, lazy-load:

```go
type LazyPlugin struct {
    path string
    once sync.Once
    impl Plugin
    err  error
}

func (l *LazyPlugin) Get() (Plugin, error) {
    l.once.Do(func() {
        p, err := plugin.Open(l.path)
        if err != nil { l.err = err; return }
        sym, err := p.Lookup("New")
        if err != nil { l.err = err; return }
        l.impl = sym.(func() Plugin)()
    })
    return l.impl, l.err
}
```

The plugin loads on first use, not at startup. Boot time stays small.

---

## 12. Memory budget per plugin

Each WASM module gets an OS-allocated memory region (typically MiBs). Each RPC plugin is a full Go process (~50 MiB resident minimum).

For systems hosting hundreds of plugins, that's GiBs of RAM dedicated to plugin overhead. Limit per-plugin memory:

- WASM: configure memory cap via `wazero.NewRuntimeConfig`.
- RPC: use `cgroups` or `setrlimit` on the subprocess.
- Reject loads that exceed budget.

---

## 13. Inlining vs out-of-process

When latency matters, in-process beats out-of-process by orders of magnitude. But when isolation matters, out-of-process is essential.

The middle ground: a worker pool of subprocesses with pre-warmed instances. Per-request cost ~tens of µs, isolation preserved.

---

## 14. Summary

Plugin optimization is mostly architectural: pick the cheapest mechanism that meets your trust/isolation needs, pool subprocesses, batch calls across the boundary, lazy-load, cache compiled WASM. The biggest wins come from the design choices, not the per-mechanism tuning.

---

## Further reading
- `wazero` performance: https://wazero.io/docs/performance/
- `hashicorp/go-plugin` perf notes
- gRPC streaming best practices
