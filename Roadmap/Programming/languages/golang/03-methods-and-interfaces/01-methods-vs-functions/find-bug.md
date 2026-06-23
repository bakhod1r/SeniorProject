# Methods vs Functions — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

---

## Bug 1 — Counter not modified

```go
type Counter struct{ n int }

func (c Counter) Inc() { c.n++ }

func main() {
    c := Counter{}
    c.Inc()
    c.Inc()
    c.Inc()
    fmt.Println(c.n) // ?
}
```

**Hint:** Examine Inc's receiver carefully.

**Bug:** `Inc` uses a value receiver — when `c` is passed to Inc, a copy is made. `c.n++` modifies only the **copy**, leaving the original `c` unaffected. Output: `0`.

**Fix:**

```go
func (c *Counter) Inc() { c.n++ }
```

---

## Bug 2 — Map element pointer receiver

```go
type User struct{ name string }
func (u *User) Rename(n string) { u.name = n }

func main() {
    users := map[string]User{"a": {name: "Alice"}}
    users["a"].Rename("Alicia")  // ?
}
```

**Hint:** Where is the compile error?

**Bug:** Map elements are not addressable — you cannot take `&users["a"]`, so a pointer receiver method cannot be called on it. Compile error: `cannot call pointer method on map value`.

**Fix:**

```go
u := users["a"]
u.Rename("Alicia")
users["a"] = u
```

Or change the map to `map[string]*User`.

---

