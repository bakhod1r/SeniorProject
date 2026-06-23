# Go Nil Pointer Dereference — Middle Level

## 1. Introduction

At the middle level, nil pointer dereferences become a design concern, not just a runtime accident. You think about API boundaries that prevent nil from spreading, you use static analysis tools to catch latent dereferences before they ship, you reason about the typed-nil-in-interface bug as a structural property of Go's type system, and you decide when to recover, when to fail loudly, and when to redesign so nil cannot occur at all.

This document covers idioms that scale: how to encode optional values without bare `*T`, how to avoid typed-nil leaks, how to write nil-safe APIs that are still ergonomic, and how to read panic stack traces quickly enough to fix bugs in production.

---

## 2. Prerequisites
- Junior-level material on nil pointer dereference
- Pointers basics, structs, interfaces, methods
- Goroutines and channels (for concurrent recovery)
- Familiarity with `errors.Is` / `errors.As`
- Basic understanding of Go interface representation (type tag + data pointer)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Nil-safe API | A type whose methods all behave reasonably on nil receivers |
| Optional type | A wrapper that distinguishes "absent" from "zero value" |
| Typed nil | An interface value with non-nil type tag and nil data pointer |
| Defensive programming | Writing nil checks at every layer "just in case" |
| Fail-fast | Letting a missing precondition crash early rather than masking |
| Sentinel pointer | A nil pointer used as an explicit "absent" marker |
| Boundary recovery | Calling `recover` at process or request boundaries only |
| iface / eface | Internal representation of `interface{}` (eface) and typed interfaces (iface) |
| Nil contract | API documentation specifying when nil is permitted and what it means |

---

## 4. Core Concepts

### 4.1 The Anatomy of a Go Interface Value

Every interface value in Go has two words:
1. **Type word** — points to the dynamic type's `*itab` (interface table) describing the concrete type and its method set, or `nil`.
2. **Data word** — points to (or holds) the actual value, or `nil`.

```
interface { type *itab; data unsafe.Pointer }
```

An interface compares equal to `nil` only when **both words are nil**.

```go
var p *MyErr            // *MyErr nil
var err error = p       // err.type = *MyErr (non-nil), err.data = nil
fmt.Println(err == nil) // false
```

When the runtime sees `err != nil` and you call `err.Error()`, it dispatches via the type word's method table to `(*MyErr).Error` and passes the data word (nil) as the receiver. If `Error` reads any field, panic.

This is mechanically inevitable. Avoid it by returning `nil` directly:

```go
func produce() error {
    if cond {
        return &MyErr{msg: "..."}
    }
    return nil // <- the literal nil interface, both words nil
}
```

### 4.2 Designing Nil-Safe APIs

A type is **nil-safe** if every public method behaves sensibly on a nil receiver. Common patterns:

```go
type Logger struct {
    out io.Writer
}

func (l *Logger) Printf(format string, args ...any) {
    if l == nil {
        return // silent no-op
    }
    fmt.Fprintf(l.out, format, args...)
}

func (l *Logger) Enabled() bool {
    return l != nil
}
```

Now callers don't need to check:
```go
var log *Logger // optional injection; might be nil
log.Printf("hello") // safe
```

The standard library uses this in some places — `slog.Logger` is one.

### 4.3 Avoid `*T` for "Optional" When You Can

A `*T` field carries two meanings: "pointer for sharing" AND "maybe absent". This double duty is bug-prone.

Alternatives:
- A separate boolean: `value T; hasValue bool`.
- A sentinel value that means "absent" (e.g., `-1` for an int that is otherwise positive).
- A container type: `Option[T]` from a generic library.
- A two-return function: `func() (T, bool)`.

```go
// Less clear
type User struct {
    Profile *Profile // nil means absent? or shared elsewhere?
}

// More explicit
type User struct {
    Profile   Profile
    HasProfile bool
}

// Or
type User struct {
    Profile Profile
}
func (u *User) HasProfile() bool { return u.Profile.ID != "" }
```

Use `*T` only when you need:
- Mutation through a shared reference.
- A real linked structure (tree, list).
- Interop with a library that expects `*T`.

### 4.4 Chained Field Access — The Train Wreck Pattern

```go
city := user.Profile.Address.City
```

