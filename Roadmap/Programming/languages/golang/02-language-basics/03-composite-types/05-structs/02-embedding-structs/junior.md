# Embedding Structs — Junior Level

## 1. What Is Embedding?

Embedding is a way to include one struct inside another without giving it a name. The embedded struct's fields and methods become directly accessible on the outer struct.

```go
type Animal struct {
    Name string
}

type Dog struct {
    Animal // embedded — no field name!
    Breed string
}
```

Notice that `Animal` appears in `Dog` without a name before it. This is embedding (also called an anonymous field).

---

## 2. Basic Embedding Example

```go
package main

import "fmt"

type Animal struct {
    Name string
}

type Dog struct {
    Animal
    Breed string
}

func main() {
    d := Dog{
        Animal: Animal{Name: "Rex"},
        Breed:  "Labrador",
    }

    fmt.Println(d.Name)  // Rex — accessed directly!
    fmt.Println(d.Breed) // Labrador
}
```

Even though `Name` is defined in `Animal`, you can access it on `d` directly as `d.Name`. This is called **promotion**.

---

## 3. How to Initialize Embedded Structs

When creating a struct with an embedded type, use the type name as the key:

```go
type Point struct {
    X, Y int
}

type Circle struct {
    Point  // embedded
    Radius float64
}

func main() {
    // Option 1: Named initialization
    c := Circle{
        Point:  Point{X: 10, Y: 20},
        Radius: 5.0,
    }

    // Option 2: Access via promoted fields after creation
    var c2 Circle
    c2.X = 10       // c2.Point.X = 10
    c2.Y = 20       // c2.Point.Y = 20
    c2.Radius = 5.0

    fmt.Println(c.X, c.Y, c.Radius)   // 10 20 5
    fmt.Println(c2.X, c2.Y, c2.Radius) // 10 20 5
}
```

---

## 4. Method Promotion

Methods defined on the embedded type are also promoted to the outer struct.

```go
type Animal struct {
    Name string
}

func (a Animal) Speak() string {
    return a.Name + " makes a sound"
}

type Dog struct {
    Animal
    Breed string
}

func main() {
    d := Dog{Animal: Animal{Name: "Buddy"}, Breed: "Poodle"}
    fmt.Println(d.Speak()) // Buddy makes a sound
    // d.Speak() is actually d.Animal.Speak()
}
```

---

## 5. Explicit vs Promoted Access

You can always access the embedded struct explicitly, even when using promoted access.

```go
type Engine struct {
    Power int
    Fuel  string
}

type Car struct {
    Engine
    Brand string
}

func main() {
    c := Car{
        Engine: Engine{Power: 150, Fuel: "Gasoline"},
        Brand:  "Toyota",
    }

    // Promoted access (short form)
    fmt.Println(c.Power) // 150
    fmt.Println(c.Fuel)  // Gasoline

    // Explicit access (long form)
    fmt.Println(c.Engine.Power) // 150
    fmt.Println(c.Engine.Fuel)  // Gasoline

    // Both are equivalent
}
```

---

## 6. Embedding vs Named Field

The difference between embedding and a regular named field:

```go
// Embedding: fields/methods are PROMOTED
type Employee struct {
    Person        // embedded: e.Name works
    Department string
}

// Named field: NO promotion
type Employee2 struct {
    person Person // named field: e.Name does NOT work
    Department string
}

type Person struct {
    Name string
    Age  int
}

func main() {
    e := Employee{Person: Person{Name: "Alice", Age: 30}, Department: "Engineering"}
    fmt.Println(e.Name) // Works! Promoted from Person

    e2 := Employee2{person: Person{Name: "Bob", Age: 25}, Department: "Sales"}
    // fmt.Println(e2.Name) // ERROR: e2.Name undefined
    fmt.Println(e2.person.Name) // Must use explicit path
}
```

---

## 7. Multiple Embedding

A struct can embed multiple types at once.

