# Registry Pattern — Practice Tasks

Fifteen exercises that walk from a single map+mutex codec registry to a mini service discovery loop. Along the way: scoped DI, `sync.Map` vs `RWMutex`, generics, `atomic.Pointer` hot-reload, the stdlib `plugin` package, and an etcd-backed registrar/resolver pair. Difficulty: **B**eginner, **I**ntermediate, **A**dvanced, **S**enior.

Each task gives a Goal, a Starter, Hints, and a folded Reference solution. Read middle.md first — the trade-offs (RWMutex vs sync.Map, scoped vs global, factory vs implementation, `init()` ordering) are explained there. The tasks force you to live with them.

---

## Task 1 — Minimal codec registry with Register/Get (B)

**Goal.** Smallest correct implementation registry: a `Codec` interface, a package-level map + `sync.RWMutex`, plus `Register(name, c)` and `Get(name)`. Reject double registration and nil codecs with a clear panic.

**Starter.**

```go
package codec

type Codec interface {
    Encode(v any) ([]byte, error)
    Decode(data []byte, out any) error
}

func Register(name string, c Codec) { /* TODO */ }
func Get(name string) (Codec, bool) { /* TODO */ }
```

**Hints.**

- Keep the map and mutex inside one struct so you can't accidentally read without the lock.
- `Register` uses `Lock`; `Get` uses `RLock`. Mixing them up is silent under non-race tests.
- Panic on nil codec and on duplicate names. These are *configuration* bugs that should crash at startup, not lurk in logs.

<details><summary>Reference solution</summary>

```go
package codec

import "sync"

type Codec interface {
    Encode(v any) ([]byte, error)
    Decode(data []byte, out any) error
}

// Senior decision: wrap the map and lock in one struct so future
// readers can never forget the mutex. A bare package-level map plus a
// separate mutex is a footgun.
type registry struct {
    mu sync.RWMutex
    m  map[string]Codec
}

var defaultRegistry = &registry{m: map[string]Codec{}}

func Register(name string, c Codec) {
    // Senior decision: fail loud on nil and duplicates. Both are almost
    // certainly bugs in the caller's init(); panicking now beats a nil
    // dereference 200ms later in main.
    if c == nil {
        panic("codec: Register nil codec for " + name)
    }
    if name == "" {
        panic("codec: Register empty name")
    }
    defaultRegistry.mu.Lock()
    defer defaultRegistry.mu.Unlock()
    if _, dup := defaultRegistry.m[name]; dup {
        panic("codec: Register called twice for " + name)
    }
    defaultRegistry.m[name] = c
}

func Get(name string) (Codec, bool) {
    defaultRegistry.mu.RLock()
    defer defaultRegistry.mu.RUnlock()
    c, ok := defaultRegistry.m[name]
    return c, ok
}
```

Test with two cases: happy `Register`+`Get`, plus a `defer recover()` block that asserts `Register("x", nil)` panics. Everything in this module is a variation on this shape.

</details>

---

## Task 2 — Self-register a "json" codec via init() (B)

**Goal.** Make `codec/json` wire itself in from `init()`. Verify that importing the package alone makes `codec.Get("json")` succeed.

**Starter.**

```go
package json // codec/json/json.go

import (
    "encoding/json"
    "example.com/codec"
)

type jsonCodec struct{}

func (jsonCodec) Encode(v any) ([]byte, error)      { return json.Marshal(v) }
func (jsonCodec) Decode(data []byte, out any) error { return json.Unmarshal(data, out) }

// TODO: register on init().
```

**Hints.**

- `init()` runs once per package, after `var`s, before `main()`.
- The consumer must import this package (blank import counts) to trigger its `init()`. Without the import the compiler drops the package and your registration never runs.
- Dependency order guarantees `codec` is initialised before `codec/json` because `codec/json` imports `codec`.

<details><summary>Reference solution</summary>

```go
// codec/json/json.go
package json

import (
    "encoding/json"
    "example.com/codec"
)

type jsonCodec struct{}

func (jsonCodec) Encode(v any) ([]byte, error)      { return json.Marshal(v) }
func (jsonCodec) Decode(data []byte, out any) error { return json.Unmarshal(data, out) }

// Senior decision: init() is the only place a package should register
// itself. Lazy-in-a-constructor introduces a "did you call Init()?"
// footgun. Go guarantees init() runs at most once, before any function
// in the package can be called from main — exactly the semantics here.
func init() {
    codec.Register("json", jsonCodec{})
}

// codec/json/json_test.go
package json_test

import (
    "testing"
    "example.com/codec"
    _ "example.com/codec/json"
)

func TestJSONSelfRegisters(t *testing.T) {
    c, ok := codec.Get("json")
    if !ok {
        t.Fatal("json codec not registered")
    }
    b, err := c.Encode(map[string]any{"x": 1})
    if err != nil || string(b) != `{"x":1}` {
        t.Fatalf("got %q err=%v", b, err)
    }
}
```

The whole point of this idiom is *zero-configuration discovery*: every binary that imports `codec/json` automatically gets JSON support, no help from main. Same trick `database/sql` uses for drivers. Keep `codec`'s own tests free of any concrete codec import — otherwise you bake a coupling that defeats the purpose.

</details>

---

## Task 3 — Wire it up with blank import (B)

**Goal.** Write a `main` that uses `codec.Get("json")` and never names the json codec package — only via blank import. Then delete the blank import; verify the binary fails at runtime.

**Starter.**

```go
// cmd/encode/main.go
package main

import (
    "fmt"
    "os"

    "example.com/codec"
    _ "example.com/codec/json"
)

func main() {
    c, ok := codec.Get("json")
    if !ok {
        fmt.Fprintln(os.Stderr, "no json codec — forgot blank import?")
        os.Exit(1)
    }
    b, _ := c.Encode(map[string]string{"hello": "world"})
    fmt.Println(string(b))
}
```

**Hints.**

- The `_` means "import only for side effects". Without it the compiler errors "imported and not used".
- Delete the line and re-run: `Get("json")` returns `false`. That's the registry being genuinely decoupled — main knows the *name*, not the *type*.
- Same idiom as `_ "github.com/lib/pq"`.

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"

    "example.com/codec"
    _ "example.com/codec/json" // Senior decision: blank import for side
                               // effects only. Removing this line breaks
                               // the binary at runtime, not compile time.
                               // That trade-off lets the binary author
                               // choose which codecs are compiled in
                               // without touching the registry or its
                               // consumers — the same trade-off
                               // database/sql makes.
)

