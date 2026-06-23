# Strategy Pattern — Find the Bug

A collection of realistic, broken strategy snippets. Each one looks correct at a glance and has shipped to production somewhere. For each: the setup, a subtle bug planted in plausible code, the symptom, the cause traced back to a rule from `junior.md` or `middle.md`, and the fix. Read in order — by the end you should spot every shape in a review before the panic hits staging.

---

## Bug 1: The typed-nil constructor

```go
package payment

type Gateway interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type StripeGateway struct{ apiKey string }

func (s *StripeGateway) Charge(ctx context.Context, amount int) (string, error) {
    return "stripe_ch_123", nil
}

func NewStripeGateway(apiKey string) Gateway {
    var s *StripeGateway
    if apiKey != "" {
        s = &StripeGateway{apiKey: apiKey}
    }
    return s
}

// caller:
func main() {
    g := NewStripeGateway(os.Getenv("STRIPE_KEY"))
    if g == nil {
        log.Fatal("no gateway configured")
    }
    g.Charge(context.Background(), 1000)
}
```

**Question.** The operator forgets to set `STRIPE_KEY`. What does the caller see, and at which line?

<details><summary>Answer</summary>

**Bug.** The `log.Fatal("no gateway configured")` does *not* fire. Execution proceeds to `g.Charge(...)`, which dispatches into `(*StripeGateway).Charge` with a nil receiver. The method body in this case doesn't deref the receiver, so it returns `"stripe_ch_123", nil` — a *fake successful charge* against a non-existent gateway.

If `Charge` had read `s.apiKey`, the call would panic. The "works fine" outcome is arguably worse: the caller logs a successful charge ID for money that was never moved.

**Why it's there.** From `middle.md` §10: assigning a typed nil (`*StripeGateway(nil)`) to an interface variable (`Gateway`) gives you a non-nil interface that wraps a nil pointer. The interface knows its type, and `g == nil` compares against the *typeless* nil interface, which is `(type=nil, value=nil)`. The returned interface is `(type=*StripeGateway, value=nil)` — not equal.

**How to spot in review.** Any constructor whose declared return type is an interface (`Gateway`, `Charger`, etc.) and whose body assigns a `*T` variable that *might* be nil before returning it. The smell is the pair:

```go
func NewX(...) SomeInterface {
    var p *ConcreteT
    if condition { p = &ConcreteT{...} }
    return p
}
```

Even one branch that returns a typed nil contaminates every other branch. The remedy is to return a *typeless* nil explicitly when there's no value:

**Fix.**

```go
func NewStripeGateway(apiKey string) Gateway {
    if apiKey == "" {
        return nil // typeless nil — comparable to nil literal
    }
    return &StripeGateway{apiKey: apiKey}
}
```

Even better: return the concrete type from constructors (`junior.md` §11.3). The interface is the consumer's vocabulary, not the producer's.

```go
func NewStripeGateway(apiKey string) (*StripeGateway, error) {
    if apiKey == "" {
        return nil, errors.New("NewStripeGateway: apiKey empty")
    }
    return &StripeGateway{apiKey: apiKey}, nil
}
```

A `*StripeGateway` returned this way is comparable to nil literally and has no typed-nil pitfall.

**Why it's common.** The "accept interfaces, return concrete types" rule is one sentence in *Effective Go* and most developers learn it as a style preference. The typed-nil trap is the *reason* for it — and only bites you once you've shipped a constructor that returns an interface. The next time you reach for "let me declare the return type as the interface for flexibility", remember this snippet.
</details>

---

## Bug 2: Value receiver, pointer in the registry

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type CountingCharger struct {
    count int
}

func (c *CountingCharger) Charge(ctx context.Context, amount int) (string, error) {
    c.count++
    return fmt.Sprintf("count_%d", c.count), nil
}

type LoggingCharger struct {
    log *log.Logger
}

func (l LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.log.Printf("Charge: amount=%d", amount)
    return "logged", nil
}

var chargers = []Charger{
    LoggingCharger{log: log.Default()},
    &CountingCharger{},
}

func chargeAll(amount int) {
    for _, c := range chargers {
        c.Charge(context.Background(), amount)
    }
}
```

**Question.** A caller invokes `chargeAll` ten times. What does the `CountingCharger`'s `count` field look like after, and is anything wrong with the `LoggingCharger` entry?

<details><summary>Answer</summary>

**Bug — `CountingCharger`.** `count == 10`. That works as expected — `CountingCharger` is stored as `*CountingCharger`, so the method's `*c` mutation persists.

**Bug — `LoggingCharger`.** Subtler. The slice stores `LoggingCharger` *by value*. Each iteration of `for _, c := range chargers` copies the value into `c`. The interface holds the copy. The method's receiver is `l LoggingCharger` — *another* value, copied from the interface's wrapped value.

For a `LoggingCharger` that only reads its `log` field, this is fine. But add a stateful field:

```go
type LoggingCharger struct {
    log    *log.Logger
    chargeCount int
}

func (l LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.chargeCount++  // mutates the local copy; lost on return
    l.log.Printf("Charge #%d: amount=%d", l.chargeCount, amount)
    return "logged", nil
}
```

`chargeCount` *never* increments past 1 from the caller's perspective. Every `Charge` call gets a fresh copy with `chargeCount == 0`, increments to `1` in the local copy, logs `Charge #1`, and discards the change. Across ten `chargeAll` calls, the log line is always `Charge #1`.

**Why it's there.** From `middle.md` §16.1: value receivers satisfy interfaces, but the interface wraps a *value copy*. Any mutation in a value-receiver method mutates the copy. Mixing value-receiver strategies and pointer-receiver strategies in the same slice silently changes the semantics of "the strategy".

The rule of thumb: if the strategy has *any* mutable state, the method set should be on `*T`, not `T`. If the strategy is truly stateless (or only reads pointer-typed fields like a `*log.Logger`), value receivers are fine.

**How to spot in review.** Any strategy interface implemented with mixed receiver kinds in a single registry/slice. Grep for value receivers (`func (x Name)`) and pointer receivers (`func (x *Name)`) on types that share an interface — flag the value-receiver ones if the type has any non-pointer mutable field.

**Fix.** Make `Charge` a pointer-receiver and store the pointer:

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.chargeCount++
    l.log.Printf("Charge #%d: amount=%d", l.chargeCount, amount)
    return "logged", nil
}

var chargers = []Charger{
    &LoggingCharger{log: log.Default()},
    &CountingCharger{},
}
```

If the strategy is meant to be stateless, *remove* the mutable field — make the counter live in the registry or in the caller, not in the strategy:

```go
type LoggingCharger struct{ log *log.Logger }   // immutable

func (l LoggingCharger) Charge(...) (string, error) {
    l.log.Printf("Charge: amount=%d", amount)
    return "logged", nil
}
```

Either commit to "pointer + mutable" or "value + immutable". Mixing is what produces silent bugs.

**Why it's common.** Go lets you mix without warning. The compiler doesn't say "this value receiver method on a type stored in an interface slice will lose mutations". You discover it by logging the same `#1` for every charge in production and spending an afternoon convinced the increment is broken.
</details>

---

## Bug 3: Loop variable capture in pre-1.22 strategy slice

```go
//go:build go1.21
// +build go1.21

type ChargeFunc func(amount int) string

func buildChargers(names []string) []ChargeFunc {
    chargers := make([]ChargeFunc, 0, len(names))
    for _, name := range names {
        chargers = append(chargers, func(amount int) string {
            return fmt.Sprintf("%s charged %d", name, amount)
        })
    }
    return chargers
}

// caller:
func main() {
    cs := buildChargers([]string{"stripe", "paypal", "square"})
    for _, c := range cs {
        fmt.Println(c(100))
    }
}
```

**Question.** A team on Go 1.21 runs this. What does the output look like, and why does the same code start working "by itself" when they upgrade to 1.22?

