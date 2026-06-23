# Embedding Structs — Practice Tasks

## Task 1: Basic Field and Method Promotion (Beginner)

**Goal:** Understand how embedding promotes fields and methods.

**Requirements:**
- Create a `Vehicle` struct with `Make`, `Model`, `Year` fields and a `Describe() string` method
- Create a `Car` struct that embeds `Vehicle` and adds `Doors int`
- Create a `Truck` struct that embeds `Vehicle` and adds `PayloadTons float64`
- Create instances of both and verify promoted access

**Starter Code:**
```go
package main

import "fmt"

type Vehicle struct {
    // TODO: fields
}

// TODO: Describe method on Vehicle

type Car struct {
    // TODO: embed Vehicle and add Doors
}

type Truck struct {
    // TODO: embed Vehicle and add PayloadTons
}

func main() {
    car := Car{/* TODO */}
    truck := Truck{/* TODO */}

    // Should work (promoted from Vehicle):
    fmt.Println(car.Make)         // "Toyota"
    fmt.Println(car.Describe())   // "2024 Toyota Camry"

    fmt.Println(truck.Year)       // 2023
    fmt.Println(truck.Describe()) // "2023 Ford F-150"

    // Own fields:
    fmt.Println(car.Doors)        // 4
    fmt.Println(truck.PayloadTons) // 1.5
}
```

**Expected Output:**
```
Toyota
2024 Toyota Camry
2023
2023 Ford F-150
4
1.5
```

**Evaluation Checklist:**
- [ ] `Vehicle` has Make, Model, Year fields
- [ ] `Describe()` method on Vehicle returns formatted string
- [ ] `Car` and `Truck` embed Vehicle (not named field)
- [ ] Promoted access works without explicit `.Vehicle.` prefix
- [ ] Both own fields accessible

---

## Task 2: Timestamps Mixin (Beginner-Intermediate)

**Goal:** Implement a reusable Timestamps mixin using embedding.

**Requirements:**
- `Timestamps` struct: `CreatedAt`, `UpdatedAt` (time.Time), `DeletedAt *time.Time`
- `SetCreated()` method: sets both CreatedAt and UpdatedAt to now
- `Touch()` method: sets UpdatedAt to now
- `SoftDelete()` method: sets DeletedAt to now
- `IsDeleted() bool` method: returns true if DeletedAt is non-nil
- Embed in `User` and `Order` structs
- Demonstrate usage

**Starter Code:**
```go
package main

import (
    "fmt"
    "time"
)

type Timestamps struct {
    // TODO
}

// TODO: methods on Timestamps

type User struct {
    Timestamps
    ID    int
    Name  string
    Email string
}

type Order struct {
    Timestamps
    ID    int
    Total float64
}

func main() {
    u := User{ID: 1, Name: "Alice", Email: "alice@example.com"}
    u.SetCreated()

    fmt.Println("User created:", !u.CreatedAt.IsZero())  // true
    fmt.Println("User deleted:", u.IsDeleted())           // false

    u.SoftDelete()
    fmt.Println("User deleted:", u.IsDeleted())           // true

    o := Order{ID: 100, Total: 49.99}
    o.SetCreated()
    time.Sleep(time.Millisecond)
    o.Touch()
    fmt.Println("Order updated after created:", o.UpdatedAt.After(o.CreatedAt))
}
```

**Evaluation Checklist:**
- [ ] All four Timestamp methods implemented correctly
- [ ] Embedding in both User and Order works
- [ ] Methods accessible via promotion (no `.Timestamps.` prefix needed)
- [ ] DeletedAt is pointer so it can be nil

---

## Task 3: Interface Satisfaction via Embedding (Intermediate)

**Goal:** Use embedding to satisfy an interface with minimal code.

**Requirements:**
- Define `Logger` interface with `Info(msg string)` and `Error(msg string)` methods
- Create `ConsoleLogger` and `FileLogger` concrete implementations
- Create `Service` struct that embeds `Logger` (the interface)
- `Service.Process()` method uses the logger
- Test with both `ConsoleLogger` and `FileLogger`