func main() {
    c, ok := codec.Get("json")
    if !ok {
        fmt.Fprintln(os.Stderr, "no json codec — forgot blank import?")
        os.Exit(1)
    }
    payload := struct {
        Name string
        Age  int
    }{"alice", 30}
    b, err := c.Encode(payload)
    if err != nil {
        fmt.Fprintln(os.Stderr, "encode:", err)
        os.Exit(1)
    }
    fmt.Println(string(b))
}
```

The way to feel this in your bones: compile, run, delete the blank import, run again. That same failure mode is the most common "sql: unknown driver" bug in Go shops; recognising it on sight is a middle-level skill.

</details>

---

## Task 4 — Add Names() and a CLI subcommand "list-codecs" (B)

**Goal.** Extend the registry with `Names() []string` (sorted snapshot). Add a subcommand `myapp list-codecs` printing them one per line. Pure debuggability.

**Starter.**

```go
func Names() []string { /* TODO */ }
// in main: switch os.Args[1] { case "list-codecs": ... }
```

**Hints.**

- Return a copy. Callers must not be able to mutate registry state by mutating the slice.
- Sort for stable output. Easier on shells and humans.
- No flag library needed.

<details><summary>Reference solution</summary>

```go
// codec/codec.go
func Names() []string {
    defaultRegistry.mu.RLock()
    defer defaultRegistry.mu.RUnlock()
    // Senior decision: snapshot keys under the lock, sort outside.
    // sort.Strings allocates; we don't want it on the read lock's
    // critical path.
    out := make([]string, 0, len(defaultRegistry.m))
    for n := range defaultRegistry.m {
        out = append(out, n)
    }
    sort.Strings(out)
    return out
}

// cmd/myapp/main.go
func main() {
    if len(os.Args) < 2 { usage(); os.Exit(2) }
    switch os.Args[1] {
    case "list-codecs":
        for _, n := range codec.Names() { fmt.Println(n) }
    case "help", "-h", "--help":
        usage()
    default:
        fmt.Fprintf(os.Stderr, "unknown: %s\n", os.Args[1])
        usage()
        os.Exit(2)
    }
}
```

This is one of the most-skipped middle-level steps. When the on-call engineer at 03:00 needs "is the parquet codec in this build?", `Names()` answers in one shell command instead of a goroutine dump. Pay the 15 lines now.

</details>

---

## Task 5 — Factory registry: Register(name, func(cfg) Store) (I)

**Goal.** Switch from registering *instances* to registering *constructors*. `New(name, cfg)` calls the factory and returns the built `Store`. Same shape `database/sql.Open` uses internally.

**Starter.**

```go
package stores

type Store interface {
    Get(key string) (string, error)
    Put(key, val string) error
    Close() error
}

type Config struct {
    Addr, User, Password string
    Options              map[string]string
}

type Factory func(cfg Config) (Store, error)

func Register(name string, f Factory)              { /* TODO */ }
func New(name string, cfg Config) (Store, error)   { /* TODO */ }
```

**Hints.**

- Same map+lock as Task 1, but values are functions, not interfaces.
- `New` must drop the read lock before calling the factory. Holding a registry lock across a network handshake is the classic "registry deadlock".
- Factory failure is the caller's problem; don't reinterpret it.

<details><summary>Reference solution</summary>

```go
package stores

import (
    "fmt"
    "sort"
    "sync"
)

type Store interface {
    Get(key string) (string, error)
    Put(key, val string) error
    Close() error
}

type Config struct {
    Addr, User, Password string
    Options              map[string]string
}

type Factory func(cfg Config) (Store, error)

type registry struct {
    mu sync.RWMutex
    m  map[string]Factory
}

var defaultRegistry = &registry{m: map[string]Factory{}}

func Register(name string, f Factory) {
    if f == nil { panic("stores: nil factory for " + name) }
    defaultRegistry.mu.Lock()
    defer defaultRegistry.mu.Unlock()
    if _, dup := defaultRegistry.m[name]; dup {
        panic("stores: Register twice for " + name)
    }
    defaultRegistry.m[name] = f
}

func New(name string, cfg Config) (Store, error) {
    defaultRegistry.mu.RLock()
    f, ok := defaultRegistry.m[name]
    defaultRegistry.mu.RUnlock()
    // Senior decision: drop the read lock BEFORE calling f. Factories
    // open sockets, query DNS, do TLS handshakes — slow work. Holding
    // the registry's lock across that serializes every Register/New
    // call in the program behind the slowest factory.
    if !ok {
        return nil, fmt.Errorf("stores: no factory for %q (have: %v)", name, Names())
    }
    return f(cfg)
}

func Names() []string {
    defaultRegistry.mu.RLock()
    defer defaultRegistry.mu.RUnlock()
    out := make([]string, 0, len(defaultRegistry.m))
    for n := range defaultRegistry.m { out = append(out, n) }
    sort.Strings(out)
    return out
}

// Wiring:
//   func init() {
//       stores.Register("redis", func(cfg stores.Config) (stores.Store, error) {
//           return openRedis(cfg)
//       })
//   }
//   // main:
//   s, err := stores.New("redis", stores.Config{Addr: "localhost:6379"})
```

What you've built is a pluggable connection layer. App code does not depend on the redis package — only on the name "redis" and on whatever wiring layer linked the driver in. Same decoupling that makes `database/sql` work, scaled to dozens of plugins without main growing a single import.

</details>

---

## Task 6 — Replace map+mutex with sync.Map (I)

**Goal.** For a read-on-every-request registry, RWMutex may show up in profiles. Rewrite the codec registry using `sync.Map` and benchmark both. Confirm `sync.Map` wins read-mostly and loses write-heavy.

**Starter.**

```go
var defaultRegistry sync.Map // key: string, value: Codec

func Register(name string, c Codec) { /* TODO */ }
func Get(name string) (Codec, bool) { /* TODO */ }
```

**Hints.**

- `LoadOrStore(name, c)` returns `(actual, loaded)`. `loaded == true` means duplicate — that's your check.
- No length method. Track count separately if you need it.
- Bench: 99% reads vs 50/50. Sync.Map should win the first, lose the second.

<details><summary>Reference solution</summary>

```go
package codec

import (
    "sort"
    "sync"
)

// Senior decision: sync.Map fits two specific shapes — (a) write-once
// then read-many, (b) keys disjoint between goroutines. (a) is exactly
// the startup-registration case. Under write-heavy load it's SLOWER
// than RWMutex because it maintains two internal maps with migration.
var defaultRegistry sync.Map

func Register(name string, c Codec) {
    if c == nil { panic("codec: nil codec for " + name) }
    if _, loaded := defaultRegistry.LoadOrStore(name, c); loaded {
        panic("codec: Register twice for " + name)
    }
}

func Get(name string) (Codec, bool) {
    v, ok := defaultRegistry.Load(name)
    if !ok { return nil, false }
    return v.(Codec), true
}

func Names() []string {
    var out []string
    defaultRegistry.Range(func(k, _ any) bool {
        out = append(out, k.(string))
        return true
    })
    sort.Strings(out)
    return out
}
```

Typical 8-core numbers:

| Benchmark              | RWMutex     | sync.Map    |
|------------------------|-------------|-------------|
| Get-only, 16 goroutines| ~30 ns/op   | ~8 ns/op    |
| 50/50 mixed            | ~110 ns/op  | ~180 ns/op  |

The lesson is "match the data structure to the access pattern", not "use sync.Map for registries". A startup-only registry has almost no writes, which is sync.Map's sweet spot. A per-request-mutated registry needs a different design (sharded map, lock-free trie).

</details>

---

## Task 7 — Scoped registry: pass *Registry through DI, no globals (I)

**Goal.** Drop the package-level singleton. `New() *Registry`; methods on the receiver. Tests can run `t.Parallel()` because each test owns its registry.

**Starter.**

```go
type Registry struct { /* TODO */ }
func New() *Registry                              { /* TODO */ }
func (r *Registry) Register(name string, c Codec) { /* TODO */ }
func (r *Registry) Get(name string) (Codec, bool) { /* TODO */ }
```

**Hints.**

- Each Registry owns its own `mu` and `m`. No package state.
- `t.Parallel()` is the testability win; with a global you'd serialize tests or play `t.Setenv` games.
- For convenience you can keep `var Default = New()` and have a top-level `Register` delegate. Most projects don't bother.

<details><summary>Reference solution</summary>

```go
package codec

