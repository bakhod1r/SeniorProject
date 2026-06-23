# Interface Internals — Find the Bug

Each exercise follows this format:
1. Buggy code
2. Hint
3. Identifying the bug and its cause
4. Fixed code

Every bug here exercises a real internal of `iface`/`eface`: the typed-nil layout, the itab cache, the comparison rules, the data word, or the escape behaviour of boxing.

---

## Bug 1 — Typed-nil error escape

```go
type MyErr struct{ msg string }
func (e *MyErr) Error() string { return e.msg }

func find(id int) error {
    var e *MyErr
    if id < 0 {
        e = &MyErr{msg: "bad id"}
    }
    return e // ?
}

func main() {
    if err := find(7); err != nil {
        fmt.Println("error:", err) // prints — but why?
    }
}
```

**Hint:** Inspect the two words inside the `error` interface header.

**Bug:** Even when `e == nil`, the return statement wraps it into an `error` interface whose type word is `*MyErr` (non-nil) and whose data word is nil. The interface comparison `err != nil` only returns false when **both** words are zero. Output: `error: <nil>`.

**Fix:**

```go
func find(id int) error {
    if id < 0 {
        return &MyErr{msg: "bad id"}
    }
    return nil // explicit untyped nil — type word stays zero
}
```

Rule: never return a typed-nil pointer through an interface return type.

---

## Bug 2 — Comparing slices through `any`

```go
func cacheGet(key any, store map[any]int) (int, bool) {
    v, ok := store[key]
    return v, ok
}

func main() {
    store := map[any]int{}
    store[[]byte("alpha")] = 1 // ?
}
```

**Hint:** What does the map use to find a bucket?

**Bug:** Map keys must be comparable. The interface layer hides the underlying `[]byte`. At runtime the lookup tries `==` on the stored slice and panics: `runtime error: hash of unhashable type []uint8`.

**Fix:**

```go
store := map[string]int{}
store[string([]byte("alpha"))] = 1 // string is comparable
```

Or wrap the slice into a struct that contains a comparable key.

---

## Bug 3 — itab cache thrash from a generated type

```go
type Handler interface{ Handle(int) }

func makeHandler(name string) Handler {
    type local struct{ id string } // declared inside the function
    h := &localImpl{name: name}
    return h
}
```

**Hint:** Each call site sees a fresh type — what about the itab?

**Bug:** Types declared inside a function are still per-package, but generated types (via reflect.StructOf or via plugin loading) create a new `*_type` every call. The runtime allocates a fresh itab for each pair, blowing the global `itabTable`. Memory grows without bound and lookups slow down.

**Fix:** Move the type declaration to package scope — the runtime then caches a single itab for `(Handler, *localImpl)`.

```go
type localImpl struct{ name string }
func (l *localImpl) Handle(int) {}

func makeHandler(name string) Handler { return &localImpl{name: name} }
```

---

## Bug 4 — `reflect.DeepEqual` on typed-nil

```go
type MyErr struct{}
func (*MyErr) Error() string { return "x" }

func main() {
    var a error = (*MyErr)(nil)
    var b error
    fmt.Println(a == b)                  // false
    fmt.Println(reflect.DeepEqual(a, b)) // false
}
```

**Hint:** Both feel "nil". Why are they unequal?

**Bug:** `a` has `typ=*MyErr, data=nil`. `b` has `typ=nil, data=nil`. Neither `==` nor `DeepEqual` walks past the type word — different types means not equal. The "they are both nil" intuition is wrong because the interface layout disagrees.

**Fix:** Normalise typed-nils before comparison:

```go
func isNilErr(e error) bool {
    if e == nil { return true }
    v := reflect.ValueOf(e)
    return v.Kind() == reflect.Ptr && v.IsNil()
}
```

---

## Bug 5 — Boxing in a hot loop

```go
type Logger interface{ Log(any) }

type stdoutLogger struct{}
func (stdoutLogger) Log(v any) { fmt.Println(v) }

func process(log Logger, ids []int) {
    for _, id := range ids {
        log.Log(id) // ?
    }
}
```

**Hint:** Run with `-gcflags='-m=2' -benchmem`.

**Bug:** Every iteration packs `id` (an int) into an `any`. Because `int` is not a pointer, the runtime must allocate so the data word can hold its address. With 1M ids that is 1M tiny allocations — GC pressure plus 24 MB of garbage.

**Fix:** Specialise the hot interface, or pass a pre-built buffer.

```go
type IntLogger interface{ LogInt(int) }
func (stdoutLogger) LogInt(v int) { fmt.Println(v) }
```

Avoids boxing entirely.

---

## Bug 6 — Comparing function-valued interfaces

