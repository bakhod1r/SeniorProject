# OOP Basics - Senior Level

## SOLID Principles

SOLID is five design principles that make software more maintainable, flexible, and understandable.

---

### S — Single Responsibility Principle (SRP)

> A class should have only one reason to change.

**Bad: One class does everything**

```java
// BAD: UserManager handles users, email, and persistence
public class UserManager {
    public void createUser(String name, String email) { /* ... */ }
    public void sendWelcomeEmail(String email) { /* ... */ }
    public void saveToDatabase(Object user) { /* ... */ }
    public String generateReport() { /* ... */ }
}
```

**Good: Each class has one responsibility**

```java
// GOOD: Separate responsibilities
public class UserService {
    private final UserRepository repository;
    private final EmailService emailService;

    public UserService(UserRepository repository, EmailService emailService) {
        this.repository = repository;
        this.emailService = emailService;
    }

    public User createUser(String name, String email) {
        User user = new User(name, email);
        repository.save(user);
        emailService.sendWelcome(user);
        return user;
    }
}

public class UserRepository {
    public void save(User user) { /* database logic */ }
    public User findById(long id) { /* ... */ }
}

public class EmailService {
    public void sendWelcome(User user) { /* email logic */ }
}

public class UserReportGenerator {
    public String generate(List<User> users) { /* report logic */ }
}
```

**Go:**
```go
// Each struct has one job
type UserService struct {
    repo  UserRepository
    email EmailService
}

type UserRepository interface {
    Save(user *User) error
    FindByID(id int64) (*User, error)
}

type EmailService interface {
    SendWelcome(user *User) error
}

func (s *UserService) CreateUser(name, email string) (*User, error) {
    user := &User{Name: name, Email: email}
    if err := s.repo.Save(user); err != nil {
        return nil, err
    }
    if err := s.email.SendWelcome(user); err != nil {
        return nil, err
    }
    return user, nil
}
```

**Python:**
```python
class UserService:
    def __init__(self, repo: "UserRepository", email: "EmailService"):
        self.repo = repo
        self.email = email

    def create_user(self, name: str, email: str) -> "User":
        user = User(name=name, email=email)
        self.repo.save(user)
        self.email.send_welcome(user)
        return user

class UserRepository:
    def save(self, user: "User") -> None: ...
    def find_by_id(self, user_id: int) -> "User": ...

class EmailService:
    def send_welcome(self, user: "User") -> None: ...
```

---

### O — Open/Closed Principle (OCP)

> Software entities should be open for extension but closed for modification.

Add new behavior without modifying existing code.

**Bad: Modifying existing code for each new type**

```python
# BAD: Must modify calculate_area every time a new shape is added
def calculate_area(shape_type: str, **kwargs) -> float:
    if shape_type == "circle":
        return 3.14159 * kwargs["radius"] ** 2
    elif shape_type == "rectangle":
        return kwargs["width"] * kwargs["height"]
    elif shape_type == "triangle":  # Had to modify!
        return 0.5 * kwargs["base"] * kwargs["height"]
    else:
        raise ValueError(f"Unknown shape: {shape_type}")
```

**Good: Extend through new classes**

```python
from abc import ABC, abstractmethod
import math

class Shape(ABC):
    @abstractmethod
    def area(self) -> float:
        pass

class Circle(Shape):
    def __init__(self, radius: float):
        self.radius = radius
    def area(self) -> float:
        return math.pi * self.radius ** 2

class Rectangle(Shape):
    def __init__(self, width: float, height: float):
        self.width = width
        self.height = height
    def area(self) -> float:
        return self.width * self.height

# Adding a new shape — NO modification to existing code
class Triangle(Shape):
    def __init__(self, base: float, height: float):
        self.base = base
        self.height = height
    def area(self) -> float:
        return 0.5 * self.base * self.height

# Works with any Shape without modification
def total_area(shapes: list[Shape]) -> float:
    return sum(s.area() for s in shapes)
```

**Go:**
```go
type Shape interface {
    Area() float64
}

type Circle struct{ Radius float64 }
func (c Circle) Area() float64 { return math.Pi * c.Radius * c.Radius }

type Rectangle struct{ Width, Height float64 }
func (r Rectangle) Area() float64 { return r.Width * r.Height }

// New shape — no existing code modified
type Triangle struct{ Base, Height float64 }
func (t Triangle) Area() float64 { return 0.5 * t.Base * t.Height }

func TotalArea(shapes []Shape) float64 {
    total := 0.0
    for _, s := range shapes {
        total += s.Area()
    }
    return total
}
```