**Starter Code:**
```go
package main

import (
    "fmt"
    "os"
)

type Logger interface {
    Info(msg string)
    Error(msg string)
}

type ConsoleLogger struct{}
// TODO: implement Info and Error

type FileLogger struct {
    file *os.File
}
// TODO: implement Info and Error (write to file)

type Service struct {
    Logger // embedded interface
    Name string
}

func (s *Service) Process(data string) error {
    // TODO: log info "processing data", process, log result
    return nil
}

func main() {
    // Test with ConsoleLogger
    svc1 := &Service{Logger: ConsoleLogger{}, Name: "ServiceA"}
    svc1.Process("hello")

    // Test with a nil-safe stub logger
    type NoopLogger struct{ Logger }
    type noopImpl struct{}
    noopImpl{}.Info = func(string) {} // won't compile like this, use real impl
    // Just test ConsoleLogger for now
}
```

**Evaluation Checklist:**
- [ ] `ConsoleLogger` implements `Logger`
- [ ] `Service` embeds `Logger` interface
- [ ] `Service.Process` calls `s.Info` and `s.Error` (promoted)
- [ ] Swapping loggers changes behavior without changing Service

---

## Task 4: Shadowing Methods (Intermediate)

**Goal:** Understand and implement method shadowing.

**Requirements:**
- Create `BaseValidator` with `Validate() []string` that returns basic validation errors
- Create `StrictValidator` that embeds `BaseValidator` and overrides `Validate()` to add stricter checks
- Both validators share a `Format() string` method from `BaseValidator`
- Test that calling `Validate()` on `StrictValidator` uses the overridden version
- Show that explicit access `v.BaseValidator.Validate()` still works

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

type Request struct {
    Name  string
    Email string
    Age   int
}

type BaseValidator struct {
    req Request
}

func (v BaseValidator) Validate() []string {
    var errors []string
    if v.req.Name == "" {
        errors = append(errors, "name required")
    }
    if v.req.Email == "" {
        errors = append(errors, "email required")
    }
    return errors
}

func (v BaseValidator) Format() string {
    errors := v.Validate()
    if len(errors) == 0 {
        return "valid"
    }
    return "invalid: " + strings.Join(errors, ", ")
}

type StrictValidator struct {
    BaseValidator // embedded
}

func (v StrictValidator) Validate() []string {
    // TODO: call BaseValidator.Validate() and add stricter checks
    // Add: age must be >= 18, email must contain @
    return nil
}

func main() {
    r := Request{Name: "Alice", Email: "alice", Age: 15}

    base := BaseValidator{req: r}
    strict := StrictValidator{BaseValidator: base}

    fmt.Println("Base validate:", base.Validate())
    // Expected: []

    fmt.Println("Strict validate:", strict.Validate())
    // Expected: [age must be >= 18, email must contain @]

    fmt.Println("Strict Format:", strict.Format())
    // Expected: invalid: age must be >= 18, email must contain @

    fmt.Println("Explicit base:", strict.BaseValidator.Validate())
    // Expected: []
}
```

**Evaluation Checklist:**
- [ ] `StrictValidator.Validate()` calls `BaseValidator.Validate()` first
- [ ] Additional strict checks appended
- [ ] `Format()` on `StrictValidator` uses the overridden `Validate()` (shadowing)
- [ ] Explicit `strict.BaseValidator.Validate()` still accessible

---

## Task 5: Multiple Embedding with Name Conflict (Intermediate)

**Goal:** Handle name conflicts from multiple embedding.

**Requirements:**
- `Flyer` struct with `MaxAltitude int` and `Move() string`
- `Swimmer` struct with `MaxDepth int` and `Move() string`
- `Duck` struct embedding both
- Resolve the `Move()` conflict by implementing `Duck.Move()`
- Write `Duck.Capabilities() string` that uses both promoted methods

**Starter Code:**
```go
package main

import "fmt"

type Flyer struct {
    MaxAltitude int
}
func (f Flyer) Move() string { return fmt.Sprintf("flying up to %dm", f.MaxAltitude) }

type Swimmer struct {
    MaxDepth int
}
func (s Swimmer) Move() string { return fmt.Sprintf("swimming to %dm depth", s.MaxDepth) }