<details><summary>Answer</summary>

**Bug.** On Go 1.21 and earlier:

```
square charged 100
square charged 100
square charged 100
```

Each closure captures the *variable* `name`, not its value at the time of construction. The `for` loop reuses one `name` variable across iterations; by the time the closures are called, `name` holds the last value (`"square"`).

On Go 1.22+, `for` loop variables are per-iteration. Each closure captures a *different* `name`. The output becomes:

```
stripe charged 100
paypal charged 100
square charged 100
```

**Why it's there.** From `junior.md` §12.3: this is one of the oldest Go gotchas. It manifests anywhere you build a slice of strategies (or goroutines, or handlers) inside a `for ... range` loop. The Go 1.22 release notes warned that some bugs *fix themselves* when teams upgrade — and some *new* bugs appear, because code that relied on the old aliasing behaviour now breaks.

**How to spot in review.** Any closure constructed inside a `for ... range` loop that references the loop variable. In a repo that mixes Go versions, you can't assume 1.22 semantics; until `go.mod`'s `go 1.22` directive applies globally, the old rule is in force.

The fix is identical in both versions, costs nothing, and removes the version-dependent behaviour:

**Fix.**

```go
for _, name := range names {
    name := name   // shadow with a per-iteration local
    chargers = append(chargers, func(amount int) string {
        return fmt.Sprintf("%s charged %d", name, amount)
    })
}
```

Or take the argument explicitly:

```go
for _, name := range names {
    chargers = append(chargers, makeCharger(name))
}

func makeCharger(name string) ChargeFunc {
    return func(amount int) string {
        return fmt.Sprintf("%s charged %d", name, amount)
    }
}
```

Both versions of Go give the right answer regardless of language version.

**Why it's common.** The whole point of building a slice of strategies is to let the *caller* pick one and invoke it later. Closures with stale captures defeat the purpose: every strategy in the slice is the same strategy. The bug is invisible until invocation, by which time the loop has long terminated.
</details>

---

## Bug 4: Registry race condition

```go
package codec

type Codec interface {
    Encode([]byte) []byte
    Decode([]byte) ([]byte, error)
}

var registry = map[string]Codec{}

func Register(name string, c Codec) {
    registry[name] = c
}

func Get(name string) (Codec, bool) {
    c, ok := registry[name]
    return c, ok
}

// in a long-running server:
func handleUpload(w http.ResponseWriter, r *http.Request) {
    name := r.URL.Query().Get("codec")
    c, ok := codec.Get(name)
    if !ok {
        http.Error(w, "unknown codec", 400)
        return
    }
    // ... use c.Encode / c.Decode ...
}

// elsewhere, an admin endpoint:
func handleAdminRegister(w http.ResponseWriter, r *http.Request) {
    name := r.FormValue("name")
    codec.Register(name, newCodecFromForm(r))
}
```

**Question.** Production runs fine for weeks. Then one Friday a single request returns garbage and the next one crashes with `fatal error: concurrent map read and map write`. What happened?

<details><summary>Answer</summary>

**Bug.** A normal `handleUpload` reads from `registry`. Concurrently, an admin `handleAdminRegister` writes. Go maps are *not* safe for concurrent read+write — the runtime detects it and aborts the program with the unrecoverable `fatal error`.

The reason it took weeks: usually `Register` is called only at startup (from `init()` functions of imported packages). If the admin endpoint exists but is never used in production, the bug stays asleep. The first admin click in months wakes it up.

**Why it's there.** From `middle.md` §5: the registry pattern's "init-time only" assumption breaks the moment any caller writes to the registry after the program has started. The map needs explicit synchronisation, or a different data structure (`sync.Map`, or a read-mostly atomic pointer to an immutable map).

**How to spot in review.** Any package-level `map[string]X` with `Register` and `Get` functions. If `Register` is called at runtime (not just `init`), the map needs locking. If `Register` is *only* called from `init` and the rule is documented, locking is unnecessary — but make the rule explicit so a future contributor doesn't add an admin endpoint and miss the synchronisation requirement.

**Fix — Option A: explicit mutex.**

```go
var (
    mu       sync.RWMutex
    registry = map[string]Codec{}
)

func Register(name string, c Codec) {
    mu.Lock()
    defer mu.Unlock()
    registry[name] = c
}

func Get(name string) (Codec, bool) {
    mu.RLock()
    defer mu.RUnlock()
    c, ok := registry[name]
    return c, ok
}
```

`sync.RWMutex` favours readers (the common case), serialises writers.

**Fix — Option B: `sync.Map`.**

```go
var registry sync.Map

func Register(name string, c Codec) {
    registry.Store(name, c)
}

func Get(name string) (Codec, bool) {
    v, ok := registry.Load(name)
    if !ok { return nil, false }
    return v.(Codec), true
}
```

Faster under contention; the type-assertion on `Load` is the cost. Use `sync.Map` when registration happens frequently *and* reads dominate (the documented profile for it).

**Fix — Option C: forbid runtime registration.**

```go
// Register may only be called during init.
// Calling after the server has started races with Get.
func Register(name string, c Codec) {
    if started.Load() { panic("codec: Register after start") }
    registry[name] = c
}
```

Loud failure during development, no overhead in production. Only viable when admin-style registration isn't a real requirement.

**Why it's common.** The `init()`-only convention is a *cultural* invariant, not a compile-time one. The first admin endpoint that calls `Register` is the developer who breaks the convention without knowing it exists. The first user to hit that endpoint is the one who learns about it.
</details>

---

## Bug 5: `init()`-time panic from a strategy

```go
package metrics_datadog

type DatadogClient struct {
    conn net.Conn
}

func (d *DatadogClient) Submit(metric string, value float64) {
    fmt.Fprintf(d.conn, "%s:%f|g\n", metric, value)
}

func newDatadogClient() *DatadogClient {
    conn, err := net.Dial("udp", os.Getenv("DD_AGENT_HOST")+":8125")
    if err != nil {
        panic(fmt.Errorf("metrics_datadog: %w", err))
    }
    return &DatadogClient{conn: conn}
}

func init() {
    metrics.Register("datadog", newDatadogClient())
}
```

**Question.** A developer adds `_ "myorg/metrics_datadog"` to `main.go` to make Datadog available. Three things can go wrong before `main()` runs. List them.

<details><summary>Answer</summary>

**Bug — three failure modes.**

1. **`DD_AGENT_HOST` is empty.** `net.Dial("udp", ":8125")` connects to the local interface and may succeed silently — but every submitted metric vanishes. The program looks healthy; no metrics arrive at Datadog. Worse than a panic, because there's no signal anything is wrong.

2. **`DD_AGENT_HOST` is set but the agent isn't running.** UDP dials usually succeed even without a listener — UDP is connectionless. Same outcome: metrics fly into the void.

3. **Real-world failure: testing.** Run `go test ./...` for the package that consumes `metrics`. Go imports every transitive dependency, including `_ "myorg/metrics_datadog"` if any production code uses it. The test binary's `init()` runs `newDatadogClient()`. If `DD_AGENT_HOST` resolution fails on the dev laptop's DNS — `panic`. The test suite refuses to start. Symptom: `cannot test package: panic during init`. Cause: a metrics package thousands of lines from the test, doing network I/O in `init()`.

**Why it's there.** From `junior.md` §12.4 and `middle.md` §5: `init()` should be cheap, deterministic, and side-effect-free *beyond* registry registration. Blocking I/O, environment-variable reads, and network dials in `init()` are documented anti-patterns. The Strategy registry tempts you because "the strategy should be ready to use when looked up". Resist.

**How to spot in review.** Any `init()` that does more than register a *factory* or a *fully-static* value. In particular:

- `init()` calls a constructor that does I/O.
- `init()` reads environment variables (acceptable, but only for static config).
- `init()` panics for any reason other than "this build is fundamentally broken".

