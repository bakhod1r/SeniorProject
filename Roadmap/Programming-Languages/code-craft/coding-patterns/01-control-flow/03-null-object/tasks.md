# Null Object — Practice Tasks

> **Category:** [Control-Flow Patterns](../README.md) — return a do-nothing object that satisfies the expected interface instead of `null`.

10 practice tasks with full Go, Java, Python solutions.

---

## Table of Contents

1. [Task 1: NullLogger](#task-1-nulllogger)
2. [Task 2: Guest User (NullCustomer)](#task-2-guest-user-nullcustomer)
3. [Task 3: Replace Scattered null Checks](#task-3-replace-scattered-null-checks)
4. [Task 4: No-op Metrics Reporter](#task-4-no-op-metrics-reporter)
5. [Task 5: Null Discount Strategy](#task-5-null-discount-strategy)
6. [Task 6: Empty Iterator as Null Object](#task-6-empty-iterator-as-null-object)
7. [Task 7: Default Field to Null Object](#task-7-default-field-to-null-object)
8. [Task 8: Factory That Hides real-vs-null](#task-8-factory-that-hides-real-vs-null)
9. [Task 9: Decide Null Object vs Fail Fast](#task-9-decide-null-object-vs-fail-fast)
10. [Task 10: Migrate Null Object to Optional](#task-10-migrate-null-object-to-optional)

---

## Task 1: NullLogger

**Goal:** Build a `Logger` interface with a real console implementation and a shared Null Object.

### Java

```java
public interface Logger {
    void info(String msg);
    void error(String msg);

    Logger NULL = new Logger() {
        public void info(String msg)  { /* no-op */ }
        public void error(String msg) { /* no-op */ }
    };
}

public final class ConsoleLogger implements Logger {
    public void info(String msg)  { System.out.println("INFO  " + msg); }
    public void error(String msg) { System.err.println("ERROR " + msg); }
}

// Decide once:
Logger log = enabled ? new ConsoleLogger() : Logger.NULL;
log.info("ready");   // unconditional
```

### Python

```python
class ConsoleLogger:
    def info(self, msg):  print(f"INFO  {msg}")
    def error(self, msg): print(f"ERROR {msg}")

class NullLogger:
    def info(self, msg):  pass
    def error(self, msg): pass

NULL_LOGGER = NullLogger()
log = ConsoleLogger() if enabled else NULL_LOGGER
log.info("ready")
```

### Go

```go
type Logger interface {
    Info(string)
    Error(string)
}

type consoleLogger struct{}
func (consoleLogger) Info(m string)  { fmt.Println("INFO  " + m) }
func (consoleLogger) Error(m string) { fmt.Fprintln(os.Stderr, "ERROR "+m) }

type nopLogger struct{}
func (nopLogger) Info(string)  {}
func (nopLogger) Error(string) {}

var Nop Logger = nopLogger{}

func NewLogger(enabled bool) Logger {
    if enabled {
        return consoleLogger{}
    }
    return Nop // never nil
}
```

---

## Task 2: Guest User (NullCustomer)

**Goal:** A `GUEST` Null Object that answers every permission query with a safe default.

### Java

```java
public interface User {
    String name();
    boolean isAuthenticated();
    boolean canEdit(String doc);

    User GUEST = new User() {
        public String name()              { return "Guest"; }
        public boolean isAuthenticated()  { return false; }
        public boolean canEdit(String d)  { return false; }
    };
}

User current = session.user() != null ? session.user() : User.GUEST;
if (current.canEdit(docId)) { /* ... */ }   // no null check
```

### Python

```python
class GuestUser:
    def name(self): return "Guest"
    def is_authenticated(self): return False
    def can_edit(self, doc): return False

GUEST = GuestUser()
current = session.user or GUEST
if current.can_edit(doc_id):
    ...
```

### Go

```go
type User interface {
    Name() string
    IsAuthenticated() bool
    CanEdit(doc string) bool
}

type guestUser struct{}
func (guestUser) Name() string              { return "Guest" }
func (guestUser) IsAuthenticated() bool      { return false }
func (guestUser) CanEdit(string) bool        { return false }

var Guest User = guestUser{}
```

---

## Task 3: Replace Scattered null Checks

**Goal:** Refactor a method riddled with `if (c != null)` into branch-free code using a Null Object.

### Before (Java)

```java
String render(Customer c) {
    String name   = (c != null) ? c.name() : "Guest";
    boolean prem  = (c != null) && c.isPremium();
    BigDecimal d  = (c != null) ? c.discountRate() : BigDecimal.ZERO;
    return name + (prem ? " ★" : "") + " " + d;
}
```

### After (Java)

```java
// Customer.GUEST returns "Guest", false, ZERO — exactly the old defaults.
String render(Customer c) {   // c never null — supplied by repo
    return c.name() + (c.isPremium() ? " ★" : "") + " " + c.discountRate();
}
```

### After (Python)

```python
def render(c):                # c never None
    star = " ★" if c.is_premium() else ""
    return f"{c.name()}{star} {c.discount_rate()}"
```

---

## Task 4: No-op Metrics Reporter

**Goal:** Instrumentation code must run unconditionally whether or not telemetry is configured.

### Go

```go
type Metrics interface {
    Incr(name string)
    Timing(name string, ms int64)
}

type nopMetrics struct{}
func (nopMetrics) Incr(string)          {}
func (nopMetrics) Timing(string, int64)  {}

var NopMetrics Metrics = nopMetrics{}

func NewMetrics(url string) Metrics {
    if url == "" {
        return NopMetrics
    }
    return newStatsd(url)
}

// Handler is unconditional:
func handle(m Metrics) {
    m.Incr("requests")              // no nil check
    defer func(t time.Time) { m.Timing("latency", time.Since(t).Milliseconds()) }(time.Now())
}
```

### Java

```java
public interface Metrics {
    void incr(String name);
    void timing(String name, long ms);

    Metrics NULL = new Metrics() {
        public void incr(String name)            { }
        public void timing(String name, long ms) { }
    };
}
```

---

## Task 5: Null Discount Strategy

**Goal:** The Null Object of a Strategy slot — a discount that changes nothing.

### Python

```python
from decimal import Decimal
from typing import Protocol

class Discount(Protocol):
    def apply(self, price: Decimal) -> Decimal: ...

class PercentDiscount:
    def __init__(self, pct: Decimal): self.pct = pct
    def apply(self, price): return price * (1 - self.pct)

class NoDiscount:
    def apply(self, price): return price        # neutral element

discount = lookup_discount(cart) or NoDiscount()
total = discount.apply(cart.subtotal())          # always callable
```

### Java

```java
public interface Discount {
    BigDecimal apply(BigDecimal price);
    Discount NONE = price -> price;   // identity = Null Object
}
```

---

## Task 6: Empty Iterator as Null Object

**Goal:** Return an empty iterator (a Null Object) instead of `null`, so loops simply don't run.

### Java

```java
public Iterator<Order> ordersFor(String userId) {
    List<Order> found = repo.find(userId);
    return found != null ? found.iterator() : Collections.emptyIterator();
}

// Caller — no null check, loop runs zero times:
for (Iterator<Order> it = ordersFor(id); it.hasNext(); ) {
    process(it.next());
}
```

### Python

```python
def orders_for(repo, user_id):
    return iter(repo.find(user_id) or [])   # empty iterator is the Null Object

for order in orders_for(repo, uid):         # zero iterations if none
    process(order)
```

### Go

```go
// An empty slice is the Null Object: range over it runs zero times.
func ordersFor(userID string) []Order {
    found := repo.Find(userID)
    if found == nil {
        return nil // ranging over nil slice = zero iterations, safe
    }
    return found
}

for _, o := range ordersFor(id) { process(o) } // no nil check
```

---

## Task 7: Default Field to Null Object

**Goal:** Ensure an optional collaborator field is never `null`, even before configuration.

### Java

```java
public final class Service {
    private Logger logger = Logger.NULL;   // safe default

    public void setLogger(Logger l) {
        this.logger = (l != null) ? l : Logger.NULL;   // never null
    }

    public void run() {
        logger.info("running");   // safe even before setLogger() is called
    }
}
```

### Python

```python
class Service:
    def __init__(self, logger=None):
        self._logger = logger or NULL_LOGGER   # never None
    def run(self):
        self._logger.info("running")
```

---

## Task 8: Factory That Hides real-vs-null

**Goal:** Centralize the single `null` check in a factory/repository so call sites stay clean.

### Java

```java
public final class CustomerRepository {
    public Customer find(String id) {
        Customer c = db.lookup(id);
        return c != null ? c : Customer.GUEST;   // the ONLY null check
    }
}

// Every caller:
Customer c = repo.find(id);   // never null
applyPricing(c.discountRate());
```

### Go

```go
func (r *Repo) Find(id string) Customer {
    if c := r.db.Lookup(id); c != nil {
        return c
    }
    return Guest // centralized
}
```

---

## Task 9: Decide Null Object vs Fail Fast

**Goal:** Given two dependencies, choose the right strategy for each.

### Java

```java
public final class Checkout {
    private final PaymentGateway gateway;   // REQUIRED → fail fast
    private final AuditSink audit;          // OPTIONAL → Null Object

    public Checkout(PaymentGateway gateway, AuditSink audit) {
        // A no-op payment gateway would ship orders unpaid — unacceptable silence.
        this.gateway = Objects.requireNonNull(gateway, "payment gateway required");
        // A no-op audit sink is fine when auditing is off.
        this.audit   = (audit != null) ? audit : AuditSink.NULL;
    }

    public void run(Order o) {
        gateway.charge(o.total());   // must really charge
        audit.record(o);             // may safely do nothing
    }
}
```

**Lesson:** required collaborator → [Fail Fast](../02-fail-fast/junior.md); optional collaborator → Null Object. The same shape ("default the dependency") is correct for one and a bug for the other.

---

## Task 10: Migrate Null Object to Optional

**Goal:** A `find()` returning a Null Object hid a decision the caller had to make (404). Migrate it to `Optional`.

### Before (Java) — hides absence

```java
public Customer find(String id) {
    Customer c = db.lookup(id);
    return c != null ? c : Customer.GUEST;   // caller can't tell "not found"
}
// Caller silently treats a missing customer as a guest — wrong for an admin page.
```

### After (Java) — forces the decision

```java
public Optional<Customer> find(String id) {
    return Optional.ofNullable(db.lookup(id));
}

// Caller must now decide:
Customer c = repo.find(id)
    .orElseThrow(() -> new NotFoundException(id));   // 404 on the admin page
```

### After (Python)

```python
def find(repo, cid) -> "Customer | None":
    return repo.get(cid)   # return None; let caller branch

c = find(repo, cid)
if c is None:
    raise NotFound(cid)
```

**Lesson:** when the silence of a Null Object proves to be a bug — the caller *needed* to know about absence — migrate to `Optional`/`Result` to make the absence explicit in the type.

---

## Practice Tips

1. **Always implement the full interface** with neutral, non-throwing methods.
2. **Share one immutable singleton** — never `new NullX()` per call.
3. **Centralize the real-vs-null choice** in a factory/repository.
4. **For every Null Object, ask:** is "do nothing" correct here, or should this [fail fast](../02-fail-fast/junior.md)?
5. **Use `go test -race`** to confirm a shared Null Object stays stateless.

---

[← Interview](interview.md) · [Control Flow](../README.md) · [Coding Patterns](../../README.md) · **Next:** [Find-Bug](find-bug.md)
