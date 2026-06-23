# Embedding Structs — Interview Q&A

## Junior Level Questions

---

**Q1: What is struct embedding in Go?**

Struct embedding is including one struct type inside another without giving it a field name. The embedded struct's fields and methods become directly accessible on the outer struct — this is called promotion.

```go
type Animal struct { Name string }
type Dog struct {
    Animal // embedded — no name!
    Breed string
}

d := Dog{Animal: Animal{Name: "Rex"}, Breed: "Lab"}
fmt.Println(d.Name) // Rex — promoted from Animal
```

---

**Q2: What is the difference between embedding and a named field?**

With embedding, the embedded type's fields and methods are **promoted** (accessible directly on the outer struct). With a named field, you must use the field name to access them.

```go
// Embedding (promotes):
type Employee struct { Person; Dept string }
e.Name  // works — promoted

// Named field (no promotion):
type Employee2 struct { person Person; Dept string }
e2.Name       // ERROR
e2.person.Name // must be explicit
```

---

**Q3: How do you initialize an embedded struct?**

Use the embedded type's name as the key in the struct literal:

```go
type Dog struct {
    Animal
    Breed string
}

d := Dog{
    Animal: Animal{Name: "Buddy"},
    Breed:  "Golden Retriever",
}
```

---

**Q4: Can a method be promoted from an embedded struct?**

Yes. Methods of the embedded struct are promoted to the outer struct.

```go
type Animal struct{ Name string }
func (a Animal) Speak() string { return a.Name + " barks" }

type Dog struct{ Animal }

d := Dog{Animal: Animal{Name: "Rex"}}
fmt.Println(d.Speak()) // Rex barks — promoted method
```

---

**Q5: What happens when the outer struct has a field/method with the same name as the embedded struct?**

The outer struct's field or method **shadows** (takes priority over) the embedded one. You can still access the embedded version explicitly.

```go
type Base struct{}
func (b Base) Name() string { return "Base" }

type Child struct{ Base }
func (c Child) Name() string { return "Child" } // shadows Base.Name

c := Child{}
fmt.Println(c.Name())       // Child
fmt.Println(c.Base.Name())  // Base
```

---

**Q6: Can you embed multiple structs?**

Yes. A struct can embed multiple types at once.

```go
type Swimmer struct{}
func (s Swimmer) Swim() {}

type Runner struct{}
func (r Runner) Run() {}

type Triathlete struct {
    Swimmer
    Runner
    Name string
}

t := Triathlete{}
t.Swim() // from Swimmer
t.Run()  // from Runner
```

---

**Q7: Is Go embedding the same as inheritance?**

No. Embedding is composition, not inheritance. Key differences:
- Embedded type's methods are promoted but there is no polymorphism
- A `Dog` cannot be used where an `Animal` is expected (no implicit "upcasting")
- Go uses interfaces for polymorphism

---

**Q8: What happens when two embedded types have the same field name?**

Accessing that field directly becomes ambiguous — you must use explicit access.

```go
type A struct{ Value int }
type B struct{ Value int }
type C struct{ A; B }

c := C{}
// c.Value   // ERROR: ambiguous selector
c.A.Value = 1 // explicit
c.B.Value = 2 // explicit
```

---

## Middle Level Questions

---

**Q9: Explain how method promotion works with pointer receivers.**

When embedding by value (`struct{ T }`):
- Methods with value receiver of T are promoted to both T and *T of the outer struct
- Methods with pointer receiver of *T are ONLY promoted to *T of the outer struct (not to T)

When embedding by pointer (`struct{ *T }`):
- All methods (both value and pointer receivers) are promoted to both outer T and *T

```go
type A struct{}
func (a A)  ValueMethod() {}
func (a *A) PtrMethod()   {}

type ByValue   struct{ A  }
type ByPointer struct{ *A }

// *ByValue satisfies interface with PtrMethod — yes
// ByValue  satisfies interface with PtrMethod — NO (value type, can't get *A)

// *ByPointer satisfies interface with PtrMethod — yes
// ByPointer  satisfies interface with PtrMethod — yes (embedding *A gives both)
```

---

**Q10: What is the "mixin" pattern and how does embedding enable it?**

A mixin is a reusable struct fragment that provides common behavior. Embedding lets you add capabilities to any struct without code duplication.

```go
type Timestamps struct {
    CreatedAt time.Time
    UpdatedAt time.Time
}
func (t *Timestamps) Touch() { t.UpdatedAt = time.Now() }

type User  struct { Timestamps; Name string }
type Order struct { Timestamps; Total float64 }

user.Touch()  // promoted from Timestamps
order.Touch() // promoted from Timestamps
```

---

**Q11: How does embedding affect JSON marshaling?**

Embedded struct fields are "inlined" — they appear at the same JSON level as the outer struct's fields.

