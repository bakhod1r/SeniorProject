# The `plugin` Package — Middle

## 1. The build pipeline you actually need

A working plugin setup has more moving parts than the junior example admits. The minimal layout for a real project is:

```
myproject/
├── go.mod
├── pluginapi/         # shared types & interfaces
│   └── api.go
├── cmd/
│   └── host/
│       └── main.go    # the host binary
└── plugins/
    ├── filter/
    │   └── filter.go  # built as filter.so
    └── transform/
        └── transform.go
```

Build commands:

```bash
# host
go build -o bin/host ./cmd/host

# plugins — one .so per directory
go build -buildmode=plugin -o bin/plugins/filter.so    ./plugins/filter
go build -buildmode=plugin -o bin/plugins/transform.so ./plugins/transform
```

All three commands must run from the same module, with the same Go toolchain, against the same `go.sum`. A `Makefile` or `justfile` makes this routine.

---

## 2. The shared API package

Without a shared API, every plugin would need to know the host's concrete types and vice versa. The standard solution is a tiny package that both sides import.

```go
// pluginapi/api.go
package pluginapi

type Request struct {
    ID   string
    Body []byte
}

type Response struct {
    Status int
    Body   []byte
}

type Plugin interface {
    Name() string
    Handle(req *Request) (*Response, error)
}
```

The host depends on `pluginapi.Plugin` as an interface. The plugin implements it with a concrete struct. The host never sees the concrete type — only the interface.

This works because interface dispatch erases the concrete type. The shared `pluginapi` package must, however, be **byte-identical** in both binaries (see section 5).

---

## 3. The factory function pattern

A plugin needs to give the host an instance of its `Plugin`. The convention is a top-level `New` function:

```go
// plugins/filter/filter.go
package main

import (
    "myproject/pluginapi"
)

type filter struct{}

func (filter) Name() string { return "filter" }

func (filter) Handle(req *pluginapi.Request) (*pluginapi.Response, error) {
    // ... do work
    return &pluginapi.Response{Status: 200, Body: req.Body}, nil
}

func New() pluginapi.Plugin {
    return filter{}
}
```

The host:

```go
p, err := plugin.Open("filter.so")
if err != nil { return err }

sym, err := p.Lookup("New")
if err != nil { return err }

newFn, ok := sym.(func() pluginapi.Plugin)
if !ok {
    return fmt.Errorf("New has wrong signature in %s", path)
}

instance := newFn()
log.Printf("loaded plugin %q", instance.Name())
```

Note the `ok` check on the type assertion — comma-ok form converts a panic into a recoverable error. Always use it when loading external plugins.

---

## 4. Discovering plugins from a directory

A common pattern: drop `.so` files into a directory and have the host pick them up at startup.

```go
package main

import (
    "fmt"
    "log"
    "path/filepath"
    "plugin"

    "myproject/pluginapi"
)

func loadAll(dir string) ([]pluginapi.Plugin, error) {
    matches, err := filepath.Glob(filepath.Join(dir, "*.so"))
    if err != nil {
        return nil, err
    }

    var out []pluginapi.Plugin
    for _, path := range matches {
        p, err := plugin.Open(path)
        if err != nil {
            log.Printf("skip %s: open failed: %v", path, err)
            continue
        }

        sym, err := p.Lookup("New")
        if err != nil {
            log.Printf("skip %s: no New symbol", path)
            continue
        }

        newFn, ok := sym.(func() pluginapi.Plugin)
        if !ok {
            return nil, fmt.Errorf("%s: New has wrong signature", path)
        }

        out = append(out, newFn())
    }
    return out, nil
}
```

Failures on individual plugins should not bring down the host. Log and skip.

---

## 5. The type identity rule

Here's the trap that bites every middle-level developer the first time.

Imagine you split the project into two modules: one for the host, one for a plugin. Both vendor `pluginapi` separately. The build succeeds. The host runs:

```go
instance := newFn()                // panic!
```

The panic message:

```
panic: interface conversion: ... is myproject/pluginapi.Plugin, not myproject/pluginapi.Plugin
```

The same name, the same package path — but **two different copies** of the source on disk. Go's runtime compares types by identity, not by string equality. Identity is "same import path + same source bytes + same build context".

The fix: never have two copies of the shared API package. The host and the plugins must come from the **same module checkout** at build time.

---

## 6. Variables and shared state

You can export variables, but be careful about what they mean.

```go
// plugin
package main

import "sync/atomic"

var Counter int64

func Tick() { atomic.AddInt64(&Counter, 1) }
```

```go
// host
sym, _ := p.Lookup("Counter")
counter := sym.(*int64)
sym2, _ := p.Lookup("Tick")
tick := sym2.(func())

tick(); tick(); tick()
fmt.Println(atomic.LoadInt64(counter)) // 3
```

`Lookup` of a variable returns a typed pointer — the host and the plugin truly share the memory location. Concurrency rules apply: use atomics or a mutex if both sides read and write.

---

## 7. Init time pitfalls

The plugin's `init` runs synchronously inside `plugin.Open`. Three rules:

1. **Don't do I/O.** Reading files, opening network connections, or contacting a database in `init` couples plugin load order to external state.
2. **Don't register with the host directly.** The host hasn't returned from `Open` yet; any callback you give it is fragile.
3. **Use `init` only for self-contained setup** — compiling regexes, building lookup tables, registering with a private registry inside the plugin itself.

A better pattern: expose an `Init(host pluginapi.Host) error` function that the host calls explicitly after `Open`. This makes failure modes obvious.

---

## 8. Versioning the API

Because there's no built-in versioning, you have to roll your own.

```go
// pluginapi/api.go
package pluginapi

const APIVersion = "v3"

type Plugin interface { ... }
```

In the plugin:

```go
var APIVersion = "v3" // copied from pluginapi.APIVersion at compile time
```

In the host:

```go
sym, _ := p.Lookup("APIVersion")
v := *sym.(*string)
if v != pluginapi.APIVersion {
    return fmt.Errorf("plugin built against API %s, host wants %s", v, pluginapi.APIVersion)
}
```

This catches mismatched builds early, before the type-assertion panic.

---

## 9. The `Capabilities` pattern

A plugin often supports a subset of host features. Expose a `Capabilities` function and let the host negotiate.

```go
// plugin
func Capabilities() []string {
    return []string{"filter", "batch"}
}
```

```go
// host
sym, _ := p.Lookup("Capabilities")
caps := sym.(func() []string)()

if !slices.Contains(caps, "filter") {
    return errors.New("plugin lacks required capability: filter")
}
```

The host treats unknown plugins as opaque — it asks what they can do before delegating work.

---

## 10. Summary

A real plugin setup is a monorepo with a shared `pluginapi` package and a build pipeline that produces both the host and the plugins from the same toolchain in the same step. Use a factory function (`New`) to return interface values, discover `.so` files from a directory, version your API explicitly, and keep `init` minimal. The type identity rule is the most common source of grief: never let two copies of your shared API exist on disk.

---

## Further reading
- `plugin` package: https://pkg.go.dev/plugin
- Caddy plugin architecture: https://caddyserver.com/docs/extending-caddy
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
