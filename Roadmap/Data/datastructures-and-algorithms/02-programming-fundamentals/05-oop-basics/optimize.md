# OOP Basics - Optimization Exercises

Each exercise shows a "before" version with an OOP design problem and an "after" version with the optimized solution. Analyze the improvement in readability, maintainability, performance, and testability.

---

## Optimization 1: Deep Hierarchy → Composition

### Before (Bad: Deep Inheritance)

```java
// 5 levels deep — fragile, rigid, hard to extend
class Entity {
    protected String id;
    protected LocalDateTime createdAt;
}

class AuditableEntity extends Entity {
    protected String createdBy;
    protected String updatedBy;
}

class SoftDeletableEntity extends AuditableEntity {
    protected boolean deleted;
    protected LocalDateTime deletedAt;
}

class BaseUser extends SoftDeletableEntity {
    protected String name;
    protected String email;
}

class AdminUser extends BaseUser {
    protected List<String> permissions;
}

// Problem: What if we want a non-deletable admin?
// What if we want an auditable entity that's not soft-deletable?
// Every change to Entity affects ALL 5 levels below it.
```

### After (Good: Composition)

```java
// Small, focused components
class Audit {
    private String createdBy;
    private String updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}

class SoftDelete {
    private boolean deleted;
    private LocalDateTime deletedAt;

    public void markDeleted() {
        this.deleted = true;
        this.deletedAt = LocalDateTime.now();
    }
}

class User {
    private String id;
    private String name;
    private String email;
    private Audit audit;           // HAS audit (optional)
    private SoftDelete softDelete; // HAS soft-delete (optional)
    private List<String> permissions;

    // Mix and match behaviors as needed
}

// Easy to create:
// - User with audit + soft-delete
// - User with audit only
// - User with neither
```

**Improvement:**
| Metric         | Before           | After             |
|----------------|------------------|-------------------|
| Coupling       | High (5 levels)  | Low (composition) |
| Flexibility    | Rigid            | Mix and match     |
| Testability    | Must mock 5 classes | Test each independently |
| Hierarchy depth| 5                | 1                 |

---

## Optimization 2: God Class → Single Responsibility

### Before (Bad: God Class)

```python
class OrderManager:
    """Does EVERYTHING related to orders."""

    def __init__(self):
        self.orders = {}
        self.db_connection = self._connect_to_db()
        self.email_client = self._setup_email()
        self.payment_gateway = self._setup_payment()

    def _connect_to_db(self): pass
    def _setup_email(self): pass
    def _setup_payment(self): pass

    # Order CRUD
    def create_order(self, user_id, items): pass
    def get_order(self, order_id): pass
    def update_order(self, order_id, data): pass
    def delete_order(self, order_id): pass

    # Payment
    def charge_customer(self, order_id): pass
    def refund_order(self, order_id): pass
    def check_payment_status(self, order_id): pass

    # Notifications
    def send_confirmation_email(self, order_id): pass
    def send_shipping_notification(self, order_id): pass
    def send_refund_notification(self, order_id): pass

    # Reporting
    def generate_daily_report(self): pass
    def calculate_revenue(self, start_date, end_date): pass
    def export_to_csv(self, filepath): pass

    # Inventory
    def check_inventory(self, item_id): pass
    def reserve_inventory(self, items): pass
    def release_inventory(self, items): pass

    # 500+ more lines...
```

### After (Good: Separated Responsibilities)

