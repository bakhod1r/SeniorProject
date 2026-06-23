# Strategy Pattern — Middle

## 1. What this level adds

Junior taught the shape: an interface or a function, swapped at runtime. Middle is about the design judgement that surrounds it:

- The interface-and-function-adapter trick (`http.HandlerFunc` pattern) — getting both shapes for one role.
- Strategy registries — looking strategies up by name.
- Composing strategies — chains, fallbacks, weighted selection.
- Generic strategies (Go 1.18+) and when they actually help.
- Testing strategies cleanly — mocking, the "real implementation in tests" alternative.
- Strategy lifetime — long-lived vs per-request, and the allocation cost of each.
- The nil-interface trap, the typed-nil trap, and other production bugs.
- Strategy ↔ Decorator interop and the difference under pressure.

By the end you should be able to design a strategy-based subsystem without backtracking.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Interface segregation in practice](#3-interface-segregation-in-practice)
4. [The interface + function adapter (HandlerFunc pattern)](#4-the-interface--function-adapter-handlerfunc-pattern)
5. [Strategy registries — naming and lookup](#5-strategy-registries--naming-and-lookup)
6. [Composing strategies — chains, fallbacks, weighted](#6-composing-strategies--chains-fallbacks-weighted)
7. [Generic strategies](#7-generic-strategies)
8. [Strategy lifetime and allocation](#8-strategy-lifetime-and-allocation)
9. [Testing — mocks, fakes, and the in-memory implementation](#9-testing--mocks-fakes-and-the-in-memory-implementation)
10. [Nil-interface and typed-nil traps](#10-nil-interface-and-typed-nil-traps)
11. [Strategy ↔ Decorator interop](#11-strategy--decorator-interop)
12. [Coding patterns](#12-coding-patterns)
13. [Performance notes](#13-performance-notes)
14. [Common middle-level mistakes](#14-common-middle-level-mistakes)
15. [Debugging a strategy bug](#15-debugging-a-strategy-bug)
16. [Tricky points](#16-tricky-points)
17. [Test](#17-test)
18. [Cheat sheet](#18-cheat-sheet)
19. [Summary](#19-summary)

---

## 3. Interface segregation in practice

A common mid-level realisation: the right number of methods on a strategy interface is *almost always smaller than you think*.

```go
// Tempting — model the whole "payment provider" capability
type Gateway interface {
    Charge(...)    error
    Refund(...)    error
    Capture(...)   error
    Authorize(...) error
    Webhook(...)   error
}
```

Now ask: does the `Processor` actually call all five? If `Processor` only calls `Charge`, the interface should only have `Charge`. Implementations that *also* support refund expose `Refund` on the concrete type — callers who need refund accept a `Refunder` interface.

```go
type Charger interface { Charge(...) error }
type Refunder interface { Refund(...) error }
type Authorizer interface { Authorize(...) error }

type StripeGateway struct{ /* ... */ }

func (s *StripeGateway) Charge(...) error    { /* ... */ }
func (s *StripeGateway) Refund(...) error    { /* ... */ }
func (s *StripeGateway) Authorize(...) error { /* ... */ }
// Stripe satisfies all three. Square may satisfy only Charge.
```

The consumer picks the narrowest interface it needs:

```go
type Processor struct{ c Charger }
type Refunds   struct{ r Refunder }
```

This is **interface segregation**. The benefit isn't theoretical — it shows up the moment a new gateway joins that doesn't support refund. With the wide interface, you'd either fail the type check or add a `Refund()` that returns "not supported" (a code smell). With segregation, the gateway simply doesn't satisfy `Refunder`, and the system tells you about that constraint at compile time.

### How to detect "interface too wide"

- Implementations have methods that return "not supported" / `errors.New("unimplemented")`.
- Some implementations have stub methods with TODOs.
- Tests need to mock methods the test isn't exercising.
- The interface has more methods than any single caller uses.

When you see these, split the interface.

---

## 4. The interface + function adapter (HandlerFunc pattern)

The canonical Go idiom for "accept either an interface or a function with the same signature".

```go
// from net/http
type Handler interface {
    ServeHTTP(ResponseWriter, *Request)
}

type HandlerFunc func(ResponseWriter, *Request)

func (f HandlerFunc) ServeHTTP(w ResponseWriter, r *Request) {
    f(w, r) // the adapter just invokes the function
}
```

The trick: `HandlerFunc` is a *named function type*, and named types can have methods. `HandlerFunc.ServeHTTP` calls the function — so any `HandlerFunc` value satisfies `Handler`.

Why this matters: callers get the best of both shapes.

```go
mux := http.NewServeMux()

mux.Handle("/users", &userHandler{})                       // interface form
mux.Handle("/posts", http.HandlerFunc(handlePost))         // function form via adapter
mux.HandleFunc("/comments", handleComment)                 // function form via shortcut
```

Define your own when you're publishing a strategy API:

```go
package payment

type Charger interface {
    Charge(ctx context.Context, amount int) error
}

type ChargeFunc func(ctx context.Context, amount int) error

func (f ChargeFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount)
}
```

Now consumers can write either:

```go
NewProcessor(&StripeGateway{...})
NewProcessor(payment.ChargeFunc(func(ctx context.Context, amount int) error {
    // inline implementation, often for tests
    return nil
}))
```

The adapter type is ~five lines, costs nothing at runtime (the method call boils down to a direct function call), and gives your API users a strictly better experience.

### When NOT to define the adapter

- The strategy has multiple methods. You can't adapter-ize an interface with five methods cleanly — you'd need a struct with five fields and method shims, which is more work than just writing a struct.
- The strategy's call site is rare. Adding the adapter is permanent surface area; don't add it speculatively.

---

## 5. Strategy registries — naming and lookup

Sometimes the strategy is chosen by *name* at runtime (config file, CLI flag, request payload). The pattern:

```go
package codec

type Codec interface {
    Encode([]byte) []byte
    Decode([]byte) ([]byte, error)
}

var registry = map[string]Codec{}

func Register(name string, c Codec) {
    if _, dup := registry[name]; dup {
        panic("codec: " + name + " already registered")
    }
    registry[name] = c
}

func Get(name string) (Codec, error) {
    c, ok := registry[name]
    if !ok {
        return nil, fmt.Errorf("codec: unknown %q", name)
    }
    return c, nil
}
```

Each implementation registers itself in `init()`:

```go
package codec_gzip

func init() {
    codec.Register("gzip", &gzipCodec{})
}
```

Importing `codec_gzip` for its side effects (blank import: `_ "myorg/codec_gzip"`) makes the codec available at runtime.

### Pros / cons of the registry pattern

**Pros:**
- Configuration-driven. The strategy comes from a string, not a hardcoded switch.
- Plugins. Third parties register their codecs without modifying core code.
- Discoverable. Reading the init() of a package tells you what it provides.

**Cons:**
- Global mutable state. Order of imports matters for what's registered when.
- Hard to test in isolation (the registry persists across tests; one test registering a mock affects others).
- Init-time side effects can mask errors (a duplicate registration panics during init, far from the code that caused it).

The standard library uses this pattern (`database/sql.Register`, `image.RegisterFormat`, `compress/gzip` driver pattern). For application code, the cleaner alternative is **explicit construction**:

```go
codec := codec.NewGzip() // or codec.NewSnappy(), etc.
processor := NewProcessor(codec)
```

Use the registry pattern only when configuration-driven selection is a hard requirement. Otherwise the explicit form is easier to test and reason about.

### Variant: typed registries

```go
type CodecFactory func() Codec

var registry = map[string]CodecFactory{}

func Register(name string, f CodecFactory) { registry[name] = f }

func New(name string) (Codec, error) {
    f, ok := registry[name]
    if !ok { return nil, errors.New("unknown codec") }
    return f(), nil
}
```

Factories instead of instances. Each `Get` returns a fresh strategy. Useful when the strategy has state that shouldn't be shared (e.g., a stateful compressor with internal buffers).

---

## 6. Composing strategies — chains, fallbacks, weighted

A `[]Strategy` plus a loop covers most composition needs. Three named compositions are worth knowing.

### 6.1 Chain — first non-nil result wins

```go
type Resolver interface {
    Resolve(name string) (string, error)
}

type ChainResolver []Resolver

func (cs ChainResolver) Resolve(name string) (string, error) {
    var lastErr error
    for _, r := range cs {
        v, err := r.Resolve(name)
        if err == nil {
            return v, nil
        }
        lastErr = err
    }
    return "", fmt.Errorf("ChainResolver: all failed: %w", lastErr)
}
```

Try `localCacheResolver` first; if it fails, try `dnsResolver`; if that fails, return the last error. The chain *is* a strategy — `ChainResolver` satisfies `Resolver` itself, so it composes with other strategies.

### 6.2 Fallback — error from primary triggers backup

```go
type FallbackResolver struct {
    Primary, Backup Resolver
}

func (f FallbackResolver) Resolve(name string) (string, error) {
    v, err := f.Primary.Resolve(name)
    if err == nil { return v, nil }
    return f.Backup.Resolve(name)
}
```

Two-strategy chain, but the structure makes the relationship explicit. Useful when readers should immediately see "primary + backup".

### 6.3 Weighted / round-robin

```go
type WeightedRouter struct {
    routes []Strategy
    weights []int
    rnd     *rand.Rand
}

func (w *WeightedRouter) Pick() Strategy {
    total := 0
    for _, x := range w.weights { total += x }
    pick := w.rnd.Intn(total)
    for i, x := range w.weights {
        pick -= x
        if pick < 0 { return w.routes[i] }
    }
    return w.routes[len(w.routes)-1] // unreachable normally
}
```

For A/B tests, traffic shaping, canary rollout. The composition itself implements a strategy of "which underlying strategy to call".

### 6.4 The composition principle

Strategies satisfy interfaces. Compositions satisfy the same interface. You can stack them indefinitely without changing the interface contract:

```go
var r Resolver = ChainResolver{
    cacheResolver,
    FallbackResolver{Primary: dnsResolver, Backup: hostsResolver},
}
```

Three levels of composition, one interface throughout. This is the practical payoff of small interfaces — composability is free.

---

## 7. Generic strategies

Go 1.18+ generics let you write a strategy that adapts to the data type.

```go
type Reducer[T, R any] func(acc R, item T) R

func Reduce[T, R any](items []T, init R, fn Reducer[T, R]) R {
    acc := init
    for _, it := range items {
        acc = fn(acc, it)
    }
    return acc
}

// Usage:
sum := Reduce([]int{1, 2, 3}, 0, func(a, b int) int { return a + b })
maxName := Reduce(users, "", func(s string, u User) string {
    if u.Name > s { return u.Name }
    return s
})
```

The generic `Reducer[T, R]` is a strategy parameterised by data type. Before generics you'd write `Reduce(items []int, ...)`, then `Reduce(items []string, ...)`, then `Reduce(items []User, ...)`, all near-duplicates. Now one signature handles them all.

### When generic strategies help

- Operations on slices, maps, channels that are agnostic to element type (map/filter/reduce, sort, partition).
- Pipelines where multiple stages transform `T` to `U` to `V`.
- Cache implementations parameterised by key and value type.

### When they don't help

- A strategy that has business meaning specific to its domain. `Charge[T Currency]` doesn't buy you anything over `Charge` — you almost never call it with two currencies in one process.
- An interface with multiple methods. Go's generics on methods are limited; you can't have a method like `func (s Strategy[T]) Do(t T)` declared on a non-generic interface.
- A strategy that needs to introspect its own type. Use `reflect` instead.

Generics excel when the strategy is *structurally polymorphic*. They flounder when it's *domain polymorphic*.

---

## 8. Strategy lifetime and allocation

Where does the strategy *live*?

### 8.1 Long-lived, set once at startup

```go
processor := NewProcessor(&StripeGateway{apiKey: cfg.StripeKey})
// processor.gateway is set once; never changes for the life of the process
```

Most strategies are this. One allocation at boot. Performance is irrelevant.

### 8.2 Per-request, varying

```go
func handleCharge(w http.ResponseWriter, r *http.Request) {
    g := gatewayByCountry(r.Header.Get("X-Country"))
    p := NewProcessor(g)
    p.Process(r.Context(), order)
}
```

A fresh strategy per request. Allocation cost depends on the gateway: usually low (a struct with a few pointers).

If `gatewayByCountry` returns *cached* instances, this is the same as §8.1. If it constructs fresh ones, profile to see if the allocation matters.

### 8.3 Hot-path, called millions of times

```go
sort.Slice(users, func(i, j int) bool { return users[i].Age < users[j].Age })
```

The closure is allocated *once* (Go is smart enough to recognise the closure doesn't escape the call), so this is zero-allocation. But:

```go
func sortBy(field string) func(int, int) bool {
    return func(i, j int) bool {
        // closure captures `field` — allocation
        switch field { /* ... */ }
        return false
    }
}
```

Each call to `sortBy` allocates a new closure. Fine if called twice per request; bad if called per-element.

### 8.4 Interface vs function — does it matter?

A direct function call is ~1 ns. An interface call adds ~1-2 ns for the indirect dispatch. For a per-request strategy this is invisible; for a per-element strategy in a tight loop it could matter.

```
BenchmarkFunctionStrategy-8        1000000000   0.85 ns/op    0 B/op
BenchmarkInterfaceStrategy-8        700000000   1.62 ns/op    0 B/op
```

If profiling shows the strategy dispatch as a hot path, replace the interface with a function. Otherwise don't worry.

---

## 9. Testing — mocks, fakes, and the in-memory implementation

Strategies are wonderful for tests. Three approaches.

### 9.1 Manual mock

```go
type mockGateway struct {
    chargeCalled bool
    chargeArgs   struct { amount int; currency string }
    chargeReturn struct { id string; err error }
}

func (m *mockGateway) Charge(ctx context.Context, amount int, ccy string) (string, error) {
    m.chargeCalled = true
    m.chargeArgs.amount = amount
    m.chargeArgs.currency = ccy
    return m.chargeReturn.id, m.chargeReturn.err
}

func TestProcessor_Process(t *testing.T) {
    g := &mockGateway{}
    g.chargeReturn.id = "test_123"

    p := NewProcessor(g)
    id, err := p.Process(ctx, Order{AmountCents: 1000, Currency: "USD"})

    if err != nil { t.Fatal(err) }
    if !g.chargeCalled { t.Error("Charge not called") }
    if g.chargeArgs.amount != 1000 { t.Errorf("amount = %d", g.chargeArgs.amount) }
    if id != "test_123" { t.Errorf("id = %q", id) }
}
```

Direct and clear. Easy to read, no magic.

### 9.2 Function adapter for one-off stubs

```go
func TestProcessor_Process(t *testing.T) {
    var captured int
    p := NewProcessor(payment.ChargeFunc(func(ctx context.Context, amount int, _ string) (string, error) {
        captured = amount
        return "test_123", nil
    }))
    p.Process(ctx, Order{AmountCents: 1000, Currency: "USD"})
    if captured != 1000 { t.Errorf("amount = %d", captured) }
}
```

Useful for ad-hoc behaviour where defining a whole mock type is overkill.

### 9.3 The in-memory implementation

```go
package payment

// InMemoryGateway records charges in a map. Production-quality enough for tests.
type InMemoryGateway struct {
    mu      sync.Mutex
    charges map[string]Order // id -> order
}

func NewInMemoryGateway() *InMemoryGateway {
    return &InMemoryGateway{charges: make(map[string]Order)}
}

func (g *InMemoryGateway) Charge(_ context.Context, amount int, ccy string) (string, error) {
    g.mu.Lock()
    defer g.mu.Unlock()
    id := fmt.Sprintf("mem_%d", len(g.charges))
    g.charges[id] = Order{AmountCents: amount, Currency: ccy}
    return id, nil
}

func (g *InMemoryGateway) Get(id string) (Order, bool) {
    g.mu.Lock()
    defer g.mu.Unlock()
    o, ok := g.charges[id]
    return o, ok
}
```

A real-behaviour fake. Used in:
- Unit tests where mocks would be too brittle.
- Integration tests where the real gateway is slow / costs money.
- End-to-end tests when running against staging infrastructure isn't possible.

The in-memory implementation pays off when the *real* behaviour is non-trivial. For a payment gateway, the fake validates that "charge then refund" gives the right balance — something a mock can't easily express.

---

## 10. Nil-interface and typed-nil traps

The Go gotcha that catches everyone at least once.

```go
type Charger interface { Charge() error }

type StripeGateway struct{ /* ... */ }
func (s *StripeGateway) Charge() error { return nil }

func newGateway(useStripe bool) Charger {
    var sg *StripeGateway
    if useStripe {
        sg = &StripeGateway{}
    }
    return sg // !
}

func main() {
    g := newGateway(false)
    if g == nil {
        fmt.Println("no gateway")
    } else {
        g.Charge() // panic: nil pointer dereference
    }
}
```

What happened: `newGateway(false)` returns `(type=*StripeGateway, value=nil)` — a non-nil interface wrapping a nil pointer. The check `g == nil` compares the interface against the *typeless* nil interface. They're not equal — the returned interface has a type.

Fix:

```go
func newGateway(useStripe bool) Charger {
    if useStripe {
        return &StripeGateway{}
    }
    return nil // returns a typeless nil interface
}
```

Or even cleaner — never assign `*T` to a variable typed as the interface unless the `*T` is non-nil.

```go
func newGateway(useStripe bool) Charger {
    if !useStripe {
        return nil
    }
    return &StripeGateway{}
}
```

### Rule

When a function returns an interface, return a *typeless* nil when there's no value. Don't return a nilable concrete pointer; the interface will wrap the nil and lie about being non-nil.

We come back to this in `professional.md` §6 with the runtime details (the `iface` struct).

---

## 11. Strategy ↔ Decorator interop

Decorator wraps a strategy with cross-cutting concerns. The decorator implements the same interface as the strategy and delegates.

```go
type Charger interface { Charge(ctx context.Context, amount int) error }

// LoggingCharger decorates a Charger with logging.
type LoggingCharger struct {
    Inner Charger
    Log   *log.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, amount int) error {
    l.Log.Printf("Charge: amount=%d", amount)
    err := l.Inner.Charge(ctx, amount)
    if err != nil { l.Log.Printf("Charge failed: %v", err) }
    return err
}

// RetryingCharger decorates a Charger with retries.
type RetryingCharger struct {
    Inner    Charger
    Attempts int
}

func (r *RetryingCharger) Charge(ctx context.Context, amount int) error {
    var err error
    for i := 0; i < r.Attempts; i++ {
        if err = r.Inner.Charge(ctx, amount); err == nil { return nil }
    }
    return fmt.Errorf("after %d attempts: %w", r.Attempts, err)
}
```

Compose:

```go
var c Charger = &StripeGateway{...}
c = &RetryingCharger{Inner: c, Attempts: 3}
c = &LoggingCharger{Inner: c, Log: logger}

// c is now: Logging( Retrying( Stripe ) )
```

The strategies *and* the decorators implement `Charger`. The chain is invisible to the consumer (`Processor`); it just calls `c.Charge(...)`.

This works because Go interfaces don't have identity — any value satisfying the interface fits. Java does the same with the Decorator pattern. The trick is identical; only the syntax differs.

We cover Decorator in detail in `../04-decorator-pattern/`. The point here is: Strategy and Decorator pair *natively* in Go because they share the same interface contract.

---

## 12. Coding patterns

### 12.1 The default strategy

```go
func NewProcessor(g Gateway) *Processor {
    if g == nil {
        g = &noopGateway{} // never panics, returns "not configured" errors
    }
    return &Processor{gateway: g}
}
```

Internal `noopGateway` keeps the processor usable for tests that don't care about charging. Alternative: return an error from `NewProcessor`.

### 12.2 The "must" strategy

```go
type MustCharger struct{ Inner Charger }

func (m MustCharger) Charge(ctx context.Context, amount int) error {
    if err := m.Inner.Charge(ctx, amount); err != nil {
        panic(fmt.Errorf("MustCharge: %w", err))
    }
    return nil
}
```

Wraps a `Charger` so any error becomes a panic. Useful only when an unhandled charge error should never happen (e.g., in a controlled test environment). In production code, prefer surfacing the error.

### 12.3 The introspectable strategy

```go
type Named interface { Name() string }

func describe(c Charger) string {
    if n, ok := c.(Named); ok {
        return n.Name()
    }
    return "anonymous"
}
```

Optional interfaces let strategies expose extra information when supported. Avoid making `Name()` mandatory on `Charger`; use a separate optional interface and a type assertion.

### 12.4 The constraint check via type assertion

```go
func needsRefund(c Charger) (Refunder, bool) {
    r, ok := c.(Refunder)
    return r, ok
}
```

When the consumer can use richer behaviour if available, type-assert. The strategy doesn't have to declare anything special — interface satisfaction is structural.

---

## 13. Performance notes

```
BenchmarkDirectCall-8           1000000000   0.85 ns/op   0 B/op   0 allocs/op
BenchmarkFunctionStrategy-8     1000000000   0.91 ns/op   0 B/op   0 allocs/op
BenchmarkInterfaceStrategy-8     700000000   1.62 ns/op   0 B/op   0 allocs/op
BenchmarkClosureCapture-8        500000000   2.10 ns/op  16 B/op   1 allocs/op
```

Observations:

- **Direct call** (no strategy) is the floor.
- **Function strategy** is essentially free — Go inlines simple closures aggressively. The difference vs direct call is noise.
- **Interface strategy** adds ~0.8 ns per call (indirect dispatch via the interface table). Imperceptible for non-hot-path code.
- **Closure capture** that escapes to the heap costs an allocation. This is *not* the cost of the strategy pattern; it's the cost of *creating* a new strategy that captures state. If you reuse the closure (build once, call millions of times), the alloc is amortised.

### What this means in practice

- For boot-time strategies (chosen once): no perf cost worth measuring.
- For per-request strategies: interface dispatch is fine.
- For per-element strategies in tight inner loops: prefer functions or, if you're really hot, inline the operation.

You will almost never need to switch strategies for performance. When you do, profile first — guesses about strategy cost are usually wrong by an order of magnitude in either direction.

---

## 14. Common middle-level mistakes

### 14.1 Naming the interface after the pattern

```go
// Smell
type CompressStrategy interface { Compress([]byte) []byte }

// Idiomatic
type Compressor interface { Compress([]byte) []byte }
```

### 14.2 Mixing too many concerns into one interface

```go
type Storage interface {
    Read(key string) ([]byte, error)
    Write(key string, value []byte) error
    Delete(key string) error
    List(prefix string) ([]string, error)
    Lock(key string) error
    Unlock(key string) error
    Subscribe(prefix string, ch chan<- Event) error
}
```

This is "everything a storage system might do". Real consumers use 1-3 methods. Split into `Reader`, `Writer`, `Locker`, `Subscriber`.

### 14.3 Hiding strategy behind an enum

```go
type GatewayKind int
const (
    Stripe GatewayKind = iota
    PayPal
    Square
)

func Charge(kind GatewayKind, amount int) error {
    switch kind {
    case Stripe:  /* ... */
    case PayPal:  /* ... */
    case Square:  /* ... */
    }
}
```

The switch *is* the strategy, badly. Adding a new gateway means editing the function. Use an interface or function value instead.

### 14.4 Putting strategies in a slice as `interface{}`

```go
// Smell
var strategies []interface{} = []interface{}{stripeGateway, paypalGateway}
```

Use the actual interface type:

```go
var strategies []Charger = []Charger{stripeGateway, paypalGateway}
```

`interface{}` (or `any`) loses type information. The compiler can't check what methods you can call.

---

## 15. Debugging a strategy bug

You suspect the wrong strategy ran. Walk through it.

### 15.1 Log the strategy's concrete type

```go
log.Printf("Process: using gateway %T", p.gateway)
// Output: Process: using gateway *payment.StripeGateway
```

`%T` prints the concrete type wrapped by the interface. Tells you which strategy is in play. Common cause of mystery bugs: a test set up a different gateway than expected.

### 15.2 Verify in the constructor

```go
func NewProcessor(g Gateway) *Processor {
    log.Printf("NewProcessor: %T", g)
    return &Processor{gateway: g}
}
```

If the constructor logs the wrong type, the caller is wrong. If the right type, the bug is elsewhere.

### 15.3 Use the `expvar` pattern for production diagnosis

```go
import "expvar"

var gatewayName = expvar.NewString("payment.gateway")

func NewProcessor(g Gateway) *Processor {
    if n, ok := g.(interface{ Name() string }); ok {
        gatewayName.Set(n.Name())
    } else {
        gatewayName.Set(fmt.Sprintf("%T", g))
    }
    return &Processor{gateway: g}
}
```

Now `/debug/vars` shows which gateway the process is using — handy for verifying deploys.

---

## 16. Tricky points

### 16.1 The receiver kind matters

```go
type StripeGateway struct{ ... }
func (s StripeGateway) Charge(...) error { ... }   // value receiver

var g Gateway = StripeGateway{...} // ok — value satisfies the interface
var g Gateway = &StripeGateway{...} // also ok — pointer satisfies it too
```

vs.

```go
type StripeGateway struct{ ... }
func (s *StripeGateway) Charge(...) error { ... }  // pointer receiver

var g Gateway = StripeGateway{...}  // compile error — value type doesn't satisfy
var g Gateway = &StripeGateway{...} // ok
```

Pointer-receiver methods are only on the pointer type's method set. Value-receiver methods are on both. Be consistent: pick one style per type. Mixing causes confusing "doesn't satisfy interface" errors.

### 16.2 Method values vs method expressions

```go
g := &StripeGateway{...}
chargeMethod := g.Charge       // method value — bound to g
result := chargeMethod(ctx, 100, "USD") // calls g.Charge(ctx, 100, "USD")

chargeExpr := (*StripeGateway).Charge   // method expression — unbound
result = chargeExpr(g, ctx, 100, "USD") // explicit receiver
```

Method values are useful as one-off strategies — they capture the receiver. Method expressions are useful for plumbing — they work with any receiver of the type.

### 16.3 Returning an interface from a stub strategy

```go
var globalGateway Gateway

func getGateway() Gateway { return globalGateway }
```

If something earlier set `globalGateway = nil`, this returns a typeless nil — caller's `if g == nil` works. If something set `globalGateway = (*StripeGateway)(nil)`, this returns a typed nil — `if g == nil` is false but `g.Charge(...)` panics. The typed-nil trap, scaled to globals.

### 16.4 The empty interface as a strategy type

```go
type Strategy interface{} // any value satisfies — useless as a strategy
```

If you ever find yourself writing `Strategy interface{}` or `any`, you've defeated the type system. The strategy interface needs *at least one method* to be useful.

---

## 17. Test

**Q1.** What's wrong?

```go
type Renderer interface {
    Render(html string) string
    Cache() *RenderCache
    SetCache(c *RenderCache)
    Logger() *log.Logger
    SetLogger(l *log.Logger)
    Metrics() *MetricsClient
    SetMetrics(m *MetricsClient)
}
```

<details><summary>Answer</summary>

The interface has seven methods, six of which are getters/setters for unrelated dependencies. The consumer that calls `Render(html)` doesn't care about caches or loggers. Split:

```go
type Renderer interface { Render(html string) string }
```

The cache, logger, and metrics belong in the concrete type's constructor, not the strategy interface.
</details>

**Q2.** Why does this fail?

```go
type Charger interface { Charge() error }

type StripeGateway struct{}
func (s *StripeGateway) Charge() error { return nil }

var c Charger
sg := (*StripeGateway)(nil)
c = sg

if c == nil {
    fmt.Println("nil")
} else {
    c.Charge()
}
```

<details><summary>Answer</summary>

Prints nothing, then panics. `c` is `(*StripeGateway, nil)` — a non-nil interface wrapping a nil pointer. `c == nil` is false. `c.Charge()` does a virtual dispatch to `(*StripeGateway).Charge`, but the receiver is nil — depending on `Charge`'s body, it either runs OK (if it doesn't deref the receiver) or panics. Here `Charge() error { return nil }` doesn't deref — so actually it returns nil with no panic. Surprising both ways.

The fix: return typeless nil, not a typed nil pointer.
</details>

**Q3.** Which is more idiomatic — and why?

```go
// A
func handleSort(field string, items []User) {
    var less func(i, j int) bool
    switch field {
    case "name": less = func(i, j int) bool { return items[i].Name < items[j].Name }
    case "age":  less = func(i, j int) bool { return items[i].Age < items[j].Age }
    }
    sort.Slice(items, less)
}

// B
func handleSort(field string, items []User) {
    sort.Slice(items, lessByField(field, items))
}

func lessByField(field string, items []User) func(i, j int) bool {
    switch field {
    case "name": return func(i, j int) bool { return items[i].Name < items[j].Name }
    case "age":  return func(i, j int) bool { return items[i].Age < items[j].Age }
    }
    return nil
}
```

<details><summary>Answer</summary>

B. Same logic but the strategy construction is a separate function with a meaningful name. `lessByField` is testable in isolation; `handleSort` reads the high-level intent without the switch noise.

A is fine for one-off code; B scales as more sort fields appear.
</details>

---

## 18. Cheat sheet

| Situation | Approach |
|-----------|----------|
| One method, fixed signature | Function type |
| Multiple methods or stateful | Interface |
| Both shapes for one role | Define interface + adapter named function type (like `http.HandlerFunc`) |
| Multiple capabilities, some optional | Segregate into multiple small interfaces; optional via type assertion |
| Name-based lookup | Registry + `Register`/`Get` |
| Composition | Chain, fallback, weighted — composition types themselves implement the strategy interface |
| Generic by data type | `Strategy[T, R]` with type parameters |
| Cross-cutting (logging, retry, caching) | Decorator pattern — wrapper implements the same interface |
| Testing | In-memory implementation, function-adapter stubs, mock structs — pick by complexity |

---

## 19. Summary

Strategy in Go is so deeply embedded in the language idioms that "doing Strategy" feels indistinguishable from "writing Go". The middle-level skill is knowing when to:

- Promote a function to an interface (when state or multiple operations appear).
- Add the interface + function adapter (when both call-site shapes matter).
- Use a registry vs explicit construction (when configuration-driven selection is a real need).
- Segregate a wide interface into narrow ones (when consumers diverge).
- Compose strategies via chains, fallbacks, weighted (when the *combination* is itself a strategy).

The next step is **[senior.md](senior.md)** — architecture-level concerns: strategy in distributed systems, runtime strategy reload, strategy versioning across major releases, anti-patterns at scale, and case studies (`crypto/cipher`, `database/sql` drivers, `compress/*`, gRPC interceptors).
