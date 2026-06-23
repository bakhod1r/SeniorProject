# Value Receivers — Find the Bug

## Bug 1 — Mutation does not work
```go
type C struct{ n int }
func (c C) Inc() { c.n++ }

c := C{}
c.Inc()
fmt.Println(c.n)  // ?
```
**Bug:** Value receiver — the copy is mutated. Output: `0`.
**Fix:** Pointer receiver, or return: `func (c C) Inc() C { c.n++; return c }`.

---

## Bug 2 — Mutex value receiver
```go
type X struct{ mu sync.Mutex; n int }
func (x X) Inc() { x.mu.Lock(); defer x.mu.Unlock(); x.n++ }
```
**Bug:** The mutex is copied on every call. There is no synchronization.
**Fix:** Pointer receiver.

---

## Bug 3 — Slice append is local
```go
type S struct{ items []int }
func (s S) Add(x int) { s.items = append(s.items, x) }

s := S{}
s.Add(1); s.Add(2)
fmt.Println(s.items)  // ?
```
**Bug:** `append` mutates the local slice header. Output: `[]`.
**Fix:** Pointer receiver, or return.

---

## Bug 4 — Slice index does take effect
```go
type Box struct{ items []int }
func (b Box) ZeroFirst() { b.items[0] = 0 }

box := Box{items: []int{1, 2, 3}}
box.ZeroFirst()
fmt.Println(box.items)  // ?
```
**Not a bug, but a nuance:** Output `[0 2 3]`. The slice header is copied, but the underlying array is shared.

---

## Bug 5 — Map mutation
```go
type Cache struct{ m map[string]string }
func (c Cache) Set(k, v string) { c.m[k] = v }

c := Cache{m: map[string]string{}}
c.Set("a", "1")
fmt.Println(c.m)
```
**Not a bug:** The map header is copied, but the underlying map is shared. Output: `map[a:1]`.

---

## Bug 6 — Comparison error
```go
type S struct{ items []int }

a := S{items: []int{1}}
b := S{items: []int{1}}
fmt.Println(a == b)
```
**Bug:** Compile error. `S` is not comparable (slice field).
**Fix:** Custom `Equal` method:
```go
func (a S) Equal(b S) bool { ... }
```

---

## Bug 7 — Map key non-comparable
```go
type S struct{ items []int }
m := map[S]int{}
```
**Bug:** Compile error: invalid map key type `S`.
**Fix:** Make `S` comparable, or use an ID as the map key.

---

## Bug 8 — Nil interface vs nil concrete
```go
type MyErr struct{ msg string }
func (e MyErr) Error() string { return e.msg }

func doIt() error {
    var e *MyErr   // nil
    return e
}

err := doIt()
fmt.Println(err == nil)  // ?
```
**Bug:** Output `false`. The interface value contains `(*MyErr, nil)` — the type is set, the value is nil. The interface value itself is not nil.
**Fix:**
```go
func doIt() error {
    var e *MyErr
    if e == nil { return nil }
    return e
}
```

---

## Bug 9 — Discarding the wither result
```go
type Config struct{ port int }
func (c Config) WithPort(p int) Config { c.port = p; return c }

cfg := Config{}
cfg.WithPort(8080)   // result ignored
fmt.Println(cfg.port)  // ?
```
**Bug:** Output `0`. The wither method's return value was discarded.
**Fix:** `cfg = cfg.WithPort(8080)`.

---

## Bug 10 — Mutation through a pointer field
```go
type Holder struct{ p *int }
func (h Holder) Zero() { *h.p = 0 }

n := 5
h := Holder{p: &n}
h.Zero()
fmt.Println(n)
```
**Not a bug:** Output `0`. Through the pointer field, the original `n` is affected.

---

## Bug 11 — Array vs slice
```go
type S struct{ data [3]int }
func (s S) Modify() { s.data[0] = 99 }

s := S{data: [3]int{1, 2, 3}}
s.Modify()
fmt.Println(s.data)
```
**Bug:** Arrays have value semantics (NOT slices). Output: `[1 2 3]` (no effect).
**Fix:** Pointer receiver.

---

## Bug 12 — Mixed receiver method set
```go
type S struct{}
func (s S)  Read()  {}
func (s *S) Write() {}

type RW interface { Read(); Write() }

var _ RW = S{}
```
**Bug:** Compile error. `S`'s method set does not include `Write` (pointer receiver).
**Fix:** `var _ RW = &S{}`.

---

## Bug 13 — Loop variable + value method
```go
items := []Item{{1}, {2}}
fns := []func(){}
for _, item := range items {
    fns = append(fns, func() { fmt.Println(item.id) })
}
for _, f := range fns { f() }
```
**Bug (Go 1.21 and earlier):** `item` is the same variable across iterations. The closures all point to the last `item`. Output: `2 2`.
**Go 1.22+:** Output `1 2`.

---

## Bug 14 — Equality on float
```go
a := Vec2{0.1 + 0.2, 0}
b := Vec2{0.3, 0}
fmt.Println(a == b)
```
**Bug:** Float arithmetic — `0.1 + 0.2 != 0.3` exactly. Output: `false`.
**Fix:** Approximate equality method.

---

## Bug 15 — String concatenation in method
```go
type Logger struct{ prefix string }
func (l Logger) Log(msg string) {
    l.prefix += " "  // mutates locally
    fmt.Println(l.prefix + msg)
}
```
**Not a bug, but a nuance:** `prefix` is mutated locally — the original `l.prefix` is not changed across calls. OK in this context.

---

## Bug 16 — Incorrect interface usage
```go
type Stringer interface { String() string }

type S struct{}
func (s S) String() string { return "S" }

var x interface{} = S{}
y := x.(Stringer)   // OK
fmt.Println(y.String())
```
**Not a bug:** The type assertion works. `S`'s method set contains `String`.

---

## Bug 17 — Returning sliced data
```go
type Box struct{ items []int }
func (b Box) GetItems() []int { return b.items }

box := Box{items: []int{1, 2, 3}}
items := box.GetItems()
items[0] = 99
fmt.Println(box.items)  // ?
```
**Bug:** Output `[99 2 3]`. The slice is shared.
**Fix:** Defensive copy:
```go
func (b Box) GetItems() []int {
    out := make([]int, len(b.items))
    copy(out, b.items)
    return out
}
```

---

## Bug 18 — Time addition
```go
t := time.Now()
t.Add(time.Hour)
fmt.Println(t)  // one hour later?
```
**Bug:** `Add` is a value receiver — it returns a new value. The original `t` is not changed. Output: original time.
**Fix:** `t = t.Add(time.Hour)`.

---

## Bug 19 — Nil receiver in value method
```go
type S struct{ n int }
func (s S) M() int { return s.n }

var p *S = nil
fmt.Println(p.M())  // ?
```
**Bug:** Panic. Value receiver — Go performs `(*p).M()`. `*p` is a nil dereference.
**Fix:** Pointer receiver with a nil check.

---

## Bug 20 — Hash on slice
```go
type S struct{ items []int }
m := map[S]int{}   // ?
```
**Bug:** Compile error. `S` is not comparable.
**Fix:** Create a comparable type, or use an ID as the key.
