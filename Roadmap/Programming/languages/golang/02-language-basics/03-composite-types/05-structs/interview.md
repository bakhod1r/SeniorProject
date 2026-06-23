# Structs — Interview Questions & Answers

## Junior Level Questions

---

### Q1: What is a struct in Go?

**Answer:**
A struct is a composite type that groups together named fields of different types. It's Go's primary way to define custom types that model real-world entities.

```go
type Person struct {
    Name  string
    Age   int
    Email string
}

p := Person{Name: "Alice", Age: 30, Email: "alice@example.com"}
fmt.Println(p.Name) // Alice
```

---

### Q2: What is the difference between a value receiver and a pointer receiver?

**Answer:**
- **Value receiver** (`func (p Person) Method()`): the method receives a copy of the struct. Changes inside the method do NOT affect the original.
- **Pointer receiver** (`func (p *Person) Method()`): the method receives a pointer to the struct. Changes WILL affect the original.

```go
type Counter struct{ n int }

func (c Counter) GetValue() int  { return c.n }     // read-only
func (c *Counter) Increment()    { c.n++ }           // modifies original

c := Counter{}
c.Increment()
fmt.Println(c.GetValue()) // 1
```

Use pointer receivers when:
1. The method needs to modify the struct
2. The struct is large (avoids expensive copying)

---

### Q3: What is the zero value of a struct?

**Answer:**
A struct's zero value has all fields set to their respective zero values:
- `string` → `""`
- `int/float` → `0`
- `bool` → `false`
- `*T`, slice, map, chan → `nil`

```go
type User struct {
    Name    string
    Age     int
    Active  bool
    Profile *Profile
}

var u User
fmt.Println(u.Name)    // ""
fmt.Println(u.Age)     // 0
fmt.Println(u.Active)  // false
fmt.Println(u.Profile) // <nil>
```

---

### Q4: What is the difference between exported and unexported struct fields?

**Answer:**
- **Exported (uppercase)**: visible and accessible from any package
- **Unexported (lowercase)**: only accessible within the same package

```go
package models

type User struct {
    ID       int64   // exported — visible everywhere
    Name     string  // exported
    password string  // unexported — only accessible within 'models' package
}

// From another package:
u := models.User{ID: 1, Name: "Alice"}   // OK
u := models.User{password: "secret"}    // COMPILE ERROR
```

---

### Q5: How do you create a struct literal? What's the difference between named and positional?

**Answer:**

```go
type Point struct{ X, Y int }

// Named initialization (RECOMMENDED)
p1 := Point{X: 3, Y: 4}

// Positional initialization (FRAGILE)
p2 := Point{3, 4} // must match field order exactly
```

Positional is fragile — if you add a field or reorder fields, every positional literal breaks. Always use named field syntax except for very simple well-known types like `Point`.

---

### Q6: Can structs be compared with `==`?

**Answer:**
Yes, but only if all fields are comparable. Comparable types include: numbers, strings, booleans, arrays, and pointers.

Non-comparable: slices, maps, functions.

```go
type Point struct{ X, Y int }
p1 := Point{1, 2}
p2 := Point{1, 2}
fmt.Println(p1 == p2) // true

type WithSlice struct{ Items []int }
// ws1 := WithSlice{Items: []int{1}}
// ws1 == ws2  // COMPILE ERROR: struct containing []int cannot be compared
```

---

### Q7: What is struct embedding?

**Answer:**
Struct embedding is when you include one struct type inside another as an anonymous field. The embedded type's fields and methods are "promoted" — accessible directly on the outer struct.

```go
type Animal struct{ Name string }
func (a Animal) Breathe() string { return a.Name + " breathes" }

type Dog struct {
    Animal        // embedded — promotes Name and Breathe()
    Breed  string
}

dog := Dog{Animal: Animal{Name: "Rex"}, Breed: "Husky"}
fmt.Println(dog.Name)    // "Rex" — promoted field
fmt.Println(dog.Breathe()) // "Rex breathes" — promoted method
```

---

## Middle Level Questions

---

### Q8: What is a struct tag and how is it used?

**Answer:**
A struct tag is a string literal after a field declaration that provides metadata for reflection-based frameworks. Common uses: JSON serialization, database column mapping, validation.

```go
type User struct {
    ID       int64  `json:"id"         db:"user_id"`
    Name     string `json:"name"       db:"full_name"`
    Password string `json:"-"          db:"-"`          // always omit
    IsAdmin  bool   `json:"is_admin"   db:"is_admin"`
}
```

