# OO Abusers — Practice Tasks

> 12 hands-on exercises across the four OO Abusers, with full solutions.

---

## Task 1 — Switch Statements (Java)

**Problem:** Replace this type-code switch with polymorphism.

```java
class Notification {
    String type; // "email", "sms", "push"
    String to;
    String content;
}

class NotificationSender {
    void send(Notification n) {
        switch (n.type) {
            case "email": emailGateway.send(n.to, n.content); break;
            case "sms": smsGateway.send(n.to, n.content); break;
            case "push": pushGateway.send(n.to, n.content); break;
            default: throw new IllegalStateException();
        }
    }
}
```

**Solution:**

```java
sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {
    void send();
}

record EmailNotification(String to, String content, EmailGateway gateway) implements Notification {
    public void send() { gateway.send(to, content); }
}

record SmsNotification(String to, String content, SmsGateway gateway) implements Notification {
    public void send() { gateway.send(to, content); }
}

record PushNotification(String to, String content, PushGateway gateway) implements Notification {
    public void send() { gateway.send(to, content); }
}

class NotificationSender {
    void send(Notification n) { n.send(); }
}
```

---

## Task 2 — Switch with State (Java)

**Problem:** Apply Replace Type Code with State to model an order's status with per-state behavior.

```java
class Order {
    String status; // "DRAFT", "PAID", "SHIPPED", "DELIVERED"
    
    public List<String> allowedActions() {
        switch (status) {
            case "DRAFT": return List.of("ADD_ITEM", "REMOVE_ITEM", "PAY", "CANCEL");
            case "PAID": return List.of("SHIP", "REFUND");
            case "SHIPPED": return List.of("MARK_DELIVERED");
            case "DELIVERED": return List.of("REVIEW");
            default: return List.of();
        }
    }
}
```

**Solution:**

```java
sealed interface OrderState permits Draft, Paid, Shipped, Delivered {
    List<String> allowedActions();
}

final class Draft implements OrderState {
    public List<String> allowedActions() {
        return List.of("ADD_ITEM", "REMOVE_ITEM", "PAY", "CANCEL");
    }
}
final class Paid implements OrderState {
    public List<String> allowedActions() { return List.of("SHIP", "REFUND"); }
}
final class Shipped implements OrderState {
    public List<String> allowedActions() { return List.of("MARK_DELIVERED"); }
}
final class Delivered implements OrderState {
    public List<String> allowedActions() { return List.of("REVIEW"); }
}

class Order {
    private OrderState state = new Draft();
    public List<String> allowedActions() { return state.allowedActions(); }
}
```

---

## Task 3 — Refused Bequest (Java)

**Problem:** `Penguin extends Bird` is a textbook Refused Bequest. Refactor with Replace Inheritance with Delegation.

```java
abstract class Bird {
    String name;
    public abstract void fly();
}

class Eagle extends Bird {
    public void fly() { System.out.println(name + " soars."); }
}

class Penguin extends Bird {
    public void fly() {
        throw new UnsupportedOperationException("Penguins can't fly");
    }
}
```

**Solution:**

```java
abstract class Bird {
    protected final String name;
    protected Bird(String name) { this.name = name; }
}

interface FlyBehavior { void fly(String name); }
class Soars implements FlyBehavior {
    public void fly(String name) { System.out.println(name + " soars."); }
}
class CannotFly implements FlyBehavior {
    public void fly(String name) { throw new UnsupportedOperationException(name + " can't fly"); }
}

class Eagle extends Bird {
    private final FlyBehavior flying = new Soars();
    public Eagle(String name) { super(name); }
    public void fly() { flying.fly(name); }
}

class Penguin extends Bird {
    // No fly() method at all — can't be called by mistake.
    public Penguin(String name) { super(name); }
    public void swim() { System.out.println(name + " swims."); }
}
```

---

## Task 4 — Temporary Field (Java)

**Problem:** Refactor to remove the temporary fields.

```java
class GraphSearch {
    private Graph graph;
    private Map<Node, Node> previous;  // only set during shortestPath
    private Map<Node, Integer> distance;  // ditto
    
    public List<Node> shortestPath(Node from, Node to) {
        previous = new HashMap<>();
        distance = new HashMap<>();
        // dijkstra implementation using previous and distance
        return reconstructPath(to);
    }
    
    private List<Node> reconstructPath(Node target) {
        // uses previous
        ...
    }
}
```

**Solution:**