```go
type Callback any

func register(cbs []Callback, cb Callback) []Callback {
    for _, c := range cbs {
        if c == cb { // ?
            return cbs
        }
    }
    return append(cbs, cb)
}

func main() {
    var list []Callback
    list = register(list, func() {})
    list = register(list, func() {})
}
```

**Hint:** What does the spec say about `==` on functions?

**Bug:** Function values are uncomparable. Wrapping them inside `any` does not change that — the `==` check inspects the data word's underlying type, sees `func()`, and panics: `runtime error: comparing uncomparable type func()`.

**Fix:** Compare by stable identity (a name, an id), or use `reflect.ValueOf(c).Pointer()`:

```go
if reflect.ValueOf(c).Pointer() == reflect.ValueOf(cb).Pointer() { ... }
```

`Pointer()` returns the function's code address.

---

## Bug 7 — Method set surprise on the data word

```go
type Speaker interface{ Speak() string }

type Dog struct{ name string }
func (d *Dog) Speak() string { return d.name }

func main() {
    d := Dog{name: "rex"}
    var s Speaker = d // ?
    fmt.Println(s.Speak())
}
```

**Hint:** Where does the method live?

**Bug:** `Speak` has a pointer receiver — its address is in the method set of `*Dog`, not `Dog`. The compiler refuses to build the iface header because there is no itab for `(Speaker, Dog)`. Compile error: `Dog does not implement Speaker (Speak method has pointer receiver)`.

**Fix:**

```go
var s Speaker = &d // *Dog has Speak in its method set
```

The data word now holds the pointer itself — no boxing copy needed.

---

## Bug 8 — Stale data after slicing through an interface

```go
type Container interface{ Items() []int }

type box struct{ items []int }
func (b box) Items() []int { return b.items }

func main() {
    b := box{items: []int{1, 2, 3}}
    var c Container = b // copies into the interface
    b.items = append(b.items, 4)
    fmt.Println(c.Items()) // ?
}
```

**Hint:** Where does `data` point?

**Bug:** Because `box` is not a pointer, putting it into a `Container` boxes a copy. The interface's data word references that copy. Mutating `b.items` through the original variable does not reach the boxed instance. Output: `[1 2 3]`. (And the underlying array still backs both — until `append` reallocates, which is the part that hides the bug for small inputs.)

**Fix:** Use a pointer receiver/method, or pass `&b`:

```go
type box struct{ items []int }
func (b *box) Items() []int { return b.items }

var c Container = &b // shared state — no copy
```

---

## Bug 9 — `reflect.Value.Interface()` on an unexported field

```go
type Secret struct{ token string }

func dump(v any) {
    rv := reflect.ValueOf(v).Elem()
    for i := 0; i < rv.NumField(); i++ {
        f := rv.Field(i)
        fmt.Println(f.Interface()) // ?
    }
}

func main() { dump(&Secret{token: "shh"}) }
```

**Hint:** Reflection respects export rules.

**Bug:** `token` is unexported. `Field(i).Interface()` panics: `reflect.Value.Interface: cannot return value obtained from unexported field or method`. The internal `flagRO` bit on the reflect value prevents construction of an interface that would expose it.

**Fix:** Skip unexported fields, or use `unsafe` deliberately:

```go
if !f.CanInterface() { continue }
fmt.Println(f.Interface())
```

---

## Bug 10 — itab pressure in a switch ladder

```go
type Shape interface{ Area() float64 }

func describe(s Shape) string {
    if c, ok := s.(Circle);    ok { return "circle"    }
    if r, ok := s.(Rectangle); ok { return "rectangle" }
    if t, ok := s.(Triangle);  ok { return "triangle"  }
    if h, ok := s.(Hexagon);   ok { return "hexagon"   }
    return "?"
}
```

**Hint:** How many itab lookups per call?

**Bug:** Each `s.(X)` assertion forces a separate itab lookup. The runtime hashes `(Shape, X)` and probes `itabTable` four times per call. Under load that adds up to a measurable cost — and worse, the compiler cannot fold the checks together.

**Fix:** Use a single type switch — the compiler emits one dispatch table:

```go
switch s.(type) {
case Circle:    return "circle"
case Rectangle: return "rectangle"
case Triangle:  return "triangle"
case Hexagon:   return "hexagon"
default:        return "?"
}
```

---

## Bug 11 — Escape regression from a method value

```go
type Worker struct{ id int }
func (w *Worker) Do() {}

func schedule(w *Worker, q chan func()) {
    q <- w.Do // ?
}
```

**Hint:** What is the lifetime of the closure?

**Bug:** `w.Do` is a method value — a closure that captures `w`. Sending it through a channel makes the closure escape; the compiler must heap-allocate it (and the bound receiver) so it survives until the consumer runs it. Replacing `w` thousands of times per second causes garbage churn.

**Fix:** Pass the receiver explicitly through a method expression:

```go
q <- func() { (*Worker).Do(w) }
```