```go
type Swimmer struct {
    SwimSpeed float64
}

func (s Swimmer) Swim() string {
    return fmt.Sprintf("swimming at %.1f km/h", s.SwimSpeed)
}

type Runner struct {
    RunSpeed float64
}

func (r Runner) Run() string {
    return fmt.Sprintf("running at %.1f km/h", r.RunSpeed)
}

type Triathlete struct {
    Swimmer
    Runner
    Name string
}

func main() {
    t := Triathlete{
        Name:    "Alice",
        Swimmer: Swimmer{SwimSpeed: 3.5},
        Runner:  Runner{RunSpeed: 12.0},
    }

    fmt.Println(t.Swim()) // swimming at 3.5 km/h
    fmt.Println(t.Run())  // running at 12.0 km/h
}
```

---

## 8. Shadowing (Overriding) a Method

If the outer struct defines a method with the same name as an embedded method, the outer one takes priority.

```go
type Base struct{}

func (b Base) Greet() string {
    return "Hello from Base"
}

type Child struct {
    Base
}

func (c Child) Greet() string {
    return "Hello from Child" // overrides Base.Greet
}

func main() {
    c := Child{}
    fmt.Println(c.Greet())       // Hello from Child (outer wins)
    fmt.Println(c.Base.Greet())  // Hello from Base (explicit access)
}
```

---

## 9. Embedding Structs with Pointer Receivers

```go
type Logger struct {
    Prefix string
}

func (l *Logger) Log(msg string) {
    fmt.Printf("[%s] %s\n", l.Prefix, msg)
}

type Server struct {
    *Logger // pointer embedding
    Host string
    Port int
}

func main() {
    s := Server{
        Logger: &Logger{Prefix: "SERVER"},
        Host:   "localhost",
        Port:   8080,
    }

    s.Log("Starting...") // [SERVER] Starting...
}
```

When embedding a pointer (`*Logger`), you must initialize it — a nil pointer will cause a panic when methods are called.

---

## 10. Embedding Interfaces

You can embed interfaces in structs. This is used to partially implement an interface.

```go
type Stringer interface {
    String() string
}

type MyType struct {
    Stringer // embed the interface
    Value    int
}

// Now MyType implements Stringer (if Stringer field is set)

func main() {
    mt := MyType{
        Stringer: fmt.Stringer(nil), // just showing the syntax
        Value:    42,
    }
    // This pattern is commonly used with mocking in tests
}
```

More commonly, interfaces are embedded in other interfaces:

```go
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }

type ReadWriter interface {
    Reader  // embedded interface
    Writer  // embedded interface
}
```

---

## 11. Practical Example: Timestamps Mixin

A very common Go pattern: embedding a `Timestamps` struct in all your models.

```go
package main

import (
    "fmt"
    "time"
)

type Timestamps struct {
    CreatedAt time.Time
    UpdatedAt time.Time
}

type User struct {
    Timestamps // embedded
    ID    int
    Name  string
    Email string
}

type Post struct {
    Timestamps // embedded
    ID      int
    Title   string
    Content string
}

func main() {
    now := time.Now()

    u := User{
        Timestamps: Timestamps{CreatedAt: now, UpdatedAt: now},
        ID: 1, Name: "Alice", Email: "alice@example.com",
    }

    p := Post{
        Timestamps: Timestamps{CreatedAt: now, UpdatedAt: now},
        ID: 1, Title: "Hello Go", Content: "...",
    }

    fmt.Println(u.CreatedAt) // directly accessible
    fmt.Println(p.UpdatedAt) // directly accessible
}
```

---

## 12. Embedding with JSON Tags

Embedded struct fields appear at the same JSON level as the outer struct's fields.

```go
package main

import (
    "encoding/json"
    "fmt"
    "time"
)

type Timestamps struct {
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

type User struct {
    ID   int    `json:"id"`
    Name string `json:"name"`
    Timestamps   // embedded — fields appear at top level in JSON
}

func main() {
    u := User{
        ID:   1,
        Name: "Alice",
        Timestamps: Timestamps{
            CreatedAt: time.Now(),
            UpdatedAt: time.Now(),
        },
    }

    data, _ := json.MarshalIndent(u, "", "  ")
    fmt.Println(string(data))
    // {
    //   "id": 1,
    //   "name": "Alice",
    //   "created_at": "2024-...",
    //   "updated_at": "2024-..."
    // }
    // Note: created_at and updated_at are at the TOP level
}
```

---

## 13. Why Not Just Use Inheritance?

Go doesn't have inheritance like Java or C++. Embedding is composition, not inheritance.

