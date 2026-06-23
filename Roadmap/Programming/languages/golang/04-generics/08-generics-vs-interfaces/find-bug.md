# Generics vs Interfaces — Find the Bug

## How to use

Each problem shows a code snippet. Read it carefully and answer:
1. What is the bug?
2. How would you fix it?
3. Was the wrong abstraction (generic vs interface) part of the cause?

Solutions are at the end. Most bugs come from picking the wrong tool — **over-abstracted generics**, **lost dynamic dispatch**, or **hidden allocations**.

---

## Bug 1 — Over-abstracted generic API

```go
func Notify[T any](v T, msg string) error {
    switch x := any(v).(type) {
    case Email: return x.Send(msg)
    case Slack: return x.Send(msg)
    case SMS:   return x.Send(msg)
    }
    return errors.New("unknown notifier")
}
```

**Hint:** What kind of polymorphism does the type switch reveal?

---

## Bug 2 — Lost dynamic dispatch

```go
type Reader interface { Read([]byte) (int, error) }

func ReadAll[R Reader](r R) ([]byte, error) {
    var buf [4096]byte
    var out []byte
    for {
        n, err := r.Read(buf[:])
        out = append(out, buf[:n]...)
        if err == io.EOF { return out, nil }
        if err != nil { return out, err }
    }
}

readers := []Reader{file1, conn, bytesReader}
for _, r := range readers {
    ReadAll(r) // ?
}
```

**Hint:** What `T` does the compiler pick when `r` is an interface variable?

---

## Bug 3 — Hidden allocations from `[]Interface`

```go
type Logger interface { Log(string) }
type StdLogger struct{}
func (StdLogger) Log(msg string) { fmt.Println(msg) }

func LogAll(loggers []Logger, msg string) {
    for _, l := range loggers { l.Log(msg) }
}

// 1 million times:
LogAll([]Logger{StdLogger{}}, "ping")
```

**Hint:** Building a `[]Logger` literal — what happens to each `StdLogger{}`?

---

## Bug 4 — Single-implementation interface

```go
type UserRepo interface {
    Find(id int) (*User, error)
    Save(u *User) error
}

type pgUserRepo struct{ db *sql.DB }
// Only implementation in the project. No tests use a fake.
```

**Hint:** What is the cost vs the benefit of this interface?

---

## Bug 5 — Generic where interface was needed

```go
func Render[T any](items []T) string {
    var sb strings.Builder
    for _, v := range items {
        if r, ok := any(v).(Renderable); ok {
            sb.WriteString(r.Render())
        }
    }
    return sb.String()
}
```

**Hint:** Why is the `any(v).(Renderable)` runtime check there?

---

## Bug 6 — Heterogeneous slice attempted with generics

```go
type Stack[T any] struct{ data []T }

var s Stack[any] // workaround for heterogeneous storage
s.data = append(s.data, 1, "hi", true)
```

**Hint:** What did `T any` accomplish here?

---

## Bug 7 — Public API leaks generics

```go
package userlib

func Find[T User | AdminUser](id int) (*T, error) { ... }

// caller code:
u, err := userlib.Find[userlib.User](42)
a, err := userlib.Find[userlib.AdminUser](42)
```

**Hint:** What happens when the library wants to add `GuestUser`?

---

## Bug 8 — Forgetting that `error` is an interface

```go
func Result[T any](v T) (T, *MyError) { return v, nil }

err := Result(0).(error) // ?
```

**Hint:** Can you assign `*MyError` to `error` directly? What does the snippet really do?

---

## Bug 9 — Interface in hot path

```go
type Adder interface { Add(int) int }
type Counter struct{ n int }
func (c *Counter) Add(d int) int { c.n += d; return c.n }

var counters []Adder
for i := 0; i < 1_000_000_000; i++ {
    counters[i%len(counters)].Add(1)
}
```

**Hint:** Profile shows the loop is dispatch-bound. What is the fix?

---

## Bug 10 — Constraint that should be an interface

```go
type Notifier interface {
    Email | Slack | SMS
    Notify(string) error
}

func Alert[T Notifier](n T, msg string) error { return n.Notify(msg) }

// Six months later, a new `Discord` notifier is needed.
```

