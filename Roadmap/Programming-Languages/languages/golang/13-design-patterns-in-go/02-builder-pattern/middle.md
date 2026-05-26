# Builder Pattern — Middle

## 1. What this level adds

Junior taught the shape: a separate builder type, chained step methods, terminal `Build()`. Middle is about choosing the right *variant* for the situation:

- Fluent builders for genuinely multi-phase domains (SQL, HTTP, AST, IR construction).
- Generic builders that work for many target types.
- The Director / template pattern — when a builder needs orchestration on top of step methods.
- Reusable / forkable builders via the value-copy variant.
- Interop with functional options — the hybrid pattern many libraries use.
- Builder for *immutable* objects vs builder for mutable accumulators.

Each section has working Go, the trade-off, and a "use this when" rule. By the end you should know which shape any real-world API needs without guessing.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Fluent vs telescoping vs hybrid](#3-fluent-vs-telescoping-vs-hybrid)
4. [Reusable / forkable builders](#4-reusable--forkable-builders)
5. [Generic builders with type parameters](#5-generic-builders-with-type-parameters)
6. [The Director pattern — encapsulating common chains](#6-the-director-pattern--encapsulating-common-chains)
7. [Multi-terminal builders](#7-multi-terminal-builders)
8. [Builder ↔ functional options interop](#8-builder--functional-options-interop)
9. [Builders for immutable targets](#9-builders-for-immutable-targets)
10. [Validation strategies](#10-validation-strategies)
11. [Coding patterns](#11-coding-patterns)
12. [Performance — when allocation matters](#12-performance--when-allocation-matters)
13. [Common middle-level mistakes](#13-common-middle-level-mistakes)
14. [Debugging a builder chain](#14-debugging-a-builder-chain)
15. [Tricky points](#15-tricky-points)
16. [Test](#16-test)
17. [Cheat sheet](#17-cheat-sheet)
18. [Summary](#18-summary)

---

## 3. Fluent vs telescoping vs hybrid

Three flavours of "configuration assembly" you'll see in Go codebases. Recognise them by their call-site shape, not their internal type machinery.

### 3.1 Fluent (method chaining)

```go
sql, args, err := query.Select("id", "name").
    From("users").
    Where("active = ?", true).
    OrderBy("created_at DESC").
    Limit(100).
    Build()
```

The builder is a single object; each method returns it; the chain reads like a sentence. The hallmark is the `.` at the end of each line (or single-line for short chains).

### 3.2 Telescoping (multi-call accumulation)

```go
b := query.Select("id", "name")
b.From("users")
b.Where("active = ?", true)
b.OrderBy("created_at DESC")
b.Limit(100)
sql, args, err := b.Build()
```

Same builder, but the caller writes each step as a separate statement. Useful when steps are conditional:

```go
b := query.Select("id", "name").From("users")
if onlyActive {
    b.Where("active = ?", true)
}
if pageSize > 0 {
    b.Limit(pageSize)
}
sql, args, err := b.Build()
```

A fluent builder *also* supports this style. The chained API is a *display preference*, not a structural one. Most libraries support both transparently.

### 3.3 Hybrid: builder + functional options

```go
req, err := http.NewRequestBuilder("POST", "https://api.example.com/users").
    Header("Content-Type", "application/json").
    Body(payload).
    With(
        WithRetries(3),
        WithTimeout(5*time.Second),
        WithTracing(tracer),
    ).
    Build()
```

`With(...)` accepts a `...Option` slice, applied to the *builder* mid-chain. This lets the builder handle *structural* configuration (headers, body, method) and functional options handle *behavioural* configuration (retries, timeouts, tracing) — without forcing everything into one or the other.

Real example: `database/sql.OpenDB(connector)` takes a connector built by a builder, but the underlying driver is configured via DSN string + driver-specific options.

### 3.4 Decision

| Situation | Pick |
|-----------|------|
| Construction is genuinely sequential (verbs read in order) | Fluent |
| Many independent knobs | Functional options |
| Sequence + many knobs | Hybrid (`With(opts ...)`) |
| Imperative caller logic with conditionals | Either — both support telescoping |

A builder API that doesn't read like a sentence is probably wearing the wrong pattern.

---

## 4. Reusable / forkable builders

The pointer-receiver builder is single-use. If you genuinely need to fork — share a base configuration, then specialise — there are three patterns.

### 4.1 The factory function (simplest)

```go
func defaultQuery() *query.Builder {
    return query.Select("id", "name").
        From("users").
        Where("deleted_at IS NULL")
}

sqlActive, args, _ := defaultQuery().Where("active = ?", true).Build()
sqlAdmins, args, _ := defaultQuery().Where("role = ?", "admin").Build()
```

Wrap the shared prefix in a function. Each call returns a fresh builder. No copy semantics needed.

### 4.2 The `Clone()` method

```go
func (b *Builder) Clone() *Builder {
    c := *b                                       // shallow copy
    c.columns = append([]string(nil), b.columns...)  // deep-copy slices
    c.wheres  = append([]string(nil), b.wheres...)
    c.args    = append([]any(nil),    b.args...)
    return &c
}
```

Explicit `Clone()` lets callers fork:

```go
base := query.Select("id", "name").From("users").Where("active = ?", true)
prod := base.Clone().Limit(100)
test := base.Clone().Limit(10)
```

The deep-copy is the bit junior developers miss. A shallow copy shares the underlying slice header — appending to `prod.wheres` may mutate `test.wheres` if the original had spare capacity.

### 4.3 Value receivers (immutable builder)

```go
type Builder struct { /* ... */ }

func (b Builder) Where(cond string, args ...any) Builder {
    b.wheres = append(append([]string(nil), b.wheres...), cond)
    b.args   = append(append([]any(nil),    b.args...),   args...)
    return b
}
```

Every step copies. Forking is trivial — assignment is a fork. But every step allocates, and you pay that cost even for non-forked chains.

```go
base := query.Select("id", "name").From("users").Where("active = ?", true)
prod := base.Limit(100)           // base is unchanged
test := base.Limit(10)            // base is still unchanged
```

When you genuinely need forking and the chain is short, this is cleanest. For chains > 5 steps it gets expensive.

### 4.4 Decision

| Need | Pattern |
|------|---------|
| Many calls share a common prefix; no branching mid-chain | §4.1 factory function |
| Branching is rare but the base is expensive to build | §4.2 `Clone()` |
| Branching is common; allocations are acceptable | §4.3 value receivers |
| No branching ever | Plain pointer-receiver builder |

---

## 5. Generic builders with type parameters

Go 1.18+ lets you write a builder that abstracts over the target type. Two ways this is useful.

### 5.1 The accumulator pattern

```go
type Builder[T any] struct {
    apply []func(*T)
    err   error
}

func New[T any]() *Builder[T] { return &Builder[T]{} }

func (b *Builder[T]) With(f func(*T)) *Builder[T] {
    if b.err != nil { return b }
    b.apply = append(b.apply, f)
    return b
}

func (b *Builder[T]) Build() (*T, error) {
    if b.err != nil { return nil, b.err }
    var t T
    for _, f := range b.apply {
        f(&t)
    }
    return &t, nil
}
```

Usage:

```go
type Server struct{ addr string; timeout time.Duration }

srv, _ := New[Server]().
    With(func(s *Server) { s.addr = ":8080" }).
    With(func(s *Server) { s.timeout = 5 * time.Second }).
    Build()
```

This is basically functional options dressed as a builder. Useful as a building block for higher-level libraries; clumsy as an end-user API. The `func(*T)` argument is ugly.

### 5.2 The constrained-target pattern

```go
type Validator interface { Validate() error }

type Builder[T Validator] struct{ value T; err error }

func (b *Builder[T]) Build() (T, error) {
    if b.err != nil {
        var zero T
        return zero, b.err
    }
    if err := b.value.Validate(); err != nil {
        var zero T
        return zero, fmt.Errorf("Build: %w", err)
    }
    return b.value, nil
}
```

Every target type must satisfy `Validator`. The builder enforces validation in `Build()` without each target needing its own validator wiring. Useful for code-generated builders or DSL frameworks.

### 5.3 When to bother

Almost never for application code. The generic builder is a *library* tool — it lets *library authors* provide builder infrastructure for many target types. End users always know what they're building; they don't need `Builder[T]`.

---

## 6. The Director pattern — encapsulating common chains

When the same sequence of builder steps repeats across the codebase, factor it into a *director*.

```go
package query

// Director uses a Builder to construct domain-specific objects.
type Director struct{}

// CommonUserQuery applies the standard filter every "active users" query needs.
func (d *Director) CommonUserQuery(b *Builder) *Builder {
    return b.
        From("users").
        Where("deleted_at IS NULL").
        Where("verified_at IS NOT NULL")
}
```

Usage:

```go
d := &query.Director{}
sql, args, _ := d.CommonUserQuery(query.Select("id", "name")).
    Where("active = ?", true).
    Build()
```

The director's value is centralising "what every query needs". Changing the verification rule changes one place.

In Go this is often a *function* rather than a `Director` struct:

```go
func commonUserQuery(b *Builder) *Builder {
    return b.From("users").Where("deleted_at IS NULL")
}

sql, _, _ := commonUserQuery(query.Select("id", "name")).Where("active = ?", true).Build()
```

A struct buys you a method receiver. Use it only when there's state to attach (a tenant ID, a connection, a logger). For pure transformations, a free function is cleaner.

The Director is borrowed from the GoF Builder pattern, where it was a key player. In Go it's often unnecessary because *functions are first-class*. Don't introduce a `Director` because the book says so; introduce it only when state needs a home.

---

## 7. Multi-terminal builders

A builder with more than one terminal call.

```go
type Builder struct { /* ... */ }

// Build produces the configured Server.
func (b *Builder) Build() (*Server, error) { /* ... */ }

// Plan returns a description of what Build() would produce, without committing.
func (b *Builder) Plan() *ServerPlan { /* ... */ }

// SQL returns the assembled query as text — useful for logging or display.
func (b *Builder) SQL() string { /* ... */ }

// Explain runs EXPLAIN on the would-be query.
func (b *Builder) Explain(ctx context.Context, db *sql.DB) (string, error) { /* ... */ }
```

Real examples:

- `database/sql` query builders (squirrel, goqu) expose `.ToSql()` (string), `.Exec(...)` (run), `.Query(...)` (run and return rows).
- HTTP request builders (resty, req) expose `.Build()` (the `*http.Request`), `.Do()` (execute and return response), `.Get()`, `.Post()` etc. as shortcuts.

The rule: each terminal must be self-contained. `.Plan()` and `.Build()` shouldn't share mutation; if `Plan()` resolves placeholder values into the builder, `Build()` will see them and produce a different result the second time.

### 7.1 Idempotent terminals

```go
// Wrong — Plan mutates the builder
func (b *Builder) Plan() *ServerPlan {
    b.resolveDefaults()   // sets b.readTimeout if unset
    return &ServerPlan{ /* ... */ }
}
func (b *Builder) Build() (*Server, error) {
    b.resolveDefaults()   // already done — but Build doesn't know that
    /* ... */
}

// Right — Plan reads, Build reads-and-resolves
func (b *Builder) Plan() *ServerPlan {
    return &ServerPlan{readTimeout: b.resolvedReadTimeout()}  // pure read
}
func (b *Builder) Build() (*Server, error) {
    return &Server{readTimeout: b.resolvedReadTimeout()}, nil
}
```

The `b.resolvedReadTimeout()` helper computes the final value from inputs without mutating the builder. Every terminal calls it; results are consistent.

---

## 8. Builder ↔ functional options interop

Two ways to bridge the two patterns when you're stuck supporting both.

### 8.1 Options on the builder

```go
type Builder struct { /* ... */ }

type Option func(*Builder)

func (b *Builder) With(opts ...Option) *Builder {
    for _, o := range opts {
        if o != nil { o(b) }
    }
    return b
}

func WithRetries(n int) Option {
    return func(b *Builder) { b.retries = n }
}
```

Callers chain or pass options:

```go
b := NewBuilder().Addr(":8080")
b.With(WithRetries(3), WithTimeout(5*time.Second))
srv, _ := b.Build()
```

Useful when you have a stable set of "core" fields (set via builder methods) and a growing set of "advanced" options (passed via `With`). Adding a new advanced option is non-breaking.

### 8.2 A builder that produces a functional-options-configured object

```go
type Server struct { /* ... */ }
type ServerOption func(*Server)

func WithReadTimeout(d time.Duration) ServerOption {
    return func(s *Server) { s.readTimeout = d }
}

type Builder struct {
    addr string
    opts []ServerOption
}

func NewBuilder() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) *Builder { b.addr = a; return b }

func (b *Builder) Option(opt ServerOption) *Builder {
    b.opts = append(b.opts, opt)
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.addr == "" { return nil, errors.New("Addr required") }
    s := &Server{addr: b.addr, readTimeout: 30 * time.Second /* defaults */}
    for _, o := range b.opts { o(s) }
    return s, nil
}
```

The builder is the *interface*; functional options are the *mechanism*. You get builder ergonomics and the open-extension story of functional options.

### 8.3 When to bridge

- You're adding a builder to a package that *already* has functional options. Don't break callers.
- You're publishing a library where some configuration is structural (changes the object's shape) and some is behavioural (changes its behaviour).
- You're migrating between patterns and need a transition period.

If you're starting fresh, pick one. Mixing them looks rich on paper and confusing in practice.

---

## 9. Builders for immutable targets

Sometimes the *target* must be immutable — for example, a configuration that's frozen at startup, or a value object that participates in equality comparison. The builder is the *only* way to construct it.

```go
type ServerConfig struct {
    addr         string
    readTimeout  time.Duration
    writeTimeout time.Duration
}

// All fields unexported. No setters. The struct is constructed only via Builder.
func (c ServerConfig) Addr() string                  { return c.addr }
func (c ServerConfig) ReadTimeout() time.Duration    { return c.readTimeout }
func (c ServerConfig) WriteTimeout() time.Duration   { return c.writeTimeout }

type Builder struct {
    cfg ServerConfig
    err error
}

func NewBuilder() *Builder { return &Builder{} }

func (b *Builder) Addr(a string) *Builder {
    if b.err != nil { return b }
    if a == "" { b.err = errors.New("Addr: empty"); return b }
    b.cfg.addr = a
    return b
}

func (b *Builder) Build() (ServerConfig, error) {
    if b.err != nil { return ServerConfig{}, b.err }
    if b.cfg.addr == "" { return ServerConfig{}, errors.New("Addr required") }
    return b.cfg, nil   // return by value — caller can't mutate
}
```

Three things make this work:

1. **Target fields are unexported.** Callers can't construct `ServerConfig` directly.
2. **Builder is in the same package** as the target — needed for unexported field access.
3. **`Build()` returns by value**, not by pointer. The caller holds a copy; mutating it doesn't affect the builder's view.

Compared to a `*ServerConfig`: the value-return forces a copy at every boundary, which prevents aliasing bugs but costs allocations if the struct is large. Use this pattern when immutability matters more than allocation count.

---

## 10. Validation strategies

Three places validation can live. Each has its trade-offs.

### 10.1 Per-step validation (eager)

```go
func (b *Builder) Limit(n int) *Builder {
    if b.err != nil { return b }
    if n < 0 { b.err = errors.New("Limit: negative"); return b }
    b.limit = n
    return b
}
```

Pros: fails close to the source. The error message names the bad call. Easy to debug.
Cons: validation logic is scattered across step methods. Hard to express *cross-field* invariants (e.g., "Limit only meaningful with OrderBy").

### 10.2 Build-time validation (deferred)

```go
func (b *Builder) Limit(n int) *Builder {
    b.limit = n   // no check here
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.limit < 0 { return nil, errors.New("Build: limit must be >= 0") }
    /* cross-field checks */
    if b.limit > 0 && b.orderBy == "" {
        return nil, errors.New("Build: Limit without OrderBy")
    }
    return /* ... */
}
```

Pros: all validation in one place. Cross-field checks are natural.
Cons: error blames `Build`, not the bad step. Harder to localise the bug.

### 10.3 Hybrid (recommended)

Per-step validation for *intrinsic* errors (negative limit, empty string). Build-time validation for *combination* errors (missing required field, inconsistent settings).

```go
func (b *Builder) Limit(n int) *Builder {
    if b.err != nil { return b }
    if n < 0 { b.err = fmt.Errorf("Limit: negative (%d)", n); return b }  // intrinsic
    b.limit = n
    return b
}

func (b *Builder) Build() (*Server, error) {
    if b.err != nil { return nil, b.err }
    if b.addr == "" { return nil, errors.New("Build: Addr required") }   // combination
    if b.limit > 0 && b.orderBy == "" {                                  // combination
        return nil, errors.New("Build: Limit requires OrderBy")
    }
    return /* ... */, nil
}
```

The split keeps each kind of validation where it makes most sense.

### 10.4 What about a fluent `Validate()`?

```go
err := b.Validate()        // returns first violation
srv, _ := b.Build()        // assumes valid
```

Useful for *previewing* validation in a UI or CLI. But callers can always skip `Validate()` and go straight to `Build()`; both must be safe. Treat `Validate()` as a convenience, not a contract.

---

## 11. Coding patterns

### 11.1 The fluent extension

```go
// In the base package
type Builder struct { /* ... */ }

// In a downstream package — extend via a wrapper
type AdminBuilder struct{ *Builder }

func NewAdminBuilder() *AdminBuilder {
    return &AdminBuilder{Builder: NewBuilder()}
}

func (b *AdminBuilder) AsAdmin() *AdminBuilder {
    b.Builder.Where("role = ?", "admin")
    return b
}
```

The downstream `AdminBuilder` embeds `*Builder`. Calls to `b.Where(...)` flow through to the embedded builder. New methods (`AsAdmin`) chain on the wrapper. The trick: methods that return `*Builder` lose the `*AdminBuilder` type, breaking chains across the boundary. Document which methods are wrapper-safe.

### 11.2 The conditional step

```go
func (b *Builder) If(cond bool, f func(*Builder)) *Builder {
    if cond { f(b) }
    return b
}
```

```go
b := NewBuilder().Addr(":8080").
    If(useTLS, func(b *Builder) { b.UseTLS(cert, key) }).
    If(verbose, func(b *Builder) { b.Logger(l) }).
    Build()
```

Replaces `if useTLS { b.UseTLS(...) }` blocks. Whether this is cleaner is a style call; many Go developers prefer the explicit `if`.

### 11.3 The phase enforcement (via panic in dev)

```go
type Builder struct {
    phase int    // 0: init, 1: addr set, 2: opts set, 3: built
    /* ... */
}

func (b *Builder) Addr(a string) *Builder {
    if b.phase != 0 { panic("Addr after other steps") }
    b.phase = 1
    b.addr = a
    return b
}
```

Equivalent to the stage-typed builder (junior §5.3), but at runtime. Useful when types would be too verbose, but you still want loud failure on order mistakes. Reserve for safety-critical APIs.

### 11.4 The composite chain

```go
// Compose two sub-builders into one terminal
func (b *Builder) Build() (*Server, error) {
    cfg, err := b.serverConfig.Build()
    if err != nil { return nil, err }
    tls, err := b.tlsConfig.Build()
    if err != nil { return nil, err }
    return &Server{cfg: cfg, tls: tls}, nil
}
```

When the target is composed of sub-objects, each with its own builder. The outer `Build()` orchestrates.

---

## 12. Performance — when allocation matters

Builder vs functional options vs direct struct construction. Measured at Go 1.22, amd64:

```
BenchmarkDirectStructInit-8     500000000   2.1 ns/op    0 B/op    0 allocs/op
BenchmarkFunctionalOptions-8     30000000   38.4 ns/op   0 B/op    0 allocs/op
BenchmarkPointerBuilder-8        20000000   54.7 ns/op  48 B/op    1 allocs/op
BenchmarkValueBuilder-8           5000000  213.5 ns/op 240 B/op    5 allocs/op
BenchmarkGenericBuilder-8        10000000  118.2 ns/op  96 B/op    3 allocs/op
```

Reading the numbers:

- **Direct struct init** is the floor. Everything else is overhead.
- **Functional options** is roughly 18× slower than direct, but the closure allocations don't show up in the steady state — they're amortised.
- **Pointer builder** is ~25× slower with one allocation (the builder itself). The chain methods are zero-allocation; only the `*Builder` heap-escapes.
- **Value builder** is ~100× slower with one allocation per step. If your chain is 5 steps long, that's 5 builder copies on the heap.
- **Generic builder** sits between, dominated by the function-value allocations in `With(func(*T) {...})`.

When does any of this matter?

| Use case | Cares about builder cost? |
|----------|---------------------------|
| Construct a Server at process startup | No |
| Configure a logger per request | Yes — measure. |
| Build a SQL query per HTTP handler | Marginal. Use a pointer-receiver builder and reuse the underlying byte buffer with `sync.Pool` if profiles say so. |
| Generate AST nodes in a parser | Yes — direct struct init, no builder. |
| Build test fixtures | No — tests are slow anyway. |

The decision is almost never "builder vs direct struct"; it's "is the readability worth one allocation per request". Usually yes.

---

## 13. Common middle-level mistakes

### 13.1 Forgetting to deep-copy in `Clone()`

```go
func (b *Builder) Clone() *Builder {
    c := *b
    return &c  // c.wheres still points at b.wheres backing array
}
```

Two builders sharing one slice. Appending in either may or may not visibly mutate the other depending on capacity. Always copy slices and maps explicitly.

### 13.2 Stateful step methods that surprise

```go
func (b *Builder) Where(cond string, args ...any) *Builder {
    if b.err != nil { return b }
    b.wheres = append(b.wheres, "("+cond+")")  // wraps in parens
    b.args   = append(b.args,   args...)
    return b
}
```

Two `Where` calls produce `(a) AND (b)`. Fine — unless the second `Where("(...) OR (...)")` was meant as a single clause. The caller can't tell from the API. Document the AND-joining behaviour.

### 13.3 Hidden ordering dependencies

```go
b.OrderBy("created_at").Limit(10)   // works
b.Limit(10).OrderBy("created_at")   // also works in some libraries — but produces different SQL?
```

If both orderings should be equivalent, make them equivalent in the builder. If one is wrong, document it loudly (or use stage typing).

### 13.4 Confusion between `Build()` and `Run()`

```go
// Two terminals
sql, args, _ := b.Build()           // returns SQL string
rows, _ := db.Query(sql, args...)   // run later

vs

rows, _ := b.Run(ctx, db)           // builds and runs
```

`Build()` and `Run()` are different mental models. If your builder has both, the package docs must be crystal clear about which produces what. Sneaking a `Run()` in alongside `Build()` confuses callers who expected `Build()` to be the only terminal.

### 13.5 Locking inside step methods

```go
func (b *Builder) Where(cond string, args ...any) *Builder {
    b.mu.Lock()
    defer b.mu.Unlock()
    /* ... */
}
```

A builder is single-threaded by design (junior §11.2). Adding a mutex is fighting the pattern. If you need concurrent assembly, the answer is "have one goroutine collect from channels and call the builder serially", not "make the builder thread-safe".

---

## 14. Debugging a builder chain

When a chain produces unexpected output, walk through it methodically.

### 14.1 Insert `.Tap()` or a log helper

```go
func (b *Builder) Tap(f func(*Builder)) *Builder {
    f(b)
    return b
}

b := NewBuilder().
    Addr(":8080").
    Tap(func(b *Builder) { log.Printf("after Addr: %+v", b) }).
    ReadTimeout(5*time.Second).
    Tap(func(b *Builder) { log.Printf("after ReadTimeout: %+v", b) }).
    Build()
```

`Tap` is a no-op step that lets you inspect the builder mid-chain. Some libraries ship it; if not, define it locally for debugging.

### 14.2 Snapshot in `Build()`

```go
func (b *Builder) Build() (*Server, error) {
    log.Printf("Build: state=%+v err=%v", b, b.err)
    /* ... */
}
```

Logs the final state. Tells you if the chain produced what you expected before construction.

### 14.3 Look for the error early

If `Build()` returns an error you don't expect, the first culprit is a step that silently set `b.err`. Add logs to each step to find which one.

### 14.4 `go vet` doesn't help here

There's no vet check for "you forgot to chain `Build()`". A unit test that asserts the resulting object's state is the simplest insurance.

---

## 15. Tricky points

### 15.1 The chain that doesn't compile

```go
b := NewServerBuilder()
b.
    Addr(":8080").
    ReadTimeout(5*time.Second).
    Build()
```

Go's automatic semicolon insertion treats the empty line after `b` as a statement. The next line starts a new statement: `.Addr(...)` — but `.Addr` isn't a valid statement opener. Compile error.

Fix: keep the `.` at the *end* of the previous line.

```go
b := NewServerBuilder().
    Addr(":8080").
    ReadTimeout(5*time.Second).
    Build()
```

Idiomatic Go puts the dot at the end. If you can't, use parens:

```go
b := NewServerBuilder()
b = (b).Addr(":8080").Build()  // ugly, but works
```

### 15.2 Method values and chains

```go
addrFn := b.Addr
addrFn(":8080")
addrFn(":9090")  // both calls operate on the same builder
```

A method value captures the receiver. Each call mutates the same builder. If you create method values from a builder and pass them around, you've created hidden aliases.

### 15.3 Builders in test helpers

```go
func userFixture() *Builder {
    return NewUserBuilder().Name("Alice").Email("alice@example.com")
}

func TestFoo(t *testing.T) {
    u, _ := userFixture().Role("admin").Build()
    /* ... */
}
```

Fine — but the test depends on the fixture's defaults. When you add a new field that needs a default in the fixture, tests that didn't set it before now get the new default. Sometimes desired, sometimes a silent test-data bug. Be explicit about fixture defaults in their godoc.

### 15.4 The `.With(opts...)` trap

```go
func (b *Builder) With(opts ...Option) *Builder {
    for _, o := range opts { o(b) }
    return b
}
```

If `o == nil`, this panics. Add the nil-skip:

```go
for _, o := range opts {
    if o == nil { continue }
    o(b)
}
```

Same as functional options. The pattern shows up in `With` too.

---

## 16. Test

**Q1.** What's the issue?

```go
type Builder struct {
    cfg ServerConfig
}

func (b *Builder) Addr(a string) *Builder { b.cfg.addr = a; return b }

func (b *Builder) Build() ServerConfig {
    return b.cfg
}

// Test
b := NewBuilder()
c1 := b.Addr(":8080").Build()
c2 := b.Addr(":9090").Build()
fmt.Println(c1.Addr())   // ?
```

<details><summary>Answer</summary>

`c1.Addr()` prints `":9090"`. The builder is shared; both calls mutate the same `cfg`. `Build()` returns `b.cfg` by value, which captures the *current* state — but both `c1` and `c2` are computed from the same mutated builder. `c1` is the value-copy *as of the first Build call*, so actually `c1` prints `":8080"` and `c2` prints `":9090"`. The pointer indirection at `b.cfg.addr = ...` mutates in place; the value-return at `Build()` snapshots.

So this code works *correctly* — but the lifecycle is confusing. The lesson: a single builder being used for multiple Builds is a smell unless you've explicitly opted into that pattern.
</details>

**Q2.** Fix the deep-copy bug:

```go
func (b *Builder) Clone() *Builder {
    c := *b
    return &c
}
```

<details><summary>Answer</summary>

```go
func (b *Builder) Clone() *Builder {
    c := *b
    c.wheres = append([]string(nil), b.wheres...)
    c.args   = append([]any(nil),    b.args...)
    if b.headers != nil {
        c.headers = make(map[string]string, len(b.headers))
        for k, v := range b.headers { c.headers[k] = v }
    }
    return &c
}
```

Every slice and map must be copied explicitly. The shallow copy `c := *b` only duplicates the slice headers, not the underlying arrays.
</details>

**Q3.** When does this design fall over?

```go
type Builder struct { steps []func(*Server) }

func (b *Builder) Addr(a string) *Builder {
    b.steps = append(b.steps, func(s *Server) { s.addr = a })
    return b
}

func (b *Builder) Build() *Server {
    s := &Server{}
    for _, f := range b.steps { f(s) }
    return s
}
```

<details><summary>Answer</summary>

This is functional options in disguise. It allocates a closure per step (the `func(s *Server) { ... }`), defeating the main reason to choose builder over options (one alloc total). For builders the canonical shape is to *store fields* on the builder and copy them into the Server in `Build()`. Reserve the closure-list approach for §5.1 generic builders or specific deferred-execution scenarios.
</details>

---

## 17. Cheat sheet

| Situation | Pattern |
|-----------|---------|
| Single-use, mutating chain | Pointer-receiver builder |
| Need to fork mid-chain | Value-receiver OR `Clone()` |
| Many target types share infra | Generic `Builder[T]` |
| Sequential phases + extensible knobs | Builder with `With(opts ...Option)` |
| Building immutable values | Builder in same package, target fields unexported |
| Want compile-time order enforcement | Stage-typed builder (use sparingly) |
| Need to log mid-chain | `.Tap(func(*Builder))` helper |
| Need multiple terminal flavours | Multi-terminal builder, ensure idempotency |
| Need to factor common chains | Free function OR Director struct |

---

## 18. Summary

The builder pattern in Go is a small family of variants, each fitting a different shape of construction problem:

- Default to the pointer-receiver mutating builder. It's the cheapest in allocations and matches most needs.
- Move to value-receivers only when forking mid-chain is genuinely common.
- Generic builders are library infrastructure, not application-level APIs.
- The Director is often a free function in Go — don't introduce a struct for something a `func` does.
- Multi-terminal builders are powerful but require careful idempotency.
- Hybrid with functional options when the API has both structural and behavioural configuration.

The next step is **[senior.md](senior.md)** — architecture-level concerns: builder APIs in stable libraries, evolving them across major versions, builder ↔ DSL bridges, builder anti-patterns at scale, and real-world studies (`squirrel`, `goqu`, `resty`, `protobuf-go` message construction).
