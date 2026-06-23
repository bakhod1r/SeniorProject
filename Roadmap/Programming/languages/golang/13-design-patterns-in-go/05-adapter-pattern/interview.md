# Adapter Pattern — Interview Preparation

## 1. What interviewers test for

The Adapter pattern looks deceptively simple. Interviewers probe four areas:

1. **Recognition** — Can you tell Adapter apart from Decorator, Facade, and Proxy?
2. **Idiomatic shape** — Do you reach for the `XxxFunc` named-function-type adapter when appropriate, or always write structs?
3. **Boundary discipline** — Do you place adapters at package boundaries (hexagonal), or sprinkle them everywhere?
4. **Production traps** — Do you spot lossy translation, typed-nil returns, leaky concrete types in someone else's code?

Signals by level:

| Level | What they're looking for |
|-------|--------------------------|
| Junior | "Why use an adapter at all?" — articulate the structural-typing limit |
| Middle | Pick the right shape (object vs function vs interface adapter) for a scenario |
| Senior | Design the *interface*, not just the adapter; talk about API evolution; know real ecosystems |

A red flag at any level: confidently calling Adapter what's actually Decorator or Facade. Pattern names matter when discussing with non-Go colleagues; misnaming signals you don't know the differences.

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

### Q1. What is the Adapter pattern? When would you use it in Go?

**Answer:** A pattern that wraps a type to make it satisfy a different interface than the one it natively has. Used when you don't own the underlying type — third-party libraries, legacy code, generated stubs — and can't add methods to it directly. The adapter is a thin struct (or named function type) that translates calls between the source and target interfaces.

**Common wrong answer:** "It changes how a function behaves." That's Decorator. Adapter changes the *shape*, not the *behaviour*.

**Follow-up:** Would Go's structural typing make this pattern unnecessary?

> No. Structural typing helps when method names *happen* to match. When they don't — `Send(buf []byte)` vs `Write([]byte) (int, error)` — you still need an adapter.

---

### Q2. Show me the simplest adapter.

**Answer:**

```go
type Source struct{}
func (s *Source) Send(buf []byte) error { /* ... */ return nil }

type Adapter struct{ S *Source }

func (a *Adapter) Write(p []byte) (int, error) {
    if err := a.S.Send(p); err != nil { return 0, err }
    return len(p), nil
}

// Now *Adapter satisfies io.Writer
```

**Junior signal:** Two methods that look similar but have different signatures — recognising this is *the* core competence.

---

### Q3. What's the difference between Adapter and Decorator?

**Answer:**

- **Adapter** changes the *interface* (you adapt one shape to another).
- **Decorator** preserves the *interface* but adds *behaviour* (logging, retry, caching).

Mnemonic: Adapter has *two* interface names involved; Decorator has *one*.

**Common wrong answer:** "Adapter is simpler than Decorator." Not necessarily — they're orthogonal. Some adapters do significant translation work.

---

### Q4. When should you NOT use Adapter?

**Answer:** When you own both ends of the interface. If you control the source and the target, just change one of them. Adapters earn their keep when one side is fixed (third-party SDK, generated code, legacy library).

**Follow-up:** What if the adapter would be only 5 lines anyway?

> If you own both ends, even 5 lines of adapter is technical debt. It hides the structural fix. Adapters between code you own are usually a sign you haven't decided on the right abstraction.

---

### Q5. Why do `http.HandlerFunc` and `http.Handler` coexist?

**Answer:** `http.Handler` is an interface (`ServeHTTP(...)`). `http.HandlerFunc` is a named function type with a `ServeHTTP` method that calls itself. The result: you can pass *either* a struct that implements `Handler` *or* a plain `func(w, r)` — both work as `Handler`.

This is the canonical "named-function-type adapter" idiom in Go. Five lines of code, dramatically improved API.

**Junior signal:** Recognising this pattern is essential. Naming the trick clearly is bonus.

---

### Q6. What's wrong with this adapter?