**Hint:** Can `Discord` be added without modifying the constraint?

---

## Bug 11 — Generic with type assertion inside

```go
func Decode[T any](data []byte) (T, error) {
    var v T
    if err := json.Unmarshal(data, &v); err != nil {
        var zero T
        return zero, err
    }
    if validator, ok := any(v).(interface{ Validate() error }); ok {
        if err := validator.Validate(); err != nil {
            var zero T
            return zero, err
        }
    }
    return v, nil
}
```

**Hint:** The code works, but the type assertion hides intent. What is a cleaner alternative?

---

## Bug 12 — Lost type info through `any`

```go
func Cache(key string, fn func() any) any {
    if v, ok := store.Load(key); ok { return v }
    v := fn()
    store.Store(key, v)
    return v
}

result := Cache("user:42", func() any { return loadUser(42) }).(*User)
```

**Hint:** Why is the `(*User)` assertion at the call site dangerous?

---

## Bug 13 — Generic interface that should be a method-set interface

```go
type Comparable[T any] interface {
    Equal(other T) bool
}

func Distinct[T Comparable[T]](items []T) []T {
    var out []T
    for _, v := range items {
        seen := false
        for _, w := range out { if v.Equal(w) { seen = true; break } }
        if !seen { out = append(out, v) }
    }
    return out
}
```

**Hint:** What is the cost of self-referential type parameters here?

---

## Bug 14 — `[]any` instead of typed slice

```go
func Sum(s []any) float64 {
    var total float64
    for _, v := range s {
        switch x := v.(type) {
        case int: total += float64(x)
        case float64: total += x
        }
    }
    return total
}
```

**Hint:** Two problems — boxing and silent skipping.

---

## Bug 15 — Mixing styles in one function

```go
type Saver interface { Save() error }

func Save[T Saver](items []T) error {
    for _, v := range items {
        var s any = v
        if saver, ok := s.(Saver); ok {
            if err := saver.Save(); err != nil { return err }
        }
    }
    return nil
}
```

**Hint:** The constraint already guarantees the method. What is the assertion doing?

---

## Solutions

### Bug 1 — fix
The type switch reveals real polymorphism. Use an interface:
```go
type Notifier interface { Send(msg string) error }
func Notify(n Notifier, msg string) error { return n.Send(msg) }
```
**Lesson:** A `switch any(v).(type)` inside a generic is interface dispatch in disguise. Make the abstraction explicit.

### Bug 2 — fix
When `r` is `Reader` (an interface variable), the compiler picks `T = Reader`. The "generic" call is just an interface call, plus dictionary indirection. There is no win. Drop generics here:
```go
func ReadAll(r Reader) ([]byte, error) { ... }
```
**Lesson:** Generics over an interface variable do not help. The dispatch is still dynamic.

### Bug 3 — fix
Each `StdLogger{}` is boxed into a `Logger` header. For a million calls, that is a million heap allocations. Pass typed:
```go
func Log[L Logger](loggers []L, msg string) { for _, l := range loggers { l.Log(msg) } }
```
Or use a single concrete logger if heterogeneity is not needed.

### Bug 4 — fix
A single-implementation interface is noise. Inline the concrete type. Add the interface only when a second implementation arrives (often for tests):
```go
type UserRepo struct{ db *sql.DB }
func (r *UserRepo) Find(id int) (*User, error) { ... }
```
**Lesson:** "Interface for everything" is an anti-pattern in modern Go.

### Bug 5 — fix
The body needs `Renderable` semantics — make it a real interface:
```go
type Renderable interface { Render() string }
func Render(items []Renderable) string { ... }
```
**Lesson:** A generic that immediately type-asserts is interface dispatch dressed up.

### Bug 6 — fix
`Stack[any]` defeats the point of a generic Stack. Either use an interface for genuinely heterogeneous data:
```go
var data []any
data = append(data, 1, "hi", true)
```
Or use a typed `Stack[int]` and `Stack[string]` for homogeneous data. Generics do not enable heterogeneity.

