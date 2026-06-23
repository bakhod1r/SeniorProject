# Interface Anti-Patterns — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

---

## Bug 1 — Typed-nil error escapes the boundary

```go
type ValidationError struct{ Field string }

func (e *ValidationError) Error() string {
    return "invalid: " + e.Field
}

func Validate(name string) error {
    var e *ValidationError
    if name == "" {
        e = &ValidationError{Field: "name"}
    }
    return e
}

func main() {
    if err := Validate("ok"); err != nil {
        fmt.Println("failed:", err) // prints "failed: <nil>"!
    } else {
        fmt.Println("passed")
    }
}
```

**Hint:** Compare the static type of the return value with the dynamic type stored in the interface.

**Bug:** `Validate` returns `e` of static type `*ValidationError` even when it is nil. The `error` interface value is never the zero interface — it holds the tuple `(*ValidationError, nil)`. An interface compares equal to nil only when **both** its type word and value word are nil. The nil pointer is wrapped, so `err != nil` is true and the program falsely reports failure. Calling `err.Error()` here would panic.

**Fix:** Return the untyped `nil` directly when there is nothing to report.

```go
func Validate(name string) error {
    if name == "" {
        return &ValidationError{Field: "name"}
    }
    return nil
}
```

Never declare `var e *ConcreteError` and return it on the success path. `go vet` includes a `nilness` analyser; `errcheck` and `staticcheck` flag this as `SA4023`.

---

## Bug 2 — Returning an interface hides important methods

```go
type Reader interface {
    Read(p []byte) (int, error)
}

func OpenFile(path string) Reader { // returns interface
    f, err := os.Open(path)
    if err != nil {
        log.Fatal(err)
    }
    return f
}

func main() {
    r := OpenFile("/tmp/data.bin")
    defer r.Close() // compile error: r.Close undefined
}
```

**Hint:** Look at what `os.Open` actually returns versus what the function signature exposes.

**Bug:** `os.Open` returns `*os.File`, which has many useful methods: `Close`, `Stat`, `Seek`, `Sync`, `Name`. By advertising the return type as the narrow `Reader` interface, the function strips the caller of every method that is not in `Reader`. The caller has to type-assert back to `*os.File` just to call `Close` — an obvious smell. The Go proverb is *"Accept interfaces, return structs"* for exactly this reason.

**Fix:** Return the concrete type so callers keep the full method set; let *callers* widen to an interface if they need to.

```go
func OpenFile(path string) (*os.File, error) {
    return os.Open(path)
}
```

---

## Bug 3 — Pointer-to-interface breaks dispatch

```go
type Closer interface {
    Close() error
}

func closeAll(closers []*Closer) {
    for _, c := range closers {
        c.Close() // compile error: c.Close undefined
    }
}

func main() {
    f, _ := os.Open("/tmp/x")
    var c Closer = f
    closeAll([]*Closer{&c})
}
```

**Hint:** Method sets are defined on the *interface*, not on a pointer to it.

**Bug:** `*Closer` is "pointer to interface", which is almost never what you want. The Go specification states that the method set of a pointer to a defined type T includes T's methods; there is *no rule* that promotes interface methods through a pointer. To call `Close` you have to dereference manually: `(*c).Close()`. Worse, a `*Closer` cannot be assigned from an `*os.File` directly, so call sites become noisy. Interface values are already reference-like — they hold a pointer to the underlying concrete data — so wrapping them in another pointer is purely friction.

**Fix:** Pass the interface by value.

```go
func closeAll(closers []Closer) {
    for _, c := range closers {
        _ = c.Close()
    }
}
```

The only legitimate use of `*SomeInterface` is when an API needs to *mutate* the interface header itself (extremely rare, e.g. reflective decoders).

---

## Bug 4 — Header interface forces mock explosion

