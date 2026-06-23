# Pointer Receivers — Find the Bug

---

## Bug 1 — Mutation isn't working

```go
type C struct{ n int }
func (c C) Inc() { c.n++ }

c := C{}
c.Inc(); c.Inc()
fmt.Println(c.n)  // ?
```

**Bug:** Value receiver — the copy is mutated. Output: `0`.

**Fix:** `func (c *C) Inc()`.

---

## Bug 2 — Map element

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

m := map[string]C{"k": {}}
m["k"].Inc()
```

**Bug:** Compile error. Map element is not addressable.

**Fix:**
```go
v := m["k"]; v.Inc(); m["k"] = v
// or: map[string]*C
```

---

## Bug 3 — Mutex value receiver

```go
type X struct{ mu sync.Mutex; n int }
func (x X) Inc() {
    x.mu.Lock(); defer x.mu.Unlock()
    x.n++
}
```

**Bug:** Value receiver — the mutex and `n` are copied on every call. No synchronization. Race condition.

**Fix:** `func (x *X) Inc()`.

---

## Bug 4 — Interface mismatch

```go
type Greeter interface { Greet() string }

type P struct{ name string }
func (p *P) Greet() string { return "hi " + p.name }

var g Greeter = P{name: "Alice"}
```

**Bug:** Compile error. `Greet` has a pointer receiver — it's not in `P`'s method set. `*P` is required.

**Fix:** `var g Greeter = &P{name: "Alice"}`.

---

## Bug 5 — Nil panic

```go
type L struct{ prefix string }
func (l *L) Log(msg string) { fmt.Println(l.prefix, msg) }

var l *L
l.Log("hi")
```

**Bug:** `l == nil` — `l.prefix` panics.

**Fix:**
```go
func (l *L) Log(msg string) {
    if l == nil { return }
    fmt.Println(l.prefix, msg)
}
```

---

## Bug 6 — Slice mutation

```go
type S struct{ items []int }
func (s S) Add(x int) { s.items = append(s.items, x) }

s := S{}
s.Add(1); s.Add(2)
fmt.Println(s.items)  // ?
```

**Bug:** Value receiver — `s` is a copy. `append` affects the local slice. Output: `[]`.

**Fix:** `func (s *S) Add(x int)`.

---

## Bug 7 — Pointer escape

```go
func makeCounter() *Counter {
    c := Counter{}
    return &c
}
```

**Not a bug, but a nuance:** `c` escapes to the heap (returning a pointer). This is OK, but the user should know. `go build -gcflags='-m'` will print a notice.

---

## Bug 8 — Method value loop

```go
services := []*Service{{1}, {2}, {3}}
callbacks := []func(){}
for _, s := range services {
    callbacks = append(callbacks, s.Process)
}
for _, cb := range callbacks { cb() }
```

**Bug (Go 1.21 and earlier):** `s` is the same on each iteration. The method value retains the `s` pointer — all callbacks bind to the last service.

**Fix (Go 1.21):**
```go
for _, s := range services {
    s := s  // shadow
    callbacks = append(callbacks, s.Process)
}
```

Go 1.22+ — this bug is gone.

---

## Bug 9 — DB Close local

```go
type DB struct{ conn *sql.DB }
func (d DB) Close() { d.conn.Close(); d.conn = nil }

db := DB{conn: openDB()}
db.Close()
db.conn.Ping()  // ?
```

**Bug:** `Close` has a value receiver — `d.conn = nil` only affects the local copy. `db.conn` still exists (closed). `Ping` returns "use of closed connection".

**Fix:** `func (d *DB) Close()`.

---

## Bug 10 — Pointer to interface

```go
type I interface { M() }
func (i *I) Helper() {}
```

**Bug:** Compile error. You can't add a method to an interface type (or to its pointer).

**Fix:** Add the method to a concrete type.

---

## Bug 11 — Embedded mutex copy

```go
type Base struct{ mu sync.Mutex }
type S struct { Base }

s1 := S{}
s2 := s1  // ?
```

**Bug:** When `s1` is copied, `Base` is too — the mutex is copied. `go vet` says "passes lock by value".

**Fix:** Pointer embed — `type S struct { *Base }` or a `noCopy` marker.

---

## Bug 12 — Mixed receivers

```go
type Buffer struct{ data []byte }
func (b Buffer)  Len() int      { return len(b.data) }
func (b *Buffer) Write(p []byte) { b.data = append(b.data, p...) }
```

**Not a bug, but bad design:** The method set is inconsistent. The caller can get confused.

**Fix:** All pointer (Buffer is stateful):
```go
func (b *Buffer) Len() int { return len(b.data) }
```

---

## Bug 13 — Variadic interface satisfaction

```go
type Writer interface { Write(p []byte) (int, error) }

type B struct{}
func (b B) Write(p []byte) (int, error) { return len(p), nil }

func main() {
    var w Writer = B{}  // ?
    w.Write([]byte("hi"))
}
```

**Not a bug:** Value receiver — `Write` is in `B`'s method set — OK.

But using `*B` is conventional:
```go
var w Writer = &B{}
```

---

## Bug 14 — Constructor return value

```go
func NewC() Counter { return Counter{} }

c := NewC()
c.Inc()  // pointer receiver
```

**Not a bug, but:** Constructors usually return `*T`, so the caller is ready if mutation is needed in the future:

```go
func NewC() *Counter { return &Counter{} }
```

---

## Bug 15 — Method value escape

```go
func register(handlers map[string]func()) {
    s := &Service{}
    handlers["x"] = s.Handle
}
```

**Not a bug:** `s` escapes to the heap — this is necessary because the callback must hold onto `s`. `go build -gcflags='-m'` shows: "s.Handle escapes to heap".

---

## Bug 16 — Receiver shadowing

```go
type C struct{ n int }
func (c *C) Inc() {
    c := *c    // shadow!
    c.n++
}
```

**Bug:** The inner `c` is a copy. `c.n++` only mutates the copy.

**Fix:** Don't shadow:
```go
func (c *C) Inc() { c.n++ }
```

---

## Bug 17 — Goroutine race

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

c := &Counter{}
for i := 0; i < 100; i++ { go c.Inc() }
time.Sleep(time.Second)
fmt.Println(c.n)
```

**Bug:** Race condition — `c.n++` is not atomic. `go run -race` will catch it.

**Fix:** Mutex or atomic:
```go
type Counter struct{ n atomic.Int64 }
func (c *Counter) Inc() { c.n.Add(1) }
```

---

## Bug 18 — `&` in the wrong place

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

func process(c C) {
    (&c).Inc()  // ?
}

c := C{}
process(c)
fmt.Println(c.n)  // ?
```

**Bug:** `process` accepts `c` by value — a copy. `&c` is the address of the local copy. The original `c` doesn't change. Output: `0`.

**Fix:** Have `process` accept `c *C` or return the value.

---

## Bug 19 — Pointer to local in goroutine

```go
func startWorker() {
    counter := 0
    go func() {
        for i := 0; i < 100; i++ { counter++ }
    }()
    fmt.Println(counter)
}
```

**Bug:** Race condition — the goroutine reads and writes `counter`, and so does the main goroutine. No synchronization.

**Fix:** Channel or atomic.

---

## Bug 20 — Method on alias type

```go
type Time = time.Time
func (t Time) IsLeap() bool { return t.Year()%4 == 0 }
```

**Bug:** `time.Time` is in another package. You can't add methods to an alias. Compile error.

**Fix:** Defined type:
```go
type MyTime time.Time
func (t MyTime) IsLeap() bool { ... }
```
