# Methods vs Functions — Tasks

## Exercise structure

- 🟢 **Easy** — for beginners
- 🟡 **Medium** — middle level
- 🔴 **Hard** — senior level
- 🟣 **Expert** — professional level

A solution for each exercise is provided at the end.

---

## Easy 🟢

### Task 1 — Your first method
Create a `Rectangle` struct and add an `Area()` method.

```go
type Rectangle struct {
    Width, Height float64
}

// Write: func (r Rectangle) Area() float64
```

### Task 2 — Constructor function
Write `NewRectangle(w, h float64) Rectangle`.

### Task 3 — Method on a nilable receiver
Create a `Logger` type whose `Log(msg string)` method does nothing when the receiver is `nil`.

```go
type Logger struct{ prefix string }
// Write
```

### Task 4 — Value vs pointer receiver
For `Counter`, write `Inc()` (pointer receiver) and `Value() int` (value receiver).

### Task 5 — String() method
Add `String() string` to the `Color` type:

```go
type Color int
const ( Red Color = iota; Green; Blue )
// Write — fmt.Println(Red) → "red"
```

---

## Medium 🟡

### Task 6 — Method on a slice type
Define `type Words []string` and add a `Join(sep string) string` method.

### Task 7 — Method on a function type
Define `type Handler func(int) int` and add `Pipe(other Handler) Handler` — composition.

### Task 8 — Map of methods
Create a Calculator with `Add`, `Sub`, `Mul`, `Div` methods. Dispatch the appropriate method based on an `op string` argument provided by the user.

### Task 9 — Embedding and promotion
`Animal` (Name string, `Speak() string`) and `Dog` (embeds Animal). For Dog, `Speak()` should return "Woof!" (override).

### Task 10 — Method chain
Build a `Pipeline`:

```go
p := NewPipeline().
    Add(double).
    Add(square).
    Run(3)
// p == 36 (3 → 6 → 36)
```

### Task 11 — Callback via method value
A `Worker` struct with a `Run(callback func())` method. Pass another Worker's `OnDone()` method as the callback.

### Task 12 — Choosing a receiver
Add `Append(data []byte)` to `Buffer` (a 1MB byte slice). Pick a pointer receiver and explain why in a comment.

---

## Hard 🔴

### Task 13 — Builder with validation
Create a `UserBuilder`:
- Setter methods `Name(s string)`, `Age(n int)`, `Email(e string)`
- `Build() (User, error)` — return an error when any required field is missing

### Task 14 — Decorator pattern
A `Repo` interface (`Find(id string)`). Write a `LoggingRepo` decorator that logs every Find call.

### Task 15 — Functional options
Configure a `Server` with the functional options pattern:

```go
s := NewServer(
    WithPort(8080),
    WithTimeout(5*time.Second),
    WithTLS(certFile, keyFile),
)
```

### Task 16 — Method expression dispatch table
Implement the following task using method expressions:

```go
type Shape struct{}
func (Shape) Area(...) float64
func (Shape) Perimeter(...) float64
// Dispatch based on op string — without if statements
```

### Task 17 — Concurrent counter
Write `AtomicCounter` — using `atomic.Int64` for lock-free inc/value.

### Task 18 — Repository + Decorator
A `UserRepo` interface, `pgUserRepo` (mock SQL), and `cachingUserRepo` (in-memory cache wrapper). On a cache miss the user request reaches pg.

---

## Expert 🟣

### Task 19 — Generic List with methods
`type List[T any] struct{ items []T }` — `Add`, `Get`, `Len`, and `Map` (also explain why Map must live at the package level).

### Task 20 — DDD aggregate
`Order` aggregate root:
- `AddItem(p Product, qty int) error`
- `Submit() error`
- `MarkPaid() error`
- State machine — Draft → Submitted → Paid
- `PullEvents() []Event`

### Task 21 — Method dispatch via a plugin system
Build a small plugin system that dispatches via method expressions, without runtime plugin loading.

### Task 22 — Context-aware methods
Write a Service struct where every method accepts a `context.Context` and respects cancellation.

---

## Solutions

### Solution 1

```go
type Rectangle struct{ Width, Height float64 }
func (r Rectangle) Area() float64 { return r.Width * r.Height }
```