**Java inheritance:**
```java
class Animal { String name; }
class Dog extends Animal { String breed; }
Dog d = new Dog();
// Dog IS-A Animal (polymorphism works)
```

**Go embedding:**
```go
type Animal struct { Name string }
type Dog struct { Animal; Breed string }
d := Dog{}
// Dog HAS-A Animal (composition)
// Dog is NOT an Animal — d cannot be used where Animal is expected
```

This is intentional — Go prefers composition over inheritance.

---

## 14. Embedding and Interface Satisfaction

Embedding helps types satisfy interfaces without re-writing method bodies.

```go
type Logger interface {
    Log(msg string)
}

type ConsoleLogger struct{}
func (l ConsoleLogger) Log(msg string) { fmt.Println(msg) }

type FileLogger struct{}
func (l FileLogger) Log(msg string) { /* write to file */ }

// Server uses ConsoleLogger by embedding
type Server struct {
    ConsoleLogger // Server.Log now works
    Host string
}

// Another server uses FileLogger
type FileServer struct {
    FileLogger // FileServer.Log now works
    Path string
}

func startService(l Logger) {
    l.Log("Service starting")
}

func main() {
    s := Server{Host: "localhost"}
    fs := FileServer{Path: "/tmp"}

    startService(s)  // Server satisfies Logger via ConsoleLogger
    startService(fs) // FileServer satisfies Logger via FileLogger
}
```

---

## 15. Embedding: Common Struct Patterns in the Wild

```go
// Pattern 1: Base model for database records
type Model struct {
    ID        uint      `gorm:"primarykey"`
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt *time.Time
}

type User struct {
    Model // embed standard fields
    Name  string
    Email string
}

// Pattern 2: HTTP request context wrapper
type RequestContext struct {
    *http.Request
    Params map[string]string
}

// Pattern 3: Error with metadata
type AppError struct {
    error        // embed the error interface
    Code    int
    Message string
}

func (e AppError) Error() string {
    return fmt.Sprintf("[%d] %s", e.Code, e.Message)
}
```

---

## 16. Name Conflicts: What Happens?

If two embedded structs have a field with the same name, you must use explicit access.

```go
type A struct { Value int }
type B struct { Value int }

type C struct {
    A
    B
}

func main() {
    c := C{A: A{Value: 1}, B: B{Value: 2}}

    // c.Value // ERROR: ambiguous selector c.Value
    fmt.Println(c.A.Value) // 1 — must be explicit
    fmt.Println(c.B.Value) // 2 — must be explicit
}
```

---

## 17. Embedding Pointer to Struct

```go
type Config struct {
    Debug bool
    Port  int
}

type Application struct {
    *Config // pointer embedding
    Name string
}

func main() {
    cfg := &Config{Debug: true, Port: 8080}
    app := Application{Config: cfg, Name: "MyApp"}

    fmt.Println(app.Debug) // true — promoted from Config
    fmt.Println(app.Port)  // 8080

    // Modifying via app modifies the original config
    app.Debug = false
    fmt.Println(cfg.Debug) // false — same pointer!
}
```

---

## 18. When to Use Embedding

Use embedding when:
1. You want to reuse fields/methods from another type
2. You want the outer type to "extend" the behavior of the inner type
3. You want the outer type to satisfy an interface via the embedded type
4. You're building mixins (like Timestamps, SoftDelete, Auditable)

Don't use embedding when:
1. You need a named relationship (use named fields)
2. The relationship is "uses" not "is-a-kind-of"
3. Promotion would cause confusing name collisions

---

## 19. Embedding vs Composition

```go
// Embedding (promotes fields and methods):
type Car struct {
    Engine      // all Engine fields/methods accessible on Car
    Brand string
}

// Composition (named field, no promotion):
type Car2 struct {
    engine Engine // must use c.engine.Start(), c.engine.Power
    Brand  string
}

// Choose composition when you want to control access:
type SafeCar struct {
    engine Engine // unexported: callers can't access engine directly
    Brand  string
}

func (s *SafeCar) Start() error {
    // Add validation/logging before delegating
    if s.Brand == "" {
        return errors.New("unregistered vehicle")
    }
    return s.engine.Start()
}
```

---

## 20. Recursive Embedding Check