```go
type Timestamps struct {
    CreatedAt time.Time `json:"created_at"`
}
type User struct {
    Name string `json:"name"`
    Timestamps  // fields inlined in JSON
}
// JSON: {"name":"Alice","created_at":"2024-..."}
// NOT: {"name":"Alice","timestamps":{"created_at":"..."}}
```

If you want nesting, give the embedded field a name in a JSON tag:
```go
type User struct {
    Name string `json:"name"`
    Timestamps `json:"timestamps"` // now nested
}
```

---

**Q12: What is the partial implementation pattern with interface embedding?**

Embedding an interface in a struct allows you to provide only some of the interface's methods, letting the embedded interface value provide the rest. Commonly used for test doubles.

```go
type Store interface {
    Get(id int) (*User, error)
    Create(*User) error
    Delete(id int) error
}

// Test stub: only implements Get
type ReadOnlyStub struct {
    Store // embedded interface: other methods would panic if called
}
func (s *ReadOnlyStub) Get(id int) (*User, error) {
    return &User{ID: id}, nil
}

// Satisfies Store interface
var _ Store = &ReadOnlyStub{}
```

---

**Q13: Why should you be careful about copying structs with embedded `sync.Mutex`?**

`sync.Mutex` must not be copied after first use — the lock state is stored inside the struct. Copying the struct copies the lock state, creating two independent mutexes with potentially inconsistent state.

```go
type SafeMap struct {
    sync.Mutex
    data map[string]string
}

func bad(m SafeMap) {} // copies mutex — go vet warns: "lock value copied"
func good(m *SafeMap) {} // pointer — no copy
```

`go vet` catches this with the `copylocks` analysis.

---

**Q14: Can you embed an interface in a struct? What happens?**

Yes. The interface becomes a field of the struct. The struct satisfies the interface if the embedded interface field is non-nil.

```go
type Stringer interface { String() string }

type Widget struct {
    Stringer // embedded interface
    ID int
}

w := Widget{
    Stringer: fmt.Stringer(nil), // must set a concrete value!
    ID: 1,
}
```

If `Stringer` is nil and you call `w.String()`, you get a nil pointer panic.

---

**Q15: When would you use pointer embedding (`*Inner`) vs value embedding (`Inner`)?**

Use **value embedding** when:
- The embedded struct is small (few fields)
- You want automatic zero initialization
- The outer struct owns the embedded struct

Use **pointer embedding** when:
- The embedded struct is large
- The embedded struct is shared between multiple outer structs
- You need nil to mean "not set"
- You're embedding something with an important zero value (like `http.Client`)

---

## Senior Level Questions

---

**Q16: How does the compiler resolve promoted methods — what algorithm does it use?**

The compiler uses a breadth-first search (BFS) through embedding levels:

1. Scan direct fields of the type first (depth 0)
2. Scan fields of embedded types (depth 1)
3. Continue recursively...

If exactly one match is found at the minimum depth, that's the result. If multiple matches at the same minimum depth exist, the selector is ambiguous (compile error).

This is why outer fields shadow inner ones — depth 0 always wins over depth 1.

---

**Q17: What is the overhead of calling a promoted method vs calling the embedded type's method directly?**

For methods that can be inlined by the compiler, there is **zero overhead** — the compiler generates a wrapper method but inlines it at the call site.

For non-inlinable methods (large methods), there's one extra function call for the wrapper:
```
direct: caller → Animal.Speak
promoted: caller → Dog.Speak (wrapper) → Animal.Speak
```

The wrapper is still faster than interface dispatch (no itab lookup), so promotion has negligible cost in practice.

---

**Q18: Describe the memory layout of a struct with an embedded value type. What is special about the first embedded field?**

When a struct is embedded by value, its fields are laid out directly in the outer struct's memory. If the embedded struct is the **first field** (or the only anonymous field at offset 0), then `&outer` and `&outer.Embedded` have the **same address**.

This is leveraged in:
- CGo interop (casting between types)
- Plugin systems (type-punning for plugin APIs)
- Some lock-free algorithms

```go
type Header struct{ Magic uint32 }
type Packet struct{ Header; Data []byte }

p := Packet{Header: Header{Magic: 0xDEAD}}
// unsafe.Pointer(&p) == unsafe.Pointer(&p.Header)
```

---

**Q19: How would you design a composable middleware system using embedding?**

```go
type Handler interface {
    Handle(ctx context.Context, r *Request) *Response
}

// Each middleware embeds Handler to delegate unknown methods:
type LoggingMiddleware struct {
    Handler
    logger *slog.Logger
}

func (m *LoggingMiddleware) Handle(ctx context.Context, r *Request) *Response {
    m.logger.Info("request", "path", r.Path)
    resp := m.Handler.Handle(ctx, r) // delegate
    m.logger.Info("response", "status", resp.Status)
    return resp
}

// Compose with a builder:
func Wrap(h Handler, middlewares ...func(Handler) Handler) Handler {
    for i := len(middlewares) - 1; i >= 0; i-- {
        h = middlewares[i](h)
    }
    return h
}
```