### Solution 2

```go
func NewRectangle(w, h float64) Rectangle {
    return Rectangle{Width: w, Height: h}
}
```

### Solution 3

```go
type Logger struct{ prefix string }
func (l *Logger) Log(msg string) {
    if l == nil { return }
    fmt.Println(l.prefix, msg)
}
```

### Solution 4

```go
type Counter struct{ n int }
func (c *Counter) Inc()        { c.n++ }
func (c Counter)  Value() int  { return c.n }
```

### Solution 5

```go
type Color int
const ( Red Color = iota; Green; Blue )

func (c Color) String() string {
    switch c {
    case Red:   return "red"
    case Green: return "green"
    case Blue:  return "blue"
    }
    return "unknown"
}
```

### Solution 6

```go
type Words []string
func (w Words) Join(sep string) string {
    return strings.Join(w, sep)
}
```

### Solution 7

```go
type Handler func(int) int
func (h Handler) Pipe(other Handler) Handler {
    return func(x int) int { return other(h(x)) }
}
```

### Solution 8

```go
type Calculator struct{}
func (Calculator) Add(a, b int) int { return a+b }
func (Calculator) Sub(a, b int) int { return a-b }
func (Calculator) Mul(a, b int) int { return a*b }
func (Calculator) Div(a, b int) int { return a/b }

var ops = map[string]func(Calculator, int, int) int{
    "+": Calculator.Add, "-": Calculator.Sub,
    "*": Calculator.Mul, "/": Calculator.Div,
}

func Apply(op string, a, b int) int {
    return ops[op](Calculator{}, a, b)
}
```

### Solution 9

```go
type Animal struct{ Name string }
func (a Animal) Speak() string { return "..." }

type Dog struct{ Animal }
func (d Dog) Speak() string { return "Woof!" }
```

### Solution 10

```go
type Pipeline struct{ ops []func(int) int }

func NewPipeline() *Pipeline { return &Pipeline{} }
func (p *Pipeline) Add(op func(int) int) *Pipeline {
    p.ops = append(p.ops, op)
    return p
}
func (p *Pipeline) Run(x int) int {
    for _, op := range p.ops { x = op(x) }
    return x
}
```

### Solution 11

```go
type Worker struct{ name string }
func (w Worker) OnDone()                 { fmt.Println(w.name, "done") }
func (w Worker) Run(cb func())           { cb() }

a, b := Worker{"a"}, Worker{"b"}
a.Run(b.OnDone)  // callback via method value
```

### Solution 12

```go
type Buffer struct{ data [1 << 20]byte; n int }

// Pointer receiver — Buffer is 1MB; copying it on every call is expensive
// Mutation: the n field changes
func (b *Buffer) Append(data []byte) {
    copy(b.data[b.n:], data)
    b.n += len(data)
}
```

### Solution 13

```go
type UserBuilder struct{ user User }

func (b *UserBuilder) Name(s string)   *UserBuilder { b.user.Name = s; return b }
func (b *UserBuilder) Age(n int)       *UserBuilder { b.user.Age = n; return b }
func (b *UserBuilder) Email(e string)  *UserBuilder { b.user.Email = e; return b }

func (b *UserBuilder) Build() (User, error) {
    if b.user.Name == "" { return User{}, errors.New("name required") }
    if b.user.Email == "" { return User{}, errors.New("email required") }
    return b.user, nil
}
```

### Solution 14

```go
type Repo interface { Find(id string) (string, error) }

type pgRepo struct{}
func (p *pgRepo) Find(id string) (string, error) { return "user_" + id, nil }

type LoggingRepo struct{ inner Repo }
func (l *LoggingRepo) Find(id string) (string, error) {
    log.Println("find:", id)
    return l.inner.Find(id)
}
```

### Solution 15

```go
type Server struct {
    port    int
    timeout time.Duration
    cert    string
    key     string
}

type Option func(*Server)

func WithPort(p int) Option         { return func(s *Server) { s.port = p } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }
func WithTLS(cert, key string) Option {
    return func(s *Server) { s.cert = cert; s.key = key }
}

func NewServer(opts ...Option) *Server {
    s := &Server{port: 80, timeout: 30*time.Second}
    for _, opt := range opts { opt(s) }
    return s
}
```