```java
class GraphSearch {
    private final Graph graph;
    
    public List<Node> shortestPath(Node from, Node to) {
        return new SearchOperation(graph, from, to).execute();
    }
}

class SearchOperation {
    private final Graph graph;
    private final Node from, to;
    private final Map<Node, Node> previous = new HashMap<>();
    private final Map<Node, Integer> distance = new HashMap<>();
    
    SearchOperation(Graph graph, Node from, Node to) {
        this.graph = graph;
        this.from = from;
        this.to = to;
    }
    
    List<Node> execute() {
        // dijkstra
        return reconstructPath();
    }
    
    private List<Node> reconstructPath() {
        // uses previous
        ...
    }
}
```

---

## Task 5 — Switch + Type Code (Python)

**Problem:** Replace the type-code dispatch with polymorphism.

```python
class Animal:
    def __init__(self, kind):
        self.kind = kind

def speak(animal):
    if animal.kind == "dog":
        return "Woof"
    elif animal.kind == "cat":
        return "Meow"
    elif animal.kind == "cow":
        return "Moo"
```

**Solution:**

```python
from abc import ABC, abstractmethod

class Animal(ABC):
    @abstractmethod
    def speak(self) -> str: ...

class Dog(Animal):
    def speak(self): return "Woof"

class Cat(Animal):
    def speak(self): return "Meow"

class Cow(Animal):
    def speak(self): return "Moo"

# usage:
def speak(animal: Animal) -> str:
    return animal.speak()
```

---

## Task 6 — Alternative Classes (Java)

**Problem:** These two classes do similar work with unrelated APIs. Extract a common interface.

```java
class FileLogger {
    public void writeMessage(String msg) { ... }
    public void flushAll() { ... }
}

class CloudLogger {
    public void uploadEvent(String event) { ... }
    public void sync() { ... }
}
```

**Solution:**

```java
interface Logger {
    void log(String message);
    void flush();
}

class FileLogger implements Logger {
    public void log(String message) { /* was writeMessage */ }
    public void flush() { /* was flushAll */ }
}

class CloudLogger implements Logger {
    public void log(String message) { /* was uploadEvent */ }
    public void flush() { /* was sync */ }
}

// Callers can now polymorphically use either:
void process(Logger logger) {
    logger.log("Started");
    // ...
    logger.flush();
}
```

---

## Task 7 — Replace Conditional with Polymorphism in Go

**Problem:** Replace the type-switch with proper interface dispatch.

```go
type Employee struct {
    Type   string // "salaried", "hourly", "commission"
    Salary float64
    Hours  int
    Rate   float64
    Sales  float64
    Comm   float64
}

func PayAmount(e Employee) float64 {
    switch e.Type {
    case "salaried":
        return e.Salary
    case "hourly":
        return float64(e.Hours) * e.Rate
    case "commission":
        return e.Sales * e.Comm
    }
    return 0
}
```

**Solution:**

```go
type PayCalculator interface {
    PayAmount() float64
}

type Salaried struct{ Salary float64 }
func (s Salaried) PayAmount() float64 { return s.Salary }

type Hourly struct {
    Hours int
    Rate  float64
}
func (h Hourly) PayAmount() float64 { return float64(h.Hours) * h.Rate }

type Commission struct {
    Sales, Rate float64
}
func (c Commission) PayAmount() float64 { return c.Sales * c.Rate }

func PayAmount(e PayCalculator) float64 { return e.PayAmount() }
```

---

## Task 8 — Introduce Null Object (Java)

**Problem:** Eliminate the `null` checks by introducing a null object.

```java
class Customer {
    private DiscountPlan plan; // sometimes null
    
    public BigDecimal apply(BigDecimal amount) {
        if (plan == null) return amount;
        return plan.apply(amount);
    }
}

interface DiscountPlan {
    BigDecimal apply(BigDecimal amount);
}
```

**Solution:**

```java
interface DiscountPlan {
    BigDecimal apply(BigDecimal amount);
    
    static DiscountPlan none() {
        return amount -> amount;  // identity
    }
}

class Customer {
    private DiscountPlan plan = DiscountPlan.none();
    
    public BigDecimal apply(BigDecimal amount) {
        return plan.apply(amount);  // no null check
    }
}
```

---

## Task 9 — Refused Bequest in Python

**Problem:** Refactor.

```python
class Stream:
    def read(self): ...
    def write(self, data): ...

class ReadOnlyFile(Stream):
    def __init__(self, path): self.path = path
    def read(self): return open(self.path).read()
    def write(self, data):
        raise NotImplementedError("read-only")
```

**Solution:**