---

### L — Liskov Substitution Principle (LSP)

> Subtypes must be substitutable for their base types without altering program correctness.

**Bad: Square violating Rectangle's contract**

```java
// BAD: Classic violation
class Rectangle {
    protected int width, height;

    public void setWidth(int w) { this.width = w; }
    public void setHeight(int h) { this.height = h; }
    public int area() { return width * height; }
}

class Square extends Rectangle {
    @Override
    public void setWidth(int w) {
        this.width = w;
        this.height = w; // Surprise! Changes height too
    }
    @Override
    public void setHeight(int h) {
        this.width = h;
        this.height = h;
    }
}

// This code breaks with Square
void resize(Rectangle r) {
    r.setWidth(5);
    r.setHeight(10);
    assert r.area() == 50; // FAILS for Square! area = 100
}
```

**Good: Separate types with a shared interface**

```java
// GOOD: Don't use inheritance when contracts differ
interface Shape {
    int area();
}

class Rectangle implements Shape {
    private final int width, height;
    public Rectangle(int width, int height) {
        this.width = width;
        this.height = height;
    }
    @Override public int area() { return width * height; }
}

class Square implements Shape {
    private final int side;
    public Square(int side) { this.side = side; }
    @Override public int area() { return side * side; }
}
```

---

### I — Interface Segregation Principle (ISP)

> No client should be forced to depend on methods it does not use.

**Bad: Fat interface**

```go
// BAD: Huge interface forces all implementors to implement everything
type Worker interface {
    Work()
    Eat()
    Sleep()
    Code()
    ManagePeople()
    DesignSystem()
}
```

**Good: Small, focused interfaces**

```go
// GOOD: Small, composable interfaces
type Worker interface {
    Work()
}

type Eater interface {
    Eat()
}

type Coder interface {
    Code()
}

type Manager interface {
    ManagePeople()
}

// Compose interfaces as needed
type Developer interface {
    Worker
    Coder
}

type TechLead interface {
    Worker
    Coder
    Manager
}

type Robot struct{}
func (r Robot) Work() { fmt.Println("Working...") }
func (r Robot) Code() { fmt.Println("Coding...") }
// Robot doesn't need to implement Eat or Sleep!
```

**Python:**
```python
from abc import ABC, abstractmethod

# BAD
class Worker(ABC):
    @abstractmethod
    def work(self): pass
    @abstractmethod
    def eat(self): pass   # Robot can't eat!
    @abstractmethod
    def sleep(self): pass  # Robot can't sleep!

# GOOD: Segregated interfaces
class Workable(ABC):
    @abstractmethod
    def work(self): pass

class Feedable(ABC):
    @abstractmethod
    def eat(self): pass

class Human(Workable, Feedable):
    def work(self): print("Working...")
    def eat(self): print("Eating...")

class Robot(Workable):
    def work(self): print("Working tirelessly...")
    # No need to implement eat!
```

---

### D — Dependency Inversion Principle (DIP)

> High-level modules should not depend on low-level modules. Both should depend on abstractions.

**Bad: Direct dependency on concrete classes**

```python
# BAD: High-level NotificationService depends on low-level SMTPMailer
class SMTPMailer:
    def send(self, to: str, subject: str, body: str) -> None:
        print(f"Sending email via SMTP to {to}")

class NotificationService:
    def __init__(self):
        self.mailer = SMTPMailer()  # HARD dependency!

    def notify(self, user_email: str, message: str) -> None:
        self.mailer.send(user_email, "Notification", message)
    # Can't test without SMTP server!
    # Can't switch to SendGrid without modifying this class!
```

**Good: Depend on abstractions**

