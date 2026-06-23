# Embedding Structs — Find the Bug

## Bug 1 🟢 Using Named Field Instead of Embedding

```go
package main

import "fmt"

type Engine struct {
    HP int
}

func (e Engine) Start() string {
    return fmt.Sprintf("Engine with %d HP starting", e.HP)
}

type Car struct {
    engine Engine // named field, not embedding
    Brand  string
}

func main() {
    c := Car{
        engine: Engine{HP: 200},
        Brand:  "BMW",
    }

    fmt.Println(c.HP)      // ERROR: c.HP undefined
    fmt.Println(c.Start()) // ERROR: c.Start undefined
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
The developer wants promoted access to Engine's fields and methods. But `engine` is a lowercase named field, not an embedding. What's the difference?
</details>

<details>
<summary>Solution</summary>

**Bug:** `engine Engine` is a named field (lowercase `engine`), not an embedding. Named fields do NOT promote their fields or methods.

Additionally, `engine` is lowercase (unexported), so it's inaccessible even via `c.engine.HP` from outside the package.

**Fix — Option 1: Use embedding:**
```go
type Car struct {
    Engine // embedded (uppercase = exported type name is the field name)
    Brand  string
}

c := Car{Engine: Engine{HP: 200}, Brand: "BMW"}
fmt.Println(c.HP)      // 200 — promoted
fmt.Println(c.Start()) // Engine with 200 HP starting — promoted
```

**Fix — Option 2: Named field + explicit access:**
```go
type Car struct {
    Engine Engine // exported named field
    Brand  string
}

c := Car{Engine: Engine{HP: 200}, Brand: "BMW"}
fmt.Println(c.Engine.HP)      // must be explicit
fmt.Println(c.Engine.Start()) // must be explicit
```

**Key Lesson:** For promoted access, the field must be an anonymous field (embedding). `Engine` (uppercase, no name) = embedding. `engine Engine` or `Engine Engine` = named field (no promotion).
</details>

---

## Bug 2 🟢 Wrong Initialization of Embedded Struct

```go
package main

import "fmt"

type Point struct {
    X, Y int
}

type Circle struct {
    Point
    Radius float64
}