import (
    "fmt"
    "sort"
    "sync"
)

type Codec interface {
    Encode(v any) ([]byte, error)
    Decode(data []byte, out any) error
}

type Registry struct {
    mu sync.RWMutex
    m  map[string]Codec
}

// Senior decision: New() is the only constructor. No package-level var
// or init() — that would create the global we're escaping. Callers
// who want a singleton wrap their own.
func New() *Registry { return &Registry{m: map[string]Codec{}} }

func (r *Registry) Register(name string, c Codec) {
    if c == nil { panic("codec: nil codec for " + name) }
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.m[name]; dup {
        panic("codec: Register twice for " + name)
    }
    r.m[name] = c
}

func (r *Registry) Get(name string) (Codec, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    c, ok := r.m[name]
    return c, ok
}

func (r *Registry) MustGet(name string) Codec {
    c, ok := r.Get(name)
    if !ok {
        panic(fmt.Sprintf("codec: %q not registered (have: %v)", name, r.Names()))
    }
    return c
}

func (r *Registry) Names() []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make([]string, 0, len(r.m))
    for n := range r.m { out = append(out, n) }
    sort.Strings(out)
    return out
}

// Parallel-test demo (both subtests run concurrently, no interference):
//
//   func TestParallel(t *testing.T) {
//       t.Run("A", func(t *testing.T) {
//           t.Parallel()
//           r := codec.New()
//           r.Register("a", fakeCodec{})
//           if _, ok := r.Get("b"); ok { t.Error("b leaked") }
//       })
//       t.Run("B", func(t *testing.T) {
//           t.Parallel()
//           r := codec.New()
//           r.Register("b", fakeCodec{})
//           if _, ok := r.Get("a"); ok { t.Error("a leaked") }
//       })
//   }
```

The tax: every consumer needs a `*Registry` dependency. For published libraries, scoped almost always wins. For app boundaries you fully control, a singleton is fine — just be deliberate about which case you're in.

</details>

---

## Task 8 — Generic Registry[T] (Go 1.18+) (I)

**Goal.** One generic `Registry[T any]` covering codec, store factory, and beyond. Show that the type system catches "Codec passed where Factory expected" at compile time.

**Starter.**

```go
type Registry[T any] struct { /* TODO */ }
func New[T any]() *Registry[T]                   { /* TODO */ }
func (r *Registry[T]) Register(name string, v T) { /* TODO */ }
func (r *Registry[T]) Get(name string) (T, bool) { /* TODO */ }
```

**Hints.**

- Structurally identical to Task 7, with `T` instead of `Codec`.
- `MustGet` on miss: `var zero T; return zero` is idiomatic.
- You can NOT write `if v == nil` for arbitrary `T`. Either drop the check, or push nil-validation into the type-specific wrapper.

<details><summary>Reference solution</summary>

```go
package registry

import (
    "fmt"
    "sort"
    "sync"
)

type Registry[T any] struct {
    mu sync.RWMutex
    m  map[string]T
}

func New[T any]() *Registry[T] { return &Registry[T]{m: map[string]T{}} }

// Senior decision: no nil check inside Register. T may be a struct
// (non-nilable) or interface (nilable). The library can't know, so we
// leave nil-validation to the type-specific wrapper. The old non-
// generic codec registry could check because it knew T = Codec.
func (r *Registry[T]) Register(name string, v T) {
    if name == "" { panic("registry: empty name") }
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.m[name]; dup {
        panic("registry: Register twice for " + name)
    }
    r.m[name] = v
}

func (r *Registry[T]) Get(name string) (T, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    v, ok := r.m[name]
    return v, ok
}

func (r *Registry[T]) MustGet(name string) T {
    v, ok := r.Get(name)
    if !ok {
        panic(fmt.Sprintf("registry: %q not registered (have: %v)", name, r.Names()))
    }
    return v
}

func (r *Registry[T]) Names() []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make([]string, 0, len(r.m))
    for n := range r.m { out = append(out, n) }
    sort.Strings(out)
    return out
}

// Type-specific wrappers:
//   var Codecs = registry.New[Codec]()
//   var Stores = registry.New[Factory]()
//
// Compile error now:
//   Codecs.Register("oops", someFactory) // type Factory used where Codec wanted
//
// Constraint-checked helpers go at top level, not on the method
// (Go has no where-clause on methods):
//   func RegisterChecked[T Validator](r *Registry[T], name string, v T) error {
//       if err := v.Validate(); err != nil { return err }
//       r.Register(name, v); return nil
//   }
```

Compared to a non-generic `any` registry: the type system is re-engaged. Cross-type confusions become red squiggles in the editor instead of runtime panics from a type assertion.

</details>

---

## Task 9 — HTTP router as a Registry: pattern → handler (I)

**Goal.** Minimal HTTP router that is literally a registry of `pattern → http.Handler`. Exact paths only. 404 vs 405 done correctly.

**Starter.**

```go
type Router struct { /* TODO */ }
func New() *Router                                                   { /* TODO */ }
func (r *Router) Register(method, pattern string, h http.Handler)    { /* TODO */ }
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) { /* TODO */ }
```

**Hints.**

- Lookup key as `method + " " + pattern` (e.g. `"GET /users"`).
- 404 vs 405: 404 = path unknown; 405 = path known, wrong method.
- `http.HandlerFunc` already satisfies `http.Handler`.

<details><summary>Reference solution</summary>

```go
package router

import (
    "net/http"
    "strings"
    "sync"
)

type Router struct {
    mu       sync.RWMutex
    handlers map[string]http.Handler
    // Senior decision: track a path -> {method set} so we can return
    // 405 (Method Not Allowed) with the Allow header. Without this,
    // every wrong-method request becomes a 404 — confuses HTTP clients,
    // CDNs, and load balancers.
    paths    map[string]map[string]struct{}
}

func New() *Router {
    return &Router{
        handlers: map[string]http.Handler{},
        paths:    map[string]map[string]struct{}{},
    }
}

func key(method, pattern string) string { return method + " " + pattern }

func (r *Router) Register(method, pattern string, h http.Handler) {
    if h == nil { panic("router: nil handler for " + key(method, pattern)) }
    r.mu.Lock()
    defer r.mu.Unlock()
    k := key(method, pattern)
    if _, dup := r.handlers[k]; dup {
        panic("router: Register twice for " + k)
    }
    r.handlers[k] = h
    if r.paths[pattern] == nil {
        r.paths[pattern] = map[string]struct{}{}
    }
    r.paths[pattern][method] = struct{}{}
}