Tag format: `` `key:"value" key2:"value2"` ``

Common tag keys:
- `json:"name,omitempty"` — JSON field name and omit-if-zero behavior
- `db:"column_name"` — SQL column name
- `validate:"required,email"` — validation rules
- `yaml:"name"` — YAML serialization

---

### Q9: What are the rules for method sets in Go?

**Answer:**
- The method set of `T` contains all methods with value receiver `T`
- The method set of `*T` contains all methods with value receiver `T` AND pointer receiver `*T`

This matters for interface satisfaction:

```go
type Doer interface{ Do() }

type T struct{}
func (t T) Do()  {}  // value receiver

type P struct{}
func (p *P) Do() {} // pointer receiver

var _ Doer = T{}   // OK — T's method set has Do()
var _ Doer = &T{}  // OK — *T's method set has Do()
var _ Doer = P{}   // COMPILE ERROR — P's method set is empty!
var _ Doer = &P{}  // OK — *P's method set has Do()
```

---

### Q10: What is the functional options pattern?

**Answer:**
Functional options is a pattern for configuring a struct with optional parameters, using functions that modify the struct:

```go
type Server struct {
    host    string
    port    int
    timeout time.Duration
}

type Option func(*Server)

func WithPort(port int) Option {
    return func(s *Server) { s.port = port }
}

func WithTimeout(d time.Duration) Option {
    return func(s *Server) { s.timeout = d }
}

func NewServer(host string, opts ...Option) *Server {
    s := &Server{host: host, port: 8080, timeout: 30 * time.Second}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage:
srv := NewServer("localhost", WithPort(9090), WithTimeout(60*time.Second))
```

**Advantages**: backward compatible (add options without changing the signature), self-documenting, allows defaults.

---

### Q11: How does Go handle copying of structs containing maps or slices?

**Answer:**
Struct assignment copies the struct's fields by value. For slices and maps, this means the header/descriptor is copied, but the underlying data is NOT copied — the copy and original share the same backing array/hash table.

```go
type Config struct {
    Labels map[string]string
}

c1 := Config{Labels: map[string]string{"env": "prod"}}
c2 := c1 // copy — c2.Labels points to SAME map as c1.Labels!

c2.Labels["env"] = "dev" // modifies the shared map!
fmt.Println(c1.Labels["env"]) // "dev" — c1 is also affected!

// Fix: deep copy
c3 := Config{Labels: make(map[string]string, len(c1.Labels))}
for k, v := range c1.Labels {
    c3.Labels[k] = v
}
```

---

### Q12: What is a compile-time interface check and why use it?

**Answer:**
A compile-time interface check is a blank variable assignment that forces the compiler to verify interface satisfaction:

```go
// Ensures *FileStore implements Store at compile time
var _ Store = (*FileStore)(nil)

// If FileStore is missing a method, this line produces a clear compile error:
// cannot use (*FileStore)(nil) (type *FileStore) as type Store:
//     missing method Write
```

**Why**: Without it, you only discover interface mismatch at runtime (panic) or when you actually pass a `*FileStore` to a `Store` parameter. The compile-time check gives early, clear error messages and serves as documentation.

---

### Q13: Can you embed a pointer to a struct?

**Answer:**
Yes. `type B struct { *A }` embeds a pointer to `A`. Methods of `*A` are promoted to `B`. But `b.A` must be initialized — a nil embedded pointer causes panics on access.

```go
type A struct{ X int }
func (a *A) Double() int { return a.X * 2 }

type B struct{ *A }

b := B{A: &A{X: 5}}
fmt.Println(b.X)       // 5 — promoted through pointer
fmt.Println(b.Double()) // 10 — promoted method

var bNil B // b.A is nil
// bNil.Double() // PANIC: nil pointer dereference
```

---

## Senior Level Questions

---

### Q14: Explain struct memory alignment in Go. Why does it matter?

**Answer:**
Go (and most CPUs) require data to be aligned to its natural size: an `int32` must be at an offset divisible by 4, `int64` by 8, etc. When fields are not naturally aligned, the compiler inserts padding bytes.

