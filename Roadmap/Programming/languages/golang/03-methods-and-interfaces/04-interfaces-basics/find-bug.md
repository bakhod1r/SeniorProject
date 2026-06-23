# Interfaces Basics — Find the Bug

## Bug 1 — Pointer receiver method, value satisfies?
```go
type I interface { M() }

type T struct{}
func (t *T) M() {}

var i I = T{}
```
**Bug:** Compile error. M is not in T's method set (pointer receiver).
**Fix:** `var i I = &T{}`.

---

## Bug 2 — nil interface
```go
type MyErr struct{}
func (e *MyErr) Error() string { return "err" }

func doit() error {
    var e *MyErr
    return e
}

err := doit()
if err != nil {
    fmt.Println("got error")
}
```
**Bug:** Outputs `got error`. The interface (type: *MyErr, value: nil) is NOT nil.
**Fix:**
```go
func doit() error {
    var e *MyErr
    if e == nil { return nil }
    return e
}
```

---

## Bug 3 — Comparison panic
```go
type S struct{ items []int }

var i, j any = S{items: []int{1}}, S{items: []int{1}}
fmt.Println(i == j)
```
**Bug:** Runtime panic. S is not comparable (it has a slice field).
**Fix:** Custom Equal method or change the type.

---

## Bug 4 — A new method was added
```go
// v1
type Repo interface { Find(id string) (*User, error) }

// Concrete
type Mock struct{}
func (m *Mock) Find(id string) (*User, error) { return nil, nil }

// v2 — new method added
type Repo interface {
    Find(id string) (*User, error)
    Save(u *User) error   // NEW
}
```
**Bug:** Mock does not have a Save method — compile error.
**Fix:** Add Save to Mock or create a new interface.

---

## Bug 5 — fmt.Sprint inside Stringer
```go
type X struct{ name string }
func (x X) String() string {
    return fmt.Sprint(x)   // RECURSION
}
```
**Bug:** `fmt.Sprint(x)` calls `String()` — infinite recursion → stack overflow.
**Fix:**
```go
func (x X) String() string {
    return "X{" + x.name + "}"
}
```

---

## Bug 6 — Interface receiver
```go
type I interface { M() }
func (i I) Helper() { ... }
```
**Bug:** Compile error. You cannot add a method to an interface type.
**Fix:** Add the method to a concrete type.

---

## Bug 7 — Type assertion mismatch
```go
var i any = 42
s := i.(string)
```
**Bug:** Runtime panic — i is an int.
**Fix:**
```go
s, ok := i.(string)
if !ok { /* handle */ }
```

---

## Bug 8 — Mixed receiver interface
```go
type S struct{}
func (s S)  Read() {}
func (s *S) Write() {}

type RW interface { Read(); Write() }

var x RW = S{}
```
**Bug:** Write is not in S's method set (pointer receiver).
**Fix:** `var x RW = &S{}`.

---

## Bug 9 — Interface bloat
```go
type FullStorage interface {
    Read(...) ...
    Write(...) ...
    Delete(...) ...
    List(...) ...
    Backup(...) ...
    Restore(...) ...
    Verify(...) ...
    Migrate(...) ...
}
```
**Bug:** Bloat — ISP is violated. Mocking is hard, and small consumers are forced to implement many methods.
**Fix:** Granular interfaces with composition:
```go
type Reader interface { Read(...) ... }
type Writer interface { Write(...) ... }
// ...
```

---

## Bug 10 — Same name, different signatures
```go
type A interface { M() }
type B interface { M() string }

type AB interface { A; B }
```
**Bug:** Compile error — incompatible methods.
**Fix:** Make the signatures compatible or rename them.

---

## Bug 11 — Empty interface comparison
```go
var i any = func() {}
var j any = func() {}
fmt.Println(i == j)
```
**Bug:** Runtime panic — functions are not comparable.
**Fix:** Do not use `==` on functions. If you need an identity check — use a different approach.

---

## Bug 12 — Compile-time check missing
```go
type Reader interface { Read([]byte) (int, error) }

type MyReader struct{}
func (r *MyReader) Read(p []byte) (int, error) { return 0, nil }

// Usage
func process(r Reader) { r.Read(nil) }
process(&MyReader{})
```
**Not a bug, but missing best practice:** No compile-time check.
**Improvement:**
```go
var _ Reader = (*MyReader)(nil)
```

---

## Bug 13 — Returning concrete type vs interface
```go
func NewLogger() Logger {
    return &ConsoleLogger{}
}

func main() {
    l := NewLogger()
    l.SpecialMethod()   // Logger interface has no SpecialMethod
}
```
**Bug:** The caller works with the `Logger` interface — concrete methods cannot be used.
**Fix:** Return concrete:
```go
func NewLogger() *ConsoleLogger { return &ConsoleLogger{} }
```

Or use a type assertion:
```go
if cl, ok := l.(*ConsoleLogger); ok {
    cl.SpecialMethod()
}
```

---

## Bug 14 — Interface embedding loop
```go
type A interface { B }
type B interface { A }
```
**Bug:** Compile error — circular embedding.
**Fix:** Make the hierarchy explicit.

---

## Bug 15 — Method on a non-defined type
```go
type myInt = int   // alias
func (m myInt) Double() myInt { return m * 2 }
```
**Bug:** Compile error. You cannot add methods to an alias.
**Fix:**
```go
type myInt int    // defined type
func (m myInt) Double() myInt { return m * 2 }
```

---

## Bug 16 — Assigning concrete to interface
```go
type Logger interface { Log(string) }

type FullLogger struct{}
func (FullLogger) Log(string)        {}
func (FullLogger) Stats() Stats      { return Stats{} }

func main() {
    var l Logger = FullLogger{}
    l.Stats()   // Logger has no Stats
}
```
**Bug:** Compile error.
**Fix:**
```go
fl := FullLogger{}
fl.Stats()  // use the concrete type
```

---

## Bug 17 — nil interface dereference
```go
type Service interface { Do() }

var s Service
s.Do()
```
**Bug:** Panic — nil interface dispatch.
**Fix:** Nil check or always initialize.

---

## Bug 18 — Returning nil interface with concrete
```go
func loadConfig() Config {
    return nil   // even though Config is an interface, no concrete type is provided
}
```
**Bug:** Compile error if Config is an interface — a `nil` concrete type is required.
Or — in the interface case it is OK, but the caller can check `c == nil`.

---

## Bug 19 — Method receiver name inconsistency
```go
type Server struct{}
func (s *Server) Start() {}
func (server *Server) Stop() {}
```
**Not a bug, but a style issue:** Receiver names should be consistent.
**Fix:** Use `s` everywhere.

---

## Bug 20 — Big interface mock
```go
type MegaService interface {
    Method1()
    Method2()
    // ... 20 methods
}

type Mock struct{}
func (Mock) Method1() {}
func (Mock) Method2() {}
// ... must implement 20 methods
```
**Not a bug, but a practical problem:** Testing is hard.
**Fix:** Granular interfaces:
```go
type Reader interface { Read() }
type Writer interface { Write() }
// ...
type MegaService interface { Reader; Writer; ... }

// Mock only the small interfaces you need
```