**Fix — register a factory, not an instance.**

```go
package metrics_datadog

func newDatadogClient(host string) (*DatadogClient, error) {
    conn, err := net.Dial("udp", host+":8125")
    if err != nil {
        return nil, fmt.Errorf("datadog: %w", err)
    }
    return &DatadogClient{conn: conn}, nil
}

func init() {
    metrics.RegisterFactory("datadog", func() (metrics.Sink, error) {
        host := os.Getenv("DD_AGENT_HOST")
        if host == "" {
            return nil, errors.New("datadog: DD_AGENT_HOST not set")
        }
        return newDatadogClient(host)
    })
}
```

Now `init()` just hands the registry a closure. The expensive work runs when *someone asks for the datadog sink at runtime*, with proper error propagation.

**Fix — lazy initialisation.**

```go
type DatadogClient struct {
    once sync.Once
    conn net.Conn
    err  error
}

func (d *DatadogClient) ensure() error {
    d.once.Do(func() {
        d.conn, d.err = net.Dial("udp", os.Getenv("DD_AGENT_HOST")+":8125")
    })
    return d.err
}

func (d *DatadogClient) Submit(metric string, value float64) {
    if err := d.ensure(); err != nil { return }
    fmt.Fprintf(d.conn, "%s:%f|g\n", metric, value)
}
```

`init()` constructs the struct (cheap); the dial happens the first time `Submit` is called. The cost is the `sync.Once` check on every call (~1 ns); the benefit is the test binary's `init()` no longer panics in environments without Datadog.

**Why it's common.** Putting work in `init()` feels clean — "the package boots itself, nothing to remember". The cost shows up in tests, in alternative deployment environments (local dev, CI runners, customer-installed binaries), and in any place the runtime context differs from production. By the time you discover the dependency, the registration pattern feels load-bearing and the panic is somebody else's problem.
</details>

---

## Bug 6: Interface too wide, stubs that lie

```go
type PaymentProvider interface {
    Charge(ctx context.Context, amount int) (string, error)
    Refund(ctx context.Context, chargeID string) error
    Capture(ctx context.Context, authID string, amount int) error
    Authorize(ctx context.Context, amount int) (string, error)
}

type StripeProvider struct{ apiKey string }

func (s *StripeProvider) Charge(ctx context.Context, amount int) (string, error) {
    return "stripe_ch_xxx", nil
}
func (s *StripeProvider) Refund(ctx context.Context, id string) error    { return nil /* stripe call */ }
func (s *StripeProvider) Capture(ctx context.Context, a string, amt int) error { return nil /* stripe call */ }
func (s *StripeProvider) Authorize(ctx context.Context, amt int) (string, error) { return "stripe_auth_xxx", nil }

// New provider added later, only supports Charge:
type CashAppProvider struct{}

func (c *CashAppProvider) Charge(ctx context.Context, amount int) (string, error) {
    return "ca_xxx", nil
}
func (c *CashAppProvider) Refund(_ context.Context, _ string) error   { return nil } // TODO: not supported
func (c *CashAppProvider) Capture(_ context.Context, _ string, _ int) error { return nil } // TODO
func (c *CashAppProvider) Authorize(_ context.Context, _ int) (string, error) { return "", nil } // TODO

// in a refunds service:
func processRefund(p PaymentProvider, chargeID string) error {
    if err := p.Refund(context.Background(), chargeID); err != nil {
        return err
    }
    return nil
}
```

**Question.** A new feature wires up Cash App. Operations works. A few weeks later, customer service files a ticket: "ten refunds requested for Cash App customers, zero money returned, no errors logged." What's the bug?

<details><summary>Answer</summary>

**Bug.** `CashAppProvider.Refund` returns `nil`. The interface forced every provider to implement every method; the developer who added Cash App didn't want to fail the compile, so they stubbed the unsupported methods with `return nil`. The refund service has no way to know "this call is a no-op". It logs success. Cash App refunds silently fail.

The stubs *lie*. `Refund` claims to have succeeded by returning `nil`. The contract of `PaymentProvider.Refund` (implicitly: "refund this charge or return an error") is violated.

**Why it's there.** From `middle.md` §3 and `junior.md` §11.2: the interface is too wide. `PaymentProvider` models the *union* of capabilities ("any payment provider does charge + refund + capture + authorize"), but real providers are heterogeneous. The interface segregation principle says: split the wide interface into narrow ones, and let each provider satisfy only what it supports.

**How to spot in review.** Any implementation with a method body that:

- Returns `nil` with no logic.
- Returns "not supported" as an error.
- Logs a TODO.
- Returns a zero value.

These are surface symptoms of a deeper problem: the interface contains methods the implementation can't honour. The compiler doesn't notice; the runtime says "success" with no actual effect.

**Fix.** Segregate:

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type Refunder interface {
    Refund(ctx context.Context, chargeID string) error
}

type Authorizer interface {
    Authorize(ctx context.Context, amount int) (string, error)
    Capture(ctx context.Context, authID string, amount int) error
}

type StripeProvider struct { /* ... */ }

func (s *StripeProvider) Charge(...) (string, error)    { /* ... */ }
func (s *StripeProvider) Refund(...) error              { /* ... */ }
func (s *StripeProvider) Authorize(...) (string, error) { /* ... */ }
func (s *StripeProvider) Capture(...) error             { /* ... */ }

// Cash App only implements Charger:
type CashAppProvider struct{}
func (c *CashAppProvider) Charge(...) (string, error) { /* ... */ }
```

The refunds service now takes `Refunder`:

```go
func processRefund(r Refunder, chargeID string) error {
    return r.Refund(context.Background(), chargeID)
}
```

A `*CashAppProvider` does *not* satisfy `Refunder`. Passing it to `processRefund` is a *compile error*. The mismatch is caught before the code runs.

For an existing wide interface you can't immediately rewrite, the intermediate fix is the optional-interface pattern (`middle.md` §12.3):

```go
type Charger interface { Charge(ctx context.Context, amount int) (string, error) }

func canRefund(c Charger) (Refunder, bool) {
    r, ok := c.(Refunder)
    return r, ok
}

// in the service:
r, ok := canRefund(provider)
if !ok {
    return errors.New("provider does not support refunds")
}
return r.Refund(ctx, chargeID)
```

Now "not supported" is a real error, surfaced at the call site, not a lying `nil`.

**Why it's common.** Wide interfaces are designed *before* the variety of implementations is known. The first implementation supports everything; the abstraction looks fine. The second implementation supports half; the developer stubs the gap. By the third implementation, the interface is a fiction — every method exists on every type, but several types' methods do nothing. Splits are easy at the design stage and painful after a year of integrations.
</details>

---

## Bug 7: `==` on strategies that contain reference types

```go
type Strategy interface {
    Apply([]int) []int
}

type FilterStrategy struct {
    Allowed map[int]bool
    Tags    []string
}

func (f FilterStrategy) Apply(in []int) []int {
    out := make([]int, 0, len(in))
    for _, x := range in {
        if f.Allowed[x] {
            out = append(out, x)
        }
    }
    return out
}

func isSame(a, b Strategy) bool {
    return a == b
}