```python
# GOOD: Depend on abstraction
from abc import ABC, abstractmethod

class MessageSender(ABC):
    @abstractmethod
    def send(self, to: str, subject: str, body: str) -> None:
        pass

class SMTPMailer(MessageSender):
    def send(self, to: str, subject: str, body: str) -> None:
        print(f"Sending email via SMTP to {to}")

class SendGridMailer(MessageSender):
    def send(self, to: str, subject: str, body: str) -> None:
        print(f"Sending email via SendGrid to {to}")

class SlackNotifier(MessageSender):
    def send(self, to: str, subject: str, body: str) -> None:
        print(f"Sending Slack message to {to}")

class NotificationService:
    def __init__(self, sender: MessageSender):  # Inject abstraction
        self.sender = sender

    def notify(self, user_email: str, message: str) -> None:
        self.sender.send(user_email, "Notification", message)

# Easy to swap implementations
service = NotificationService(SMTPMailer())
service = NotificationService(SendGridMailer())

# Easy to test with a mock
class MockSender(MessageSender):
    def __init__(self):
        self.sent = []
    def send(self, to, subject, body):
        self.sent.append((to, subject, body))

mock = MockSender()
service = NotificationService(mock)
service.notify("test@example.com", "Hello")
assert len(mock.sent) == 1
```

**Go (DIP is natural):**
```go
type MessageSender interface {
    Send(to, subject, body string) error
}

type NotificationService struct {
    sender MessageSender
}

func NewNotificationService(sender MessageSender) *NotificationService {
    return &NotificationService{sender: sender}
}

func (n *NotificationService) Notify(email, message string) error {
    return n.sender.Send(email, "Notification", message)
}

// Implementations
type SMTPMailer struct{}
func (s SMTPMailer) Send(to, subject, body string) error {
    fmt.Printf("SMTP → %s: %s\n", to, subject)
    return nil
}

type MockSender struct {
    Sent []string
}
func (m *MockSender) Send(to, subject, body string) error {
    m.Sent = append(m.Sent, to)
    return nil
}
```

---

## Design Patterns

### Strategy Pattern

Defines a family of algorithms, encapsulates each one, and makes them interchangeable at runtime.

**Go:**
```go
// Strategy interface
type SortStrategy interface {
    Sort(data []int) []int
}

type BubbleSort struct{}
func (b BubbleSort) Sort(data []int) []int {
    n := len(data)
    result := make([]int, n)
    copy(result, data)
    for i := 0; i < n-1; i++ {
        for j := 0; j < n-i-1; j++ {
            if result[j] > result[j+1] {
                result[j], result[j+1] = result[j+1], result[j]
            }
        }
    }
    return result
}

type QuickSort struct{}
func (q QuickSort) Sort(data []int) []int {
    result := make([]int, len(data))
    copy(result, data)
    sort.Ints(result)
    return result
}

// Context
type Sorter struct {
    strategy SortStrategy
}

func NewSorter(strategy SortStrategy) *Sorter {
    return &Sorter{strategy: strategy}
}

func (s *Sorter) SetStrategy(strategy SortStrategy) {
    s.strategy = strategy
}

func (s *Sorter) Sort(data []int) []int {
    return s.strategy.Sort(data)
}

func main() {
    data := []int{5, 2, 8, 1, 9, 3}

    sorter := NewSorter(BubbleSort{})
    fmt.Println(sorter.Sort(data)) // [1 2 3 5 8 9]

    sorter.SetStrategy(QuickSort{})
    fmt.Println(sorter.Sort(data)) // [1 2 3 5 8 9]
}
```

**Java:**
```java
public interface SortStrategy {
    int[] sort(int[] data);
}

public class BubbleSort implements SortStrategy {
    @Override
    public int[] sort(int[] data) {
        int[] result = data.clone();
        int n = result.length;
        for (int i = 0; i < n - 1; i++) {
            for (int j = 0; j < n - i - 1; j++) {
                if (result[j] > result[j + 1]) {
                    int temp = result[j];
                    result[j] = result[j + 1];
                    result[j + 1] = temp;
                }
            }
        }
        return result;
    }
}

public class QuickSort implements SortStrategy {
    @Override
    public int[] sort(int[] data) {
        int[] result = data.clone();
        Arrays.sort(result);
        return result;
    }
}

public class Sorter {
    private SortStrategy strategy;

    public Sorter(SortStrategy strategy) {
        this.strategy = strategy;
    }

    public void setStrategy(SortStrategy strategy) {
        this.strategy = strategy;
    }

    public int[] sort(int[] data) {
        return strategy.sort(data);
    }
}
```