```go
// store/store.go
type Store interface {
    GetUser(id int64) (User, error)
    SaveUser(u User) error
    DeleteUser(id int64) error
    ListUsers(filter Filter) ([]User, error)
    GetOrder(id int64) (Order, error)
    SaveOrder(o Order) error
    ListOrdersByUser(uid int64) ([]Order, error)
    GetInvoice(id int64) (Invoice, error)
    SaveInvoice(i Invoice) error
    // ...20 more methods
}

// billing/billing.go
type Billing struct{ store Store }

func (b *Billing) ChargeUser(uid int64) error {
    u, err := b.store.GetUser(uid)
    if err != nil {
        return err
    }
    return b.store.SaveInvoice(Invoice{UserID: u.ID})
}
```

**Hint:** What does the test suite look like for `Billing`?

**Bug:** `Store` is a "header interface" (Cockburn's term) — one fat interface listing everything the concrete `*Postgres` repository can do. Every consumer that depends on `Store` must mock all 25+ methods, even though `Billing` uses only two. Tests become unreadable, mocks drift out of sync with reality, and adding a method anywhere forces every mock in the codebase to be regenerated. The interface lives near the *implementation*, not the *consumer*, which is the opposite of the Go convention.

**Fix:** Define a "role interface" next to each consumer, listing only the methods that consumer actually calls. Concrete `*Postgres` will satisfy all of them implicitly.

```go
// billing/billing.go
type userInvoiceStore interface {
    GetUser(id int64) (User, error)
    SaveInvoice(i Invoice) error
}

type Billing struct{ store userInvoiceStore }
```

Now the test mock has two methods. Rob Pike: *"The bigger the interface, the weaker the abstraction."*

---

## Bug 5 — Interface in same package as the only implementation

```go
// package cache

type Cache interface {
    Get(key string) ([]byte, bool)
    Set(key string, value []byte)
}

type redisCache struct{ /* ... */ }

func (r *redisCache) Get(key string) ([]byte, bool) { /* ... */ }
func (r *redisCache) Set(key string, value []byte)  { /* ... */ }

func New() Cache { return &redisCache{} } // returns interface
```

**Hint:** Count the implementations and think about what the compiler can prove.

**Bug:** The package defines an interface that has exactly one implementation, *and* the constructor returns the interface. Three problems compound:

1. The compiler cannot inline `Get`/`Set` calls — every call goes through an itab dispatch even though the dynamic type is statically knowable. Benchmarks typically show 2–5 ns extra per call plus lost vector/escape optimisations.
2. Every caller is forced to allocate the concrete value on the heap, because `return &redisCache{}` escapes through an interface return.
3. The interface *predicts the future* — it claims polymorphism that does not exist yet. If a second implementation arrives, the right interface shape is rarely the one guessed up front.

**Fix:** Export the concrete type, return it directly, and let *consumers* introduce an interface where they need substitution.

```go
type Redis struct{ /* ... */ }

func New() *Redis { return &Redis{} }

func (r *Redis) Get(key string) ([]byte, bool) { /* ... */ }
func (r *Redis) Set(key string, value []byte)  { /* ... */ }
```

Add the interface only when the second implementation actually appears.

---

## Bug 6 — `interface{}` parameter where generics fit

```go
func Max(values []interface{}) interface{} {
    if len(values) == 0 {
        return nil
    }
    best := values[0]
    for _, v := range values[1:] {
        if v.(int) > best.(int) { // panics on []float64, []string, ...
            best = v
        }
    }
    return best
}

func main() {
    nums := []int{3, 1, 4, 1, 5, 9, 2, 6}
    boxed := make([]interface{}, len(nums))
    for i, n := range nums {
        boxed[i] = n
    }
    m := Max(boxed).(int)
    fmt.Println(m)
}
```

**Hint:** Count the allocations and the type assertions per call.

**Bug:** The "stringly typed" `interface{}` (or `any`) parameter pattern from pre-1.18 Go has three concrete costs: (a) every `int` placed into the slice escapes to the heap and gets boxed in an `eface`; (b) the `v.(int)` assertion is a runtime check that panics on the wrong type; (c) the function compiles for one comparison operator and silently breaks on `[]float64` or `[]string`. There is no compile-time guarantee that the slice is homogeneous.

**Fix:** Use a type parameter constrained to `cmp.Ordered`.

```go
import "cmp"

func Max[T cmp.Ordered](values []T) T {
    var zero T
    if len(values) == 0 {
        return zero
    }
    best := values[0]
    for _, v := range values[1:] {
        if v > best {
            best = v
        }
    }
    return best
}

m := Max([]int{3, 1, 4, 1, 5, 9, 2, 6}) // no boxing, no assertion
```

`any` is still the right tool when you genuinely accept *heterogeneous* values (e.g. `fmt.Println`, `json.Marshal`); it is the wrong tool when the call site already knows the type.

---

## Bug 7 — "Vehicle hierarchy" imported from Java

```go
type Vehicle interface {
    Start()
    Stop()
    Drive()
    Refuel()
    Honk()
    GetWheels() int
    GetMaxSpeed() int
}

type Car struct{ wheels int; speed int }
func (c *Car) Start()             {}
func (c *Car) Stop()              {}
func (c *Car) Drive()             {}
func (c *Car) Refuel()            {}
func (c *Car) Honk()              {}
func (c *Car) GetWheels() int     { return c.wheels }
func (c *Car) GetMaxSpeed() int   { return c.speed }

type Bicycle struct{ wheels int }
func (b *Bicycle) Start()          {}
func (b *Bicycle) Stop()           {}
func (b *Bicycle) Drive()          {}
func (b *Bicycle) Refuel()         { panic("bicycles do not refuel") }
func (b *Bicycle) Honk()           { panic("no horn") }
func (b *Bicycle) GetWheels() int  { return b.wheels }
func (b *Bicycle) GetMaxSpeed()int { return 25 }
```

**Hint:** Count the panics, then ask which methods are genuinely shared.

**Bug:** This is the classic Java/C# "abstract base class" reflex: model a real-world *is-a* hierarchy and force every subtype to implement every method. The result is `panic("not supported")` in `Bicycle.Refuel` — a textbook Liskov violation. Go interfaces describe *behaviour at the call site*, not taxonomy. A function that needs `Drive()` should depend on `interface{ Drive() }`, not on a god-interface.

**Fix:** Split into single-method, behaviour-focused interfaces; let consumers compose only what they need.

```go
type Driver  interface{ Drive() }
type Stopper interface{ Stop() }
type Fueler  interface{ Refuel() }

func RoadTrip(d Driver, s Stopper) { d.Drive(); s.Stop() }
```

`*Bicycle` need not implement `Fueler` at all — the type system enforces "do not call Refuel on a bicycle" for free.

---

## Bug 8 — Mock-driven interface only used in tests

```go
// pricing/clock.go
type Clock interface {
    Now() time.Time
}

type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

type Pricer struct{ clock Clock }

func NewPricer() *Pricer { return &Pricer{clock: realClock{}} }

// pricing/pricing_test.go
type fakeClock struct{ t time.Time }
func (f fakeClock) Now() time.Time { return f.t }

func TestExpiry(t *testing.T) {
    p := &Pricer{clock: fakeClock{t: time.Unix(1700000000, 0)}}
    // ...
}
```

**Hint:** How many production call sites use `Clock` polymorphically?

**Bug:** `Clock` exists *solely* so the test can substitute a fake. Production code has exactly one implementation, `realClock{}`. The interface adds an itab indirection on every `Now()` call in production for a benefit only the test consumes. Worse, the design has leaked test concerns into the production type's API: `Pricer` now stores a `Clock` field instead of just calling `time.Now()`. This pattern is called *mock-driven design* and is a smell.

**Fix:** Make `Pricer` take a `nowFunc func() time.Time` (a function value, not an interface), and default it to `time.Now`. The test passes its own closure. No interface, no extra type, no production indirection.

```go
type Pricer struct{ now func() time.Time }

func NewPricer() *Pricer { return &Pricer{now: time.Now} }

// test
p := &Pricer{now: func() time.Time { return time.Unix(1700000000, 0) }}
```

For larger surfaces, prefer a *fake* (a real, in-memory implementation) over a generated mock — fakes are written once and exercise real logic.

---

## Bug 9 — Stringer recursing through `%v`

```go
type Money struct {
    Cents    int64
    Currency string
}

func (m Money) String() string {
    return fmt.Sprintf("%v %s", m, m.Currency) // !
}

func main() {
    fmt.Println(Money{Cents: 100, Currency: "USD"})
}
```

**Hint:** What format verb does `fmt` use to honour `Stringer`, and what does that imply when `String` is recursive?

**Bug:** `fmt.Sprintf("%v", m)` — when the operand satisfies `fmt.Stringer` and the verb is `%v` or `%s`, `fmt` calls `m.String()` again. That call hits `Sprintf("%v", m)`, which calls `String()`, which calls `Sprintf`... unbounded recursion until the goroutine's stack overflows. Runtime: `runtime: goroutine stack exceeds 1000000000-byte limit` and a process crash. The same trap exists for an `Error()` method that calls `fmt.Errorf("%v", e)` on itself.

**Fix:** Format the *fields* directly, never the receiver itself.

```go
func (m Money) String() string {
    return fmt.Sprintf("%d.%02d %s", m.Cents/100, m.Cents%100, m.Currency)
}
```

If you genuinely need the default Go syntax, use `%+v` *and* convert via a different type: `type alias Money; fmt.Sprintf("%+v", alias(m))`. `go vet` ships a `printf` analyser that catches the most common shape of this bug.

---

## Bug 10 — `Read` method that is not an `io.Reader`

```go
type SensorReading struct {
    Temperature float64
    Humidity    float64
}

type Sensor struct{ /* ... */ }

// Looks like io.Reader at a glance!
func (s *Sensor) Read(p []byte) (int, error) {
    r := s.poll()
    return copy(p, fmt.Sprintf("%.2f,%.2f", r.Temperature, r.Humidity)), nil
}

func main() {
    var s Sensor
    data, err := io.ReadAll(&s) // hangs forever, then OOM
    _ = data; _ = err
}
```

**Hint:** Read the contract of `io.Reader`, especially the EOF clause.

**Bug:** Just because a method has the signature `Read(p []byte) (int, error)` does not make the type a valid `io.Reader`. The `io.Reader` *contract* requires that the stream eventually return `io.EOF` (or another non-nil error) so consumers know to stop. `Sensor.Read` always returns `(n, nil)`, so `io.ReadAll` keeps calling it forever, growing its buffer until the process is OOM-killed. Implementing an interface signature without honouring its semantics is one of the most insidious Go bugs because there is no compile-time check. Other classic semantic mismatches: a `Close` that can be called twice safely vs. one that panics, an `Equal` that is not symmetric, a `Less` that is not a strict weak order.

**Fix:** Either honour the contract and return `io.EOF`, or rename the method so it does not collide with the interface signature.

```go
// Option A — actually be a reader
func (s *Sensor) Read(p []byte) (int, error) {
    if s.done {
        return 0, io.EOF
    }
    r := s.poll()
    s.done = true
    return copy(p, fmt.Sprintf("%.2f,%.2f", r.Temperature, r.Humidity)), nil
}

// Option B — do not pretend
func (s *Sensor) Sample() SensorReading { return s.poll() }
```

When in doubt, write a satisfaction assertion: `var _ io.Reader = (*Sensor)(nil)` documents intent, and missing methods are caught at compile time — but the *semantic* contract still has to be enforced by tests (e.g. `iotest.TestReader`).

---

## Bug 11 — Empty interface as a generic container

```go
type EventBus struct {
    subs map[string][]func(interface{})
}

func (b *EventBus) On(topic string, fn func(interface{})) {
    b.subs[topic] = append(b.subs[topic], fn)
}

func (b *EventBus) Publish(topic string, event interface{}) {
    for _, fn := range b.subs[topic] {
        fn(event)
    }
}

// Subscriber
bus.On("user.created", func(e interface{}) {
    u := e.(User)              // panics if publisher sends *User or string
    fmt.Println("hello", u.Name)
})
```

**Hint:** What does the type system know about the relationship between `On` and `Publish`?

**Bug:** Every subscriber must type-assert; every publisher could send anything. The interface gives zero compile-time guarantee that `"user.created"` carries a `User` rather than a `*User`, a `UserCreated` envelope, or a typo. A single mismatched producer crashes a subscriber at runtime, and the only way to find such bugs is full integration tests. This is the empty-interface bus — a recurring anti-pattern in event systems.

**Fix:** Parameterise the bus on the event type. Each topic becomes its own bus.

```go
type Bus[E any] struct {
    subs []func(E)
}

func (b *Bus[E]) On(fn func(E))    { b.subs = append(b.subs, fn) }
func (b *Bus[E]) Publish(event E)  { for _, fn := range b.subs { fn(event) } }

userCreated := &Bus[User]{}
userCreated.On(func(u User) { fmt.Println("hello", u.Name) })
userCreated.Publish(User{Name: "Alice"}) // type-checked
```

If you must keep one bus value carrying many topics, encode the topic in the type itself (a sealed sum) rather than in a string key.

---

## Bug 12 — Asserting on the `error` value instead of unwrapping

```go
type NotFoundError struct{ Key string }
func (e *NotFoundError) Error() string { return "not found: " + e.Key }

func Lookup(k string) error {
    return fmt.Errorf("lookup %q: %w", k, &NotFoundError{Key: k})
}

func main() {
    err := Lookup("user-42")
    if nf, ok := err.(*NotFoundError); ok {
        fmt.Println("missing key:", nf.Key)
    } else {
        fmt.Println("other error:", err) // always taken
    }
}
```

**Hint:** What does `%w` do to the returned error's *type*?

**Bug:** `fmt.Errorf` with the `%w` verb wraps the inner error inside a `*fmt.wrapError`. The interface value returned by `Lookup` has dynamic type `*fmt.wrapError`, not `*NotFoundError`. The direct assertion `err.(*NotFoundError)` therefore fails, and the program reports "other error" even though a `NotFoundError` is right there in the chain. Anyone wrapping errors must use `errors.As` / `errors.Is` to walk the chain.

**Fix:** Use `errors.As` (which traverses `Unwrap`) for typed inspection.

```go
var nf *NotFoundError
if errors.As(err, &nf) {
    fmt.Println("missing key:", nf.Key)
}
```

For sentinel comparison use `errors.Is(err, ErrNotFound)`. The flat type assertion is correct only when you control the wrapping and *deliberately* do not wrap.

---

## Cheat Sheet

```
INTERFACE ANTI-PATTERNS
─────────────────────────────────────────────────
1.  Typed-nil error               → return untyped nil
2.  Returning interface from API  → return concrete struct
3.  *Interface parameter          → pass interface by value
4.  Header interface (fat)        → role interface near consumer
5.  Interface with one impl       → drop interface; export struct
6.  interface{} where T fits      → use generics
7.  Java-style is-a hierarchy     → small behavioural interfaces
8.  Mock-only interface           → function field or in-memory fake
9.  Stringer with %v on self      → format fields, not the receiver
10. Right shape, wrong semantics  → honour the interface contract
11. Empty-interface event bus     → Bus[E] per event type
12. Type-assert through %w        → errors.As / errors.Is

GO PROVERBS
─────────────────────────────────────────────────
"Accept interfaces, return structs."
"The bigger the interface, the weaker the abstraction."
"Don't design with interfaces, discover them."
"interface{} says nothing." (Rob Pike)

TOOLING
─────────────────────────────────────────────────
go vet ./...                    # printf, nilness, copylocks
staticcheck ./...               # SA4023 typed nil, ST1000+ style
golangci-lint run               # ireturn, interfacebloat, exhaustive
go test -run TestReader ./...   # iotest helpers for io.Reader contracts
```