// caller:
func main() {
    s1 := FilterStrategy{Allowed: map[int]bool{1: true, 2: true}, Tags: []string{"a"}}
    s2 := FilterStrategy{Allowed: map[int]bool{1: true, 2: true}, Tags: []string{"a"}}
    fmt.Println(isSame(s1, s2))
}
```

**Question.** What happens at the marked line?

<details><summary>Answer</summary>

**Bug.** `panic: runtime error: comparing uncomparable type payment.FilterStrategy`. The interface comparison `a == b` dispatches to the concrete type's equality, and `FilterStrategy` contains a map field. Maps in Go are *not comparable* — there's no defined `==` for them. The runtime detects it and panics.

If `FilterStrategy` had only the `[]string` field (slices are also not comparable), the same panic fires. The check is dynamic: the *type* must be comparable; the compiler only catches it for *direct* struct comparisons, not for interface-mediated ones.

**Why it's there.** From `middle.md` §16.4: comparing interfaces with `==` works only when the wrapped concrete types are comparable. Comparable types are: booleans, numbers, strings, pointers, channels, interfaces (recursively), arrays of comparables, and structs whose every field is comparable. Maps, slices, and functions are *not* comparable.

The compiler permits `a == b` (both interfaces) because *some* concrete types are comparable. It defers the check to runtime — where it panics if the actual type isn't.

**How to spot in review.** Any `==` between two interface values where the wrapped concrete types could contain maps, slices, or functions. The smell is hard to grep for because `==` looks innocuous. A useful audit: search for `==` and `!=` near interface variables, then check whether the concrete types satisfying the interface are comparable.

**Fix — Option A: don't compare strategies for equality.** Most of the time, "are these the same strategy?" is a question you don't actually need answered. Strategies are usually identified by *role*, not by *value*. If you find yourself reaching for `==`, ask whether identity (`*StripeProvider` vs `*PayPalProvider`) or naming (the registry key) would serve.

```go
func isSame(a, b Strategy) bool {
    return reflect.TypeOf(a) == reflect.TypeOf(b)
}
```

Comparing *types* (always comparable) instead of *values*.

**Fix — Option B: pointer identity.** If every strategy is constructed once and shared, pointer equality answers the question:

```go
type Strategy interface { Apply([]int) []int }

var (
    standardFilter = &FilterStrategy{ /* ... */ }
    strictFilter   = &FilterStrategy{ /* ... */ }
)

func isSame(a, b Strategy) bool {
    return a == b // both wrap pointers; pointer comparison is safe
}
```

Pointers are comparable. Two interfaces wrapping the same pointer compare equal; two wrapping different pointers don't. No panic.

**Fix — Option C: explicit equality method.**

```go
type Equatable interface {
    Equals(Strategy) bool
}

func (f FilterStrategy) Equals(other Strategy) bool {
    o, ok := other.(FilterStrategy)
    if !ok { return false }
    if len(f.Allowed) != len(o.Allowed) { return false }
    for k, v := range f.Allowed {
        if o.Allowed[k] != v { return false }
    }
    return slices.Equal(f.Tags, o.Tags)
}

func isSame(a, b Strategy) bool {
    if e, ok := a.(Equatable); ok {
        return e.Equals(b)
    }
    return false
}
```

Explicit, no surprises, comparable types are checked at compile time inside `Equals`.

**Why it's common.** Most beginners learn `==` works on primitives and assume it works on structs. It usually does — until the struct embeds a map or slice. Once that struct goes through an interface, the compile-time guard is gone. The first time the program hits the line in production, the panic surfaces.
</details>

---

## Bug 8: Strategy swapped mid-iteration

```go
type Filter interface {
    Keep(item int) bool
}

type Processor struct {
    filter Filter
}

func (p *Processor) SetFilter(f Filter) { p.filter = f }

func (p *Processor) ProcessAll(items []int) []int {
    out := make([]int, 0, len(items))
    for _, it := range items {
        if p.filter.Keep(it) {
            out = append(out, it)
        }
    }
    return out
}

// in a background goroutine, reading config updates:
func watchConfig(p *Processor, updates <-chan Filter) {
    for f := range updates {
        p.SetFilter(f)
    }
}

func main() {
    p := &Processor{filter: AllowAll{}}
    updates := make(chan Filter)
    go watchConfig(p, updates)

    // operator pushes a new filter mid-stream:
    go func() {
        time.Sleep(50 * time.Millisecond)
        updates <- DenyAll{}
    }()

    result := p.ProcessAll(makeBigSlice())
    fmt.Println(len(result))
}
```

**Question.** A million-item slice arrives at the same moment the operator pushes the `DenyAll` filter. What's wrong with the output, and what's the deeper bug?

<details><summary>Answer</summary>

**Bug — surface.** The output is some prefix of the input followed by an abrupt cutover. The first 700,000 items pass `AllowAll`; the last 300,000 hit `DenyAll`. The result has 700,000 items — neither "all" nor "none". The caller expected an atomic decision.

**Bug — deeper.** Two problems are intertwined:

1. **Data race.** `ProcessAll` reads `p.filter` once per item without synchronisation. `watchConfig` writes `p.filter` from another goroutine. Without a mutex or atomic, this is a data race — the race detector (`go test -race`) flags it. On some hardware, the reader may see *neither* the old nor the new pointer, but a torn write — and panic with a nil-method invocation.

2. **Semantic incoherence.** Even with synchronisation, the result is undefined. Half the items see one strategy; half see another. The caller has no way to reason about the output.

**Why it's there.** From `middle.md` §8 and the broader lesson: strategies have *lifetime*. The lifetime of a strategy used inside a loop should match the lifetime of the loop. Mutating the strategy out from under the consumer is the same shape of bug as mutating a slice while iterating it — Go doesn't forbid it, but the result is incoherent.

**How to spot in review.** Any `Set`-style setter on a `Processor`-style object whose contents are read inside loops or methods called from multiple goroutines. The smell is "the strategy can be replaced at runtime", combined with "the consumer reads the strategy without locking".

**Fix — Option A: snapshot the strategy at the top of the operation.**

```go
func (p *Processor) ProcessAll(items []int) []int {
    p.mu.RLock()
    f := p.filter
    p.mu.RUnlock()

    out := make([]int, 0, len(items))
    for _, it := range items {
        if f.Keep(it) {
            out = append(out, it)
        }
    }
    return out
}

func (p *Processor) SetFilter(f Filter) {
    p.mu.Lock()
    defer p.mu.Unlock()
    p.filter = f
}
```

One lock acquisition per `ProcessAll` call. The strategy is captured into a local; the loop uses the local; the operator's update applies to the *next* call.

**Fix — Option B: atomic pointer.**

```go
type Processor struct {
    filter atomic.Pointer[Filter]  // Go 1.19+
}

func (p *Processor) SetFilter(f Filter) {
    p.filter.Store(&f)
}

func (p *Processor) ProcessAll(items []int) []int {
    f := *p.filter.Load()
    out := make([]int, 0, len(items))
    for _, it := range items {
        if f.Keep(it) {
            out = append(out, it)
        }
    }
    return out
}
```

Slightly faster than the mutex when reads dominate, no risk of forgetting to lock.

**Fix — Option C: pass the strategy in.**

```go
func (p *Processor) ProcessAll(items []int, f Filter) []int {
    out := make([]int, 0, len(items))
    for _, it := range items {
        if f.Keep(it) {
            out = append(out, it)
        }
    }
    return out
}
```

The strategy is now an *argument*, not a field. The caller picks the strategy for the call; the processor has no mutable state. The race vanishes by removing the shared field.

**Why it's common.** The setter-based API feels natural — "configure the processor once, run many operations". The mutability is implicit. The bug arrives the day someone adds the second goroutine.
</details>

---

## Bug 9: `ChargeFunc` adapter that calls itself

```go
type Charger interface {
    Charge(ctx context.Context, amount int) error
}

type ChargeFunc func(ctx context.Context, amount int) error