Can you embed a struct that contains itself? No — Go prevents recursive struct definitions.

```go
// This will NOT compile:
type Node struct {
    Node  // ERROR: invalid recursive type
    Value int
}

// To create a recursive data structure, use a pointer:
type Node struct {
    *Node // OK: pointer to Node
    Value int
}

// Or name the field:
type TreeNode struct {
    Left  *TreeNode // named field with pointer
    Right *TreeNode
    Value int
}
```

---

## 21. Practical Example: HTTP Middleware Chain

```go
package main

import (
    "fmt"
    "net/http"
    "time"
)

type BaseHandler struct {
    Logger func(msg string)
}

func (b *BaseHandler) LogRequest(r *http.Request) {
    b.Logger(fmt.Sprintf("%s %s at %s", r.Method, r.URL.Path, time.Now().Format(time.RFC3339)))
}

type UserHandler struct {
    *BaseHandler // embedded
    DB interface{}
}

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
    h.LogRequest(r) // call promoted method
    fmt.Fprintln(w, "user data")
}

func main() {
    base := &BaseHandler{Logger: func(msg string) { fmt.Println("[LOG]", msg) }}
    handler := &UserHandler{BaseHandler: base}

    http.HandleFunc("/user", handler.GetUser)
}
```

---

## 22. Zero Values and Embedding

Embedded structs take their zero value automatically.

```go
type Config struct {
    Timeout int
    Retries int
}

type Service struct {
    Config // zero value: {Timeout:0, Retries:0}
    Name string
}

func main() {
    var s Service
    fmt.Println(s.Timeout) // 0
    fmt.Println(s.Retries) // 0
    fmt.Println(s.Name)    // ""
    // All zero values — no panic, no nil pointer
}
```

Contrast with pointer embedding where you must initialize:

```go
type Service2 struct {
    *Config // zero value: nil pointer!
    Name string
}

func main() {
    var s Service2
    // s.Timeout  // PANIC: nil pointer dereference
    fmt.Println(s.Name) // "" — OK
}
```

---

## 23. Embedding in Test Code

Embedding is useful for creating test helpers with shared functionality.

```go
package mypackage_test

import (
    "testing"
)

type TestHelper struct {
    t *testing.T
}

func (h *TestHelper) AssertEqual(got, want interface{}) {
    h.t.Helper()
    if got != want {
        h.t.Errorf("got %v, want %v", got, want)
    }
}

func (h *TestHelper) AssertNoError(err error) {
    h.t.Helper()
    if err != nil {
        h.t.Fatalf("unexpected error: %v", err)
    }
}

// Embed in test cases:
type UserServiceTest struct {
    TestHelper
    service *UserService
}

func TestUserService(t *testing.T) {
    ts := &UserServiceTest{
        TestHelper: TestHelper{t: t},
        service:    NewUserService(),
    }

    user, err := ts.service.Create("Alice", "alice@example.com")
    ts.AssertNoError(err) // promoted
    ts.AssertEqual(user.Name, "Alice") // promoted
}
```

---

## 24. Structs Embedding Interfaces (Mocking Pattern)

```go
type Database interface {
    Get(id int) (*User, error)
    Save(u *User) error
}

// MockDB partially implements Database via embedding
type MockDB struct {
    Database // embed the interface — all methods return nil by default (panic!)
}

// Override only the method you need for this test
func (m *MockDB) Get(id int) (*User, error) {
    return &User{ID: id, Name: "Mock User"}, nil
}

func TestGetUser(t *testing.T) {
    mock := &MockDB{}
    user, err := mock.Get(42)
    if err != nil {
        t.Fatal(err)
    }
    if user.ID != 42 {
        t.Errorf("want ID 42, got %d", user.ID)
    }
    // mock.Save() would panic — not overridden!
}
```

---

## 25. Multiple Embedding with Methods

When multiple embedded types provide methods with the same name, you get a compile-time ambiguity error.

```go
type Flyer struct{}
func (f Flyer) Move() string { return "flying" }

type Swimmer struct{}
func (s Swimmer) Move() string { return "swimming" }

type Duck struct {
    Flyer
    Swimmer
}

func main() {
    d := Duck{}
    // d.Move() // ERROR: ambiguous selector d.Move
    fmt.Println(d.Flyer.Move())   // "flying"
    fmt.Println(d.Swimmer.Move()) // "swimming"

    // To resolve: define Move on Duck itself
}

func (d Duck) Move() string {
    return "duck moves: " + d.Flyer.Move() + " or " + d.Swimmer.Move()
}
```

