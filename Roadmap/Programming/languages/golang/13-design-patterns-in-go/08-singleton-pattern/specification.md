# Singleton Pattern — Specification

## 1. Origins

The Singleton pattern was formalised in *Design Patterns: Elements of Reusable Object-Oriented Software* (Gamma, Helm, Johnson, Vlissides, 1994):

> "Ensure a class has only one instance, and provide a global point of access to it."

The pattern accumulated criticism over the decades:

- **Joshua Bloch, *Effective Java* (2001, 2008, 2018)** — Item 3: "Enforce the singleton property with a private constructor or an enum type". Bloch popularised the enum singleton as the "best way to implement a singleton".
- **Mark Seemann, *Dependency Injection in .NET* (2011)** — argued that singletons couple consumers to implementation, defeating DI.
- **"Singleton is the root of all evil" critique** — community sentiment that singletons hide dependencies and impede testing.

In Go's history:

- **Go 1.0 (2012)** — `sync.Once` provides the canonical lazy-init mechanism.
- **Go 1.0** — `http.DefaultClient`, `http.DefaultServeMux` ship; later regretted (proposal #25988).
- **Go 1.19 (2022)** — `atomic.Pointer[T]` formalises type-safe atomic pointer swap.
- **Go 1.21 (2023)** — `sync.OnceFunc`, `sync.OnceValue`, `sync.OnceValues` provide ergonomic wrappers.
- **Go 1.21** — `log/slog` adopts `Default()`/`SetDefault()` pattern.

The Go community has converged on: *sometimes Singleton is OK; usually use DI; favor `sync.Once` over hand-rolled DCL*.

---

## 2. Go language mechanics

The Singleton pattern in Go uses several language features:

### 2.1 Package-level variables

From the [Go spec](https://go.dev/ref/spec#Package_initialization):

> "Within a package, package-level variable initialization proceeds stepwise, with each step selecting the variable earliest in declaration order which has no dependencies on uninitialized variables."

Package vars are initialized in dependency order (when statically derivable), then in declaration order otherwise.

### 2.2 `init()` functions

From the spec:

> "The init function may be defined multiple times in a single package, even within a single source file. ... Multiple such functions may be defined per package, even within a single source file; they execute in the order in which they are declared."

`init()` runs after all package-level var initializations. Multiple `init()`s in the same file run in source order; across files, by file name.

### 2.3 `sync.Once`

The standard lazy-init primitive. Guarantees a function runs *exactly once* across all goroutines, even under concurrent calls.

### 2.4 `atomic.Pointer[T]`

Type-safe atomic pointer wrapper. `Load()` and `Store(*T)` provide the building blocks for hot-reload singletons.

### 2.5 Type parameters (Go 1.18+)

Generic helpers like `sync.OnceValue[T]` (added in Go 1.21) leverage generics for type-safe Once wrappers.

---

## 3. Canonical Go shapes

### 3.1 Eager package-level var

```go
var Default = newService()
```

Initialized at package load. Always runs. Best for cheap, infallible init.

### 3.2 init()-initialized var

```go
var Default *Service

func init() { Default = newService() }
```

Same timing as eager var, but allows multiple statements.

### 3.3 sync.Once lazy

```go
var (
    once     sync.Once
    instance *Service
)

func Default() *Service {
    once.Do(func() { instance = newService() })
    return instance
}
```

Defers init to first use. Thread-safe. The canonical Go pattern.

### 3.4 atomic.Pointer hot-reload

```go
var current atomic.Pointer[Config]

func Get() *Config { return current.Load() }
func Reload(c *Config) { current.Store(c) }
```

Allows swapping the singleton instance at runtime.

### 3.5 OnceValue (Go 1.21+)

```go
var Default = sync.OnceValue(func() *Service { return newService() })
```

Convenience wrapper. Same semantics as §3.3.

---

## 4. Standard library use

### 4.1 Process-wide resources (OS-provided)

- `os.Stdin`, `os.Stdout`, `os.Stderr` — file descriptors 0, 1, 2.
- `time.Local`, `time.UTC` — timezone instances.
- `crypto/rand.Reader` — OS-provided RNG.
- `runtime.NumCPU()` — function returning a fixed value per process.

### 4.2 Default singletons (controversial)

- `http.DefaultClient`, `http.DefaultServeMux`, `http.DefaultTransport` — mutable, lacks timeout. Avoid in new code.
- `log.Default()` — mutable default logger.
- `slog.Default()` / `slog.SetDefault()` — modern replacement for `log.Default()`. Still mutable.
- `flag.CommandLine` — package-level flag set.

### 4.3 Registries (singletons-of-singletons)

- `sql.Drivers()` — registered SQL drivers.
- `image.Decode` + format registry.
- `gob.Register`, `json` doesn't use one.
- `crypto/cipher` block ciphers (no central registry; constructors).

### 4.4 Test-related

- `testing.M` (test main) — singleton-ish, scoped to test binary.

---

## 5. Real library use

### 5.1 Prometheus

```go
prometheus.MustRegister(counter)   // uses prometheus.DefaultRegisterer
```

`prometheus.DefaultRegisterer` is a singleton. Modern best practice: create per-service registries via `prometheus.NewRegistry()`.

### 5.2 OpenTelemetry

```go
tracer := otel.Tracer("my-service")  // uses global TracerProvider
```

Global `TracerProvider` is a singleton, set via `otel.SetTracerProvider`. Per-component tracers are lazily created from it.

### 5.3 zap.L()

```go
zap.L().Info("event")  // uses global logger
```

`*zap.Logger` global, settable via `zap.ReplaceGlobals`. Same pattern as `slog.Default`.

### 5.4 viper

```go
viper.SetConfigFile("config.yaml")
viper.ReadInConfig()
v := viper.GetString("key")
```

`viper` exposes both global functions (singleton-backed) and `*viper.Viper` instances for DI. The singleton is convenient for small apps; DI for larger ones.

---

## 6. Formal specification

A Singleton implementation in Go consists of:

| Element | Description |
|---------|-------------|
| **Storage** | Package-level var holding the instance (`*T` or `atomic.Pointer[T]`). |
| **Initializer** | `init()`, `sync.Once.Do`, or `atomic.Pointer.Store`. |
| **Accessor** | Function returning the instance (`Default()`, `Get()`, `Instance()`). |

**Invariants:**

1. The instance is initialized at most once.
2. All callers observe the same instance.
3. After initialization, reads are safe from any goroutine.
4. (Optional) The instance is settable for hot-reload via `atomic.Pointer`.
5. (Optional) The instance is resettable for tests via `export_test.go` or atomic swap.

---

## 7. Anti-patterns

### 7.1 Mutable global maps

```go
var Config = map[string]string{}
```

Reads and writes from multiple goroutines without synchronization → race. Even with `sync.Mutex`, callers can forget to lock.

### 7.2 `init()` with side effects

```go
func init() {
    db = openDB(os.Getenv("DSN"))  // network call in init
}
```

Blocks startup; can't fail gracefully; tests can't avoid it.

### 7.3 Singleton with mutable shared state

```go
type Cache struct {
    items map[string]any
}
var Default = &Cache{items: map[string]any{}}

// Anywhere:
Default.items["key"] = value
```

Two callers, one map, no mutex.

### 7.4 Double-checked locking without atomics

```go
if !initialized {
    mu.Lock()
    if !initialized {
        instance = newThing()
        initialized = true
    }
    mu.Unlock()
}
```

Outer read races. Memory ordering not guaranteed. Use `sync.Once`.

### 7.5 Singleton with goroutine, no shutdown

```go
func init() {
    go heartbeat()
}
```

Goroutine outlives the singleton. Leaks in tests.

### 7.6 Returning typed nil

```go
var instance *Service
func Get() Iface { return instance }  // (*Service, nil) — non-nil iface
```

Callers see a non-nil interface wrapping a nil pointer. `if i == nil` is false; `i.Method()` panics.

### 7.7 Singleton via `Default()` that callers mutate

```go
func Default() *Service { return defaultInstance }

// Caller:
Default().Timeout = 5 * time.Second  // mutates global
```

Hidden coupling. Other callers see the mutation unexpectedly.

### 7.8 Init-order dependence

```go
// pkg a
var x = pkgb.GetSingleton()  // needs b's singleton

// pkg b
func init() { initSingleton() }
```

Depends on import order. Fragile across refactors.

---

## 8. Variants and dialects

| Variant | Use case |
|---------|----------|
| Eager (package var) | Cheap init, always needed |
| init() | Multi-statement init, always needed |
| sync.Once | Lazy, may not be needed |
| sync.OnceValue (Go 1.21+) | Lazy + cached error |
| atomic.Pointer | Hot-reload required |
| `Default()` + `SetDefault()` | User-overridable global |
| Multiton (per-key singleton) | Connection pool per database |
| Lazy generic helper | Reusable infrastructure |

---

## 9. Naming conventions

- **`Default()`** — singleton accessor with overridable default. Convention from `log.Default()`, `slog.Default()`.
- **`Instance()`** — alternative singleton accessor. Less common in Go.
- **`Get()`** — short singleton accessor when context is clear.
- **`<Pkg>Default`** — exported package var (e.g., `http.DefaultClient`). Deprecated pattern.
- **`Set<X>()`** / **`Replace<X>()`** — pairs with `Default()` to allow override.
- **`Init<X>(ctx)`** — explicit eager init for cases needing lifecycle.

---

## 10. Related patterns

- **Factory** — Singleton is a *cached factory output*. The factory constructs; the cache returns the same value.
- **Multiton** — A registry of singletons, keyed by name or type.
- **Service Locator** — A directory of singletons looked up by name.
- **Dependency Injection** — The architectural alternative to Singleton; passes dependencies explicitly.
- **Registry** — Stores multiple instances, often singleton-per-key.

---

## 11. Further reading

- **Joshua Bloch, *Effective Java*** — Item 3
- **Mark Seemann, *Dependency Injection Principles, Practices, and Patterns***
- **`src/sync/once.go`** — Go's canonical lazy-init
- **`src/sync/atomic/`** — atomic primitives
- **Go proposal #25988** — `http.DefaultClient` retrospective
- **Go proposal #56102** — `sync.OnceFunc`, `OnceValue`, `OnceValues`
- **GoF, *Design Patterns* (1994)** — original Singleton
- **Russ Cox, "Go Memory Model"** — https://go.dev/ref/mem

Singleton is one of the simplest GoF patterns but the most contested. In Go: `sync.Once` for lazy init, `atomic.Pointer` for hot-reload, DI for everything else. Knowing when *not* to use it is the senior-level skill.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **Lazy init** | Construct on first use, not eagerly. |
| **Eager init** | Construct at startup. |
| **Double-checked locking (DCL)** | Pattern attempting to avoid lock on fast path. Broken without atomics. |
| **Hot-reload** | Replace singleton instance at runtime. |
| **Memory model** | Rules for when one goroutine's writes become visible to another. |
| **Default singleton** | Singleton with user-overridable default. |
| **Multiton** | Registry of singletons, keyed by name. |
| **Compositional root** | The `main()` function where dependencies are wired. |
