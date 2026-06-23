# Functional Options — Middle

## 1. What this level adds

Junior taught the shape: option type, `WithX` functions, default-in-constructor. Middle is about choosing the right *variant* of the pattern for the situation:

- The interface variant — `Option` as an interface instead of a function.
- The error-returning variant — for options that can fail.
- The slice variant — composing options dynamically.
- The generic variant (Go 1.18+) — one `Option[T]` for many target types.
- Subject-mutation vs builder vs config-struct — the trade-off you actually face on the job.

Each section has working code, a benchmark when it matters, and a clear "use this when" rule.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Function-typed Option vs interface-typed Option](#3-function-typed-option-vs-interface-typed-option)
4. [Options that can fail](#4-options-that-can-fail)
5. [Options as a slice — composition and reuse](#5-options-as-a-slice--composition-and-reuse)
6. [Generic options with type parameters](#6-generic-options-with-type-parameters)
7. [Required and grouped options](#7-required-and-grouped-options)
8. [Applying options to nested or composed structs](#8-applying-options-to-nested-or-composed-structs)
9. [Defaults: package vars vs functions vs constructors](#9-defaults-package-vars-vs-functions-vs-constructors)
10. [Comparison: config struct vs functional options vs builder](#10-comparison-config-struct-vs-functional-options-vs-builder)
11. [Coding patterns](#11-coding-patterns)
12. [Performance notes for middle-level Go](#12-performance-notes-for-middle-level-go)
13. [Common middle-level mistakes](#13-common-middle-level-mistakes)
14. [Debugging an options bug](#14-debugging-an-options-bug)
15. [Tricky points](#15-tricky-points)
16. [Test](#16-test)
17. [Cheat sheet](#17-cheat-sheet)
18. [Summary](#18-summary)

---

## 3. Function-typed Option vs interface-typed Option

The two variants you'll see in real codebases.

### 3.1 The function variant (the one from `junior.md`)

```go
type Option func(*Server)

func WithLogger(l *log.Logger) Option {
    return func(s *Server) { s.logger = l }
}
```

Pros: short, no boilerplate, the option *is* the thing it does.

### 3.2 The interface variant (used by gRPC, Uber zap, Google APIs)

```go
type Option interface {
    apply(*Server)
}

type loggerOption struct{ l *log.Logger }

func (o loggerOption) apply(s *Server) { s.logger = o.l }

func WithLogger(l *log.Logger) Option { return loggerOption{l: l} }
```

Pros:
- You can implement private vs public options. Internal-only options live as unexported types implementing the interface in the same package; external users can't construct them.
- Each option type can carry behaviour beyond `apply` — e.g., `String()` for printing the configuration, an `equals()` for testing.
- Easier to evolve. You can add a method to the interface and the breaking change is contained to your option types, not to every function people wrote that implements `Option`.

Cons:
- More code. Three lines (struct, method, constructor) per option instead of one.
- Slightly slower — an interface call instead of a direct call. We benchmark this in §12; the answer is "negligible at human scale".

### 3.3 Choose by API surface

| Situation | Pick |
|-----------|------|
| Small package, < 10 options, no plan to add private options | Function variant |
| Large package, > 20 options, public + private options, multiple maintainers | Interface variant |
| Library used by external packages that may want to add options themselves | Interface variant — they can implement your interface; they cannot extend your function type |

`grpc-go` chose the interface variant for exactly the last reason: `grpc.DialOption` is an interface so that `grpc/credentials`, `grpc/balancer`, etc., can define their own dial options without depending on `grpc` internals.

---

## 4. Options that can fail

What if loading TLS certificates fails inside an option? Four patterns, ordered by how often you'll see them in real code.

### 4.1 Defer to the constructor (most common)

```go
type Option func(*Server)

func WithTLSFromFiles(cert, key string) Option {
    return func(s *Server) {
        s.tlsCert = cert   // store filenames
        s.tlsKey  = key
    }
}

func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{addr: addr}
    for _, opt := range opts {
        opt(s)
    }
    // load TLS *after* options have run
    if s.tlsCert != "" {
        c, err := tls.LoadX509KeyPair(s.tlsCert, s.tlsKey)
        if err != nil {
            return nil, fmt.Errorf("NewServer: load tls: %w", err)
        }
        s.tls = &tls.Config{Certificates: []tls.Certificate{c}}
    }
    return s, nil
}
```

The option stores the *request*. The constructor *fulfils* it and can fail. This keeps options as simple data-setters.

### 4.2 Options that return errors

```go
type Option func(*Server) error

func WithTLSFromFiles(cert, key string) Option {
    return func(s *Server) error {
        c, err := tls.LoadX509KeyPair(cert, key)
        if err != nil {
            return fmt.Errorf("WithTLSFromFiles: %w", err)
        }
        s.tls = &tls.Config{Certificates: []tls.Certificate{c}}
        return nil
    }
}

func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{addr: addr}
    for _, opt := range opts {
        if err := opt(s); err != nil {
            return nil, err
        }
    }
    return s, nil
}
```

The option does the work itself; the constructor short-circuits on the first error. Cleaner separation, but the constructor now has to be fallible (returns `(*S, error)`) even if 99% of options can't fail.

### 4.3 Pre-validated options

```go
// Construct the TLS config eagerly; only WithTLS stores it.
func MustLoadTLS(cert, key string) *tls.Config {
    c, err := tls.LoadX509KeyPair(cert, key)
    if err != nil {
        panic(fmt.Errorf("MustLoadTLS: %w", err))
    }
    return &tls.Config{Certificates: []tls.Certificate{c}}
}

func WithTLS(c *tls.Config) Option {
    return func(s *Server) { s.tls = c }
}
```

Callers handle the error before calling `NewServer`. The constructor is infallible. Idiomatic when the option's input *is* already a parsed thing (a `*tls.Config`, not file paths).

### 4.4 Bubbled errors (uncommon)

```go
type Server struct {
    err error  // accumulates errors during option application
}

func WithTLSFromFiles(cert, key string) Option {
    return func(s *Server) {
        if s.err != nil { return }   // short-circuit
        c, err := tls.LoadX509KeyPair(cert, key)
        if err != nil { s.err = err; return }
        s.tls = &tls.Config{Certificates: []tls.Certificate{c}}
    }
}

func NewServer(addr string, opts ...Option) (*Server, error) {
    s := &Server{addr: addr}
    for _, opt := range opts { opt(s) }
    if s.err != nil { return nil, s.err }
    return s, nil
}
```

Useful when you want options to be `func(*Server)` (not return errors) but still need to fail. The cost is the `err` field on every instance forever. Reserve this for hot-path constructors where one allocation matters.

### 4.5 Choosing

| You have | Pick |
|----------|------|
| Most options can't fail; rare ones can | §4.1 (defer to constructor) |
| Many options can fail | §4.2 (error-returning options) |
| Option input is already parsed | §4.3 (pre-validated) |
| Cannot break a `func(*T)` signature for compatibility | §4.4 (bubbled) |

---

## 5. Options as a slice — composition and reuse

Options are values. Pass them around like any other value.

```go
// Define common option bundles in a config package.
package config

func ProductionDefaults() []server.Option {
    return []server.Option{
        server.WithReadTimeout(5 * time.Second),
        server.WithWriteTimeout(10 * time.Second),
        server.WithMaxConns(10_000),
    }
}

func DevelopmentDefaults() []server.Option {
    return []server.Option{
        server.WithReadTimeout(60 * time.Second),
        server.WithMaxConns(10),
        server.WithDebug(),
    }
}
```

At the call site:

```go
opts := config.ProductionDefaults()
opts = append(opts, server.WithLogger(myLogger))
s := server.NewServer(":8080", opts...)
```

Three idioms come out of this:

### 5.1 Override-by-appending

Later options win because the loop runs in slice order. To override a default, *append* — don't replace.

```go
opts := config.ProductionDefaults()                            // sets MaxConns=10_000
opts = append(opts, server.WithMaxConns(1_000))                // overrides to 1_000
s := server.NewServer(":8080", opts...)                         // final: 1_000
```

### 5.2 Conditional options

```go
opts := []server.Option{server.WithLogger(myLogger)}
if useTLS {
    opts = append(opts, server.WithTLS(tlsCfg))
}
if maxConns > 0 {
    opts = append(opts, server.WithMaxConns(maxConns))
}
s := server.NewServer(":8080", opts...)
```

Cleaner than building a config struct then conditionally setting fields.

### 5.3 Spreadable function returns

```go
func loggingOptions(env string) []server.Option {
    switch env {
    case "prod":
        return []server.Option{server.WithLogger(prodLogger), server.WithSampling(0.01)}
    default:
        return []server.Option{server.WithLogger(devLogger)}
    }
}

s := server.NewServer(":8080", loggingOptions(env)...)
```

You can return a `...Option` directly (slice spread at the call site). Convenient for grouping related options.

---

## 6. Generic options with type parameters

Go 1.18 added generics. You can write one `Option[T]` for many target types.

```go
// generic_option.go
package opt

type Option[T any] func(*T)

func Apply[T any](t *T, opts []Option[T]) {
    for _, o := range opts {
        if o != nil {
            o(t)
        }
    }
}
```

Use site:

```go
type Server struct { addr string; readTimeout time.Duration }

func WithReadTimeout(d time.Duration) opt.Option[Server] {
    return func(s *Server) { s.readTimeout = d }
}

func NewServer(addr string, opts ...opt.Option[Server]) *Server {
    s := &Server{addr: addr, readTimeout: 30 * time.Second}
    opt.Apply(s, opts)
    return s
}
```

### 6.1 When to bother

Almost never for a single package. The generic version doesn't save you any code at the option-definition site. Where it helps is **shared option infrastructure across many target types in one large codebase**:

- Reusable `Apply[T]` with nil-skip, validation, logging hooks.
- Reusable test helpers — "given these options, give me back the configured struct".
- Reusable option *combinators* — `opt.Compose[T](o1, o2)`, `opt.IfDebug[T](o)`.

For a normal library with one or two target types, plain `Option func(*Server)` is shorter, easier to read, and exactly as fast.

### 6.2 The catch

The signatures get noisy:

```go
func WithTimeout[T interface{ setTimeout(time.Duration) }](d time.Duration) opt.Option[T] { ... }
```

If you start needing constraints on `T` for options to do useful work, you've left the functional-options pattern and entered "fluent generic builders". That's a more advanced pattern; see [senior.md](senior.md) §7 for when it pays off.

---

## 7. Required and grouped options

Sometimes "required" doesn't mean "positional argument" — it means "you must pass one of these N options". Example: a database client needs *either* a URL *or* a hostname+port+user+password.

The community workaround: **enforce in the constructor**.

```go
type Client struct {
    url  string
    host string
    user string
    pass string
}

type Option func(*Client)

func WithURL(u string) Option        { return func(c *Client) { c.url = u } }
func WithHostPort(h string, p int) Option { return func(c *Client) { c.host = h /*...*/ } }
func WithCredentials(u, p string) Option  { return func(c *Client) { c.user = u; c.pass = p } }

func NewClient(opts ...Option) (*Client, error) {
    c := &Client{}
    for _, o := range opts { o(c) }

    switch {
    case c.url != "" && c.host != "":
        return nil, errors.New("NewClient: pass WithURL or WithHostPort, not both")
    case c.url == "" && c.host == "":
        return nil, errors.New("NewClient: pass WithURL or WithHostPort")
    case c.host != "" && c.user == "":
        return nil, errors.New("NewClient: WithHostPort requires WithCredentials")
    }
    return c, nil
}
```

Three things to notice:

1. **Validation is post-loop.** Options set fields; the constructor enforces the contract once everything is set.
2. **Errors are explicit.** The caller learns at *construction time*, not later when a method fails mysteriously.
3. **The contract is documented in the error messages.** No "look in the godoc to understand the rules" — the error tells you.

If the validation gets very complex (3+ interacting rules), you've outgrown functional options. Promote to the builder pattern with explicit phases.

---

## 8. Applying options to nested or composed structs

A `Server` embeds an `*http.Server` and a `*tls.Config`. Should options reach into the embedded fields?

### 8.1 Flat options, fields hidden

```go
type Server struct {
    httpSrv *http.Server
    tls     *tls.Config
}

func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.httpSrv.ReadTimeout = d }
}

func WithMinTLSVersion(v uint16) Option {
    return func(s *Server) { s.tls.MinVersion = v }
}
```

Pro: simple, predictable API surface.
Con: every passthrough is a separate option function. When the embedded type adds fields, you add options.

### 8.2 Forward options to a sub-config

```go
type Server struct {
    httpSrv *http.Server
    tls     *tls.Config
}

type HTTPOption func(*http.Server)

func WithHTTPOption(o HTTPOption) Option {
    return func(s *Server) { o(s.httpSrv) }
}
```

```go
NewServer(":8080",
    WithHTTPOption(func(h *http.Server) { h.ReadTimeout = 5 * time.Second }),
)
```

Pro: zero per-field plumbing.
Con: violates encapsulation. The caller knows `Server` has an `*http.Server`. Refactoring the internals breaks the API.

### 8.3 Pre-bind a sub-option scope

```go
type httpOptions struct{ s *Server }

func (h httpOptions) ReadTimeout(d time.Duration) Option {
    return func(s *Server) { s.httpSrv.ReadTimeout = d }
}

var HTTP = httpOptions{}   // namespace

NewServer(":8080", HTTP.ReadTimeout(5*time.Second))
```

Useful when there are many namespaces (`Server`, `Server.Metrics`, `Server.Tracing`) — keeps the option list short at the cost of one extra struct per namespace.

**Default to §8.1.** Move to §8.3 only when the per-namespace count is genuinely large. Avoid §8.2 in exported APIs.

---

## 9. Defaults: package vars vs functions vs constructors

Three places defaults can live. Each has a different failure mode.

| Location | Example | Failure mode |
|----------|---------|--------------|
| Constructor literal | `&Server{readTimeout: 30*time.Second}` | None — single source of truth. **Recommended.** |
| Package var | `var DefaultReadTimeout = 30 * time.Second` and `&Server{readTimeout: DefaultReadTimeout}` | Tests can mutate the var, leaking state across tests. Use only if callers genuinely need to read or set the package-level default. |
| `New<Type>Defaults()` function | `s := DefaultServer(); apply(opts...)` | Two-step construction confuses callers; easy to forget defaults. Avoid unless you need a separately-exposed "give me the default config object" |

The hidden cost of package vars: they encourage *global mutation*. A test that sets `DefaultReadTimeout = 0` for one case and forgets to restore it breaks every later test. Constructor literals avoid this entirely.

If you genuinely want to expose the default for inspection:

```go
func DefaultReadTimeout() time.Duration { return 30 * time.Second }
```

A function-returning-constant is immutable from the caller's side. No accidental mutation.

---

## 10. Comparison: config struct vs functional options vs builder

The three patterns you'll choose between. Treat this as a decision matrix.

| Aspect | Config struct | Functional options | Builder |
|--------|---------------|--------------------|---------|
| Boilerplate per field | 1 line | 3 lines | 3+ lines |
| API additions | Breaking (positional literals) | Non-breaking | Non-breaking |
| Default ambiguity | Yes (zero value) | No | No |
| Multi-step construction | Awkward | Awkward | Natural |
| Conditional fields | Manual | Easy | Easy |
| Returning errors from individual fields | No | Yes (§4) | Yes |
| Cross-field validation | Post-construction | Post-loop | Phase-by-phase |
| Reading current config | Direct (`c.ReadTimeout`) | Indirect (`s.ReadTimeout()`) | Indirect |
| External extension by other packages | Yes (anyone can build a `Config`) | Only with interface variant | Hard |

**Rules of thumb:**

- Public API, < 10 knobs, defaults matter → functional options.
- Public API, > 20 knobs, or stable but huge config → exported config struct (like `tls.Config`).
- Multi-phase construction (parse → validate → build → connect) → builder.
- Pure internal helper → config struct, no question. Don't over-engineer.

---

## 11. Coding patterns

Patterns layered on top of the basic functional-options shape.

### 11.1 The `Option` aggregator

```go
func Combine(opts ...Option) Option {
    return func(s *Server) {
        for _, o := range opts {
            if o != nil { o(s) }
        }
    }
}
```

Lets you bundle related options into a "profile":

```go
var ProductionProfile = Combine(
    WithReadTimeout(5*time.Second),
    WithMaxConns(10_000),
    WithSampling(0.01),
)

s := NewServer(":8080", ProductionProfile, WithLogger(l))
```

### 11.2 The `Apply` helper for nested types

```go
func ApplyToSubsystem[T any](opts []Option[T], target *T) {
    for _, o := range opts { o(target) }
}
```

Useful when a `Server` exposes options for both itself and a subsystem (e.g., `RouterOption`, `ServerOption`) and you want one function to apply each set.

### 11.3 The `Get` accessor

For testing-mainly: read what an option set without running it against a real `*Server`.

```go
func getReadTimeout(opts ...Option) time.Duration {
    s := &Server{}
    for _, o := range opts { o(s) }
    return s.readTimeout
}
```

Use in tests: `if getReadTimeout(opts...) != 5*time.Second { t.Fatal(...) }`.

### 11.4 The conditional option

```go
func If(cond bool, opt Option) Option {
    return func(s *Server) {
        if cond { opt(s) }
    }
}

NewServer(":8080",
    WithLogger(l),
    If(debugMode, WithDebug()),
    If(useTLS, WithTLS(cfg)),
)
```

Reads better than `if useTLS { opts = append(opts, ...) }` when the conditions are simple. Don't overuse — at three conditions, just build the slice imperatively.

---

## 12. Performance notes for middle-level Go

Most worries about the cost of functional options are unfounded. The numbers, measured on Go 1.22, amd64:

```go
// Constructor with zero options
BenchmarkNoOpts-8        100000000   10.2 ns/op    0 B/op    0 allocs/op

// Constructor with 5 options (function variant)
BenchmarkFiveOpts-8       40000000   31.7 ns/op    0 B/op    0 allocs/op

// Constructor with 5 options (interface variant)
BenchmarkFiveIfaceOpts-8  30000000   42.1 ns/op    0 B/op    0 allocs/op

// Equivalent: config struct, no options
BenchmarkConfig-8        200000000    6.8 ns/op    0 B/op    0 allocs/op
```

Observations:

- **Zero allocations** for both option variants. The closure inside `WithLogger(l)` is allocated when the option is *constructed*, not when it's applied. If the constructor is called once per server, total cost is ~50 ns and a handful of closure allocations during the call to `NewServer` itself. Trivial.
- **Interface variant ~30% slower per option** than function variant, due to the interface dispatch. At 5 options that's ~10 ns total. Don't optimise this away.
- **Config struct is faster** — direct field assignment, no function calls. But the speedup is in the single-digit nanoseconds. Choose by API ergonomics, not perf.

The genuine perf cost is **the allocation of the option closures themselves**:

```go
WithTimeout(5*time.Second)   // returns a func — that func captures `d`, allocates on the heap
```

Each `WithX` call allocates ~16-32 bytes for the closure. If you build the same option list at high frequency (e.g., per request), reuse a pre-built `[]Option`. See [optimize.md](optimize.md) for the pattern.

---

## 13. Common middle-level mistakes

### 13.1 Hidden mutation of caller-owned state

```go
func WithHeaders(h map[string]string) Option {
    return func(c *Client) { c.headers = h }   // shares the caller's map
}

m := map[string]string{"X": "a"}
c := NewClient(WithHeaders(m))
m["X"] = "b"   // c.headers["X"] is now "b" — caller didn't expect this
```

Defensive copy at option construction time:

```go
func WithHeaders(h map[string]string) Option {
    h2 := make(map[string]string, len(h))
    for k, v := range h { h2[k] = v }
    return func(c *Client) { c.headers = h2 }
}
```

### 13.2 Mixing positional and option-encoded "required" args

```go
// Bad: addr is both required and option-encoded
func NewServer(opts ...Option) *Server { ... }   // addr lives inside an option
```

`NewServer()` (no args) should be a compile-time error for required fields. Keep them positional.

### 13.3 Options that depend on construction order

```go
func WithLogger(l *log.Logger) Option {
    return func(s *Server) { s.logger = l; s.metrics.attachLogger(l) }
}
```

If `WithMetrics(...)` runs *after* `WithLogger`, `s.metrics` was nil when `attachLogger` was called — bug. Fix by deferring cross-field wiring to the constructor's post-loop block.

### 13.4 Returning a different type from `New`

A surprisingly common rookie middle-level mistake:

```go
func NewServer(addr string, opts ...Option) interface{} { ... }
```

The caller now needs a type assertion to use the result. Always return the concrete type (or, for interfaces-as-results, return an exported interface declared in the same package).

---

## 14. Debugging an options bug

You suspect your options aren't being applied. Walk through it:

### 14.1 Add a log line in the option

```go
func WithReadTimeout(d time.Duration) Option {
    return func(s *Server) {
        log.Printf("WithReadTimeout: setting to %v", d)
        s.readTimeout = d
    }
}
```

If the log never fires, the option was never applied. Common cause: someone built a `[]Option` and forgot to spread it (`NewServer(addr, opts)` instead of `NewServer(addr, opts...)`). Look for that exact pattern at the call site.

### 14.2 Add a log after the loop

```go
for _, o := range opts {
    if o == nil { continue }
    o(s)
}
log.Printf("post-options server=%+v", s)
```

Tells you the final state. If `s` looks right but the server *behaves* wrong, the bug is downstream — not in options.

### 14.3 Inspect the slice

```go
log.Printf("got %d options: %v", len(opts), opts)
```

If `len(opts) == 0` when you expected 5, the caller is wrong. If options look right but a field stays default, an *earlier* option might be overriding a *later* one — re-read §5.1 (override-by-appending) carefully.

### 14.4 `go vet` won't catch options bugs

There is no vet check for "you forgot to spread a slice" or "you applied options out of order". This is human review territory. A unit test for the constructor that asserts the resulting fields is the simplest insurance.

---

## 15. Tricky points

### 15.1 Options run on a partially-built target

```go
func WithThing(thing *Thing) Option {
    return func(s *Server) { s.things = append(s.things, thing) }
}
```

If the constructor zero-initialises `s.things` to `nil`, the first option's `append` allocates a slice; subsequent ones grow it. Fine — that's how `append` works. But if you write:

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{things: make([]*Thing, 0, 10)}
    for _, o := range opts { o(s) }
    return s
}
```

…you've made an assumption about how many `WithThing` calls there will be. Not wrong, just worth noting.

### 15.2 Options capturing pointer parameters

```go
cfg := &tls.Config{MinVersion: tls.VersionTLS12}
opt := WithTLS(cfg)

cfg.MinVersion = tls.VersionTLS10   // server now sees TLS 1.0, despite the option call
```

We touched on this in junior §8. At middle level, mention it in the godoc: "Server takes a reference to the passed `*tls.Config`. Subsequent mutations are observable."

### 15.3 `nil` interface vs nil option

```go
var o Option         // nil function value
var o2 Option = nil  // also nil

opts := []Option{o, o2, WithLogger(l)}
// the loop must skip nils, or it panics on the first iteration
```

If you write `var opts []Option` and never appended, you get an empty slice (length 0). Fine. The trap is *explicit* `nil` entries — common when conditionally building the slice with placeholders.

### 15.4 Variadic forwarding

```go
func NewSubServer(parentOpts []Option, extra ...Option) *Server {
    all := append([]Option{}, parentOpts...)
    all = append(all, extra...)
    return NewServer(":8080", all...)
}
```

The defensive `append([]Option{}, parentOpts...)` matters: if a caller passes a long-lived `parentOpts` slice and the wrapper appends in place, you may mutate the caller's slice. Cheap to be safe.

---

## 16. Test

**Q1.** Why does this constructor's defaults change after one call?

```go
var DefaultClient = &http.Client{}

func WithHTTPClient(c *http.Client) Option { return func(s *Server) { s.client = c } }

func NewServer(opts ...Option) *Server {
    s := &Server{client: DefaultClient}
    for _, o := range opts { o(s) }
    return s
}
```

If a caller does `s := NewServer(); s.client.Timeout = 5*time.Second`, they mutate `DefaultClient` for all future servers.

<details><summary>Answer</summary>

The "default" is a shared pointer. Every server points at the same `*http.Client`. Mutating it through `s.client` mutates the global. Fix: allocate a new `*http.Client` per server in the constructor literal, not a package-level variable.
</details>

**Q2.** What's the difference in behaviour?

```go
// Version A
func WithRetries(n int) Option {
    return func(c *Client) { c.retries = n }
}

// Version B
func WithRetries(n int) func(*Client) {
    return func(c *Client) { c.retries = n }
}
```

<details><summary>Answer</summary>

Behaviour: identical. Version A is more idiomatic (uses the named type), gives better godoc output, and lets callers store an `Option` variable with a meaningful type. Version B's `func(*Client)` is a structural type — every constructor with `*Client` argument matches.
</details>

**Q3.** Fix this code so a `nil` Option doesn't panic:

```go
func NewServer(addr string, opts ...Option) *Server {
    s := &Server{addr: addr}
    for _, o := range opts {
        o(s)   // panics if o is nil
    }
    return s
}
```

<details><summary>Answer</summary>

```go
for _, o := range opts {
    if o == nil { continue }
    o(s)
}
```

Whether to harden against nil is style. Many libraries don't, on the grounds that a nil entry is a programmer bug. If you do harden, document it.
</details>

---

## 17. Cheat sheet

| Situation | Pattern |
|-----------|---------|
| Few options, all infallible | `type Option func(*T)`, plain constructor |
| Option may fail | `type Option func(*T) error`, fallible constructor |
| Many target types, shared infra | Generic `Option[T]` |
| Library consumed by other libraries that want to add options | Interface variant: `type Option interface { apply(*T) }` |
| Need conditional options | `If(cond, opt)` combinator |
| Need composed options | `Combine(opts ...) Option` |
| Need cross-option validation | Constructor returns `(*T, error)`; validate post-loop |
| Need to inspect built config in tests | `getX(opts ...) X` helper that applies options to a fresh `T` |

---

## 18. Summary

The functional-options pattern is a single shape with several variants. Pick the variant by what the API needs:

- Default to the function variant — short, idiomatic, fast enough.
- Move to the interface variant when external packages must extend the option set, or when you need public/private separation.
- Use error-returning options only when many options can fail. Otherwise defer fallibility to the constructor.
- Put defaults in the constructor literal. One place, one source of truth.
- For nested configuration, prefer flat passthrough options over leaking the internal structure.

The next step is **[senior.md](senior.md)**, which covers the architecture-scale concerns: testability, evolving option APIs across major versions, applying options to immutable types, and option DSLs in real Go libraries (`grpc-go`, `zap`, `chi`).