```python
class OrderService:
    """Handles order lifecycle only."""
    def __init__(self, repo: "OrderRepository", payment: "PaymentService",
                 notifier: "NotificationService", inventory: "InventoryService"):
        self.repo = repo
        self.payment = payment
        self.notifier = notifier
        self.inventory = inventory

    def create_order(self, user_id: str, items: list) -> "Order":
        self.inventory.reserve(items)
        order = Order(user_id=user_id, items=items)
        self.repo.save(order)
        self.notifier.send_confirmation(order)
        return order

    def cancel_order(self, order_id: str) -> None:
        order = self.repo.find_by_id(order_id)
        self.payment.refund(order)
        self.inventory.release(order.items)
        self.notifier.send_cancellation(order)
        self.repo.delete(order_id)


class OrderRepository:
    """Database operations for orders."""
    def save(self, order: "Order") -> None: pass
    def find_by_id(self, order_id: str) -> "Order": pass
    def delete(self, order_id: str) -> None: pass


class PaymentService:
    """Payment operations."""
    def charge(self, order: "Order") -> None: pass
    def refund(self, order: "Order") -> None: pass


class NotificationService:
    """All notification types."""
    def send_confirmation(self, order: "Order") -> None: pass
    def send_cancellation(self, order: "Order") -> None: pass
    def send_shipping(self, order: "Order") -> None: pass


class InventoryService:
    """Inventory management."""
    def reserve(self, items: list) -> None: pass
    def release(self, items: list) -> None: pass
    def check(self, item_id: str) -> int: pass


class ReportService:
    """Reporting and analytics."""
    def daily_report(self) -> str: pass
    def revenue(self, start_date, end_date) -> float: pass
    def export_csv(self, filepath: str) -> None: pass
```

**Improvement:**
| Metric             | Before (God Class) | After (SRP)        |
|--------------------|--------------------|--------------------|
| Lines per class    | 500+               | 30-50 each         |
| Reasons to change  | 6+                 | 1 per class        |
| Test setup         | Mock everything    | Mock only deps     |
| Reusability        | None               | High               |

---

## Optimization 3: Mutable State → Immutable Objects

### Before (Bad: Mutable)

```go
type Config struct {
    Host     string
    Port     int
    Database string
    Debug    bool
}

// Anyone can change config at any time
func startServer(cfg *Config) {
    fmt.Printf("Starting on %s:%d\n", cfg.Host, cfg.Port)

    // Meanwhile in another goroutine...
    // cfg.Port = 9999  // Data race! Server config changed mid-flight
}
```

### After (Good: Immutable)

```go
type Config struct {
    host     string  // unexported — can't be modified from outside
    port     int
    database string
    debug    bool
}

// Getters only, no setters
func (c Config) Host() string     { return c.host }
func (c Config) Port() int        { return c.port }
func (c Config) Database() string { return c.database }
func (c Config) Debug() bool      { return c.debug }

// Builder for creation
type ConfigBuilder struct {
    host, database string
    port           int
    debug          bool
}

func NewConfigBuilder() *ConfigBuilder {
    return &ConfigBuilder{host: "localhost", port: 8080}
}

func (b *ConfigBuilder) WithHost(h string) *ConfigBuilder  { b.host = h; return b }
func (b *ConfigBuilder) WithPort(p int) *ConfigBuilder     { b.port = p; return b }
func (b *ConfigBuilder) WithDB(db string) *ConfigBuilder   { b.database = db; return b }
func (b *ConfigBuilder) WithDebug(d bool) *ConfigBuilder   { b.debug = d; return b }

func (b *ConfigBuilder) Build() Config { // Returns value, not pointer
    return Config{
        host:     b.host,
        port:     b.port,
        database: b.database,
        debug:    b.debug,
    }
}

// To "change" config, create a new one
func (c Config) WithPort(port int) Config {
    return Config{host: c.host, port: port, database: c.database, debug: c.debug}
}

// Usage
cfg := NewConfigBuilder().WithHost("prod.example.com").WithPort(443).Build()
// cfg.port = 9999  // Compiler error: unexported field
newCfg := cfg.WithPort(8443) // Creates new Config, original unchanged
```

**Python equivalent:**
```python
from dataclasses import dataclass

@dataclass(frozen=True)  # frozen=True makes it immutable
class Config:
    host: str = "localhost"
    port: int = 8080
    database: str = ""
    debug: bool = False

cfg = Config(host="prod.example.com", port=443)
# cfg.port = 9999  # FrozenInstanceError!

# To "change", create a new one:
from dataclasses import replace
new_cfg = replace(cfg, port=8443)  # New Config with different port
```

**Improvement:**
| Metric           | Mutable          | Immutable          |
|------------------|------------------|--------------------|
| Thread safety    | Needs locks      | Inherently safe    |
| Debugging        | "Who changed it?" | No surprise changes |
| Sharing          | Dangerous        | Safe to share      |
| State tracking   | Complex          | Simple             |

---

## Optimization 4: Reflection → Interface

### Before (Bad: Reflection)