---

## 26. Checking if Embedded Field Implements Interface

```go
type Stringer interface {
    String() string
}

type Named struct {
    Name string
}

func (n Named) String() string {
    return n.Name
}

type Person struct {
    Named // implements Stringer via Named
    Age int
}

func printStringer(s Stringer) {
    fmt.Println(s.String())
}

func main() {
    p := Person{Named: Named{Name: "Alice"}, Age: 30}
    printStringer(p) // works! Person satisfies Stringer via Named.String()
    fmt.Println(p)   // uses String() automatically: Alice
}
```

---

## 27. Embedded Struct and Method Sets

For interface satisfaction, the method set of the outer type includes the promoted methods of embedded types.

```go
type Writer interface {
    Write([]byte) (int, error)
}

type Logger struct {
    buf bytes.Buffer
}

func (l *Logger) Write(p []byte) (int, error) {
    return l.buf.Write(p) // delegate to buffer
}

type Handler struct {
    *Logger // pointer embedding
}

// Handler satisfies Writer because *Logger.Write is promoted
func useWriter(w Writer) { w.Write([]byte("hello")) }

func main() {
    h := &Handler{Logger: &Logger{}}
    useWriter(h) // works!
}
```

---

## 28. Copying Structs with Embedding

Copying a struct copies all embedded fields too (shallow copy).

```go
type Stats struct {
    Visits int
    Clicks int
}

type Page struct {
    Stats
    URL string
}

func main() {
    original := Page{
        Stats: Stats{Visits: 100, Clicks: 10},
        URL:   "https://example.com",
    }

    copy := original // shallow copy
    copy.Visits = 200

    fmt.Println(original.Visits) // 100 — unchanged (value type, not pointer)
    fmt.Println(copy.Visits)     // 200
}
```

With pointer embedding, copying the outer struct copies only the pointer:

```go
type Page2 struct {
    *Stats // pointer
    URL string
}

original2 := Page2{Stats: &Stats{Visits: 100}, URL: "x"}
copy2 := original2 // copies the Stats pointer, not the Stats struct
copy2.Visits = 200
fmt.Println(original2.Visits) // 200 — MODIFIED! Same pointer
```

---

## 29. Embedding in Error Types

```go
type ValidationError struct {
    Field   string
    Message string
}

func (v *ValidationError) Error() string {
    return fmt.Sprintf("validation: field '%s': %s", v.Field, v.Message)
}

type HTTPError struct {
    *ValidationError // embed error type
    StatusCode int
}

func main() {
    err := &HTTPError{
        ValidationError: &ValidationError{
            Field:   "email",
            Message: "invalid format",
        },
        StatusCode: 400,
    }

    fmt.Println(err.Error())      // from embedded ValidationError
    fmt.Println(err.Field)        // promoted field
    fmt.Println(err.StatusCode)   // own field

    var ve *ValidationError
    if errors.As(err, &ve) {
        fmt.Println("validation error on:", ve.Field)
    }
}
```

---

## 30. Quick Reference

```go
// Basic embedding syntax:
type Outer struct {
    Inner       // embed by value
    *OtherInner // embed by pointer
    OwnField string
}

// Access:
o.InnerField         // promoted access
o.Inner.InnerField   // explicit access (both work)

// Method promotion:
o.InnerMethod()        // promoted call
o.Inner.InnerMethod()  // explicit call (both work)

// Override embedded method:
func (o Outer) OverriddenMethod() { ... }

// Initialization:
o := Outer{
    Inner: Inner{...},
    OtherInner: &OtherInner{...},
    OwnField: "value",
}

// Rules:
// 1. Embedded fields are promoted (short access works)
// 2. Outer fields/methods SHADOW inner ones with same name
// 3. Ambiguous same-name from two embeds → must use explicit access
// 4. Embedding != inheritance (no polymorphism)
// 5. Pointer embedding: must initialize before use
// 6. JSON: embedded struct fields appear at top level
```