This compiles because the `.` operator chains, but any nil link panics. Refactor:

```go
// Option 1 — flat checks
if user == nil || user.Profile == nil || user.Profile.Address == nil {
    return ""
}
return user.Profile.Address.City

// Option 2 — helper
func (u *User) City() string {
    if u == nil || u.Profile == nil || u.Profile.Address == nil {
        return ""
    }
    return u.Profile.Address.City
}

// Option 3 — flatten the data
type User struct {
    Name string
    City string
    // ...
}
```

Long chains of `*` are usually a smell that the data model is over-normalized.

### 4.5 Maps of Pointers

Two facts compound: missing keys return zero values, AND the zero value of `*T` is nil. So reading from a `map[K]*T` requires either the comma-ok form or a nil check after.

```go
// Buggy
u := users["bob"]
fmt.Println(u.Name) // u is nil if "bob" missing

// Safer
u, ok := users["bob"]
if !ok || u == nil {
    return errors.New("user not found")
}
fmt.Println(u.Name)
```

Or design the map to never store nil entries — then a missing key is the only "absent" case.

### 4.6 Interface vs Concrete Pointer Returns

When a function returns an interface, prefer returning the explicit `nil`:

```go
// Bug factory
func produce() error {
    var e *MyErr // typed nil
    return e
}

// Safe
func produce() error {
    if cond {
        return &MyErr{...}
    }
    return nil // bare nil interface
}
```

A linter (`staticcheck`'s SA4023) catches some of these.

If a function returns a concrete `*T` that may be nil, document it. If you need both an absence indicator and an error, use:

```go
func find(id string) (*User, error) {
    u, ok := store[id]
    if !ok {
        return nil, ErrNotFound
    }
    return u, nil
}
```

Callers can then check `err != nil` first, and only access `*u` after.

### 4.7 Recover Strategically

Recover does not "fix" nil panics; it prevents the process from exiting. Use it at boundaries:

- HTTP handlers (per-request recovery).
- Goroutine top-level functions (so a worker bug does not kill the process).
- Plugin / user-code execution.

```go
func handle(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if rec := recover(); rec != nil {
            http.Error(w, "internal server error", 500)
            log.Printf("panic: %v\n%s", rec, debug.Stack())
        }
    }()
    realHandler(w, r)
}
```

Do not recover deep in business logic; the bug is hidden, the program limps along, and operators lose the signal that something is wrong.

---

## 5. Real-World Analogies

**A locked office where some doors lead to vacant rooms.** A nil pointer is a key to a vacant room. The lock works (you can hold the key, copy it, give it away), but opening the door reveals an empty space. Some doors have signs ("vacant — do not enter"); those are nil-safe methods that handle the empty case.

**A delivery slip with no destination.** You can pass the slip around the warehouse, but the moment a courier tries to deliver, they find no address to go to. The dispatcher (the runtime) cancels the delivery with a loud alarm.

**A phone contact with the name filled in but no number.** The contact entry exists (interface non-nil), but actually calling fails because the number is missing (data nil).

---

## 6. Mental Models

### Model 1 — Layered Defenses

```
External input
     │
     ▼
[Validator: rejects malformed]
     │
     ▼
[Constructor: returns non-nil or err]
     │
     ▼
[Business logic: assumes non-nil]
     │
     ▼
[Boundary recovery: catches bugs]
```

By the time data reaches business logic, all preconditions have been enforced. Recovery is the safety net, not the first line of defense.

### Model 2 — Interface Box

```
err (interface)
┌────────────────┐
│ type word ────►│ *itab(*MyErr)
│ data word ────►│ nil
└────────────────┘
```

`err == nil` requires both words nil. A typed nil has a non-nil type word.

---

## 7. Pros & Cons

### Pros (of robust nil handling)
- Clear API contracts.
- Crash-resistant production code.
- Easier debugging (early failure with context).

### Cons
- More boilerplate at function entries.
- Possible over-defensive checking in places that cannot have nil.
- The typed-nil-in-interface bug requires education for every team member.

---

## 8. Use Cases

1. HTTP handlers — every request boundary recovers.
2. Worker goroutines — top-level recover prevents single-bug process death.
3. Plugin execution — recover around user-supplied code.
4. Configuration parsers — return `(*Config, error)`, never partial.
5. Database row mappers — handle nullable columns explicitly via `sql.Null*`.
6. JSON unmarshal — define explicit pointer fields for "absent vs zero".
7. Cache layers — distinguish "miss" from "stored nil".
8. Linked structures — every traversal handles nil children.

---

## 9. Code Examples

### Example 1 — Avoiding the typed-nil-error bug

```go
package main

import (
    "errors"
    "fmt"
)

type ValidationError struct {
    Field string
    Msg   string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("%s: %s", e.Field, e.Msg)
}

func validate(name string) error {
    if name == "" {
        return &ValidationError{Field: "name", Msg: "empty"}
    }
    return nil // not (*ValidationError)(nil)
}

func main() {
    if err := validate("alice"); err != nil {
        fmt.Println("error:", err)
    } else {
        fmt.Println("ok")
    }

    var target *ValidationError
    err := validate("")
    if errors.As(err, &target) {
        fmt.Printf("validation failed for %s: %s\n", target.Field, target.Msg)
    }
}
```

### Example 2 — Nil-safe logger

```go
package main

import (
    "fmt"
    "io"
    "os"
)

type Logger struct {
    w io.Writer
}

func (l *Logger) Printf(format string, args ...any) {
    if l == nil {
        return
    }
    fmt.Fprintf(l.w, format, args...)
}

func (l *Logger) With(prefix string) *Logger {
    if l == nil {
        return nil // chain stays nil-safe
    }
    return &Logger{w: l.w}
}

func work(log *Logger) {
    log.Printf("doing work\n")
    log.With("[worker]").Printf("more work\n")
}

func main() {
    work(&Logger{w: os.Stdout})
    work(nil) // no panic
}
```

### Example 3 — Optional struct field via boolean

```go
package main

import "fmt"

type Profile struct {
    Bio string
}

type User struct {
    Name       string
    Profile    Profile
    HasProfile bool
}

func describe(u User) string {
    if !u.HasProfile {
        return u.Name + " (no bio)"
    }
    return u.Name + ": " + u.Profile.Bio
}

func main() {
    fmt.Println(describe(User{Name: "alice"}))
    fmt.Println(describe(User{Name: "bob", Profile: Profile{Bio: "hi"}, HasProfile: true}))
}
```

### Example 4 — Boundary recovery in HTTP

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "runtime/debug"
)

func recoverMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if rec := recover(); rec != nil {
                log.Printf("panic on %s: %v\n%s", r.URL.Path, rec, debug.Stack())
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}

type buggyHandler struct{}

func (buggyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    var p *int
    fmt.Fprintln(w, *p) // panic
}

func main() {
    http.Handle("/", recoverMiddleware(buggyHandler{}))
    log.Println("listening :8080")
    _ = http.ListenAndServe(":8080", nil)
}
```

### Example 5 — Map lookup with nil-safe path

```go
package main

import "fmt"

type Config struct {
    DB *DB
}

type DB struct {
    Host string
}

func host(c *Config) string {
    if c == nil || c.DB == nil {
        return "unset"
    }
    return c.DB.Host
}

func main() {
    fmt.Println(host(nil))
    fmt.Println(host(&Config{}))
    fmt.Println(host(&Config{DB: &DB{Host: "localhost"}}))
}
```

---

## 10. Coding Patterns

### Pattern 1 — Constructor-only construction
```go
type User struct{ name string }

func NewUser(name string) (*User, error) {
    if name == "" {
        return nil, errors.New("empty name")
    }
    return &User{name: name}, nil
}

// Disallow zero-value usage:
// Make struct fields unexported and require constructor.
```

### Pattern 2 — Nil-safe method chain
```go
func (l *Logger) With(k, v string) *Logger {
    if l == nil { return nil }
    return &Logger{w: l.w, prefix: l.prefix + " " + k + "=" + v}
}
```

### Pattern 3 — Avoid typed nil in interface return
```go
func op() error {
    var concrete *MyErr
    if cond {
        concrete = &MyErr{...}
    }
    if concrete != nil {
        return concrete
    }
    return nil // bare interface nil
}
```

### Pattern 4 — Boundary recovery wrapper
```go
func safeGo(f func()) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Printf("goroutine panic: %v", r)
            }
        }()
        f()
    }()
}
```

### Pattern 5 — Two-return for absence
```go
func find(id string) (*User, bool) {
    u, ok := store[id]
    return u, ok
}
```

---

## 11. Clean Code Guidelines

1. **Document nil-permitted parameters** in godoc comments.
2. **Prefer constructors** that guarantee non-nil.
3. **Avoid `*T` fields** when you only need optionality.
4. **Use `errors.As`** to extract concrete error types safely.
5. **Group nil checks** at the top of functions, not scattered.
6. **Do not silently recover** without logging.
7. **Run static analyzers** as part of CI: `staticcheck`, `nilness`, `nilaway`.

---

## 12. Product Use / Feature Example

A user profile service that handles partial data:

```go
package main