```go
import "reflect"

func Process(obj any) {
    v := reflect.ValueOf(obj)
    method := v.MethodByName("Execute")
    if !method.IsValid() {
        panic("no Execute method")
    }
    result := method.Call(nil)
    fmt.Println(result[0].Interface())
}

// Problems:
// 1. No compile-time type checking
// 2. 10-100x slower than interface dispatch
// 3. Panics at runtime instead of compile errors
```

### After (Good: Interface)

```go
type Executor interface {
    Execute() string
}

func Process(e Executor) {
    fmt.Println(e.Execute())
}

// Benefits:
// 1. Compile-time type checking
// 2. Fast interface dispatch
// 3. IDE auto-completion and documentation
```

**Java equivalent:**

```java
// Before: Reflection
Method method = obj.getClass().getMethod("execute");
Object result = method.invoke(obj);  // Slow, unchecked, exception-prone

// After: Interface
interface Executor {
    String execute();
}

void process(Executor e) {
    System.out.println(e.execute());  // Fast, type-safe
}
```

**Performance comparison:**
```
Go benchmark (10M calls):
  Interface dispatch: ~25ms
  Reflection:         ~500ms  (20x slower)

Java benchmark (10M calls, after JIT):
  Interface dispatch: ~15ms
  Reflection:         ~200ms  (13x slower)
```

---

## Optimization 5: Type Switch Chains → Polymorphism

### Before (Bad: Type checking everywhere)

```python
def calculate_area(shape):
    if isinstance(shape, Circle):
        return math.pi * shape.radius ** 2
    elif isinstance(shape, Rectangle):
        return shape.width * shape.height
    elif isinstance(shape, Triangle):
        s = (shape.a + shape.b + shape.c) / 2
        return math.sqrt(s * (s - shape.a) * (s - shape.b) * (s - shape.c))
    else:
        raise ValueError(f"Unknown shape: {type(shape)}")

def calculate_perimeter(shape):
    if isinstance(shape, Circle):
        return 2 * math.pi * shape.radius
    elif isinstance(shape, Rectangle):
        return 2 * (shape.width + shape.height)
    elif isinstance(shape, Triangle):
        return shape.a + shape.b + shape.c
    else:
        raise ValueError(f"Unknown shape: {type(shape)}")

# Every new shape requires modifying EVERY function that handles shapes
# Easy to forget one, leading to runtime errors
```

### After (Good: Polymorphism)

```python
from abc import ABC, abstractmethod
import math

class Shape(ABC):
    @abstractmethod
    def area(self) -> float: pass

    @abstractmethod
    def perimeter(self) -> float: pass

class Circle(Shape):
    def __init__(self, radius: float):
        self.radius = radius
    def area(self) -> float:
        return math.pi * self.radius ** 2
    def perimeter(self) -> float:
        return 2 * math.pi * self.radius

class Rectangle(Shape):
    def __init__(self, width: float, height: float):
        self.width = width
        self.height = height
    def area(self) -> float:
        return self.width * self.height
    def perimeter(self) -> float:
        return 2 * (self.width + self.height)

# Adding new shape: create ONE class, implement TWO methods. Done.
class Pentagon(Shape):
    def __init__(self, side: float):
        self.side = side
    def area(self) -> float:
        return (math.sqrt(5 * (5 + 2 * math.sqrt(5))) / 4) * self.side ** 2
    def perimeter(self) -> float:
        return 5 * self.side

# No existing code modified!
def total_area(shapes: list[Shape]) -> float:
    return sum(s.area() for s in shapes)  # Works with Pentagon automatically
```

**Improvement:**
| Metric              | Before (type switch) | After (polymorphism)  |
|---------------------|---------------------|-----------------------|
| Adding new type     | Modify N functions  | Add 1 class           |
| Forgetting a case   | Runtime error       | Compile-time error    |
| Open/Closed         | Violated            | Satisfied             |
| Lines of code       | Grows linearly      | Stays localized       |

---

## Optimization 6: Large Interface → Small Interfaces

### Before (Bad: Fat Interface)

