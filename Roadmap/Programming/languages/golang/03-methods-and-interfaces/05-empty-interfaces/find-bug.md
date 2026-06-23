# Empty Interfaces — Find the Bug

## Bug 1 — nil any vs nil concrete
```go
func ret() any {
    var p *int = nil
    return p
}
i := ret()
if i == nil { fmt.Println("nil") } else { fmt.Println("not nil") }
```
**Bug:** Output `not nil`. Interface (type: *int, value: nil).
**Fix:**
```go
func ret() any {
    var p *int = nil
    if p == nil { return nil }
    return p
}
```

---

## Bug 2 — Type assertion panic
```go
var i any = 42
s := i.(string)
```
**Bug:** Panic.
**Fix:** `s, ok := i.(string); if !ok { ... }`.

---

## Bug 3 — Comparison panic
```go
var i any = []int{1, 2}
var j any = []int{1, 2}
if i == j { ... }
```
**Bug:** Panic — slice not comparable.
**Fix:** `reflect.DeepEqual(i, j)` or specific equality.

---

## Bug 4 — Map[string]any boxing
```go
m := map[string]any{}
for i := 0; i < 1e6; i++ {
    m[fmt.Sprintf("k%d", i)] = i   // each i goes to the heap
}
```
**Bug:** Large memory profile — each int goes to the heap.
**Fix:** Use `map[string]int{}`, or generics if needed.

---

## Bug 5 — JSON number → float64
```go
var data any
json.Unmarshal([]byte(`{"age": 30}`), &data)
m := data.(map[string]any)
age := m["age"].(int)   // panic
```
**Bug:** JSON numbers default to `float64`.
**Fix:** `m["age"].(float64)` or use a struct.

---

## Bug 6 — Variadic any forwarding
```go
func Wrap(args ...any) {
    fmt.Println(args)   // prints []any
}
```
**Bug:** `fmt.Println(args)` — args is the entire slice. To forward:
**Fix:** `fmt.Println(args...)`.

---

## Bug 7 — `interface{}{...}` literal style issue
```go
m := map[string]interface{}{
    "key": "value"
}
```
**Not a bug, but style:** Go 1.18+ — `any` is preferred:
```go
m := map[string]any{"key": "value"}
```

---

## Bug 8 — Reflect on nil
```go
var i any = nil
t := reflect.TypeOf(i)
fmt.Println(t)
```
**Bug:** Output `<nil>` (nil type).
**Fix:**
```go
if i == nil { return }
t := reflect.TypeOf(i)
```

---

## Bug 9 — Type switch has no fallthrough
```go
switch v := i.(type) {
case int:
    fmt.Println("int:", v)
    fallthrough  // ?
case string:
    fmt.Println("string:", v)
}
```
**Bug:** `fallthrough` does not work in type switch (compile error).
**Fix:** Write multi-case or separate logic per case.

---

## Bug 10 — `any` lookup expensive
```go
type Lookup struct{ data map[any]any }

l := &Lookup{data: map[any]any{}}
for i := 0; i < 1e6; i++ {
    if l.data[i] != nil { ... }
}
```
**Bug:** Map[any]any — boxing and hashing on every lookup.
**Fix:** Use `map[int]int`.
