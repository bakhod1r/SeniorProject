# The `plugin` Package — Optimize

## 1. What costs and what doesn't

A surprising amount of plugin-package "performance work" is actually about avoiding repeated costs. The base operations have these rough costs:

| Operation | Typical cost | Dominated by |
|-----------|-------------|--------------|
| `plugin.Open` | 1–10 ms (small plugin), 100–500 ms (huge) | `dlopen`, type table dedup, init |
| `(*Plugin).Lookup` | 100 ns – 1 µs | Hash map probe in the plugin's symbol table |
| Type assertion of looked-up symbol | ~5 ns | Cache-warm interface conversion |
| Direct call through cached function value | ~5 ns | Function-pointer call, branch predictor friendly |
| Interface call through `pluginapi.Plugin` | ~5–10 ns | One indirection through `itab` |

The takeaways:

- `Open` is **expensive**; do it once per plugin per process.
- `Lookup` is **cheap but not free**; cache the result.
- Once you have the function value or interface, calls are at native Go speed.

---

## 2. Don't `Open` repeatedly

The most common performance mistake is treating `plugin.Open` like a regular file open.

```go
// BAD — opens the plugin on every request
func handle(req *Request) {
    p, _ := plugin.Open("./filter.so")
    sym, _ := p.Lookup("Apply")
    apply := sym.(func(*Request))
    apply(req)
}
```

Even though `plugin.Open` is idempotent (the runtime caches the loaded plugin internally), each call still takes a mutex and does a path lookup. Under load you'll see contention and microseconds of overhead per request.

The fix is obvious but worth stating:

```go
// GOOD — open once at startup; cache the function
var apply func(*Request)

func init() {
    p, err := plugin.Open("./filter.so")
    if err != nil { log.Fatal(err) }
    sym, _ := p.Lookup("Apply")
    apply = sym.(func(*Request))
}

func handle(req *Request) {
    apply(req)
}
```

---

## 3. Cache symbol lookups

`Lookup` returns a fresh interface value every call, and it walks a hash map keyed by the symbol name. For a hot path, do it once.

```go
type loadedPlugin struct {
    name    string
    handle  *plugin.Plugin
    apply   func(*Request) (*Response, error)
    flush   func() error
}

func load(path string) (*loadedPlugin, error) {
    h, err := plugin.Open(path)
    if err != nil { return nil, err }

    applySym, err := h.Lookup("Apply")
    if err != nil { return nil, err }
    flushSym, err := h.Lookup("Flush")
    if err != nil { return nil, err }

    return &loadedPlugin{
        handle: h,
        apply:  applySym.(func(*Request) (*Response, error)),
        flush:  flushSym.(func() error),
    }, nil
}
```

After this, every call to `p.apply(req)` is a direct function call — no map lookup, no type assertion.

---

## 4. Prefer interface dispatch over many `Lookup`s

A plugin with five exported functions can either be looked up symbol-by-symbol, or you can return a single object that implements an interface. The interface form is faster *and* clearer:

```go
// plugin
type filter struct{}

func (filter) Apply(r *Request) (*Response, error) { ... }
func (filter) Flush() error                        { ... }
func (filter) Name() string                        { return "filter" }

func New() pluginapi.Plugin { return filter{} }
```

```go
// host
sym, _ := h.Lookup("New")
plug := sym.(func() pluginapi.Plugin)()
plug.Apply(req)  // single interface call, ~5–10 ns
```

One `Lookup`, one type assertion, one interface call per dispatch. Beats five lookups and five assertions.

---

## 5. The call-overhead comparison

For perspective, here's the rough cost ladder of indirect calls in a Go program:

| Mechanism | Cost per call |
|-----------|--------------|
| Direct function call | ~1 ns |
| Cached function value (via `Lookup`) | ~5 ns |
| Interface method call | ~5–10 ns |
| `reflect.Value.Call` | ~500 ns – 1 µs |
| `exec.Command` round-trip | ~1 ms |
| gRPC over UDS | ~50–100 µs |
| WASM call (`wazero`) | ~500 ns – 10 µs depending on shape |

Plugin-package calls sit at the top — they are the fastest "dynamic" dispatch available in Go. That speed is the entire reason to put up with the package's drawbacks.

---

## 6. Init time matters

Plugin `init` runs during `plugin.Open`. If you have a hundred plugins, init time multiplies your startup latency.

| Bad init pattern | Fix |
|-----------------|-----|
| Compiling regexes from constants | Use `sync.Once` to defer until first use |
| Loading large lookup tables from disk | Lazy-load on first call |
| Connecting to a database | Move to an explicit `Initialize` method called after `Open` |
| Spawning goroutines | Don't; start them when the host requests it |

