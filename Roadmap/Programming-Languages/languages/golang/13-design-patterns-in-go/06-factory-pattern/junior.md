# Factory Pattern — Junior

## 1. What the Factory pattern actually is

Sometimes constructing a value is more involved than `T{}`. You need to:

- Pick *which* concrete type to instantiate based on input (e.g., "give me the right `Storage` for this config").
- Set up dependencies (database connection, logger, metrics client) before returning.
- Hide whether the type is reused (singleton-cached) or freshly allocated.
- Validate inputs and return errors that ordinary struct literals can't.

The Factory pattern solves all of these by replacing the bare struct literal with a *function* whose job is "give me a fully-constructed, ready-to-use instance". The caller doesn't see the assembly; they just see a value (or interface) they can use.

In Go, factories are usually plain functions:

```go
// Bare struct literal — sometimes enough
s := &Server{addr: ":8080"}

// Factory — encapsulates construction
s, err := NewServer(":8080", WithTLS(cert), WithLogger(log))
```

That `NewServer` is a factory. It picks defaults, validates, and may return an error. The caller doesn't construct `*Server` directly with field access.

This pattern looks trivial in Go because the language doesn't need the elaborate GoF class hierarchies (Factory Method, Abstract Factory) — they collapse into ordinary functions returning ordinary values. This file teaches:

1. The four flavours you'll see in Go: `New`, `Make`, registries, and Abstract Factory.
2. When a factory is genuinely needed vs when a struct literal would do.
3. How factories interact with functional options, builder, and dependency injection.
4. The standard library's factory patterns.

---

## 2. Table of Contents

