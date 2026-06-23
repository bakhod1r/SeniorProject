# Type Assertions — Find the Bug

## Bug 1 — Single-value panic
```go
var i any = "hello"
n := i.(int)
```
**Bug:** Panic — string, not int.
**Fix:** `n, ok := i.(int); if !ok { ... }`.

---

## Bug 2 — Wrapped error
```go
type MyErr struct{}
func (e *MyErr) Error() string { return "err" }

err := fmt.Errorf("wrap: %w", &MyErr{})
e, ok := err.(*MyErr)
```
**Bug:** `ok=false`. Wrapped — direct assertion ishlamaydi.
**Fix:** `var e *MyErr; errors.As(err, &e)`.

---

## Bug 3 — Pointer mismatch
```go
type T struct{}
var i any = T{}
p, ok := i.(*T)
```
**Bug:** `ok=false`. The value is T, not *T.
**Fix:** `v, ok := i.(T)` or `var i any = &T{}`.

---

## Bug 4 — nil interface assertion
```go
var i any = nil
v := i.(int)
```
**Bug:** Panic.
**Fix:** Two-value form.

---

## Bug 5 — Polymorphism via assertion
```go
func process(x any) {
    if a, ok := x.(*A); ok { a.Method() }
    if b, ok := x.(*B); ok { b.Method() }
    if c, ok := x.(*C); ok { c.Method() }
}
```
**Bug:** Anti-pattern.
**Fix:** Interface:
```go
type Processor interface { Method() }
func process(p Processor) { p.Method() }
```

---

## Bug 6 — Interface conversion forgotten
```go
type Reader interface { Read([]byte) (int, error) }
type Closer interface { Close() error }

func handleReader(r Reader) {
    r.Close()  // Reader has no Close method
}
```
**Bug:** Compile error.
**Fix:**
```go
if c, ok := r.(Closer); ok { c.Close() }
```

---

## Bug 7 — JSON number type
```go
var data any
json.Unmarshal([]byte(`{"age": 30}`), &data)
m := data.(map[string]any)
age := m["age"].(int)   // ?
```
**Bug:** Panic. JSON sonlar — `float64`.
**Fix:** `age := int(m["age"].(float64))`.

---

## Bug 8 — Map value missing
```go
m := map[string]any{}
v := m["missing"].(string)
```
**Bug:** `m["missing"]` nil interface — single-value panic.
**Fix:**
```go
v, ok := m["missing"]
if !ok { return }
s, _ := v.(string)
```

---

## Bug 9 — Type assertion forwarding
```go
func handle(x any) {
    if s, ok := x.(string); ok {
        process(x)   // x — any, s — string
    }
}
```
**Not a bug, but a style issue:** use `s` instead.
**Fix:** `process(s)`.

---

## Bug 10 — Single var multiple assertion
```go
v, ok := i.(int)
v, ok = i.(string)   // v allaqachon int — compile error
```
**Bug:** `v` int. String assign qilolmaysiz.
**Fix:**
```go
n, ok := i.(int)
if !ok { s, ok := i.(string); ... }
```

Yoki — type switch.

---

## Bug 11 — Errors comparison
```go
var ErrNotFound = errors.New("not found")

err := someOp()
if err == ErrNotFound { ... }
```
**Bug:** Wrapped error-larni topmaydi.
**Fix:** `if errors.Is(err, ErrNotFound) { ... }`.

---

## Bug 12 — Generic type assertion
```go
func first[T any](xs []any) T {
    return xs[0].(T)
}
```
**Bug:** Compile error — type parameter assertion (Go 1.18 limitation).
**Fix:** Use a type switch or convert to a concrete type.

Actually (Go 1.18+ — this is OK):
```go
func first[T any](xs []any) (T, bool) {
    if len(xs) == 0 { var zero T; return zero, false }
    v, ok := xs[0].(T)
    return v, ok
}
```
