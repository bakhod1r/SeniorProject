# Structs — Practice Tasks

## Task 1: Build a Point2D (Beginner)

**Objective:** Define and use a 2D point struct with methods.

**Requirements:**
- Define `type Point2D struct{ X, Y float64 }`
- Method `Distance(other Point2D) float64` — Euclidean distance
- Method `Translate(dx, dy float64) Point2D` — returns new shifted point (value receiver)
- Method `Scale(factor float64)` — modifies the point in-place (pointer receiver)
- Method `String() string` — returns `"(X, Y)"`

**Starter Code:**
```go
package main

import (
    "fmt"
    "math"
)

type Point2D struct {
    // TODO: add X and Y fields
}

// TODO: Implement Distance(other Point2D) float64
// TODO: Implement Translate(dx, dy float64) Point2D
// TODO: Implement Scale(factor float64) — pointer receiver
// TODO: Implement String() string

func main() {
    p1 := Point2D{X: 0, Y: 0}
    p2 := Point2D{X: 3, Y: 4}

    fmt.Println(p1.Distance(p2)) // 5
    fmt.Println(p1.Translate(1, 1)) // (1, 1) — p1 unchanged
    fmt.Println(p1) // (0, 0)

    p2.Scale(2)
    fmt.Println(p2) // (6, 8) — p2 modified
}
```

---

## Task 2: Stack Data Structure (Beginner)

**Objective:** Implement a generic-style stack using struct.

**Requirements:**
- `type Stack struct { items []interface{} }`
- `Push(item interface{})` — add to top
- `Pop() (interface{}, bool)` — remove and return top, ok=false if empty
- `Peek() (interface{}, bool)` — view top without removing
- `Len() int`
- `IsEmpty() bool`

**Starter Code:**
```go
package main

import "fmt"

type Stack struct {
    // TODO: items slice
}

// TODO: Push, Pop, Peek, Len, IsEmpty

func main() {
    s := &Stack{}

    s.Push(1)
    s.Push("hello")
    s.Push(3.14)

    fmt.Println(s.Len()) // 3

    if top, ok := s.Peek(); ok {
        fmt.Println("Top:", top) // 3.14
    }

    for !s.IsEmpty() {
        item, _ := s.Pop()
        fmt.Println("Popped:", item)
    }
    // 3.14, hello, 1

    _, ok := s.Pop()
    fmt.Println("Empty pop ok:", ok) // false
}
```

---

## Task 3: Student Gradebook (Beginner-Intermediate)

**Objective:** Build a gradebook using structs and methods.

**Requirements:**
- `type Student struct { Name string; Grades []float64 }`
- `type Gradebook struct { Students []*Student }`
- `Student.AddGrade(grade float64)`
- `Student.Average() float64`
- `Student.Grade() string` — "A", "B", "C", "D", "F" based on average
- `Gradebook.AddStudent(name string) *Student`
- `Gradebook.TopStudents(n int) []*Student` — top n by average
- `Gradebook.ClassAverage() float64`

**Starter Code:**
```go
package main

import (
    "fmt"
    "sort"
)

type Student struct {
    Name   string
    Grades []float64
}

type Gradebook struct {
    Students []*Student
}

// TODO: implement all methods

func main() {
    gb := &Gradebook{}
    alice := gb.AddStudent("Alice")
    bob := gb.AddStudent("Bob")
    carol := gb.AddStudent("Carol")

    alice.AddGrade(95); alice.AddGrade(88); alice.AddGrade(92)
    bob.AddGrade(72);   bob.AddGrade(65);   bob.AddGrade(78)
    carol.AddGrade(85); carol.AddGrade(90); carol.AddGrade(88)

    fmt.Printf("Alice: %.1f (%s)\n", alice.Average(), alice.Grade()) // 91.7 (A)
    fmt.Printf("Bob: %.1f (%s)\n", bob.Average(), bob.Grade())       // 71.7 (C)
    fmt.Printf("Class avg: %.1f\n", gb.ClassAverage())

    top := gb.TopStudents(2)
    fmt.Println("Top 2:", top[0].Name, top[1].Name) // Alice Carol
}
```

---

## Task 4: Linked List with Embedding (Intermediate)

**Objective:** Implement a doubly-linked list using structs with methods.