func (f ChargeFunc) Charge(ctx context.Context, amount int) error {
    return f.Charge(ctx, amount) // (!)
}
```

**Question.** A caller writes the chain below. What happens?

```go
var c Charger = ChargeFunc(func(ctx context.Context, amount int) error {
    fmt.Println("charging", amount)
    return nil
})
c.Charge(context.Background(), 100)
```

<details><summary>Answer</summary>

**Bug.** Infinite recursion. The runtime expands the stack until it hits `runtime: goroutine stack exceeds 1000000000-byte limit`, then panics with `fatal error: stack overflow`.

The intended body of the adapter method is `return f(ctx, amount)` — calling the *underlying function value*. The author wrote `return f.Charge(ctx, amount)`, which calls the *method* on `f` (a `ChargeFunc`), which dispatches back into the same method. Infinite tail call.

The compiler is happy. `f.Charge(...)` is a valid call: `f` is `ChargeFunc`, which has a `Charge` method, which takes `(ctx, amount)`. The recursion is invisible at the type level.

**Why it's there.** From `middle.md` §4: the adapter pattern is `HandlerFunc.ServeHTTP(w, r) { f(w, r) }`. The body calls `f` *as a function*, not as `f.ServeHTTP`. The point of the adapter is to translate "interface method call" to "raw function call". Calling the method recursively defeats the purpose.

A junior writes `f.Charge(...)` because they're thinking "this method should call Charge". The right phrase is "this method should call the underlying function".

**How to spot in review.** Adapter pattern with a method body that calls the *same method name* on the receiver. The fix is one character — remove the method dispatch:

**Fix.**

```go
func (f ChargeFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount) // call the function value directly
}
```

Or with a name binding for clarity:

```go
type ChargeFunc func(ctx context.Context, amount int) error

func (f ChargeFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount)
}
```

A test that asserts a `ChargeFunc` produces the expected side effect catches this on the first run — the stack overflow is immediate.

**Why it's common.** The adapter pattern is one of those Go idioms that looks magical when you first see it. The named function type with a method on itself is unusual. The first time a developer writes one from memory, they fall back to "well, the method should do what its name says", which means dispatching to the method. The right mental model is "the method *wraps* the function value, exposing it through an interface".

A useful trick: name the parameter `fn` in your head when reading. `func (fn ChargeFunc) Charge(...) error { return fn(...) }`. The "fn(...)" form makes the function-call vs method-call distinction visible.
</details>

---

## Bug 10: Decorator wrapping the wrong receiver

```go
type Charger interface {
    Charge(ctx context.Context, amount int) (string, error)
}

type LoggingCharger struct {
    Inner Charger
    Log   *log.Logger
}

func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Charge(ctx, amount) // (!)
    if err != nil {
        l.Log.Printf("Charge failed: %v", err)
    }
    return id, err
}

func main() {
    var c Charger = &LoggingCharger{
        Inner: &StripeGateway{},
        Log:   log.Default(),
    }
    c.Charge(context.Background(), 100)
}
```

**Question.** What's wrong, and which line is the cause?

<details><summary>Answer</summary>

**Bug.** Stack overflow, identical shape to Bug 9. The line `id, err := l.Charge(ctx, amount)` dispatches into `LoggingCharger.Charge` — itself. The intent was `l.Inner.Charge(ctx, amount)`. The author typed `l.` and IDE autocomplete filled in `Charge` (the obvious method); the `Inner.` got lost.

The log line `"Charge: amount=100"` prints once and the program crashes — every recursive call also prints, until the stack overflows. Production logs show the line repeating thousands of times in milliseconds, then the panic.

**Why it's there.** From `middle.md` §11: decorators wrap a strategy and *delegate* to the inner strategy. The delegation must reach `l.Inner`, not `l`. The mistake is a typo, but the type system can't catch it: both `l.Charge` and `l.Inner.Charge` have the same signature.

**How to spot in review.** Decorator methods (a method on a type with an `Inner SomeInterface` field) whose body calls the same-named method *without* going through `Inner`. Grep pattern: in any method on a struct with a field of interface type, the body must reference the field at least once. If the only call is `l.X(...)` for a method `X` defined on the same type, infinite recursion.

A stricter rule: write decorators with the inner field always referenced as `r.Inner.Method`, never `r.Method`. The discipline keeps the typo out.

**Fix.**

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Inner.Charge(ctx, amount)
    if err != nil {
        l.Log.Printf("Charge failed: %v", err)
    }
    return id, err
}
```

For complex decorator chains, embed the inner interface to make the "wrapped" relationship explicit:

```go
type LoggingCharger struct {
    Charger              // promoted; calls without prefix go to the embedded interface
    Log *log.Logger
}
```

Now `Charger.Charge` is *promoted* into `LoggingCharger`'s method set. But to *override* it with logging, you still need the explicit method definition — and inside that method, `l.Charger.Charge(ctx, amount)` explicitly calls the embedded interface, not the local override.

```go
func (l *LoggingCharger) Charge(ctx context.Context, amount int) (string, error) {
    l.Log.Printf("Charge: amount=%d", amount)
    id, err := l.Charger.Charge(ctx, amount) // disambiguated
    if err != nil { l.Log.Printf("Charge failed: %v", err) }
    return id, err
}
```

The `l.Charger.` prefix makes the intent obvious to the reader. `l.Charge` would still recurse — Go's method resolution prefers the outer type's method when both are available.

**Why it's common.** Decorator code is repetitive (log, retry, cache, ...). Copy-pasting a working decorator and forgetting to update the inner reference is the classic source. A unit test that wraps a stub and calls through the decorator catches it instantly — the stub's call count goes from "1 expected" to "stack overflow".
</details>

---

## Bug 11: Shared instance from `Register("name", new(T))`

```go
package codec

type Codec interface {
    Encode([]byte) []byte
    Decode([]byte) ([]byte, error)
}

type GzipCodec struct {
    level int
    buf   bytes.Buffer
}

func (g *GzipCodec) Encode(in []byte) []byte {
    g.buf.Reset()
    w, _ := gzip.NewWriterLevel(&g.buf, g.level)
    w.Write(in)
    w.Close()
    out := g.buf.Bytes()
    return out
}

func (g *GzipCodec) Decode(in []byte) ([]byte, error) { /* ... */ return nil, nil }

func init() {
    Register("gzip", &GzipCodec{level: gzip.DefaultCompression})
}

// in two handlers running in parallel:
func handleUploadA(w http.ResponseWriter, r *http.Request) {
    c, _ := Get("gzip")
    body, _ := io.ReadAll(r.Body)
    encoded := c.Encode(body)
    w.Write(encoded)
}

func handleUploadB(w http.ResponseWriter, r *http.Request) {
    c, _ := Get("gzip")
    body, _ := io.ReadAll(r.Body)
    encoded := c.Encode(body)
    w.Write(encoded)
}
```

**Question.** A user uploads a 1KB image to `/A`. At the same moment, another user uploads a 1KB document to `/B`. What does each get back?

<details><summary>Answer</summary>

**Bug.** A mix of bytes from both uploads, or a panic, or one user gets the other's encoded data. The `GzipCodec` instance is *singleton* (registered once in `init`), and its `buf` field is shared across every caller. Two parallel `Encode` calls race on `g.buf.Reset()`, `g.buf.Write(...)`, and `g.buf.Bytes()`.

`encoded := c.Encode(body)` returns a slice pointing into `g.buf`'s internal storage. By the time the handler writes `encoded` to the response, another goroutine may have called `g.buf.Reset()` and `g.buf.Write(...)` — overwriting the bytes the slice points at.

Possible outcomes:
- `/A`'s response contains some of `/B`'s body bytes.
- The response is truncated (the buffer was reset before the writer finished).
- Internal corruption in `bytes.Buffer` causes a panic.

**Why it's there.** From `middle.md` §5 (registry pattern, factory variant): when the strategy has internal mutable state, the registry must register a *factory*, not an instance. `Register("gzip", &GzipCodec{})` shares one instance across the whole program. Every goroutine that fetches `"gzip"` from the registry gets the same pointer.

The bug is invisible until the first concurrent request. On a low-traffic dev server, the race never fires. On production, it's the first time you see two encodes overlap.

**How to spot in review.** Look at every `Register(name, value)` call. If `value` is a pointer to a type with mutable state (buffer, counter, cache, anything that changes on method calls), the registry is sharing state across all callers. Either the type must be safe for concurrent use, or it must be registered as a factory.