```go
type Adapter struct{ Inner *Source }

func (a *Adapter) Write(p []byte) (int, error) {
    a.Inner.Send(p)
    return len(p), nil
}
```

**Answer:** The error from `Send` is dropped. The adapter always reports success. Fix:

```go
if err := a.Inner.Send(p); err != nil {
    return 0, err
}
return len(p), nil
```

**Why common:** Junior developers often focus on the "happy path" translation and forget that errors must propagate too.

---

### Q7. What's an "interface adapter"?

**Answer:** An adapter that wraps one interface to expose another. Example: `io.NopCloser(r io.Reader) io.ReadCloser` — takes an `io.Reader`, returns an `io.ReadCloser` with a no-op `Close()`.

**Follow-up:** Implement it.

```go
type nopCloser struct { io.Reader }
func (nopCloser) Close() error { return nil }
func NopCloser(r io.Reader) io.ReadCloser { return nopCloser{r} }
```

The embedded `io.Reader` provides `Read`; the struct adds `Close`. Seven lines.

---

### Q8. Should an adapter constructor return the concrete adapter type or the interface?

**Answer:** The interface. The whole point of the adapter is that consumers don't depend on the adapter's concrete type. Returning `*MyAdapter` ties callers to that type and prevents substitution.

**Exception:** When the adapter has methods *beyond* the target interface that callers might use. Even then, document it and consider whether those methods belong in the interface instead.

---

### Q9. What's the "compile-time interface check"?

**Answer:** `var _ Iface = (*Adapter)(nil)` — an unused variable declaration that forces the compiler to verify `*Adapter` satisfies `Iface`. If the adapter misses a method or has a wrong signature, the build fails at this exact line, not at a distant call site.

**Junior signal:** Knowing this idiom — and using it at every adapter definition — is a senior habit, but interviewers love seeing it from juniors.

---

### Q10. Adapter or Decorator?

```go
type Mailer interface { Send(ctx context.Context, m Msg) error }

type LoggingMailer struct { Inner Mailer; Log *log.Logger }
func (l *LoggingMailer) Send(ctx context.Context, m Msg) error {
    l.Log.Printf("sending: %v", m)
    return l.Inner.Send(ctx, m)
}
```

**Answer:** Decorator. The wrapper has the *same* interface as the wrapped (`Mailer`). It adds logging behaviour, doesn't change shape. Rename to clarify intent — `LoggingMailer` is fine, but it's not an "Adapter".

---

## 4. Middle questions

### Q1. Walk me through writing a two-way adapter.

**Answer:** When migrating between two APIs (say, legacy logger → slog), write *two* adapters:

- `LegacyToSlog` — wraps a legacy logger, exposes slog's interface.
- `SlogToLegacy` — wraps a slog logger, exposes legacy's interface.

Both adapters lose some information (structured keys → string formatting, or vice versa). Document the loss. The adapters are *migration scaffolding* — they should be deleted when the legacy API is gone.

**Follow-up:** What if the loss is unacceptable?

> Three options: (1) document and accept the loss for the migration window, (2) refactor the source/target so the mismatch goes away, (3) build a richer adapter that synthesises the missing data — usually a sign the migration is wrong.

---

### Q2. When would you use the function-adapter shape vs the object-adapter shape?

**Answer:**

- **Function adapter** (`type XxxFunc func(...)` with a method): when the target interface has *one* method, and you want callers to pass either a struct or a function. Cleanest for `http.Handler`-style APIs.

- **Object adapter** (struct with one or more methods): when the target interface has multiple methods, when the adapter has state, or when the adapter needs configuration at construction time.

**Middle signal:** Recognising when *both* shapes are appropriate and providing them in your API.

---

### Q3. How do you adapt a callback-style API to a context-aware interface?

**Answer:** Spawn a goroutine and race the callback against `ctx.Done()`:

```go
func (a *Adapter) Send(ctx context.Context, msg Msg) error {
    done := make(chan error, 1)
    a.legacy.SendAsync(msg, func(err error) { done <- err })
    select {
    case err := <-done: return err
    case <-ctx.Done(): return ctx.Err()
    }
}
```