---

**Q20: What is the `noCopy` pattern and how does it work with `go vet`?**

`noCopy` is a zero-size struct with `Lock()` and `Unlock()` methods. When embedded in a struct, `go vet`'s `copylocks` analyzer detects that the outer struct contains a "locker" type and warns whenever it's copied.

```go
type noCopy struct{}
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Worker struct {
    noCopy noCopy // sentinel field
    sync.WaitGroup
    running bool
}

// go vet reports: "assignment copies lock value to x: sync.Mutex, main.noCopy"
```

---

## Scenario-Based Questions

---

**Q21: You have a `BaseRepository` with common methods. Multiple specific repositories need these methods. How would you design this with embedding?**

```go
type BaseRepository struct {
    db  *sql.DB
    log *slog.Logger
}

func (r *BaseRepository) Exec(ctx context.Context, q string, args ...interface{}) error {
    _, err := r.db.ExecContext(ctx, q, args...)
    return err
}

func (r *BaseRepository) Count(ctx context.Context, table string) (int, error) {
    var n int
    return n, r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&n)
}

type UserRepo struct {
    BaseRepository // promoted: Exec, Count, db, log
}

func (r *UserRepo) FindByEmail(ctx context.Context, email string) (*User, error) {
    row := r.db.QueryRowContext(ctx, "SELECT * FROM users WHERE email=$1", email)
    // ...
}
```

---

**Q22: An `http.Handler` needs to log the response status code after writing. How do you implement this without modifying the handler's code?**

```go
type statusRecorder struct {
    http.ResponseWriter
    status int
}

func (r *statusRecorder) WriteHeader(code int) {
    r.status = code
    r.ResponseWriter.WriteHeader(code)
}

func LoggingMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        rec := &statusRecorder{ResponseWriter: w, status: 200}
        next.ServeHTTP(rec, r)
        logger.Info("request", "status", rec.status, "path", r.URL.Path)
    })
}
```

---

**Q23: You're asked to write a test that needs only the `Read` method of a large `Store` interface. How do you use embedding to simplify the mock?**

```go
type Store interface {
    Get(id string) (*Item, error)
    Create(*Item) error
    Update(*Item) error
    Delete(id string) error
    List(filter Filter) ([]*Item, error)
}

// Stub: only implements the one method we need
type GetOnlyStub struct {
    Store   // panic for any method except Get
    items map[string]*Item
}

func (s *GetOnlyStub) Get(id string) (*Item, error) {
    item, ok := s.items[id]
    if !ok {
        return nil, ErrNotFound
    }
    return item, nil
}

func TestHandler(t *testing.T) {
    stub := &GetOnlyStub{
        items: map[string]*Item{"1": {ID: "1", Name: "test"}},
    }
    handler := NewHandler(stub)
    // test that handler correctly reads items
}
```

---

## FAQ

---

**Q24: Can I embed a struct from another package?**

Yes. Embedding follows normal export rules — you can embed any exported struct type from any package.

```go
import "sync"

type MyMap struct {
    sync.RWMutex    // from sync package
    data map[string]string
}
```

---

**Q25: Does embedding affect the zero value of a struct?**

Value embedding: the embedded struct takes its zero value automatically — safe to use without initialization.
Pointer embedding: the pointer is `nil` — you must initialize it before calling methods.

---

**Q26: What is the difference between embedding an interface and implementing it?**

- **Implementing:** You write methods that match the interface signature. The type satisfies the interface via its own methods.
- **Embedding:** You include the interface type as a field. The struct has a slot to hold a concrete implementation. Any methods not explicitly defined on the struct are delegated to the interface value in that slot.

Embedding is primarily used for partial implementations (test doubles), not as the primary implementation strategy.

---

**Q27: How do embedded structs interact with `errors.As` and `errors.Is`?**

`errors.As` walks the error chain and checks if any error in the chain is assignable to the target type. Embedding an error type creates a chain that `errors.As` can traverse.

```go
type ValidationError struct {
    Field string
}
func (e *ValidationError) Error() string { return "validation: " + e.Field }

type HTTPError struct {
    *ValidationError
    Code int
}
func (e *HTTPError) Error() string { return fmt.Sprintf("%d: %s", e.Code, e.ValidationError.Error()) }

err := &HTTPError{ValidationError: &ValidationError{Field: "email"}, Code: 400}

var ve *ValidationError
errors.As(err, &ve) // finds ValidationError inside HTTPError
fmt.Println(ve.Field) // email
```

---

**Q28: Can you embed a type alias?**

Yes, type aliases are transparent — embedding an alias is equivalent to embedding the underlying type.

```go
type MyString = string // alias
type Config struct {
    MyString // embeds string — promoted Value method (if any)
}
```

But note: you can't add methods to built-in types, so embedding a `string` alias is unusual. Custom type definitions (not aliases) are more common for embedding.