import (
    "errors"
    "fmt"
)

type Profile struct {
    Bio    string
    Avatar string
}

type User struct {
    ID      string
    Name    string
    profile *Profile
}

var ErrNotFound = errors.New("not found")

type Store struct {
    users map[string]*User
}

func NewStore() *Store {
    return &Store{users: map[string]*User{}}
}

func (s *Store) Get(id string) (*User, error) {
    u, ok := s.users[id]
    if !ok {
        return nil, ErrNotFound
    }
    return u, nil
}

func (s *Store) Add(u *User) error {
    if u == nil {
        return errors.New("nil user")
    }
    if u.ID == "" {
        return errors.New("empty id")
    }
    s.users[u.ID] = u
    return nil
}

// Profile returns the user's profile or nil. Callers must check.
func (u *User) Profile() *Profile {
    return u.profile
}

func describe(s *Store, id string) (string, error) {
    u, err := s.Get(id)
    if err != nil {
        return "", err
    }
    if p := u.Profile(); p != nil {
        return fmt.Sprintf("%s: %s", u.Name, p.Bio), nil
    }
    return u.Name + " (no profile)", nil
}

func main() {
    s := NewStore()
    s.Add(&User{ID: "1", Name: "alice"})
    s.Add(&User{ID: "2", Name: "bob", profile: &Profile{Bio: "hi"}})

    for _, id := range []string{"1", "2", "3"} {
        if d, err := describe(s, id); err != nil {
            fmt.Printf("%s: %v\n", id, err)
        } else {
            fmt.Printf("%s: %s\n", id, d)
        }
    }
}
```

---

## 13. Error Handling

The interaction with Go's error pattern is rich:

1. **Always return `nil` (the bare interface)** for "no error" — never a typed nil.
2. **`errors.As`** safely extracts a concrete error; it handles the typed-nil case correctly.
3. **`errors.Is`** with sentinel errors avoids pointer comparisons entirely.
4. **Wrap with `fmt.Errorf("%w", err)`** to preserve typed errors through layers.

```go
var ErrAuth = errors.New("auth failed")

func login() error {
    return fmt.Errorf("login: %w", ErrAuth)
}

if errors.Is(err, ErrAuth) {
    // handle auth
}
```

---

## 14. Security Considerations

1. **Untrusted input** that produces a nil deref is a denial-of-service vector. Validate at the boundary.
2. **Recovery handlers** must not log the entire recovered value if it could contain user data — sanitize.
3. **Panic messages may leak internal paths** in stack traces shipped to users. Strip them from public error responses.
4. **Memory safety** is preserved by Go's runtime; nil deref does not leak memory contents (unlike C).

---

## 15. Performance Tips

1. **Nil checks compile to one TEST + one branch** — typically free.
2. **The compiler removes redundant nil checks** via SSA passes (`nilcheck.go`). You don't need to manually optimize.
3. **Recovery is expensive** (stack scan); reserve it for boundaries.
4. **Avoid `runtime.Stack` calls** in tight loops; they allocate.
5. **PGO** can further specialize hot paths involving interface dispatches.

---

## 16. Metrics & Analytics

Track recovery counts as a SLO violation:

```go
var nilPanicCounter = expvar.NewInt("nil_panics_total")