**Requirements:**
- `type Node struct { Value int; Prev, Next *Node }`
- `type LinkedList struct { head, tail *Node; size int }`
- `PushFront(val int)` — add to front
- `PushBack(val int)` — add to back
- `PopFront() (int, bool)` — remove from front
- `PopBack() (int, bool)` — remove from back
- `ToSlice() []int` — return all values front to back
- `Len() int`

**Starter Code:**
```go
package main

import "fmt"

type Node struct {
    Value      int
    Prev, Next *Node
}

type LinkedList struct {
    head, tail *Node
    size       int
}

// TODO: implement all methods

func main() {
    ll := &LinkedList{}

    ll.PushBack(1)
    ll.PushBack(2)
    ll.PushBack(3)
    ll.PushFront(0)

    fmt.Println(ll.ToSlice()) // [0 1 2 3]
    fmt.Println(ll.Len())     // 4

    v, ok := ll.PopFront()
    fmt.Println(v, ok)        // 0 true
    v, ok = ll.PopBack()
    fmt.Println(v, ok)        // 3 true

    fmt.Println(ll.ToSlice()) // [1 2]
}
```

---

## Task 5: HTTP Request Logger using Embedding (Intermediate)

**Objective:** Use struct embedding to add logging to an HTTP response writer.

**Requirements:**
- `type LoggingResponseWriter struct { http.ResponseWriter; statusCode int; bytesWritten int }`
- Override `WriteHeader(code int)` to capture status code
- Override `Write(b []byte) (int, error)` to count bytes
- Implement `Stats() string` — returns "status=200 bytes=1234"
- Write a middleware function `LoggingMiddleware(next http.Handler) http.Handler`

**Starter Code:**
```go
package main

import (
    "fmt"
    "net/http"
    "net/http/httptest"
)

type LoggingResponseWriter struct {
    http.ResponseWriter
    // TODO: statusCode int, bytesWritten int
}

// TODO: WriteHeader, Write, Stats

func LoggingMiddleware(next http.Handler) http.Handler {
    // TODO
    return nil
}

func main() {
    handler := LoggingMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(http.StatusOK)
        fmt.Fprintln(w, "Hello, World!")
    }))

    req := httptest.NewRequest("GET", "/", nil)
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, req)
    fmt.Println(rec.Code)
    fmt.Println(rec.Body.String())
}
```

---

## Task 6: Functional Options Pattern (Intermediate)

**Objective:** Build a database connection config using functional options.

**Requirements:**
- `type DBConfig struct` with fields: host, port, dbname, maxConns, timeout, sslMode
- All fields should be unexported
- Getters for each field
- `type DBOption func(*DBConfig)`
- Options: `WithHost`, `WithPort`, `WithDBName`, `WithMaxConns`, `WithTimeout`, `WithSSL`
- `NewDBConfig(opts ...DBOption) (*DBConfig, error)` — validates required fields (host, dbname)

**Starter Code:**
```go
package main

import (
    "fmt"
    "time"
)

type DBConfig struct {
    // TODO: unexported fields
}

type DBOption func(*DBConfig)

// TODO: implement option functions
// TODO: implement NewDBConfig
// TODO: implement getters

func main() {
    cfg, err := NewDBConfig(
        WithHost("db.example.com"),
        WithPort(5432),
        WithDBName("myapp"),
        WithMaxConns(10),
        WithTimeout(5*time.Second),
        WithSSL(true),
    )
    if err != nil {
        fmt.Println("Error:", err)
        return
    }

    fmt.Printf("Connecting to %s:%d/%s (ssl=%v, maxConns=%d)\n",
        cfg.Host(), cfg.Port(), cfg.DBName(), cfg.SSL(), cfg.MaxConns())

    // Test missing required field
    _, err = NewDBConfig(WithHost("localhost")) // missing dbname
    if err != nil {
        fmt.Println("Expected error:", err) // should print
    }
}
```

---

## Task 7: Observable Struct (Intermediate-Advanced)

**Objective:** Build a struct that notifies subscribers when fields change.

**Requirements:**
- `type Observable struct` — wraps any struct, stores change listeners
- `type ChangeEvent struct { Field string; OldValue, NewValue interface{} }`
- `Subscribe(field string, fn func(ChangeEvent))` — register listener for a field
- `Set(field string, value interface{}) error` — set field value and notify listeners
- `Get(field string) (interface{}, bool)` — get field value
- Use `reflect` to get/set fields dynamically

