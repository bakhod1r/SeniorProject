# Adapter Pattern — Middle

## 1. What this level adds

Junior taught the shape: an adapter wraps a "wrong shape" type and exposes a different interface. Middle is about the design judgement that surrounds it:

- Two-way adapters and inverse adapters — when both directions matter.
- Generic adapters (Go 1.18+) and where they actually help.
- Multi-interface adapters — wrapping one source as several targets.
- Adapter in dependency injection wiring — adapters at the package boundary.
- Testing adapters cleanly — fakes, contract tests, the "round-trip" check.
- The thin-adapter rule — when adapters grow, they're hiding a structural problem.
- Performance — interface conversions, escape analysis, when adapters add real cost.
- Adapter ↔ functional options interop — configuring the adapter at construction.

By the end you should be able to introduce an adapter without it becoming a permanent piece of architectural plumbing.

---

## 2. Table of Contents

1. [What this level adds](#1-what-this-level-adds)
2. [Table of Contents](#2-table-of-contents)
3. [Two-way adapters](#3-two-way-adapters)
4. [The thin-adapter rule](#4-the-thin-adapter-rule)
5. [Multi-interface adapters](#5-multi-interface-adapters)
6. [Generic adapter helpers](#6-generic-adapter-helpers)
7. [Adapter at the package boundary](#7-adapter-at-the-package-boundary)
8. [Adapter in dependency injection](#8-adapter-in-dependency-injection)
9. [Testing adapters](#9-testing-adapters)
10. [Lossy translation and what to do about it](#10-lossy-translation-and-what-to-do-about-it)
11. [Adapter ↔ functional options interop](#11-adapter--functional-options-interop)
12. [Coding patterns](#12-coding-patterns)
13. [Performance notes](#13-performance-notes)
14. [Common middle-level mistakes](#14-common-middle-level-mistakes)
15. [Debugging adapter bugs](#15-debugging-adapter-bugs)
16. [Tricky points](#16-tricky-points)
17. [Test](#17-test)
18. [Cheat sheet](#18-cheat-sheet)
19. [Summary](#19-summary)

---

## 3. Two-way adapters

Sometimes you have two parallel systems and need to bridge in both directions. A common case: gradually migrating from old to new without freezing the codebase.

```go
// Old:
package legacy
type Logger interface {
    Info(args ...any)
    Error(format string, args ...any)
}

// New:
package newpkg
type Logger interface {
    Info(msg string, kv ...any)
    Error(msg string, kv ...any)
}
```

You need:

- `LegacyToNew` — wrap a `legacy.Logger` so it satisfies `newpkg.Logger`.
- `NewToLegacy` — wrap a `newpkg.Logger` so it satisfies `legacy.Logger`.

```go
// Direction 1: legacy → new
type LegacyToNewLogger struct{ L legacy.Logger }

func (a *LegacyToNewLogger) Info(msg string, kv ...any) {
    a.L.Info(append([]any{msg}, kv...)...)
}
func (a *LegacyToNewLogger) Error(msg string, kv ...any) {
    a.L.Error("%s "+keyFmt(kv), append([]any{msg}, kv...)...)
}

// Direction 2: new → legacy
type NewToLegacyLogger struct{ N newpkg.Logger }

func (a *NewToLegacyLogger) Info(args ...any) {
    a.N.Info(fmt.Sprint(args...))
}
func (a *NewToLegacyLogger) Error(format string, args ...any) {
    a.N.Error(fmt.Sprintf(format, args...))
}
```

Two observations:

### 3.1 Each direction loses something

Going legacy → new gains structured key/value awareness, but we synthesise it from positional args (often lossy).

Going new → legacy *flattens* the key/value pairs into a single string, losing structure entirely.

Adapters are not bijections. They translate; they don't preserve.

### 3.2 Use one direction during migration, then delete

A migration plan:

1. Introduce `newpkg.Logger`. Wrap legacy callers in `NewToLegacyLogger` so existing code keeps working.
2. Migrate call sites one at a time to `newpkg.Logger`.
3. When all legacy callers are gone, delete `NewToLegacyLogger` and `legacy.Logger`.

The adapters are *scaffolding*. They live during the migration, then go away. If they're still around three years later, you didn't finish the migration — they're now permanent translation cost.

---

## 4. The thin-adapter rule

The rule: **an adapter's body should be a few lines, mostly argument-shuffling**.

```go
// Good — thin
func (a *Adapter) Send(ctx context.Context, msg Message) error {
    return a.inner.Deliver(msg.To, msg.Subject, msg.Body)
}

// Bad — thick
func (a *Adapter) Send(ctx context.Context, msg Message) error {
    // 30 lines of validation
    // 20 lines of retry logic
    // 10 lines of metric emission
    // 5 lines of fallback handling
    return a.inner.Deliver(msg.To, msg.Subject, msg.Body)
}
```

If the adapter has substantial logic, it's not an adapter anymore — it's a service. Two refactors put the logic back where it belongs:

- **Move the cross-cutting concerns to decorators.** Each becomes its own decorator wrapping the adapter; the chain is built explicitly.
- **Move the policy logic to the caller.** Sometimes "what to do on retry" is a domain decision, not a translation detail.

A 100-line adapter is a code smell. Two pieces of advice:

1. When you find yourself writing condition or validation inside the adapter, pause and ask whether it belongs in a decorator or the caller.
2. When the inner type's method signatures don't translate cleanly with simple argument-shuffling, you may need a domain-specific intermediate type, not a direct adapter. Define your own `Message`, `Sender`, etc., and adapt to *that*.

The thin-adapter rule keeps adapters disposable. Decorators and domain logic, which evolve and grow, stay separate.

---

## 5. Multi-interface adapters

Sometimes a single source type can satisfy several target interfaces — each with its own slice of the source's behaviour.

```go
// Source: a fully-featured SDK client
type SDKClient struct{ /* ... */ }

func (c *SDKClient) Get(ctx context.Context, id string) ([]byte, error)
func (c *SDKClient) Put(ctx context.Context, id string, data []byte) error
func (c *SDKClient) Watch(ctx context.Context, id string, ch chan<- Event) error

// Targets — narrow interfaces for distinct consumers:
type Reader interface { Get(ctx context.Context, id string) ([]byte, error) }
type Writer interface { Put(ctx context.Context, id string, data []byte) error }
type Watcher interface { Watch(ctx context.Context, id string, ch chan<- Event) error }
```

The SDK client satisfies *all three* interfaces because Go's interface satisfaction is structural. You don't need separate adapter structs — the SDK client *is* an adapter (it just happens to have the right method names).

When the names *don't* match, you need an explicit struct:

```go
type ReaderAdapter struct{ Inner *SDKClient }
func (r *ReaderAdapter) Read(ctx context.Context, id string) ([]byte, error) {
    return r.Inner.Get(ctx, id)
}

type WriterAdapter struct{ Inner *SDKClient }
func (w *WriterAdapter) Write(ctx context.Context, id string, data []byte) error {
    return w.Inner.Put(ctx, id, data)
}
```

Each adapter targets one interface. Consumers receive *only* what they need; capability is sliced by interface. This is the "consumer-defined interfaces" idiom — let each consumer declare what it needs, and adapters bridge if signatures don't match.

### 5.1 The single-struct multi-target adapter

If multiple targets share a struct (because the adapter has shared state — say, a logger or metrics client), one struct can implement all targets:

```go
type SDKAdapter struct {
    Inner *SDKClient
    Log   *log.Logger
}

func (a *SDKAdapter) Read(ctx context.Context, id string) ([]byte, error) {
    a.Log.Printf("Read: %s", id)
    return a.Inner.Get(ctx, id)
}
func (a *SDKAdapter) Write(ctx context.Context, id string, data []byte) error {
    a.Log.Printf("Write: %s", id)
    return a.Inner.Put(ctx, id, data)
}
func (a *SDKAdapter) Watch(ctx context.Context, id string, ch chan<- Event) error {
    a.Log.Printf("Watch: %s", id)
    return a.Inner.Watch(ctx, id, ch)
}
```

But notice: this is now an *Adapter+Decorator hybrid*. The logging is decoration; the method rename is adaptation. Many real adapters are like this. Don't fight it — name the struct after its dominant role (`SDKAdapter` if mostly translating, `LoggingSDKClient` if mostly decorating).

---

## 6. Generic adapter helpers

Go 1.18+ generics let you write adapters that work over type parameters. Usually small wins; occasionally meaningful.

### 6.1 The function-to-method adapter

```go
type Func[T, R any] func(ctx context.Context, in T) (R, error)

type Service[T, R any] interface {
    Do(ctx context.Context, in T) (R, error)
}

type funcSvc[T, R any] struct{ fn Func[T, R] }

func (f funcSvc[T, R]) Do(ctx context.Context, in T) (R, error) { return f.fn(ctx, in) }

func FuncAdapter[T, R any](fn Func[T, R]) Service[T, R] {
    return funcSvc[T, R]{fn: fn}
}
```

A generic `http.HandlerFunc`. The cost: every consumer of `Service[T, R]` must instantiate with concrete types. The win: one adapter file, no per-type duplication.

Useful when the same single-method interface appears parameterised by data type — say, a generic event bus, a generic cache, a generic retry helper.

### 6.2 The reverse-of-X helper

Recall `sort.Reverse` from junior §8 — a thin adapter that inverts `Less`. The same idea generically:

```go
type Comparer[T any] interface { Less(a, b T) bool }

type reverseCmp[T any] struct{ Inner Comparer[T] }
func (r reverseCmp[T]) Less(a, b T) bool { return r.Inner.Less(b, a) }

func ReverseComparer[T any](c Comparer[T]) Comparer[T] { return reverseCmp[T]{Inner: c} }
```

Now `ReverseComparer(myStringCmp)` returns a reversed comparer, regardless of what `T` is. With generics, one helper covers all element types.

### 6.3 When generics don't help

For application-specific adapters where source and target are domain types, generics rarely pay off. The adapter is going to be one function with concrete types; abstracting it into generics adds noise.

Rule of thumb: use generics for *infrastructure* adapters (helpers in a utility package, library code), not domain adapters.

---

## 7. Adapter at the package boundary

The most disciplined use of Adapter: place it at every package boundary so the package never depends on external types directly.

```go
// In the auth package:
package auth

// LoggerFunc — local interface for logging.
type LoggerFunc func(msg string)
```

```go
// Anywhere outside the auth package:
package main

import (
    "log/slog"
    "myapp/auth"
)

func main() {
    s := slog.New(/* ... */)
    a := auth.New(auth.LoggerFunc(func(msg string) { s.Info(msg) }))
}
```

The `auth` package declares its own logger interface. It doesn't import `log/slog` — it accepts an adapter to whatever logger you want. Result:

- `auth` is *unit-testable* without slog.
- `auth` doesn't pull `slog` (or any logging library) into its dependency graph.
- Swapping loggers is a `main()` change — no `auth` modifications.

This is "ports and adapters" / "hexagonal architecture" applied at the Go package level. The interface lives with the consumer; the implementation lives at the program boundary; the adapter bridges them.

Don't apply this universally — it adds boilerplate. But for *core* packages (domain logic, business rules), the discipline pays off: those packages stop carrying transitive dependencies on logging frameworks, metrics libraries, etc.

---

## 8. Adapter in dependency injection

When you wire up a program in `main()`, adapters become the connectors.

```go
func main() {
    // External dependencies
    db, _ := sql.Open("postgres", connStr)
    slogger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    stripeClient := stripe.New("sk_...")

    // Adapters at the boundary
    userRepo := adapters.NewUserRepo(db)             // *sql.DB → users.Repo
    logger   := adapters.NewSlogLogger(slogger)      // *slog.Logger → app.Logger
    payer    := adapters.NewStripePayer(stripeClient)// *stripe.Client → payments.Payer

    // Application services receive interfaces
    svc := app.NewService(userRepo, logger, payer)
    svc.Serve(":8080")
}
```

The application services depend only on their local interfaces. The adapters are the *only* code that imports external libraries. To swap an external dependency (Stripe → PayPal, slog → zap, Postgres → MySQL), you write a new adapter and change the wiring in `main`. No business logic changes.

This isn't unique to adapters — it's also how you'd structure DI with functional options or constructors. But adapters are the *type-level mechanism* that lets a `*stripe.Client` and a `*paypal.Client` be substitutable.

---

## 9. Testing adapters

Three patterns, each useful in different situations.

### 9.1 Adapter unit test with a fake source

```go
type fakeSnailMailer struct {
    deliverArgs struct{ to, subject, body string }
    deliverErr  error
}
func (f *fakeSnailMailer) Deliver(to, subject, body string) error {
    f.deliverArgs.to, f.deliverArgs.subject, f.deliverArgs.body = to, subject, body
    return f.deliverErr
}

func TestSnailMailAdapter_Send(t *testing.T) {
    f := &fakeSnailMailer{}
    a := &SnailMailAdapter{Inner: f}
    err := a.Send(context.Background(), mail.Message{To: "x@y", Subject: "S", Body: "B"})
    if err != nil { t.Fatal(err) }
    if f.deliverArgs.to != "x@y" { t.Errorf("to = %s", f.deliverArgs.to) }
}
```

The adapter's *only* responsibility is translation. The test verifies the translation is correct. No business logic to worry about.

### 9.2 Round-trip test (for two-way adapters)

```go
func TestLegacyNewLegacyRoundTrip(t *testing.T) {
    var captured string
    target := newpkg.LoggerFunc(func(msg string, kv ...any) { captured = msg })

    legacy := &NewToLegacyLogger{N: target}
    bridged := &LegacyToNewLogger{L: legacy}

    bridged.Info("hello", "user", "alice")

    if !strings.Contains(captured, "hello") {
        t.Errorf("captured = %q, want substring 'hello'", captured)
    }
}
```

Wrap one way, then the other; verify the message survives. Catches lossy translation problems.

### 9.3 Contract test against the target interface

```go
func runMailerContract(t *testing.T, m mail.Mailer) {
    t.Helper()
    err := m.Send(context.Background(), mail.Message{To: "x@y", Subject: "S", Body: "B"})
    if err != nil { t.Fatalf("Send: %v", err) }
}

func TestAdapterSatisfiesContract(t *testing.T) {
    runMailerContract(t, &SnailMailAdapter{Inner: &legacypkg.SnailMailer{}})
}
```

The same contract test runs against the real implementation, the adapter, and any mock. If the adapter passes the contract test, it's *substitutable* for the real thing.

This is Liskov substitution applied to Go. Worth investing in for adapters at critical boundaries.

---

## 10. Lossy translation and what to do about it

Adapters are *not* bijections. Information is lost in every translation. Examples:

- A `ctx context.Context` mapped onto a legacy library that doesn't accept context: cancellation can't propagate.
- A structured logger (`Info("msg", "user", id)`) mapped onto a sprintf-style logger: key/value semantics collapse into a string.
- A streaming API (`Watch(ch chan Event)`) mapped onto a polling API: events between polls might be missed.

When the loss is unacceptable, you have three options:

### 10.1 Document the loss

```go
// SnailMailAdapter adapts the legacy SnailMailer to the modern Mailer interface.
//
// The legacy library does not support context cancellation. Send checks ctx.Err()
// before delivering, but in-flight deliveries cannot be aborted. Callers that
// require cancellation guarantees should use a different Mailer implementation.
type SnailMailAdapter struct{ Inner *legacypkg.SnailMailer }
```

Sometimes the loss is acceptable but readers should know. Document loudly.

### 10.2 Synthesise what you can

For context cancellation:

```go
func (a *SnailMailAdapter) Send(ctx context.Context, msg Message) error {
    done := make(chan error, 1)
    go func() { done <- a.Inner.Deliver(msg.To, msg.Subject, msg.Body) }()
    select {
    case err := <-done: return err
    case <-ctx.Done():
        return ctx.Err()   // returns early, but the legacy call may still complete in the background
    }
}
```

You bought *cancellation* at the cost of a goroutine and the possibility that the legacy call still runs after the context expires. Usually a worse trade than just documenting the limitation.

### 10.3 Replace the source

If too much is lost and the adapter feels like fighting reality, the right move is to drop the adapter and write a native implementation. Forcing the wrong abstraction through translation rarely ends well.

---

## 11. Adapter ↔ functional options interop

Adapters often need configuration. Two ways to provide it.

### 11.1 Constructor parameters

```go
func NewSlogAdapter(s *slog.Logger, level slog.Level) *SlogAdapter {
    return &SlogAdapter{Slog: s, Level: level}
}
```

Simple for 1-2 fields. Multiplicates badly past 3.

### 11.2 Functional options

```go
type SlogAdapter struct {
    Slog     *slog.Logger
    Level    slog.Level
    Prefix   string
    AddSource bool
}

type Option func(*SlogAdapter)

func WithLevel(l slog.Level) Option        { return func(a *SlogAdapter) { a.Level = l } }
func WithPrefix(p string) Option            { return func(a *SlogAdapter) { a.Prefix = p } }
func WithSource() Option                    { return func(a *SlogAdapter) { a.AddSource = true } }

func NewSlogAdapter(s *slog.Logger, opts ...Option) *SlogAdapter {
    a := &SlogAdapter{Slog: s, Level: slog.LevelInfo}
    for _, o := range opts { o(a) }
    return a
}
```

For adapters with 3+ configurable fields, functional options keep the API tidy. Cross-reference: `01-functional-options/` for the full pattern.

---

## 12. Coding patterns

### 12.1 The "Adapter" suffix is OK, sometimes

Naming an adapter `XxxAdapter` is acceptable when the adapter's role is the dominant identity ("adapts X to Y"). Naming an *implementation* `XxxAdapter` is not — the adapter shouldn't leak as a type the caller depends on.

```go
// Good — the adapter is a private detail, public function returns the interface
func NewMailer(legacy *SnailMailer) Mailer {
    return &snailMailAdapter{inner: legacy}
}

// Bad — caller now ties code to *SnailMailAdapter
func NewSnailMailAdapter(legacy *SnailMailer) *SnailMailAdapter { ... }
```

### 12.2 The "FromX" constructor

```go
func MailerFromSnail(s *SnailMailer) Mailer { return &snailMailAdapter{inner: s} }
func MailerFromSMTP(c *smtp.Client) Mailer { return &smtpMailAdapter{inner: c} }
```

When you have multiple adapters producing the same target interface, naming them `FromX` makes the call site read naturally. Used in `time.Duration` (`Duration(5*time.Second)`), `bytes.NewReader`, etc.

### 12.3 The compile-time interface check

```go
var _ Mailer = (*snailMailAdapter)(nil)
```

This unused variable forces the compiler to check that `*snailMailAdapter` satisfies `Mailer`. If the adapter doesn't implement the interface (missed method, wrong signature), this line breaks the build. Add it next to every adapter definition.

### 12.4 The lazy-init adapter

```go
type StripePayer struct {
    apiKey string
    once   sync.Once
    client *stripe.Client
}

func (p *StripePayer) lazy() *stripe.Client {
    p.once.Do(func() { p.client = stripe.New(p.apiKey) })
    return p.client
}

func (p *StripePayer) Charge(ctx context.Context, amount int) error {
    return p.lazy().Charge(ctx, amount)
}
```

Defers expensive initialisation until first use. Useful when the adapter is constructed in `main()` but the wrapped library does I/O on construction. Adds complexity; only use when measured.

---

## 13. Performance notes

Adapters add one method call per operation. Numbers on Go 1.22 amd64:

```
BenchmarkDirectMethodCall-8       500000000   2.1 ns/op   0 B/op
BenchmarkAdaptedMethodCall-8      400000000   2.6 ns/op   0 B/op
BenchmarkInterfaceCallNoAdapter-8 300000000   3.2 ns/op   0 B/op
BenchmarkAdapterPlusInterface-8   200000000   4.0 ns/op   0 B/op
```

Observations:

- **Adapter alone adds ~0.5 ns.** Inlined easily, free in any realistic workload.
- **Interface call (no adapter) adds ~1 ns.** Indirect dispatch overhead.
- **Adapter + interface call** is additive — both costs apply, but it's still <5 ns.

In practice: never optimise away an adapter. The clarity benefit dwarfs the dispatch cost.

Where adapter cost shows up is in *escape analysis*: an adapter that boxes a value into an interface keeps the value on the heap if the interface escapes the function:

```go
func processAll(items []Item) {
    for _, item := range items {
        var c Charger = &ChargerAdapter{Item: item}  // interface conversion — escape?
        c.Charge(...)
    }
}
```

The `&ChargerAdapter{Item: item}` allocates on the heap if the compiler can't prove the interface stays in this stack frame. For a hot loop, that's millions of allocations.

Profile (`go test -benchmem`) to see if your adapters are escape-hot. If yes, refactor to use a pre-allocated adapter or to skip the interface conversion.

---

## 14. Common middle-level mistakes

### 14.1 Adapter ↔ Decorator confusion

```go
// Looks like an adapter but is a decorator
type CachingAdapter struct{ Inner Mailer }
func (c *CachingAdapter) Send(...) error { /* cache logic */ }
```

This is a decorator — the wrapped thing has the same interface as the wrapper. Renaming to `CachingMailer` clarifies. Adapters change the interface; decorators don't.

### 14.2 Adapter that does too much

```go
type ChunkyAdapter struct{ Inner Mailer; Cache *Cache; Metrics *Counter; Log *log.Logger }
```

Three collaborators turned the adapter into a junction box. Split: an adapter does the translation, a decorator chain adds the rest.

### 14.3 Storing adapters as concrete types

```go
// In some service struct
type Service struct {
    mailer *adapters.SlogMailAdapter   // concrete type, not interface
}
```

The whole point of an adapter is that the consumer doesn't care which one is used. Storing the concrete type defeats this. Use the interface (`mailer Mailer`).

### 14.4 Adapter for things you control

```go
// Wrong: you own both the source and target
package main

type internalLogger interface { Log(msg string) }

type mainLoggerAdapter struct { inner *MyLogger }
func (a *mainLoggerAdapter) Log(msg string) { a.inner.Print(msg) }
```

When you own both ends, just change one of them. Adapters earn their keep when one side is *fixed* (third-party, legacy, generated). For your own code, refactor the API.

### 14.5 Adapters that throw away errors

```go
func (a *Adapter) Send(ctx context.Context, msg Message) error {
    a.Inner.Deliver(msg.To, msg.Subject, msg.Body)  // discarded error
    return nil
}
```

Always propagate. Even if the legacy API doesn't return errors, the adapter should — perhaps `nil` for now, but the signature shouldn't silently lie.

---

## 15. Debugging adapter bugs

When the adapter behaves wrong, walk through it.

### 15.1 Verify the source is correct in isolation

Before suspecting the adapter, call the inner type directly:

```go
inner := &legacypkg.SnailMailer{}
err := inner.Deliver("x@y", "test", "body")
// if err != nil, the source is the problem, not the adapter
```

### 15.2 Log the translation

```go
func (a *Adapter) Send(ctx context.Context, msg Message) error {
    log.Printf("Adapter.Send: msg=%+v translating to (to=%s, subj=%s, body_len=%d)",
        msg, msg.To, msg.Subject, len(msg.Body))
    return a.Inner.Deliver(msg.To, msg.Subject, msg.Body)
}
```

Confirms the translation is what you think it is.

### 15.3 Compare round-trip vs original

For two-way adapters (§3), log what arrives at each end of a wrap-then-unwrap. Subtle bugs (string encoding, key ordering, struct zero values) show up here.

### 15.4 Reflect on type chains

```go
fmt.Printf("inner type: %T\n", a.Inner)
```

If `%T` shows an unexpected concrete type, the wrong source got injected. Common cause: DI wiring bug.

---

## 16. Tricky points

### 16.1 Interface conversion at the boundary

```go
func acceptMailer(m Mailer) {
    sender := m.(Sender)  // type assertion — depends on the concrete type behind m
    sender.SendBatch(...)
}
```

The function receives a `Mailer`, then assumes it's *also* a `Sender`. This works only when the underlying concrete type implements both. Adapters that implement only the target interface won't pass — even if the *source* implements `Sender` directly.

Fix: declare both interfaces in the consumer's signature, or stop reaching past the abstraction.

### 16.2 Methods returning interfaces lose adapter identity

```go
type Manager interface { Mailer() Mailer }

// Caller can't recover the underlying *SnailMailAdapter:
m := manager.Mailer()
adapter, ok := m.(*SnailMailAdapter) // works only if Manager.Mailer returned *SnailMailAdapter
```

Once an interface conversion happens, the concrete type is *hidden behind the interface*. Type assertions can recover it, but they're brittle. Design APIs so consumers don't need to assert.

### 16.3 Variadic adapter signatures

```go
// Source:
func (l *legacy.Logger) Print(args ...any)

// Target:
type Logger interface { Info(msg string) }

// Adapter:
type LegacyToNewLogger struct{ L *legacy.Logger }
func (a *LegacyToNewLogger) Info(msg string) {
    a.L.Print(msg)  // ✓
    // a.L.Print(msg, "extra")  // would also work, but you lose the structured shape
}
```

Variadic source methods can be tempting to use in interesting ways. Keep the adapter dumb: forward exactly what the target gives you, nothing more.

### 16.4 Adapting `error` types

```go
type StripeError struct{ Code string; Message string }
func (e *StripeError) Error() string { return e.Code + ": " + e.Message }

// In your service:
type PaymentError struct{ Reason string; Retryable bool }
func (e *PaymentError) Error() string { return e.Reason }

// Adapter:
func (a *StripePayer) Charge(...) error {
    err := a.Inner.Charge(...)
    if err == nil { return nil }
    var se *StripeError
    if errors.As(err, &se) {
        return &PaymentError{Reason: se.Message, Retryable: se.Code == "rate_limited"}
    }
    return err
}
```

Adapter translates errors as well as calls. Make sure the resulting error still wraps the original (`fmt.Errorf("...: %w", original)`) so `errors.Is`/`errors.As` work upstream.

---

## 17. Test

**Q1.** Spot the issue:

```go
func NewMailer(legacy *SnailMailer) *SnailMailAdapter {
    return &SnailMailAdapter{inner: legacy}
}
```

<details><summary>Answer</summary>

The constructor returns `*SnailMailAdapter` (concrete type). Callers now depend on `*SnailMailAdapter` instead of the `Mailer` interface — defeating the whole adapter pattern. Return `Mailer`.

Exception: if the adapter has extra methods the caller might want (rare, and usually a code smell), returning the concrete type and assigning to an interface variable is OK. The default is interface return.
</details>

**Q2.** Why is this lossy?

```go
type StructuredLogger interface { Info(msg string, kv ...any) }

type LegacyLogger struct { /* methods like Print(args ...any) */ }

type Adapter struct{ Inner *LegacyLogger }

func (a *Adapter) Info(msg string, kv ...any) {
    a.Inner.Print(msg)  // !
}
```

<details><summary>Answer</summary>

The `kv` arguments are dropped. The structured logger's key/value pairs never reach the legacy logger. Anyone passing `Info("login", "user", uid)` will see only "login" in logs.

Fix: fold the key/value pairs into the message string (`fmt.Sprintf("%s %v", msg, kv)`), or panic-with-explanation if the adapter cannot preserve them. Either is better than silent loss.
</details>

**Q3.** Which pattern is this?

```go
type LoggingMailer struct{ Inner Mailer; Log *log.Logger }

func (l *LoggingMailer) Send(ctx context.Context, msg Message) error {
    l.Log.Printf("Send: %v", msg)
    return l.Inner.Send(ctx, msg)
}
```

<details><summary>Answer</summary>

Decorator, not Adapter. The wrapper has the *same* interface as the wrapped (`Mailer`). It adds behaviour (logging), it doesn't change the interface. Rename to clarify intent.
</details>

---

## 18. Cheat sheet

| Situation | Approach |
|-----------|----------|
| Wrap a concrete type to satisfy an interface | Object adapter (struct + method) |
| Make a function satisfy a single-method interface | Function adapter (named func type + method) |
| Slice/widen one interface to another | Interface adapter (embed + override) |
| Migrate gradually between APIs | Two-way adapter; delete when done |
| One source, many targets | Multi-interface adapter (one struct, multiple methods) |
| Generic helper across types | Generic adapter (Go 1.18+) |
| Package boundary discipline | Local interface in consumer; adapter at the wiring layer |
| Adapter has business logic | Move to decorator or domain layer |
| Return type | Interface (the target), not concrete |
| Compile-time check | `var _ Target = (*adapter)(nil)` |
| Naming | `XFromY()` constructors; `XAdapter` only when role is dominant |

---

## 19. Summary

Adapter in Go is the unloved workhorse of integration. Mastery is:

- Recognising when *Adapter* fits vs Decorator/Facade/Proxy.
- Keeping the adapter thin — translation, not policy.
- Using two-way adapters as *migration scaffolding*, not permanent abstraction.
- Placing adapters at the package boundary to keep core packages dependency-free.
- Returning the target interface, not the adapter's concrete type.
- Adding compile-time checks (`var _ Target = (*adapter)(nil)`) so a missed method breaks the build.

The next step is **[senior.md](senior.md)** — adapter design in published libraries, evolving adapters across major versions, generic adapter infrastructure, contract testing for cross-package adapters, and real-world case studies (`net/http` Handler/HandlerFunc, `database/sql` driver, gRPC unary interceptors, OpenTelemetry instrumentation).
