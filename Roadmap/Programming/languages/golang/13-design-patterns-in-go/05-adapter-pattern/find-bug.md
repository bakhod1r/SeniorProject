# Adapter Pattern — Find the Bug

## 1. How to use this file

Fifteen short scenarios. Each has buggy adapter code. Read it, find the bug, then expand the answer to check. The bugs are *realistic* — each one comes from a failure mode you'll actually encounter in production Go code.

Difficulty varies. Some are obvious type-system traps; others are subtle runtime conditions that only surface under load.

---

## Bug 1 — Constructor returning concrete type

```go
package payments

type StripeAdapter struct { client *StripeClient }

func (a *StripeAdapter) Charge(ctx context.Context, amount int) error {
    return a.client.Charge(amount)
}

// constructor:
func NewStripeAdapter(c *StripeClient) *StripeAdapter {
    return &StripeAdapter{client: c}
}
```

Used like:

```go
var p *StripeAdapter = payments.NewStripeAdapter(client)
service.SetPayer(p)
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The constructor returns the concrete `*StripeAdapter` type. Callers depend on the implementation, not the abstraction. Substituting a `*PayPalAdapter` or a mock requires changing the caller's type, defeating the entire adapter pattern.

**Spot in review:** Adapter constructors that don't return the target interface. Also: variables typed as `*XxxAdapter` outside the adapter's own package.

**Fix:**

```go
type Payer interface {
    Charge(ctx context.Context, amount int) error
}

func NewStripeAdapter(c *StripeClient) Payer {
    return &StripeAdapter{client: c}
}
```

**Why common:** Junior developers focus on what the adapter *is*; senior developers think about what the consumer *needs*. The interface is the API surface; the struct is the implementation detail.
</details>

---

## Bug 2 — Silently dropping context

```go
type LegacyMailer struct{ /* no context support */ }
func (m *LegacyMailer) Deliver(to, subject, body string) error { /* ... */ }

type MailerAdapter struct { Inner *LegacyMailer }