func main() {
    // Attempt 1: treating embedded struct like named field
    c1 := Circle{
        X:      10,   // ERROR: cannot use promoted field in composite literal
        Y:      20,
        Radius: 5.0,
    }

    // Attempt 2: wrong key name
    c2 := Circle{
        point:  Point{X: 1, Y: 2}, // ERROR: unknown field 'point'
        Radius: 3.0,
    }

    fmt.Println(c1, c2)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
In a composite literal for a struct with an embedded type, how do you specify the embedded struct's values?
</details>

<details>
<summary>Solution</summary>

**Bug:** You cannot use promoted field names in composite literals. And the key for an embedded struct in a literal is the **type name** (not a lowercase version).

**Fix:**
```go
// Correct: use the type name as the key
c1 := Circle{
    Point:  Point{X: 10, Y: 20}, // type name "Point" (not "point")
    Radius: 5.0,
}

// Also valid: positional (less readable)
c2 := Circle{Point{1, 2}, 3.0}

// After creation, promoted access works:
fmt.Println(c1.X) // 10 — promoted access works here (just not in literals)
```

**Key Lesson:** In struct composite literals, use the **embedded type's name** as the key. Promoted field names (like `X`, `Y`) cannot be used directly in struct literals — only for field access after creation.
</details>

---

## Bug 3 🟢 Nil Pointer from Uninitialized Pointer Embedding

```go
package main

import "fmt"

type Config struct {
    Host string
    Port int
}

func (c *Config) Address() string {
    return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

type Server struct {
    *Config // pointer embedding
    Name string
}

func main() {
    s := Server{Name: "web-server"}
    // Config is not initialized — it's nil!

    fmt.Println(s.Name)      // "web-server" — OK
    fmt.Println(s.Address()) // PANIC: nil pointer dereference
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
When you embed a pointer type, what is its zero value? What happens when you call a method on a nil pointer?
</details>

<details>
<summary>Solution</summary>

**Bug:** `*Config` is embedded as a pointer. When `Server` is created without initializing `Config`, `s.Config` is `nil`. Calling `s.Address()` (promoted from `*Config`) on a nil receiver causes a panic.

**Fix — Option 1: Initialize the pointer:**
```go
s := Server{
    Config: &Config{Host: "localhost", Port: 8080}, // initialize!
    Name:   "web-server",
}
```

**Fix — Option 2: Use value embedding (if Config is small):**
```go
type Server struct {
    Config Config // value embedding — always initialized to zero values
    Name   string
}

s := Server{Name: "web-server"}
fmt.Println(s.Address()) // "":0 — zero values, not panic
```

**Fix — Option 3: Add validation:**
```go
func NewServer(name, host string, port int) *Server {
    return &Server{
        Config: &Config{Host: host, Port: port},
        Name:   name,
    }
}
```

**Key Lesson:** Pointer embedding (`*T`) has nil zero value. Always initialize pointer-embedded fields, or use a constructor function to ensure proper initialization.
</details>

---

## Bug 4 🟡 Method Not Promoted Because of Value vs Pointer Embedding

```go
package main

import "fmt"

type Signer interface {
    Sign(data string) string
}

type BaseAuth struct {
    SecretKey string
}

// Pointer receiver method
func (a *BaseAuth) Sign(data string) string {
    return data + ":" + a.SecretKey
}

type APIClient struct {
    BaseAuth // embedded by value, not pointer
    BaseURL  string
}

func useClient(s Signer) {
    fmt.Println(s.Sign("test"))
}

func main() {
    client := APIClient{
        BaseAuth: BaseAuth{SecretKey: "my-secret"},
        BaseURL:  "https://api.example.com",
    }

    // Does APIClient satisfy Signer?
    useClient(client) // Compile error!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
`Sign` has a pointer receiver (`*BaseAuth`). `APIClient` embeds `BaseAuth` by value. What is the method set of `APIClient` vs `*APIClient`?
</details>

<details>
<summary>Solution</summary>

**Bug:** `Sign` has a pointer receiver on `BaseAuth`. When embedding `BaseAuth` by value, pointer receiver methods are only in the method set of `*APIClient`, NOT `APIClient`. Since we pass `client` (not `&client`) to `useClient(s Signer)`, the interface is not satisfied.

**Fix — Option 1: Pass pointer:**
```go
useClient(&client) // *APIClient satisfies Signer
```

**Fix — Option 2: Embed by pointer:**
```go
type APIClient struct {
    *BaseAuth // pointer embedding — both value and pointer receiver methods promoted
    BaseURL   string
}

client := APIClient{
    BaseAuth: &BaseAuth{SecretKey: "my-secret"},
    BaseURL:  "https://api.example.com",
}
useClient(client) // now works
```

**Fix — Option 3: Change receiver to value:**
```go
func (a BaseAuth) Sign(data string) string { // value receiver — promoted to both
    return data + ":" + a.SecretKey
}
```

**Key Lesson:**
- Pointer receiver methods on embedded `T` are only in `*Outer`'s method set
- Pointer receiver methods on embedded `*T` are in both `Outer` and `*Outer`'s method sets
</details>

---

## Bug 5 🟡 Copied Mutex via Value Receiver

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    sync.Mutex
    count int
}

func (c Counter) Value() int { // value receiver — copies counter!
    c.Lock()
    defer c.Unlock()
    return c.count
}

func (c *Counter) Increment() {
    c.Lock()
    defer c.Unlock()
    c.count++
}

func main() {
    var c Counter
    c.Increment()
    c.Increment()
    fmt.Println(c.Value()) // works, but go vet warns
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
`Counter` embeds `sync.Mutex`. What happens to the mutex when you copy `Counter` by value?
</details>

<details>
<summary>Solution</summary>

**Bug:** `Value()` has a value receiver `c Counter`. This creates a copy of `Counter`, including the embedded `sync.Mutex`. The mutex state (whether it's locked) is part of the copied value. This can cause:
1. `go vet` warning: "lock value copied"
2. Subtle race conditions if the original is locked when copied
3. The lock in the copy is independent from the original

**Fix:**
```go
func (c *Counter) Value() int { // pointer receiver — no copy
    c.Lock()
    defer c.Unlock()
    return c.count
}
```

**Prevention:**
```go
// Add noCopy to prevent all value copying:
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Counter struct {
    noCopy  noCopy
    sync.Mutex
    count int
}
// go vet will now warn on ANY copy of Counter, not just the mutex
```

**Key Lesson:** Types embedding `sync.Mutex`, `sync.RWMutex`, or `sync.WaitGroup` must always use pointer receivers. Pass such types by pointer always.
</details>

---

## Bug 6 🟡 Ambiguous Selector with Multiple Embedding

```go
package main

import "fmt"

type Writer struct {
    Name string
}

func (w Writer) Write() { fmt.Println("Writer:", w.Name) }

type Reader struct {
    Name string
}

func (r Reader) Read() { fmt.Println("Reader:", r.Name) }

type ReaderWriter struct {
    Writer
    Reader
}

func main() {
    rw := ReaderWriter{
        Writer: Writer{Name: "writer-instance"},
        Reader: Reader{Name: "reader-instance"},
    }

    rw.Write() // works — only Writer has Write
    rw.Read()  // works — only Reader has Read
    fmt.Println(rw.Name) // COMPILE ERROR: ambiguous selector rw.Name
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Both `Writer` and `Reader` have a `Name` field. Which `Name` should `rw.Name` refer to?
</details>

<details>
<summary>Solution</summary>

**Bug:** Both `Writer` and `Reader` have a `Name` field at the same embedding depth. The compiler cannot determine which `Name` to use, so `rw.Name` is ambiguous and causes a compile error.

**Fix — Option 1: Use explicit access:**
```go
fmt.Println(rw.Writer.Name) // explicit: writer-instance
fmt.Println(rw.Reader.Name) // explicit: reader-instance
```

**Fix — Option 2: Rename conflicting fields:**
```go
type Writer struct { WriterName string }
type Reader struct { ReaderName string }
// Now rw.WriterName and rw.ReaderName are unambiguous
```

**Fix — Option 3: Add a Name field to ReaderWriter (shadows both):**
```go
type ReaderWriter struct {
    Writer
    Reader
    Name string // this shadows both Writer.Name and Reader.Name
}
// rw.Name refers to ReaderWriter.Name
```

**Key Lesson:** When two embedded types have fields/methods with the same name at the same depth, access is ambiguous. Resolve by: explicit access, renaming fields in embedded types, or adding an overriding field/method in the outer struct.
</details>

---

## Bug 7 🟡 Interface Embedding Without Initialization

```go
package main

import "fmt"

type Logger interface {
    Log(msg string)
}

type Service struct {
    Logger // embedded interface
    Name   string
}

func (s *Service) Process() {
    s.Log("processing") // will panic if Logger is nil!
}

func main() {
    s := &Service{Name: "my-service"}
    // Logger is not set — it's nil interface value
    s.Process() // PANIC: nil pointer dereference
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
When you embed an interface in a struct and don't set it, what is its value?
</details>

<details>
<summary>Solution</summary>

**Bug:** Embedding an interface in a struct creates a field that holds an interface value. The zero value of an interface is `nil`. Calling `s.Log("processing")` on a nil interface panics.

**Fix — Option 1: Always provide a logger:**
```go
type ConsoleLogger struct{}
func (l ConsoleLogger) Log(msg string) { fmt.Println(msg) }

s := &Service{
    Logger: ConsoleLogger{}, // always provide a concrete implementation
    Name:   "my-service",
}
```

**Fix — Option 2: Null object pattern:**
```go
type NoopLogger struct{}
func (l NoopLogger) Log(msg string) {} // does nothing

func NewService(name string, log Logger) *Service {
    if log == nil {
        log = NoopLogger{}
    }
    return &Service{Logger: log, Name: name}
}
```

**Fix — Option 3: Nil check in method:**
```go
func (s *Service) Process() {
    if s.Logger != nil {
        s.Log("processing")
    }
}
```

**Key Lesson:** Embedded interface fields are `nil` by default. Unlike value type embedding (which has safe zero values), interface embedding requires explicit initialization. Always use a constructor or nil check.
</details>

---

## Bug 8 🔴 Broken Polymorphism Assumption

```go
package main

import "fmt"

type Animal struct {
    Name string
}

func (a Animal) Sound() string { return "..." }
func (a Animal) Describe() string {
    return fmt.Sprintf("%s says %s", a.Name, a.Sound())
}

type Dog struct {
    Animal
    Breed string
}

func (d Dog) Sound() string { return "Woof" }

func main() {
    d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}

    fmt.Println(d.Sound())    // "Woof" — Dog's method
    fmt.Println(d.Describe()) // Developer expects: "Rex says Woof"
                              // Actual:            "Rex says ..." BUG!
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
In object-oriented languages with inheritance, when a base class method calls a virtual method, the subclass's override is used. What does Go do differently?
</details>

<details>
<summary>Solution</summary>

**Bug:** The developer is assuming inheritance-style virtual dispatch. When `Animal.Describe()` calls `a.Sound()`, it calls `Animal.Sound()` — because the receiver is `Animal`, not `Dog`. There is no "virtual dispatch" in Go.

The call chain is:
- `d.Describe()` → actually `d.Animal.Describe()` (wrapper calls Animal.Describe)
- Inside `Animal.Describe`: `a.Sound()` → `Animal.Sound()` (a is Animal, not Dog)

**Fix — Pattern 1: Use interface parameter:**
```go
type Sounder interface {
    Sound() string
}

func (a Animal) DescribeWith(s Sounder) string {
    return fmt.Sprintf("%s says %s", a.Name, s.Sound())
}

// Usage:
d.Animal.DescribeWith(d) // Rex says Woof
```

**Fix — Pattern 2: Override Describe in Dog:**
```go
func (d Dog) Describe() string {
    return fmt.Sprintf("%s says %s", d.Name, d.Sound())
}
// d.Describe() → Dog.Describe() → uses Dog.Sound()
```

**Fix — Pattern 3: Store the Sounder interface:**
```go
type Animal struct {
    Name    string
    sounder Sounder // inject the sounder
}

func (a Animal) Describe() string {
    return fmt.Sprintf("%s says %s", a.Name, a.sounder.Sound())
}

d := Dog{Animal: Animal{Name: "Rex"}}
d.sounder = d // Animal stores reference to Dog which implements Sounder
```

**Key Lesson:** Go does NOT have virtual dispatch. When an embedded type's method calls another method on itself, it uses the embedded type's own methods — not the outer struct's. This is the fundamental difference between embedding and inheritance.
</details>

---

## Bug 9 🔴 Concurrent Access to Shared Pointer-Embedded Field

```go
package main

import (
    "fmt"
    "sync"
)

type SharedConfig struct {
    Debug bool
    Port  int
}

type ServiceA struct {
    *SharedConfig
    Name string
}

type ServiceB struct {
    *SharedConfig // SAME pointer!
    Name string
}

func main() {
    cfg := &SharedConfig{Debug: false, Port: 8080}

    svcA := &ServiceA{SharedConfig: cfg, Name: "A"}
    svcB := &ServiceB{SharedConfig: cfg, Name: "B"}

    var wg sync.WaitGroup
    wg.Add(2)

    go func() {
        defer wg.Done()
        // svcA modifies shared config!
        svcA.Debug = true // DATA RACE!
    }()

    go func() {
        defer wg.Done()
        // svcB reads shared config!
        fmt.Println(svcB.Debug) // DATA RACE!
    }()

    wg.Wait()
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
Both `ServiceA` and `ServiceB` embed the same `*SharedConfig` pointer. What happens when two goroutines access the same memory location concurrently?
</details>

<details>
<summary>Solution</summary>

**Bug:** Both services embed `*SharedConfig` pointing to the same `cfg` object. When goroutines modify and read `svcA.Debug` and `svcB.Debug`, they're accessing the same memory location (`cfg.Debug`) without synchronization — a data race.

**Detected by:**
```bash
go run -race main.go
# DATA RACE: write by goroutine N at svcA.Debug
```

**Fix — Option 1: Separate copies (no shared pointer):**
```go
cfgA := &SharedConfig{Debug: false, Port: 8080}
cfgB := &SharedConfig{Debug: false, Port: 8080}

svcA := &ServiceA{SharedConfig: cfgA}
svcB := &ServiceB{SharedConfig: cfgB}
```

**Fix — Option 2: Add mutex to SharedConfig:**
```go
type SharedConfig struct {
    mu    sync.RWMutex
    Debug bool
    Port  int
}

func (c *SharedConfig) SetDebug(v bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.Debug = v
}

func (c *SharedConfig) IsDebug() bool {
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.Debug
}
```

**Key Lesson:** When two structs embed the same pointer, they share the pointed-to data. Concurrent access to shared pointer-embedded fields requires synchronization. Always run with `-race` flag during development.
</details>

---

## Bug 10 🔴 Infinite Loop via Method Promotion Confusion

```go
package main

import (
    "encoding/json"
    "fmt"
)

type Timestamp struct {
    Value int64
}

// Custom marshaling for Timestamp
func (t Timestamp) MarshalJSON() ([]byte, error) {
    return json.Marshal(t.Value)
}

type Event struct {
    Timestamp          // embedded — MarshalJSON promoted
    Name      string   `json:"name"`
}

// Developer tries to add custom marshal to Event:
func (e Event) MarshalJSON() ([]byte, error) {
    // Uses alias pattern — BUT the alias also embeds Timestamp!
    type Alias Event
    return json.Marshal(struct {
        Alias
        // trying to format the timestamp differently
        TS string `json:"timestamp"`
    }{
        Alias: (Alias)(e),    // Alias embeds Timestamp which has MarshalJSON
        TS:    fmt.Sprintf("%d", e.Timestamp.Value),
    })
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
When the `Alias` struct is marshaled, what happens with the embedded `Timestamp` field? Does `Timestamp.MarshalJSON` get called? Does it conflict with the outer `MarshalJSON`?
</details>

<details>
<summary>Solution</summary>

**Bug:** The inline struct `struct{ Alias; TS string }` has `Alias` embedded. `Alias` is defined as `type Alias Event`, which embeds `Timestamp`. `Timestamp` has `MarshalJSON`. So when `json.Marshal(struct{Alias; TS string}{...})` runs, it needs to marshal `Alias`, which marshals `Timestamp` using `Timestamp.MarshalJSON` — but meanwhile `Event.MarshalJSON` is also in scope.

Actually the real issue: if `Event.MarshalJSON` calls `json.Marshal(Alias{})`, and `Alias` promotes `Timestamp.MarshalJSON`, the JSON encoder will call `Timestamp.MarshalJSON` for the timestamp field — that's fine. BUT if the developer writes `json.Marshal(e)` inside `Event.MarshalJSON` (without alias), that WOULD be infinite recursion.

The additional bug: the `TS string` field and the embedded `Alias` will both try to marshal the timestamp — causing duplicate output.

**Fix:**
```go
func (e Event) MarshalJSON() ([]byte, error) {
    type AliasTmStruct struct {
        Value int64
    }

    return json.Marshal(struct {
        Name string `json:"name"`
        TS   string `json:"timestamp"`
    }{
        Name: e.Name,
        TS:   fmt.Sprintf("%d", e.Timestamp.Value),
    })
    // Completely custom structure — no Alias, no embedding confusion
}
```

**Key Lesson:** When writing `MarshalJSON` for a struct with embedded types that also have `MarshalJSON`, be careful about double-encoding. Build the output structure explicitly rather than embedding the original type.
</details>

---

## Bug 11 🔴 The Embedded Interface `nil` Panic in Production

```go
package main

import (
    "fmt"
    "net/http"
)

type Cacher interface {
    Get(key string) ([]byte, bool)
    Set(key string, val []byte)
}

type Handler struct {
    Cacher // embedded — nil by default!
    DB     Database
}

func NewHandler(db Database) *Handler {
    return &Handler{DB: db}
    // Cacher is nil — but no one notices until cache is hit
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    key := r.URL.Path

    // This works fine when cache is hit:
    if data, ok := h.Get(key); ok { // PANIC when Cacher is nil
        w.Write(data)
        return
    }

    data := h.DB.Fetch(key)
    h.Set(key, data) // Also panics
    w.Write(data)
}
```

**What's wrong?**

<details>
<summary>Hint</summary>
`Cacher` is an embedded interface. What happens when the `Handler` is created without setting the `Cacher` field?
</details>

<details>
<summary>Solution</summary>

**Bug:** `Cacher` is an embedded interface with nil zero value. `NewHandler` doesn't set it, so `h.Cacher` is nil. Calling `h.Get(key)` panics with "nil pointer dereference" because promoted interface method dispatch requires the interface value to be non-nil.

This bug is particularly dangerous because:
1. Code compiles and works in unit tests (if tests mock the handler differently)
2. Fails silently in a specific code path (only when cache key not found)
3. Difficult to reproduce in development if cache is always warm

**Fix — Option 1: Require Cacher in constructor:**
```go
func NewHandler(db Database, cache Cacher) *Handler {
    if cache == nil {
        panic("Handler: Cacher must not be nil")
    }
    return &Handler{Cacher: cache, DB: db}
}
```

**Fix — Option 2: Nil-safe no-op implementation:**
```go
type NoopCache struct{}
func (NoopCache) Get(key string) ([]byte, bool) { return nil, false }
func (NoopCache) Set(key string, val []byte)    {}

func NewHandler(db Database, cache Cacher) *Handler {
    if cache == nil {
        cache = NoopCache{}
    }
    return &Handler{Cacher: cache, DB: db}
}
```

**Fix — Option 3: Named field + nil check:**
```go
type Handler struct {
    cache Cacher // named, private — explicit nil check
    DB    Database
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if h.cache != nil {
        if data, ok := h.cache.Get(r.URL.Path); ok {
            w.Write(data)
            return
        }
    }
    // ...
}
```

**Key Lesson:** Embedded interfaces have nil zero values. Always use constructor functions to ensure they're initialized. Or provide a no-op default (null object pattern) to avoid nil checks throughout the code.
</details>
