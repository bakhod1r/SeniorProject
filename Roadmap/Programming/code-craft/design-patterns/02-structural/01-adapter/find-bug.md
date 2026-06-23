# Adapter — Find the Bug

> **Source:** [refactoring.guru/design-patterns/adapter](https://refactoring.guru/design-patterns/adapter)

Each section presents an adapter implementation that *looks* fine but is broken. Read the snippet, find the bug yourself, then check the reveal.

---

## Table of Contents

1. [Bug 1: Currency rounding with double](#bug-1-currency-rounding-with-double)
2. [Bug 2: Vendor exception leaks across the boundary](#bug-2-vendor-exception-leaks-across-the-boundary)
3. [Bug 3: Vendor type returned from adapter (Java)](#bug-3-vendor-type-returned-from-adapter-java)
4. [Bug 4: Adapter holds a reference to a closed resource (Go)](#bug-4-adapter-holds-a-reference-to-a-closed-resource-go)
5. [Bug 5: Async adapter without timeout (Java)](#bug-5-async-adapter-without-timeout-java)
6. [Bug 6: Unbounded queue in iterator adapter (Python)](#bug-6-unbounded-queue-in-iterator-adapter-python)
7. [Bug 7: Adapter mutates shared state (Python)](#bug-7-adapter-mutates-shared-state-python)
8. [Bug 8: Defensive copy missing (Java)](#bug-8-defensive-copy-missing-java)
9. [Bug 9: Interface conversion allocation (Go)](#bug-9-interface-conversion-allocation-go)
10. [Bug 10: Cancellation not propagated (Go)](#bug-10-cancellation-not-propagated-go)
11. [Bug 11: Adapter calling super constructor wrong (Java class adapter)](#bug-11-adapter-calling-super-constructor-wrong-java-class-adapter)
12. [Bug 12: Two-way adapter infinite recursion](#bug-12-two-way-adapter-infinite-recursion)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Currency rounding with double

```java
public final class StripeAdapter implements PaymentProcessor {
    private final StripeClient client;

    public StripeAdapter(StripeClient client) { this.client = client; }

    @Override
    public void pay(Money amount) {
        double major = amount.minorUnits() / 100.0;
        client.charge(major, amount.currency());
    }
}
```

<details><summary>Reveal</summary>

**Bug:** Money is being computed in `double`. For amounts like `123` cents (`$1.23`), `123 / 100.0` is **not** exactly `1.23` in IEEE-754 — small rounding errors accumulate. After a few million transactions, the books don't match.

**Fix:** use `BigDecimal` (or pass minor units to the vendor if it accepts them):

```java
BigDecimal major = BigDecimal.valueOf(amount.minorUnits()).movePointLeft(2);
client.charge(major, amount.currency());
```

**Lesson:** Currency is the canonical example of "the adapter is the boundary where types must be precise." Don't let `double` cross it.

</details>

---

## Bug 2: Vendor exception leaks across the boundary

```java
public final class StripeAdapter implements PaymentProcessor {
    private final StripeClient client;
    public StripeAdapter(StripeClient c) { this.client = c; }

    @Override
    public PaymentResult pay(PaymentRequest req) {
        Charge ch = client.charges().create(toParams(req));   // throws StripeException
        return new PaymentResult(ch.getId(), Money.ofMinor(ch.getAmount(), ch.getCurrency()));
    }
}
```

<details><summary>Reveal</summary>

**Bug:** `StripeException` is unchecked but propagates up. Now every caller transitively imports `com.stripe.exception.*` and the domain layer is "infected" with vendor concepts. If you swap to Adyen, every catch block changes.

**Fix:** Catch and translate.

```java
try {
    Charge ch = client.charges().create(toParams(req));
    return new PaymentResult(ch.getId(), Money.ofMinor(ch.getAmount(), ch.getCurrency()));
} catch (StripeCardException e) {
    throw new PaymentException(PaymentError.DECLINED, e.getMessage(), e);
} catch (StripeException e) {
    throw new PaymentException(PaymentError.UNKNOWN, e.getMessage(), e);
}
```

**Lesson:** Mapping vendor exceptions to domain exceptions is part of the adapter's job, not a nice-to-have.

</details>

---

## Bug 3: Vendor type returned from adapter (Java)

```java
public final class S3Adapter implements BlobStore {
    private final S3Client client;
    private final String bucket;

    public S3Adapter(S3Client c, String b) { this.client = c; this.bucket = b; }

    @Override
    public ResponseInputStream<GetObjectResponse> get(String key) {
        return client.getObject(b -> b.bucket(bucket).key(key));
    }
}
```

<details><summary>Reveal</summary>

**Bug:** The return type `ResponseInputStream<GetObjectResponse>` is from AWS SDK. Every caller now has a hard dependency on `software.amazon.awssdk.*`. The adapter "wraps" the call but passes the vendor type through.

**Fix:** Define a domain type:

```java
public final class Blob implements AutoCloseable {
    private final InputStream stream;
    private final long size;
    public Blob(InputStream s, long size) { this.stream = s; this.size = size; }
    public InputStream stream() { return stream; }
    public long size() { return size; }
    @Override public void close() throws IOException { stream.close(); }
}

@Override
public Blob get(String key) {
    var resp = client.getObject(b -> b.bucket(bucket).key(key));
    return new Blob(resp, resp.response().contentLength());
}
```

**Lesson:** The adapter's return type is part of the boundary. Vendor types in return types defeat the pattern.

</details>

---

## Bug 4: Adapter holds a reference to a closed resource (Go)

```go
type FileLogAdapter struct{ f *os.File }

func NewFileLogAdapter(path string) (*FileLogAdapter, error) {
    f, err := os.Create(path)
    if err != nil { return nil, err }
    defer f.Close()
    return &FileLogAdapter{f: f}, nil
}

func (a *FileLogAdapter) Info(msg string) {
    a.f.WriteString(msg + "\n")  // writes to a closed file!
}
```

<details><summary>Reveal</summary>

**Bug:** The `defer f.Close()` runs as the constructor returns, closing the file before the adapter is ever used. Subsequent writes either fail silently or, depending on OS, could corrupt unrelated FDs.

**Fix:** Don't `defer Close` in the constructor. Expose `Close()` on the adapter; let the caller manage lifecycle.

```go
type FileLogAdapter struct{ f *os.File }

func NewFileLogAdapter(path string) (*FileLogAdapter, error) {
    f, err := os.Create(path)
    if err != nil { return nil, err }
    return &FileLogAdapter{f: f}, nil
}

func (a *FileLogAdapter) Info(msg string) error {
    _, err := a.f.WriteString(msg + "\n")
    return err
}

func (a *FileLogAdapter) Close() error { return a.f.Close() }
```

**Lesson:** Resource lifecycle is part of the adapter's contract. Decide who owns close, and document.

</details>

---

## Bug 5: Async adapter without timeout (Java)

```java
public final class AsyncPriceAdapter implements PriceFetcher {
    private final AsyncPriceClient client;
    public AsyncPriceAdapter(AsyncPriceClient c) { this.client = c; }

    @Override
    public BigDecimal fetch(String symbol) throws Exception {
        return client.fetch(symbol).get();   // blocks forever?
    }
}
```

<details><summary>Reveal</summary>

**Bug:** `Future.get()` with no timeout. If the vendor hangs (network issue, deadlock, slow upstream), this thread is stuck **forever**. Under load, every request thread eventually parks here. Production goes down.

**Fix:**

```java
return client.fetch(symbol).get(5, TimeUnit.SECONDS);  // bounded
```

And catch `TimeoutException` separately to translate it.

**Lesson:** Every async-to-sync adapter must specify a timeout. "Default forever" is choosing failure.

</details>

---

## Bug 6: Unbounded queue in iterator adapter (Python)

```python
import queue


class CallbackToIterAdapter:
    def __init__(self, source):
        self._q = queue.Queue()  # unlimited capacity
        source.on_event(self._q.put)

    def __iter__(self): return self
    def __next__(self): return self._q.get()
```

<details><summary>Reveal</summary>

**Bug:** `queue.Queue()` with no `maxsize` is unbounded. If the producer is fast and the consumer slow (or never iterates), memory grows until OOM. There's also no termination signal — `__next__` blocks forever once events stop.

**Fix:**

```python
class CallbackToIterAdapter:
    _DONE = object()

    def __init__(self, source, max_buffer=1024):
        self._q = queue.Queue(maxsize=max_buffer)
        source.on_event(self._q.put)
        source.on_done(lambda: self._q.put(self._DONE))

    def __iter__(self): return self
    def __next__(self):
        item = self._q.get()
        if item is self._DONE:
            raise StopIteration
        return item
```

**Lesson:** Every buffer needs a bound. Every stream needs a termination signal.

</details>

---

## Bug 7: Adapter mutates shared state (Python)

```python
DEFAULT_HEADERS = {"User-Agent": "myapp"}


class HttpAdapter:
    def __init__(self, client):
        self._c = client

    def get(self, url, extra_headers=None):
        headers = DEFAULT_HEADERS
        if extra_headers:
            headers.update(extra_headers)   # mutates DEFAULT_HEADERS!
        return self._c.get(url, headers=headers)
```

<details><summary>Reveal</summary>

**Bug:** `headers = DEFAULT_HEADERS` is a reference, not a copy. `headers.update(...)` mutates the module-level dict. After one call with `extra_headers={"X-Auth": "secret"}`, every subsequent caller — and every other instance of the adapter — sends the auth header. Catastrophic.

**Fix:** copy.

```python
def get(self, url, extra_headers=None):
    headers = {**DEFAULT_HEADERS, **(extra_headers or {})}
    return self._c.get(url, headers=headers)
```

**Lesson:** Adapters that look stateless can leak state via shared module-level mutables. Copy before merging.

</details>

---

## Bug 8: Defensive copy missing (Java)

```java
public final class LegacyCustomerAdapter implements CustomerRepository {
    private final LegacyDb db;
    public LegacyCustomerAdapter(LegacyDb db) { this.db = db; }

    @Override
    public List<Customer> findByCity(String city) {
        return db.fetchByCity(city);  // returns LegacyDb's internal mutable list
    }
}
```

<details><summary>Reveal</summary>

**Bug:** `db.fetchByCity(...)` returns the *internal* list backing the legacy DB's cache. The caller can `.add(...)` or `.clear()` it, corrupting the cache. Or the cache can be invalidated under the caller's feet, mutating the list mid-iteration.

**Fix:** copy at the boundary, or return an unmodifiable view.

```java
return List.copyOf(db.fetchByCity(city));
```

**Lesson:** "Return what the adaptee gave me" is dangerous when the adaptee is sloppy about ownership. The adapter owns the boundary.

</details>

---

## Bug 9: Interface conversion allocation (Go)

```go
type PaymentProcessor interface {
    Pay(amount int) error
}

type StripeAdapter struct{ client *stripe.Client }
func (s StripeAdapter) Pay(amount int) error { ... }   // value receiver

func main() {
    var p PaymentProcessor = StripeAdapter{client: c}   // allocates!
    for i := 0; i < 1_000_000; i++ {
        p.Pay(100)
    }
}
```

<details><summary>Reveal</summary>

**Bug:** Two related issues:
1. `StripeAdapter` has a value receiver. Converting a value to an interface requires a stable pointer, so Go allocates a copy on the heap. For an adapter holding a `*stripe.Client`, that's small — but it's still a per-conversion heap allocation.
2. The `for` loop is fine here (the conversion happens once, before the loop), but the same code in a hot path that reconstructs the interface allocates per iteration.

**Fix:** pointer receiver, pointer in the interface.

```go
func (s *StripeAdapter) Pay(amount int) error { ... }
var p PaymentProcessor = &StripeAdapter{client: c}
```

**Lesson:** In Go, adapters going through interfaces should use pointer receivers and be passed as pointers. Common subtle perf bug.

</details>

---

## Bug 10: Cancellation not propagated (Go)

```go
type StripeAdapter struct{ client *stripe.Client }

func (a *StripeAdapter) Pay(ctx context.Context, req PaymentRequest) (PaymentResult, error) {
    charge, err := a.client.ChargesCreate(req.toParams())   // ignores ctx
    if err != nil { return PaymentResult{}, err }
    return toResult(charge), nil
}
```

<details><summary>Reveal</summary>

**Bug:** The adapter accepts a `context.Context` but never uses it. If the caller cancels (HTTP client disconnects, parent timeout fires), the adapter keeps waiting on the vendor SDK. Goroutines leak; vendor calls happen when no one cares about the result.

**Fix:** pass the context to the SDK if it accepts one. If the SDK doesn't, at minimum check `ctx.Err()` before and after.

```go
func (a *StripeAdapter) Pay(ctx context.Context, req PaymentRequest) (PaymentResult, error) {
    if err := ctx.Err(); err != nil { return PaymentResult{}, err }
    charge, err := a.client.ChargesCreateWithContext(ctx, req.toParams())
    if err != nil { return PaymentResult{}, err }
    return toResult(charge), nil
}
```

**Lesson:** Accepting a `Context` is a contract. Ignoring it is dishonest. The adapter is where you wire context to the underlying call.

</details>

---

## Bug 11: Adapter calling super constructor wrong (Java class adapter)

```java
// Adaptee.
public class LegacyGateway {
    public LegacyGateway(String url) { /* opens connection */ }
    public void makePayment(double amount) { ... }
}

// Class adapter: extends adaptee.
public class LegacyAdapter extends LegacyGateway implements PaymentProcessor {
    public LegacyAdapter() {
        super("");   // empty URL — adaptee may open a bad connection!
    }

    @Override
    public void pay(int cents) { makePayment(cents / 100.0); }
}
```

<details><summary>Reveal</summary>

**Bug:** A class adapter must call the adaptee's constructor — but you can't sensibly synthesize the adaptee's required arguments out of thin air. Here, `super("")` instantiates `LegacyGateway` with an empty URL; the legacy code may attempt to open `""` as a host, throw, or quietly use a default localhost.

**Fix:** Don't use a class adapter when the adaptee needs constructor args. Use composition (object adapter):

```java
public class LegacyAdapter implements PaymentProcessor {
    private final LegacyGateway gw;
    public LegacyAdapter(LegacyGateway gw) { this.gw = gw; }
    @Override public void pay(int cents) { gw.makePayment(cents / 100.0); }
}
```

**Lesson:** Class adapters' big restriction is they must call `super(...)` with concrete args. Object adapters dodge this entirely. Yet another reason to prefer composition.

</details>

---

## Bug 12: Two-way adapter infinite recursion

```java
public class TwoWayAdapter implements TargetA, TargetB {
    private final TwoWayAdapter self = this;

    @Override public void aMethod() { self.bMethod(); }
    @Override public void bMethod() { self.aMethod(); }
}
```

<details><summary>Reveal</summary>

**Bug:** The two methods call each other forever. The author assumed each method should "translate to the other side," but didn't wire in the actual collaborators (the host and the plugin). Result: stack overflow on first call.

**Fix:** A two-way adapter needs **two real collaborators**, not self-references.

```java
public class TwoWayAdapter implements Host, Plugin {
    private final Host host;
    private final Plugin plugin;
    public TwoWayAdapter(Host h, Plugin p) { this.host = h; this.plugin = p; }

    @Override public void log(String msg) { host.log(msg); }
    @Override public void onTick()        { plugin.onTick(); }
}
```

**Lesson:** A two-way adapter implements both interfaces but each method delegates to *a different* collaborator. Forgetting that flips it into a self-referential loop.

</details>

---

## Practice Tips

- Read the snippet and **stop reading before the reveal**. Write down what you think is wrong.
- For each bug, ask: "what's the *worst* production scenario?" Many adapter bugs are dormant — they only fire under load, with bad input, or after a vendor change.
- After fixing, sanity-check by trying to add a unit test that *would have caught* the bug. If you can't write that test, the fix is incomplete.
- Repeat after a week with the answers covered. The patterns repeat.
- These bugs come from real codebases (sanitized). Once you've seen them, you'll spot them in PRs forever.

---

← Back to Adapter folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Adapter — Optimize](optimize.md)