## Bug 3 — Mutex copied

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() {  // value receiver
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

**Hint:** Race condition + mutex.

**Bug:** A value receiver copies `c`, and the mutex gets copied along with it. Concurrent goroutines each Lock their own copy of the mutex — there is no synchronization. `go vet` issues a "passes lock by value" warning.

**Fix:**

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

---

## Bug 4 — Method set mismatch

```go
type Greeter interface { Greet() string }

type Person struct{ name string }
func (p *Person) Greet() string { return "Hi " + p.name }

func main() {
    p := Person{name: "Alice"}
    var g Greeter = p
    fmt.Println(g.Greet())
}
```

**Hint:** Check the method set rules.

**Bug:** `Greet` has a pointer receiver — it is not in `Person`'s method set. A `Person` value cannot be assigned to the `Greeter` interface. Compile error: `Person does not implement Greeter (Greet method has pointer receiver)`.

**Fix:**

```go
var g Greeter = &p   // pass a pointer
```

Or switch to a value receiver: `func (p Person) Greet() string { ... }`.

---

## Bug 5 — Nil pointer panic

```go
type Logger struct{ prefix string }
func (l *Logger) Log(msg string) {
    fmt.Println(l.prefix, msg)
}

func main() {
    var l *Logger
    l.Log("hi")
}
```

**Hint:** What happens when the receiver is nil?

**Bug:** `l` is nil. Dereferencing `l.prefix` causes a runtime panic: `nil pointer dereference`.

**Fix (defensive):**

```go
func (l *Logger) Log(msg string) {
    if l == nil { return }
    fmt.Println(l.prefix, msg)
}
```

Or make the constructor mandatory: `NewLogger(prefix string) *Logger`.

---

## Bug 6 — Closure receiver

```go
type Service struct{ id int }
func (s *Service) Process() { fmt.Println("service", s.id) }

func main() {
    services := []*Service{{1}, {2}, {3}}
    callbacks := []func(){}

    for _, s := range services {
        callbacks = append(callbacks, s.Process)
    }

    for _, cb := range callbacks { cb() }
}
```

**Hint:** Go 1.21 and 1.22 differ.

**Bug:** In Go 1.21 and earlier, `s` is the same variable in every iteration — the `s.Process` method value binds to the final `s` each time. Output: `service 3` × 3.

In Go 1.22+ a new `s` is created each iteration — expected output: 1, 2, 3.

**Fix (1.21 and earlier):**

```go
for _, s := range services {
    s := s  // shadowing — fresh copy per iteration
    callbacks = append(callbacks, s.Process)
}
```

---

## Bug 7 — Using slice with struct copy

```go
type Stack struct{ items []int }
func (s Stack) Push(x int) { s.items = append(s.items, x) }

func main() {
    s := Stack{}
    s.Push(1); s.Push(2); s.Push(3)
    fmt.Println(s.items)  // ?
}
```

**Hint:** The behavior of `append`.

**Bug:** Value receiver — `s` is a copy. `append` either adds an element to the slice's underlying array or allocates a new array, but the change to `s.items` is preserved only in the local copy. The original `Stack` does not change. Output: `[]`.

**Fix:**

```go
func (s *Stack) Push(x int) { s.items = append(s.items, x) }
```

---

## Bug 8 — Goroutine receiver

```go
type Server struct{ count int }
func (s *Server) Handle() { s.count++ }

func main() {
    s := &Server{}
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            s.Handle()
        }()
    }
    wg.Wait()
    fmt.Println(s.count)  // ?
}
```

**Hint:** Race condition.

**Bug:** `s.count++` is not atomic. Race condition — the final count may be less than 1000. `go run -race` will detect it.

**Fix:**

```go
import "sync/atomic"

type Server struct{ count atomic.Int64 }
func (s *Server) Handle() { s.count.Add(1) }
// ...
fmt.Println(s.count.Load())
```

Or use `sync.Mutex`.

---

## Bug 9 — Method declaration on alias

```go
type Time = time.Time
func (t Time) IsLeap() bool { ... }
```

**Hint:** Defined type vs alias.

**Bug:** `type Time = time.Time` is an alias (with `=`). `time.Time` lives in another package — methods cannot be added to an alias. Compile error: `cannot define new methods on non-local type time.Time`.

**Fix:**

```go
type MyTime time.Time   // defined type (no =)
func (t MyTime) IsLeap() bool { ... }
```

---

## Bug 10 — Embedded interface conflict

```go
type Reader interface { Read() string }
type Writer interface { Read() string; Write() }

type ReadWriter interface { Reader; Writer }
```

**Hint:** Method names overlapping.

**Bug:** In Go 1.13 and earlier, `Reader.Read` and `Writer.Read` had to match exactly — otherwise a compile error. Go 1.14+ relaxed the rules: if the name and signature are identical, it is OK. Otherwise — error.

**Fix:** Make the signatures match, or rename the methods.

---

## Bug 11 — Receiver used as value, but pointer needed

```go
type DB struct{ conn *sql.DB }
func (d DB) Close() { d.conn.Close(); d.conn = nil }

func main() {
    db := DB{conn: openDB()}
    db.Close()
    db.conn.Ping()  // nil pointer panic? No!
}
```

**Hint:** Where is `d.conn = nil` stored?

**Bug:** Value receiver — `d` is a copy. `d.conn = nil` only affects the local copy. The original `db.conn` still exists (but it has been closed!). `db.conn.Ping()` returns a "use of closed connection" error.

**Fix:**

```go
func (d *DB) Close() { d.conn.Close(); d.conn = nil }
```

---

## Bug 12 — Method expression wrong type

```go
type Shape struct{}
func (s Shape) Area() float64 { return 1 }
func (s *Shape) Scale(f float64) { ... }

func main() {
    f := Shape.Scale  // ?
}
```

**Hint:** Pointer receiver and method expression.

**Bug:** `Shape.Scale` — the value type Shape does not have `Scale`. Compile error: `Shape.Scale undefined`.

**Fix:**

```go
f := (*Shape).Scale  // type: func(*Shape, float64)
```

---

## Bug 13 — Encapsulation external visibility

```go
package user

type User struct{
    name string
}

func (u User) GetName() string { return u.name }
```

```go
package main

import "user"

func main() {
    u := user.User{}
    fmt.Println(u.name)  // ?
}
```

**Hint:** Exported and private.

**Bug:** `name` is lowercase — it is not visible outside the package. Compile error: `u.name undefined (cannot refer to unexported field name)`.

**Fix:** Access via a method:

```go
fmt.Println(u.GetName())  // GetName is visible outside the package
```

Or use Go-style `Name()` (without the Get prefix):

```go
func (u User) Name() string { return u.name }
```

---

## Bug 14 — Method receiver in goroutine — wrong reference

```go
type Worker struct{ id int }
func (w Worker) Run() { fmt.Println("worker", w.id) }

func main() {
    workers := []Worker{{1}, {2}, {3}}
    for _, w := range workers {
        go w.Run()  // ?
    }
    time.Sleep(100*time.Millisecond)
}
```

**Hint:** Goroutine and loop variable. Check the Go version.

**Bug:**
- Go 1.21 and earlier: `w` is the same variable on every iteration. The `w.Run` method value takes a fresh copy each time (value receiver), so this is NOT A BUG — each worker runs with its own id. But if it were a pointer receiver — it would be a bug.
- Go 1.22+ — a new `w` per iteration. No bug at all.

**Explanation:** This exercise is a careful question — value vs pointer receiver and Go version both matter.

---

## Bug 15 — Recursive method call without termination

```go
type Linked struct{ next *Linked }
func (l *Linked) Last() *Linked {
    return l.next.Last()
}
```

**Hint:** No base case.

**Bug:** If `l.next` is nil — nil pointer dereference. It never terminates (or panics).

**Fix:**

```go
func (l *Linked) Last() *Linked {
    if l == nil || l.next == nil { return l }
    return l.next.Last()
}
```

---

## Bug 16 — Functional options misused

```go
type Server struct{ port int }

type Option func(*Server)

func WithPort(p int) Option { return func(s *Server) { s.port = p } }

func NewServer(opts ...Option) *Server {
    s := &Server{port: 80}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Usage
func main() {
    s := NewServer(WithPort)  // ?
}
```

**Hint:** `WithPort` requires an argument.

**Bug:** `WithPort` itself is `func(int) Option` — it takes an argument. `NewServer(WithPort)` — `WithPort` is not an Option but a function returning an Option. Compile error: `cannot use WithPort as Option`.

**Fix:**

```go
s := NewServer(WithPort(8080))  // call it and pass the resulting Option
```

---

## Bug 17 — Method on value does not add up

```go
type Money struct{ cents int }
func (m Money) Add(other Money) { m.cents += other.cents }

func main() {
    a := Money{cents: 100}
    b := Money{cents: 50}
    a.Add(b)
    fmt.Println(a.cents)  // ?
}
```

**Hint:** Value receiver behavior.

**Bug:** `Add` has a value receiver — `m.cents += other.cents` modifies the local copy. `a` is unaffected. Output: `100`.

**Fix (immutable style — return a new value):**

```go
func (m Money) Add(other Money) Money {
    return Money{cents: m.cents + other.cents}
}

a = a.Add(b)
```

Or use a pointer receiver:

```go
func (m *Money) Add(other Money) { m.cents += other.cents }
a.Add(b)
```

Money is a value object — typically the **immutable** style is preferred.

---

## Bug 18 — Method returning its own type

```go
type Builder struct{ parts []string }
func (b Builder) Add(s string) Builder {
    b.parts = append(b.parts, s)
    return b
}

func main() {
    b := Builder{}
    b.Add("a")
    b.Add("b")
    fmt.Println(b.parts)  // ?
}
```

**Hint:** The Builder method chain isn't keeping the returned value.

**Bug:** `Add` returns a new `Builder` (immutable), but the result of `b.Add("a")` is ignored. Output: `[]`.

**Fix:**

```go
b = b.Add("a").Add("b")
```

Or use a pointer receiver for a mutable builder:

```go
func (b *Builder) Add(s string) *Builder {
    b.parts = append(b.parts, s)
    return b
}
```

---

## Cheat Sheet

```
TYPICAL BUGS
─────────────────────────────
1. Value receiver mutates             → original unchanged
2. Pointer receiver on map element    → cannot take address
3. Mutex with value receiver          → race condition
4. Method set: Person ↔ *Person       → interface match fails
5. Nil pointer receiver               → panic (defensive coding)
6. Loop variable + method value       → Go 1.21 issue
7. Builder result ignored             → empty result
8. Adding methods cross-package       → compile error
9. Adding methods to an alias         → compile error
10. Embedded conflict                 → ambiguous selector

GO VET HELP
─────────────────────────────
go vet ./...        # catches most bugs
go run -race ./...  # race conditions
staticcheck ./...   # additional checks
```