func (r *Router) Handle(method, pattern string, fn http.HandlerFunc) {
    r.Register(method, pattern, fn)
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    r.mu.RLock()
    h, ok := r.handlers[key(req.Method, req.URL.Path)]
    methods, pathExists := r.paths[req.URL.Path]
    r.mu.RUnlock()
    switch {
    case ok:
        h.ServeHTTP(w, req)
    case pathExists:
        allowed := make([]string, 0, len(methods))
        for m := range methods { allowed = append(allowed, m) }
        w.Header().Set("Allow", strings.Join(allowed, ", "))
        http.Error(w, http.StatusText(http.StatusMethodNotAllowed),
            http.StatusMethodNotAllowed)
    default:
        http.NotFound(w, req)
    }
}
```

The educational point: routing is not a different pattern from "registry of codecs". It is literally a registry — only the verbs change (`HandleFunc` instead of `Register`, `ServeHTTP` instead of `Get`). Once you see this, gRPC service registration, `expvar.Publish`, and Prometheus collectors all fall into the same mental bucket.

</details>

---

## Task 10 — Hot-reload registry with atomic.Pointer[map] (A)

**Goal.** Lock-free reads, atomic full-map swap. Pattern for config that changes occasionally and is read constantly. Readers always see a consistent generation.

**Starter.**

```go
type Registry struct {
    m atomic.Pointer[map[string]Codec]
}
func New() *Registry                              { /* TODO */ }
func (r *Registry) Get(name string) (Codec, bool) { /* TODO */ }
func (r *Registry) Swap(next map[string]Codec)    { /* TODO */ }
```

**Hints.**

- The swapped-in map is immutable from the registry's point of view. Never write to it after storing.
- `Register(name, c)` becomes a load → copy → mutate → CAS loop.
- This is generational copy-on-write. Cost: O(N) per swap. Read cost: one atomic load.

<details><summary>Reference solution</summary>

```go
package codec

import (
    "sort"
    "sync/atomic"
)

type Codec interface { /* same as before */ }

type Registry struct {
    // Senior decision: atomic.Pointer to a map gives lock-free reads
    // and (relatively) cheap full-replacement writes. Readers do ONE
    // atomic load and access a snapshot they own. No partial-update
    // window exists — only complete generations swapped atomically.
    // Same trick the Linux kernel uses for RCU.
    m atomic.Pointer[map[string]Codec]
}

func New() *Registry {
    r := &Registry{}
    empty := map[string]Codec{}
    r.m.Store(&empty)
    return r
}

func (r *Registry) Get(name string) (Codec, bool) {
    snap := r.m.Load()
    if snap == nil { return nil, false }
    c, ok := (*snap)[name]
    return c, ok
}

func (r *Registry) Snapshot() map[string]Codec {
    snap := r.m.Load()
    if snap == nil { return nil }
    return *snap
}

func (r *Registry) Swap(next map[string]Codec) {
    // Senior decision: defensive copy. Even if the caller promises not
    // to mutate `next`, we own it from here on.
    cp := make(map[string]Codec, len(next))
    for k, v := range next { cp[k] = v }
    r.m.Store(&cp)
}

func (r *Registry) Register(name string, c Codec) {
    for {
        old := r.m.Load()
        next := make(map[string]Codec, len(*old)+1)
        for k, v := range *old { next[k] = v }
        next[name] = c
        if r.m.CompareAndSwap(old, &next) { return }
    }
}

func (r *Registry) Names() []string {
    snap := r.Snapshot()
    out := make([]string, 0, len(snap))
    for n := range snap { out = append(out, n) }
    sort.Strings(out)
    return out
}

// Wiring a config-watcher:
//   func Watch(ctx context.Context, r *Registry, path string) {
//       t := time.NewTicker(5 * time.Second); defer t.Stop()
//       var lastHash string
//       for {
//           select { case <-ctx.Done(): return; case <-t.C: }
//           data, err := os.ReadFile(path)
//           if err != nil { continue }
//           h := fmt.Sprintf("%x", sha256.Sum256(data))
//           if h == lastHash { continue }
//           lastHash = h
//           r.Swap(parseCodecs(data))
//       }
//   }
```

When NOT to use: writes are frequent and per-key (CAS loop becomes contention magnet — use `sync.Map`); writes need to be atomically tied to side-effects (need a transaction, not a swap).

Mental model: each Swap is a new generation; readers latch onto whatever generation existed at load time. Simplest concurrency story in the language; perfect for "config that changes occasionally, is read constantly".

</details>

---

## Task 11 — Prometheus-style collector registry with introspection (A)

**Goal.** Bones of `prometheus.MustRegister`. `Collector` has `Describe` and `Collect`. Registry rejects collisions and `Gather`s in parallel.

**Starter.**

```go
type Desc struct { FQName, Help string; Labels []string }
type Metric struct { Desc *Desc; Value float64; Labels map[string]string }

type Collector interface {
    Describe(chan<- *Desc)
    Collect(chan<- Metric)
}

type Registry struct { /* TODO */ }
func NewRegistry() *Registry                       { /* TODO */ }
func (r *Registry) Register(c Collector) error     { /* TODO */ }
func (r *Registry) Gather() ([]Metric, error)      { /* TODO */ }
```

**Hints.**

- Drain Describe into a buffered channel so a misbehaving Collector can't deadlock the registry.
- Collision key = `FQName + sorted Labels`. Check ALL collisions before mutating any state; otherwise a failed Register leaves the registry partial.
- Gather fans out per collector in parallel. Tail latency = max(collectors), not sum.

<details><summary>Reference solution</summary>

```go
package metrics

import (
    "fmt"
    "sort"
    "strings"
    "sync"
)

type Desc struct {
    FQName, Help string
    Labels       []string
}

func (d *Desc) key() string {
    ls := append([]string(nil), d.Labels...)
    sort.Strings(ls)
    return d.FQName + "|" + strings.Join(ls, ",")
}

type Metric struct {
    Desc   *Desc
    Value  float64
    Labels map[string]string
}

type Collector interface {
    Describe(chan<- *Desc)
    Collect(chan<- Metric)
}

type Registry struct {
    mu         sync.RWMutex
    collectors map[Collector]struct{}
    descs      map[string]Collector
}

func NewRegistry() *Registry {
    return &Registry{
        collectors: map[Collector]struct{}{},
        descs:      map[string]Collector{},
    }
}

func (r *Registry) Register(c Collector) error {
    // Senior decision: drain Describe into a buffered channel. A
    // misbehaving Collector that emits 10000 descriptors can't
    // deadlock the registry. Cap of 16 covers any legitimate use.
    ch := make(chan *Desc, 16)
    done := make(chan struct{})
    var gathered []*Desc
    go func() {
        defer close(done)
        for d := range ch { gathered = append(gathered, d) }
    }()
    c.Describe(ch)
    close(ch)
    <-done

    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.collectors[c]; dup {
        return fmt.Errorf("metrics: collector already registered")
    }
    // Senior decision: check collisions BEFORE mutating anything.
    // Otherwise a failure mid-loop leaves descs partially populated.
    seen := map[string]struct{}{}
    for _, d := range gathered {
        k := d.key()
        if _, taken := r.descs[k]; taken {
            return fmt.Errorf("metrics: duplicate descriptor: %s", d.FQName)
        }
        if _, dup := seen[k]; dup {
            return fmt.Errorf("metrics: collector returned same desc twice: %s", d.FQName)
        }
        seen[k] = struct{}{}
    }
    for _, d := range gathered { r.descs[d.key()] = c }
    r.collectors[c] = struct{}{}
    return nil
}