A clean plugin's `init` should be no more than registering a factory in a private registry. Everything else belongs in a method.

---

## 7. Lazy loading

If you have many plugins and only some get used per request, defer `Open` until first use.

```go
type lazyPlugin struct {
    path string
    once sync.Once
    pl   pluginapi.Plugin
    err  error
}

func (l *lazyPlugin) get() (pluginapi.Plugin, error) {
    l.once.Do(func() {
        h, err := plugin.Open(l.path)
        if err != nil {
            l.err = err
            return
        }
        sym, err := h.Lookup("New")
        if err != nil {
            l.err = err
            return
        }
        newFn, ok := sym.(func() pluginapi.Plugin)
        if !ok {
            l.err = fmt.Errorf("%s: bad New signature", l.path)
            return
        }
        l.pl = newFn()
    })
    return l.pl, l.err
}
```

This trades startup latency for first-call latency on the rarely used plugins. Pair with a background warmer that loads everything within the first second to keep p99 predictable.

---

## 8. Avoid reflection across the boundary

Reflection inside a plugin works fine; reflection on a value crossing the boundary does *not* always work the way you'd expect.

```go
// host
sym, _ := h.Lookup("Config")
cfg := sym.(*Config)

t := reflect.TypeOf(cfg).Elem()
// This is the plugin's *Config type, not necessarily the host's *Config!
```

Because the plugin allocates the `*Config` value, `reflect.TypeOf` returns the plugin's deduplicated type — usually but not always the same as the host's type. If hashes match, the type pointers were unified at `Open` and everything works. If they don't, reflection-based code paths will surprise you.

The safest pattern: never let the host introspect plugin values reflectively. Use interfaces with explicit methods.

---

## 9. Memory layout and false sharing

A plugin's globals sit in the plugin's own data segment, not in the host's. For a counter that both sides touch in a tight loop, this means cache lines do not collide with host hot data (good) but the counter does live at a different cache line than other plugin globals (potentially false-sharing with the *next* plugin global).

For high-throughput counters exported by plugins, pad them like you would any other concurrent counter:

```go
package main

import "sync/atomic"

type padded struct {
    _ [64]byte
    v atomic.Int64
    _ [64]byte
}

var Counter padded

func Inc() { Counter.v.Add(1) }
```

Then in the host:

```go
sym, _ := h.Lookup("Counter")
counter := sym.(*padded)
counter.v.Add(1)
```

The padding survives the boundary because the type bytes are identical on both sides.

---

## 10. Benchmarking the plugin boundary

A quick benchmark to measure your specific case:

```go
package main_test

import (
    "plugin"
    "testing"
)

var apply func(int) int

func init() {
    p, _ := plugin.Open("./filter.so")
    sym, _ := p.Lookup("Apply")
    apply = sym.(func(int) int)
}

func BenchmarkPluginCall(b *testing.B) {
    for i := 0; i < b.N; i++ {
        _ = apply(i)
    }
}
```

Compare with a direct function call of the same body. The difference, on a modern CPU, should be in the low single-digit nanoseconds. If you see microseconds, you've left a `Lookup` or `Open` in the hot path.

---

## 11. What not to optimize

Some things look like opportunities but aren't:

| Idea | Why not |
|------|---------|
| Pool plugin handles to "reuse" them | `plugin.Open` already returns the same `*Plugin` for the same path; pooling is redundant |
| `mmap` the `.so` yourself | The dynamic loader already memory-maps it; you can't beat libc here |
| Call `runtime.GC()` after `Open` to "settle" | The runtime paces itself; forced GC just adds latency |
| Strip symbols from the plugin to "shrink" it | The runtime needs the symbol table for `Lookup`; stripping breaks the package |
| Precompile to a smaller plugin via `-ldflags="-s -w"` | Sometimes safe, but can break plugin symbol resolution in subtle ways; measure both ways |

The biggest optimization is structural: keep `Open` and `Lookup` out of the hot path.

---

## 12. Summary

The `plugin` package gives you native-speed dynamic dispatch *if* you cache `Open` and `Lookup` results outside the hot path. Symbol resolution and type assertion are not free — do them once at load time and reuse the cached function value or interface. Keep plugin `init` minimal so `Open` itself stays fast. The competitive advantage of this package is the ~5 ns call cost; protect it by avoiding repeated loading, reflection across the boundary, and excessive symbol churn.

---

## Further reading
- `runtime/pprof` for profiling plugin calls: https://pkg.go.dev/runtime/pprof
- Go performance benchmark guide: https://github.com/golang/go/wiki/Performance
- Broader plugin survey: [08-plugins-dynamic-loading](../08-plugins-dynamic-loading/)