A direct heuristic: a strategy type with method receivers that *mutate* `*T` should never be registered as a singleton. Only stateless strategies (or thread-safe ones) belong in a singleton registry.

**Fix — register a factory.**

```go
type Factory func() Codec

var registry = map[string]Factory{}

func Register(name string, f Factory) {
    registry[name] = f
}

func Get(name string) (Codec, error) {
    f, ok := registry[name]
    if !ok { return nil, errors.New("unknown") }
    return f(), nil
}

// gzip side:
func init() {
    Register("gzip", func() Codec {
        return &GzipCodec{level: gzip.DefaultCompression}
    })
}
```

Each `Get("gzip")` produces a fresh `*GzipCodec` with its own buffer. No sharing, no race.

**Fix — make the codec stateless.**

```go
type GzipCodec struct{ level int }

func (g GzipCodec) Encode(in []byte) []byte {
    var buf bytes.Buffer  // local; one per call
    w, _ := gzip.NewWriterLevel(&buf, g.level)
    w.Write(in)
    w.Close()
    return buf.Bytes()
}
```

The buffer is now a local variable. Concurrent calls each have their own. Singleton registration is safe.

For Go's standard library `gzip.Writer`, the `sync.Pool` idiom is the canonical way to reuse buffers without sharing them:

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func (g GzipCodec) Encode(in []byte) []byte {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)
    w, _ := gzip.NewWriterLevel(buf, g.level)
    w.Write(in)
    w.Close()
    out := append([]byte(nil), buf.Bytes()...) // copy out — the buf returns to the pool
    return out
}
```

The pool amortises the allocation cost without sharing state between concurrent callers. Note the `append([]byte(nil), ...)` — without it, the returned slice points at the pooled buffer, which the next caller will reset.

**Why it's common.** "Strategies should be cheap; let's make one and reuse it" is an instinctive optimisation. The cost (state sharing) only shows up under concurrency. The cure is to ask, for every strategy: *is this safe to call from multiple goroutines simultaneously?* If the answer is no, it can't be a singleton.
</details>

---

## Bug 12: Type assertion checked once, then trusted

```go
type Resolver interface {
    Resolve(name string) (string, error)
}

type Cacher interface {
    Cache(key, value string)
}

func processBatch(resolvers []Resolver, names []string) {
    var cacheable []Cacher
    for _, r := range resolvers {
        if c, ok := r.(Cacher); ok {
            cacheable = append(cacheable, c)
        }
    }

    for _, name := range names {
        for _, r := range resolvers {
            value, err := r.Resolve(name)
            if err != nil { continue }
            for _, c := range cacheable {
                c.Cache(name, value)
            }
        }
    }
}

// in tests:
func TestProcessBatch(t *testing.T) {
    r := &mockResolver{values: map[string]string{"a": "1"}}
    processBatch([]Resolver{r}, []string{"a"})
}

// elsewhere a developer adds a hot-swap mechanism:
func swap(r Resolver, with Resolver) {
    // pretend this rewires the resolver in place via some registry...
    // the existing []Resolver slice still holds the OLD reference, though.
}
```

**Question.** The test passes. In production, an operator hot-swaps a `*CachingResolver` (satisfies both `Resolver` and `Cacher`) for a `*PlainResolver` (only satisfies `Resolver`) mid-batch. What happens to the next iteration?

<details><summary>Answer</summary>

**Bug.** The `cacheable` slice was populated *before* the loop. It captured pointers to `Cacher` implementations as they existed at the start of `processBatch`. If a hot swap replaces the underlying resolver but the slice still holds the old reference, the slice keeps calling `Cache` on the *old* instance — which may have been deallocated, drained, or moved to a different role.

A milder version of the same bug: `cacheable` is populated, the assertion succeeds, then the resolver's *state* changes — for example, its internal cache map gets nilled out by a "reset". The `Cacher` interface is still satisfied (the method exists), but the method now panics because the cache is nil.

**Why it's there.** Type assertions check the *current* type at the *moment* of the assertion. They are not a subscription. If the underlying value can change (registry hot-swap, atomic pointer update, struct field assignment), an assertion captured earlier may refer to a state that no longer exists.

From `middle.md` §12.4: type assertions are powerful but assume the strategy's identity is stable for the duration of use. In a system with dynamic strategy swapping, the assumption breaks.

**How to spot in review.** Patterns like:

```go
caps := filterByCapability(strategies)  // type-asserts each
// ... later use caps ...
```

Where there's a separation in time between the assertion and the use. The longer the separation, and the more "mutable" the underlying strategy registry is, the more dangerous the cached assertion result.

**Fix — Option A: re-assert at use.** Pay the cost of the type assertion on every iteration:

```go
for _, name := range names {
    for _, r := range resolvers {
        value, err := r.Resolve(name)
        if err != nil { continue }
        if c, ok := r.(Cacher); ok {
            c.Cache(name, value)
        }
    }
}
```

The assertion is checked on every `Resolve` success. The strategy can swap underneath; the assertion sees the new value.

This is more work per iteration but stateless across the loop. Type assertions are cheap (~ns) — usually not worth optimising.

**Fix — Option B: snapshot the resolver list itself.** If the resolvers are stable for the duration of `processBatch`, copy the slice and trust the copy:

```go
func processBatch(resolvers []Resolver, names []string) {
    snapshot := make([]Resolver, len(resolvers))
    copy(snapshot, resolvers)

    var cacheable []Cacher
    for _, r := range snapshot {
        if c, ok := r.(Cacher); ok {
            cacheable = append(cacheable, c)
        }
    }
    // ... loop uses snapshot and cacheable consistently ...
}
```

This works only if the *strategies themselves* don't mutate underneath you. If `*CachingResolver` has a `Disable()` method that nilles its cache, snapshotting the slice doesn't help — you still hold a reference to the half-disabled object.

**Fix — Option C: forbid hot-swapping for the duration of a batch.** Use a lock or a versioning scheme to pin the strategy set for the duration of an operation. This is the cleanest answer when the strategy lifetime should match the operation lifetime.

**Why it's common.** Caching a type assertion result feels like a natural optimisation: "I've already checked this is a `Cacher`, why check again?" The assumption that "if it was a `Cacher` at time T, it's still a `Cacher` at time T+ε" holds in static systems and breaks in dynamic ones. Hot-reload, plugin systems, and any sort of runtime reconfiguration are the ones to watch.
</details>

---

## Bug 13: Embedded interface, ambiguous method

```go
type Reader interface {
    Read(p []byte) (int, error)
}

type Writer interface {
    Write(p []byte) (int, error)
}

type Closer interface {
    Close() error
}

type ReadCloser interface {
    Reader
    Closer
}

type WriteCloser interface {
    Writer
    Closer
}

type ReadWriteCloser interface {
    ReadCloser
    WriteCloser
}

type myConn struct{}

func (m *myConn) Read(p []byte) (int, error)  { return 0, nil }
func (m *myConn) Write(p []byte) (int, error) { return 0, nil }
func (m *myConn) Close() error                { return nil }

// elsewhere — different team adds a second composition:
type ClosingReadWriter struct {
    ReadCloser
    WriteCloser
}