type Duck struct {
    Flyer
    Swimmer
    Name string
}

// TODO: implement Move() on Duck that combines both
func (d Duck) Move() string { return "" }

// TODO: implement Capabilities() that shows what Duck can do
func (d Duck) Capabilities() string { return "" }

func main() {
    d := Duck{
        Flyer:   Flyer{MaxAltitude: 50},
        Swimmer: Swimmer{MaxDepth: 3},
        Name:    "Donald",
    }

    fmt.Println(d.Move())
    // Expected: can fly (up to 50m) and swim (to 3m depth)

    fmt.Println(d.Capabilities())
    // Expected: Donald: flying up to 50m, swimming to 3m depth

    // Direct access to resolved methods:
    fmt.Println(d.Flyer.Move())   // flying up to 50m
    fmt.Println(d.Swimmer.Move()) // swimming to 3m depth
}
```

**Evaluation Checklist:**
- [ ] `Duck.Move()` resolves the ambiguity
- [ ] Explicit `d.Flyer.Move()` and `d.Swimmer.Move()` work
- [ ] `Duck.MaxAltitude` and `Duck.MaxDepth` accessible via promotion (no conflict)
- [ ] `Capabilities()` uses explicit access to call both

---

## Task 6: HTTP Response Writer Wrapper (Intermediate-Advanced)

**Goal:** Use embedding to add functionality to `http.ResponseWriter`.

**Requirements:**
- `ResponseCapture` embeds `http.ResponseWriter`
- Tracks: `StatusCode int`, `BodyBytes []byte`, `Headers http.Header`
- Override `WriteHeader` to capture status code
- Override `Write` to capture body bytes
- Write a middleware that uses `ResponseCapture` to log after response

**Starter Code:**
```go
package main

import (
    "bytes"
    "fmt"
    "net/http"
    "net/http/httptest"
)

type ResponseCapture struct {
    http.ResponseWriter
    StatusCode int
    Body       bytes.Buffer
}

// TODO: implement WriteHeader to capture status
// TODO: implement Write to capture body

func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // TODO: wrap w with ResponseCapture
        // TODO: call next.ServeHTTP with the capture
        // TODO: log method, path, status, body length after
    })
}

func main() {
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(201)
        w.Write([]byte(`{"id":42}`))
    })

    wrapped := LoggingMiddleware(handler)

    req := httptest.NewRequest("POST", "/users", nil)
    rec := httptest.NewRecorder()
    wrapped.ServeHTTP(rec, req)

    fmt.Println("Status:", rec.Code)        // 201
    fmt.Println("Body:", rec.Body.String()) // {"id":42}
}
```

**Evaluation Checklist:**
- [ ] `WriteHeader` captured correctly (default 200 if not called)
- [ ] `Write` captured and delegated
- [ ] `ResponseCapture` still satisfies `http.ResponseWriter`
- [ ] Middleware logs after handler completes

---

## Task 7: Repository Pattern with Embedded Base (Advanced)

**Goal:** Implement a base repository and extend it with embedding.

**Requirements:**
- `BaseRepository[T any]` generic struct with `db *sql.DB`, `table string`
- Methods: `Count(ctx) int`, `FindByID(ctx, id int) (*T, error)`, `Delete(ctx, id int) error`
- `UserRepository` embeds `BaseRepository[User]` and adds `FindByEmail`
- `ProductRepository` embeds `BaseRepository[Product]` and adds `FindByCategory`
- Use `database/sql` with a mock or sqlite

**Starter Code:**
```go
package main

import (
    "context"
    "database/sql"
    "fmt"
)

type User struct {
    ID    int
    Name  string
    Email string
}

type Product struct {
    ID       int
    Name     string
    Category string
    Price    float64
}

type BaseRepository[T any] struct {
    db    *sql.DB
    table string
}

func (r *BaseRepository[T]) Count(ctx context.Context) (int, error) {
    // TODO: SELECT COUNT(*) FROM r.table
    return 0, nil
}

func (r *BaseRepository[T]) Delete(ctx context.Context, id int) error {
    // TODO: DELETE FROM r.table WHERE id = ?
    return nil
}

