# The `plugin` Package — Interview Questions

Questions specific to Go's built-in `plugin` package. Answers are sketched; for depth, follow the cross-references.

---

## Q1: What is the `plugin` package, in one sentence?

It's Go's standard library package for loading separately compiled `.so` (shared object) files into a running Go program and resolving named exported symbols from them at runtime.

---

## Q2: What is the complete API surface?

Two functions and two types:

```go
func Open(path string) (*Plugin, error)
func (*Plugin) Lookup(symName string) (Symbol, error)

type Plugin struct { /* opaque */ }
type Symbol  interface{}
```

That's it. No `Close`, no `Unload`, no `Symbols()` iterator.

---

## Q3: What build flag is required to produce a plugin?

```bash
go build -buildmode=plugin -o myplugin.so ./pkg/myplugin
```

The package must be `package main` and must **not** define `func main`.

---

## Q4: On which platforms does the package work?

Linux, macOS, FreeBSD — on the architectures where Go's runtime supports `-buildmode=plugin`. Notably **not** Windows, not WebAssembly, not iOS, not Android. This is the main reason teams avoid the package in cross-platform products.

---

## Q5: What does `Lookup` return for a function vs a variable?

For a top-level `func F(...) ...`, `Lookup` returns the function value itself (you type-assert to the exact signature).

For a top-level `var X T`, `Lookup` returns `*T` — a pointer into the plugin's data segment. Both reads and writes affect the plugin's actual variable.

Constants and named types are **not** lookable.

---

## Q6: When does the plugin's `init` run?

Inside `plugin.Open`, synchronously, after the `.so` is mapped into the process and before `Open` returns. If the plugin imports a package the host already imported, that package's `init` does **not** run again.

A panic in the plugin's `init` propagates out of `plugin.Open`.

---

## Q7: What is the "type identity" requirement and why does it matter?

For a value crossing the plugin/host boundary to be type-assertable, the type's identity (pointer equality in the runtime's type table) must match. The runtime unifies types between host and plugin by comparing **content hashes** of the source packages.

If the bytes of a shared package differ between the host's build and the plugin's build — even by one character — the hashes differ, the unification fails, and you get two distinct types with the same name. Assertions then panic with "X is not X".

---

## Q8: Can a plugin be unloaded?

No. There is no `Unload` API. Once `plugin.Open` succeeds, the plugin's code, types, globals, and goroutines stay in the process for its lifetime.

This is fundamental, not an oversight. The runtime keeps references into the plugin's address range (type descriptors, method tables, function pointers, finalizers) that cannot be safely audited without major runtime changes.

---

## Q9: What's the "shared API package" pattern?

A tiny package that both host and plugins import, containing only the interfaces and DTOs that cross the boundary:

```go
package pluginapi

type Plugin interface {
    Name() string
    Handle(req *Request) (*Response, error)
}
```

The host depends on `pluginapi.Plugin` as an interface; the plugin implements it with a concrete struct. Both must compile against the same on-disk bytes of `pluginapi`.

---

## Q10: What does "build host and plugin with the same toolchain" actually mean?

In practice all of:

- Same `go` version (down to the minor version, e.g. 1.22.5).
- Same `GOOS`, `GOARCH`, microarchitecture variant (`GOAMD64`, etc.).
- Same `-trimpath` setting.
- Same effective build tags.
- Same on-disk content for every shared package and dependency.

Easiest enforcement: one CI job, one `go.mod`, one invocation that builds the host and all plugins back-to-back.

---

## Q11: Why does `plugin.Open` sometimes report "different version of package runtime"?

The plugin and host were compiled with different Go toolchain versions. The `runtime` package's bytes change between minor versions, so the hashes differ. Fix by pinning the toolchain (`go.mod` `go` directive + `toolchain` directive + CI's `go-version-file: 'go.mod'`).

---

## Q12: How do you discover plugins from a directory?

