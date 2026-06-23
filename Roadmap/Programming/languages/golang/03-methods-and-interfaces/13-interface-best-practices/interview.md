# Interface Best Practices — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: What does "Accept interfaces, return concrete types" mean?

**Answer:** A Go API design rule (Postel's Law applied to function signatures):

- **Inputs** should be the smallest interface that captures the behavior the
  function actually uses — accept widely.
- **Outputs** should be concrete types (structs or pointers to structs) —
  return precisely.

```go
// GOOD
func NewBufferedReader(r io.Reader) *bufio.Reader { ... }

// BAD — accepts a concrete type, callers can't pass mocks
func NewBufferedReader(f *os.File) *bufio.Reader { ... }

// BAD — returns an interface, callers lose access to *bufio.Reader's
// own methods like Peek and ReadLine
func NewBufferedReader(r io.Reader) io.Reader { ... }
```

The standard library's `bufio.NewReader` is the canonical example.

### Q2: Why are small interfaces preferred in Go?

**Answer:** Rob Pike's proverb sums it up: *"The bigger the interface, the
weaker the abstraction."* Small interfaces:

- Are easier to satisfy (more types fit them).
- Are easier to mock in tests.
- Compose freely (`io.ReadCloser = Reader + Closer`).
- Document one specific behavior precisely.

`io.Reader` is one method and is implemented by hundreds of types across
the standard library and ecosystem. A six-method interface would exclude
most of them.

### Q3: What is the `-er` suffix convention?

**Answer:** *Effective Go* recommends naming single-method interfaces by
the method plus `-er`:

| Method   | Interface |
|----------|-----------|
| `Read`   | `Reader`  |
| `Write`  | `Writer`  |
| `Close`  | `Closer`  |
| `Format` | `Formatter` |
| `String` | `Stringer` |

Don't prefix with `I` (Java/C# habit) and don't suffix with `Interface`.

### Q4: What does `var _ io.Reader = (*MyReader)(nil)` do?

**Answer:** It is a **compile-time satisfaction check**. If `*MyReader`
does not satisfy `io.Reader`, the code fails to compile. The blank
identifier discards the variable, and the typed nil avoids running any
constructor.

```go
type MyReader struct{}
func (r *MyReader) Read(p []byte) (int, error) { ... }

var _ io.Reader = (*MyReader)(nil)   // compile-time guarantee
```

### Q5: Where should an interface be defined — in the package that uses it or the one that implements it?

**Answer:** **In the package that uses it (the consumer).** From
*CodeReviewComments*: *"Go interfaces generally belong in the package that
uses values of the interface type, not the package that implements those
values."*

This way:

- The implementation package returns concrete structs (no abstraction
  leaks).
- Each consumer can define only the subset of methods it actually needs.
- Adding a new method to the implementation does not break unrelated
  callers.

---

## Middle-Level Questions

### Q6: Why does the standard library `bufio.NewReader` return `*bufio.Reader` and not `io.Reader`?

**Answer:** Because `*bufio.Reader` has methods that are NOT part of
`io.Reader` — `Peek`, `ReadLine`, `UnreadByte`, `Buffered`. Returning the
interface would discard those methods. The Go FAQ explicitly says:
*"Returning an interface from a constructor function loses information."*

### Q7: When is it appropriate to return an interface from a function?

**Answer:** Three legitimate cases:

1. The implementation is intentionally hidden, e.g. `errors.New` returns
   `error` because `*errorString` is unexported.
2. A factory genuinely returns one of several behaviorally equivalent
   implementations chosen at runtime.
3. The caller's contract is the abstraction — e.g. `database/sql/driver`
   driver interfaces, where pluggability is the *whole point*.

In every other case — return concrete types.

### Q8: How does interface composition work in Go?

**Answer:** By embedding. Larger interfaces are built from smaller ones:

```go
type Reader interface { Read(p []byte) (int, error) }
type Closer interface { Close() error }

type ReadCloser interface {
    Reader
    Closer
}
```

Any type that satisfies both `Reader` and `Closer` automatically satisfies
`ReadCloser` — Go's structural typing makes this implicit.

### Q9: What does "Don't design with interfaces, discover them" mean?

**Answer:** Another Pike proverb. Don't pre-create interfaces speculatively
for "future flexibility". Wait until:

- A test mock is needed alongside a real implementation, OR
- A second concrete implementation actually exists.

Until then, return concrete types. Extracting an interface later is
**zero-cost** in Go because of structural typing — implementers don't have
to declare anything.

```go
// First version: concrete only
package payments
type StripeProcessor struct { ... }
func (p *StripeProcessor) Charge(amount int) error { ... }

// Later, when a second impl appears, the consumer extracts:
package billing
type chargeProcessor interface { Charge(amount int) error }
```

### Q10: What is an "optional interface" in Go?

**Answer:** A narrower interface that augments a base type, detected at
runtime via type assertion. Example: `http.ResponseWriter` is the base
contract, but the underlying value may also implement `http.Flusher`,
`http.Hijacker`, or `http.Pusher`:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintln(w, "first chunk")
    if f, ok := w.(http.Flusher); ok {
        f.Flush()
    }
}
```

This is the textbook way to add new capabilities without breaking existing
implementations.

### Q11: Why is `interface{}` (or `any`) usually a smell?

**Answer:** Rob Pike: *"interface{} says nothing."* It declares that the
function accepts any type but loses static type checking. After Go 1.18,
generics replace most legitimate uses (`Map[T, U any]`, `Set[T comparable]`).
Remaining valid uses: `fmt.Println`, JSON marshalling, untyped containers
in legacy APIs.

### Q12: What's the difference between a method-set interface and a type-set constraint?

**Answer:** Both use the `interface` keyword but mean different things.

| Aspect                | Method-set interface       | Type-set constraint                |
|-----------------------|----------------------------|------------------------------------|
| Use                   | Runtime polymorphism       | Compile-time generic constraint    |
| Body                  | Method declarations        | `~int \| ~int64 \| ...`            |
| Storage               | itab + data pointer        | Erased at compile time             |
| Mocking               | Easy — implement methods   | N/A — types are concrete           |
| Example               | `io.Reader`                | `cmp.Ordered`                      |

Pick the constraint when you need to preserve concrete type information in
return values; pick the method-set interface when you need runtime
polymorphism.

### Q13: Why is naming an interface `RedisCache` a smell?

**Answer:** Interfaces name **roles**, not implementations. The role is
"caching" — `Cache` is the right name. `RedisCache` is fine for the
concrete struct.

```go
// Interface
type Cache interface {
    Get(key string) (string, error)
    Set(key, value string) error
}