type UserRepository struct {
    BaseRepository[User]
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*User, error) {
    // TODO: SELECT * FROM users WHERE email = ?
    return nil, nil
}

type ProductRepository struct {
    BaseRepository[Product]
}

func (r *ProductRepository) FindByCategory(ctx context.Context, cat string) ([]*Product, error) {
    // TODO: SELECT * FROM products WHERE category = ?
    return nil, nil
}

func main() {
    // TODO: setup in-memory SQLite or mock and demonstrate usage
    fmt.Println("Repository pattern with embedding")
}
```

**Evaluation Checklist:**
- [ ] Generic `BaseRepository[T]` compiles
- [ ] `Count` and `Delete` accessible on both UserRepository and ProductRepository
- [ ] Domain-specific methods only on their respective repositories
- [ ] Proper error handling throughout

---

## Task 8: Plugin System with Embedding (Advanced)

**Goal:** Design an extensible plugin system using embedding.

**Requirements:**
- `Plugin` interface: `Name() string`, `Init() error`, `Close() error`, `Version() string`
- `BasePlugin` struct providing default implementations of `Init` (returns nil), `Close` (returns nil), `Version` ("1.0.0")
- `LogPlugin`, `MetricsPlugin`, `AuthPlugin` each embed `BasePlugin` and override only needed methods
- `Manager` that registers, initializes, and shuts down plugins

**Starter Code:**
```go
package main

import "fmt"

type Plugin interface {
    Name() string
    Version() string
    Init() error
    Close() error
}

type BasePlugin struct {
    name string
}

func (p BasePlugin) Name() string    { return p.name }
func (p BasePlugin) Version() string { return "1.0.0" }
func (p BasePlugin) Init() error     { return nil }
func (p BasePlugin) Close() error    { return nil }

type LogPlugin struct {
    BasePlugin
    // TODO: add log-specific fields
}

func (p *LogPlugin) Init() error {
    // TODO: override — setup log file/output
    fmt.Printf("LogPlugin %s initialized\n", p.Name())
    return nil
}

type MetricsPlugin struct {
    BasePlugin
    Port int
}

// TODO: override Init and Close for MetricsPlugin

type AuthPlugin struct {
    BasePlugin
    SecretKey string
}

// TODO: override Init, return error if SecretKey is empty

type Manager struct {
    plugins []Plugin
}

func (m *Manager) Register(p Plugin) error {
    // TODO: call Init, add to list
    return nil
}

func (m *Manager) Shutdown() {
    // TODO: call Close on all plugins in reverse order
}

func main() {
    mgr := &Manager{}

    mgr.Register(&LogPlugin{BasePlugin: BasePlugin{name: "logger"}})
    mgr.Register(&MetricsPlugin{BasePlugin: BasePlugin{name: "metrics"}, Port: 9090})
    mgr.Register(&AuthPlugin{BasePlugin: BasePlugin{name: "auth"}, SecretKey: "secret"})

    fmt.Println("All plugins initialized")
    mgr.Shutdown()
    fmt.Println("All plugins shut down")
}
```

**Evaluation Checklist:**
- [ ] `BasePlugin` provides sensible defaults
- [ ] Each plugin only overrides what it needs
- [ ] Manager correctly initializes and shuts down all plugins
- [ ] Error from `AuthPlugin.Init` (empty key) is handled

---

## Task 9: Composable Middleware with Interface Embedding (Advanced)

**Goal:** Build a composable middleware chain using interface embedding.

**Requirements:**
- `Handler` interface with `Handle(ctx, req) resp`
- `RateLimiter`, `Logger`, `Authenticator` middleware structs — each embeds `Handler`
- `Chain` function to compose middlewares
- Each middleware only overrides `Handle`, delegates unknown to embedded Handler

**Starter Code:**
```go
package main

import (
    "context"
    "fmt"
    "time"
)

type Request struct {
    Path   string
    Method string
    Token  string
}

type Response struct {
    Status  int
    Body    string
}

type Handler interface {
    Handle(ctx context.Context, req Request) Response
}

type HandlerFunc func(ctx context.Context, req Request) Response
func (f HandlerFunc) Handle(ctx context.Context, req Request) Response {
    return f(ctx, req)
}