func process(rwc ReadWriteCloser) {
    rwc.Close()
}
```

**Question.** A developer constructs `ClosingReadWriter{ReadCloser: someConn, WriteCloser: someConn}` and passes it to `process`. What happens at `rwc.Close()`?

<details><summary>Answer</summary>

**Bug.** Compile error: `ambiguous selector rwc.Close`. The `ClosingReadWriter` embeds two interfaces, each of which has its own `Close()`. Method promotion from embedding is *shadowed* when the same method name appears at the same depth from two embedded types — Go refuses to pick one for you.

The bug compiles only if `ClosingReadWriter` is *never* used through its `Close` method, or never assigned to `ReadWriteCloser`. The error fires the moment something tries to call `Close()` on a value of this type.

**Why it's there.** From the embedding semantics in the spec: when a struct embeds two types that both have a method `M`, neither is promoted. The struct must define `M` itself to disambiguate. Embedding the same *interface twice* through different parents (`ReadCloser` includes `Closer`; `WriteCloser` includes `Closer`) creates two paths to `Close()` — the diamond.

Some teams accept the diamond and add the explicit method:

```go
func (c ClosingReadWriter) Close() error {
    if err := c.ReadCloser.Close(); err != nil { return err }
    return c.WriteCloser.Close()
}
```

But now: which `Close` did the user want? If `ReadCloser` and `WriteCloser` both wrap the same `*myConn`, calling `Close` twice on the same connection may panic, double-free, or return "already closed". The semantics of the diamond aren't fixed by the language; the author has to pick.

**How to spot in review.** Any interface declaration that embeds two or more interfaces that share a common ancestor interface. `io.ReadWriteCloser` is fine — defined as `Reader + Writer + Closer`, three orthogonal methods. The problem is when an *aggregate* type embeds two *aggregates* that already overlap.

Grep pattern: structs that embed two or more interface types. Check the union of those interfaces' methods. If any method name appears in more than one, the struct has a diamond.

**Fix — Option A: embed concrete types, not interfaces.**

```go
type ClosingReadWriter struct {
    conn *myConn  // single field; methods promoted once
}
```

Now `Close()` is promoted from `*myConn` without ambiguity. The struct also doesn't pretend to compose two separate things — it's a thin wrapper over one connection.

**Fix — Option B: don't embed; define methods explicitly.**

```go
type ClosingReadWriter struct {
    r ReadCloser
    w WriteCloser
}

func (c ClosingReadWriter) Read(p []byte) (int, error)  { return c.r.Read(p) }
func (c ClosingReadWriter) Write(p []byte) (int, error) { return c.w.Write(p) }
func (c ClosingReadWriter) Close() error {
    // explicit choice: close both
    rErr := c.r.Close()
    wErr := c.w.Close()
    if rErr != nil { return rErr }
    return wErr
}
```

Verbose, but every dispatch is explicit. No diamond, no ambiguity, the close-twice question is answered in code.

**Fix — Option C: redesign.** Most "wrap two things into one ReadWriteCloser" needs are actually "give me a stream that connects A's output to B's input". `io.Pipe`, channels, or a goroutine pumping bytes through a buffer are more idiomatic than struct embedding.

**Why it's common.** Go's interface composition is elegant for small interfaces (`io.ReadWriter`, `io.ReadCloser`). The temptation to "compose the compositions" leads straight to the diamond. The compile error is loud but the fix-suggested-by-the-IDE ("add a Close method to disambiguate") sidesteps the real question of *what does Close even mean in this aggregate*.
</details>

---

## Bug 14: Strategy goroutine without cleanup

```go
type Refresher interface {
    Get(key string) (string, error)
}

type PollingRefresher struct {
    upstream Upstream
    cache    map[string]string
    interval time.Duration
}

func NewPollingRefresher(u Upstream, interval time.Duration) *PollingRefresher {
    p := &PollingRefresher{
        upstream: u,
        cache:    make(map[string]string),
        interval: interval,
    }
    go p.poll()
    return p
}

func (p *PollingRefresher) poll() {
    ticker := time.NewTicker(p.interval)
    for range ticker.C {
        // refresh the cache from upstream
        for key := range p.cache {
            v, err := p.upstream.Fetch(key)
            if err == nil {
                p.cache[key] = v
            }
        }
    }
}

func (p *PollingRefresher) Get(key string) (string, error) {
    if v, ok := p.cache[key]; ok { return v, nil }
    v, err := p.upstream.Fetch(key)
    if err == nil { p.cache[key] = v }
    return v, err
}

// in tests:
func TestPolling(t *testing.T) {
    for i := 0; i < 100; i++ {
        r := NewPollingRefresher(&fakeUpstream{}, time.Millisecond)
        _, _ = r.Get("foo")
    }
}
```

**Question.** The test runs 100 iterations and exits. What's leaked, and how do you detect it?

<details><summary>Answer</summary>

**Bug.** 100 leaked goroutines, plus 100 leaked tickers, plus 100 maps that can never be garbage-collected. Each `NewPollingRefresher` spawns a `poll()` goroutine that never exits — there's no signal, no context, no `Stop()` method. The goroutine holds a reference to `p`; `p` is therefore reachable; nothing in `p` is ever freed.

Even the data race in `poll`/`Get` (reading and writing `p.cache` without locking) is *less serious* than the leak — the program keeps running, just accumulates resources until OOM.

**Why it's there.** From the general Go idiom: every long-running goroutine needs a way to be stopped. A naked `go p.poll()` in a constructor is a one-way ticket; the constructor returns, the caller has no handle to the goroutine, and the goroutine runs forever — even after `p` is "no longer used".

The strategy pattern makes this especially tempting: "the strategy is self-managing; the consumer just calls `Get`". Self-managing is fine; *self-terminating without a signal* is not.

**How to spot in review.** Any `go ...` statement in a strategy constructor or initialiser. The questions to ask:
- How does the goroutine stop?
- Who is responsible for stopping it?
- What happens to the goroutine if the parent object is garbage-collected?

In Go, an object with a background goroutine *cannot* be garbage-collected naturally — the goroutine is a GC root, the object is reachable from the goroutine, and so the object lives until the goroutine exits.

**How to detect.** A goroutine-leak detector in tests:

```go
func TestPolling(t *testing.T) {
    n0 := runtime.NumGoroutine()
    for i := 0; i < 100; i++ {
        r := NewPollingRefresher(&fakeUpstream{}, time.Millisecond)
        _, _ = r.Get("foo")
    }
    time.Sleep(10 * time.Millisecond)
    n1 := runtime.NumGoroutine()
    if n1-n0 > 5 {
        t.Errorf("leaked %d goroutines", n1-n0)
    }
}
```

Or the canonical `uber-go/goleak` library, which integrates with `t.Cleanup` and reports stack traces.

**Fix — provide a cleanup mechanism.**

```go
type PollingRefresher struct {
    upstream Upstream
    cache    map[string]string
    interval time.Duration
    stop     chan struct{}
}

func NewPollingRefresher(u Upstream, interval time.Duration) *PollingRefresher {
    p := &PollingRefresher{
        upstream: u,
        cache:    make(map[string]string),
        interval: interval,
        stop:     make(chan struct{}),
    }
    go p.poll()
    return p
}

func (p *PollingRefresher) poll() {
    ticker := time.NewTicker(p.interval)
    defer ticker.Stop()
    for {
        select {
        case <-p.stop:
            return
        case <-ticker.C:
            // ...
        }
    }
}

func (p *PollingRefresher) Close() error {
    close(p.stop)
    return nil
}
```

Now callers must call `Close()` — typically `defer r.Close()` after `NewPollingRefresher`. The goroutine receives the signal and exits; the ticker is stopped; the object becomes eligible for GC.

**Fix — accept a context.**

```go
func NewPollingRefresher(ctx context.Context, u Upstream, interval time.Duration) *PollingRefresher {
    p := &PollingRefresher{ /* ... */ }
    go p.poll(ctx)
    return p
}

func (p *PollingRefresher) poll(ctx context.Context) {
    ticker := time.NewTicker(p.interval)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            // ...
        }
    }
}
```

The caller's context controls the lifetime. When the context is cancelled (HTTP request ends, server shuts down, test completes), the goroutine exits. This is the most Go-idiomatic version.

**Why it's common.** Background work for caches, watchers, schedulers, retries — all natural goroutine consumers. The strategy abstraction hides the goroutine from the caller, which is good API design *if* you also expose a lifecycle. Without it, every instantiation is a permanent leak.
</details>

---

## Bug 15: Goroutine-unsafe strategy used concurrently

```go
type RateLimitedCharger struct {
    inner    Charger
    requests int
    window   time.Time
}