func (a *MailerAdapter) Send(ctx context.Context, msg Message) error {
    return a.Inner.Deliver(msg.To, msg.Subject, msg.Body)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Context is ignored. If callers cancel the operation (timeout, request cancellation), the adapter doesn't know. The Deliver call keeps running until completion. Downstream code thinks the operation was aborted, but the email goes out anyway.

**Spot in review:** Adapter methods that accept `ctx context.Context` but don't reference `ctx` in the body. Linters can catch this (`golangci-lint contextcheck`).

**Fix:** At minimum, check before delegating:

```go
func (a *MailerAdapter) Send(ctx context.Context, msg Message) error {
    if err := ctx.Err(); err != nil { return err }
    return a.Inner.Deliver(msg.To, msg.Subject, msg.Body)
}
```

For *real* cancellation during the call, race against `ctx.Done()` in a goroutine — but the underlying call still runs to completion. Document the limitation.

**Why common:** Legacy libraries lack context support, and the easiest "translation" is to drop it. The bug is invisible until a timeout fails to fire.
</details>

---

## Bug 3 — Adapter dropping the inner error

```go
type Adapter struct { Inner *Source }

func (a *Adapter) Do(ctx context.Context) error {
    a.Inner.LegacyDo()
    return nil
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `LegacyDo` returns an error (assume so — even if you can't see the signature here, real code often does). The adapter ignores it and reports success. Errors disappear; downstream code thinks everything is fine.

**Spot in review:** Adapter methods that always return `nil`. Especially suspicious when the inner call is non-trivial (network, disk, lock acquisition).

**Fix:**

```go
func (a *Adapter) Do(ctx context.Context) error {
    return a.Inner.LegacyDo()
}
```

If the inner doesn't return an error and you want to add one (e.g., context check), wrap properly:

```go
func (a *Adapter) Do(ctx context.Context) error {
    if err := ctx.Err(); err != nil { return err }
    a.Inner.LegacyDo()  // doesn't return error
    return nil
}
```

**Why common:** Adapter authors writing in a hurry, focused on translating the *successful* path. Always wire errors through, even if the inner is "infallible" today.
</details>

---

## Bug 4 — Dropping variadic args

```go
type StructuredLogger interface {
    Info(msg string, kv ...any)
}

type LegacyLogger struct{}
func (l *LegacyLogger) Print(format string, args ...any) {
    fmt.Printf(format+"\n", args...)
}

type LogAdapter struct{ L *LegacyLogger }

func (a *LogAdapter) Info(msg string, kv ...any) {
    a.L.Print(msg)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `kv` is dropped. Structured key/value pairs never reach the legacy logger. `Info("login", "user", uid)` only logs "login"; `user=alice` is invisible.

**Spot in review:** Adapter methods that take variadic args but don't pass them to the inner.

**Fix:** Synthesise. Fold the key/value pairs into the message string or the args list:

```go
func (a *LogAdapter) Info(msg string, kv ...any) {
    if len(kv) == 0 {
        a.L.Print("%s", msg)
        return
    }
    var sb strings.Builder
    sb.WriteString(msg)
    for i := 0; i < len(kv); i += 2 {
        if i+1 < len(kv) {
            sb.WriteString(fmt.Sprintf(" %v=%v", kv[i], kv[i+1]))
        }
    }
    a.L.Print("%s", sb.String())
}
```

**Why common:** Variadic args are easy to forget. Linters don't always catch their unused-ness. Code reviewers should flag any variadic parameter not used in the method body.
</details>

---

## Bug 5 — Adapter that's secretly a Decorator

```go
type Cacher struct {
    Inner Payer
    cache map[string]chargeResult
}

func (c *Cacher) Charge(ctx context.Context, amount int) error {
    if r, ok := c.cache[fmt.Sprintf("%d", amount)]; ok { return r.err }
    err := c.Inner.Charge(ctx, amount)
    c.cache[fmt.Sprintf("%d", amount)] = chargeResult{err: err}
    return err
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug 1: It's not an adapter.** Same interface (`Payer`) in and out. The wrapper adds caching behaviour. This is a Decorator. Naming it `Cacher` (clearly behaviour-focused) is fine; naming it `Adapter` would be misleading.

**Bug 2: Concurrent map access.** `c.cache` is a regular `map[string]chargeResult` mutated without synchronisation. Two goroutines calling `Charge` concurrently can race on the map → panic.

**Spot in review:**
- Wrapper has the same interface as the wrapped → decorator, not adapter. (Naming aside, it's the same Go code, but conversation about it depends on the right vocabulary.)
- Map mutation without `sync.Mutex` or `sync.Map`.

**Fix:**

```go
type Cacher struct {
    Inner Payer
    mu    sync.Mutex
    cache map[string]chargeResult
}

func (c *Cacher) Charge(ctx context.Context, amount int) error {
    key := strconv.Itoa(amount)
    c.mu.Lock()
    r, ok := c.cache[key]
    c.mu.Unlock()
    if ok { return r.err }

    err := c.Inner.Charge(ctx, amount)

    c.mu.Lock()
    c.cache[key] = chargeResult{err: err}
    c.mu.Unlock()
    return err
}
```

**Why common:** Adapter / Decorator confusion is rampant. Cross-cutting state (cache, rate limiter, breaker) tends to lack synchronisation when the author forgets the concurrent context.
</details>

---

## Bug 6 — Function adapter with pointer receiver

```go
type Charger interface {
    Charge(ctx context.Context, amount int) error
}

type ChargerFunc func(ctx context.Context, amount int) error

func (f *ChargerFunc) Charge(ctx context.Context, amount int) error {
    return (*f)(ctx, amount)
}
```

Used:

```go
c := ChargerFunc(myFunc)
process(&c)
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Pointer receiver on a function-type adapter. The pattern is fundamentally awkward:

- Callers must take the address: `process(&c)`. They can't pass `myFunc` directly via `ChargerFunc(myFunc)` — they need `cf := ChargerFunc(myFunc); process(&cf)`.
- Composition breaks: `[]Charger{&c1, &c2}` instead of `[]Charger{c1, c2}`.
- `*ChargerFunc` is comparable, but not as ergonomically as `ChargerFunc`.

**Spot in review:** Any function-type adapter with a `*` receiver. The canonical idiom (`http.HandlerFunc`, `sort.SliceFunc`, etc.) is always value receiver.

**Fix:**

```go
func (f ChargerFunc) Charge(ctx context.Context, amount int) error {
    return f(ctx, amount)
}
```

Now `process(ChargerFunc(myFunc))` works.

**Why common:** Developers familiar with Java-style "always pass by reference" reach for pointer receivers reflexively. For function types, this is wrong — the function value itself is two pointers (function + closure), and a value receiver costs nothing.
</details>

---

## Bug 7 — Returning typed nil

```go
func NewAdapter(enabled bool) Payer {
    var a *PayerAdapter
    if enabled {
        a = &PayerAdapter{client: client}
    }
    return a
}
```

Used:

```go
p := NewAdapter(false)
if p == nil {
    log.Println("not enabled")
    return
}
p.Charge(ctx, 100) // !
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `NewAdapter(false)` returns an interface `(*PayerAdapter, nil)` — the interface is non-nil because it has a type; the underlying pointer is nil. The `p == nil` check returns false. `p.Charge(...)` dispatches through the itab, which finds `(*PayerAdapter).Charge`, which dereferences `a` → nil pointer panic.

**Spot in review:** Constructor that conditionally assigns to a typed nil before returning. The return type is an interface; the variable is a concrete pointer.

**Fix:** Return an untyped nil when there's no adapter:

```go
func NewAdapter(enabled bool) Payer {
    if !enabled {
        return nil
    }
    return &PayerAdapter{client: client}
}
```

Now `NewAdapter(false)` returns a typeless nil; `p == nil` is true.

**Why common:** Idiomatic Go advice "declare zero values" mixes badly with interface returns. The fix is "return nil explicitly when there's no value to box".
</details>

---

## Bug 8 — Inner captured by value

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }
func (c *Counter) Value() int { return c.n }

type Adapter struct{ Inner Counter }  // !

func (a *Adapter) Tick() { a.Inner.Inc() }
```

Used:

```go
c := Counter{}
a := &Adapter{Inner: c}
a.Tick()
fmt.Println(c.Value()) // expecting 1
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** `Adapter.Inner` is a `Counter` by value, not a pointer. When `Adapter` is constructed, `c` is copied into `Inner`. `a.Tick()` mutates `Inner` (the adapter's copy), not the original `c`. Prints 0.

**Spot in review:** Adapter fields holding concrete struct types when the inner is supposed to be shared. Especially common when the inner has mutating methods.

**Fix:**

```go
type Adapter struct{ Inner *Counter }
```

And the call site:

```go
c := &Counter{}
a := &Adapter{Inner: c}
a.Tick()
fmt.Println(c.Value()) // 1
```

**Why common:** Go's value vs pointer distinction is easy to miss. When in doubt, hold the source by pointer (or interface, which is implicitly a pointer-like value).
</details>

---

## Bug 9 — Lossy two-way adapter

```go
type LegacyMsg struct { Body string }
type NewMsg    struct { Body, Subject string; Recipients []string }

type LegacyToNew struct{ L LegacyMailer }

func (a *LegacyToNew) Send(to []string, subject, body string) error {
    return a.L.SendLegacy(LegacyMsg{Body: body})
}

type NewToLegacy struct{ N NewMailer }

func (a *NewToLegacy) SendLegacy(m LegacyMsg) error {
    return a.N.Send([]string{}, "", m.Body)
}
```

Round-trip: NewMsg → wrap → LegacyMsg → wrap → NewMsg. What's lost?

<details><summary>Answer</summary>

**Bug:** Both adapters drop fields. `LegacyToNew.Send` ignores `to` and `subject`. `NewToLegacy.SendLegacy` synthesises empty `to` and `subject`.

A round-trip:
1. `NewMsg{Body: "hi", Subject: "S", Recipients: ["a@b"]}`
2. Through `NewToLegacy` → `LegacyMsg{Body: "hi"}`. Lost: subject, recipients.
3. Through `LegacyToNew` → `NewMsg{Body: "hi", Subject: "", Recipients: nil}`. Same loss.

If your test only checks `Body` equality, it passes. If anything downstream depends on subject or recipients, it breaks silently.

**Spot in review:** Adapters where the target's data shape is *wider* than the source. The adapter must either fail (the conservative approach) or document the loss.

**Fix:** Three options:

1. **Fail loudly:** if the source can't represent everything, return an error.
   ```go
   func (a *NewToLegacy) SendLegacy(m LegacyMsg) error {
       return a.N.Send(nil, "", m.Body) // will the legacy caller care that we synthesised these?
   }
   ```
2. **Document the loss** in the adapter's godoc.
3. **Synthesise sensibly:** for missing recipients, fall back to a default. Often wrong; usually the worst option.

**Why common:** Migration adapters between APIs of unequal richness. The "richer" direction always has gaps.
</details>

---

## Bug 10 — Adapter calling itself recursively

```go
type Mailer interface{ Send(msg Msg) error }

type Adapter struct { Inner Mailer }

func (a *Adapter) Send(msg Msg) error {
    log.Printf("Send: %v", msg)
    return a.Send(msg)  // !
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Stack overflow. `a.Send(msg)` calls *itself*, not `a.Inner.Send(msg)`. Infinite recursion until the stack runs out.

**Spot in review:** Wrapper methods that call themselves instead of the inner. Usually a copy-paste error from another adapter where the method name happened to match.

**Fix:**

```go
return a.Inner.Send(msg)
```

**Why common:** When the adapter and the source share the same method name (because they share the same interface), it's easy to type `a.Send` when you mean `a.Inner.Send`. Compile-time can't catch it; runtime can.
</details>

---

## Bug 11 — Lazy init without sync.Once

```go
type Adapter struct {
    apiKey string
    client *Client
}

func (a *Adapter) Charge(ctx context.Context, amount int) error {
    if a.client == nil {
        a.client = NewClient(a.apiKey)
    }
    return a.client.Charge(amount)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Race condition. Two goroutines calling `Charge` simultaneously can both see `a.client == nil`, both allocate a new `Client`, and one overwrites the other. Subsequent calls might use either instance; expensive client setup (auth tokens, connection pools) is duplicated.

**Spot in review:** Lazy init (`if x == nil { x = ... }`) on shared fields. Always suspect when the field is read after the check.

**Fix:** Use `sync.Once`:

```go
type Adapter struct {
    apiKey string
    once   sync.Once
    client *Client
}

func (a *Adapter) lazy() *Client {
    a.once.Do(func() { a.client = NewClient(a.apiKey) })
    return a.client
}

func (a *Adapter) Charge(ctx context.Context, amount int) error {
    return a.lazy().Charge(amount)
}
```

`sync.Once` guarantees the initialisation runs exactly once across all goroutines.

**Why common:** Lazy init is a frequent optimisation pattern in adapters that don't always get used. The race is invisible in single-goroutine tests; only load testing reveals it.
</details>

---

## Bug 12 — Adapter chain where one layer eats errors

```go
type LoggingPayer struct { Inner Payer; Log *log.Logger }
func (l *LoggingPayer) Charge(ctx context.Context, amount int) error {
    l.Log.Printf("Charge: %d", amount)
    err := l.Inner.Charge(ctx, amount)
    if err != nil {
        l.Log.Printf("Charge failed: %v", err)
        // !
    }
    return nil
}

type RetryingPayer struct { Inner Payer; Attempts int }
func (r *RetryingPayer) Charge(ctx context.Context, amount int) error {
    for i := 0; i < r.Attempts; i++ {
        if err := r.Inner.Charge(ctx, amount); err == nil { return nil }
    }
    return errors.New("retry exhausted")
}

// chain:
var p Payer = realPayer
p = &LoggingPayer{Inner: p, Log: log.Default()}
p = &RetryingPayer{Inner: p, Attempts: 3}
```

**What's wrong?**

<details><summary>Answer**

**Bug:** `LoggingPayer.Charge` always returns `nil`. The error from the inner is logged but not propagated. `RetryingPayer` sees success every time → never retries. Real failures are logged but the caller thinks everything worked.

**Spot in review:** Adapters/decorators with `return nil` at the bottom regardless of inner result. Especially suspicious in logging decorators.

**Fix:**

```go
func (l *LoggingPayer) Charge(ctx context.Context, amount int) error {
    l.Log.Printf("Charge: %d", amount)
    err := l.Inner.Charge(ctx, amount)
    if err != nil { l.Log.Printf("Charge failed: %v", err) }
    return err
}
```

**Why common:** A developer adds logging to debug a problem, then forgets that the wrapper *must* propagate. The wrapper appears to work, but it silently breaks the upstream resilience layer.
</details>

---

## Bug 13 — Exposing inner via accessor

```go
type Adapter struct{ inner *SQLClient }

func (a *Adapter) Get(id string) ([]byte, error) { return a.inner.Get(id) }

func (a *Adapter) Inner() *SQLClient { return a.inner }
```

Used:

```go
adapter := NewAdapter()
adapter.Inner().BulkInsert(items)  // bypasses the abstraction
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Exposing the inner type leaks the abstraction. Callers can now reach past the adapter to use `SQLClient`-specific methods. If you later replace `SQLClient` with a different storage backend, every caller using `Inner()` breaks.

**Spot in review:** Any `Inner()`, `Underlying()`, `Unwrap()` (in non-error contexts), or public field exposing the wrapped type. Each is a backdoor.

**Fix:**

If `BulkInsert` is genuinely needed, expose it via an interface:

```go
type BulkInserter interface { BulkInsert(items []Item) error }

// Adapter implements it:
func (a *Adapter) BulkInsert(items []Item) error { return a.inner.BulkInsert(items) }

// Or as an optional interface — type assert at use site:
if bi, ok := adapter.(BulkInserter); ok { bi.BulkInsert(items) }
```

The optional interface keeps the abstraction intact and allows non-SQL backends to either implement BulkInserter or not.

**Why common:** "Just one quick exposure" turns into a permanent backdoor. The fix later is painful — every caller using `Inner()` needs to migrate.
</details>

---

## Bug 14 — Adapter that spawns a goroutine without lifecycle

```go
type Adapter struct{ inner *Source }

func NewAdapter(source *Source) *Adapter {
    a := &Adapter{inner: source}
    go a.healthCheck()  // !
    return a
}

func (a *Adapter) healthCheck() {
    for {
        time.Sleep(30 * time.Second)
        a.inner.Ping()
    }
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** Goroutine leak. The `healthCheck` goroutine runs forever. The caller has no way to stop it. If the adapter is garbage-collected, the goroutine still runs and prevents GC by holding `a.inner` alive.

**Spot in review:** Constructors that spawn goroutines without accepting a `ctx` or providing a `Close()` method. Any `go ...` in a constructor without an explicit lifecycle is suspect.

**Fix:** Accept a context or expose Close:

```go
type Adapter struct {
    inner *Source
    done  chan struct{}
}

func NewAdapter(ctx context.Context, source *Source) *Adapter {
    a := &Adapter{inner: source, done: make(chan struct{})}
    go a.healthCheck(ctx)
    return a
}

func (a *Adapter) healthCheck(ctx context.Context) {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done(): close(a.done); return
        case <-t.C:        a.inner.Ping()
        }
    }
}

// Or expose Close() that cancels:
func (a *Adapter) Close() error {
    // signal the goroutine to stop
}
```

**Why common:** Background work is convenient to start in the constructor. Stopping it requires explicit machinery — many adapters skip it, relying on "the process will exit eventually". Fine until you create adapters in tests or short-lived contexts.
</details>

---

## Bug 15 — Adapter mutating the source via type assertion

```go
type Reader interface { Read(p []byte) (int, error) }

type LoggingReader struct { Inner Reader }

func (l *LoggingReader) Read(p []byte) (int, error) {
    if br, ok := l.Inner.(*bytes.Reader); ok {
        br.Seek(0, io.SeekStart)  // !
    }
    return l.Inner.Read(p)
}
```

**What's wrong?**

<details><summary>Answer</summary>

**Bug:** The adapter mutates the inner reader's state. Calling `Read` resets the position. The next caller expects to continue from where they left off; instead they read from the beginning again.

Beyond the surface bug: the adapter has *implementation-specific* knowledge of `*bytes.Reader`. Replacing the source with a `*strings.Reader` silently changes behaviour (no Seek call, no reset). The adapter is coupled to one specific implementation.

**Spot in review:** Type assertions inside adapter methods that lead to behaviour-changing branches. Especially when the assertion is to a concrete type, not an interface.

**Fix:** Drop the type assertion. The adapter should not know about concrete types it wraps:

```go
func (l *LoggingReader) Read(p []byte) (int, error) {
    return l.Inner.Read(p)
}
```

If you genuinely need seek behaviour, require it via the interface:

```go
type SeekableReader interface {
    io.Reader
    io.Seeker
}
```

Now consumers can opt into seekability without the adapter making assumptions.

**Why common:** Adapter writers learn an "optimization" trick — type-assert to access richer methods. Each occurrence couples the adapter to a specific implementation and makes substitution dangerous.
</details>

---

## Summary

Three families of bugs in this set:

**State management bugs** (1, 6, 7, 8, 11, 14): The adapter mishandles ownership, lifetime, or concurrency of its wrapped state. Cure: think about who owns what and when each goroutine sees it.

**Translation correctness bugs** (2, 3, 4, 9, 10): The adapter drops or distorts the call it's supposed to translate. Cure: write the trivial test that verifies inputs reach the inner faithfully.

**Abstraction leakage bugs** (5, 12, 13, 15): The adapter exposes too much — concrete types, mutable internals, type-specific behaviour. Cure: keep the adapter as small as possible and resist any urge to reach past it.

**Review checklist:**
- [ ] Constructor returns the interface, not the concrete adapter type.
- [ ] Context (if present) is checked or propagated.
- [ ] Errors from the inner are propagated unchanged.
- [ ] Variadic args are not silently dropped.
- [ ] Wrapper has the same interface as wrapped → it's a decorator, name accordingly.
- [ ] State mutations are synchronised.
- [ ] Function adapters use value receivers, not pointer.
- [ ] No `if x == nil { x = ... }` lazy init without `sync.Once`.
- [ ] No goroutines started without an explicit lifecycle.
- [ ] No type assertions to concrete inner types.
- [ ] No `Inner()` / `Underlying()` accessors.

If you reviewed adapter code with this checklist, you'd catch most of the bugs above before they reached production.