```go
type DataStore interface {
    // Read operations
    Get(key string) ([]byte, error)
    List(prefix string) ([][]byte, error)
    Search(query string) ([][]byte, error)

    // Write operations
    Set(key string, value []byte) error
    Delete(key string) error
    BatchSet(items map[string][]byte) error

    // Admin operations
    Backup() error
    Restore(path string) error
    Stats() map[string]int64

    // Pub/Sub
    Subscribe(channel string) (<-chan []byte, error)
    Publish(channel string, data []byte) error
}

// Problem: A read-only cache needs to implement Backup(), Subscribe(), etc.
// Most consumers only need 1-2 methods
```

### After (Good: Small, Composable Interfaces)

```go
type Reader interface {
    Get(key string) ([]byte, error)
}

type Writer interface {
    Set(key string, value []byte) error
    Delete(key string) error
}

type Lister interface {
    List(prefix string) ([][]byte, error)
}

type ReadWriter interface {
    Reader
    Writer
}

type Searchable interface {
    Search(query string) ([][]byte, error)
}

type Subscribable interface {
    Subscribe(channel string) (<-chan []byte, error)
    Publish(channel string, data []byte) error
}

// Functions accept only what they need
func GetUser(store Reader, userID string) (*User, error) {
    data, err := store.Get("user:" + userID)
    // ...
}

func SaveUser(store Writer, user *User) error {
    data, _ := json.Marshal(user)
    return store.Set("user:"+user.ID, data)
}

// A simple cache only needs to implement Reader
type SimpleCache struct {
    data map[string][]byte
}

func (c *SimpleCache) Get(key string) ([]byte, error) {
    v, ok := c.data[key]
    if !ok {
        return nil, fmt.Errorf("not found: %s", key)
    }
    return v, nil
}
// SimpleCache satisfies Reader — that's all it needs
```

**Improvement:**
| Metric              | Fat Interface    | Small Interfaces    |
|---------------------|------------------|---------------------|
| Implementation cost | High (11 methods)| Low (1-2 methods)   |
| Coupling            | High             | Low                 |
| Testability         | Hard to mock     | Easy to mock        |
| Reusability         | Low              | High                |

---

## Optimization 7: Constructor Overload → Builder Pattern

### Before (Bad: Telescoping Constructor)

```java
public class HttpRequest {
    public HttpRequest(String url) { ... }
    public HttpRequest(String url, String method) { ... }
    public HttpRequest(String url, String method, Map<String, String> headers) { ... }
    public HttpRequest(String url, String method, Map<String, String> headers, String body) { ... }
    public HttpRequest(String url, String method, Map<String, String> headers, String body, int timeout) { ... }
    public HttpRequest(String url, String method, Map<String, String> headers, String body, int timeout, int retries) { ... }

    // Which constructor to use? What does `new HttpRequest(url, "POST", null, body, 30, 3)` mean?
    // null parameters are confusing and error-prone
}
```

### After (Good: Builder)

```java
public class HttpRequest {
    private final String url;
    private final String method;
    private final Map<String, String> headers;
    private final String body;
    private final int timeout;
    private final int retries;

    private HttpRequest(Builder builder) {
        this.url = builder.url;
        this.method = builder.method;
        this.headers = Map.copyOf(builder.headers);
        this.body = builder.body;
        this.timeout = builder.timeout;
        this.retries = builder.retries;
    }

    public static Builder builder(String url) {
        return new Builder(url);
    }

    public static class Builder {
        private final String url;
        private String method = "GET";
        private final Map<String, String> headers = new HashMap<>();
        private String body;
        private int timeout = 30;
        private int retries = 0;

        private Builder(String url) { this.url = url; }

        public Builder method(String method)         { this.method = method; return this; }
        public Builder header(String key, String val) { this.headers.put(key, val); return this; }
        public Builder body(String body)             { this.body = body; return this; }
        public Builder timeout(int seconds)          { this.timeout = seconds; return this; }
        public Builder retries(int retries)          { this.retries = retries; return this; }

        public HttpRequest build() {
            Objects.requireNonNull(url, "URL is required");
            return new HttpRequest(this);
        }
    }
}

// Crystal clear, self-documenting
HttpRequest req = HttpRequest.builder("https://api.example.com")
    .method("POST")
    .header("Content-Type", "application/json")
    .body("{\"name\": \"Alice\"}")
    .timeout(10)
    .retries(3)
    .build();
```

---

## Optimization 8: Inheritance for Code Reuse → Composition with Delegation