**Starter Code:**
```go
package main

import (
    "fmt"
    "reflect"
)

type ChangeEvent struct {
    Field    string
    OldValue interface{}
    NewValue interface{}
}

type Observable struct {
    data      interface{}
    listeners map[string][]func(ChangeEvent)
}

// TODO: implement New(data interface{}) *Observable
// TODO: implement Subscribe(field string, fn func(ChangeEvent))
// TODO: implement Set(field string, value interface{}) error
// TODO: implement Get(field string) (interface{}, bool)

type User struct {
    Name  string
    Email string
    Age   int
}

func main() {
    obs := New(&User{Name: "Alice", Email: "alice@example.com", Age: 30})

    obs.Subscribe("Name", func(e ChangeEvent) {
        fmt.Printf("Name changed: %v → %v\n", e.OldValue, e.NewValue)
    })

    obs.Subscribe("Age", func(e ChangeEvent) {
        fmt.Printf("Age changed: %v → %v\n", e.OldValue, e.NewValue)
    })

    obs.Set("Name", "Bob")      // Name changed: Alice → Bob
    obs.Set("Age", 31)          // Age changed: 30 → 31
    obs.Set("Email", "b@x.com") // no subscriber, no output

    name, _ := obs.Get("Name")
    fmt.Println("Current name:", name) // Bob
}
```

---

## Task 8: Type-Safe Event System (Advanced)

**Objective:** Build an event system using struct embedding and interface type assertions.

**Requirements:**
- `type BaseEvent struct { ID string; Timestamp time.Time; Type string }`
- Define 3+ event types embedding `BaseEvent`
- `type EventBus struct` with typed handlers stored by event type
- `Register[T Event](bus *EventBus, handler func(T))` — generic handler registration
- `Publish(bus *EventBus, event Event)` — dispatch to handlers
- All type assertions must use comma-ok

**Starter Code:**
```go
package main

import (
    "fmt"
    "time"
)

type Event interface {
    GetID() string
    GetType() string
}

type BaseEvent struct {
    ID        string
    Timestamp time.Time
    Type      string
}

func (e BaseEvent) GetID() string   { return e.ID }
func (e BaseEvent) GetType() string { return e.Type }

type UserSignedUp struct {
    BaseEvent
    Username string
    Email    string
}

type OrderPlaced struct {
    BaseEvent
    OrderID int64
    Amount  float64
}

type PaymentFailed struct {
    BaseEvent
    OrderID int64
    Reason  string
}

type EventBus struct {
    handlers map[string][]func(Event)
}

// TODO: Register function (can use generics or interface approach)
// TODO: Publish function
// TODO: NewEventBus constructor

func main() {
    bus := NewEventBus()

    // Register handlers
    bus.Register("user.signup", func(e Event) {
        if evt, ok := e.(UserSignedUp); ok {
            fmt.Printf("New user: %s <%s>\n", evt.Username, evt.Email)
        }
    })

    bus.Register("order.placed", func(e Event) {
        if evt, ok := e.(OrderPlaced); ok {
            fmt.Printf("Order #%d: $%.2f\n", evt.OrderID, evt.Amount)
        }
    })

    bus.Publish(UserSignedUp{
        BaseEvent: BaseEvent{ID: "ev1", Timestamp: time.Now(), Type: "user.signup"},
        Username: "alice",
        Email:    "alice@example.com",
    })

    bus.Publish(OrderPlaced{
        BaseEvent: BaseEvent{ID: "ev2", Timestamp: time.Now(), Type: "order.placed"},
        OrderID:  42,
        Amount:   99.99,
    })
}
```

---

## Task 9: Immutable Config with Builder (Advanced)

**Objective:** Build a fully immutable config struct using the builder pattern.

**Requirements:**
- `Config` struct with all unexported fields
- No setters — config is immutable after build
- `ConfigBuilder` struct with same fields, all exported
- `ConfigBuilder.Build() (*Config, error)` — validates and creates immutable Config
- Config must have: `Host`, `Port`, `MaxRetries`, `Timeout`, `AllowedOrigins []string`
- Validation: Port 1-65535, MaxRetries 0-10, Host non-empty
- Once built, Config exposes only getters