type RateLimiter struct {
    Handler
    requestsPerSec int
    lastRequest    time.Time
}

func (rl *RateLimiter) Handle(ctx context.Context, req Request) Response {
    // TODO: check rate, return 429 if too fast, else delegate
    return rl.Handler.Handle(ctx, req)
}

type Logger struct {
    Handler
}

func (l *Logger) Handle(ctx context.Context, req Request) Response {
    // TODO: log request, call handler, log response
    return l.Handler.Handle(ctx, req)
}

type Authenticator struct {
    Handler
    validToken string
}

func (a *Authenticator) Handle(ctx context.Context, req Request) Response {
    // TODO: check req.Token, return 401 if invalid, else delegate
    return a.Handler.Handle(ctx, req)
}

func Chain(h Handler, middlewares ...func(Handler) Handler) Handler {
    // TODO: apply middlewares in order (last applied = first executed)
    return h
}

func main() {
    base := HandlerFunc(func(ctx context.Context, req Request) Response {
        return Response{Status: 200, Body: "Hello from " + req.Path}
    })

    handler := Chain(base,
        func(h Handler) Handler { return &Logger{Handler: h} },
        func(h Handler) Handler { return &Authenticator{Handler: h, validToken: "secret"} },
        func(h Handler) Handler { return &RateLimiter{Handler: h, requestsPerSec: 10} },
    )

    ctx := context.Background()

    resp := handler.Handle(ctx, Request{Path: "/api/users", Token: "secret"})
    fmt.Println(resp.Status, resp.Body)  // 200 Hello from /api/users

    resp = handler.Handle(ctx, Request{Path: "/api/users", Token: "wrong"})
    fmt.Println(resp.Status)  // 401
}
```

**Evaluation Checklist:**
- [ ] Each middleware embeds `Handler` interface
- [ ] Delegation via `h.Handler.Handle(...)` works correctly
- [ ] `Chain` applies middlewares in correct order
- [ ] Rate limiting, auth, and logging all work independently

---

## Task 10: Reflect on Embedding: Build a Type Inspector (Expert)

**Goal:** Use reflection to inspect embedded structs and their promoted fields.

**Requirements:**
- `InspectEmbedding(v interface{})` function that prints:
  - All direct fields
  - All embedded (anonymous) types and their promoted fields
  - Depth level for each field
- Handle multiple levels of embedding
- Show which fields are promoted vs own

**Starter Code:**
```go
package main

import (
    "fmt"
    "reflect"
)

type Animal struct {
    Name string
    Age  int
}

type Pet struct {
    Animal
    Owner string
}

type Dog struct {
    Pet
    Breed string
}

type FieldInfo struct {
    Name      string
    Type      string
    Depth     int
    Embedded  bool
    Path      string // e.g., "Dog.Pet.Animal.Name"
}

func InspectEmbedding(v interface{}) []FieldInfo {
    // TODO: use reflect.TypeOf to inspect the struct
    // TODO: recursively handle anonymous (embedded) fields
    // TODO: track depth and path
    return nil
}

func main() {
    fields := InspectEmbedding(Dog{})
    for _, f := range fields {
        fmt.Printf("Depth:%d Path:%-30s Type:%-10s Embedded:%v\n",
            f.Depth, f.Path, f.Type, f.Embedded)
    }
    // Expected:
    // Depth:0 Path:Dog.Pet                          Type:main.Pet  Embedded:true
    // Depth:1 Path:Dog.Pet.Animal                   Type:main.Animal Embedded:true
    // Depth:2 Path:Dog.Pet.Animal.Name              Type:string    Embedded:false
    // Depth:2 Path:Dog.Pet.Animal.Age               Type:int       Embedded:false
    // Depth:1 Path:Dog.Pet.Owner                    Type:string    Embedded:false
    // Depth:0 Path:Dog.Breed                        Type:string    Embedded:false
}
```

**Evaluation Checklist:**
- [ ] Uses `reflect.StructField.Anonymous` to detect embedded fields
- [ ] Recursively inspects embedded types
- [ ] Depth correctly tracked
- [ ] Path shows full nesting chain
- [ ] Works for arbitrary nesting depth