```go
files, _ := filepath.Glob(filepath.Join(dir, "*.so"))
for _, f := range files {
    p, err := plugin.Open(f)
    if err != nil { log.Printf("skip %s: %v", f, err); continue }
    sym, err := p.Lookup("New")
    if err != nil { continue }
    newFn, ok := sym.(func() pluginapi.Plugin)
    if !ok { continue }
    plugins = append(plugins, newFn())
}
```

Fail soft per plugin: log and skip rather than crash the host.

---

## Q13: How does `plugin.Open` performance compare to other Go calls?

| Operation | Cost |
|-----------|------|
| `plugin.Open` (first call) | 1–10 ms (small), 100+ ms (large) |
| `plugin.Open` (subsequent call, same path) | sub-microsecond (cached) |
| `(*Plugin).Lookup` | hundreds of ns to ~1 µs |
| Direct call through cached function value | ~5 ns |

`Open` and `Lookup` belong outside the hot path; cached function values are at native speed.

---

## Q14: When should you NOT use the `plugin` package?

- You need Windows support.
- You'll have third-party or operator-installed plugins (you can't enforce toolchain matching).
- You need hot reload.
- You want fault isolation (a plugin crash kills the host).
- The plugins will be in another language.
- You're building a public extension ecosystem.

In any of those cases, pick a different mechanism — see [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/).

---

## Q15: What are the alternatives and when do they fit?

| Mechanism | Use when |
|-----------|----------|
| `hashicorp/go-plugin` (RPC) | Cross-platform, untrusted plugins, hot reload, fault isolation |
| `wazero` (WASM) | Cross-platform, sandboxed, multi-language |
| `-buildmode=c-shared` | Non-Go host needs to call into Go (works on Windows) |
| `exec.Command` subprocess | Language-agnostic, sandboxed by OS, simple |
| Build-time composition (xcaddy-style) | Plugin set is known at build time and changes infrequently |

---

## Q16: Why is there no version negotiation built into the package?

Because the language guarantees nothing about the binary representation of types between builds. The package's authors chose to require identical builds rather than ship a brittle versioning scheme that would lie. If you need versioning, layer it on top via an exported `APIVersion` symbol that the host checks before using the plugin.

---

## Q17: What happens if a plugin and host both define `Apply`?

Nothing — they don't conflict. Each plugin's symbols live in its own linkage namespace. The host calls `p1.Lookup("Apply")` and `p2.Lookup("Apply")` and gets two distinct functions. The collision concern is only if your code path accidentally calls just one when you intended to call both.

---

## Q18: What does it mean that `plugin.Open` is concurrency-safe?

You can call `plugin.Open` from multiple goroutines without synchronization. Internally the package serializes the actual load operation, so two concurrent `Open(path)` calls with the same path return the same `*Plugin`, and two with different paths run sequentially under an internal mutex.

---

## Q19: How do you keep the plugin and host in lockstep in CI?

- Pin the Go toolchain via `go.mod`'s `go` and `toolchain` directives.
- Use one `go.mod` for host and plugins.
- Build everything in a single CI step from a single checkout.
- Use `-trimpath` identically.
- Verify with a smoke test that `plugin.Open` succeeds for every plugin before declaring the build green.
- Optionally, embed a build ID into both host and plugins via `-ldflags="-X ..."` and check it at load time.

---

## Q20: A plugin loads but the very first method call segfaults. What's a likely cause?

A subtle type-identity or init-order bug. The plugin's looked-up function references a global the host's runtime believes is initialized (because a package with the same name was loaded earlier from the host's side) but the plugin's copy of that global was not actually populated. The root cause is almost always a byte-level mismatch between host and plugin imports. Audit `go list -deps` on both sides and look for divergences.

---

## 21. Summary

The `plugin` package interview boils down to: know the tiny API surface, know the platform limitations, know **why** type identity matters at the byte level, know that there's no unload, and know when *not* to use it. Most interview gotchas are corollaries of the runtime-integration design choice — the plugin isn't sandboxed; it's part of the host. Everything follows from that.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