func recoverHandler() {
    if r := recover(); r != nil {
        nilPanicCounter.Add(1)
        // also log r and stack
    }
}
```

A non-zero rate of nil panics indicates inadequate input validation upstream.

---

## 17. Best Practices

1. Constructors return either a non-nil value or an error.
2. Return `(*T, error)` for optional + error, not `*T` alone.
3. Document every public function's nil contract.
4. Provide nil-safe methods where natural.
5. Avoid storing nil in maps if a missing key already means absence.
6. Recover at boundaries; let bugs surface in tests.
7. Use `errors.As` / `errors.Is` rather than typed comparisons.
8. Validate untrusted input early.
9. Run `staticcheck`, `nilness`, and (for stricter) `nilaway`.
10. Test explicitly with nil inputs.

---

## 18. Edge Cases & Pitfalls

### Pitfall 1 — `if err != nil` always true with typed nil
```go
func op() error {
    var e *MyErr // nil
    return e
}
err := op()
if err != nil { /* always taken */ }
```
Fix: return `nil` directly.

### Pitfall 2 — Unconditional method chain
```go
return user.Profile().Address().Format()
```
Any nil link panics. Refactor or add checks.

### Pitfall 3 — Recover swallowing real bugs
```go
defer func() { recover() }() // bare recover; loses the bug
```
Always log or surface the recovered value.

### Pitfall 4 — Map of pointers with no comma-ok
```go
u := users[id]
return u.Name // panic if missing
```

### Pitfall 5 — Constructor that ignores error
```go
cfg, _ := loadConfig()
fmt.Println(cfg.Host) // panic on failure
```

### Pitfall 6 — Method with pointer receiver expected to be safe
```go
func (s *S) Get() int { return s.x }
var s *S
s.Get() // panic — body reads field
```

### Pitfall 7 — `defer` capturing nil receiver
```go
func (db *DB) Process() {
    defer db.cleanup() // method value evaluated now; if db is nil, depends on cleanup
}
```

---

## 19. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Return typed nil as error | Return `nil` literal |
| Forget comma-ok on map of pointers | Use `v, ok := m[k]` |
| Recover globally and log nothing | Always log with stack |
| Chain field access without checks | Refactor or guard |
| Pointer field for "optional" + sharing | Separate the concerns |

---

## 20. Common Misconceptions

**Misconception 1**: "I can just `recover()` everywhere."
**Truth**: Recovery hides bugs; reserve for boundaries.

**Misconception 2**: "Returning a typed nil from a function returning an interface is fine."
**Truth**: It creates the typed-nil-in-interface bug.

**Misconception 3**: "Methods on nil receivers always panic."
**Truth**: Only when the body reads fields; nil-safe methods exist.

**Misconception 4**: "Linters catch all nil bugs."
**Truth**: They catch many but miss flow-sensitive cases. `nilaway` is the most ambitious.

**Misconception 5**: "Adding nil checks everywhere is good practice."
**Truth**: Over-checking masks API design problems. Fix the API instead.

---

## 21. Tricky Points

1. `interface == nil` requires both words nil.
2. Nil-safe methods receive a nil receiver and must handle it.
3. Map lookup of `*T` requires comma-ok or post-check.
4. `errors.As` correctly handles typed nil; manual type assertion does not.
5. Recovery only catches panics; it does not catch fatal runtime errors (e.g., concurrent map writes detected by the runtime sometimes terminate).

---

## 22. Test

```go
package main

import (
    "errors"
    "strings"
    "testing"
)

type MyErr struct{ msg string }

func (e *MyErr) Error() string {
    if e == nil {
        return "<nil MyErr>"
    }
    return e.msg
}

func returnsNilError() error {
    var e *MyErr // typed nil
    return e
}

func returnsBareNil() error {
    return nil
}

func TestTypedNilBug(t *testing.T) {
    err := returnsNilError()
    if err == nil {
        t.Fatal("expected interface non-nil")
    }
    // demonstrates the bug
}

func TestBareNil(t *testing.T) {
    err := returnsBareNil()
    if err != nil {
        t.Fatal("expected nil")
    }
}

func TestErrorsAs(t *testing.T) {
    err := errors.New("plain")
    var target *MyErr
    if errors.As(err, &target) {
        t.Fatal("should not match")
    }
}