func (r *Registry) MustRegister(c Collector) {
    if err := r.Register(c); err != nil { panic(err) }
}

func (r *Registry) Unregister(c Collector) bool {
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, ok := r.collectors[c]; !ok { return false }
    delete(r.collectors, c)
    for k, owner := range r.descs {
        if owner == c { delete(r.descs, k) }
    }
    return true
}

func (r *Registry) Gather() ([]Metric, error) {
    r.mu.RLock()
    cols := make([]Collector, 0, len(r.collectors))
    for c := range r.collectors { cols = append(cols, c) }
    r.mu.RUnlock()
    // Senior decision: fan out collectors. Tail latency = max(slowest)
    // instead of sum(all). For 50 collectors with mixed latencies this
    // is the difference between 200ms and 4s scrapes.
    var (
        mu  sync.Mutex
        out []Metric
        wg  sync.WaitGroup
    )
    for _, c := range cols {
        c := c
        wg.Add(1)
        go func() {
            defer wg.Done()
            ch := make(chan Metric, 64)
            done := make(chan struct{})
            go func() {
                var local []Metric
                for m := range ch { local = append(local, m) }
                mu.Lock(); out = append(out, local...); mu.Unlock()
                close(done)
            }()
            c.Collect(ch)
            close(ch)
            <-done
        }()
    }
    wg.Wait()
    return out, nil
}
```

This is the deliberate cut-down version. Real `prometheus.Registry` also handles cardinality limits, consistent-labels-per-fqname checks, gather timeouts, and exemplars — but the architecture is identical: registration validates immediately; collection is lazy and fanned-out per scrape; the registry holds collectors, not metric values.

</details>

---

## Task 12 — Plugin loader using Go plugin package (A)

**Goal.** Load codecs from `.so` files at runtime. Each plugin exports a `Plugin` symbol. Loader caches by path, handles missing/wrong-type symbols cleanly.

**Starter.**

```go
type Plugin interface {
    Name() string
    Version() string
    Init() (any, error)
}

type Loader struct { /* TODO */ }
func NewLoader() *Loader                           { /* TODO */ }
func (l *Loader) Load(path string) (Plugin, error) { /* TODO */ }
```

**Hints.**

- `plugin.Open(path)`, then `p.Lookup("Plugin")`.
- The OS only loads each `.so` once per process. Second `Open` returns the same handle. Cache by absolute path to mirror this.
- Linux and macOS only. Not Windows.

<details><summary>Reference solution</summary>

```go
package pluginreg

import (
    "fmt"
    "plugin"
    "sync"
)

type Plugin interface {
    Name() string
    Version() string
    Init() (any, error)
}

type PluginInfo struct{ Path, Name, Version string }

type Loader struct {
    mu     sync.Mutex
    byPath map[string]Plugin
    info   []PluginInfo
}

func NewLoader() *Loader { return &Loader{byPath: map[string]Plugin{}} }

func (l *Loader) Load(path string) (Plugin, error) {
    l.mu.Lock()
    defer l.mu.Unlock()
    // Senior decision: cache by path. The OS plugin loader already
    // dedupes (second plugin.Open returns the same *Plugin), but our
    // wrapper tracks registration too — we don't want Load called
    // twice to double-register the codec downstream.
    if p, ok := l.byPath[path]; ok { return p, nil }
    pl, err := plugin.Open(path)
    if err != nil {
        return nil, fmt.Errorf("plugin: open %s: %w", path, err)
    }
    sym, err := pl.Lookup("Plugin")
    if err != nil {
        return nil, fmt.Errorf("plugin %s: missing 'Plugin': %w", path, err)
    }
    // Symbol may be T or *T depending on how the plugin declares it.
    var p Plugin
    switch v := sym.(type) {
    case Plugin:
        p = v
    case *Plugin:
        if v == nil || *v == nil {
            return nil, fmt.Errorf("plugin %s: 'Plugin' is nil", path)
        }
        p = *v
    default:
        return nil, fmt.Errorf("plugin %s: 'Plugin' has wrong type: %T", path, sym)
    }
    l.byPath[path] = p
    l.info = append(l.info, PluginInfo{Path: path, Name: p.Name(), Version: p.Version()})
    return p, nil
}

func (l *Loader) Loaded() []PluginInfo {
    l.mu.Lock()
    defer l.mu.Unlock()
    out := make([]PluginInfo, len(l.info))
    copy(out, l.info)
    return out
}

// Sample plugin (built with `go build -buildmode=plugin -o cbor.so`):
//   package main
//   import "github.com/fxamacker/cbor/v2"
//   type cborPlugin struct{}
//   func (cborPlugin) Name() string    { return "cbor" }
//   func (cborPlugin) Version() string { return "v2.5.0" }
//   func (cborPlugin) Init() (any, error) { return cborCodec{}, nil }
//   var Plugin cborPlugin
//
// Driver:
//   p, _ := loader.Load("./cbor.so")
//   raw, _ := p.Init()
//   codec.Register(p.Name(), raw.(codec.Codec))
```

Why this is senior despite the short code: the `plugin` package has strict ABI requirements — same Go version, same shared-module versions, same build tags. A mismatch is undefined behavior. Plugins cannot be unloaded. Real shops usually avoid stdlib `plugin` and use HashiCorp's subprocess-based `go-plugin`, or wasm via `wazero`. Trade-off explicit.

For the registry pattern: `plugin.Open` + `Lookup` is yet another registry shape. Turtles all the way down.

</details>

---

## Task 13 — gRPC-style service registration with health check (A)

**Goal.** Service registry where each service must implement `HealthCheck(ctx) error`. Periodically probes, marks unhealthy after N consecutive failures. `Lookup` returns the impl only if healthy.

**Starter.**

```go
type Service interface {
    Name() string
    HealthCheck(ctx context.Context) error
}

type Registry struct { /* TODO */ }
func NewRegistry(interval time.Duration, failures int) *Registry { /* TODO */ }
func (r *Registry) Register(s Service)                           { /* TODO */ }
func (r *Registry) Lookup(name string) (Service, bool)           { /* TODO */ }
func (r *Registry) Run(ctx context.Context)                      { /* TODO */ }
```

**Hints.**

- Per-service state: `consecutiveFailures`, `healthy`, both under the registry lock.
- Probe loop: every interval, ping each with a deadline; success resets, failure increments and may flip healthy=false.
- Bounded concurrency on the probe — don't fork 200 goroutines if you have 200 services. Use a semaphore.

<details><summary>Reference solution</summary>

```go
package services

import (
    "context"
    "sort"
    "sync"
    "time"
)

type Service interface {
    Name() string
    HealthCheck(ctx context.Context) error
}

type state struct {
    svc                 Service
    healthy             bool
    consecutiveFailures int
    lastError           error
    lastChecked         time.Time
}

type Registry struct {
    interval            time.Duration
    failuresToUnhealthy int
    probeTimeout        time.Duration
    probeConcurrency    int

    mu       sync.RWMutex
    services map[string]*state
}