func (r *RateLimitedCharger) Charge(ctx context.Context, amount int) (string, error) {
    now := time.Now()
    if now.Sub(r.window) > time.Second {
        r.window = now
        r.requests = 0
    }
    r.requests++
    if r.requests > 100 {
        return "", errors.New("rate limit exceeded")
    }
    return r.inner.Charge(ctx, amount)
}

// in a high-throughput server:
func handleCharge(w http.ResponseWriter, r *http.Request) {
    var amount int
    _ = json.NewDecoder(r.Body).Decode(&amount)
    id, err := globalCharger.Charge(r.Context(), amount)
    // ...
}

func main() {
    globalCharger = &RateLimitedCharger{inner: &StripeGateway{}}
    http.HandleFunc("/charge", handleCharge)
    http.ListenAndServe(":8080", nil)
}
```

**Question.** Production rolls this out and sees a burst of 10,000 charges in a second. Two things go wrong. List them.

<details><summary>Answer</summary>

**Bug — problem 1: data race on `requests` and `window`.** Every handler goroutine reads and writes the same fields without synchronisation. The race detector flags it instantly under load. In production without the race detector, the symptoms are:

- The check `r.requests > 100` may use a stale value. Some goroutines see `requests == 50` and pass; others see `99` and pass; the rate limit allows far more than 100/sec.
- `r.window = now` is a struct assignment (`time.Time` is two words on 64-bit platforms — a wall clock and a monotonic clock). Concurrent writes can tear the struct, producing a `window` value that's neither the old nor the new but a hybrid. The next `now.Sub(r.window)` returns garbage.

**Bug — problem 2: the rate limit is approximate.** Even with correct synchronisation, the algorithm has a bug: the window resets *to now* the moment a charge arrives in a new second. If 100 charges happen at 1.5s and 100 more at 2.4s (< 1 second apart in wall clock but spanning a window boundary), they all pass. The fixed-window algorithm allows bursts up to 2× the configured rate. This isn't a strategy bug per se, but it's the kind of correctness issue that lives in stateful strategies.

**Why it's there.** From `middle.md` §8 and §11: when a strategy has *state* and is *shared* (singleton, registered, or stored as a global), it must be safe for concurrent use. The strategy pattern itself doesn't make a thing thread-safe; the *implementation* must.

The shape `globalCharger = &RateLimitedCharger{...}` is the give-away: a single instance, shared across all handlers, with mutable internal state, no mutex.

**How to spot in review.** Any concrete strategy type with:
- A receiver pointer (`*T`).
- Methods that read and write the same fields.
- Storage as a global, in a registry, or as a struct field accessed by multiple goroutines.

Combine those three signals and the strategy is in a race. `go vet` won't help; the race detector will, on the first concurrent test.

**Fix — protect with a mutex.**

```go
type RateLimitedCharger struct {
    inner    Charger
    mu       sync.Mutex
    requests int
    window   time.Time
}

func (r *RateLimitedCharger) Charge(ctx context.Context, amount int) (string, error) {
    r.mu.Lock()
    now := time.Now()
    if now.Sub(r.window) > time.Second {
        r.window = now
        r.requests = 0
    }
    r.requests++
    over := r.requests > 100
    r.mu.Unlock()

    if over {
        return "", errors.New("rate limit exceeded")
    }
    return r.inner.Charge(ctx, amount)
}
```

Note the mutex is released *before* calling `r.inner.Charge`. The inner call is slow (network I/O); holding the lock across it serialises all charges through one mutex. The pattern is "check the rate limit fast, then do the slow call without the lock".

**Fix — use an atomic for simple counters.**

```go
type RateLimitedCharger struct {
    inner    Charger
    requests atomic.Int64
    window   atomic.Int64 // unix nano
}
```

More fiddly with `time.Time` (because of the dual clocks); stick with the mutex unless profiling shows the lock as a bottleneck.

**Fix — use a real rate limiter.**

```go
import "golang.org/x/time/rate"

type RateLimitedCharger struct {
    inner   Charger
    limiter *rate.Limiter
}

func (r *RateLimitedCharger) Charge(ctx context.Context, amount int) (string, error) {
    if !r.limiter.Allow() {
        return "", errors.New("rate limit exceeded")
    }
    return r.inner.Charge(ctx, amount)
}
```

`golang.org/x/time/rate.Limiter` is goroutine-safe by design, implements a proper token bucket, and handles the window-boundary edge case correctly. Hand-rolling rate limiters is a classic source of bugs — strategy decorator or not.

**Why it's common.** A strategy decorator that "tracks state" feels natural — wrap the inner charger, count, gate. The author wrote it as if a single goroutine would call it, because the *test* is single-threaded. Production is multi-goroutine by default (every HTTP request is a goroutine). The mismatch between the test environment and the production environment is where this bug lives.

A unit test that calls `Charge` from N goroutines simultaneously catches the race instantly with `-race`. Adding that test to your standard kit for any stateful strategy pays for itself.
</details>

---

## Summary

The bugs cluster around five themes.

1. **The interface boundary** (Bugs 1, 6, 13) — typed nil returned through an interface, interfaces too wide to be honestly implemented, embedding compositions that produce method ambiguity. Each one exploits the same fault line: the type system permits more than the contract intends.

2. **Receiver and identity** (Bugs 2, 9, 10) — value receivers losing mutations through interface copies, adapter methods that recurse instead of unwrap, decorators that wrap themselves. All three trace back to "which receiver does this call hit, and what state does it see?"

3. **Concurrency and lifetime** (Bugs 4, 5, 8, 11, 14, 15) — registry races, init-time blocking I/O, strategies swapped mid-loop, singletons with mutable state, leaked goroutines, hand-rolled rate limiters without locks. The strategy abstraction makes it easy to forget that strategies have lifetimes and threads; the runtime never forgets.

4. **Value semantics** (Bugs 3, 7) — pre-1.22 loop variable capture, `==` on strategies containing maps. Both compile fine and both produce surprising runtime behaviour.

5. **Composition over time** (Bug 12) — type assertions that were valid at the moment but stale by use. The assumption that "if a thing was X earlier, it's still X now" is broken by any mutable strategy registry.

The defences are the same across all of them: return concrete types from constructors, segregate wide interfaces into narrow ones, keep strategies stateless when possible and thread-safe when not, give every background goroutine a cancellation channel or context, prefer factories over singletons in registries, and let the race detector and a goroutine-leak check run on every test.

A unit test that constructs a strategy, runs it under `-race` from N goroutines, and checks goroutine counts before and after catches most of these before they ship. `go vet` catches few of them. Compile errors catch the diamond from Bug 13 and the chain-type degradation that motivates good interface design. Code review catches the rest — and now you know what to look for.

---

## Further reading

- `junior.md` §11 (common junior mistakes — naming, big interfaces, returning interfaces from constructors)
- `junior.md` §12 (tricky points — nil strategy, typed nil, loop capture, side effects in constructors)
- `middle.md` §3 (interface segregation in practice)
- `middle.md` §4 (the interface + function adapter)
- `middle.md` §5 (strategy registries — pros, cons, factory variants)
- `middle.md` §8 (strategy lifetime and allocation)
- `middle.md` §10 (nil-interface and typed-nil traps)
- `middle.md` §11 (Strategy ↔ Decorator interop)
- `middle.md` §16 (receiver kind, method values, empty interface as strategy)
- Go 1.22 loopvar change: https://go.dev/blog/loopvar-preview
- `uber-go/goleak`: https://github.com/uber-go/goleak
- `golang.org/x/time/rate`: https://pkg.go.dev/golang.org/x/time/rate
- The Go memory model: https://go.dev/ref/mem