**Starter Code:**
```go
package main

import (
    "fmt"
    "time"
)

type Config struct {
    // TODO: unexported fields
}

// TODO: Getters for Config

type ConfigBuilder struct {
    Host           string
    Port           int
    MaxRetries     int
    Timeout        time.Duration
    AllowedOrigins []string
}

// TODO: Build() (*Config, error) with validation

func main() {
    cfg, err := ConfigBuilder{
        Host:           "api.example.com",
        Port:           443,
        MaxRetries:     3,
        Timeout:        30 * time.Second,
        AllowedOrigins: []string{"https://example.com"},
    }.Build()

    if err != nil {
        fmt.Println("Error:", err)
        return
    }

    fmt.Printf("Config: %s:%d (retries=%d, timeout=%v)\n",
        cfg.Host(), cfg.Port(), cfg.MaxRetries(), cfg.Timeout())

    // Immutability test — this should not compile or have no effect:
    // cfg.host = "hack" // COMPILE ERROR — unexported

    // Test validation error
    _, err = ConfigBuilder{Port: 99999}.Build()
    fmt.Println("Expected error:", err)
}
```

---

## Task 10: Aggregate Root Pattern (Expert)

**Objective:** Implement an `Order` aggregate root following DDD principles using Go structs.

**Requirements:**
- `type OrderID string`, `type ProductID string`, `type UserID int64`
- `type Money struct { Amount int64; Currency string }` — value object with validation
- `type OrderLine struct { ProductID; Qty int; UnitPrice Money }` — value object
- `type Order struct` — entity with ID, unexported fields, event log
- Methods: `PlaceOrder`, `AddLine`, `RemoveLine`, `Confirm`, `Cancel`
- Each mutation appends a domain event to an internal log
- `Events() []DomainEvent` — returns pending events
- `ClearEvents()` — clears after dispatch

**Starter Code:**
```go
package main

import (
    "errors"
    "fmt"
    "time"
)

type OrderID    string
type ProductID  string
type UserID     int64

type Money struct {
    Amount   int64  // cents
    Currency string
}

func (m Money) Add(other Money) (Money, error) {
    if m.Currency != other.Currency {
        return Money{}, fmt.Errorf("currency mismatch: %s vs %s", m.Currency, other.Currency)
    }
    return Money{Amount: m.Amount + other.Amount, Currency: m.Currency}, nil
}

type DomainEvent interface {
    EventType() string
    OccurredAt() time.Time
}

type OrderPlaced struct {
    ID        OrderID
    UserID    UserID
    At        time.Time
}
func (e OrderPlaced) EventType() string     { return "order.placed" }
func (e OrderPlaced) OccurredAt() time.Time { return e.At }

// TODO: Define OrderLineAdded, OrderConfirmed, OrderCancelled events

type OrderLine struct {
    ProductID ProductID
    Qty       int
    UnitPrice Money
}

func (l OrderLine) Total() Money {
    return Money{Amount: int64(l.Qty) * l.UnitPrice.Amount, Currency: l.UnitPrice.Currency}
}

type OrderStatus int
const (
    OrderDraft OrderStatus = iota
    OrderConfirmed
    OrderCancelled
)

type Order struct {
    // TODO: id OrderID, userID UserID, lines []OrderLine, status OrderStatus, events []DomainEvent
}

// TODO: NewOrder(id OrderID, userID UserID) (*Order, error)
// TODO: AddLine(productID ProductID, qty int, price Money) error
// TODO: RemoveLine(productID ProductID) error
// TODO: Confirm() error
// TODO: Cancel(reason string) error
// TODO: Total() Money
// TODO: Events() []DomainEvent
// TODO: ClearEvents()

func main() {
    order, err := NewOrder("ord-1", UserID(42))
    if err != nil {
        fmt.Println("Error:", err)
        return
    }

    order.AddLine("prod-1", 2, Money{Amount: 1000, Currency: "USD"})
    order.AddLine("prod-2", 1, Money{Amount: 500, Currency: "USD"})

    total := order.Total()
    fmt.Printf("Total: $%.2f\n", float64(total.Amount)/100) // $25.00

    order.Confirm()

    events := order.Events()
    for _, e := range events {
        fmt.Printf("Event: %s at %v\n", e.EventType(), e.OccurredAt().Format(time.RFC3339))
    }
    order.ClearEvents()

    // Test invalid state transition
    err = order.Cancel("changed mind")
    if errors.Is(err, ErrInvalidTransition) {
        fmt.Println("Cannot cancel confirmed order") // should print
    }
}
```