func NewRegistry(interval time.Duration, failures int) *Registry {
    return &Registry{
        interval:            interval,
        failuresToUnhealthy: failures,
        probeTimeout:        2 * time.Second,
        probeConcurrency:    16,
        services:            map[string]*state{},
    }
}

func (r *Registry) Register(s Service) {
    if s == nil { panic("services: nil Service") }
    name := s.Name()
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.services[name]; dup {
        panic("services: " + name + " already registered")
    }
    // Senior decision: new services start as healthy. First probe will
    // demote within `interval` if broken. Alternative (start unhealthy,
    // require a passing probe) breaks startup ordering for dependents.
    r.services[name] = &state{svc: s, healthy: true}
}

func (r *Registry) Lookup(name string) (Service, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    s, ok := r.services[name]
    if !ok || !s.healthy { return nil, false }
    return s.svc, true
}

func (r *Registry) Healthy() []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    var out []string
    for name, s := range r.services {
        if s.healthy { out = append(out, name) }
    }
    sort.Strings(out)
    return out
}

func (r *Registry) Run(ctx context.Context) {
    t := time.NewTicker(r.interval)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-t.C:
            r.probeAll(ctx)
        }
    }
}

func (r *Registry) probeAll(ctx context.Context) {
    r.mu.RLock()
    snap := make([]*state, 0, len(r.services))
    for _, s := range r.services { snap = append(snap, s) }
    r.mu.RUnlock()

    // Senior decision: bounded fan-out. 200 services x unbounded
    // goroutines starves the runtime scheduler and floods downstreams.
    sem := make(chan struct{}, r.probeConcurrency)
    var wg sync.WaitGroup
    for _, s := range snap {
        s := s
        wg.Add(1)
        sem <- struct{}{}
        go func() {
            defer wg.Done()
            defer func() { <-sem }()
            r.probeOne(ctx, s)
        }()
    }
    wg.Wait()
}

func (r *Registry) probeOne(ctx context.Context, s *state) {
    pctx, cancel := context.WithTimeout(ctx, r.probeTimeout)
    defer cancel()
    err := s.svc.HealthCheck(pctx)

    r.mu.Lock()
    defer r.mu.Unlock()
    s.lastChecked = time.Now()
    s.lastError = err
    if err == nil {
        // Senior decision: single success resets and restores healthy.
        // "Fast recovery". Alternative (require N consecutive successes)
        // is more dampened but slower to recover from blips.
        s.consecutiveFailures = 0
        s.healthy = true
        return
    }
    s.consecutiveFailures++
    if s.consecutiveFailures >= r.failuresToUnhealthy {
        s.healthy = false
    }
}
```

Test the threshold behavior with a fake service whose error toggles. The pattern is the missing link between static registry and service mesh discovery. Extensions for production: weighted balancing, locality awareness, request-level retries — but the registry-plus-probe-loop core stays the same.

</details>

---

## Task 14 — Etcd-backed dynamic service registry (A)

**Goal.** Producers `Register` with a lease; consumers `Watch` and receive the full current set on every change.

**Starter.**

```go
type Endpoint struct { ID, Name, Addr string }

type Registry struct { cli *clientv3.Client }
func New(cli *clientv3.Client) *Registry { /* TODO */ }
func (r *Registry) Register(ctx context.Context, name, addr string, ttl int64) (func() error, error) { /* TODO */ }
func (r *Registry) Watch(ctx context.Context, name string) (<-chan []Endpoint, error) { /* TODO */ }
```

**Hints.**

- `Grant` + `Put(WithLease)` + `KeepAlive`, in that order. Drain the keep-alive channel or the lease silently dies.
- Watch from `Get.Header.Revision + 1` so no events are missed between snapshot and watch.
- Emit the full set on every change. Easier to reason about than diffs.

<details><summary>Reference solution</summary>

```go
package etcdreg

import (
    "context"
    "fmt"
    "path"

    "github.com/google/uuid"
    clientv3 "go.etcd.io/etcd/client/v3"
)

type Endpoint struct{ ID, Name, Addr string }

type Registry struct {
    cli    *clientv3.Client
    prefix string
}

func New(cli *clientv3.Client) *Registry {
    return &Registry{cli: cli, prefix: "/services"}
}

func (r *Registry) Register(
    ctx context.Context, name, addr string, ttl int64,
) (func() error, error) {
    if ttl < 5 {
        return nil, fmt.Errorf("ttl must be >= 5s (got %d)", ttl)
    }
    id := uuid.NewString()
    key := path.Join(r.prefix, name, id)

    // Senior decision: Grant -> Put(WithLease) -> KeepAlive in this
    // exact order. Put without a lease is permanent. KeepAlive before
    // Put can attach a dead lease.
    leaseResp, err := r.cli.Grant(ctx, ttl)
    if err != nil { return nil, fmt.Errorf("grant: %w", err) }
    if _, err := r.cli.Put(ctx, key, addr, clientv3.WithLease(leaseResp.ID)); err != nil {
        return nil, fmt.Errorf("put: %w", err)
    }
    kaCtx, kaCancel := context.WithCancel(context.Background())
    kaCh, err := r.cli.KeepAlive(kaCtx, leaseResp.ID)
    if err != nil {
        kaCancel()
        return nil, fmt.Errorf("keepalive: %w", err)
    }
    // Senior decision: drain the keepalive channel. If we don't, the
    // etcd client closes the keepalive once its buffer fills — and
    // the service silently disappears from discovery.
    go func() { for range kaCh {} }()

    return func() error {
        kaCancel()
        _, err := r.cli.Revoke(context.Background(), leaseResp.ID)
        return err
    }, nil
}

func (r *Registry) Discover(ctx context.Context, name string) ([]Endpoint, error) {
    prefix := path.Join(r.prefix, name) + "/"
    resp, err := r.cli.Get(ctx, prefix, clientv3.WithPrefix())
    if err != nil { return nil, err }
    out := make([]Endpoint, 0, len(resp.Kvs))
    for _, kv := range resp.Kvs {
        out = append(out, Endpoint{
            ID: path.Base(string(kv.Key)), Name: name, Addr: string(kv.Value),
        })
    }
    return out, nil
}

