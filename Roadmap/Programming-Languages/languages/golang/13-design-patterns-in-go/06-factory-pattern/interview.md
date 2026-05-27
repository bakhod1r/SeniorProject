# Factory Pattern — Interview Preparation

## 1. What interviewers test for

The Factory pattern is the most overloaded word in Go interviews. "Factory" can mean a one-line `NewX`, a registry indexed by string, an abstract factory returning a family of related types, or a generic builder. Interviewers probe four areas:

1. **Recognition** — Can you see that *every* `NewX` in Go is already a factory function? Do you know when to graduate from `NewX` to a registry or abstract factory?
2. **Selection criteria** — Pick between `NewX`, registry-based, type-selecting, and abstract factory for a given scenario. Justify the choice.
3. **Runtime vs compile-time** — When does the *caller* know which concrete type they need (compile-time, pick `NewX`), and when does the *input* decide (runtime, pick registry)?
4. **Production traps** — Init order, registry races, factories doing I/O, leaking concrete types, factory-vs-singleton confusion.

Signals by level:

| Level | What they're looking for |
|-------|--------------------------|
| Junior | "Why have a factory at all when Go has struct literals?" — articulate hidden invariants and interface returns |
| Middle | Pick the right shape (plain `NewX` vs registry vs abstract) and explain trade-offs |
| Senior | Design factories that survive interface evolution, plugin systems, multi-tenant configs; debug init-order bugs |

A red flag at any level: claiming Go "doesn't really need factories because struct literals exist". That misses the point — factories enforce invariants, return interfaces, and pick implementations. The struct-literal critique works only when there are *no* invariants, *no* interface return, and *no* selection logic. That's rare.

---

## 2. Table of Contents