### Before (Bad: Inheriting to reuse a single method)

```python
class Logger:
    def log(self, message: str) -> None:
        print(f"[LOG] {message}")

    def format_error(self, error: Exception) -> str:
        return f"ERROR: {type(error).__name__}: {error}"

    def write_to_file(self, path: str, content: str) -> None:
        with open(path, "a") as f:
            f.write(content + "\n")


# BAD: UserService IS-A Logger? No! It just needs logging.
class UserService(Logger):
    def create_user(self, name: str) -> None:
        self.log(f"Creating user: {name}")  # Reuses Logger.log
        # But UserService also inherits write_to_file, format_error, etc.
        # UserService can be used anywhere a Logger is expected — WRONG!

# Type confusion:
def process_log(logger: Logger) -> None:
    logger.write_to_file("out.log", "test")

process_log(UserService())  # Works but makes no sense!
```

### After (Good: Composition)

```python
class Logger:
    def log(self, message: str) -> None:
        print(f"[LOG] {message}")


class UserService:
    def __init__(self, logger: Logger):
        self._logger = logger  # HAS-A Logger

    def create_user(self, name: str) -> None:
        self._logger.log(f"Creating user: {name}")
        # UserService is NOT a Logger
        # Clean separation of concerns

# Can't accidentally use UserService as a Logger
# process_log(UserService(Logger()))  # TypeError — correct!
```

---

## Optimization 9: Concrete Dependencies → Dependency Injection

### Before (Bad: Hard-coded dependencies)

```go
type OrderService struct{}

func (s *OrderService) PlaceOrder(order *Order) error {
    // Hard-coded dependencies
    db, err := sql.Open("postgres", "host=localhost dbname=orders")
    if err != nil {
        return err
    }
    defer db.Close()

    _, err = db.Exec("INSERT INTO orders ...")
    if err != nil {
        return err
    }

    // Hard-coded email sending
    auth := smtp.PlainAuth("", "user@gmail.com", "password", "smtp.gmail.com")
    err = smtp.SendMail("smtp.gmail.com:587", auth, "from@example.com",
        []string{order.Email}, []byte("Order confirmed"))

    return err
}

// Problems:
// - Can't test without real database and SMTP server
// - Can't change database or email provider without modifying this class
// - Credentials are hard-coded
```

### After (Good: Injected dependencies)

```go
type OrderRepository interface {
    Save(order *Order) error
}

type Notifier interface {
    Notify(to, subject, body string) error
}

type OrderService struct {
    repo     OrderRepository
    notifier Notifier
}

func NewOrderService(repo OrderRepository, notifier Notifier) *OrderService {
    return &OrderService{repo: repo, notifier: notifier}
}

func (s *OrderService) PlaceOrder(order *Order) error {
    if err := s.repo.Save(order); err != nil {
        return fmt.Errorf("save order: %w", err)
    }
    if err := s.notifier.Notify(order.Email, "Order Confirmed", "Your order is placed"); err != nil {
        return fmt.Errorf("notify: %w", err)
    }
    return nil
}

// In production
service := NewOrderService(
    &PostgresOrderRepo{db: prodDB},
    &SMTPNotifier{config: emailConfig},
)

// In tests — no database, no email server needed
service := NewOrderService(
    &MockOrderRepo{},
    &MockNotifier{},
)
```

---

## Optimization 10: String Type Checking → Enum/Constants

### Before (Bad: Magic strings)

```python
class Order:
    def __init__(self):
        self.status = "pending"

    def update_status(self, new_status: str) -> None:
        valid_transitions = {
            "pending": ["confirmed", "cancelled"],
            "confirmed": ["processing", "cancelled"],
            "processing": ["shipped"],
            "shipped": ["delivered"],
        }
        if new_status not in valid_transitions.get(self.status, []):
            raise ValueError(f"Can't go from {self.status} to {new_status}")
        self.status = new_status

order = Order()
order.update_status("confirmed")   # OK
order.update_status("confrimed")   # Typo → ValueError at runtime, hard to catch
```

### After (Good: Enum)

