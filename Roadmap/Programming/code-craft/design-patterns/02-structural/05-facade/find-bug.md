# Facade — Find the Bug

> **Source:** [refactoring.guru/design-patterns/facade](https://refactoring.guru/design-patterns/facade)

Each section presents a Facade that *looks* fine but is broken. Find the bug yourself, then check.

---

## Table of Contents

1. [Bug 1: Missing rollback on partial failure](#bug-1-missing-rollback-on-partial-failure)
2. [Bug 2: Subsystem exception leaks across the boundary](#bug-2-subsystem-exception-leaks-across-the-boundary)
3. [Bug 3: Subsystem types in the API](#bug-3-subsystem-types-in-the-api)
4. [Bug 4: Facade constructs its own dependencies](#bug-4-facade-constructs-its-own-dependencies)
5. [Bug 5: Hidden side effect surprises caller](#bug-5-hidden-side-effect-surprises-caller)
6. [Bug 6: Default that becomes a security incident](#bug-6-default-that-becomes-a-security-incident)
7. [Bug 7: God-class Facade](#bug-7-god-class-facade)
8. [Bug 8: Sequential when parallel was safe](#bug-8-sequential-when-parallel-was-safe)
9. [Bug 9: Facade swallows error silently](#bug-9-facade-swallows-error-silently)
10. [Bug 10: Idempotent Facade isn't actually idempotent](#bug-10-idempotent-facade-isnt-actually-idempotent)
11. [Bug 11: Connection pool created per call](#bug-11-connection-pool-created-per-call)
12. [Bug 12: Saga compensation doesn't compensate](#bug-12-saga-compensation-doesnt-compensate)
13. [Practice Tips](#practice-tips)

---

## Bug 1: Missing rollback on partial failure

```java
public Order placeOrder(PlaceOrderCommand cmd) {
    var reservation = inventory.reserve(cmd.items());
    var receipt = payments.charge(cmd.user(), cmd.total());   // can throw
    var order = orders.save(new Order(cmd.user(), reservation, receipt));
    notifications.send(order);
    return order;
}
```

A user reports being charged for an order that "doesn't exist."

<details><summary>Reveal</summary>

**Bug:** If `payments.charge` throws, `inventory.reserve` already happened — items are reserved without an order. If `orders.save` throws, the user is charged with no record. No rollback.

**Fix:** wrap in try/catch and compensate.

```java
var reservation = inventory.reserve(cmd.items());
Receipt receipt;
try {
    receipt = payments.charge(cmd.user(), cmd.total());
} catch (Exception e) {
    inventory.cancel(reservation);
    throw e;
}
try {
    return orders.save(new Order(cmd.user(), reservation, receipt));
} catch (Exception e) {
    payments.refund(receipt);
    inventory.cancel(reservation);
    throw e;
}
```

**Lesson:** A Facade orchestrating writes across services needs explicit failure handling. Naïve "happy path" code breaks under partial failure.

</details>

---

## Bug 2: Subsystem exception leaks across the boundary

```java
public Receipt pay(PaymentRequest req) {
    return stripeClient.charges().create(req.toStripeParams());
    // Throws StripeException — propagates up
}
```

Callers wrote `catch (StripeException e) { ... }`. Now the team is migrating to Adyen; every catch block needs to change.

<details><summary>Reveal</summary>

**Bug:** The Facade lets `StripeException` propagate. Callers depend on the vendor's exception type. Migrating vendors means touching every catch block.

**Fix:** translate at the boundary.

```java
public Receipt pay(PaymentRequest req) throws PaymentException {
    try {
        return mapToReceipt(stripeClient.charges().create(req.toStripeParams()));
    } catch (StripeException e) {
        throw new PaymentException(e.getMessage(), e);
    }
}
```

**Lesson:** Facades must translate vendor-specific errors to domain errors. Otherwise the Facade isn't really decoupling anything.

</details>

---

## Bug 3: Subsystem types in the API

```java
public Charge processPayment(int amount) {
    return stripeClient.charges().create(...);   // returns Stripe's Charge type
}
```

Caller code: `var charge = service.processPayment(100); chargeId = charge.getId();`. When Stripe deprecates `Charge.getId()` in favor of `getChargeId()`, every caller breaks.

<details><summary>Reveal</summary>

**Bug:** The return type is the vendor's `Charge`. Callers are coupled to Stripe's API.

**Fix:** return a domain type.

```java
public class Receipt {
    private final String id;
    private final long amount;
    private final Instant chargedAt;
    // ...
}

public Receipt processPayment(int amount) {
    Charge ch = stripeClient.charges().create(...);
    return new Receipt(ch.getId(), ch.getAmount(), Instant.now());
}
```

**Lesson:** Don't expose subsystem types in your Facade's signatures. Translate to domain types.

</details>

---

## Bug 4: Facade constructs its own dependencies

```python
class OrderService:
    def __init__(self):
        self._inv = InventoryService()        # constructed inside
        self._pay = PaymentProcessor(api_key="...")   # constructed inside
        self._orders = OrderRepository(db_url="...")  # constructed inside
```

Tests fail: "can't reach the real Stripe API" / "no DB available."

<details><summary>Reveal</summary>

**Bug:** The Facade constructs its own dependencies. Tests can't substitute mocks; integration with real services is required for any test.

**Fix:** inject via constructor.

```python
class OrderService:
    def __init__(self, inv, pay, orders):
        self._inv = inv
        self._pay = pay
        self._orders = orders
```

Tests construct `OrderService(MockInv(), MockPay(), MockOrders())`.

**Lesson:** Inject subsystem dependencies; don't construct them inside the Facade. DI is fundamental for testability.

</details>

---

## Bug 5: Hidden side effect surprises caller

```python
class FileService:
    def save(self, path: str, data: bytes) -> None:
        with open(path, "wb") as f:
            f.write(data)
        # Also: send a "file uploaded" notification to admins
        self._email.send_admin("file uploaded: " + path)
```

A user uploads 1000 files in a script; admins get spammed with 1000 emails.

<details><summary>Reveal</summary>

**Bug:** `save` has a hidden side effect (sending email). The caller didn't ask for it; the API doesn't reveal it; the consequences are surprising.

**Fix:** make it explicit, optional, or remove.

```python
def save(self, path: str, data: bytes, notify_admin: bool = False) -> None:
    with open(path, "wb") as f:
        f.write(data)
    if notify_admin:
        self._email.send_admin("file uploaded: " + path)
```

Or split into two methods, or move notification to a separate scheduled job.

**Lesson:** Side effects in Facades must be visible. Document explicitly and provide opt-out.

</details>

---

## Bug 6: Default that becomes a security incident

```python
class S3Facade:
    def upload(self, key: str, data: bytes) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ACL="public-read",   # ← default
        )
```

A new developer uses the Facade for a private document. Two weeks later it's indexed by Google.

<details><summary>Reveal</summary>

**Bug:** The Facade defaults to public-read. The developer assumed sensible (private) defaults; the Facade silently made the file public.

**Fix:** change the default to safer + require opt-in.

```python
def upload(self, key: str, data: bytes, public: bool = False) -> None:
    acl = "public-read" if public else "private"
    self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ACL=acl)
```

**Lesson:** Defaults in Facades should be safest reasonable choice. Make dangerous options explicit opt-in. Document.

</details>

---

## Bug 7: God-class Facade

```java
public class OrderService {
    public Order placeOrder(...) { ... }
    public void cancelOrder(...) { ... }
    public Refund issueRefund(...) { ... }
    public Order reissue(...) { ... }
    public void exportInvoice(...) { ... }
    public void notifyMarketing(...) { ... }
    public void recalculateInventory(...) { ... }
    public List<Order> searchOrders(...) { ... }
    public OrderAnalytics getAnalytics(...) { ... }
    // ... 20 more
}
```

The team complains: testing is slow, every PR touches this file, merges are painful.

<details><summary>Reveal</summary>

**Bug:** The Facade is a god class. It's no longer simplifying — it's collecting. Different audiences (storefront, admin, analytics) all depend on the same class. Test isolation is hard; merges conflict; reasoning is slow.

**Fix:** split by audience.

```java
public class CustomerCheckoutService { /* placeOrder, cancelOrder */ }
public class AdminOrderService { /* refund, reissue */ }
public class OrderReportingService { /* analytics, search */ }
```

**Lesson:** A Facade that grows past ~10 methods is failing to simplify. Split aggressively.

</details>

---

## Bug 8: Sequential when parallel was safe

```java
public OrderQuote quote(QuoteCommand cmd) {
    var inv = inventory.check(cmd.items());      // 50ms
    var price = pricing.quote(cmd.items());      // 80ms
    var risk = fraud.score(cmd.user());          // 100ms
    return new OrderQuote(inv, price, risk);    // total: 230ms
}
```

P99 latency on this endpoint is 280ms. Subsystems are independent; could run in parallel.

<details><summary>Reveal</summary>

**Bug:** Three independent calls, sequentially. Total = sum (230ms). Could be max (100ms) with parallelization.

**Fix:** run in parallel.

```java
var inv = supplyAsync(() -> inventory.check(cmd.items()), executor);
var price = supplyAsync(() -> pricing.quote(cmd.items()), executor);
var risk = supplyAsync(() -> fraud.score(cmd.user()), executor);
return allOf(inv, price, risk)
    .thenApply(_ -> new OrderQuote(inv.join(), price.join(), risk.join()))
    .join();
```

P99 drops to 130ms.

**Lesson:** Facade is the natural place to parallelize independent subsystem calls. Always ask if calls can run concurrently.

</details>

---

## Bug 9: Facade swallows error silently

```python
class EmailFacade:
    def send(self, to: str, subject: str, body: str) -> None:
        try:
            self._smtp.send(to, subject, body)
        except Exception as e:
            self._log.warning(f"email failed: {e}")
            # Continue silently
```

A customer complains: "I never got my password reset email." The team logs say "email failed" but the user got a "success" page.

<details><summary>Reveal</summary>

**Bug:** The Facade catches and logs the error but doesn't propagate. The caller thinks success; the user expected an email and didn't get one.

**Fix:** propagate the error or return a meaningful result.

```python
def send(self, to: str, subject: str, body: str) -> None:
    try:
        self._smtp.send(to, subject, body)
    except Exception as e:
        self._log.warning(f"email failed: {e}")
        raise EmailError(f"failed to send to {to}") from e
```

Or return a result object the caller can inspect.

**Lesson:** Facades shouldn't swallow errors. Logging is not the same as handling. Decide: propagate, or document the silent-fail contract loudly.

</details>

---

## Bug 10: Idempotent Facade isn't actually idempotent

```go
func (c *CheckoutFacade) PlaceOrder(cmd PlaceOrderCommand) (*Order, error) {
    if cmd.IdempotencyKey == "" {
        cmd.IdempotencyKey = uuid.NewString()   // ← always new
    }
    return c.inner.PlaceOrder(cmd)
}
```

Network retries cause duplicate charges.

<details><summary>Reveal</summary>

**Bug:** The Facade *generates* an idempotency key when missing — but each call generates a *new* one. Retries from the client (with no key) are not deduplicated. Charges happen twice.

**Fix:** require the caller to provide the key, or persist + lookup the key based on a stable input hash.

```go
func (c *CheckoutFacade) PlaceOrder(cmd PlaceOrderCommand) (*Order, error) {
    if cmd.IdempotencyKey == "" {
        return nil, errors.New("idempotency key required")
    }
    if existing, ok := c.orders.GetByKey(cmd.IdempotencyKey); ok {
        return existing, nil
    }
    return c.inner.PlaceOrder(cmd)
}
```

**Lesson:** Idempotency requires a stable key from the caller, plus a lookup before action. Generating a fresh key every call defeats the purpose.

</details>

---

## Bug 11: Connection pool created per call

```python
class HttpFacade:
    def get(self, url: str) -> dict:
        pool = urllib3.PoolManager()   # ← new per call
        r = pool.request("GET", url)
        return json.loads(r.data)
```

Under load, the application is slow. TLS handshakes dominate the trace.

<details><summary>Reveal</summary>

**Bug:** Each call creates a new pool — discards keep-alive connections, redoes TLS handshake every time. At 100 QPS that's 100 handshakes/sec.

**Fix:** create the pool once.

```python
class HttpFacade:
    def __init__(self):
        self._pool = urllib3.PoolManager()

    def get(self, url: str) -> dict:
        r = self._pool.request("GET", url)
        return json.loads(r.data)
```

**Lesson:** Long-lived resources (pools, clients) belong as Facade fields, not constructed per call. TLS handshakes are expensive.

</details>

---

## Bug 12: Saga compensation doesn't compensate

```java
public Order placeOrder(PlaceOrderCommand cmd) {
    var reservation = inventory.reserve(cmd.items());
    try {
        var receipt = payments.charge(cmd.user(), cmd.total());
        return orders.save(new Order(cmd.user(), reservation, receipt));
    } catch (Exception e) {
        inventory.cancel(reservation);
        throw e;
    }
}
```

After a payment failure, the inventory cancellation also fails (network issue). The reservation hangs forever.

<details><summary>Reveal</summary>

**Bug:** The compensating action (`inventory.cancel`) can also fail. If the cancel throws, the reservation isn't released. The Facade re-throws the original exception; the cancel failure is invisible.

**Fix:** make compensation reliable.

```java
} catch (Exception e) {
    try {
        inventory.cancel(reservation);
    } catch (Exception cancelEx) {
        log.error("compensation failed: must reconcile manually", cancelEx);
        // Or: enqueue for async retry; or: write to dead-letter queue
    }
    throw e;
}
```

For real reliability: use an outbox pattern or a saga orchestrator with retries.

**Lesson:** Compensation in distributed Facades must itself be reliable — or have a fallback (DLQ, manual reconciliation, async retry). Naive try/catch isn't enough at scale.

</details>

---

## Practice Tips

- Read each snippet, **stop**, predict the failure mode.
- For each bug, ask: "what's the worst production outcome?" Many Facade bugs are silent (hidden side effects, swallowed errors, defaults that bite).
- After fixing, write a test that *would have caught* the bug. If it's awkward, the fix is incomplete.
- Repeat in a week. These bugs repeat across codebases.

---

← Back to Facade folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Facade — Optimize](optimize.md)