func TestNilSafeMethod(t *testing.T) {
    var e *MyErr
    msg := e.Error()
    if !strings.Contains(msg, "<nil") {
        t.Errorf("got %q", msg)
    }
}
```

---

## 23. Tricky Questions

**Q1**: Why does this print `non-nil`?
```go
type E struct{}
func (*E) Error() string { return "e" }
func op() error {
    var e *E
    return e
}
err := op()
if err != nil {
    fmt.Println("non-nil")
}
```
**A**: The interface `err` carries the type tag `*E` and a nil data pointer. Interface equals nil only when BOTH are nil; here the type tag is non-nil.

**Q2**: Does this panic?
```go
type S struct{ v int }
func (s *S) Self() *S { return s }
var s *S
fmt.Println(s.Self() == nil)
```
**A**: No. `Self` does not read `s` — it only returns the receiver. Returning `nil`, then comparing, is fine. Prints `true`.

**Q3**: What's printed?
```go
defer func() {
    if r := recover(); r != nil {
        fmt.Println("got:", r)
    }
}()
var p *int
*p = 1
```
**A**: `got: runtime error: invalid memory address or nil pointer dereference`. Recovery converts the panic value to a printable form via fmt.

---

## 24. Cheat Sheet

```go
// Avoid typed nil
return nil // not (*MyErr)(nil)

// Comma-ok for maps
if u, ok := m[k]; ok && u != nil { ... }

// Nil-safe method
func (l *L) M() {
    if l == nil { return }
    // ...
}

// Boundary recovery
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v\n%s", r, debug.Stack())
    }
}()

// Constructor invariant
func New() (*T, error) { ... }

// Optional via bool
type X struct {
    V int
    Has bool
}
```

---

## 25. Self-Assessment Checklist

- [ ] I understand the iface/eface representation
- [ ] I never return typed nil from a function returning an interface
- [ ] I write nil-safe methods where natural
- [ ] I use `errors.As` and `errors.Is`
- [ ] I refactor chained access to avoid panics
- [ ] I recover at boundaries only
- [ ] I run static analyzers in CI
- [ ] I document nil contracts in godoc

---

## 26. Summary

Middle-level mastery of nil pointer dereference is about API design and disciplined error handling. Avoid `*T` for optionality when a boolean or two-return pattern is clearer. Never return a typed nil from an interface-returning function. Provide nil-safe methods. Recover only at boundaries. Use `errors.As` and `errors.Is`. Run `staticcheck` and `nilness` in CI. Document nil contracts in godoc. The result is code that survives unexpected inputs and surfaces real bugs early.

---

## 27. What You Can Build

- A robust HTTP server with per-request recovery and structured logging.
- An RPC framework with typed errors that never leak typed nils.
- A configuration library with explicit "missing vs zero" semantics.
- A worker pool whose goroutines recover and report panics without dying.
- A linter wrapper integrating `staticcheck`, `nilness`, and `nilaway`.

---

## 28. Further Reading

- [Go FAQ — Why is my nil error not nil?](https://go.dev/doc/faq#nil_error)
- [Go blog — Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover)
- [`errors.As`](https://pkg.go.dev/errors#As)
- [`runtime.PanicNilError`](https://pkg.go.dev/runtime#PanicNilError)
- [`staticcheck` SA4023](https://staticcheck.dev/docs/checks/#SA4023)
- [`nilaway`](https://github.com/uber-go/nilaway)
- [`nilness` analyzer](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/nilness)

---

## 29. Related Topics

- 2.7.1 Pointers Basics
- 2.7.2 Pointers with Structs
- 2.7.4 Memory Management
- 2.7.5 Unsafe Pointer
- 2.8 Error Handling Basics
- 2.8.1 Error Interface (the typed-nil pitfall lives here too)
- Chapter 7 Concurrency (goroutine recovery)

---

## 30. Diagrams & Visual Aids

### iface representation
```
           ┌────────────────┐
err ─────► │  type *itab    │ ──► method set, dynamic type
           ├────────────────┤
           │  data unsafe.Pointer │ ──► concrete value (or nil!)
           └────────────────┘

err == nil  iff  type == nil && data == nil
```

### Layered defenses
```
[ Untrusted input ]
        │
[ Validator ]                  ← reject malformed early
        │
[ Constructor ]                ← guarantees non-nil
        │
[ Business logic ]             ← assumes non-nil
        │
[ Boundary recovery ]          ← safety net for unknown bugs
```

### When chain access fails
```
user → Profile → Address → City
          ↑           ↑
          nil here    or here
          → panic on first dereference
```