**Python:**
```python
from abc import ABC, abstractmethod

class SortStrategy(ABC):
    @abstractmethod
    def sort(self, data: list[int]) -> list[int]:
        pass

class BubbleSort(SortStrategy):
    def sort(self, data: list[int]) -> list[int]:
        result = data.copy()
        n = len(result)
        for i in range(n - 1):
            for j in range(n - i - 1):
                if result[j] > result[j + 1]:
                    result[j], result[j + 1] = result[j + 1], result[j]
        return result

class QuickSort(SortStrategy):
    def sort(self, data: list[int]) -> list[int]:
        return sorted(data)

class Sorter:
    def __init__(self, strategy: SortStrategy):
        self._strategy = strategy

    def set_strategy(self, strategy: SortStrategy) -> None:
        self._strategy = strategy

    def sort(self, data: list[int]) -> list[int]:
        return self._strategy.sort(data)

# Python also supports strategy via functions (first-class functions)
def sort_with(data: list[int], key_func=None) -> list[int]:
    return sorted(data, key=key_func)
```

---

### Observer Pattern

Defines a one-to-many dependency. When one object changes state, all dependents are notified.

**Go:**
```go
type Event struct {
    Type string
    Data any
}

type Observer interface {
    OnEvent(event Event)
}

type EventBus struct {
    observers map[string][]Observer
}

func NewEventBus() *EventBus {
    return &EventBus{observers: make(map[string][]Observer)}
}

func (eb *EventBus) Subscribe(eventType string, observer Observer) {
    eb.observers[eventType] = append(eb.observers[eventType], observer)
}

func (eb *EventBus) Publish(event Event) {
    for _, observer := range eb.observers[event.Type] {
        observer.OnEvent(event)
    }
}

// Concrete observers
type LoggingObserver struct{}
func (l LoggingObserver) OnEvent(event Event) {
    fmt.Printf("[LOG] Event: %s, Data: %v\n", event.Type, event.Data)
}

type MetricsObserver struct {
    eventCount int
}
func (m *MetricsObserver) OnEvent(event Event) {
    m.eventCount++
    fmt.Printf("[METRICS] Total events: %d\n", m.eventCount)
}

type EmailObserver struct {
    email string
}
func (e EmailObserver) OnEvent(event Event) {
    fmt.Printf("[EMAIL] Notifying %s about %s\n", e.email, event.Type)
}

func main() {
    bus := NewEventBus()
    bus.Subscribe("user.created", LoggingObserver{})
    bus.Subscribe("user.created", &MetricsObserver{})
    bus.Subscribe("user.created", EmailObserver{email: "admin@example.com"})
    bus.Subscribe("order.placed", LoggingObserver{})

    bus.Publish(Event{Type: "user.created", Data: "alice"})
    bus.Publish(Event{Type: "order.placed", Data: "ORD-001"})
}
```

**Java:**
```java
public interface Observer {
    void onEvent(String eventType, Object data);
}

public class EventBus {
    private final Map<String, List<Observer>> observers = new HashMap<>();

    public void subscribe(String eventType, Observer observer) {
        observers.computeIfAbsent(eventType, k -> new ArrayList<>()).add(observer);
    }

    public void unsubscribe(String eventType, Observer observer) {
        List<Observer> list = observers.get(eventType);
        if (list != null) list.remove(observer);
    }

    public void publish(String eventType, Object data) {
        List<Observer> list = observers.getOrDefault(eventType, List.of());
        for (Observer observer : list) {
            observer.onEvent(eventType, data);
        }
    }
}

public class LoggingObserver implements Observer {
    @Override
    public void onEvent(String eventType, Object data) {
        System.out.printf("[LOG] %s: %s%n", eventType, data);
    }
}

public class EmailObserver implements Observer {
    private final String email;

    public EmailObserver(String email) { this.email = email; }

    @Override
    public void onEvent(String eventType, Object data) {
        System.out.printf("[EMAIL] Notifying %s about %s%n", email, eventType);
    }
}
```