```go
// Wasteful: 24 bytes (7+7 bytes padding)
type Bad struct {
    A bool   // 1 byte, then 7 padding
    B int64  // 8 bytes
    C bool   // 1 byte, then 7 padding
}

// Optimal: 16 bytes
type Good struct {
    B int64  // 8 bytes (offset 0)
    A bool   // 1 byte (offset 8)
    C bool   // 1 byte (offset 9) + 6 padding
}
```

**Why it matters**:
- Memory waste: `Bad` uses 24 bytes vs `Good`'s 16 — 33% savings
- Cache efficiency: smaller structs fit in cache lines better
- Atomic operations: `int64` at wrong alignment causes crashes on 32-bit ARM
- For arrays of structs, savings multiply by array length

---

### Q15: What is the typed nil interface trap? How does it relate to structs?

**Answer:**
An interface value is only `nil` when both its type and value pointers are nil. Returning a typed nil (concrete nil pointer as an interface) creates a non-nil interface, which causes bugs:

```go
type DBError struct{ msg string }
func (e *DBError) Error() string { return e.msg }

func mayFail(fail bool) error {
    var e *DBError // typed nil pointer
    if fail {
        e = &DBError{"db down"}
    }
    return e // ALWAYS returns non-nil interface! Even when fail=false
}

err := mayFail(false)
fmt.Println(err == nil)  // FALSE — interface has type *DBError
fmt.Println(err)         // <nil> — but it prints nil!
if err != nil {
    panic("unexpected error!") // THIS RUNS even though there's no error!
}
```

**Fix**: always return untyped nil at interface boundaries:
```go
func mayFail(fail bool) error {
    if fail {
        return &DBError{"db down"}
    }
    return nil // returns nil interface
}
```

---

### Q16: When is it unsafe to copy a struct?

**Answer:**
It's unsafe to copy a struct that contains:
1. `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Cond` — copying their internal state causes undefined behavior
2. Channels that have specific ownership semantics
3. Any type documented as "must not be copied after first use"

```go
type Safe struct {
    mu   sync.Mutex
    data map[string]int
}

s1 := Safe{data: make(map[string]int)}
s2 := s1 // WRONG: copies the Mutex state!
// go vet reports: assignment copies lock value

// Always use pointer for such structs:
sp := &Safe{data: make(map[string]int)}
```

Go's `go vet` with the `copylocks` analyzer detects these cases.

---

### Q17: What happens to a struct's fields during garbage collection?

**Answer:**
The GC uses a per-type bitmap (stored in `_type.gcdata`) to determine which words in a struct contain pointers that need tracing.

- Fields with **no pointers** (int, float, bool, [N]byte): the GC skips them — zero overhead
- Fields with **pointers** (string, slice, map, chan, *T, interface{}): the GC traces them to find referenced objects

Implication: a struct like `type Event struct { Timestamp int64; UserID int64 }` causes zero GC scanning overhead — even in a slice of millions. A struct with a map field causes GC to scan every element.

Design implication: for large data sets in performance-critical code, prefer pointer-free structs to reduce GC pressure.

---

### Q18: How do generic structs (Go 1.18+) change the landscape?

**Answer:**
Generic structs allow type parameters, enabling reusable data structures with full type safety:

```go
// Before generics: had to use interface{} and lose type safety
type Pair struct{ First, Second interface{} }

// With generics: type-safe, no boxing for value types
type Pair[T, U any] struct{ First T; Second U }

pair := Pair[string, int]{First: "hello", Second: 42}
fmt.Println(pair.First)  // string — no type assertion needed
fmt.Println(pair.Second) // int — no boxing!
```

Key benefits:
- No `interface{}` boxing → no heap allocation for primitive types
- Compile-time type checking
- No runtime type assertions needed
- Code reuse without code generation

---

## Scenario Questions

---

### Q19: Code review scenario

```go
type UserService struct {
    db *sql.DB
    cache map[string]*User
}

func NewUserService(db *sql.DB) UserService { // returns value, not pointer
    return UserService{db: db, cache: make(map[string]*User)}
}

func (s UserService) GetUser(id string) (*User, error) {
    if u, ok := s.cache[id]; ok {
        return u, nil
    }
    // fetch from db...
    return nil, nil
}
```

**What's wrong? How would you fix it?**

**Answer:** Three problems:
1. `NewUserService` returns a value — every assignment copies the struct including the `cache` map header. Two copies of UserService share the same underlying cache map (unexpected aliasing).
2. `GetUser` uses a value receiver — it receives a copy, but the map header in the copy still points to the same underlying map. Works by accident, but is misleading.
3. `sync.RWMutex` is missing — concurrent access to `cache` will panic.