1. [What interviewers test for](#1-what-interviewers-test-for)
2. [Table of Contents](#2-table-of-contents)
3. [Junior questions](#3-junior-questions)
4. [Middle questions](#4-middle-questions)
5. [Senior questions](#5-senior-questions)
6. [Live coding challenges](#6-live-coding-challenges)
7. [System design starters](#7-system-design-starters)
8. [Traps and red flags](#8-traps-and-red-flags)
9. [Questions to ASK the interviewer](#9-questions-to-ask-the-interviewer)
10. [Cross-references](#10-cross-references)

---

## 3. Junior questions

### Q1. What is the Factory pattern? When would you use it in Go?

**Answer:** A function (or method) whose job is to construct a value of some type, hiding the construction details from the caller. In Go, the most common form is the `NewX` constructor: `bufio.NewReader`, `http.NewRequest`, `sql.Open`. Use it when:

- Construction has invariants the zero value can't express (a `*sync.Mutex` is fine zero, but a `*bufio.Reader` needs a buffer size and a source).
- You want to return an *interface*, not a concrete type, so consumers depend on the contract.
- The choice of concrete type depends on a runtime argument (driver name, content type, config flag).

**Common wrong answer:** "Factories are for Java; Go uses struct literals." Partly true for trivial types. False as soon as you need invariants or interface returns.

**Follow-up:** Name three factories in the standard library.

> `bufio.NewReader(rd io.Reader) *bufio.Reader`, `sql.Open(driverName, dataSourceName string) (*sql.DB, error)`, `regexp.MustCompile(expr string) *regexp.Regexp`. Each hides setup the caller shouldn't need to know.

---

### Q2. Show me the simplest factory.

**Answer:**

```go
type Logger struct {
    prefix string
    out    io.Writer
}

func NewLogger(prefix string, out io.Writer) *Logger {
    if out == nil {
        out = os.Stderr
    }
    return &Logger{prefix: prefix, out: out}
}
```

The factory:
- Takes the *minimum* required inputs.
- Picks a sane default when the caller passes `nil`.
- Returns a pointer (cheaper to copy, allows methods with pointer receivers).

**Junior signal:** Knowing when to default and when to error. Defaulting `out=nil` to `os.Stderr` is friendly. Defaulting an empty `prefix` to `"app"` is invasive — users may want empty.

---

### Q3. What's the difference between Factory and Constructor?

**Answer:** In Go they're usually the same thing — there is no `class { constructor() { ... } }` syntax. The convention is a top-level function named `NewX` (or `MakeX`, `OpenX`, `Dial`, `Connect` for specific verbs). When people say "factory" in Go, they almost always mean a `NewX` function.

The distinction matters when you have:

- **Constructor** = one fixed type. `NewReader(io.Reader) *Reader`.
- **Factory** = picks among multiple concrete types based on input. `sql.Open("postgres", ...)` returns a `*sql.DB` backed by a Postgres driver; with `"mysql"` it returns one backed by MySQL.

Some people use "constructor" only for the first case and "factory" only for the second. Most Go code uses them interchangeably.

---

### Q4. Why does `NewX` return a pointer instead of a value?

**Answer:** Three reasons:

1. **Identity matters.** If the type has a mutex or a connection inside, copying loses the only safe handle. Returning a pointer makes the caller share, not copy.
2. **Cheaper passing.** A 200-byte struct passed by pointer is 8 bytes; by value, 200.
3. **Methods with pointer receivers.** If any method needs `*T`, returning `T` forces the caller to take `&result`, which is awkward.

**Exception:** Small immutable value types (`time.Time`, `image.Point`). Return them by value. Pointers add no value and increase GC pressure.

**Follow-up:** When would `NewX` return a non-pointer?

> When `X` is value-like: `time.Now()`, `image.Pt(1, 2)`, `big.NewInt(0)`. Wait — `big.NewInt` returns `*big.Int` because `big.Int` carries internal state and the methods mutate. Even "value-like" types often need pointers in Go.

---

### Q5. What's the difference between `Must` and a regular factory?

**Answer:** `Must` variants panic on error instead of returning it. `regexp.MustCompile`, `template.Must`, `text/template.Must`. Use them only when:

- The argument is a *compile-time constant* (a literal regex string).
- A failure means the program is broken, not the input is bad.
- The factory is called at package init or test setup, not at request time.

**Wrong usage:** Calling `regexp.MustCompile(userInput)` at request time. User-supplied input failing should return an error, not crash the service.

**Junior signal:** Knowing *when* `Must` is appropriate is the answer; reciting that they panic is just trivia.

---

### Q6. What's wrong with this factory?

```go
type DB struct{ conn *sql.DB }

func NewDB() *DB {
    db, _ := sql.Open("postgres", "host=...")
    return &DB{conn: db}
}
```

**Answer:** Two bugs:

1. **Error discarded.** `sql.Open` can fail (bad DSN, driver missing). The caller gets a `*DB` holding a broken or nil `*sql.DB` and discovers it only at the first query. Return `(*DB, error)`.
2. **Config hardcoded.** The DSN is a string literal. The factory can't be used in tests, in CI, or with a different DB. Take the DSN as a parameter.

**Fix:**

```go
func NewDB(dsn string) (*DB, error) {
    conn, err := sql.Open("postgres", dsn)
    if err != nil { return nil, err }
    return &DB{conn: conn}, nil
}
```

---

### Q7. What's a registry-based factory?

**Answer:** A factory where the choice of concrete type is keyed by a string (or other identifier) registered at startup. Canonical example: `database/sql`:

```go
import _ "github.com/lib/pq"  // pq.init() calls sql.Register("postgres", &pq.Driver{})

db, err := sql.Open("postgres", dsn)
```

The `_` import runs `pq`'s `init()`, which registers the driver. `sql.Open` then looks up `"postgres"` in the registry and dispatches.

**Use when:** The set of types is open — third parties add new ones. **Avoid when:** The set is closed and known at compile time; a `switch` is clearer.

---

### Q8. Should a factory return a concrete type or an interface?

**Answer:** It depends — and this is a recurring Go debate:

- **Return concrete (pointer to struct)** is the default. Callers can use any method on the type, including ones added later. Easy to evolve.
- **Return interface** when there are multiple possible implementations and the caller doesn't care which one. The classic case is registry factories: `sql.Open` returns `*sql.DB` (a concrete type that holds a `driver.Driver` interface inside) — but for *abstract* factories, returning an interface is right.

The slogan "accept interfaces, return structs" applies to *most* factories. The exception is when the factory's whole point is to pick among implementations — then it has to return the interface.

**Common wrong answer:** "Always return interfaces — it's more flexible." False. Returning an interface from a factory that has *one* implementation is over-engineering and prevents callers from accessing implementation-specific methods.

---

### Q9. What does `image.Decode` show us about factories?

**Answer:** It's a *content-detecting* factory. The caller passes an `io.Reader`. `image.Decode` reads enough bytes to identify the format (PNG, JPEG, GIF), looks up the decoder in a registry, and dispatches:

```go
img, formatName, err := image.Decode(reader)
```

Decoders are registered via `image.RegisterFormat`. The PNG package self-registers in `init()`; importing `_ "image/png"` enables PNG support.

**Lesson:** Factories can dispatch on *content*, not just on a name string. Same registry mechanism, different lookup key.

---

### Q10. Factory or Singleton?

```go
var defaultLogger *Logger
var once sync.Once

func DefaultLogger() *Logger {
    once.Do(func() {
        defaultLogger = &Logger{out: os.Stderr}
    })
    return defaultLogger
}
```

**Answer:** Both. `DefaultLogger` is a *factory function* that returns a *singleton* (the same instance every call). The pattern names aren't mutually exclusive — they describe different aspects of the same code:

- *Factory*: how the value is constructed.
- *Singleton*: there is exactly one of it.

**Common wrong answer:** "It's a singleton, not a factory." It's both. Calling it just a singleton ignores that the construction is non-trivial (lazy, thread-safe via `sync.Once`).

---

## 4. Middle questions

### Q1. Walk me through designing a registry-based factory.

**Answer:** Four pieces:

1. **An interface** the factory returns. Small, focused. E.g., `Driver`, `Decoder`, `Provider`.
2. **A registry** — usually `map[string]Factory`, where `Factory` is `func(config) (Iface, error)`.
3. **A `Register(name, factory)` function** with mutex protection (or a guarantee that registration happens only at `init()`).
4. **A `New(name, config)` function** that looks up the name and dispatches.

```go
type Driver interface {
    Connect(dsn string) (Conn, error)
}

var (
    mu      sync.RWMutex
    drivers = map[string]Driver{}
)

func Register(name string, d Driver) {
    mu.Lock(); defer mu.Unlock()
    if _, dup := drivers[name]; dup {
        panic("driver " + name + " registered twice")
    }
    drivers[name] = d
}

func Open(name, dsn string) (Conn, error) {
    mu.RLock(); d, ok := drivers[name]; mu.RUnlock()
    if !ok { return nil, fmt.Errorf("unknown driver: %s", name) }
    return d.Connect(dsn)
}
```

**Middle signal:** Mentioning the duplicate-registration panic. It's how `database/sql` and `image` behave; surfacing the mistake at startup beats silent overwrite.

**Follow-up:** Why `RWMutex` instead of `Mutex`?

> `Register` happens at `init()` (a few times, total). `Open` happens per request (many times). RWMutex lets concurrent reads proceed without blocking each other. Mutex would serialize all reads.

---

### Q2. When would you use an Abstract Factory in Go?

**Answer:** When you need a *family* of related objects whose implementations are chosen together. Classic example: a tracing backend that exposes a `Tracer`, a `Meter`, and a `Logger`, all of which must come from the same vendor (Jaeger, Datadog, OpenTelemetry).

```go
type Telemetry interface {
    Tracer(name string) Tracer
    Meter(name string) Meter
    Logger(name string) Logger
}

func NewJaegerTelemetry(cfg JaegerConfig) Telemetry { ... }
func NewDDTelemetry(cfg DDConfig) Telemetry { ... }
```

`Telemetry` is the abstract factory: one call gets you the whole family.

**When NOT to use:** When the objects aren't related. Three independent factories (`NewTracer`, `NewMeter`, `NewLogger`) are simpler when they're independent. Abstract factory pays off only if mixing vendors is incoherent.

---

### Q3. What's the difference between Factory Method and Factory Function in Go?

**Answer:** In OO languages, *Factory Method* means a method on a class that subclasses override. Go has no inheritance, so the GoF Factory Method has no direct translation. The Go idiom is:

- **Factory function** — a top-level `NewX` or `Open` or `Dial`.
- **Factory method on a type** — `client.NewRequest(...)` where the method captures shared state (auth token, base URL). Still a function with a receiver.

```go
func (c *Client) NewRequest(method, path string) (*Request, error) {
    req, err := http.NewRequest(method, c.BaseURL+path, nil)
    if err != nil { return nil, err }
    req.Header.Set("Authorization", "Bearer "+c.Token)
    return req, nil
}
```

The method form is useful when construction depends on the receiver's state.

---

### Q4. How does `bufio.NewReader` decide buffer size?

**Answer:** It exposes two factories:

- `bufio.NewReader(rd) *Reader` — default size (4096 bytes).
- `bufio.NewReaderSize(rd, size) *Reader` — caller-specified size. If `size` is too small, it's silently bumped up to `minReadBufferSize`.

The two-factory pattern (default + configurable) is common in Go's stdlib: `NewX` for the common case, `NewXSize`/`NewXConfig` for tuning. Better than a single `NewX(rd, size)` because most callers don't care about size.

**Follow-up:** Why not use functional options?

> `bufio` is old (Go 1.0). Functional options weren't established yet. Today, you'd see `bufio.NewReader(rd, bufio.WithSize(8192))`. The two-factory shape is grandfathered; new packages tend to use options.

---

### Q5. What does `sql.Open` actually return?

**Answer:** A `*sql.DB`, which is a *handle* — not a connection. It's lazy. The first call that actually needs a connection (a `Query`, `Exec`, or `Ping`) triggers the dial. `sql.Open` itself rarely fails — it only validates the driver name.

```go
db, err := sql.Open("postgres", "garbage")  // succeeds — driver "postgres" exists
err = db.Ping()                              // FAILS — DSN is garbage
```

**Middle signal:** Knowing this lets you avoid the bug of treating `sql.Open` returning nil-error as "the DB is reachable". It isn't. Always `db.PingContext(ctx)` after open to verify connectivity.

---

### Q6. How do you make a factory accept a varying number of options?

**Answer:** Functional options. The factory takes a base argument plus a variadic option slice:

```go
type Logger struct { /* ... */ }
type Option func(*Logger)

func WithPrefix(p string) Option   { return func(l *Logger) { l.prefix = p } }
func WithOutput(w io.Writer) Option { return func(l *Logger) { l.out = w } }

func NewLogger(opts ...Option) *Logger {
    l := &Logger{prefix: "app", out: os.Stderr}  // defaults
    for _, opt := range opts { opt(l) }
    return l
}
```

Used: `NewLogger(WithPrefix("api"), WithOutput(os.Stdout))`. Adding a new option doesn't break existing callers.

**Trade-off:** Discoverability suffers — IDEs autocomplete struct fields better than option function names. For very simple cases, a config struct works fine: `NewLogger(LoggerConfig{Prefix: "api"})`.

---

### Q7. What's a "lazy" factory and when do you use it?

**Answer:** A factory whose actual work is deferred until first use. Two patterns:

**Lazy initialization with `sync.Once`:**

```go
type DB struct {
    once sync.Once
    conn *sql.DB
    err  error
    dsn  string
}

func (d *DB) Conn() (*sql.DB, error) {
    d.once.Do(func() {
        d.conn, d.err = sql.Open("postgres", d.dsn)
    })
    return d.conn, d.err
}
```

**Lazy factory returning a function:**

```go
func LazyOpener(dsn string) func() (*sql.DB, error) {
    var (
        once sync.Once
        db   *sql.DB
        err  error
    )
    return func() (*sql.DB, error) {
        once.Do(func() { db, err = sql.Open("postgres", dsn) })
        return db, err
    }
}
```

Use when construction is expensive and might not be needed (rare code path, optional feature). Avoid when construction always happens at startup — eager is simpler.

---

### Q8. Show me a type-selecting factory.

**Answer:** A factory that picks the concrete type by inspecting an argument:

```go
type Handler interface { Handle(req Request) Response }

func NewHandler(kind string) (Handler, error) {
    switch kind {
    case "echo":   return &EchoHandler{}, nil
    case "static": return &StaticHandler{Path: "./public"}, nil
    case "proxy":  return &ProxyHandler{URL: "http://upstream"}, nil
    default:       return nil, fmt.Errorf("unknown handler: %s", kind)
    }
}
```

**Middle signal:** Knowing when this beats a registry. A `switch` is fine when the type set is closed and lives in one place. A registry wins when types come from different packages or third parties.

**Follow-up:** Refactor to a registry. When is the registry overkill?

> Registry is overkill when (a) the types are all in the same package, (b) the set is small (< 5), (c) adding a new type doesn't happen often. A `switch` keeps everything in one place; a registry scatters registration across init functions.

---

### Q9. How do factories interact with `context.Context`?

**Answer:** Two questions:

1. **Does the factory take a context?** Yes if it does I/O (DNS, dial, query). No if it only builds in-memory state. `sql.Open` doesn't take a context (no network); `pgx.Connect(ctx, dsn)` does (dials immediately).

2. **Does the constructed object hold a context?** Usually no. Holding a context in a struct field is an antipattern — it's surprising and prevents callers from passing their own. Take context *per call*, not at construction.

```go
// Bad
client := NewClient(ctx)  // client has ctx forever; can't change

// Good
client := NewClient()
client.Do(ctx, req)
```

**Middle signal:** Spotting the "context in struct" antipattern and articulating why it's wrong (ownership, cancellation propagation, testability).

---

### Q10. What's the trade-off between factory functions and exported struct literals?

**Answer:**

| Aspect | Factory `NewX(...)` | Struct literal `X{...}` |
|--------|---------------------|--------------------------|
| Defaults | Hidden, applied automatically | Caller must remember |
| Invariants | Enforced in code | Hope and prayer |
| Evolution | Add params (or use options) | Add fields silently |
| Discoverability | IDE shows `NewX` | IDE shows the struct fields |
| Verbosity | One line | Sometimes shorter |

**Rule of thumb:** If construction has *any* invariant (nil-check, default, computed field), use a factory. If `T{}` is a fully usable value, struct literal is fine (and idiomatic in Go).

The stdlib uses *both* — `bytes.Buffer{}` is fine; `bufio.NewReader(...)` is required.

---

## 5. Senior questions

### Q1. How do you design a factory API for a library?

**Answer:** Six principles:

1. **Default plus options.** Provide `NewX(required)` for the common case and `NewX(required, opts...)` for tuning.
2. **Return concrete by default.** Return an interface only when picking among implementations or when you genuinely need substitutability.
3. **No I/O in constructors.** Defer network/disk to first use or to an explicit `Verify(ctx)`/`Ping(ctx)` method.
4. **Errors over panics.** Reserve `MustX` for compile-time inputs and tests.
5. **Validate aggressively.** Return errors for nil dependencies, invalid configs, missing required fields. Failing at the factory is cheaper than failing at request time.
6. **Stable signature.** Changing `NewX`'s parameters breaks every caller. Use options or config structs to evolve.

**Senior signal:** Articulating the "I'm designing for someone else's three-year migration" view. Your factory's signature is a contract you can't easily change.

---

### Q2. How do you handle plugin loading via factories?

**Answer:** Two approaches in Go:

1. **Static linking via `init()` registration.** Each plugin is a Go package; importing it (`import _ "plugins/foo"`) triggers its `init()`, which calls a global `Register`. This is how `database/sql` drivers, image formats, and `expvar` handlers work. Pros: type-safe, no runtime loading cost. Cons: every plugin must compile into the binary.

2. **Dynamic loading via `plugin.Open`.** Go's `plugin` package loads `.so` files at runtime, looks up symbols, and casts. Pros: extensibility without rebuild. Cons: severe restrictions (matching Go version, matching build flags, Linux/macOS only), no Windows, hard to debug. Most teams avoid it.

**Senior signal:** Knowing that Go's `plugin` package exists but recommending against it for most use cases. The static-link-with-init pattern covers 95% of plugin needs.

**Follow-up:** What about gRPC plugins (HashiCorp `go-plugin`)?

> Run each plugin as a *subprocess*, communicate via gRPC. Strong isolation (a plugin crash doesn't kill the host), language-independent (Python plugins for Go hosts work). Used by Terraform, Vault, Packer. Heavier than `init()` registration, lighter than `plugin.Open` in misery.

---

### Q3. The registry pattern has a concurrency bug — find it.

```go
var drivers = map[string]Driver{}

func Register(name string, d Driver) {
    drivers[name] = d
}

func Open(name string) Driver {
    return drivers[name]
}
```

**Answer:** Two bugs:

1. **Unprotected concurrent access.** If `Register` is called after `Open` has started serving (e.g., dynamic plugin loading), Go's race detector flags it and the program may corrupt the map.

2. **No duplicate detection.** Two `Register("postgres", ...)` calls silently overwrite the first.

**Fix:**

```go
var (
    mu      sync.RWMutex
    drivers = map[string]Driver{}
)

func Register(name string, d Driver) {
    mu.Lock(); defer mu.Unlock()
    if _, dup := drivers[name]; dup { panic("duplicate driver: " + name) }
    drivers[name] = d
}

func Open(name string) Driver {
    mu.RLock(); defer mu.RUnlock()
    return drivers[name]
}
```

**Senior signal:** Spotting the race *and* the silent-overwrite without prompting. Both are real bugs in real codebases.

---

### Q4. How do you test code that depends on a factory?

**Answer:** Three layers:

1. **Replace the factory.** Make the factory a variable so tests can swap it: `var NewClient = newClient` allows tests to do `NewClient = func() Client { return fakeClient }`. Restore in `t.Cleanup`. Works but has global state.

2. **Inject the factory.** Pass the factory as a parameter. Tests pass a fake factory; production passes the real one. Clean but verbose.

3. **Inject the constructed object.** Best when the object's interface is small. Tests pass a fake instance directly; the factory is invoked once at startup.

```go
// Layer 3: inject the constructed object
type Server struct { Client Client }
func NewServer(c Client) *Server { return &Server{Client: c} }

// Tests
srv := NewServer(&FakeClient{})
// Production
srv := NewServer(NewRealClient())
```

**Senior signal:** Recommending option 3 (inject the object) over option 1 (swap the factory). Global swapping is a recipe for parallel-test failures.

---

### Q5. The "god factory" anti-pattern — recognise and refactor.

**Answer:** A `NewX(...)` taking 12 parameters, half of them options, returning a struct with 30 fields. Symptoms:

- Tests need 5 lines just to construct the dependency.
- New parameters get added every sprint.
- Half the parameters are nil in most call sites.

**Refactor:**

1. **Split the type.** A factory bloated to 30 fields usually conceals 3-4 distinct types. Extract them.
2. **Functional options for tuning.** Required params are positional; everything else is `WithX`.
3. **Composition over flags.** Booleans like `WithCache bool`, `WithMetrics bool` should become decorators applied at wiring time, not factory flags.
4. **Builder for very complex cases.** When options have ordering or co-dependence, a builder is clearer than options.

**Senior signal:** Knowing when to graduate from `NewX(opts...)` to a builder. Builders win when (a) construction is stateful and stepwise, or (b) some combinations are invalid and you want a fluent API to express the valid ones.

---

### Q6. Walk me through the init-order trap with registry factories.

**Answer:** Go's `init()` functions run in dependency order (package A imports B → B's init runs first), but *within* a package, init order is file alphabetical. Registry factories are vulnerable to two problems:

1. **Import-only registration.** A driver registers itself in `init()`. If you forget the `_ "github.com/lib/pq"` blank import, the driver is *not* registered, and `sql.Open("postgres", ...)` returns `"unknown driver: postgres"` at runtime — not at compile time. Subtle, painful.

2. **Cross-package init order.** Package C registers a default that package D depends on. If D's `init()` runs first (D doesn't import C), D sees an empty registry. Symptom: works in dev (where you import everything via main), breaks in tests (where only a subset is imported).

**Fixes:**

- Use `Register` with a *panic on duplicate* so accidental double-import is caught immediately.
- Defer first lookup until *after* all packages have initialized (i.e., from `main`, not from `init`).
- Have integration tests that exercise the full registry — if a driver is missing, the test fails, not production.

---

### Q7. Generics and factories — when do they help?

**Answer:** Go 1.18 generics let you write factory functions that work for multiple types without `interface{}` and assertions. Useful for:

1. **Container factories.** `NewSet[T comparable]()` returns a typed set without boxing.

2. **Pool factories.** `NewPool[T any](newFn func() T) *Pool[T]` returns a typed `sync.Pool` wrapper.

3. **Generic builders.** A generic state machine factory parameterized over event and state types.

Where generics *don't* help:

- Registry factories — the registry's whole point is runtime dispatch on a string. Generics don't compose with string-keyed lookup.
- Factories returning interfaces — once you've committed to an interface return, generics add noise without benefit.

**Senior signal:** Knowing when generics are *not* the right tool. New Go engineers often try to genericize everything; senior engineers reach for them only when type-parameter substitution genuinely helps.

---

### Q8. Factory with options — design problem.

**Prompt:** "Design a HTTP client factory. It needs: required base URL; optional timeout (default 30s), retries (default 3), custom transport, auth provider. Show me the public API."

**Answer:**

```go
type Client struct {
    baseURL   string
    timeout   time.Duration
    retries   int
    transport http.RoundTripper
    auth      AuthProvider
}

type Option func(*Client)

func WithTimeout(d time.Duration) Option  { return func(c *Client) { c.timeout = d } }
func WithRetries(n int) Option            { return func(c *Client) { c.retries = n } }
func WithTransport(t http.RoundTripper) Option { return func(c *Client) { c.transport = t } }
func WithAuth(a AuthProvider) Option      { return func(c *Client) { c.auth = a } }

func NewClient(baseURL string, opts ...Option) (*Client, error) {
    if baseURL == "" { return nil, errors.New("baseURL required") }
    c := &Client{
        baseURL: baseURL,
        timeout: 30 * time.Second,
        retries: 3,
        transport: http.DefaultTransport,
    }
    for _, opt := range opts { opt(c) }
    return c, nil
}
```

**Discussion points:**

- Required goes positional; optional goes as `Option`.
- Defaults applied *before* options so callers can override.
- Validation after options so we can validate combinations.
- Return concrete `*Client`, not an interface — caller may want client-specific methods.

**Follow-up:** What if retries should be ≤ 10? Where does that check live?

> After applying options, before returning. Validate the *final* state, not each option in isolation. Some options interact (a 1ms timeout with 10 retries is probably a misconfiguration).

---

### Q9. How do you evolve a factory function without breaking callers?

**Answer:** Two scenarios:

1. **Adding a new optional parameter.** Use functional options. Existing callers don't see the change; new callers can pass `WithNewThing(...)`.

2. **Adding a required parameter.** Painful. You have to break the signature. Options:
   - Introduce `NewClientV2(...)` alongside `NewClient`. Deprecate the old one. Remove in next major version.
   - Make the parameter required-but-defaulting in `Option` form, validate after options applied. Existing callers panic at startup if they don't supply it — visible early.

**Anti-pattern:** Silently bumping a parameter to `interface{}`. Loses type safety, breaks callers in subtle ways.

**Senior signal:** Mentioning that a *major version bump* (v2) is the right escape hatch when a factory signature genuinely must change. Go modules support this; don't pretend a v2-worthy change is non-breaking.

---

### Q10. Factory in a dependency-injection framework — pros and cons.

**Answer:** Frameworks like `wire` (Google) and `fx` (Uber) treat factory functions as providers. The framework analyses the parameter list, builds a dependency graph, and wires everything at startup.

**Pros:**

- Boilerplate disappears. You declare provider functions; the framework constructs the right things in the right order.
- Compile-time errors (wire) or startup errors (fx) catch missing dependencies before runtime.
- Easy to swap implementations by changing the provider set.

**Cons:**

- Magic. Newcomers don't understand where things come from.
- Debugging is harder. The stack trace through generated code is alien.
- Generated code (wire) lives in the repo and needs regeneration after factory changes.
- Performance overhead (fx, reflection-based) for non-trivial graphs.

**Senior signal:** Recommending wire for static graphs, fx for dynamic ones, and *no framework* for small services. The pattern is fine; the framework choice depends on team size and service complexity.

---

## 6. Live coding challenges

### Challenge 1: Registry-based factory

**Prompt:** Design a registry-based factory for a `Cache` interface. Cache implementations (`memory`, `redis`, `memcached`) self-register via `init()`. The factory should:

- Panic on duplicate registration.
- Return an error for unknown cache names.
- Be safe for concurrent registration and lookup.

**What's being tested:** Registry mechanics, mutex placement, error vs panic decision.

**Solution:**

```go
package cache

import (
    "fmt"
    "sync"
)

type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte) error
}

type Factory func(config map[string]string) (Cache, error)

var (
    mu        sync.RWMutex
    factories = map[string]Factory{}
)

func Register(name string, f Factory) {
    if name == "" || f == nil { panic("cache: invalid registration") }
    mu.Lock(); defer mu.Unlock()
    if _, dup := factories[name]; dup {
        panic(fmt.Sprintf("cache: %q registered twice", name))
    }
    factories[name] = f
}

func New(name string, config map[string]string) (Cache, error) {
    mu.RLock(); f, ok := factories[name]; mu.RUnlock()
    if !ok { return nil, fmt.Errorf("cache: unknown backend %q", name) }
    return f(config)
}
```

**Follow-ups:**

- Why panic on duplicate but error on unknown? (Duplicate = programmer bug, surface immediately. Unknown = config bug, recoverable.)
- How would you list registered backends? (Add a `Names()` function that reads under `RLock`.)
- What's the cost of `RWMutex` here? (Reads are common, writes happen at `init` only. RWMutex is right.)

---

### Challenge 2: Type-selecting factory

**Prompt:** Implement a `NewParser(format string) (Parser, error)` that returns `JSONParser`, `XMLParser`, or `YAMLParser` based on the `format` string. No registry — closed set of types in one file.

**What's being tested:** When to *not* use a registry. Simple dispatch via switch.

**Solution:**

```go
type Parser interface {
    Parse(data []byte) (map[string]any, error)
}

type JSONParser struct{}
func (JSONParser) Parse(data []byte) (map[string]any, error) {
    var out map[string]any
    return out, json.Unmarshal(data, &out)
}

type XMLParser struct{}
func (XMLParser) Parse(data []byte) (map[string]any, error) {
    // ... XML parsing ...
    return nil, nil
}

type YAMLParser struct{}
func (YAMLParser) Parse(data []byte) (map[string]any, error) {
    // ... YAML parsing ...
    return nil, nil
}

func NewParser(format string) (Parser, error) {
    switch strings.ToLower(format) {
    case "json": return JSONParser{}, nil
    case "xml":  return XMLParser{}, nil
    case "yaml", "yml": return YAMLParser{}, nil
    default: return nil, fmt.Errorf("unknown format: %s", format)
    }
}
```

**Discussion:**

- Why no registry? Closed set, one file, three options. A registry would scatter the knowledge for no benefit.
- Why value receivers? Parsers are stateless. No need for pointer overhead.
- When to *graduate* to a registry? When `format` strings start coming from third-party packages.

---

### Challenge 3: Factory with options

**Prompt:** Write a `NewHTTPServer(addr string, opts ...ServerOption) (*Server, error)` that supports:

- Required: `addr`.
- Optional: read timeout, write timeout, max header bytes, custom logger, TLS config.
- Validates: timeouts must be positive; `addr` must be non-empty.

**What's being tested:** Functional options pattern, defaults, validation order.

**Solution:**

```go
type Server struct {
    addr           string
    readTimeout    time.Duration
    writeTimeout   time.Duration
    maxHeaderBytes int
    logger         *slog.Logger
    tls            *tls.Config
    httpServer     *http.Server
}

type ServerOption func(*Server)

func WithReadTimeout(d time.Duration) ServerOption {
    return func(s *Server) { s.readTimeout = d }
}
func WithWriteTimeout(d time.Duration) ServerOption {
    return func(s *Server) { s.writeTimeout = d }
}
func WithMaxHeaderBytes(n int) ServerOption {
    return func(s *Server) { s.maxHeaderBytes = n }
}
func WithLogger(l *slog.Logger) ServerOption {
    return func(s *Server) { s.logger = l }
}
func WithTLS(cfg *tls.Config) ServerOption {
    return func(s *Server) { s.tls = cfg }
}

func NewHTTPServer(addr string, opts ...ServerOption) (*Server, error) {
    if addr == "" { return nil, errors.New("addr required") }

    s := &Server{
        addr:           addr,
        readTimeout:    10 * time.Second,
        writeTimeout:   10 * time.Second,
        maxHeaderBytes: 1 << 20,
        logger:         slog.Default(),
    }
    for _, opt := range opts { opt(s) }

    if s.readTimeout <= 0  { return nil, errors.New("read timeout must be > 0") }
    if s.writeTimeout <= 0 { return nil, errors.New("write timeout must be > 0") }

    s.httpServer = &http.Server{
        Addr:           s.addr,
        ReadTimeout:    s.readTimeout,
        WriteTimeout:   s.writeTimeout,
        MaxHeaderBytes: s.maxHeaderBytes,
        TLSConfig:      s.tls,
    }
    return s, nil
}
```

**Follow-ups:**

- Why validate *after* options? Some options interact; final state is the only state worth validating.
- What if two options conflict (e.g., TLS config + plaintext addr)? Add cross-field validation after the loop.
- Could options return an error? Yes — `type ServerOption func(*Server) error`. Pricier syntax; useful when option failure must be reported precisely.

---

### Challenge 4: Lazy factory via `sync.Once`

**Prompt:** Build a factory that lazily opens a database connection on first use, caches it, and is safe for concurrent first-callers.

**What's being tested:** `sync.Once` mechanics, error propagation in lazy init.

**Solution:**

```go
type LazyDB struct {
    dsn  string
    once sync.Once
    db   *sql.DB
    err  error
}

func NewLazyDB(dsn string) *LazyDB {
    return &LazyDB{dsn: dsn}
}

func (l *LazyDB) DB(ctx context.Context) (*sql.DB, error) {
    l.once.Do(func() {
        db, err := sql.Open("postgres", l.dsn)
        if err != nil { l.err = err; return }
        if err := db.PingContext(ctx); err != nil {
            db.Close()
            l.err = err
            return
        }
        l.db = db
    })
    return l.db, l.err
}
```

**Discussion:**

- `sync.Once` guarantees the init function runs exactly once across all goroutines.
- Both success and failure are cached. If the first attempt fails, every subsequent caller gets the same error — they don't retry.
- For retry semantics, replace `sync.Once` with custom logic using `sync.Mutex` and a `done bool`, resetting on failure.

**Follow-ups:**

- What if you want retries on failure? Replace `sync.Once` with a mutex + result tracking; on error, leave `db` nil and let the next caller try again.
- What about `Close`? Add a `Close() error` method that closes the DB if initialized. Be careful: closing during a concurrent `DB()` call is racy.

---

### Challenge 5: Abstract factory for a tracer

**Prompt:** Design an abstract factory that returns a *family* of related telemetry objects (Tracer, Meter, Logger). Implementations: Jaeger, OpenTelemetry, NoOp.

**What's being tested:** Abstract factory pattern, interface design for families of related types.

**Solution:**

```go
// Family interfaces.
type Span interface {
    End()
    SetAttribute(key string, val any)
}

type Tracer interface {
    Start(ctx context.Context, name string) (context.Context, Span)
}

type Meter interface {
    Counter(name string) Counter
}

type Counter interface {
    Inc(delta float64, attrs ...Attr)
}

type Logger interface {
    Info(msg string, kv ...any)
    Error(msg string, kv ...any)
}

// Abstract factory.
type Telemetry interface {
    Tracer(name string) Tracer
    Meter(name string) Meter
    Logger(name string) Logger
    Shutdown(ctx context.Context) error
}

// Concrete factories.
func NewJaegerTelemetry(cfg JaegerConfig) (Telemetry, error) {
    // ... initialize Jaeger exporter, return a *jaegerTelemetry ...
    return &jaegerTelemetry{...}, nil
}

func NewOTelTelemetry(cfg OTelConfig) (Telemetry, error) {
    return &otelTelemetry{...}, nil
}

func NewNoopTelemetry() Telemetry {
    return &noopTelemetry{}
}

// Usage in main:
tel, err := NewOTelTelemetry(otelConfig)
if err != nil { log.Fatal(err) }
defer tel.Shutdown(context.Background())

tracer := tel.Tracer("api")
meter := tel.Meter("api")
logger := tel.Logger("api")
```

**Discussion:**

- The abstract factory (`Telemetry`) is one interface returning a family.
- Implementations come together — you can't mix Jaeger tracer with OTel meter; the family stays consistent.
- The `NoopTelemetry` exists for tests and as a default — never returns nil, always safe to call.

**Follow-ups:**

- Why is `Shutdown` on the abstract factory and not on each sub-type? Because they share a backend (one exporter, one batch flusher). Shutting them down individually risks leaking the batcher.
- How would you make it composable (some real, some noop)? Wrap a `Telemetry` in a struct that delegates some methods to real impl and others to noop. That's a Decorator, not a new abstract factory.

---

## 7. System design starters

### Starter 1: Plugin system

**Prompt:** "We're building a CLI that supports user plugins. How do we let third parties add new commands?"

**Direction:**

1. Define a `Plugin` interface with `Name()`, `Description()`, `Run(args []string) error`.
2. Provide a `RegisterPlugin(p Plugin)` function backed by a registry map.
3. Plugins are Go packages users import in their fork's `main.go`. Each plugin's `init()` calls `RegisterPlugin`.
4. The CLI's main loop reads command name, looks up in registry, dispatches.

**Trade-offs:**

- Static linking via Go packages = users must rebuild the binary to add plugins. Simple, type-safe.
- Dynamic loading via Go's `plugin` package = users can drop `.so` files. Fragile, Linux-only.
- Subprocess + RPC (hashicorp/go-plugin) = full isolation, language-agnostic. Heaviest but most robust.

For most CLIs, the static-link-with-init approach is best. Reserve subprocess plugins for ecosystems where third parties need to ship binaries that work across multiple host versions (Terraform, Vault).

---

### Starter 2: Multi-tenant factory

**Prompt:** "Our SaaS has 10,000 tenants. Each tenant can have different cache settings, different storage backend, different feature flags. How do we factor object construction?"

**Direction:**

1. Per-tenant `Config` struct holding all knobs.
2. A `TenantContext` factory that, given a tenant ID, loads config (from a config service or cache) and constructs the right family of objects for that tenant.
3. Cache constructed `TenantContext` instances — building one per request is too slow.
4. Invalidate cache on config change (via webhook or pub/sub).

```go
type TenantContext struct {
    Cache   Cache
    Storage Storage
    Flags   FlagSet
}

type TenantFactory struct {
    configs ConfigLoader
    cache   sync.Map  // tenantID -> *TenantContext
}

func (f *TenantFactory) Get(ctx context.Context, tenantID string) (*TenantContext, error) {
    if tc, ok := f.cache.Load(tenantID); ok {
        return tc.(*TenantContext), nil
    }
    cfg, err := f.configs.Load(ctx, tenantID)
    if err != nil { return nil, err }
    tc, err := buildContext(cfg)
    if err != nil { return nil, err }
    f.cache.Store(tenantID, tc)
    return tc, nil
}
```

**Trade-offs:**

- Cache size: 10K tenants might be too many to hold. Add LRU eviction.
- Cache invalidation: when does a tenant's config change? Subscribe to config service updates.
- Cold start: first request for a tenant pays the build cost. Pre-warm hot tenants at startup if needed.

---

### Starter 3: Hot-reload configuration

**Prompt:** "Our service reads a config file at startup. We want config changes to take effect without restart. How do we restructure the factories?"

**Direction:**

1. Wrap each component in a "current pointer" that the factory updates atomically. `atomic.Value` or `atomic.Pointer[T]` (Go 1.19+).
2. The factory watches the config file (via `fsnotify` or signal-based reload), rebuilds the component, and swaps the atomic pointer.
3. Consumers always read through the pointer; they don't hold the constructed object directly.

```go
type LiveLogger struct {
    current atomic.Pointer[slog.Logger]
}

func (l *LiveLogger) Logger() *slog.Logger {
    return l.current.Load()
}

func (l *LiveLogger) Reload(cfg LogConfig) {
    newLogger := buildLogger(cfg)
    l.current.Store(newLogger)
}
```

**Trade-offs:**

- In-flight requests: a request using `oldLogger` keeps using it until completion. Usually fine.
- Resource cleanup: the old logger may hold file handles. Close it after a grace period (or after no requests reference it — harder).
- Partial reload: some components survive reload (DB connection pool), others rebuild (rate limiter config). Decide per component.

---

### Starter 4: Abstract factory for metrics backend

**Prompt:** "We need to support Prometheus, Datadog, and CloudWatch metrics in our service. The backend is chosen by deployment environment. How do we structure this?"

**Direction:**

1. Define a `Metrics` abstract factory: `Counter`, `Gauge`, `Histogram`.
2. Implementations: `PrometheusMetrics`, `DatadogMetrics`, `CloudWatchMetrics`. Each is a complete family.
3. A registry (`Register("prometheus", NewPrometheusMetrics)`) keyed by string lets `main()` pick by env var.
4. Domain code accepts the abstract `Metrics` interface; only `main()` knows the concrete backend.

```go
type Metrics interface {
    Counter(name string, labels ...string) Counter
    Gauge(name string, labels ...string) Gauge
    Histogram(name string, buckets []float64, labels ...string) Histogram
    Flush(ctx context.Context) error
}

func NewMetrics(backend string, cfg map[string]string) (Metrics, error) {
    switch backend {
    case "prometheus": return newPrometheus(cfg)
    case "datadog":    return newDatadog(cfg)
    case "cloudwatch": return newCloudWatch(cfg)
    case "noop":       return &noopMetrics{}, nil
    default:           return nil, fmt.Errorf("unknown metrics backend: %s", backend)
    }
}
```

**Trade-offs:**

- API mismatch across backends: Prometheus has labels at metric definition time; Datadog at emit time. The abstract API has to accommodate the strictest backend, or it has to do internal conversion.
- Performance: counter increments on hot paths must be cheap. Avoid string allocation per increment; pre-resolve labels.
- Testing: provide `NoopMetrics` so tests don't need real backends.

---

### Starter 5: DI for tests

**Prompt:** "Our service has 20 dependencies. Production wires them all together. Tests need to swap most of them with fakes. How do we structure the factories?"

**Direction:**

1. Each component has a constructor `NewX(deps)` taking only the dependencies it needs.
2. A `wire.go` (or hand-rolled `BuildApp()`) function composes them for production.
3. Tests provide their own `BuildApp` that swaps the fakes in. Or use `wire.Build` with a different provider set.
4. Avoid global state: no `init()` registering production services. Tests should not need to undo state.

```go
type App struct {
    Server *Server
}

// Production wiring.
func BuildApp(ctx context.Context) (*App, error) {
    db, err := NewDB(ctx, "postgres://...")
    if err != nil { return nil, err }
    cache := NewRedisCache("redis://...")
    repo := NewRepo(db, cache)
    service := NewService(repo)
    server := NewServer(service)
    return &App{Server: server}, nil
}

// Test wiring.
func BuildTestApp(t *testing.T) *App {
    db := &FakeDB{}
    cache := &FakeCache{}
    repo := NewRepo(db, cache)
    service := NewService(repo)
    server := NewServer(service)
    return &App{Server: server}
}
```

**Trade-offs:**

- Verbosity: hand-wired DI is repetitive in large apps. Consider `wire` (compile-time) or `fx` (runtime) when the graph exceeds ~30 nodes.
- Test isolation: each test should call `BuildTestApp` to get a fresh, isolated app. Shared state = flaky tests.
- Production complexity: when production needs the same dependency wired into multiple places, factor a helper. Don't copy-paste construction.

---

## 8. Traps and red flags

### Trap 1: Singleton-vs-Factory confusion

```go
var instance *Logger
func GetLogger() *Logger {
    if instance == nil {
        instance = &Logger{}  // race condition!
    }
    return instance
}
```

This is *both* a factory (it constructs) and a singleton (one instance). Two bugs:

1. The nil check is not synchronized — two goroutines can both see `nil` and both construct.
2. Mutating a global from a factory makes testing miserable.

**Fix:** `sync.Once`-protected init, *or* inject the logger as a parameter instead of getting it from a global.

---

### Trap 2: Init order surprise

```go
// package a
var Default = NewClient()  // package var; init order = file alphabetical
```

If `NewClient` reads config from a global `Settings` map registered by package `b`'s init, and `a` initializes before `b`, you get an empty client. Symptoms: works in some environments, not others.

**Fix:** Defer construction until *after* all init: use `sync.Once` and a factory function, or do all construction in `main`.

---

### Trap 3: Registry race condition

```go
var drivers = map[string]Driver{}

func Register(name string, d Driver) { drivers[name] = d }
func Open(name string) Driver { return drivers[name] }
```

If anything calls `Register` outside of `init()` (e.g., plugin loading at runtime), concurrent reads from `Open` race against the write. Map writes during concurrent reads = undefined behavior, often a crash.

**Fix:** `sync.RWMutex` around all access. Or document loudly that registration must happen at `init()` only.

---

### Trap 4: Factory doing I/O at startup

```go
func NewService(cfg Config) (*Service, error) {
    conn, err := net.Dial("tcp", cfg.Addr)  // network in constructor
    if err != nil { return nil, err }
    return &Service{conn: conn}, nil
}
```

Problems:

1. `main()` blocks on network at startup. If the dependency is down, the service doesn't boot.
2. Tests can't construct the service without faking the network.
3. Retry logic doesn't apply — one shot at startup, then crash.

**Fix:** Construct in-memory; defer dialing to first call (lazy via `sync.Once`) or to an explicit `Start(ctx)` method.

---

### Trap 5: Returning typed nil

```go
func NewClient(addr string) Iface {
    var c *Client
    if addr != "" { c = &Client{addr: addr} }
    return c  // typed nil!
}
```

Returning `c` when it's `nil` produces `(*Client, nil)` — a non-nil interface wrapping a nil pointer. Callers checking `if i == nil` get `false`, then panic on method call.

**Fix:**

```go
if addr == "" { return nil }  // untyped nil — interface is truly nil
return &Client{addr: addr}
```

---

### Trap 6: Factory function as a method on a value type

```go
type Builder struct { /* ... */ }
func (b Builder) Build() *Thing { ... }  // value receiver
```

`b` is a copy. Mutations during `Build` aren't visible to the caller. Subtle, especially with chained builders.

**Fix:** Pointer receivers for builders. Or return `(*Thing, Builder)` from each step to force the caller to use the return.

---

### Trap 7: Mutating shared state in a factory

```go
var counter int

func NewWidget() *Widget {
    counter++  // global mutation
    return &Widget{id: counter}
}
```

Concurrent calls race on `counter`. Even single-threaded, this couples the factory to a global counter — testing is awkward, IDs are unpredictable across runs.

**Fix:** Use `atomic.AddInt64` if you need monotonic IDs. Better: pass the ID source as a parameter (`NewWidget(idGen IDGenerator)`).

---

### Trap 8: Forgetting `Must` is a footgun

```go
var rx = regexp.MustCompile(userInput)  // panics if userInput is bad
```

`Must` is fine for literals (`regexp.MustCompile("^[0-9]+$")`) — a panic means the program is broken. For dynamic input, use the non-`Must` form and handle the error.

---

### Trap 9: Adding required parameters silently

```go
// v1: func NewService(name string) *Service
// v2: func NewService(name, region string) *Service  // breaks every caller
```

Every caller now has a compile error. There's no migration path.

**Fix:** Add new required params via an *options* mechanism (default missing region to "us-east-1" with a deprecation log) or bump the major version and provide a migration guide.

---

### Trap 10: Forgetting to close what the factory opens

```go
func NewLogger(path string) (*Logger, error) {
    f, err := os.Create(path)
    if err != nil { return nil, err }
    return &Logger{f: f}, nil  // who closes f?
}
```

The factory opens a file but doesn't expose a way to close it. Leak.

**Fix:** Return a value with a `Close() error` method. Document that callers must `defer logger.Close()`. Or use a `RunWithLogger(ctx, fn)` pattern that handles lifecycle internally.

---

## 9. Questions to ASK the interviewer

### Junior-level questions you can ask

- "Do you typically use `NewX` constructors with positional args, options, or config structs?"
- "How do you decide when a factory needs to return an interface instead of a concrete type?"

### Middle-level questions

- "Have you adopted any dependency injection framework (wire, fx, dig)? What drove that decision?"
- "How do you handle config reload — do factories rebuild the world, or do they patch in place?"
- "Do you allow registry-based dispatch, or do you prefer closed sets with switches?"

### Senior-level questions

- "How do you evolve factory signatures across major versions without breaking the ecosystem?"
- "How do you decide between abstract factory and three independent factories?"
- "Do you use code generation (wire) for factory wiring, or hand-rolled?"
- "How do you handle init-order issues across packages with registry-based factories?"
- "What's your testing strategy for code that has 20 dependencies wired through factories?"

---

## 10. Cross-references

- **[../01-functional-options/](../01-functional-options/)** — The canonical Go way to make factory functions configurable without breaking the signature. Almost every non-trivial factory uses functional options.
- **[../02-builder-pattern/](../02-builder-pattern/)** — When functional options aren't enough (ordering, validation between steps), Builder is the next step up.
- **[../03-strategy-pattern/](../03-strategy-pattern/)** — Strategy picks an algorithm at runtime. A factory often returns the right Strategy implementation based on input. Often used together.
- **[../05-adapter-pattern/](../05-adapter-pattern/)** — Adapter constructors *are* factories. The naming overlap is real — a `NewStripeAdapter` is both a factory function and an adapter constructor.
- **[../08-singleton-pattern/](../08-singleton-pattern/)** — Singletons are factories that return the same instance every time. The patterns overlap; calling something "a singleton" doesn't mean it's not also a factory.
- **[../18-registry-pattern/](../18-registry-pattern/)** — The registry pattern is the data-structure side of registry-based factories. Factory talks to a Registry to find implementations.

Factories in Go are everywhere — every `NewX`, every `OpenX`, every `Dial` is a factory. The pattern's value isn't in the name, it's in choosing the right shape: positional args for required, options for optional, builders for stateful, registries for open sets, abstract factories for families, lazy factories for expensive construction. Master the trade-offs and you master construction in Go.