1. [What the Factory pattern actually is](#1-what-the-factory-pattern-actually-is)
2. [Table of Contents](#2-table-of-contents)
3. [Why GoF Factory looks different in Go](#3-why-gof-factory-looks-different-in-go)
4. [The four Go shapes](#4-the-four-go-shapes)
5. [`New` constructors](#5-new-constructors)
6. [`Make` constructors (variants)](#6-make-constructors-variants)
7. [Type-selecting factory](#7-type-selecting-factory)
8. [Abstract Factory in Go](#8-abstract-factory-in-go)
9. [Factory in the standard library](#9-factory-in-the-standard-library)
10. [Factory vs Builder vs functional options](#10-factory-vs-builder-vs-functional-options)
11. [When NOT to use a factory](#11-when-not-to-use-a-factory)
12. [Common mistakes a junior makes](#12-common-mistakes-a-junior-makes)
13. [Tricky points](#13-tricky-points)
14. [Quick test](#14-quick-test)
15. [Cheat sheet](#15-cheat-sheet)
16. [What to learn next](#16-what-to-learn-next)

---

## 3. Why GoF Factory looks different in Go

In Java/C++, the Factory pattern has elaborate class hierarchies:

- `Factory` (abstract class)
- `ConcreteFactoryA`, `ConcreteFactoryB` (subclasses)
- `Product` (abstract class)
- `ConcreteProductA`, `ConcreteProductB` (subclasses)

A *Factory Method* lets subclasses decide what concrete product to instantiate. An *Abstract Factory* groups multiple related factories.

Go has neither inheritance nor abstract classes. The pattern survives as:

- **Plain functions** — `NewX(args) (*X, error)` or `NewX(args) X` (interface).
- **Function values** — `type Constructor func(config) (Product, error)`.
- **Interfaces with one factory method** — when the *factory itself* must be swappable.

The mental shift: in Go, *every constructor function* is already a factory. The pattern doesn't need machinery; it's the default. What's interesting is when a *non-trivial* factory shape appears — type selection, abstract families, or registry-based dispatch.

---

## 4. The four Go shapes

| Shape | Purpose | Example |
|-------|---------|---------|
| **`New<T>`** | Simple constructor with defaults / validation | `bufio.NewReader(r)` |
| **`Make<T>`** | Construct a value (not pointer) | `make(chan int, 10)`, `flag.NewFlagSet(...)` |
| **Type-selecting** | Pick which concrete type based on input | `image.Decode(r)` (returns gif/jpeg/png) |
| **Abstract Factory** | One type produces a family of related types | `sql.Open("postgres", dsn)` returns `*sql.DB`, which produces `*sql.Stmt`, `*sql.Rows`, etc. |

The first two are almost always plain functions. The third is a function (or a method) that returns an interface and picks the concrete type internally. The fourth is rare in idiomatic Go but appears in library boundaries (`database/sql`, `crypto/x509`, etc.).

---

## 5. `New` constructors

The most common factory shape in Go.

```go
type Server struct {
    addr   string
    logger *log.Logger
}

func NewServer(addr string) *Server {
    if addr == "" { addr = ":8080" }
    return &Server{
        addr:   addr,
        logger: log.Default(),
    }
}
```

Five things the constructor does:

1. **Picks the right concrete type to return** (`*Server`).
2. **Sets sensible defaults** (if `addr == ""`, use `:8080`).
3. **Validates inputs** (could `return nil, error` if invalid).
4. **Constructs dependencies** (logger, metrics client).
5. **Hides which fields are required vs optional** — the caller doesn't write `&Server{addr: "", logger: nil}`.

When in doubt, write a `New` constructor. Returning the concrete type lets callers use any method; the interface (if any) is assigned at the consumer's site.

### 5.1 Returning a value vs pointer

```go
// Pointer — when the type has identity (mutable state, shared)
func NewServer(...) *Server { return &Server{...} }

// Value — when the type is essentially data (immutable)
func NewBigInt(value int64) BigInt { return BigInt{n: value} }
```

For most domain objects with state and methods, return `*T`. For value-semantic types (configurations, timestamps, money amounts), return `T`.

### 5.2 Returning an error

```go
func NewServer(addr string) (*Server, error) {
    if addr == "" {
        return nil, errors.New("NewServer: addr required")
    }
    return &Server{addr: addr}, nil
}
```

If construction can fail (invalid input, network I/O during init, dependency lookup), the constructor returns `(*T, error)`. Callers must check.

Avoid returning an error for cases that *cannot* fail. Adding an unused error return inflates every call site.

---

## 6. `Make` constructors (variants)

Go has historical naming convention: `MakeX` for *value* constructors, `NewX` for *pointer* constructors. The stdlib uses both:

```go
// flag package
fs := flag.NewFlagSet("myapp", flag.ExitOnError)   // returns *FlagSet

// Make-style — returns a value
url, _ := url.Parse("https://...")  // returns *URL too
strs := strings.NewReplacer("a", "b")  // returns *Replacer
```

In practice, the `Make` prefix is *almost gone* from modern Go. `make` is a built-in for slices/maps/channels. User-defined types use `New` regardless of whether they return pointer or value.

Exception: `make` itself is *the* factory for built-in composite types — `make(map[string]int)`, `make([]int, 10)`, `make(chan int, 100)`. It's a factory in disguise.

---

## 7. Type-selecting factory

The most useful "Factory pattern" in idiomatic Go: a function that picks which concrete type to return based on input.

```go
// image package
func Decode(r io.Reader) (Image, string, error) {
    // detect format by reading magic bytes
    // call the right decoder (gif, jpeg, png, ...)
    // return the resulting Image (interface)
}
```

The caller passes an `io.Reader`; the factory reads the format magic bytes, dispatches to the right decoder, and returns an `Image` (interface). The concrete type (`*image.NRGBA`, `*image.RGBA`, etc.) is hidden.

A simpler example:

```go
type Storage interface {
    Get(id string) ([]byte, error)
    Put(id string, data []byte) error
}

func NewStorage(kind string, config Config) (Storage, error) {
    switch kind {
    case "memory":
        return &memoryStorage{}, nil
    case "disk":
        return &diskStorage{path: config.Path}, nil
    case "s3":
        return newS3Storage(config.S3), nil
    default:
        return nil, fmt.Errorf("NewStorage: unknown kind %q", kind)
    }
}
```

The factory's signature is `(string, Config) → (Storage, error)`. The caller doesn't know there are three implementations; they get one back.

### 7.1 When this shape pays off

- The implementation is selected at runtime (config file, CLI flag, environment).
- All implementations satisfy a single interface.
- Adding a new implementation means adding one `case` to the switch (or registering, see middle.md).
- Callers want to write code that's storage-agnostic.

### 7.2 Anti-pattern: the eager factory

```go
func NewStorage(kind string) (Storage, error) {
    s3 := newS3Storage(...)     // always constructed
    disk := newDiskStorage(...) // always constructed
    mem := newMemoryStorage()   // always constructed
    switch kind {
    case "s3": return s3, nil
    case "disk": return disk, nil
    case "memory": return mem, nil
    }
    return nil, errors.New("unknown")
}
```

This eagerly constructs *all* implementations, then picks one. If S3 connection fails, the factory fails even when the user wanted disk storage. Construct only what you return.

---

## 8. Abstract Factory in Go

In the GoF book, Abstract Factory is a *family* of related factories. In Go, it's usually:

```go
type Storage interface {
    NewReader(id string) (io.Reader, error)
    NewWriter(id string) (io.Writer, error)
}

type s3Storage struct{ /* ... */ }
func (s *s3Storage) NewReader(id string) (io.Reader, error) { /* ... */ }
func (s *s3Storage) NewWriter(id string) (io.Writer, error) { /* ... */ }

type diskStorage struct{ /* ... */ }
func (d *diskStorage) NewReader(id string) (io.Reader, error) { /* ... */ }
func (d *diskStorage) NewWriter(id string) (io.Writer, error) { /* ... */ }
```

`Storage` is an *abstract factory* — its `NewReader`/`NewWriter` produce concrete `io.Reader`/`io.Writer`. The concrete factory (`s3Storage` or `diskStorage`) determines which family of products you get. Both implementations live in the same package family.

Real stdlib example: `*sql.DB` is an abstract factory:

```go
db, _ := sql.Open("postgres", dsn)  // gives you a *sql.DB
stmt, _ := db.Prepare(...)          // *sql.Stmt (produced by db)
rows, _ := db.Query(...)            // *sql.Rows (produced by db)
tx, _   := db.Begin()               // *sql.Tx (produced by db)
```

`*sql.DB.Query` doesn't construct `*sql.Rows` directly — it delegates to the underlying driver (postgres, mysql, etc.). The `*sql.DB` itself is a *family of constructors*, one per related product.

In application code, you rarely write this from scratch. When you do, the trigger is usually: "I have several related types that must be constructed consistently". E.g., a `*Tracer` that produces `*Span`, `*Counter`, `*Histogram` — all from the same backend (Prometheus, Datadog, OpenTelemetry).

---

## 9. Factory in the standard library

A non-exhaustive list:

| Where | Type of factory | What it does |
|-------|-----------------|--------------|
| `bufio.NewReader(r)` | New | Wraps a Reader with buffering |
| `bytes.NewBuffer(b)` | New | Constructs a buffer over a byte slice |
| `strings.NewReader(s)` | New | Adapts a string to io.Reader |
| `image.Decode(r)` | Type-selecting | Picks decoder based on magic bytes |
| `sql.Open(driver, dsn)` | Type-selecting + Abstract | Opens a driver-specific *sql.DB |
| `crypto/tls.Listen(...)` | New | Wraps a net.Listener with TLS |
| `flag.NewFlagSet(name, ...)` | New | Constructs a flag set |
| `template.New(name)` | New | Constructs an unparsed template |
| `regexp.MustCompile(pattern)` | New (panics on error) | Constructs a compiled regex |
| `regexp.Compile(pattern)` | New | Same but returns error |
| `time.NewTicker(d)` | New | Constructs a ticker |
| `context.WithTimeout(parent, d)` | Decorator/factory hybrid | Constructs a derived context |
| `make(chan int, n)` | Built-in factory | Constructs a channel |

Read `bufio.NewReader` in the source. It's a 5-line function:

```go
// from bufio
func NewReader(rd io.Reader) *Reader {
    return NewReaderSize(rd, defaultBufSize)
}

func NewReaderSize(rd io.Reader, size int) *Reader {
    b, ok := rd.(*Reader)
    if ok && len(b.buf) >= size {
        return b
    }
    r := new(Reader)
    r.reset(make([]byte, max(size, minReadBufferSize)), rd)
    return r
}
```

`NewReader` delegates to `NewReaderSize`. The latter:

- Checks if `rd` is *already* a `*bufio.Reader` with enough buffer — if so, *returns it as-is* (no nested buffering).
- Otherwise allocates a new one with the requested buffer size.

That's a real factory. It picks the right thing to return based on input. Simple, readable, useful.

---

## 10. Factory vs Builder vs functional options

Three patterns for "constructing a complex thing". Picking between them.

| Pattern | When |
|---------|------|
| **Factory function** | One-shot construction with no per-instance variation in *which* fields are set. |
| **Functional options** | Many *independent* configuration fields, most with defaults. |
| **Builder** | Multi-phase construction with validation between steps, or genuinely sequential composition (SQL, AST). |

A typical evolution:

1. Start with `NewServer(addr string)`. One required arg.
2. Need a logger too → add a parameter, or add `NewServerWithLogger`. Telescoping starts.
3. Need 5 more knobs → switch to functional options: `NewServer(addr, opts...)`.
4. Need multi-step construction (parse → validate → connect) → switch to builder.

Factories with options are *the* default for non-trivial constructors. Builders are reserved for cases where the steps must be visible (SQL query construction, AST building).

---

## 11. When NOT to use a factory

Three cases where a bare struct literal is fine:

### 11.1 The type has no defaults, validation, or dependencies

```go
type Point struct{ X, Y int }

// Don't bother:
// func NewPoint(x, y int) Point { return Point{X: x, Y: y} }
```

`Point{X: 3, Y: 4}` is clear, idiomatic, and shorter than `NewPoint(3, 4)`. A factory adds noise.

### 11.2 Internal types

If a struct is unexported and only constructed in two places within the same package, a factory adds indirection without payoff. Construct directly.

### 11.3 The factory would have the same signature as the literal

```go
func NewUser(name, email string) User {
    return User{Name: name, Email: email}
}
```

Versus `User{Name: name, Email: email}`. Both express the same intent. The factory wins only if it *adds* something (defaults, validation, computed fields).

Add a factory the moment construction *gains* complexity. Don't add it speculatively.

---

## 12. Common mistakes a junior makes

### 12.1 Factory that returns the interface always

```go
func NewSQLStorage(...) Storage {  // returns interface
    return &sqlStorage{...}
}
```

Callers who need `*sqlStorage`-specific methods (e.g., `Stats()`) lose access. They'd have to type-assert. Default: return the concrete type. Let consumers convert to interface at *their* assignment site.

### 12.2 Factory that does I/O without telling the caller

```go
func NewClient(apiKey string) *Client {
    c := &Client{apiKey: apiKey}
    c.ping()  // network call hidden inside constructor
    return c
}
```

Callers don't know the constructor blocks on a network round-trip. If the network is down, every test that uses `NewClient` hangs. Defer I/O to first use or expose `Connect(ctx)` separately.

### 12.3 Factory that returns a pre-constructed singleton

```go
var defaultClient = &Client{...}

func NewClient() *Client { return defaultClient }  // !
```

Two callers share state. Mutating one affects the other. If you genuinely want a singleton, name it that way:

```go
func Default() *Client { return defaultClient }
```

Use `New` for fresh instances; `Default` (or `Instance`) for shared ones.

### 12.4 Factory naming `Create<X>`, `Build<X>`, `Construct<X>`

Idiomatic Go uses `New<X>` (or `Make<X>` for rare value-returning cases). `Create`, `Build`, and `Construct` look like Java/C++. They aren't wrong, but they read awkwardly to a Go reviewer. Stick with `New` unless there's a strong local convention.

### 12.5 Factory that doesn't return the error it generates

```go
func NewServer(addr string) *Server {
    if addr == "" {
        log.Println("addr is empty, using default")
        addr = ":8080"
    }
    return &Server{addr: addr}
}
```

A log line is no substitute for a returned error. If the caller passed a bad argument, *tell them via the return*. They can decide whether to fall back to a default or fail.

---

## 13. Tricky points

### 13.1 Factory that returns `(T, error)` vs `(*T, error)`

For pointer-to-struct types, the canonical signature is `(*T, error)`. For value types (small, immutable), `(T, error)` is fine. Mixing is confusing — pick one per type and stick with it.

### 13.2 Factory holding a closure over a parameter

```go
func NewLogger(prefix string) func(string) {
    return func(msg string) {
        fmt.Println(prefix + ": " + msg)
    }
}
```

This is a factory returning a *function*. The closure captures `prefix`. Useful when the "thing" you're constructing has only one operation. (For more, return a struct.)

### 13.3 Factory in a package: exported constructor, unexported struct

```go
package storage

type sqlStorage struct{ /* ... */ }   // unexported

func NewSQL(dsn string) *sqlStorage { /* ... */ }  // returns unexported type
```

Linters often warn here ("exported function returns unexported type"). Two fixes:

1. Export `SQLStorage` (the struct).
2. Return an interface (`func NewSQL(dsn string) Storage`).

Decide by whether callers need the concrete type's methods.

### 13.4 Multiple factories for the same type

```go
func NewServer(addr string) *Server
func NewServerFromConfig(cfg Config) (*Server, error)
func NewServerForTest() *Server
```

Common when you have several ways to construct. Each documents a different input shape. Keep their bodies *consistent* — same defaults, same validation. Otherwise behaviour drifts between paths.

---

## 14. Quick test

**Q1.** Which is the better factory signature?

```go
// A
func NewClient(apiKey string) *Client { ... }

// B
func NewClient(apiKey string) Client { ... }

// C
func NewClient(apiKey string) Iface { ... }
```

<details><summary>Answer</summary>

A. Pointer to struct is the default for types with state and methods.

B (value) works for small immutable types but is unusual for "client" types that typically hold state (connection pools, etc.).

C (interface) hides the concrete type — if `*Client` has helpful methods beyond `Iface`, callers lose access.
</details>

**Q2.** What's wrong here?

```go
func NewService() *Service {
    db, err := sql.Open("postgres", os.Getenv("DSN"))
    if err != nil {
        log.Fatal(err)
    }
    return &Service{db: db}
}
```

<details><summary>Answer</summary>

Three problems:

1. **`log.Fatal` in a constructor.** The factory crashes the process. Callers (especially tests) have no chance to handle the error.
2. **Reading env vars inside the constructor.** Hidden dependency on `DSN`. Tests must set it; CI must export it. Pass `dsn` as a parameter instead.
3. **No error return.** Construction can fail (database unreachable, bad DSN); the signature must say so: `(*Service, error)`.

Fix: `func NewService(dsn string) (*Service, error) { /* ... */ }`. Caller provides the DSN explicitly; errors come back as values.
</details>

**Q3.** Factory or struct literal?

```
A `Color` type with `R`, `G`, `B`, `A` fields.
```

<details><summary>Answer</summary>

Struct literal. `Color{R: 255, G: 0, B: 0, A: 255}` is clear, no defaults needed, no validation. A factory `NewColor(r, g, b, a uint8) Color` would add no information.

Add a factory only if construction grows complexity — e.g., `NewColorFromHex(hex string) (Color, error)`.
</details>

---

## 15. Cheat sheet

| Goal | Approach |
|------|----------|
| Simple construction with defaults | `New<T>(args) *T` |
| Can fail | `New<T>(args) (*T, error)` |
| Choose concrete type at runtime | `New<T>(kind string, ...) (Iface, error)` |
| Multiple ways to construct | `NewX`, `NewXFromY`, `NewXForTest` |
| Closure over config | `NewX(cfg) func(args) result` |
| Singleton accessor | `Default()` or `Instance()` — NOT `New` |
| Returning interface | Only when the concrete type adds nothing useful |
| Validation / I/O | Defer I/O to first use; validate in the constructor |
| Name | `New<T>`, not `Create`/`Build`/`Construct` |

---

## 16. What to learn next

In order:

1. **[middle.md](middle.md)** — Factories with registries, deferred construction, factory functions as first-class values, lazy initialisation, generic factories.
2. **[../01-functional-options/](../01-functional-options/)** — When the factory has many configuration knobs.
3. **[../02-builder-pattern/](../02-builder-pattern/)** — When the factory has multi-step construction.
4. **[../08-singleton-pattern/](../08-singleton-pattern/)** — When the factory caches its result.

The Factory pattern in Go is *embedded* in the language idioms — every `New<T>` is one. The skill is recognising when a *non-trivial* factory shape (type-selecting, registry-based, abstract family) is needed vs when a plain constructor or struct literal is enough.