Fixed:
```go
type UserService struct {
    db    *sql.DB
    mu    sync.RWMutex
    cache map[string]*User
}

func NewUserService(db *sql.DB) *UserService { // return pointer!
    return &UserService{db: db, cache: make(map[string]*User)}
}

func (s *UserService) GetUser(id string) (*User, error) { // pointer receiver
    s.mu.RLock()
    if u, ok := s.cache[id]; ok {
        s.mu.RUnlock()
        return u, nil
    }
    s.mu.RUnlock()
    // fetch from db...
    return nil, nil
}
```

---

### Q20: Design question

**Design a struct hierarchy for a payment system that handles Credit Cards, Bank Transfers, and Crypto payments. What would your struct and interface design look like?**

**Answer:**

```go
// Core domain types (value objects)
type Money struct {
    Amount   int64
    Currency string
}

type PaymentID string
type UserID   int64

// Base payment data
type PaymentBase struct {
    ID          PaymentID
    Amount      Money
    UserID      UserID
    CreatedAt   time.Time
    Description string
}

// Concrete payment methods
type CreditCardPayment struct {
    PaymentBase
    Last4      string
    CardBrand  string
    ExpiryYear int
}

type BankTransfer struct {
    PaymentBase
    BankName      string
    AccountSuffix string
    RoutingNumber string
}

type CryptoPayment struct {
    PaymentBase
    Network     string // "ETH", "BTC"
    TxHash      string
    WalletAddr  string
}

// Interface — only what callers need
type Payment interface {
    ID()          PaymentID
    Total()       Money
    Description() string
    Status()      PaymentStatus
}

// Methods on base type (promoted)
func (p PaymentBase) ID()          PaymentID { return p.ID }
func (p PaymentBase) Total()       Money     { return p.Amount }
func (p PaymentBase) Description() string    { return p.Description }

// Specific capabilities
type Refundable interface {
    Refund(amount Money) error
}

type Voidable interface {
    Void() error
}
```

---

## FAQ

### FAQ1: Should I always return `*T` from constructors?

Not always. Return `*T` when:
- The struct contains a mutex or other synchronization primitive
- The struct is large and copies would be expensive
- The struct needs to be shared across goroutines

Return `T` (value) when:
- The struct is small and cheap to copy
- The struct is immutable (no pointer receivers)
- You want value semantics (copies are intentional and safe)

Example of value return: `func NewPoint(x, y int) Point { return Point{x, y} }`

### FAQ2: What's the difference between `new(T)` and `&T{}`?

Both return `*T` with zero-initialized struct. They're equivalent:
```go
p1 := new(Person)  // *Person with zero fields
p2 := &Person{}    // identical result

// &T{field: val} is more common — allows initialization
p3 := &Person{Name: "Alice"} // initialized
```

### FAQ3: Can a struct implement multiple interfaces?

Yes — in Go, interface satisfaction is implicit. A struct can implement as many interfaces as its method set satisfies:
```go
type Buffer struct { bytes.Buffer }

var _ io.Reader    = (*Buffer)(nil) // OK
var _ io.Writer    = (*Buffer)(nil) // OK
var _ io.ReadWriter = (*Buffer)(nil) // OK — both
var _ fmt.Stringer = (*Buffer)(nil) // OK — if Buffer has String()
```

### FAQ4: When should I use anonymous structs?

Use anonymous structs for:
1. Test table rows: `tests := []struct{ input int; want int }{ ... }`
2. One-time local grouping: `config := struct{ Host string; Port int }{"localhost", 8080}`
3. JSON decoding where you only need the struct once
4. Returning multiple related values without defining a named type

### FAQ5: What's the `omitempty` tag and when does it apply?

`json:",omitempty"` omits the field from JSON output if the value is the zero value for its type:
- `""` for string, `0` for numbers, `false` for bool, `nil` for pointers/slices/maps

**Gotcha**: `omitempty` on `bool` always omits `false`; on `int` always omits `0`. If you need to distinguish "not set" from "set to false/0", use a pointer:
```go
type Flags struct {
    Debug   *bool `json:",omitempty"` // nil = absent, &false = explicitly false
    MaxConn *int  `json:",omitempty"` // nil = absent, &0 = explicitly 0
}
```
