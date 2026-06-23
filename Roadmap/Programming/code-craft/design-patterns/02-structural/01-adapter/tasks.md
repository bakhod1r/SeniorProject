# Adapter — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/adapter](https://refactoring.guru/design-patterns/adapter)

Each task includes: a brief, the target interface, a buggy/legacy adaptee, and a reference solution. Read the brief, write your version first, then check.

---

## Table of Contents

1. [Task 1: Basic Logger Adapter](#task-1-basic-logger-adapter)
2. [Task 2: Currency Converter Adapter](#task-2-currency-converter-adapter)
3. [Task 3: Storage Adapter (S3 + LocalFS)](#task-3-storage-adapter-s3-localfs)
4. [Task 4: Iterator Adapter](#task-4-iterator-adapter)
5. [Task 5: Async-to-Sync Adapter](#task-5-async-to-sync-adapter)
6. [Task 6: Two-way Adapter](#task-6-two-way-adapter)
7. [Task 7: Notification Adapter (Email + SMS + Slack)](#task-7-notification-adapter-email-sms-slack)
8. [Task 8: Database Driver Adapter](#task-8-database-driver-adapter)
9. [Task 9: HTTP Handler Adapter (Go)](#task-9-http-handler-adapter-go)
10. [Task 10: Anti-Corruption Layer Mini-Project](#task-10-anti-corruption-layer-mini-project)
11. [How to Practice](#how-to-practice)

---

## Task 1: Basic Logger Adapter

**Brief.** Your app uses `Logger.info(msg)`. You want to plug in a third-party `RawLog` that exposes only `write(level int, line string)`.

### Target

```go
type Logger interface {
    Info(msg string)
    Error(msg string)
}
```

### Adaptee

```go
type RawLog struct{}

func (RawLog) Write(level int, line string) {
    fmt.Printf("[%d] %s\n", level, line)
}
```

### Solution

```go
type RawLogAdapter struct{ raw RawLog }

func (a RawLogAdapter) Info(msg string)  { a.raw.Write(0, msg) }
func (a RawLogAdapter) Error(msg string) { a.raw.Write(2, msg) }

func main() {
    var l Logger = RawLogAdapter{}
    l.Info("started")
    l.Error("oops")
}
```

### What you should notice

- The adapter has zero state beyond the adaptee.
- The level mapping is a real decision — document it, or expose a configurable mapping if levels aren't standardized.

---

## Task 2: Currency Converter Adapter

**Brief.** Your domain works in `Money` (long minor units + currency). The third-party FX API returns rates as floats. Adapt.

### Target (Python)

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Money:
    minor: int
    currency: str

class FxConverter:
    def convert(self, amount: Money, to_currency: str) -> Money: ...
```

### Adaptee

```python
class FxApi:
    def rate(self, base: str, quote: str) -> float:
        # In real life this hits the network.
        return {("USD", "EUR"): 0.92, ("EUR", "USD"): 1.085}[(base, quote)]
```

### Solution

```python
from decimal import Decimal, ROUND_HALF_EVEN


class FxApiAdapter:
    def __init__(self, api: FxApi):
        self._api = api

    def convert(self, amount: Money, to_currency: str) -> Money:
        if amount.currency == to_currency:
            return amount
        rate = Decimal(str(self._api.rate(amount.currency, to_currency)))
        major = (Decimal(amount.minor) * rate / Decimal(100)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_EVEN
        )
        return Money(minor=int(major * 100), currency=to_currency)
```

### What you should notice

- **Never use `float` for money math.** Convert to `Decimal` immediately.
- The rounding mode is part of the adapter's contract.
- Same-currency short-circuit avoids a needless API call.

---

## Task 3: Storage Adapter (S3 + LocalFS)

**Brief.** Define one `Blob` interface; write two adapters: a `LocalFsAdapter` (writes to disk) and an `S3Adapter` (writes to S3). Wire by config.

### Target (Java)

```java
public interface BlobStore {
    void put(String key, byte[] data);
    byte[] get(String key);
}
```

### Adapters (sketch)

```java
public final class LocalFsAdapter implements BlobStore {
    private final Path root;

    public LocalFsAdapter(Path root) { this.root = root; }

    @Override
    public void put(String key, byte[] data) {
        try { Files.write(root.resolve(safe(key)), data); }
        catch (IOException e) { throw new BlobIoException(key, e); }
    }

    @Override
    public byte[] get(String key) {
        try { return Files.readAllBytes(root.resolve(safe(key))); }
        catch (NoSuchFileException e) { throw new BlobNotFoundException(key); }
        catch (IOException e) { throw new BlobIoException(key, e); }
    }

    private static String safe(String key) {
        if (key.contains("..") || key.startsWith("/")) throw new IllegalArgumentException(key);
        return key;
    }
}

public final class S3Adapter implements BlobStore {
    private final S3Client client;
    private final String bucket;

    public S3Adapter(S3Client client, String bucket) {
        this.client = client; this.bucket = bucket;
    }

    @Override
    public void put(String key, byte[] data) {
        client.putObject(b -> b.bucket(bucket).key(key), RequestBody.fromBytes(data));
    }

    @Override
    public byte[] get(String key) {
        try {
            return client.getObjectAsBytes(b -> b.bucket(bucket).key(key)).asByteArray();
        } catch (NoSuchKeyException e) {
            throw new BlobNotFoundException(key);
        }
    }
}
```

### Wiring (Spring or factory)

```java
public BlobStore blobStore(@Value("${blob.driver}") String driver, ...) {
    return switch (driver) {
        case "fs" -> new LocalFsAdapter(Path.of(rootPath));
        case "s3" -> new S3Adapter(S3Client.create(), bucket);
        default -> throw new IllegalArgumentException(driver);
    };
}
```

### What you should notice

- Both adapters throw the same domain exceptions (`BlobNotFoundException`, `BlobIoException`).
- Path traversal protection lives in the FS adapter — it's *its* responsibility.
- The S3 client's connection pool is reused per app — don't construct it per call.

---

## Task 4: Iterator Adapter

**Brief.** A library exposes `subscribe(callback)`. You want `for event in stream:`.

### Solution (Python)

```python
import queue
import threading


class CallbackToIterAdapter:
    _DONE = object()

    def __init__(self, source, max_buffer=1024):
        self._q: queue.Queue = queue.Queue(maxsize=max_buffer)
        self._closed = threading.Event()
        source.subscribe(self._on)
        source.on_done(lambda: self._q.put(self._DONE))

    def _on(self, event):
        if self._closed.is_set():
            return
        self._q.put(event)  # blocks if buffer full → backpressure

    def close(self):
        self._closed.set()

    def __iter__(self):
        return self

    def __next__(self):
        item = self._q.get()
        if item is self._DONE:
            raise StopIteration
        return item
```

### What you should notice

- The buffer is bounded — unbounded queue = OOM.
- Backpressure: `put` blocks when full. The producer slows down. (Alternative: drop oldest, document.)
- `close()` lets consumers stop the source cleanly.

---

## Task 5: Async-to-Sync Adapter

**Brief.** A vendor SDK is async (`Future<T>`); the legacy code expects synchronous calls. Adapt **carefully**.

### Solution (Java)

```java
public interface PriceFetcher {
    BigDecimal fetch(String symbol);
}

public final class AsyncPriceAdapter implements PriceFetcher {
    private final AsyncPriceClient client;
    private final Duration timeout;

    public AsyncPriceAdapter(AsyncPriceClient client, Duration timeout) {
        this.client = client;
        this.timeout = timeout;
    }

    @Override
    public BigDecimal fetch(String symbol) {
        try {
            return client.fetch(symbol).get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            throw new PriceTimeoutException(symbol, timeout, e);
        } catch (ExecutionException e) {
            throw new PriceException(symbol, e.getCause());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PriceException(symbol, e);
        }
    }
}
```

### What you should notice

- **Always pass a timeout** — `.get()` without timeout is a production hang waiting to happen.
- Restore the interrupt status when catching `InterruptedException`.
- `ExecutionException` wraps the real cause; unwrap before logging.
- This adapter wastes a thread per concurrent call. **Don't** use this pattern in async runtimes (Reactor, Vert.x, asyncio).

---

## Task 6: Two-way Adapter

**Brief.** A plugin system. The host expects `Plugin.onTick()`. Each plugin expects `Host.log(msg)`. Build one bridge.

### Solution (Java)

```java
public interface Host { void log(String msg); }
public interface Plugin { void onTick(); }

public final class PluginBridge implements Host, Plugin {
    private final Host host;
    private final Plugin plugin;

    public PluginBridge(Host host, Plugin plugin) {
        this.host = host;
        this.plugin = plugin;
    }

    @Override public void log(String msg) { host.log(msg); }
    @Override public void onTick()        { plugin.onTick(); }
}
```

### What you should notice

- Two-way adapters are rare. Most systems get away with two single-purpose adapters — easier to test.
- A bridge instance can be passed where either interface is expected. The host calls `bridge.onTick()`; the plugin calls `bridge.log(...)`.

---

## Task 7: Notification Adapter (Email + SMS + Slack)

**Brief.** One `Notifier` interface; three adapters. Each wraps a different vendor SDK.

### Target (Go)

```go
type Notifier interface {
    Send(ctx context.Context, to, message string) error
}
```

### Adapters (sketch)

```go
// EmailAdapter wraps a (fake) Mailgun client.
type EmailAdapter struct{ client *mailgun.Client }
func (a *EmailAdapter) Send(ctx context.Context, to, message string) error {
    return a.client.Send(ctx, mailgun.Message{To: to, Body: message})
}

// SmsAdapter wraps a Twilio client.
type SmsAdapter struct{ client *twilio.Client }
func (a *SmsAdapter) Send(ctx context.Context, to, message string) error {
    _, err := a.client.Messages.Create(ctx, &twilio.CreateMessageParams{To: to, Body: message})
    return err
}

// SlackAdapter posts to an incoming webhook.
type SlackAdapter struct {
    webhookURL string
    httpClient *http.Client
}
func (a *SlackAdapter) Send(ctx context.Context, to, message string) error {
    body, _ := json.Marshal(map[string]string{"channel": to, "text": message})
    req, _ := http.NewRequestWithContext(ctx, "POST", a.webhookURL, bytes.NewReader(body))
    res, err := a.httpClient.Do(req)
    if err != nil { return err }
    defer res.Body.Close()
    if res.StatusCode/100 != 2 { return fmt.Errorf("slack: %s", res.Status) }
    return nil
}
```

### Wiring

```go
type CompositeNotifier struct{ inner []Notifier }
func (c CompositeNotifier) Send(ctx context.Context, to, message string) error {
    for _, n := range c.inner {
        if err := n.Send(ctx, to, message); err != nil { return err }
    }
    return nil
}
```

### What you should notice

- Each adapter is tiny.
- Common interface lets the `CompositeNotifier` (Composite pattern!) fan out without knowing about vendors.
- Test each adapter with a fake HTTP transport.

---

## Task 8: Database Driver Adapter

**Brief.** Define a `KeyValue` interface; adapt to a Redis client and an in-memory `map[string]string`. Use the in-memory adapter in tests.

### Target (Python)

```python
from typing import Optional


class KeyValue:
    def get(self, key: str) -> Optional[str]: ...
    def set(self, key: str, value: str) -> None: ...
    def delete(self, key: str) -> None: ...
```

### Adapters

```python
import redis


class RedisAdapter(KeyValue):
    def __init__(self, client: redis.Redis):
        self._c = client

    def get(self, key: str) -> Optional[str]:
        v = self._c.get(key)
        return v.decode() if v is not None else None

    def set(self, key: str, value: str) -> None:
        self._c.set(key, value)

    def delete(self, key: str) -> None:
        self._c.delete(key)


class InMemoryAdapter(KeyValue):
    def __init__(self):
        self._data: dict[str, str] = {}

    def get(self, key: str) -> Optional[str]:
        return self._data.get(key)

    def set(self, key: str, value: str) -> None:
        self._data[key] = value

    def delete(self, key: str) -> None:
        self._data.pop(key, None)
```

### What you should notice

- Both adapters return `None` for missing keys — the contract is *one* shape, the adaptees diverge.
- Redis returns bytes; the adapter decodes. Encoding choice is documented (utf-8 default).
- The in-memory adapter is your test double. No mocking needed.

---

## Task 9: HTTP Handler Adapter (Go)

**Brief.** Adapt a function `func(req Request) Response` (your domain shape) to Go's `http.Handler`.

### Target

```go
type Request struct{ Path string; Body []byte; Headers map[string]string }
type Response struct{ Status int; Body []byte; Headers map[string]string }
type DomainHandler func(req Request) Response
```

### Adapter

```go
func ToHTTPHandler(h DomainHandler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        body, err := io.ReadAll(r.Body)
        if err != nil { http.Error(w, "read error", http.StatusBadRequest); return }
        defer r.Body.Close()

        headers := map[string]string{}
        for k, vs := range r.Header { headers[k] = vs[0] }

        res := h(Request{Path: r.URL.Path, Body: body, Headers: headers})

        for k, v := range res.Headers { w.Header().Set(k, v) }
        w.WriteHeader(res.Status)
        _, _ = w.Write(res.Body)
    })
}
```

### What you should notice

- Function-typed adapter — Go's idiomatic shorthand.
- Header maps are lossy (you keep only the first value). Document.
- Body buffering: if `Body` is huge, this allocates. For streaming, use `io.Reader` in the domain.

---

## Task 10: Anti-Corruption Layer Mini-Project

**Brief.** A new microservice integrates with a legacy CRM that returns customer data as XML. Build a 3-piece ACL: adapter (RPC + parsing), domain mapper (XML model → your `Customer` aggregate), error translator.

### Sketch (Java)

```java
// Adapter — calls the legacy CRM and parses XML.
public final class LegacyCrmAdapter implements CustomerRepository {
    private final LegacyCrmClient client;
    private final CustomerMapper mapper;
    private final LegacyErrorTranslator errors;

    public LegacyCrmAdapter(LegacyCrmClient c, CustomerMapper m, LegacyErrorTranslator e) {
        this.client = c; this.mapper = m; this.errors = e;
    }

    @Override
    public Customer findById(CustomerId id) {
        try {
            String xml = client.getCustomerXml(id.value());
            LegacyCustomer legacy = LegacyCustomerXml.parse(xml);
            return mapper.toDomain(legacy);
        } catch (LegacyException e) {
            throw errors.translate(e, id);
        }
    }
}

// Mapper — pure functions, no I/O.
public final class CustomerMapper {
    public Customer toDomain(LegacyCustomer src) {
        return new Customer(
            new CustomerId(src.id()),
            new EmailAddress(src.email()),
            normalizePhone(src.phone()),
            src.signupDate().atStartOfDay().toInstant(ZoneOffset.UTC)
        );
    }
    private static PhoneNumber normalizePhone(String raw) { ... }
}

// Error translator.
public final class LegacyErrorTranslator {
    public RuntimeException translate(LegacyException e, CustomerId id) {
        if (e.getCode() == 404) return new CustomerNotFoundException(id);
        if (e.getCode() == 401) return new CrmAuthFailureException(e);
        return new CrmUnavailableException(e);
    }
}
```

### What you should notice

- Three small classes beat one big "service" class.
- Each is independently testable: mapper doesn't need a network; translator doesn't need parsing.
- Domain layer (`Customer`, `CustomerId`, `EmailAddress`) has no idea XML, CRM, or HTTP exist.
- Replacing the legacy CRM with a new system requires only writing a new adapter + mapper + translator. The domain stays.

---

## How to Practice

1. **Pick a task; do not copy.** Write the adapter from scratch in your editor; only check the solution after.
2. **Run it.** Tasks compile/run as written. Wire them into a `main()` and exercise each branch.
3. **Add tests.** For Tasks 1–8, write at least one happy-path test and one error-mapping test per adapter.
4. **Stress one of them.** Pick Task 4 (iterator) or Task 5 (async). Push 100k events through. Watch CPU, memory, and dropped events.
5. **Revisit naming.** After your solution works, ask: would `<Vendor>Adapter` be clearer than what I named it?
6. **Move logic out.** If your adapter has any `if`/branch beyond null-checks and exception mapping, ask if it belongs elsewhere.
7. **Compare with the reference solution.** Note: the references favor explicit error mapping and immutable types. If your version differs, decide whether it's a stylistic difference or a missing concern.

---

← Back to Adapter folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Adapter — Find the Bug](find-bug.md)
