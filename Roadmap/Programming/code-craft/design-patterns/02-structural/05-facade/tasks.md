# Facade — Hands-On Tasks

> **Source:** [refactoring.guru/design-patterns/facade](https://refactoring.guru/design-patterns/facade)

Each task includes a brief and a reference solution. Try first; check after.

---

## Table of Contents

1. [Task 1: Home theater controller](#task-1-home-theater-controller)
2. [Task 2: Order placement service](#task-2-order-placement-service)
3. [Task 3: HTTP client with retries + JSON](#task-3-http-client-with-retries-json)
4. [Task 4: Compiler frontend](#task-4-compiler-frontend)
5. [Task 5: Multiple Facades for the same subsystem](#task-5-multiple-facades-for-the-same-subsystem)
6. [Task 6: BFF aggregator](#task-6-bff-aggregator)
7. [Task 7: Test fixture builder](#task-7-test-fixture-builder)
8. [Task 8: Refactor scattered orchestration](#task-8-refactor-scattered-orchestration)
9. [Task 9: Idempotency-aware Facade](#task-9-idempotency-aware-facade)
10. [Task 10: Facade with parallel fan-out](#task-10-facade-with-parallel-fan-out)
11. [How to Practice](#how-to-practice)

---

## Task 1: Home theater controller

**Brief.** `WatchMovie` and `EndMovie` orchestrate TV, Receiver, Lights.

### Solution (Go)

```go
type TV struct{}
func (TV) On() { fmt.Println("tv on") }
func (TV) Off() { fmt.Println("tv off") }

type Receiver struct{}
func (Receiver) On(vol int) { fmt.Println("receiver on vol", vol) }
func (Receiver) Off() { fmt.Println("receiver off") }

type Lights struct{}
func (Lights) Dim(level int) { fmt.Println("lights dim", level) }
func (Lights) On() { fmt.Println("lights on") }

type HomeTheater struct{ tv TV; receiver Receiver; lights Lights }

func (h HomeTheater) WatchMovie() {
    h.lights.Dim(20)
    h.tv.On()
    h.receiver.On(50)
}

func (h HomeTheater) EndMovie() {
    h.receiver.Off()
    h.tv.Off()
    h.lights.On()
}
```

---

## Task 2: Order placement service

**Brief.** A Facade that orchestrates inventory, payment, persistence, and notification.

### Solution (Java)

```java
public class OrderService {
    private final InventoryService inv;
    private final PaymentProcessor pay;
    private final OrderRepository orders;
    private final NotificationGateway notify;

    public Order placeOrder(PlaceOrderCommand cmd) {
        var reservation = inv.reserve(cmd.items());
        try {
            var receipt = pay.charge(cmd.userId(), cmd.total(), cmd.paymentMethod());
            var order = orders.save(new Order(cmd.userId(), cmd.items(), receipt));
            notify.sendOrderConfirmation(order);
            return order;
        } catch (Exception e) {
            inv.cancel(reservation);
            throw new OrderException("place failed", e);
        }
    }
}
```

---

## Task 3: HTTP client with retries + JSON

**Brief.** A Facade that wraps an HTTP library; adds retries and JSON decoding.

### Solution (Python)

```python
import json, urllib3


class Http:
    def __init__(self, retries: int = 3, timeout: int = 30):
        self._pool = urllib3.PoolManager(retries=urllib3.Retry(total=retries, backoff_factor=0.3))
        self._timeout = timeout

    def get_json(self, url: str, params: dict | None = None) -> dict:
        if params: url += "?" + urllib3.request.urlencode(params)
        r = self._pool.request("GET", url, timeout=self._timeout)
        if r.status >= 400: raise HttpError(f"{url} -> {r.status}")
        return json.loads(r.data.decode())

    def post_json(self, url: str, body: dict) -> dict:
        r = self._pool.request("POST", url,
                              body=json.dumps(body).encode(),
                              headers={"Content-Type": "application/json"},
                              timeout=self._timeout)
        if r.status >= 400: raise HttpError(f"{url} -> {r.status}")
        return json.loads(r.data.decode())
```

---

## Task 4: Compiler frontend

**Brief.** Lex → parse → optimize → emit. Hide all four stages behind `compile(source)`.

### Solution (Python)

```python
class Compiler:
    def __init__(self, lexer, parser, optimizer, codegen):
        self._lexer = lexer
        self._parser = parser
        self._optimizer = optimizer
        self._codegen = codegen

    def compile(self, source: str) -> bytes:
        tokens = self._lexer.tokenize(source)
        ast = self._parser.parse(tokens)
        ast = self._optimizer.optimize(ast)
        return self._codegen.emit(ast)
```

Power users: call individual stages for tooling (linter uses lexer + parser only).

---

## Task 5: Multiple Facades for the same subsystem

**Brief.** Order subsystem with `CustomerCheckoutFacade` (storefront) and `AdminOrderFacade` (ops).

### Solution (Java)

```java
public class CustomerCheckoutFacade {
    public Order placeOrder(PlaceOrderCommand cmd) { /* ... */ }
    public void cancelOrder(String orderId, String userId) { /* ... */ }
    public List<Order> myOrders(String userId) { /* ... */ }
}

public class AdminOrderFacade {
    public Refund issueRefund(String orderId, Money amount, String reason) { /* ... */ }
    public Order forceCancel(String orderId, String adminId, String reason) { /* ... */ }
    public Order reissue(String orderId, String adminId) { /* ... */ }
    public OrderAnalytics analytics(LocalDate start, LocalDate end) { /* ... */ }
}
```

Both Facades use the same `OrderRepository`, `PaymentProcessor`, etc. — but expose different APIs for different audiences.

---

## Task 6: BFF aggregator

**Brief.** A mobile homepage Facade that calls 3 services in parallel.

### Solution (TypeScript / Node)

```ts
class MobileBff {
    constructor(
        private orders: OrderClient,
        private user: UserClient,
        private recs: RecsClient,
    ) {}

    async homepage(userId: string): Promise<HomepageDto> {
        const [profile, recent, recommendations] = await Promise.all([
            this.user.profile(userId),
            this.orders.recent(userId, 5),
            this.recs.forUser(userId, 10),
        ]);
        return {
            displayName: profile.name,
            recentOrderIds: recent.map(o => o.id),
            recommended: recommendations.map(r => ({ id: r.id, title: r.title })),
        };
    }
}
```

---

## Task 7: Test fixture builder

**Brief.** A Facade for tests: `TestFixture.completeOrder()` builds a user, products, cart, and a placed order.

### Solution (Python)

```python
class TestFixture:
    def __init__(self, user_factory, product_factory, order_service):
        self._user_factory = user_factory
        self._product_factory = product_factory
        self._order_service = order_service

    def complete_order(self, num_items: int = 2):
        user = self._user_factory.build(verified=True)
        products = [self._product_factory.build() for _ in range(num_items)]
        order = self._order_service.place_order(PlaceOrderCommand(
            user_id=user.id,
            items=[OrderItem(p.id, 1) for p in products],
            payment_method="test_card",
        ))
        return user, products, order
```

A test calls `user, products, order = fixture.complete_order(num_items=3)` and gets a complete scenario.

---

## Task 8: Refactor scattered orchestration

**Brief.** This appears in 6 routes:

```python
def some_route():
    inv.reserve(items)
    receipt = pay.charge(user, total)
    order = orders.save(...)
    email.send(user.email, ...)
    return order
```

Refactor into `OrderService.placeOrder` and migrate the 6 routes.

### Solution (Python)

```python
class OrderService:
    def __init__(self, inv, pay, orders, email):
        self._inv = inv
        self._pay = pay
        self._orders = orders
        self._email = email

    def place_order(self, user, items, payment_method):
        reservation = self._inv.reserve(items)
        try:
            receipt = self._pay.charge(user, sum_total(items), payment_method)
            order = self._orders.save(Order(user.id, items, receipt))
            self._email.send(user.email, "Order confirmation", f"Order {order.id}")
            return order
        except Exception:
            self._inv.cancel(reservation)
            raise
```

Routes call `order = service.place_order(user, items, payment_method)`.

---

## Task 9: Idempotency-aware Facade

**Brief.** Same call twice with the same key returns the same result without re-executing.

### Solution (Go)

```go
func (c *CheckoutFacade) PlaceOrder(ctx context.Context, cmd PlaceOrderCommand) (*Order, error) {
    if cmd.IdempotencyKey == "" {
        cmd.IdempotencyKey = uuid.NewString()
    }
    if existing, found := c.orders.GetByIdempotencyKey(ctx, cmd.IdempotencyKey); found {
        return existing, nil
    }
    return c.placeOrderInner(ctx, cmd)
}
```

The Facade ensures identical calls don't double-charge.

---

## Task 10: Facade with parallel fan-out

**Brief.** A `quote()` Facade method that runs 3 subsystem calls in parallel.

### Solution (Java)

```java
public OrderQuote quote(QuoteCommand cmd) {
    var inv = supplyAsync(() -> inventory.check(cmd.items()), executor);
    var price = supplyAsync(() -> pricing.quote(cmd.items(), cmd.user()), executor);
    var risk = supplyAsync(() -> fraud.score(cmd.user(), cmd.ip()), executor);

    return allOf(inv, price, risk)
        .orTimeout(2, SECONDS)
        .thenApply(_ -> new OrderQuote(inv.join(), price.join(), risk.join()))
        .join();
}
```

Latency = max(inv, price, risk) instead of sum.

---

## How to Practice

1. **Try each task.** Don't peek before you have something working.
2. **Limit scope.** Each Facade should fit on one screen. If it grows, split.
3. **Mock subsystems for tests.** Fast unit tests verify orchestration order and defaults.
4. **Identify a real Facade in your codebase.** Audit it: too many methods? Right scope?
5. **Add observability.** Log + metric + trace at the Facade boundary for one method; show the trace.
6. **Practice splitting.** Take a large Facade and refactor into 2-3 smaller ones by audience.
7. **Measure.** Build a parallel fan-out Facade; benchmark vs sequential; show the latency drop.

---

← Back to Facade folder · [↑ Structural Patterns](../README.md) · [↑↑ Roadmap Home](../../../README.md)

**Next:** [Facade — Find the Bug](find-bug.md)