### Bug 7 — fix
The constraint `User | AdminUser` is closed. Adding `GuestUser` is a breaking change to every caller. Use an interface:
```go
type UserLike interface { GetID() int }
func Find[T UserLike](id int) (T, error) { ... }
```
Or, simpler: have the function take the concrete type via the call site, not as a type parameter.

### Bug 8 — fix
`*MyError` does satisfy `error` if it has `Error() string`. The cast `Result(0).(error)` is wrong because `Result` returns two values. Idiomatic Go uses standard `(value, error)`:
```go
func Result[T any](v T) (T, error) { return v, nil }
```
**Lesson:** Do not reinvent `error` with generics.

### Bug 9 — fix
For 1B calls, dispatch overhead matters. Specialize:
```go
type Counter struct{ n int }
func (c *Counter) Add(d int) int { c.n += d; return c.n }
counters := []*Counter{...}
for i := 0; i < 1_000_000_000; i++ { counters[i%len(counters)].Add(1) }
```
Direct calls inline. PGO may also help if the interface form is required.

### Bug 10 — fix
The constraint `Email | Slack | SMS` closes the type set. Use an interface:
```go
type Notifier interface { Notify(string) error }
func Alert(n Notifier, msg string) error { return n.Notify(msg) }
```
Adding `Discord` requires no change to `Alert`.

### Bug 11 — fix
Make the optional method an interface and accept `T Validator` (or have two functions):
```go
type Validator interface { Validate() error }
func DecodeAndValidate[T Validator](data []byte) (T, error) {
    var v T
    if err := json.Unmarshal(data, &v); err != nil { var zero T; return zero, err }
    if err := v.Validate(); err != nil { var zero T; return zero, err }
    return v, nil
}
```
The constraint guarantees the method; no runtime check needed.

### Bug 12 — fix
The `any` cache loses type safety. Use a generic cache:
```go
func Cache[K comparable, V any](store *sync.Map, key K, fn func() V) V {
    if v, ok := store.Load(key); ok { return v.(V) }
    v := fn()
    store.Store(key, v)
    return v
}
result := Cache(store, "user:42", func() *User { return loadUser(42) })
```

### Bug 13 — fix
Self-referential generic interfaces (`Comparable[T]`) are heavy. Compare via `cmp.Compare` or `==`:
```go
func Distinct[T comparable](items []T) []T {
    seen := map[T]struct{}{}
    var out []T
    for _, v := range items {
        if _, ok := seen[v]; !ok { seen[v] = struct{}{}; out = append(out, v) }
    }
    return out
}
```
Use `comparable` if you can; reach for self-referential constraints only when truly necessary.

### Bug 14 — fix
Generic + numeric constraint:
```go
type Number interface { ~int | ~float64 }
func Sum[T Number](s []T) T {
    var total T
    for _, v := range s { total += v }
    return total
}
```
No boxing, no silent skipping.

### Bug 15 — fix
`T Saver` already guarantees the method. Drop the assertion:
```go
func Save[T Saver](items []T) error {
    for _, v := range items {
        if err := v.Save(); err != nil { return err }
    }
    return nil
}
```

---

## Lessons

Patterns from these bugs:

1. **`switch any(v).(type)` inside a generic is interface dispatch in disguise.** Make it an interface.
2. **Generics over an interface variable do not help.** The dispatch stays dynamic.
3. **`[]Interface` allocates heap headers.** Use a typed slice for hot paths.
4. **Single-implementation interfaces are noise.** Add interfaces when needed, not preemptively.
5. **Closed constraints with type unions are not extensible.** Use interfaces for open extensibility.
6. **Heterogeneous storage is interface-only.** Generics cannot do `[]MultiType`.
7. **Generic public APIs leak type parameters everywhere.** Treat them like a permanent commitment.
8. **`any` plus type assertions is the pre-1.18 anti-pattern.** Generics replace it.
9. **Self-referential generic interfaces are expensive.** Use `comparable` or `cmp.Ordered` first.
10. **The constraint already guarantees the method.** Do not re-assert at runtime.

A senior engineer reads each bug as a signal of which abstraction was wrong. The fix is rarely "tweak the syntax"; it is "swap the tool".