func (r *Registry) Watch(ctx context.Context, name string) (<-chan []Endpoint, error) {
    prefix := path.Join(r.prefix, name) + "/"
    resp, err := r.cli.Get(ctx, prefix, clientv3.WithPrefix())
    if err != nil { return nil, fmt.Errorf("initial get: %w", err) }

    // Senior decision: emit the FULL set on every change, not diffs.
    // O(N) per change is negligible for typical service counts and
    // makes consumers trivially correct.
    out := make(chan []Endpoint, 8)
    state := map[string]string{}
    for _, kv := range resp.Kvs {
        state[path.Base(string(kv.Key))] = string(kv.Value)
    }

    sendSnapshot := func() {
        snap := make([]Endpoint, 0, len(state))
        for id, addr := range state {
            snap = append(snap, Endpoint{ID: id, Name: name, Addr: addr})
        }
        select {
        case out <- snap:
        case <-ctx.Done():
        }
    }
    sendSnapshot()

    watchCh := r.cli.Watch(ctx, prefix,
        clientv3.WithPrefix(),
        clientv3.WithRev(resp.Header.Revision+1),
    )
    go func() {
        defer close(out)
        for wresp := range watchCh {
            if wresp.Err() != nil { return }
            changed := false
            for _, ev := range wresp.Events {
                id := path.Base(string(ev.Kv.Key))
                switch ev.Type {
                case clientv3.EventTypePut:
                    state[id] = string(ev.Kv.Value)
                    changed = true
                case clientv3.EventTypeDelete:
                    delete(state, id)
                    changed = true
                }
            }
            if changed { sendSnapshot() }
        }
    }()
    return out, nil
}
```

Missing for production: reconnect-on-network-partition, watch revival past compaction, backpressure when consumer is slow. The lesson: a "service registry" looks like a map until you put it on a network. Then it becomes a distributed-systems problem with partitions, stale reads, compaction, replay, fencing.

</details>

---

## Task 15 — Mini service discovery: registrar + resolver + watch (S)

**Goal.** Synthesise everything. One `Discovery` instance is both producer (registers itself) and consumer (resolves others). Health-aware P2C resolver decides per-call which endpoint to use.

**Starter.**

```go
type Endpoint struct { ID, Name, Addr string; Healthy bool }

type LocalService interface {
    Name() string
    Addr() string
    HealthCheck(ctx context.Context) error
}

type Discovery struct { /* TODO */ }
func New(cli *clientv3.Client) *Discovery                                    { /* TODO */ }
func (d *Discovery) Register(ctx context.Context, svc LocalService) (func() error, error) { /* TODO */ }
func (d *Discovery) Pick(name string) (Endpoint, bool)                       { /* TODO */ }
func (d *Discovery) Run(ctx context.Context) error                           { /* TODO */ }
```

**Hints.**

- Compose: local registry holds my services and probes them; etcd holds the cross-process view; per-process `Resolver` merges them via a `/discovery/_health/...` sub-prefix.
- P2C (Power of Two Choices) is the honest senior answer; round-robin is fine if your traffic is uniform.
- One `Discovery` plays both roles. Don't split into two types — every microservice would have to wire up two when one suffices.

<details><summary>Reference solution</summary>

```go
package discovery

import (
    "context"
    "fmt"
    "math/rand"
    "path"
    "sort"
    "sync"
    "sync/atomic"
    "time"

    "github.com/google/uuid"
    clientv3 "go.etcd.io/etcd/client/v3"
)

type Endpoint struct{ ID, Name, Addr string; Healthy bool }

type LocalService interface {
    Name() string
    Addr() string
    HealthCheck(ctx context.Context) error
}

type Discovery struct {
    cli     *clientv3.Client
    prefix  string
    ttl     int64
    probeIv time.Duration

    mu       sync.Mutex
    services []LocalService
    ids      map[LocalService]string

    resolverMu sync.RWMutex
    resolvers  map[string]*p2c
}

// Senior decision: one Discovery plays both producer and consumer.
// Every microservice is both; splitting forces every caller to wire
// up two objects.
func New(cli *clientv3.Client) *Discovery {
    return &Discovery{
        cli:       cli,
        prefix:    "/discovery",
        ttl:       15,
        probeIv:   5 * time.Second,
        ids:       map[LocalService]string{},
        resolvers: map[string]*p2c{},
    }
}

func (d *Discovery) Register(ctx context.Context, svc LocalService) (func() error, error) {
    id := uuid.NewString()
    leaseResp, err := d.cli.Grant(ctx, d.ttl)
    if err != nil { return nil, fmt.Errorf("grant: %w", err) }
    key := path.Join(d.prefix, svc.Name(), id)
    if _, err := d.cli.Put(ctx, key, svc.Addr(), clientv3.WithLease(leaseResp.ID)); err != nil {
        return nil, fmt.Errorf("put: %w", err)
    }
    kaCtx, kaCancel := context.WithCancel(context.Background())
    kaCh, err := d.cli.KeepAlive(kaCtx, leaseResp.ID)
    if err != nil { kaCancel(); return nil, err }
    go func() { for range kaCh {} }()

    d.mu.Lock()
    d.services = append(d.services, svc)
    d.ids[svc] = id
    d.mu.Unlock()

    return func() error {
        kaCancel()
        _, err := d.cli.Revoke(context.Background(), leaseResp.ID)
        return err
    }, nil
}

func (d *Discovery) Pick(name string) (Endpoint, bool) {
    d.resolverMu.RLock()
    r := d.resolvers[name]
    d.resolverMu.RUnlock()
    if r == nil { return Endpoint{}, false }
    return r.Pick()
}

func (d *Discovery) Run(ctx context.Context) error {
    // Senior decision: Run owns three concurrent loops sharing ctx —
    // probe (demote self if a dep is sick), watch (observe the global
    // view), heartbeat (publish my health). All exit together.
    errCh := make(chan error, 2)
    go func() { errCh <- d.probeLoop(ctx) }()
    go func() { errCh <- d.watchLoop(ctx) }()
    select {
    case err := <-errCh:
        return err
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (d *Discovery) probeLoop(ctx context.Context) error {
    t := time.NewTicker(d.probeIv); defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case <-t.C:
            d.mu.Lock()
            svcs := append([]LocalService(nil), d.services...)
            d.mu.Unlock()
            for _, s := range svcs {
                s := s
                go func() {
                    pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
                    defer cancel()
                    err := s.HealthCheck(pctx)
                    d.publishHealth(ctx, s, err == nil)
                }()
            }
        }
    }
}

func (d *Discovery) publishHealth(ctx context.Context, s LocalService, healthy bool) {
    d.mu.Lock()
    id := d.ids[s]
    d.mu.Unlock()
    if id == "" { return }
    key := path.Join(d.prefix, "_health", s.Name(), id)
    val := "1"
    if !healthy { val = "0" }
    lease, err := d.cli.Grant(ctx, 30)
    if err != nil { return }
    _, _ = d.cli.Put(ctx, key, val, clientv3.WithLease(lease.ID))
}

func (d *Discovery) watchLoop(ctx context.Context) error {
    resp, err := d.cli.Get(ctx, d.prefix+"/", clientv3.WithPrefix())
    if err != nil { return err }
    st := newState()
    for _, kv := range resp.Kvs {
        st.apply(string(kv.Key), string(kv.Value), false)
    }
    d.refresh(st)

    ch := d.cli.Watch(ctx, d.prefix+"/",
        clientv3.WithPrefix(),
        clientv3.WithRev(resp.Header.Revision+1),
    )
    for wresp := range ch {
        if err := wresp.Err(); err != nil { return err }
        for _, ev := range wresp.Events {
            st.apply(string(ev.Kv.Key), string(ev.Kv.Value), ev.Type == clientv3.EventTypeDelete)
        }
        d.refresh(st)
    }
    return ctx.Err()
}

type discState struct {
    endpoints map[string]map[string]string // name -> id -> addr
    healthy   map[string]map[string]bool   // name -> id -> healthy
}

func newState() *discState {
    return &discState{
        endpoints: map[string]map[string]string{},
        healthy:   map[string]map[string]bool{},
    }
}

