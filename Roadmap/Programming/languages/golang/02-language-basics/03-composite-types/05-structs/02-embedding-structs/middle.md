# Embedding Structs — Middle Level

## 1. The Design Philosophy: Composition Over Inheritance

Go deliberately excludes class-based inheritance. Instead, it provides embedding as a controlled composition mechanism. This reflects the principle that "has-a" relationships are more flexible than "is-a" relationships.

**The problem with inheritance (Go's perspective):**
- Deep inheritance hierarchies create tight coupling
- A change in a base class can break all subclasses
- "Fragile base class" problem is pervasive in Java/C++ codebases
- Multiple inheritance causes diamond problem complexity

**Why composition wins:**
- Types remain independent — changing one doesn't affect others
- Behavior can be mixed selectively
- Testing is easier (mock only what you need)
- No "gorilla and banana" problem (you get exactly what you embed)

```go
// Go way: mix behaviors via embedding
type Auditable struct { /* audit fields */ }
type SoftDeletable struct { /* delete flag */ }
type Cacheable struct { /* cache key */ }

type Order struct {
    Auditable
    SoftDeletable
    // NOT Cacheable — orders not cached
    ID    int
    Total float64
}

type Product struct {
    Auditable
    Cacheable
    // NOT SoftDeletable — products are hard deleted
    Name  string
    Price float64
}
```

---

## 2. When to Embed vs When to Use Named Fields

**Use embedding when:**
- You want transparent access to the embedded type's API
- The embedded type represents a "mixin" or "capability" (Timestamps, SoftDelete, Logger)
- You want the outer type to satisfy an interface through the embedded type
- The relationship is "extends" or "is-a-kind-of"

**Use named fields when:**
- You want to control access to the inner type's API
- The relationship is a clear "uses-a" or "has-a"
- You want to add validation/logging before delegating
- You're storing multiple instances of the same type

```go
// Named field (preferred for clear relationships):
type Order struct {
    Customer Customer  // order HAS-A customer
    Items    []Item    // order HAS-A list of items
    Payment  Payment   // order HAS-A payment
}

// Embedding (preferred for mixins/capabilities):
type Order struct {
    Auditable    // order IS auditable (mixin)
    SoftDeletable // order IS soft-deletable (mixin)
    // ...
}
```

---

## 3. Promoted Method Sets and Interface Satisfaction

Understanding which methods are promoted and which are not is crucial for interface satisfaction.

```go
type A struct{}
func (a A)  ValueMethod() {}   // value receiver
func (a *A) PtrMethod()   {}   // pointer receiver

type B struct{ A }  // embed by value
type C struct{ *A } // embed by pointer

// Method set of B (value):    {ValueMethod}
// Method set of *B (pointer): {ValueMethod, PtrMethod}

// Method set of C (value):    {ValueMethod, PtrMethod}
// Method set of *C (pointer): {ValueMethod, PtrMethod}
```

**Rule:** When embedding by value, pointer receiver methods of the embedded type are only promoted to the pointer of the outer type, not the value.

```go
type Saver interface {
    Save() error
}

type BaseRepo struct{}
func (r *BaseRepo) Save() error { return nil } // pointer receiver

type UserRepo struct {
    BaseRepo // embed by value
}

var _ Saver = &UserRepo{} // OK: *UserRepo satisfies Saver
// var _ Saver = UserRepo{} // ERROR: UserRepo does not satisfy Saver
```

---

## 4. The Mixin Pattern

Mixins are reusable struct fragments that provide common behavior.

```go
// Timestamp mixin
type Timestamps struct {
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt *time.Time // nil = not deleted
}

func (t *Timestamps) Touch() {
    t.UpdatedAt = time.Now()
}

func (t *Timestamps) SoftDelete() {
    now := time.Now()
    t.DeletedAt = &now
}

func (t Timestamps) IsDeleted() bool {
    return t.DeletedAt != nil
}

// Any model gets these for free:
type User struct {
    Timestamps
    ID    int
    Name  string
}

type Post struct {
    Timestamps
    ID      int
    Content string
}

func main() {
    u := User{Name: "Alice"}
    u.Touch()               // updates UpdatedAt
    u.SoftDelete()          // sets DeletedAt
    fmt.Println(u.IsDeleted()) // true
}
```

---

## 5. Why Embedding Is Not Inheritance — The Critical Difference

```go
type Base struct{}
func (b Base) Identify() string { return "Base" }

type Derived struct{ Base }
func (d Derived) Identify() string { return "Derived" }

// In inheritance (Java): polymorphism via virtual dispatch
// In Go: NO polymorphism

func PrintIdentity(b Base) {
    fmt.Println(b.Identify())
}

d := Derived{}
// PrintIdentity(d) // COMPILE ERROR: Derived is not Base
PrintIdentity(d.Base) // must explicitly extract the Base part
```

**The key insight:** A `Derived` value cannot be used where a `Base` value is expected. There is no implicit upcasting in Go. This is a deliberate design decision — it prevents the fragile base class problem.

---

## 6. Using Interfaces for Polymorphism Instead

Since embedding doesn't give polymorphism, use interfaces:

```go
type Identifier interface {
    Identify() string
}

type Base struct{}
func (b Base) Identify() string { return "Base" }

type Derived struct{ Base }
func (d Derived) Identify() string { return "Derived" }

func PrintIdentity(id Identifier) {
    fmt.Println(id.Identify())
}

base := Base{}
derived := Derived{}
PrintIdentity(base)    // Base
PrintIdentity(derived) // Derived — polymorphism via interface
```

Embedding provides code reuse; interfaces provide polymorphism. Use both together.

---

## 7. Embedding in the Standard Library

Go's standard library uses embedding extensively:

```go
// bufio.ReadWriter embeds both:
type ReadWriter struct {
    *Reader
    *Writer
}

// http.ServeMux has no embedding, but handlers often do:
type loggingResponseWriter struct {
    http.ResponseWriter // embed to get all ResponseWriter methods
    statusCode int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
    lrw.statusCode = code
    lrw.ResponseWriter.WriteHeader(code)
}

// sync.Mutex is commonly embedded:
type SafeMap struct {
    sync.RWMutex
    data map[string]string
}

func (m *SafeMap) Get(key string) string {
    m.RLock()
    defer m.RUnlock()
    return m.data[key]
}
```

---

## 8. Embedding Interfaces: The Partial Implementation Pattern

Embedding an interface in a struct is used to create partial implementations, especially for testing.

```go
type Store interface {
    Get(id int) (*User, error)
    Create(u *User) error
    Update(u *User) error
    Delete(id int) error
    List() ([]*User, error)
}

// For a test that only needs Get, embed Store and override just Get:
type PartialStore struct {
    Store // provides all methods (but panics if called without override)
}

func (p *PartialStore) Get(id int) (*User, error) {
    return &User{ID: id, Name: "Test User"}, nil
}

func TestSomethingThatOnlyReadsUsers(t *testing.T) {
    s := &PartialStore{}
    result, _ := s.Get(1)
    // s.Create(...) would panic — safe for read-only test scenarios
}
```

---

## 9. Anti-Pattern: Embedding for Code Reuse Without IS-A Semantics

```go
// ANTI-PATTERN: embedding just to reuse HTTP client methods
type UserService struct {
    http.Client // embedding HTTP client gives us Get, Post, Do...
    BaseURL string
}

// Problem: UserService exposes irrelevant HTTP methods publicly
// Anyone can call userService.Do(req) directly
// UserService now "IS-A" HTTP Client conceptually — misleading

// BETTER: composition with named field
type UserService struct {
    client  *http.Client // private — controls access
    BaseURL string
}

func (s *UserService) GetUser(id int) (*User, error) {
    resp, err := s.client.Get(fmt.Sprintf("%s/users/%d", s.BaseURL, id))
    // ...
}
```

---

## 10. Anti-Pattern: Embedding Mutable State From Multiple Sources

```go
// ANTI-PATTERN: multiple embeddings with overlapping concerns
type Service struct {
    Cache           // has Mutex
    Database        // has Mutex
    MetricsCollector // has Mutex
}

// Problem: Lock() is now ambiguous (which mutex?)
// Problem: Three separate locks — risk of deadlock
// Problem: Internal state of embedded types exposed

// BETTER: explicit fields + facade methods
type Service struct {
    cache   *Cache
    db      *Database
    metrics *MetricsCollector
}
```

---

## 11. Anti-Pattern: Embedding to Add Methods to External Types

```go
// Can't add methods to types from other packages.
// WRONG approach: embed to add methods

import "net/http"

type MyClient struct {
    *http.Client
}

func (c *MyClient) GetJSON(url string, v interface{}) error {
    resp, err := c.Get(url)
    // ...
}

// This WORKS but is questionable — MyClient exposes all http.Client methods
// Better approach: wrap, don't embed

type HTTPClient struct {
    client *http.Client
}

func (c *HTTPClient) GetJSON(url string, v interface{}) error {
    resp, err := c.client.Get(url)
    // ...
}
// Only exposes GetJSON — clean interface
```

---

## 12. Embedding and the Go Memory Model

When a struct is embedded by value, its fields are laid out directly in the outer struct's memory. When embedded by pointer, only the pointer (8 bytes on 64-bit) is stored.

```go
type Small struct { X int }     // 8 bytes
type Large struct {
    Data [1000]byte
    Meta string
}

// By value: copies all of Large into Medium
type MediumByValue struct {
    Large // 1000 + 16 + padding bytes in Medium's layout
    ID   int
}

// By pointer: only 8 bytes for the pointer
type MediumByPointer struct {
    *Large // 8 bytes pointer
    ID    int
}

// Use by-value embedding for small, frequently copied structs
// Use by-pointer embedding for large structs or shared state
```

---

## 13. Method Promotion Rules — Full Specification

```
Given: outer struct S embeds type T

Promoted to S:
  - All exported fields of T
  - All exported methods of T (value receiver)
  - If S embeds *T: all exported methods of T (both receivers)

Shadowed:
  - Any field/method of T that has same name in S (outer wins)
  - Any field/method of T that has same name in ANOTHER embedded type (ambiguous)

Not promoted:
  - Unexported fields
  - Unexported methods
  - Methods of T if there's an ambiguity (same name in two embeds)
```

---

## 14. Evolution: Embedding Pattern Over Go Versions

| Era | Usage |
|---|---|
| Go 1.0 (2012) | Basic struct embedding introduced |
| Go 1.0 | Interface embedding for composition |
| Go 1.9 | Type aliases allow more flexible embedding scenarios |
| Go 1.18 | Generics — embedding in generic types becomes possible |

```go
// Go 1.18: embedding in generic types
type Container[T any] struct {
    Auditable
    Value T
}

type UserContainer = Container[User]     // alias
type ProductContainer = Container[Product] // alias
```

---

## 15. Alternative Approaches to Embedding

| Pattern | When to Use | Tradeoff |
|---|---|---|
| Embedding | Transparent extension, mixins | Exposes inner API |
| Named field | Controlled access | Verbose delegation |
| Interface composition | Polymorphism | More abstraction |
| Function injection | Behavior variation | Less structured |
| Generics (Go 1.18+) | Type-parameterized behavior | Complexity |

```go
// Named field with delegation (controlled access):
type Server struct {
    logger *slog.Logger
}
func (s *Server) Log(msg string) { s.logger.Info(msg) } // explicit delegation

// Function injection:
type Server struct {
    logFn func(msg string)
}
func (s *Server) Log(msg string) { s.logFn(msg) } // flexible, testable
```

---

## 16. Debugging: Finding What Methods Are Available

Use reflection to inspect the method set of a struct with embeddings:

```go
func printMethods(v interface{}) {
    t := reflect.TypeOf(v)
    fmt.Printf("Methods on %s:\n", t.Name())
    for i := 0; i < t.NumMethod(); i++ {
        m := t.Method(i)
        fmt.Printf("  %s%s\n", m.Name, m.Type.String()[len("func("):])
    }
}

type Embedded struct{}
func (Embedded) Hello() string { return "hi" }

type Outer struct {
    Embedded
    extra int
}

func main() {
    printMethods(Outer{})
    // Methods on Outer:
    //   Hello(main.Outer) string
}
```

---

## 17. Debugging: Tracing Promoted Method Calls

```go
type Storage struct {
    calls []string
}

func (s *Storage) Store(key, val string) {
    s.calls = append(s.calls, fmt.Sprintf("Store(%s=%s)", key, val))
}

type UserCache struct {
    *Storage
    userID int
}

func main() {
    s := &Storage{}
    uc := UserCache{Storage: s, userID: 42}

    uc.Store("name", "Alice") // calls s.Store via promotion
    // s.calls is modified because *Storage is shared
    fmt.Println(s.calls) // [Store(name=Alice)]
}
```

**Debugging tip:** When a promoted method has unexpected side effects, trace the actual receiver — it's the embedded instance, not the outer struct.

---

## 18. Language Comparison

| Language | Approach | Go Equivalent |
|---|---|---|
| Java | Class inheritance (`extends`) | Embedding + interfaces |
| Python | Multiple inheritance (MRO) | Multiple embedding |
| Rust | Traits + composition | Interface + embedding |
| C++ | Multiple inheritance | Multiple embedding |
| JavaScript | Prototype chain + mixins | Embedding |
| Kotlin | Data class + interfaces + delegation | Embedding with override |

Go's embedding is most similar to Rust's composition model — explicit, no hidden polymorphism, no method resolution order complexity.

---

## 19. Embedding in HTTP Middleware Pattern

```go
// Wrapping http.ResponseWriter to capture status code
type ResponseRecorder struct {
    http.ResponseWriter
    StatusCode int
    Body       bytes.Buffer
}

func NewResponseRecorder(w http.ResponseWriter) *ResponseRecorder {
    return &ResponseRecorder{
        ResponseWriter: w,
        StatusCode:     http.StatusOK,
    }
}

func (r *ResponseRecorder) WriteHeader(statusCode int) {
    r.StatusCode = statusCode
    r.ResponseWriter.WriteHeader(statusCode) // delegate
}

func (r *ResponseRecorder) Write(b []byte) (int, error) {
    r.Body.Write(b) // capture
    return r.ResponseWriter.Write(b) // delegate
}

// Middleware:
func LoggingMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rec := NewResponseRecorder(w)
        next.ServeHTTP(rec, r)
        log.Printf("%s %s → %d", r.Method, r.URL.Path, rec.StatusCode)
    })
}
```

---

## 20. JSON and Embedded Structs: Edge Cases

```go
type Inner struct {
    X int `json:"x"`
}

type Outer struct {
    Inner
    Y int `json:"y"`
}

type TaggedInner struct {
    Inner `json:"inner"` // giving a name to the embedded struct
    Y int  `json:"y"`
}

func main() {
    o := Outer{Inner: Inner{X: 1}, Y: 2}
    data, _ := json.Marshal(o)
    fmt.Println(string(data))
    // {"x":1,"y":2}  — x is at top level (promoted)

    ti := TaggedInner{Inner: Inner{X: 1}, Y: 2}
    data2, _ := json.Marshal(ti)
    fmt.Println(string(data2))
    // {"inner":{"x":1},"y":2}  — inner is nested (named)
}
```

Adding a JSON tag name to an embedded field stops promotion — it becomes a named field in the JSON output.

---

## 21. Embedding with Generics (Go 1.18+)

```go
type Base[T any] struct {
    Value T
    Meta  map[string]string
}

func (b *Base[T]) SetMeta(key, val string) {
    if b.Meta == nil {
        b.Meta = make(map[string]string)
    }
    b.Meta[key] = val
}

type UserContainer struct {
    Base[User]
    ExtraField string
}

func main() {
    uc := UserContainer{}
    uc.SetMeta("source", "api") // promoted generic method
    uc.Value = User{Name: "Alice"} // promoted generic field
}
```

---

## 22. Circular Reference via Pointer Embedding

Pointer embedding enables structures that reference each other:

```go
type Parent struct {
    Children []*Child
    Name     string
}

type Child struct {
    *Parent // pointer to parent
    Name    string
}

func main() {
    parent := &Parent{Name: "Root"}
    child1 := &Child{Parent: parent, Name: "Child1"}
    child2 := &Child{Parent: parent, Name: "Child2"}
    parent.Children = []*Child{child1, child2}

    // Access parent's name from child:
    fmt.Println(child1.Name)        // Child1 (own field)
    fmt.Println(child1.Parent.Name) // Root (explicit — not promoted: ambiguous with Child.Name)
}
```

---

## 23. Embedding Best Practices Summary

**Do:**
1. Use embedding for mixins/capabilities (Timestamps, Auditable, SoftDeletable)
2. Embed interfaces in structs for partial implementation (testing pattern)
3. Embed `sync.RWMutex` for thread-safe data structures
4. Embed `http.ResponseWriter` in wrappers to override specific methods
5. Keep embedded types focused and single-purpose

**Don't:**
1. Embed large, unrelated types — creates confusing APIs
2. Embed to simulate inheritance — use interfaces instead
3. Use embedding when a named field would be clearer
4. Embed types with overlapping field/method names
5. Forget that embedding a pointer type requires initialization

---

## 24. Testing Embedding Behavior

```go
func TestEmbeddedMethodIsPromoted(t *testing.T) {
    type Inner struct{ Value int }
    inner := Inner{Value: 42}
    type Outer struct{ Inner }
    outer := Outer{Inner: inner}

    // Test promotion
    if outer.Value != 42 {
        t.Errorf("Value not promoted: got %d", outer.Value)
    }

    // Test explicit access works too
    if outer.Inner.Value != 42 {
        t.Errorf("Explicit access failed: got %d", outer.Inner.Value)
    }
}

func TestShadowingPreferenceOuter(t *testing.T) {
    type Inner struct{ Name string }
    type Outer struct {
        Inner
        Name string // shadows Inner.Name
    }
    o := Outer{Inner: Inner{Name: "inner"}, Name: "outer"}

    if o.Name != "outer" {
        t.Errorf("Outer Name should win: got %s", o.Name)
    }
    if o.Inner.Name != "inner" {
        t.Errorf("Explicit access should give inner: got %s", o.Inner.Name)
    }
}
```

---

## 25. The `sync.Mutex` Embedding Pattern

One of the most idiomatic uses of embedding in Go:

```go
type SafeCounter struct {
    sync.Mutex // embedded: Lock/Unlock promoted
    count int
}

func (c *SafeCounter) Increment() {
    c.Lock()         // c.Mutex.Lock()
    defer c.Unlock() // c.Mutex.Unlock()
    c.count++
}

func (c *SafeCounter) Value() int {
    c.Lock()
    defer c.Unlock()
    return c.count
}

// WARNING: Don't copy SafeCounter — the mutex must not be copied!
// Use pointers: func process(c *SafeCounter)
// go vet catches this: 'assignment copies lock value to c: sync.Mutex'
```

---

## 26. Documenting Embedding Intent

Make the purpose of embedding explicit in comments:

```go
// Repository provides base database operations for all repositories.
// Embed this struct in specific repositories to get common behavior.
type Repository struct {
    db *sql.DB
}

// Find executes a SELECT query and scans a single row.
func (r *Repository) Find(query string, args ...interface{}) *sql.Row {
    return r.db.QueryRow(query, args...)
}

// UserRepository handles user-specific database operations.
// Embeds Repository for common database access patterns.
type UserRepository struct {
    Repository // embedded: provides Find, List, etc.
}

func (r *UserRepository) FindByEmail(email string) (*User, error) {
    row := r.Find("SELECT * FROM users WHERE email = $1", email) // promoted
    // ...
}
```

---

## 27. Embedding and the `go vet` Tool

`go vet` catches common embedding mistakes:

```go
// 1. Copying mutex (go vet: "lock value copied")
type Counter struct { sync.Mutex; n int }
func bad(c Counter) {} // copies mutex — go vet warns

// 2. Nil pointer embedding
type Config struct { *Logger }
c := Config{} // Logger is nil
c.Log("hi")   // panic! go vet may not catch this at compile time

// Run: go vet ./...
// Also: staticcheck ./... for more advanced analysis
```

---

## 28. Relationship to Go's Type System

Embedding creates a structural relationship, not a nominal one. This has implications:

```go
type Animal struct { Name string }
type Dog struct { Animal; Breed string }

// Type assertions with embedded types:
var d interface{} = Dog{Animal: Animal{Name: "Rex"}}

// Does d implement Animal? NO — Dog and Animal are different types
_, ok := d.(Animal) // false

// Can we get the Animal from d?
dog := d.(Dog)       // ok
animal := dog.Animal // explicit extraction
```

This is unlike inheritance where a subclass value IS-A base class value. In Go, each type is exactly what it declares.

---

## 29. Performance Implications

Embedding by value: no extra indirection, cache-friendly layout.
Embedding by pointer: one extra pointer dereference per method call.

```go
// By value — direct memory layout, cache friendly:
type ByValue struct {
    Small  // 8 bytes, laid out directly in ByValue
    Extra int
}

// By pointer — extra indirection:
type ByPointer struct {
    *Large  // 8-byte pointer, Large is elsewhere in memory
    Extra int
}

// Benchmarks typically show:
// By-value method call:   ~1 ns (no indirection)
// By-pointer method call: ~3 ns (pointer dereference, possible cache miss)
```

For frequently called methods on small embedded types, prefer value embedding.

---

## 30. Comprehensive Example: Plugin Architecture

```go
// Plugin-style architecture using embedding

type Plugin interface {
    Name() string
    Init() error
    Close() error
}

type BasePlugin struct {
    name string
}
func (p BasePlugin) Name() string   { return p.name }
func (p BasePlugin) Init() error    { return nil }
func (p BasePlugin) Close() error   { return nil }

type AuthPlugin struct {
    BasePlugin // provides Name, Init, Close
    secretKey string
}
func (p *AuthPlugin) Init() error { // overrides BasePlugin.Init
    if p.secretKey == "" {
        return errors.New("AuthPlugin: secret key required")
    }
    return nil
}

type CachePlugin struct {
    BasePlugin // provides Name, Init, Close
    maxSize int
}
// Uses BasePlugin.Init and BasePlugin.Close as-is

// Plugin manager accepts any Plugin:
type Manager struct {
    plugins []Plugin
}

func (m *Manager) Register(p Plugin) error {
    if err := p.Init(); err != nil {
        return fmt.Errorf("plugin %s init failed: %w", p.Name(), err)
    }
    m.plugins = append(m.plugins, p)
    return nil
}

func main() {
    mgr := &Manager{}
    mgr.Register(&AuthPlugin{
        BasePlugin: BasePlugin{name: "auth"},
        secretKey:  "my-secret",
    })
    mgr.Register(&CachePlugin{
        BasePlugin: BasePlugin{name: "cache"},
        maxSize:    1000,
    })
}
```