```python
from enum import Enum, auto

class OrderStatus(Enum):
    PENDING = auto()
    CONFIRMED = auto()
    PROCESSING = auto()
    SHIPPED = auto()
    DELIVERED = auto()
    CANCELLED = auto()

VALID_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.PROCESSING, OrderStatus.CANCELLED},
    OrderStatus.PROCESSING: {OrderStatus.SHIPPED},
    OrderStatus.SHIPPED: {OrderStatus.DELIVERED},
}

class Order:
    def __init__(self):
        self.status = OrderStatus.PENDING

    def update_status(self, new_status: OrderStatus) -> None:
        allowed = VALID_TRANSITIONS.get(self.status, set())
        if new_status not in allowed:
            raise ValueError(f"Can't go from {self.status.name} to {new_status.name}")
        self.status = new_status

order = Order()
order.update_status(OrderStatus.CONFIRMED)    # OK, type-safe
# order.update_status(OrderStatus.CONFRIMED)  # AttributeError — typo caught immediately!
```

**Go:**
```go
type OrderStatus int

const (
    StatusPending OrderStatus = iota
    StatusConfirmed
    StatusProcessing
    StatusShipped
    StatusDelivered
    StatusCancelled
)

var validTransitions = map[OrderStatus][]OrderStatus{
    StatusPending:    {StatusConfirmed, StatusCancelled},
    StatusConfirmed:  {StatusProcessing, StatusCancelled},
    StatusProcessing: {StatusShipped},
    StatusShipped:    {StatusDelivered},
}
```

---

## Optimization 11: Getter/Setter Bloat → Direct Access or Properties

### Before (Bad: Unnecessary getters/setters)

```java
// Java "enterprise" style — every field has a getter and setter
// even when there's no validation or logic
public class Point {
    private int x;
    private int y;

    public int getX() { return x; }
    public void setX(int x) { this.x = x; }
    public int getY() { return y; }
    public void setY(int y) { this.y = y; }
}
// 4 methods for 2 fields, zero added value
```

### After (Good: Use records or direct access)

```java
// Java 16+ Record — immutable, auto-generates equals, hashCode, toString
public record Point(int x, int y) {}

// Usage
Point p = new Point(3, 4);
System.out.println(p.x());  // 3
System.out.println(p);      // Point[x=3, y=4]
```

**Go: Just export the fields when no validation is needed:**
```go
// GOOD: Simple data? Export fields directly.
type Point struct {
    X int
    Y int
}

// Only add methods when there's actual logic:
type BankAccount struct {
    balance float64 // private because it needs validation
}

func (a *BankAccount) Deposit(amount float64) error {
    if amount <= 0 {
        return errors.New("amount must be positive")
    }
    a.balance += amount
    return nil
}
```

**Python: Use dataclasses:**
```python
from dataclasses import dataclass

@dataclass
class Point:
    x: int
    y: int

# Auto-generates __init__, __repr__, __eq__
p = Point(3, 4)
print(p)  # Point(x=3, y=4)
```

---

## Summary: Optimization Patterns

| # | Anti-Pattern                  | Better Approach               | Key Principle        |
|---|-------------------------------|-------------------------------|----------------------|
| 1 | Deep hierarchy                | Composition                   | Favor composition    |
| 2 | God class                     | Separate responsibilities     | SRP                  |
| 3 | Mutable shared state          | Immutable objects             | Thread safety        |
| 4 | Reflection                    | Interfaces                    | Type safety          |
| 5 | Type switch chains            | Polymorphism                  | Open/Closed          |
| 6 | Fat interface                 | Small interfaces              | ISP                  |
| 7 | Telescoping constructor       | Builder pattern               | Readability          |
| 8 | Inherit for code reuse        | Composition with delegation   | Correct modeling     |
| 9 | Hard-coded dependencies       | Dependency injection          | DIP, testability     |
| 10| Magic strings                 | Enums/constants               | Type safety          |
| 11| Unnecessary getters/setters   | Records/dataclasses/exports   | Simplicity           |

### General Rules

1. **Keep it simple** — don't add patterns until you need them
2. **Measure before optimizing** — make sure the "optimization" actually helps
3. **Readability > cleverness** — code is read 10x more than it's written
4. **Small interfaces > large interfaces** — especially in Go
5. **Composition > inheritance** — almost always
6. **Immutable > mutable** — when possible
7. **Interfaces > concrete types** — for flexibility and testability