**Python:**
```python
from typing import Any, Callable
from collections import defaultdict

class EventBus:
    def __init__(self):
        self._observers: dict[str, list[Callable]] = defaultdict(list)

    def subscribe(self, event_type: str, callback: Callable) -> None:
        self._observers[event_type].append(callback)

    def unsubscribe(self, event_type: str, callback: Callable) -> None:
        self._observers[event_type].remove(callback)

    def publish(self, event_type: str, data: Any = None) -> None:
        for callback in self._observers[event_type]:
            callback(event_type, data)


# Observers as functions (Pythonic approach)
def logging_observer(event_type: str, data: Any) -> None:
    print(f"[LOG] {event_type}: {data}")

def email_observer(email: str):
    def handler(event_type: str, data: Any) -> None:
        print(f"[EMAIL] Notifying {email} about {event_type}")
    return handler

# Usage
bus = EventBus()
bus.subscribe("user.created", logging_observer)
bus.subscribe("user.created", email_observer("admin@example.com"))
bus.publish("user.created", "alice")
```

---

### Factory Pattern

Creates objects without specifying their exact class. Centralizes creation logic.

**Go:**
```go
type Database interface {
    Connect() error
    Query(sql string) ([]map[string]any, error)
    Close() error
}

type PostgresDB struct{ connStr string }
func (p *PostgresDB) Connect() error  { fmt.Println("Connected to Postgres"); return nil }
func (p *PostgresDB) Query(sql string) ([]map[string]any, error) { return nil, nil }
func (p *PostgresDB) Close() error    { return nil }

type MySQLDB struct{ connStr string }
func (m *MySQLDB) Connect() error  { fmt.Println("Connected to MySQL"); return nil }
func (m *MySQLDB) Query(sql string) ([]map[string]any, error) { return nil, nil }
func (m *MySQLDB) Close() error    { return nil }

type SQLiteDB struct{ path string }
func (s *SQLiteDB) Connect() error  { fmt.Println("Connected to SQLite"); return nil }
func (s *SQLiteDB) Query(sql string) ([]map[string]any, error) { return nil, nil }
func (s *SQLiteDB) Close() error    { return nil }

// Factory function
func NewDatabase(dbType, connectionStr string) (Database, error) {
    switch dbType {
    case "postgres":
        return &PostgresDB{connStr: connectionStr}, nil
    case "mysql":
        return &MySQLDB{connStr: connectionStr}, nil
    case "sqlite":
        return &SQLiteDB{path: connectionStr}, nil
    default:
        return nil, fmt.Errorf("unsupported database type: %s", dbType)
    }
}

// Usage
db, err := NewDatabase("postgres", "host=localhost dbname=mydb")
if err != nil {
    log.Fatal(err)
}
db.Connect()
```

**Java:**
```java
public interface Database {
    void connect();
    List<Map<String, Object>> query(String sql);
    void close();
}

public class DatabaseFactory {
    public static Database create(String type, String connectionStr) {
        return switch (type.toLowerCase()) {
            case "postgres" -> new PostgresDB(connectionStr);
            case "mysql"    -> new MySQLDB(connectionStr);
            case "sqlite"   -> new SQLiteDB(connectionStr);
            default -> throw new IllegalArgumentException("Unsupported: " + type);
        };
    }
}

// Usage
Database db = DatabaseFactory.create("postgres", "host=localhost");
db.connect();
```

**Python:**
```python
from abc import ABC, abstractmethod

class Database(ABC):
    @abstractmethod
    def connect(self) -> None: pass
    @abstractmethod
    def query(self, sql: str) -> list[dict]: pass
    @abstractmethod
    def close(self) -> None: pass

class PostgresDB(Database):
    def __init__(self, conn_str: str):
        self.conn_str = conn_str
    def connect(self) -> None:
        print(f"Connected to Postgres: {self.conn_str}")
    def query(self, sql: str) -> list[dict]:
        return []
    def close(self) -> None:
        pass

class MySQLDB(Database):
    def __init__(self, conn_str: str):
        self.conn_str = conn_str
    def connect(self) -> None:
        print(f"Connected to MySQL: {self.conn_str}")
    def query(self, sql: str) -> list[dict]:
        return []
    def close(self) -> None:
        pass

# Factory
_REGISTRY: dict[str, type[Database]] = {
    "postgres": PostgresDB,
    "mysql": MySQLDB,
}

def create_database(db_type: str, conn_str: str) -> Database:
    cls = _REGISTRY.get(db_type)
    if cls is None:
        raise ValueError(f"Unsupported database type: {db_type}")
    return cls(conn_str)

# Usage
db = create_database("postgres", "host=localhost")
db.connect()
```

---

### Singleton Pattern

Ensures a class has only one instance. Use sparingly — singletons can make testing harder.