Better: redesign the queue to accept `(*Worker, action)` pairs and avoid closures entirely.

---

## Bug 12 — Comparing channels with different capacity

```go
func main() {
    a := make(chan int, 1)
    b := make(chan int, 2)
    var x any = a
    var y any = b
    fmt.Println(x == y) // ?
}
```

**Hint:** Channels are comparable. Are these the "same" channel?

**Bug:** Channels compare by identity (the underlying `hchan` pointer), not by capacity. This program prints `false`, but the intent is often "are they the same channel?", which the test does answer. The bug is reading too much into a `false`: many programmers assume a `true` for "structurally equal channels", which never happens. Channels with the same capacity but different make calls compare unequal.

**Fix:** Document intent. If you really need structural equality, compare `cap`/`len` explicitly. Do not let `any`-wrapped channels lull you into believing the comparison is value-based.

---

## Bug 13 — Sliced data word survives a clear

```go
type Box interface{ Get() []byte }

type box struct{ data []byte }
func (b *box) Get() []byte { return b.data }

func clear(b *box) { b.data = nil }

func main() {
    b := &box{data: []byte("payload")}
    var bx Box = b
    clear(b)
    fmt.Println(string(bx.Get())) // ?
}
```

**Hint:** Where is the slice header stored?

**Bug:** This one is actually correct, contrary to a common belief. `bx` holds a pointer to `b`, not a copy of its slice — calling `bx.Get()` re-reads `b.data`, which is now nil. Output: empty string. The trap is the opposite case: if `box.Get` had a value receiver, `bx` would have boxed a copy of the original slice header and `clear` would not affect the boxed copy.

**Fix (when you wanted isolation):** Use a value receiver and a value receiver for the interface binding, or copy the slice contents explicitly. Be deliberate about whether the interface boxes a snapshot or a live reference.

---

## Bug 14 — Nil interface vs nil concrete

```go
func wrap(p *int) any {
    return p
}

func main() {
    var p *int
    a := wrap(p)
    if a == nil {
        fmt.Println("nil")
    } else {
        fmt.Println("not nil") // prints
    }
}
```

**Hint:** Same shape as Bug 1, different costume.

**Bug:** `wrap(p)` produces an `any` with type `*int` and data nil. The check `a == nil` requires both interface words to be zero, so it fails.

**Fix:** Either return `nil` explicitly, or check the underlying value:

```go
func wrap(p *int) any {
    if p == nil { return nil }
    return p
}
```

Or at the call site:

```go
if v, ok := a.(*int); ok && v == nil { /* ... */ }
```

---

## Bug 15 — Boxing changes JSON output

```go
type Stamp time.Time

func (s Stamp) MarshalJSON() ([]byte, error) {
    return []byte(`"` + time.Time(s).Format(time.RFC3339) + `"`), nil
}

func main() {
    s := Stamp(time.Now())
    var v any = s
    out, _ := json.Marshal(v) // ?
    fmt.Println(string(out))
}
```

**Hint:** How does `json.Marshal` discover the marshaler interface?

**Bug:** `MarshalJSON` is on the value receiver `Stamp`, which is fine. The trap appears when authors mix and match: define `MarshalJSON` on `*Stamp` and then put `Stamp` into `any`. The interface holds a `Stamp`, not a `*Stamp`, so the marshaler interface is never satisfied — the encoder falls back to default struct marshalling.

**Fix:** Either declare the method on the value receiver, or wrap a pointer:

```go
var v any = &s // *Stamp now satisfies json.Marshaler
```

The fix is the same lesson as Bug 7: the data word's static method set determines satisfaction.

---

## Cheat Sheet

```
INTERFACE INTERNALS BUG LIST
─────────────────────────────
1. Typed nil through interface return  → err != nil even when "nil"
2. Slice/map/func key in any           → comparison panic
3. Per-call generated types            → itab table grows unbounded
4. DeepEqual across nil-types          → false (type word differs)
5. Boxing primitives in hot loops      → heap allocs everywhere
6. Function values compared            → panic
7. Pointer-receiver methods on value   → does not implement interface
8. Value receiver boxes a copy         → mutations not visible
9. Reflect on unexported fields        → CanInterface == false
10. Many one-off type assertions       → repeated itab lookups
11. Method value on hot path           → closure escapes
12. Channel == is identity, not value  → easy to misread
13. Pointer-receiver interfaces are live → clear() is visible
14. Wrapping a nil pointer in any      → typed-nil trap
15. Marshaler on wrong receiver        → silent fallback

DEBUG FLAGS
─────────────────────────────
go vet ./...                          # finds many of the above
go build -gcflags='-m=2'              # escape analysis output
go test -bench . -benchmem            # alloc/op spikes ⇒ boxing
go tool objdump | grep CALL runtime   # itab/getitab calls
```