```python
from typing import Protocol

class Readable(Protocol):
    def read(self) -> str: ...

class Writable(Protocol):
    def write(self, data: str) -> None: ...

class ReadOnlyFile:
    def __init__(self, path):
        self.path = path
    def read(self) -> str:
        return open(self.path).read()
    # No write() at all — can't be misused.

class ReadWriteFile:
    def __init__(self, path):
        self.path = path
    def read(self) -> str: ...
    def write(self, data: str) -> None: ...

# Functions that need only reading take a Readable:
def consume(source: Readable):
    print(source.read())
```

`mypy --strict` rejects passing a `ReadOnlyFile` to a function expecting a `Writable`.

---

## Task 10 — Pattern matching with sealed types (Java 21+)

**Problem:** Convert this nested `instanceof` chain to a sealed-type pattern match.

```java
double processPayment(Payment p) {
    if (p instanceof CashPayment cp) {
        return cp.getAmount();
    } else if (p instanceof CreditCardPayment ccp) {
        return ccp.getAmount() - ccp.getProcessingFee();
    } else if (p instanceof CryptoPayment crp) {
        return crp.getAmount() * (1 - crp.getNetworkFee());
    }
    throw new IllegalStateException();
}
```

**Solution:**

```java
sealed interface Payment permits CashPayment, CreditCardPayment, CryptoPayment {}
record CashPayment(BigDecimal amount) implements Payment {}
record CreditCardPayment(BigDecimal amount, BigDecimal processingFee) implements Payment {}
record CryptoPayment(BigDecimal amount, BigDecimal networkFee) implements Payment {}

double processPayment(Payment p) {
    return switch (p) {
        case CashPayment(var amount) -> amount.doubleValue();
        case CreditCardPayment(var amount, var fee) -> amount.subtract(fee).doubleValue();
        case CryptoPayment(var amount, var fee) -> amount.multiply(BigDecimal.ONE.subtract(fee)).doubleValue();
    };
}  // exhaustive — compiler enforces
```

---

## Task 11 — Find the OO Abusers (Java)

**Problem:** Identify all OO Abusers in this code.

```java
class Notification {
    String type;
    String content;
    String to;
    
    String emailSubject;  // only when type="email"
    String emailBody;     // only when type="email"
    String smsCarrier;    // only when type="sms"
    String pushDeviceToken; // only when type="push"
    
    void send() {
        switch (type) {
            case "email":
                emailService.send(to, emailSubject, emailBody);
                break;
            case "sms":
                smsService.send(to, content, smsCarrier);
                break;
            case "push":
                pushService.send(pushDeviceToken, content);
                break;
        }
    }
}
```

**Solution:**

| Smell | Where |
|---|---|
| **Switch Statements** | `send()` switches on `type` |
| **Temporary Field** | `emailSubject`, `emailBody`, `smsCarrier`, `pushDeviceToken` are null for most types |
| (related: **Primitive Obsession**) | `String type` is a type code |

**Cure (combined):**

```java
sealed interface Notification permits Email, Sms, Push {
    void send();
}

record Email(String to, String subject, String body) implements Notification {
    public void send() { emailService.send(to, subject, body); }
}

record Sms(String to, String content, String carrier) implements Notification {
    public void send() { smsService.send(to, content, carrier); }
}

record Push(String deviceToken, String content) implements Notification {
    public void send() { pushService.send(deviceToken, content); }
}
```

Each notification type now has only its relevant fields. No temporary fields. No type-code switch.

---

## Task 12 — Capability-based design (Go)

**Problem:** This struct embeds `*os.File` to get IO methods, but exposes ALL of them. Restructure to expose only `Read` and `Close`.

```go
type ReadOnlyFile struct {
    *os.File  // exposes Read, Write, Seek, Close, Sync, etc.
}
```

**Solution:**

```go
type ReadOnlyFile struct {
    f *os.File  // not embedded — private
}

func Open(path string) (*ReadOnlyFile, error) {
    f, err := os.Open(path)
    if err != nil { return nil, err }
    return &ReadOnlyFile{f: f}, nil
}

func (r *ReadOnlyFile) Read(p []byte) (int, error) { return r.f.Read(p) }
func (r *ReadOnlyFile) Close() error               { return r.f.Close() }
// No Write, Seek, Sync — caller can't access them.
```

This is Go's idiomatic answer to Refused Bequest: replace embedding with explicit forwarding for only the methods you want to expose.

---

> **Next:** [find-bug.md](find-bug.md) — buggy snippets where OO Abusers hide subtle bugs.