**Go:**
```go
import "sync"

type Config struct {
    DatabaseURL string
    APIKey      string
    Debug       bool
}

var (
    configInstance *Config
    configOnce     sync.Once
)

func GetConfig() *Config {
    configOnce.Do(func() {
        configInstance = &Config{
            DatabaseURL: "localhost:5432",
            APIKey:      "secret",
            Debug:       false,
        }
    })
    return configInstance
}

// Usage
cfg := GetConfig()
fmt.Println(cfg.DatabaseURL)
```

**Java:**
```java
public class Config {
    private static volatile Config instance;
    private String databaseURL;
    private String apiKey;

    private Config() {
        this.databaseURL = "localhost:5432";
        this.apiKey = "secret";
    }

    public static Config getInstance() {
        if (instance == null) {
            synchronized (Config.class) {
                if (instance == null) {
                    instance = new Config();
                }
            }
        }
        return instance;
    }

    // Better: use enum (thread-safe, serialization-safe)
    // public enum Config {
    //     INSTANCE;
    //     private String databaseURL = "localhost:5432";
    // }
}
```

**Python:**
```python
class Config:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.database_url = "localhost:5432"
            cls._instance.api_key = "secret"
            cls._instance.debug = False
        return cls._instance

# Usage
config1 = Config()
config2 = Config()
assert config1 is config2  # Same instance
```

---

## Dependency Injection

DI is a technique where an object receives its dependencies from the outside rather than creating them internally.

### Without DI (Hard to test)

```go
type OrderService struct {
    db *PostgresDB  // Hard-coded dependency!
}

func NewOrderService() *OrderService {
    return &OrderService{
        db: &PostgresDB{connStr: "production_db"}, // Created internally
    }
}
```

### With DI (Testable, flexible)

**Go:**
```go
type OrderRepository interface {
    Save(order *Order) error
    FindByID(id string) (*Order, error)
}

type PaymentProcessor interface {
    Charge(amount float64, currency string) error
}

type NotificationService interface {
    Notify(userID, message string) error
}

// All dependencies are injected through the constructor
type OrderService struct {
    repo     OrderRepository
    payment  PaymentProcessor
    notifier NotificationService
}

func NewOrderService(
    repo OrderRepository,
    payment PaymentProcessor,
    notifier NotificationService,
) *OrderService {
    return &OrderService{
        repo:     repo,
        payment:  payment,
        notifier: notifier,
    }
}

func (s *OrderService) PlaceOrder(order *Order) error {
    if err := s.payment.Charge(order.Total, "USD"); err != nil {
        return fmt.Errorf("payment failed: %w", err)
    }
    if err := s.repo.Save(order); err != nil {
        return fmt.Errorf("save failed: %w", err)
    }
    _ = s.notifier.Notify(order.UserID, "Order placed!")
    return nil
}

// In production
func main() {
    service := NewOrderService(
        &PostgresOrderRepo{db: prodDB},
        &StripeProcessor{key: "bm..."},
        &EmailNotifier{smtp: smtpClient},
    )
    // ...
}

// In tests
func TestPlaceOrder(t *testing.T) {
    mockRepo := &MockOrderRepo{}
    mockPayment := &MockPaymentProcessor{}
    mockNotifier := &MockNotifier{}

    service := NewOrderService(mockRepo, mockPayment, mockNotifier)
    err := service.PlaceOrder(&Order{Total: 99.99, UserID: "user1"})
    assert.NoError(t, err)
    assert.Equal(t, 1, len(mockRepo.Saved))
}
```

**Java:**
```java
public class OrderService {
    private final OrderRepository repo;
    private final PaymentProcessor payment;
    private final NotificationService notifier;

    // Constructor injection
    public OrderService(
            OrderRepository repo,
            PaymentProcessor payment,
            NotificationService notifier) {
        this.repo = repo;
        this.payment = payment;
        this.notifier = notifier;
    }

    public void placeOrder(Order order) throws Exception {
        payment.charge(order.getTotal(), "USD");
        repo.save(order);
        notifier.notify(order.getUserId(), "Order placed!");
    }
}

// Spring framework example (annotation-based DI)
// @Service
// public class OrderService {
//     @Autowired private OrderRepository repo;
//     @Autowired private PaymentProcessor payment;
// }
```

