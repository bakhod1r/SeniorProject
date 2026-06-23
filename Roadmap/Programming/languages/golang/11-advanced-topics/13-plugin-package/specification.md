# The `plugin` Package — Specification

> **Focus:** Authoritative reference for Go's built-in `plugin` package — the API, the `-buildmode=plugin` toolchain mode, the shared object file format, symbol export rules, type identity contract, and compatibility requirements.
>
> **Sources:**
> - `plugin` package documentation: https://pkg.go.dev/plugin
> - `cmd/go` build modes: https://pkg.go.dev/cmd/go#hdr-Build_modes
> - Go source: https://github.com/golang/go/tree/master/src/plugin
>
> **Scope.** This chapter is the deep-dive on *only* the `plugin` package. The broader survey of plugin mechanisms (RPC, WASM, `c-shared`, subprocess) lives in [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/).

---

## 1. What the `plugin` package is

The `plugin` package loads a separately compiled Go shared object (`.so`) into a running Go program and exposes its top-level exported identifiers as runtime symbols. It is the **only first-party in-process plugin mechanism** in the standard library.

| Property | Value |
|----------|-------|
| Import path | `plugin` |
| Added in | Go 1.8 (Linux), Go 1.10 (macOS), Go 1.13 (FreeBSD) |
| Build mode required | `-buildmode=plugin` |
| File format produced | ELF (Linux/FreeBSD) or Mach-O (macOS) shared object |
| Cgo required | Yes (the linker uses the system dynamic loader) |
| Concurrency-safe | `plugin.Open` is safe to call concurrently |

---

## 2. The API surface

The package exposes exactly two named types and two functions.

```go
package plugin

type Plugin struct { /* unexported */ }
type Symbol  interface{}

func Open(path string) (*Plugin, error)
func (*Plugin) Lookup(symName string) (Symbol, error)
```

| Identifier | Purpose |
|------------|---------|
| `plugin.Open(path)` | Load the `.so` at `path`; run its `init` functions; return a `*Plugin` |
| `(*Plugin).Lookup(name)` | Find an exported top-level identifier; return it boxed in a `Symbol` |
| `Plugin` | Opaque handle for a loaded plugin |
| `Symbol` | Type alias for `interface{}` — the dynamic value of the symbol |

There is no `Close`, no `Unload`, no iterator over symbols, no introspection. The package is intentionally small.

---

## 3. Building a plugin

```bash
go build -buildmode=plugin -o myplugin.so ./pkg/myplugin
```

Constraints enforced by the toolchain:

| Constraint | Detail |
|------------|--------|
| Package name | Must be `package main` |
| `func main` | Must **not** exist (the linker rejects it) |
| Exported identifiers | Top-level identifiers starting with an uppercase letter |
| Imports | Any package the build can resolve |
| Cgo | Permitted; transitively required by the runtime |
| Output suffix | Conventionally `.so` on all supported platforms |

The build produces a position-independent shared object that the system dynamic loader (`dlopen` on Unix) can map into the host process.

---

## 4. Loading a plugin

```go
package main

import (
    "fmt"
    "plugin"
)

func main() {
    p, err := plugin.Open("./myplugin.so")
    if err != nil {
        panic(err)
    }
    sym, err := p.Lookup("Greet")
    if err != nil {
        panic(err)
    }
    greet := sym.(func(string) string)
    fmt.Println(greet("world"))
}
```

`plugin.Open` does three things, in order:

1. Calls `dlopen` on the file.
2. Runs every `init` function in the plugin and its transitive imports that the host has not already initialized.
3. Returns the `*Plugin` once init completes.

If any step fails, the plugin is unmapped and an error is returned.

---

## 5. Lookup semantics

```go
sym, err := p.Lookup("Counter")
counter := sym.(*int64)        // variable lookup yields a typed pointer
atomic.AddInt64(counter, 1)
```

| Symbol kind | Lookup returns |
|-------------|---------------|
| Top-level `var X T` | `*T` (always a pointer to the variable) |
| Top-level `func F(...)` | The function value itself |
| Top-level `const C` | Not exported; constants live only at compile time |
| Type names | Not lookable; types are not values |

You must know the exact type at the call site to type-assert. Lookup never coerces; a mismatched assertion panics.

---

## 6. Symbol naming and visibility

| Rule | Detail |
|------|--------|
| Capitalization | The first letter of the identifier must be uppercase (standard Go visibility) |
| Scope | Only package-level identifiers are exported |
| Methods | Not directly lookable — expose a constructor or factory that returns the value |
| Generics | Top-level generic functions and types cannot be looked up |
| Dead code | Identifiers not transitively reachable from `init` or another export may be eliminated; reference them from an exported symbol to keep them |

The full set of lookable symbols is determined at link time; nothing can be added after the plugin is built.

---

## 7. Type identity contract

For a value crossing the plugin boundary to be type-asserted in the host, the type must be **identical** in both binaries.