### Solution 16

```go
type Shape struct{ Width, Height float64 }
func (s Shape) Area() float64      { return s.Width * s.Height }
func (s Shape) Perimeter() float64 { return 2*(s.Width+s.Height) }

var dispatch = map[string]func(Shape) float64{
    "area":      Shape.Area,
    "perimeter": Shape.Perimeter,
}

func Compute(s Shape, op string) float64 { return dispatch[op](s) }
```

### Solution 17

```go
import "sync/atomic"

type AtomicCounter struct{ n atomic.Int64 }
func (c *AtomicCounter) Inc()       { c.n.Add(1) }
func (c *AtomicCounter) Value() int64 { return c.n.Load() }
```

### Solution 18

```go
type User struct{ ID, Name string }
type UserRepo interface { Find(id string) (*User, error) }

type pgUserRepo struct{}
func (p *pgUserRepo) Find(id string) (*User, error) {
    return &User{ID: id, Name: "User_" + id}, nil
}

type cachingUserRepo struct {
    inner UserRepo
    cache map[string]*User
    mu    sync.Mutex
}

func (c *cachingUserRepo) Find(id string) (*User, error) {
    c.mu.Lock()
    if u, ok := c.cache[id]; ok { c.mu.Unlock(); return u, nil }
    c.mu.Unlock()

    u, err := c.inner.Find(id)
    if err != nil { return nil, err }

    c.mu.Lock()
    c.cache[id] = u
    c.mu.Unlock()
    return u, nil
}
```

### Solution 19

```go
type List[T any] struct{ items []T }

func (l *List[T]) Add(x T)     { l.items = append(l.items, x) }
func (l *List[T]) Get(i int) T { return l.items[i] }
func (l *List[T]) Len() int    { return len(l.items) }

// Map at the package level — because methods cannot introduce their own type parameters
func Map[T, U any](l *List[T], f func(T) U) *List[U] {
    r := &List[U]{}
    for _, x := range l.items { r.Add(f(x)) }
    return r
}
```

### Solution 20

```go
type OrderState int
const ( Draft OrderState = iota; Submitted; Paid )

type OrderItem struct{ ProductID string; Qty int; Price Money }

type Order struct {
    ID     string
    items  []OrderItem
    state  OrderState
    events []Event
}

func (o *Order) AddItem(p Product, qty int) error {
    if o.state != Draft { return ErrFrozen }
    if qty <= 0 { return ErrInvalidQty }
    o.items = append(o.items, OrderItem{ProductID: p.ID, Price: p.Price, Qty: qty})
    o.events = append(o.events, ItemAdded{OrderID: o.ID, ProductID: p.ID})
    return nil
}

func (o *Order) Submit() error {
    if o.state != Draft { return ErrInvalidState }
    if len(o.items) == 0 { return ErrEmptyOrder }
    o.state = Submitted
    o.events = append(o.events, OrderSubmitted{OrderID: o.ID})
    return nil
}

func (o *Order) MarkPaid() error {
    if o.state != Submitted { return ErrInvalidState }
    o.state = Paid
    o.events = append(o.events, OrderPaid{OrderID: o.ID})
    return nil
}

func (o *Order) PullEvents() []Event {
    events := o.events
    o.events = nil
    return events
}
```

### Solution 21 (abridged)

```go
type Plugin struct{ name string }
func (p Plugin) Hello() string  { return "hi from " + p.name }
func (p Plugin) Status() string { return "OK" }

type PluginMethod = func(Plugin) string

var registry = map[string]PluginMethod{
    "hello":  Plugin.Hello,
    "status": Plugin.Status,
}

func Invoke(p Plugin, method string) string {
    if fn, ok := registry[method]; ok { return fn(p) }
    return "unknown method"
}
```

### Solution 22

```go
type DataService struct{ db *sql.DB }

func (s *DataService) Fetch(ctx context.Context, id string) (*Data, error) {
    select {
    case <-ctx.Done(): return nil, ctx.Err()
    default:
    }
    return s.db.QueryContext(ctx, "SELECT...", id) // ...
}

func (s *DataService) Save(ctx context.Context, d *Data) error {
    _, err := s.db.ExecContext(ctx, "INSERT...", d.Field)
    return err
}
```