**Python:**
```python
class OrderService:
    def __init__(
        self,
        repo: "OrderRepository",
        payment: "PaymentProcessor",
        notifier: "NotificationService",
    ):
        self.repo = repo
        self.payment = payment
        self.notifier = notifier

    def place_order(self, order: "Order") -> None:
        self.payment.charge(order.total, "USD")
        self.repo.save(order)
        self.notifier.notify(order.user_id, "Order placed!")


# In tests
from unittest.mock import MagicMock

def test_place_order():
    mock_repo = MagicMock()
    mock_payment = MagicMock()
    mock_notifier = MagicMock()

    service = OrderService(mock_repo, mock_payment, mock_notifier)
    order = Order(total=99.99, user_id="user1")
    service.place_order(order)

    mock_payment.charge.assert_called_once_with(99.99, "USD")
    mock_repo.save.assert_called_once_with(order)
```

---

## OOP in System Design (Domain Modeling)

When designing a system, OOP helps model real-world domains:

```go
// Domain: E-commerce order system

type Money struct {
    Amount   int64  // in cents
    Currency string
}

func (m Money) Add(other Money) Money {
    if m.Currency != other.Currency {
        panic("currency mismatch")
    }
    return Money{Amount: m.Amount + other.Amount, Currency: m.Currency}
}

type OrderStatus int
const (
    OrderPending OrderStatus = iota
    OrderConfirmed
    OrderShipped
    OrderDelivered
    OrderCancelled
)

type OrderItem struct {
    ProductID string
    Name      string
    Price     Money
    Quantity  int
}

func (oi OrderItem) Total() Money {
    return Money{Amount: oi.Price.Amount * int64(oi.Quantity), Currency: oi.Price.Currency}
}

type Order struct {
    ID        string
    UserID    string
    Items     []OrderItem
    Status    OrderStatus
    CreatedAt time.Time
}

func (o *Order) AddItem(item OrderItem) {
    o.Items = append(o.Items, item)
}

func (o *Order) Total() Money {
    total := Money{Amount: 0, Currency: "USD"}
    for _, item := range o.Items {
        total = total.Add(item.Total())
    }
    return total
}

func (o *Order) Cancel() error {
    if o.Status == OrderShipped || o.Status == OrderDelivered {
        return fmt.Errorf("cannot cancel order in status %d", o.Status)
    }
    o.Status = OrderCancelled
    return nil
}
```

---

## When OOP Hurts

### Over-Engineering

```java
// BAD: Abstract factory for a factory that creates builders for strategies...
public abstract class AbstractNotificationStrategyBuilderFactory {
    public abstract NotificationStrategyBuilder createBuilder();
}

// GOOD: Just a function
public static void sendEmail(String to, String message) {
    // Just do it
}
```

### Deep Hierarchies

```
// BAD: 7 levels deep
Object
  └── BaseEntity
        └── AuditableEntity
              └── SoftDeletableEntity
                    └── BaseUser
                          └── AuthenticatedUser
                                └── AdminUser
                                      └── SuperAdminUser
```

**Rule**: Keep inheritance to 1-2 levels maximum.

### Go's Approach: Simplicity

Go avoids these problems by design:
- **No inheritance** — can't create deep hierarchies
- **Small interfaces** — `io.Reader` has 1 method, `io.Writer` has 1 method
- **Composition** — embed what you need
- **Package-level functions** — not everything needs to be a method

```go
// Go standard library: io.Reader is 1 method
type Reader interface {
    Read(p []byte) (n int, err error)
}

// io.Writer is 1 method
type Writer interface {
    Write(p []byte) (n int, err error)
}

// Compose them
type ReadWriter interface {
    Reader
    Writer
}

// This simplicity enables enormous flexibility
// Files, network connections, buffers, compressors, encryptors
// all implement Reader and/or Writer
```

---

## Key Takeaways

1. **SOLID principles** guide maintainable OOP design — learn them deeply
2. **Design patterns** (Strategy, Observer, Factory, Singleton) are tools, not rules
3. **Dependency injection** makes code testable and flexible
4. **Domain modeling** with OOP helps map business concepts to code
5. **Over-engineering is real** — use the simplest solution that works
6. **Go's philosophy** (small interfaces, composition, no inheritance) prevents many OOP pitfalls
7. **Singletons** should be used sparingly — they are global state in disguise