**Trap:** If `ctx` cancels, the callback still runs in the background. The result is discarded (channel is buffered, the send doesn't block). Document that cancellation doesn't actually cancel the underlying operation.

---

### Q4. What's the "hexagonal architecture" view of adapters?

**Answer:** A.k.a. "ports and adapters". The architectural rule: every external dependency enters the system through an *adapter* at the package boundary. The domain code declares *ports* (interfaces it needs) but knows nothing about specific implementations. Adapters at the wiring layer (often `main()`) bridge ports to real systems.

**Payoff:**
- Domain code is testable without spinning up real systems.
- Swapping a vendor (Stripe → PayPal) is a `main()` change.
- Adapters are *thin* — they translate, nothing more.

**Middle signal:** Mentioning this without prompting shows architectural awareness.

---

### Q5. How does Go's `database/sql` use adapters?

**Answer:** Every database driver (`pq`, `pgx`, `mysql`) is an adapter implementing `database/sql/driver.Driver` and related interfaces. The `database/sql` package speaks to drivers through the interface; drivers self-register via `sql.Register("postgres", &pq.Driver{})` in their `init()`.

The architectural lesson: stdlib defines the *consumer* interfaces; third parties provide adapter *implementations*. Stdlib never imports third-party packages.

**Follow-up:** Why does `database/sql/driver` have so many interfaces?

> Capability segregation. Some drivers support context, some don't. Some support batch operations, some don't. Each capability is its own optional interface. `database/sql` checks at runtime: if a driver implements `ConnPrepareContext`, use that; otherwise fall back. This allows new features without breaking old drivers.

---

### Q6. You have a single source that needs to satisfy three different target interfaces. How do you structure it?

**Answer:** Two approaches:

1. **One struct, multiple methods.** The struct's method set covers all three interfaces. The same instance is usable wherever any of the three is expected.

2. **Three separate adapter structs.** Each adapter focuses on one target; they share the source by holding the same pointer. Pro: each adapter is independently composable. Con: more types.

Option 1 is more common in Go (capability sliced by interface). Use option 2 when adapters have meaningfully different state or behaviour.

---

### Q7. What's the "leaky adapter" anti-pattern?

**Answer:** An adapter that exposes the wrapped type, either through a public `Inner` field or an `Underlying()` accessor. Consumers can then reach past the adapter for "convenience" — and now your abstraction is broken. Changing the inner type means changing every caller that reached past.

**Fix:** Keep the wrapped type unexported. If callers need extra capability, add it to the interface or expose an optional interface.

---

### Q8. Show me how to test an adapter.

**Answer:** Three tests:

1. **Unit test** with a fake source. Verify the adapter translates correctly.

```go
fake := &fakeSource{}
a := &Adapter{Inner: fake}
a.Send(ctx, msg)
assert.Equal(t, fake.captured.To, msg.To)
```

2. **Round-trip test** for two-way adapters. Wrap one way, then the other; verify the message survives intact.

3. **Contract test** that runs against both the adapter and the real implementation. Catches Liskov violations.

---

### Q9. What does this do?

```go
type Adapter struct { Iface }
func (a Adapter) Method() { /* override */ }
```

**Answer:** Embeds `Iface`, which promotes all of `Iface`'s methods onto `Adapter`. The struct then *overrides* `Method` with its own implementation. Other methods on `Iface` are inherited; only `Method` is replaced.

**Trap:** If `Iface` gains a new method, `Adapter` inherits it silently. Sometimes good, sometimes bad. Be aware.

---

### Q10. You have a hot-path adapter being constructed per request. How do you optimize?

**Answer:** Pre-allocate the adapter at startup and reuse it. Adapters are usually stateless (or stateless after init), so a single instance is shareable across goroutines. The construction cost (an allocation + interface conversion) is paid once, not per request.

If the adapter genuinely needs per-request state, look at `sync.Pool` to reuse adapter structs across requests.

---

## 5. Senior questions

### Q1. How do you design an adapter API for a library?

**Answer:** Four principles:

1. **Small interfaces.** The fewer methods, the more consumers can adapt. 1-3 methods is ideal.
2. **Capability segregation.** Multiple narrow interfaces beat one wide one. Implementations adapt only what they support.
3. **Always provide the `XxxFunc` named-function-type adapter** for single-method interfaces.
4. **Optional interfaces for evolution.** New methods go into new interfaces; consumers check via type assertion.

**Senior signal:** Talking about *consumers writing adapters* — the perspective shift from "I'm writing the adapter" to "my users will write adapters".

---

### Q2. Walk through evolving an interface across major versions.

**Answer:**

- **v1.0**: Publish small interfaces. Each method is essential.
- **v1.x adding capability**: Use *optional interfaces*. Existing adapters keep working; new adapters opt in.
- **v2.0 changing signatures**: Add the new method via optional interface in v1.x. Wait for migration. In v2.0, drop the old method.

The migration spans a major version. Years, not weeks.

**Real example:** `database/sql/driver`'s context-aware methods (`PrepareContext`, `BeginTx`) were added as optional interfaces in Go 1.8. Old drivers still work; new drivers expose context support.

---

### Q3. When should an adapter be code-generated?

**Answer:** When the translation is *mechanical* and the source contract is large. Examples:

- `grpc-gateway` generates HTTP adapters from protobuf service definitions.
- `protoc-gen-go` generates Go structs from .proto files.
- `mockgen` generates test fakes from interface definitions.

**Trade-off:** Generated adapters are repetitive; humans get bored writing them. Code generation eliminates the boredom but adds a build step and obscures the resulting code from grep-ability.

Use code generation when the same translation pattern appears more than ~10 times. For one-offs, hand-write.

---

### Q4. The "god adapter" anti-pattern — recognise and refactor.

**Answer:** A single adapter that has grown to wrap one dependency but accumulated 30 methods and 5 collaborators. It's the only thing that knows how to talk to Postgres in the codebase.

**Refactor:**
1. Split by *responsibility*, not by *dependency*. A `UserStore` adapter, a `BillingStore` adapter, an `EventStore` adapter — each thin. They all happen to talk to Postgres; that's incidental.
2. Move cross-cutting concerns (logging, metrics, retry) out of the adapter into decorators.
3. Move policy decisions (which retry strategy, which cache TTL) out into configuration or domain layer.

The adapter ends up doing *only* translation. The other concerns live in separate types you can compose.

---

### Q5. How do you handle adapters in a microservices monorepo where multiple services share the same external dependencies?

**Answer:** Put adapters in a shared package (`pkg/adapters/stripe`, `pkg/adapters/sendgrid`). Services import the adapter and depend on the target interface in their own domain code. The shared adapter is maintained centrally; service domain logic varies.

**Trade-offs:**
- Pro: One place to fix bugs, one place to upgrade SDK versions.
- Con: Shared adapter sprawl. If one service needs a new method, adding it affects every consumer.

Mitigations: Capability segregation (small interfaces per use case) reduces the blast radius of changes.

---

### Q6. How do you make an adapter safe for high-QPS concurrent use?

**Answer:** Three options, in order of preference:

1. **Stateless.** The adapter holds only the source (which is itself concurrent-safe). All adapter methods are read-only. This is the gold standard.

2. **Stateless after init.** The adapter sets up some state in its constructor; afterwards, it's read-only. Safe for concurrent use without locking.

3. **Mutex-protected state.** The adapter has state that mutates per call (counters, caches, breakers). Wrap with `sync.Mutex` or use atomic types. Trade off: contention under load.

For 4 and beyond — connection pools, per-key state — design more carefully (sharded maps, sync.Pool).

---

### Q7. What's wrong with this constructor?

```go
func NewStripeAdapter(apiKey string) (*StripeAdapter, error) {
    client := stripe.New(apiKey)
    if err := client.Ping(); err != nil {
        return nil, err
    }
    return &StripeAdapter{client: client}, nil
}
```

**Answer:** Network I/O in the constructor. Three problems:

1. `main()` now blocks on Stripe's API before the service can boot.
2. If Stripe is down at startup, the service won't start.
3. Tests can't construct the adapter without faking the network.

**Fix:** Defer the ping to first use, or provide a separate `Verify(ctx) error` method that callers can invoke when they want to check connectivity.

---

### Q8. How do you decide adapter return type — concrete or interface?

**Answer:**

Default: return the *interface*. Consumers should depend on the contract, not the implementation. Mocking and substitution become trivial.

Exception: when consumers might use Adapter-specific methods (introspection, debug helpers), return the concrete pointer. But then those methods become *part of your API* — you can't remove or rename them without breaking consumers.

In doubt, return the interface. It's the safer default.

---

### Q9. Lossy translation — how do you handle it?

**Answer:** Three strategies:

1. **Document the loss.** Best when the loss is fundamental and unavoidable. E.g., legacy logger doesn't support structured fields, so they're flattened into a string.

2. **Synthesise.** Recreate the missing semantics where possible. E.g., for context cancellation in a callback-style API, race the callback against `ctx.Done()` (with caveats about the underlying call still running).

3. **Refuse to translate.** Return an error when the source can't fulfil the contract. E.g., a metrics adapter for a backend that doesn't support histograms can return `ErrUnsupported`.

Pick based on whether the loss is acceptable, recoverable, or fatal.

---

### Q10. When does Adapter become Facade?

**Answer:** When the adapter starts wrapping *multiple* underlying objects instead of one. An adapter has one source; a facade has many. As soon as your `OrderAdapter` holds a `*Repo`, a `*Mailer`, and a `*Payer`, you've crossed into Facade territory.

The rename is the easy part. The harder part: the facade has different design constraints (it usually exposes domain operations, not just translation). Recognising the transition is what avoids "adapter-named-thing that's actually a facade" in code reviews.

---

## 6. Live coding challenges

### Challenge 1: Adapt a callback API

**Prompt:** A third-party library exposes:

```go
type Client struct{}
func (c *Client) FetchAsync(id string, cb func(data []byte, err error))
```

Adapt it to your interface:

```go
type Fetcher interface {
    Fetch(ctx context.Context, id string) ([]byte, error)
}
```

**What's being tested:** Context handling for callback-style APIs. The classic adapter trap.

**Solution sketch:**

```go
type FetcherAdapter struct{ Client *Client }

func (a *FetcherAdapter) Fetch(ctx context.Context, id string) ([]byte, error) {
    type result struct { data []byte; err error }
    done := make(chan result, 1)
    a.Client.FetchAsync(id, func(data []byte, err error) {
        done <- result{data, err}
    })
    select {
    case r := <-done: return r.data, r.err
    case <-ctx.Done(): return nil, ctx.Err()
    }
}
```

**Follow-ups:**
- What happens if `ctx` cancels but the callback still runs? (Answer: callback writes to the buffered channel; result is discarded; no leak.)
- How would you cancel the underlying request? (Answer: the legacy API has no cancel. Document the limitation.)

---

### Challenge 2: Build the `http.HandlerFunc` equivalent for a custom interface

**Prompt:** You have:

```go
type Charger interface {
    Charge(ctx context.Context, amount int) error
}
```

Make any function with the right signature satisfy `Charger`.

**What's being tested:** The named-function-type adapter idiom.

**Solution:**

```go
type ChargerFunc func(ctx context.Context, amount int) error

func (f ChargerFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount)
}

// Compile-time check:
var _ Charger = ChargerFunc(nil)
```

Usage:

```go
c := ChargerFunc(func(ctx context.Context, amount int) error {
    return stripeClient.Charge(amount)
})
process(c)  // c is a Charger
```

---

### Challenge 3: Bridge slog ↔ legacy logger (two-way)

**Prompt:** Migrate from:

```go
type LegacyLogger interface {
    Info(args ...any)
    Error(format string, args ...any)
}
```

…to `log/slog`. Provide both adapters.

**Solution:**

```go
// Legacy → slog: lossy (positional → string)
type LegacyToSlog struct{ Slog *slog.Logger }

func (a *LegacyToSlog) Info(args ...any) {
    a.Slog.Info(fmt.Sprint(args...))
}
func (a *LegacyToSlog) Error(format string, args ...any) {
    a.Slog.Error(fmt.Sprintf(format, args...))
}

// slog → legacy: also lossy (key/value collapsed)
type SlogToLegacy struct{ L LegacyLogger }

// slog uses its Handler interface, not method names — adapter is more complex.
// For brevity, assume we adapt at the call-site level:

type slogToLegacyHandler struct{ L LegacyLogger }
func (h slogToLegacyHandler) Handle(_ context.Context, r slog.Record) error {
    if r.Level >= slog.LevelError {
        h.L.Error("%s", r.Message)
    } else {
        h.L.Info(r.Message)
    }
    return nil
}
func (h slogToLegacyHandler) Enabled(_ context.Context, _ slog.Level) bool { return true }
func (h slogToLegacyHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h slogToLegacyHandler) WithGroup(_ string) slog.Handler { return h }
```

**Follow-up:** Why is the slog → legacy direction more code? (Answer: slog has a Handler interface with multiple methods, plus structured attribute handling.)

---

### Challenge 4: Write `io.NopCloser` from scratch

**Prompt:** Implement `io.NopCloser` without looking it up.

**What's being tested:** Interface adapter via embedding.

**Solution:**

```go
type nopCloser struct {
    io.Reader
}

func (nopCloser) Close() error { return nil }

func NopCloser(r io.Reader) io.ReadCloser {
    return nopCloser{r}
}
```

**Discussion:**
- Why the empty method receiver? (Receiver isn't used.)
- Why unexported `nopCloser`? (Implementation hidden.)
- Why embed `io.Reader`? (Method promotion provides `Read` for free.)

---

### Challenge 5: Adapt a polling API to a streaming channel

**Prompt:** A library exposes:

```go
type Pollable interface {
    Poll(ctx context.Context) ([]Event, error)
}
```

Adapt to a streaming channel:

```go
type Streamer interface {
    Stream(ctx context.Context) (<-chan Event, error)
}
```

**Solution sketch:**

```go
type PollToStream struct {
    Pollable Pollable
    Interval time.Duration
}

func (p *PollToStream) Stream(ctx context.Context) (<-chan Event, error) {
    ch := make(chan Event, 100)
    go func() {
        defer close(ch)
        t := time.NewTicker(p.Interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                events, err := p.Pollable.Poll(ctx)
                if err != nil { return }
                for _, e := range events {
                    select {
                    case ch <- e:
                    case <-ctx.Done(): return
                    }
                }
            }
        }
    }()
    return ch, nil
}
```

**Follow-ups:**
- Goroutine leak prevention? (Done channel closes when ctx is cancelled.)
- Buffer size? (Heuristic; tune based on burst patterns.)
- Backpressure? (If consumer doesn't drain, we drop events when buffer fills. Or block — pick semantics.)

---

## 7. System design starters

### Starter 1: Legacy migration plan

**Prompt:** "We have a 200-package codebase with a custom logger. Migrate to `log/slog` without breaking everything."

**Direction:**

1. Introduce `log/slog` and a `slogToLegacy` adapter so existing legacy interfaces keep working.
2. New code is written against `slog`. Old code untouched.
3. Migrate packages one at a time, replacing `legacyLogger` parameter with `*slog.Logger`. Update tests.
4. After every legacy caller is converted, delete the adapter and the legacy interface.

**Trade-offs:** Speed vs disruption. Big-bang migration is faster but riskier; gradual migration takes longer but lets you back out.

---

### Starter 2: Third-party SDK boundary

**Prompt:** "We're integrating Stripe. The Stripe Go SDK is huge. How do we avoid coupling our entire codebase to Stripe?"

**Direction:**

1. Define a *minimal* `Payment` interface in your domain package (`Charge`, `Refund`).
2. In `adapters/stripe/`, write a `StripeAdapter` that implements `Payment` using the Stripe SDK.
3. Domain code accepts the `Payment` interface; only `main()` knows about Stripe.
4. Replacing Stripe with PayPal is a new adapter + `main()` change. Domain stays untouched.

**Trade-off:** If you only ever use Stripe, this is overhead. The payoff arrives when you swap or add a vendor.

---

### Starter 3: Ports-and-adapters layout

**Prompt:** "How would you structure a Go service that talks to PostgreSQL, SendGrid, and Stripe — all replaceable?"

**Direction:**

```
order/
    service.go        // depends on Repo, Mailer, Payer interfaces
    repo.go           // declares the Repo interface
    mailer.go         // declares the Mailer interface
    payer.go          // declares the Payer interface

adapters/
    postgres/
        repo.go       // implements order.Repo
    sendgrid/
        mailer.go     // implements order.Mailer
    stripe/
        payer.go      // implements order.Payer

cmd/server/
    main.go           // constructs adapters, injects into order.Service
```

The `order` package has no external dependencies beyond stdlib. Tests use fakes; production uses real adapters.

---

### Starter 4: Multi-vendor integration

**Prompt:** "We need to support both Stripe and PayPal. Sometimes we use both at once. How?"

**Direction:**

1. One `Payer` interface that both adapters implement.
2. Composition: route by request property (currency, country, user preference) to the right adapter.
3. Or use a *composite* adapter: implements `Payer`, internally picks which underlying payer to call.

```go
type SmartPayer struct {
    Stripe *StripeAdapter
    PayPal *PayPalAdapter
}

func (p *SmartPayer) Charge(ctx context.Context, req PayReq) error {
    if req.Method == "paypal" { return p.PayPal.Charge(ctx, req) }
    return p.Stripe.Charge(ctx, req)
}
```

`SmartPayer` is itself a `Payer`. Consumers don't know there are two underlying adapters.

---

### Starter 5: Deprecating an internal interface

**Prompt:** "Our internal `Storage` interface has 15 methods that no one uses anymore. How do we kill it without breaking the 30 implementations?"

**Direction:**

1. Audit which methods are actually called. Often, 3-4 do most of the work.
2. Create a new narrower interface (`Reader`, `Writer`) with just the live methods.
3. Add a *temporary adapter* that wraps any implementation of `Reader`+`Writer` as a `Storage` (with the unused methods returning errors).
4. Migrate call sites from `Storage` to `Reader`/`Writer`.
5. Delete the temporary adapter, the old `Storage` interface, and any methods on implementations that are no longer used.

The temporary adapter is the *bridge* that lets the change happen incrementally.

---

## 8. Traps and red flags

### Trap 1: Calling Adapter what's actually Decorator

```go
type LoggingMailer struct{ Inner Mailer }  // SAME interface — Decorator, not Adapter
```

Same interface = Decorator. Different interface = Adapter. Misnaming signals you don't know the difference.

---

### Trap 2: Exposing the adapter's concrete type

```go
func NewAdapter() *MyAdapter { return &MyAdapter{} }
```

Consumers tie themselves to `*MyAdapter`. Return the interface.

---

### Trap 3: Adapters that grow business logic

```go
func (a *Adapter) Send(...) error {
    if !validate(...) { /* ... */ }
    if a.cache.has(...) { return cached }
    a.metrics.inc()
    // ... 50 more lines ...
    return a.inner.Deliver(...)
}
```

This is a service masquerading as an adapter. Move business logic out (decorators, separate types). Adapters do translation, nothing else.

---

### Trap 4: Silently dropping context

```go
func (a *Adapter) Send(ctx context.Context, msg Msg) error {
    return a.legacy.Deliver(msg)  // ctx ignored
}
```

Context handling is *required*. At minimum: `if err := ctx.Err(); err != nil { return err }` before delegating. Better: race against `ctx.Done()` if the call is blocking.

---

### Trap 5: Returning typed nil

```go
func NewAdapter() Iface {
    var a *MyAdapter
    if shouldCreate { a = &MyAdapter{} }
    return a  // (a is nil, but the returned interface isn't nil!)
}
```

Returning a typed nil produces an interface value `(*MyAdapter, nil)` — non-nil interface wrapping a nil pointer. Callers checking `if i == nil` get `false`, then panic on call.

**Fix:** Return untyped `nil` explicitly when there's no value:

```go
if !shouldCreate { return nil }
return &MyAdapter{}
```

---

### Trap 6: Adapters that hold goroutines

```go
type Adapter struct{ /* ... */ }
func NewAdapter() *Adapter {
    a := &Adapter{}
    go a.backgroundLoop()  // ?
    return a
}
```

If the caller doesn't have a way to shut down the goroutine, you've leaked. Adapters with background work need a `Close() error` method that stops them — or a `ctx context.Context` argument to the constructor that, when cancelled, stops the goroutine.

---

### Trap 7: Hardcoded inner type

```go
type Adapter struct{ Inner *StripeClient }  // can't substitute PayPal
```

The adapter should hold an *interface*, not a concrete type. Otherwise the adapter is one-off, not a pattern.

---

### Trap 8: Lossy translation hidden in code

```go
func (a *Adapter) Info(msg string, kv ...any) {
    a.legacy.Print(msg)  // kv silently dropped
}
```

If translation can't preserve all input, the adapter must either:
- Synthesise the missing semantics (fold kv into the string).
- Document the loss loudly in package docs.

Silent loss is a correctness bug.

---

### Trap 9: Constructor performing I/O

```go
func NewAdapter(apiKey string) (*Adapter, error) {
    client := api.New(apiKey)
    if err := client.Ping(); err != nil { return nil, err }  // network in constructor
    return &Adapter{client: client}, nil
}
```

Defer to first use, or expose a separate `Verify(ctx)` method. Constructors that block on the network are surprising and break startup ordering.

---

### Trap 10: Calling type assertions without `ok`

```go
func process(c Charger) {
    invalidator := c.(Invalidator)  // panic if c doesn't implement Invalidator
    invalidator.Invalidate()
}
```

Use the comma-ok form:

```go
if inv, ok := c.(Invalidator); ok {
    inv.Invalidate()
}
```

Otherwise a runtime panic is one bad input away.

---

## 9. Questions to ASK the interviewer

### Junior-level questions you can ask

- "Do you use functional options or builder pattern more often?" — signals you know the alternatives
- "How does your codebase handle the boundary between domain and infrastructure?" — invites the hexagonal discussion

### Middle-level questions

- "How do you decide when an adapter is too thick?"
- "Do you do contract testing across implementations?"

### Senior-level questions

- "How do you evolve adapter interfaces across major versions?"
- "What's your strategy for adapters that span multiple services in a monorepo?"
- "How do you balance hexagonal discipline against the overhead it adds?"

---

## 10. Cross-references

- **[../03-strategy-pattern/](../03-strategy-pattern/)** — Strategy is one interface, swappable implementations. Adapter is two interfaces, one bridge. Adjacent patterns.
- **[../04-decorator-pattern/](../04-decorator-pattern/)** — Same interface, added behaviour. Often confused with Adapter.
- **[../10-facade-pattern/](../10-facade-pattern/)** — When the adapter grows up. Multiple sources, one front.
- **[../11-proxy-pattern/](../11-proxy-pattern/)** — Same interface, controls access. Distinguishable but related.
- **[../01-functional-options/](../01-functional-options/)** — Adapter constructors with many configurable fields often use functional options.
- **[../06-factory-pattern/](../06-factory-pattern/)** — Constructors for adapters are often factories.

Adapters in Go are everywhere — `http.HandlerFunc`, `sort.Reverse`, `io.NopCloser`, every `database/sql` driver, every gRPC interceptor. Mastering this pattern is mostly about *recognising it in the wild* and not over-engineering when structural typing already does the job.