func (s *discState) apply(key, val string, del bool) {
    parts := split(key, '/')
    if len(parts) < 3 { return }
    if parts[1] == "_health" {
        if len(parts) != 4 { return }
        name, id := parts[2], parts[3]
        if _, ok := s.healthy[name]; !ok { s.healthy[name] = map[string]bool{} }
        if del { delete(s.healthy[name], id); return }
        s.healthy[name][id] = val == "1"
        return
    }
    if len(parts) != 3 { return }
    name, id := parts[1], parts[2]
    if _, ok := s.endpoints[name]; !ok { s.endpoints[name] = map[string]string{} }
    if del { delete(s.endpoints[name], id); return }
    s.endpoints[name][id] = val
}

func split(s string, sep byte) []string {
    var out []string
    start := 0
    for i := 0; i < len(s); i++ {
        if s[i] == sep {
            if i > start { out = append(out, s[start:i]) }
            start = i + 1
        }
    }
    if start < len(s) { out = append(out, s[start:]) }
    return out
}

func (d *Discovery) refresh(st *discState) {
    d.resolverMu.Lock()
    defer d.resolverMu.Unlock()
    for name, ep := range st.endpoints {
        eps := make([]Endpoint, 0, len(ep))
        for id, addr := range ep {
            healthy := true
            if hm, ok := st.healthy[name]; ok {
                if v, ok := hm[id]; ok { healthy = v }
            }
            eps = append(eps, Endpoint{ID: id, Name: name, Addr: addr, Healthy: healthy})
        }
        sort.Slice(eps, func(i, j int) bool { return eps[i].ID < eps[j].ID })
        r, ok := d.resolvers[name]
        if !ok { r = &p2c{}; d.resolvers[name] = r }
        r.set(eps)
    }
    for name := range d.resolvers {
        if _, ok := st.endpoints[name]; !ok { delete(d.resolvers, name) }
    }
}

// Senior decision: P2C (Power of Two Choices). Round-robin is blind to
// load; P2C picks two random and routes to the lower-inflight one.
// ~50% of the benefit of full least-connections at ~10% of the cost.
type p2c struct {
    mu        sync.RWMutex
    endpoints []Endpoint
    inflight  []atomic.Int64
}

func (r *p2c) set(eps []Endpoint) {
    r.mu.Lock()
    defer r.mu.Unlock()
    healthy := eps[:0]
    for _, e := range eps {
        if e.Healthy { healthy = append(healthy, e) }
    }
    r.endpoints = healthy
    r.inflight = make([]atomic.Int64, len(healthy))
}

func (r *p2c) Pick() (Endpoint, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    n := len(r.endpoints)
    if n == 0 { return Endpoint{}, false }
    if n == 1 { r.inflight[0].Add(1); return r.endpoints[0], true }
    i := rand.Intn(n)
    j := rand.Intn(n - 1)
    if j >= i { j++ }
    if r.inflight[i].Load() <= r.inflight[j].Load() {
        r.inflight[i].Add(1)
        return r.endpoints[i], true
    }
    r.inflight[j].Add(1)
    return r.endpoints[j], true
}
```

Operational flow when a microservice boots:

1. Calls `Register`. Discovery puts `/discovery/foo/<id>=addr` with a 15s lease + keep-alive.
2. Every 5s, probes self and pushes `/discovery/_health/foo/<id>=1|0` with a 30s lease.
3. Other Discovery instances watching `/discovery/` see the new endpoint and its health, update resolvers.
4. A consumer calls `disc.Pick("foo")` and gets a P2C-chosen healthy endpoint.
5. If the producer dies, both leases expire within 30s. The endpoint disappears from every consumer's resolver within one watch tick.

Informally: the single-binary version of the producer/consumer/registry split Consul, Nacos, Zookeeper provide. They add ACLs, multi-region replication, weighted routing, tags, UI. The skeleton above is the irreducible core: lease-backed registration, prefix watch, health-aware resolution.

Senior gut-check: which failure modes from middle.md §10 does it cover? Stale reads after a partition — yes, leases expire. Hot read path under single mutex — no, each resolver has its own RWMutex and Pick is mostly RLock. Lost `Names()` introspection — partially (you have `Discover` and resolver state but no aggregator). Reflexive answers to those questions are what this task is for.

</details>

---

## 4. How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (got it unaided), `3` (got it AND wrote a stress/race test that broke an earlier version of your own code). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You can write `map[string]X` but can't yet articulate sync.Map vs RWMutex, or when `init()` registration is safe. Re-read middle.md §3–§5, redo Tasks 1–4. Map+lock muscle memory must be reflex first. |
| 16–25 | You can build the three registry forms and pick the right one. Do Tasks 5–9. Don't skip Task 7 — scoped registries are the single biggest correctness/testability win in the module. |
| 26–35 | In-process world is cold. Tasks 10–13 are runtime dynamics: hot-reload, introspection, plugins, health-aware. Distinguishes "I read about it" from "I ship it". |
| 36–45 | Senior level. Tasks 14–15 push out of one-process land. If they didn't teach you something concrete, read Consul's `agent/local/state.go` and etcd's `clientv3/concurrency` — senior-level implementations of these same patterns. |

The most important question is not *did you finish* — it is *can you predict the lock contention and failure modes of any registry you build?* "This Get is one RWMutex.RLock per call." "This Register holds the lock across a network call and will deadlock." "This watch will miss events if the consumer is slower than the producer." If those come reflexively, you understand registries. If not, the rest is plumbing.

Concrete checks worth running before declaring done:

- `go test -race ./...` clean on every task.
- For scoped vs global (1 vs 7): can two test packages share a registry name with different contents, in parallel, without flakes? Global no, scoped yes.
- For sync.Map (6): does your benchmark show the expected crossover? If sync.Map wins write-heavy too, the read-only benchmark is wrong.
- For hot-reload (10): can 1000 concurrent Gets run while Swap fires every 10ms with no Get ever seeing nil or a partial generation?
- For discovery (15): killing etcd mid-flight, do producers re-register within one lease cycle? Slow-consuming the watch channel, do you drop snapshots or block the watch goroutine? Either is fine — but you must know which.

---

## 5. Stretch challenges

**S1 — Generational invalidation across a fleet.** Extend Task 10's `atomic.Pointer[map]` to multi-process. Each process publishes its current generation to etcd; an external publisher bumps generation; processes notice and `Swap`. Constraint: any two processes converge within 5 seconds of a publish, and a process booting mid-flight catches up before serving any request. Combine a `/config/generation` watcher with a `Wait(genID)` API that consumers call before their first lookup.

**S2 — Registry-aware migrations.** Build a `Migrator` over `Registry[T]` and a partial-order spec of "T1 may be removed only after T2 is registered". Use case: removing `protobuf-v1` only once `protobuf-v2` is registered. Migrator runs during init, panics with a clear message if any precondition is violated. Prove the panic catches a misordered deployment under a rolling restart.

**S3 — Cluster-wide handler registry with consistent hashing.** Take Task 9's handler registry and shard across N processes. A request for `/users/alice` routes (via consistent hash on the path) to exactly one process; the other N-1 see "not my shard" and forward. Use Task 15 service discovery to find peers. Minimise request re-routing when a process joins/leaves (consistent hashing's whole job), and gracefully drain a process whose hash range is reassigned. Stress with one process crashing mid-request — no request gets a 500 just because the topology shifted.