Identity requires all of:

| Component | Requirement |
|-----------|-------------|
| Import path | Same in host and plugin |
| Source bytes | The compiler must see the same package source |
| Build tags | Same effective set |
| Toolchain version | Same `go` minor version |
| Compiler/linker flags | Same `-gcflags` / `-ldflags` for the shared package |
| Module version | Same on-disk copy of the dependency |

If any differ, `reflect.Type` equality returns false and type assertions panic. The error you see is usually a panic at the assertion site, not at `Open`.

---

## 8. Init semantics

The plugin's `init` functions run synchronously inside `plugin.Open`. This has practical consequences:

| Consequence | Detail |
|-------------|--------|
| Order | Plugin `init` runs after the host's `main`-side init but before `plugin.Open` returns |
| Failure | A panic in `init` propagates out of `Open` as a runtime panic; the host cannot recover the plugin's state |
| Side effects | Any global state mutated by the plugin's `init` is observable to the host immediately |
| Shared packages | If a package is imported by both host and plugin, its `init` runs once (the host's copy wins) |
| Reentry | The runtime detects re-initialization attempts and the `init` simply isn't re-run |

---

## 9. No unload

There is no API to unload a plugin. Once loaded:

- The plugin's code pages stay mapped for the lifetime of the host process.
- The plugin's global variables stay live.
- The runtime continues to know about its types and goroutines.

The Go authors have declined to add unloading because the runtime keeps unsafe references (type descriptors, finalizer pointers, goroutine stacks) into the plugin's address range. Safe unloading would require auditing every escape route.

---

## 10. Platform support

| GOOS | GOARCH | `-buildmode=plugin` |
|------|--------|---------------------|
| linux | amd64 | Yes |
| linux | arm64 | Yes |
| linux | ppc64le | Yes |
| linux | s390x | Yes |
| darwin | amd64 | Yes |
| darwin | arm64 | Yes (Go 1.18+) |
| freebsd | amd64 | Yes |
| windows | any | **No** |
| js / wasip1 | any | **No** |
| android / ios | any | **No** |

The absence of Windows support has been an open issue since 2016 and is the single biggest reason teams avoid the `plugin` package in cross-platform products.

---

## 11. Compatibility requirements

For `plugin.Open` to succeed and stay stable, host and plugin must share:

- The exact Go toolchain version (`go.mod` `go` directive + `GOTOOLCHAIN`).
- `GOOS`, `GOARCH`, `GOAMD64` (and other microarchitecture variants).
- Build tags (`-tags`).
- `-trimpath` setting (mismatched paths change object hashes).
- The on-disk byte content of every package imported by both sides.

In practice this means **building host and plugin from the same module checkout with the same `go` command**. Any other setup invites cryptic load failures and version-mismatch errors.

---

## 12. Error conditions

`plugin.Open` and `Lookup` return errors as strings. Common cases:

| Error text (paraphrased) | Cause |
|--------------------------|-------|
| `realpath failed` | The file does not exist or is not readable |
| `not an ELF file` / `bad magic` | Wrong platform, or not built with `-buildmode=plugin` |
| `plugin was built with a different version of package X` | Host and plugin disagree on package X's bytes |
| `plugin already loaded` | Same path opened twice (subsequent calls return the first `*Plugin`) |
| `symbol X not found in plugin Y` | The symbol does not exist or was dead-code eliminated |

Programmatic detection of these cases requires string matching; there are no typed errors.

---

## 13. Shared API package pattern

The recommended structure for a plugin ecosystem:

```
ecosystem/
├── go.mod
├── pluginapi/        # interfaces and request/response types
│   └── api.go
├── host/             # the binary that loads plugins
│   └── main.go
└── plugins/
    ├── alpha/        # built as alpha.so
    │   └── alpha.go
    └── beta/         # built as beta.so
        └── beta.go
```

Both host and plugins import `ecosystem/pluginapi`. The host calls a known factory symbol (e.g. `New() pluginapi.Plugin`) and uses the returned interface. Types crossing the boundary are interface-typed, never concrete.

---

## 14. When to use this package (narrow)

Use the `plugin` package only when **all** of the following hold:

- You target Linux (or macOS), exclusively.
- Host and plugins are built from the same monorepo, in lockstep, by the same CI.
- You need in-process call latency (sub-microsecond) and the alternatives' overhead is unacceptable.
- You accept that a plugin crash kills the host.

In all other cases prefer RPC plugins, WASM, or subprocess — see [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/) for the comparative survey.

---

## 15. Related references

- `plugin` package: https://pkg.go.dev/plugin
- `-buildmode=plugin` documentation: https://pkg.go.dev/cmd/go#hdr-Build_modes
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
- Caddy's plugin architecture: https://caddyserver.com/docs/extending-caddy
- Go issue tracker for `plugin` on Windows: https://github.com/golang/go/issues/19282