// Implementations
type RedisCache    struct { ... }   // satisfies Cache
type InMemoryCache struct { ... }   // also satisfies Cache
```

If the interface name binds it to one implementation, you've already lost
the abstraction.

---

## Senior-Level Questions

### Q14: Walk me through how you'd refactor a fat `UserService` interface.

**Answer:**

```go
// Before: every consumer depends on every method
type UserService interface {
    Find(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
    SendWelcomeEmail(ctx context.Context, u *User) error
    Charge(ctx context.Context, u *User, cents int) error
}
```

Step 1 — identify the responsibilities. Find/Save is *persistence*.
SendWelcomeEmail is *messaging*. Charge is *billing*.

Step 2 — split into role-based interfaces, each defined at its consumer:

```go
package onboarding
type userStore interface {                        // consumer-defined
    Save(ctx context.Context, u *User) error
}
type mailer interface {
    Send(ctx context.Context, to, body string) error
}

type Onboarder struct { store userStore; mailer mailer }
```

Step 3 — implementations stay concrete:

```go
package userrepo
type Repo struct{ db *sql.DB }
func (r *Repo) Save(...) error { ... }
func (r *Repo) Find(...) (*User, error) { ... }
```

Step 4 — wire at `main`:

```go
svc := onboarding.New(userrepo.New(db), mail.New(smtp))
```

Each consumer now declares only what it needs; the implementation is free
to grow new methods without breaking unrelated callers. ISP satisfied.

### Q15: When should you NOT use the consumer-side rule?

**Answer:** When the *purpose* of the package is to expose a contract:

- `database/sql/driver` — drivers are the abstraction. The interfaces live
  with the consumer (`database/sql`), but the *implementer* package
  literally has nothing concrete to offer; only contract adherence.
- `net/http.Handler` — the entire `net/http` package is built around the
  interface. Defining `Handler` elsewhere makes no sense.
- `io` — a vocabulary package whose product is the interfaces themselves.

The rule of thumb: if the package's reason for existing is the *abstraction*,
the interface lives there. Otherwise, follow the consumer-side rule.

### Q16: How does the Postel principle interact with backward compatibility?

**Answer:** It directly enables it.

- Returning a struct means you can add new methods or fields without
  breaking callers. (Adding a field is non-breaking; adding a method is
  non-breaking.)
- Returning an interface freezes the contract — adding a method to the
  interface breaks every implementation in the wild.
- Accepting an interface lets the function evolve only as long as the
  interface stays stable. If you must add a new behavior, expose it as a
  *new* optional interface that the caller can detect.

Standard library example: `os.File` grew `WriteString` over time without
breaking anyone, because functions returned `*os.File`, not some `Writer`
interface defined externally.

### Q17: When is `var _ I = (*T)(nil)` redundant?

**Answer:** When `*T` is **used as `I`** elsewhere in the same package and
that use is checked at compile time. For example:

```go
package server
type handler interface { ServeHTTP(w, r) }
type myHandler struct{}
func (myHandler) ServeHTTP(...) { ... }

http.Handle("/api", myHandler{})   // compile error if signature wrong
```

The check is most valuable when:

- The interface lives in another package and the type doesn't directly call
  into a function that expects it.
- You're shipping a library and want a tripwire that catches breaking
  refactors before they reach the user.
- The interface evolves and you want compile-time confirmation that your
  type still satisfies it.

### Q18: How do you expose a capability without breaking existing implementations?

**Answer:** Add a **separate optional interface** and detect via type
assertion. Don't extend the base interface.

```go
// Existing
type Writer interface { Write(p []byte) (int, error) }

// New capability — separate interface
type ReaderFrom interface {
    ReadFrom(r io.Reader) (int64, error)
}

// Caller picks the fast path opportunistically
func Copy(dst Writer, src io.Reader) (int64, error) {
    if rf, ok := dst.(ReaderFrom); ok {
        return rf.ReadFrom(src)
    }
    // fallback ...
}
```

This is exactly how `io.Copy` chooses between `WriteTo`, `ReadFrom`, and
the buffer fallback. The existing `Writer` contract is unchanged.

### Q19: Why is `io.Reader` considered the gold standard interface?

**Answer:** Multiple reasons:

1. **One method.** Smallest possible.
2. **Universally implementable.** Any source of bytes can be a Reader.
3. **Composes endlessly.** `io.MultiReader`, `io.LimitReader`, `io.TeeReader`,
   `bufio.NewReader`, `gzip.NewReader`, `tls.Conn`, `net.Conn`, `*bytes.Buffer`,
   `*os.File`, `strings.NewReader`, `crypto/rand.Reader`, `http.Response.Body`,
   etc.
4. **Uniform error model.** `io.EOF` is a sentinel, not an exception.
5. **Predictable performance contract.** Returns *up to* `len(p)` bytes; no
   guarantees beyond that. This minimal contract enables efficient
   implementations.
6. **Backward-compatible evolution.** New behaviors (`WriterTo`,
   `ByteReader`, `RuneReader`) are added as separate optional interfaces.

When you design an interface, ask: *would `io.Reader` design it this way?*

### Q20: Distinguish between an interface that's "discovered" vs one that's "designed".

**Answer:**

- **Discovered:** Two or more concrete types already exist. You notice they
  share a behavior. You extract the smallest common shape into an
  interface. You replace concrete arguments with the interface in the few
  places where polymorphism is genuinely needed.
- **Designed:** You imagine future flexibility. You write an interface
  before any caller exists. You build a single concrete type to match it.
  You bind every consumer to the abstraction "just in case".

Designed interfaces are usually wrong-shaped, oversized, and burdensome.
Discovered interfaces emerge minimal and useful.

### Q21: How do you decide between an interface and a generic constraint?

**Answer:** Decision tree:

1. Is the set of types **open**? (third parties can add types) → **Interface**.
2. Do you need **runtime polymorphism**? (mixed types in a slice) → **Interface**.
3. Do you want to **preserve the concrete type** in the return? → **Constraint**.
4. Are you doing **arithmetic / comparison** that depends on the concrete
   type? → **Constraint**.
5. Is **zero-cost abstraction** mandatory (hot loop, no itab)? → **Constraint**.

Often you write both — a constraint for internal helpers and an interface
for the public API.

---

## Tricky / Curveball Questions

### Q22: This function returns an `error`. The error is `nil`. Why does the caller see a non-nil error?

```go
type MyError struct{ Code int }
func (e *MyError) Error() string { return "code" }

func doWork() error {
    var e *MyError = nil
    return e
}

func main() {
    if err := doWork(); err != nil {
        fmt.Println("entered branch")  // YES, this prints
    }
}
```

**Answer:** The classic *typed-nil-through-interface* trap. The interface
`error` has two parts: type and value. `doWork()` returns an interface
whose **type** is `*MyError` and whose **value** is `nil`. The interface
itself is therefore not nil — comparing to `nil` checks both parts.

Fix: never return a typed nil. Return `nil` literally:

```go
func doWork() error {
    return nil   // safe: both type and value are nil
}
```

### Q23: You see this function. What's wrong?

```go
func NewLogger() Logger {
    return &fileLogger{path: "/var/log/app.log"}
}
```

**Answer:** Returns an interface. Caller cannot reach methods that may be
defined on `*fileLogger` (rotation, flush, sync). Better:

```go
func NewLogger() *FileLogger { return &FileLogger{...} }
```

If pluggability is genuinely required, accept a logger via DI in the
consumer instead of returning one from the constructor.

### Q24: Is it ever idiomatic to define an exported single-method interface that's used only by one caller in the same package?

**Answer:** **No.** If the interface has one consumer in the same package,
unexport it. Exporting an interface signals that external callers should
provide implementations. If no one outside provides one, the export is
noise.

```go
// BAD — exported, only used here
package svc
type UserStore interface { Save(*User) error }
type Service struct{ store UserStore }

// GOOD — unexported, captures intent precisely
package svc
type userStore interface { Save(*User) error }
type Service struct{ store userStore }
```

### Q25: Which is correct?

```go
// (a)
type IUserRepository interface { ... }

// (b)
type UserRepositoryInterface interface { ... }

// (c)
type UserRepository interface { ... }

// (d)
type UserStore interface { ... }
```

**Answer:** **(d) is best, (c) is acceptable.** Go style avoids `I` prefix
and `Interface` suffix. Names should describe roles. `UserStore` is more
behavior-focused than `UserRepository` (which leans on the Java DDD
vocabulary), but both are acceptable depending on team conventions.

### Q26: Why is this generic function preferred over the interface version?

```go
// (a) interface
func Min(a, b interface{ Less(any) bool }) any { ... }

// (b) generic
func Min[T cmp.Ordered](a, b T) T { ... }
```

**Answer:** Version (b):

- Preserves concrete types — `Min(1, 2)` returns `int`, not `any`.
- Allocates nothing — no interface boxing.
- Compile-time safety — wrong types fail to compile.
- No `Less(any) bool` ceremony for built-in types.

The interface version forces every type to declare a `Less(any) bool`
method and loses the input type at the boundary. After Go 1.18, generic
constraints are the right tool for this kind of polymorphism.

### Q27: What's wrong with this test setup?

```go
type Mailer struct{ smtp *smtp.Client }
func (m *Mailer) Send(to, body string) error { ... }

type UserService struct{ mailer *Mailer }    // concrete dependency
```

**Answer:** `UserService` accepts a concrete type, so the test cannot
inject a fake mailer without spinning up SMTP. Fix:

```go
package userservice

type mailer interface {                       // consumer-side interface
    Send(to, body string) error
}

type UserService struct{ mailer mailer }
```

Now tests pass a fake `mailer` and production passes `*Mailer`. Note the
interface stays unexported — only this package consumes it.

### Q28: Is this idiomatic?

```go
type Service interface {
    DoEverything(ctx context.Context, req Request) (Response, error)
}
```

**Answer:** **No** — it's a procedural one-method interface masquerading as
abstraction. The name "Service" and method "DoEverything" both say nothing.
Either:

- Rename to capture the role precisely: `OrderProcessor.Process(...)`,
  `PriceCalculator.Calculate(...)`.
- Reject the abstraction entirely if there's only one implementation.

A one-method interface is fine when the method has a clear, narrow purpose
(`Reader.Read`, `Closer.Close`). It's not fine when the method is a
universal "do the thing" entry point.

---

## Coding Tasks

### Task 1: Refactor to consumer-side interface

```go
// Given:
package payments
type Processor interface {
    Charge(amount int) error
    Refund(txID string) error
}
type StripeProcessor struct { client *stripe.Client }
func (s *StripeProcessor) Charge(amount int) error { ... }
func (s *StripeProcessor) Refund(txID string) error { ... }

package billing
import "myapp/payments"
type Service struct { proc payments.Processor }
```

**Solution:** Move the interface to the consumer; keep the concrete on
the implementer.

```go
package payments
type StripeProcessor struct { client *stripe.Client }
func (s *StripeProcessor) Charge(amount int) error { ... }
func (s *StripeProcessor) Refund(txID string) error { ... }
// no interface here

package billing
type charger interface {                       // consumer-defined
    Charge(amount int) error
}
type Service struct { proc charger }           // accepts interface
```

`*payments.StripeProcessor` automatically satisfies `billing.charger` via
structural typing.

### Task 2: Add a compile-time check

```go
// Add a single line that fails to compile if *MyHandler stops
// satisfying http.Handler.
type MyHandler struct{}
func (h *MyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) { ... }
```

**Solution:**

```go
var _ http.Handler = (*MyHandler)(nil)
```

### Task 3: Split a fat interface

```go
type FileSystem interface {
    Open(name string) (io.ReadCloser, error)
    Create(name string) (io.WriteCloser, error)
    Remove(name string) error
    Mkdir(path string, perm os.FileMode) error
}
```

**Solution:**

```go
type Opener  interface { Open(name string) (io.ReadCloser, error) }
type Creator interface { Create(name string) (io.WriteCloser, error) }
type Remover interface { Remove(name string) error }
type Mkdirer interface { Mkdir(path string, perm os.FileMode) error }

type FileSystem interface { Opener; Creator; Remover; Mkdirer }
```

A read-only consumer can now depend on `Opener` alone.

### Task 4: Capability detection via assertion

```go
// io.Copy-like: pick the fast path if dst supports ReaderFrom
func Copy(dst io.Writer, src io.Reader) (int64, error) { ... }
```

**Solution:**

```go
func Copy(dst io.Writer, src io.Reader) (int64, error) {
    if rf, ok := dst.(io.ReaderFrom); ok {
        return rf.ReadFrom(src)
    }
    if wt, ok := src.(io.WriterTo); ok {
        return wt.WriteTo(dst)
    }
    buf := make([]byte, 32*1024)
    var written int64
    for {
        n, err := src.Read(buf)
        if n > 0 {
            nw, ew := dst.Write(buf[:n])
            written += int64(nw)
            if ew != nil { return written, ew }
        }
        if err == io.EOF { return written, nil }
        if err != nil    { return written, err }
    }
}
```

### Task 5: Replace `interface{}` with a generic constraint

```go
// Before
func Min(a, b interface{ Less(any) bool }) any { ... }
```

**Solution:**

```go
import "cmp"

func Min[T cmp.Ordered](a, b T) T {
    if a < b { return a }
    return b
}
```

---

## System Design Style

### Q29: How would you design a plugin system using interfaces?

**Answer:**

1. Define **the smallest possible base interface** that captures the
   plugin's primary contribution.
2. Add **optional capability interfaces** for advanced behaviors. The host
   detects them via type assertion.
3. Keep all interfaces in the host (consumer) package; plugin authors
   return concrete structs.
4. Use a registration function rather than a "fat" plugin manifest
   interface.

```go
package host

// Base — every plugin satisfies this.
type Plugin interface {
    Name() string
}

// Optional capabilities.
type Initializer    interface { Init(ctx context.Context) error }
type Shutdowner     interface { Shutdown(ctx context.Context) error }
type RequestHandler interface { Handle(ctx context.Context, req Req) (Resp, error) }

func Register(p Plugin) { ... }
func Run(ctx context.Context, name string, req Req) (Resp, error) {
    p := registry[name]
    if init, ok := p.(Initializer); ok { _ = init.Init(ctx) }
    if h, ok := p.(RequestHandler); ok { return h.Handle(ctx, req) }
    return Resp{}, fmt.Errorf("plugin %q does not handle requests", name)
}
```

### Q30: How do you approach interfaces in a hexagonal / ports-and-adapters architecture?

**Answer:**

- The **domain** package defines **ports** (interfaces). These are the
  small, role-based contracts the domain needs.
- The **adapters** package implements ports as concrete structs. Adapters
  return concrete types from constructors.
- The **wiring** layer (`main`) injects adapters into the domain.

```go
// domain/order.go — port lives in the domain (consumer)
package order

type repository interface {
    Save(ctx context.Context, o *Order) error
    Find(ctx context.Context, id string) (*Order, error)
}

type Service struct{ repo repository }

// infra/postgres/order_repo.go — adapter is concrete
package postgres

type OrderRepo struct{ db *sql.DB }
func (r *OrderRepo) Save(ctx context.Context, o *order.Order) error { ... }
func (r *OrderRepo) Find(ctx context.Context, id string) (*order.Order, error) { ... }

// main.go
svc := order.NewService(postgres.NewOrderRepo(db))
```

The domain has zero imports of `database/sql`, `redis`, etc. The infra
package has zero imports of the domain interface — Go's structural typing
makes this possible.

### Q31: How do you evolve an interface without breaking consumers?

**Answer:**

- **Adding a method to an existing interface is a breaking change.** Every
  implementation must add the method.
- **Adding a *new* optional interface is non-breaking.** Implementations
  opt in by adding the method; callers detect with `if _, ok := x.(Y); ok`.

Pattern:

```go
// v1
type Storer interface { Store(k, v string) error }

// v2 — new capability without breaking v1 implementers
type ConditionalStorer interface {
    Storer
    StoreIfAbsent(k, v string) (stored bool, err error)
}

func write(s Storer, k, v string) {
    if cs, ok := s.(ConditionalStorer); ok {
        ok, _ := cs.StoreIfAbsent(k, v)
        if ok { return }
    }
    _ = s.Store(k, v)
}
```

The standard library uses this pattern extensively — `io.WriterTo`,
`io.ReaderFrom`, `error.Unwrap`, `fmt.Stringer`, `http.Flusher`, etc., are
all optional augmentations of base contracts.

---

## What Interviewers Look For

### Junior

- Can recite "accept interfaces, return concrete types".
- Knows the `-er` suffix convention.
- Knows that interfaces are satisfied implicitly.
- Can write a simple `io.Reader` implementation.

### Middle

- Places interfaces at the consumer site.
- Splits fat interfaces into role-based ones.
- Uses `var _ I = (*T)(nil)` for cross-package contracts.
- Recognises and avoids the typed-nil-through-interface bug.
- Can choose between an interface and a generic constraint.

### Senior

- Designs APIs around minimal interfaces with optional capabilities.
- Justifies when *not* to follow each rule (e.g. when returning an
  interface is correct).
- Refactors existing code to comply with ISP and consumer-side
  definition.
- Understands backward-compatibility implications of every interface
  change.
- Uses capability detection and embedding fluently.

### Professional

- Builds entire architectures (hexagonal / clean / ports-and-adapters)
  consistent with these idioms.
- Coaches a team on interface evolution and deprecation.
- Reviews PRs for interface smells (god interfaces, premature
  abstraction, exported-when-unused).
- Maps these idioms onto domain-driven design and event-driven systems.

---

## Cheat Sheet

```
ACCEPT INTERFACES, RETURN STRUCTS
──────────────────────────────────────────────
  func New...(in io.Reader) *Reader   ✓
  func New...(in *os.File) io.Reader  ✗

INTERFACE SIZE
──────────────────────────────────────────────
  1 method  → ideal
  2 methods → common
  3 methods → acceptable
  4+        → consider splitting

NAMING
──────────────────────────────────────────────
  one method → MethodName + "er"
  no I prefix, no Interface suffix
  name the role, not the implementation

LOCATION
──────────────────────────────────────────────
  consumer package, not implementer

COMPILE-TIME CHECK
──────────────────────────────────────────────
  var _ I = (*T)(nil)

OPTIONAL CAPABILITIES
──────────────────────────────────────────────
  if x, ok := v.(Capability); ok { x.Do() }

INTERFACE vs GENERIC
──────────────────────────────────────────────
  open type set, runtime poly → interface
  closed types, type-preserving → constraint
```
