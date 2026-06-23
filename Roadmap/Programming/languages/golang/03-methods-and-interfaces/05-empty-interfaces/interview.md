# Empty Interfaces — Interview Questions

## Junior

### Q1: Difference between `interface{}` and `any`?
**Answer:** None. `any` is a Go 1.18+ alias.

### Q2: Why does the empty interface accept any type?
**Answer:** Every type satisfies "0 methods".

### Q3: Type assertion syntax?
**Answer:** `v, ok := i.(T)` (safe) or `v := i.(T)` (panic on mismatch).

### Q4: Result of `var i any = nil; i == nil`?
**Answer:** `true`.

### Q5: Result of `var p *int = nil; var i any = p; i == nil`?
**Answer:** `false` — type info is present.

---

## Middle

### Q6: What is boxing and when does it occur?
**Answer:** Moving a value type to the heap when assigning it to any.

### Q7: What types does generic JSON unmarshal return for `any`?
**Answer:** Object → `map[string]any`, array → `[]any`, number → `float64`, string → `string`, bool → `bool`, null → `nil`.

### Q8: Difference between type switch and type assertion?
**Answer:** Type switch — checking multiple types, optimized. Type assertion — a single type.

### Q9: When to choose generics over `any`?
**Answer:** Same algorithm + different types — generics. Heterogeneous collection — any.

### Q10: Difference between internal `eface` and `iface` structures?
**Answer:** `eface` (empty) — type + data. `iface` (non-empty) — itab + data. Same size (16 bytes), different internal structure.

---

## Senior

### Q11: Performance impact of `any`?
**Answer:** Boxing (heap alloc), type assertion overhead, breaks inlining.

### Q12: When to use reflection and when not?
**Answer:** Reflection is slow (~100 ns). When the schema is unknown. Not in hot paths.

### Q13: `any` is OK at API boundaries but bad in domain core — why?
**Answer:** Boundary — dynamic input. Domain — type-safety, validation, documentation.

### Q14: When to migrate from `any` to generics?
**Answer:** Same algorithm + types, container, hot path. JSON/reflect/heterogeneous — kept as is.

### Q15: When does `any` comparison panic?
**Answer:** When the concrete type is non-comparable (slice, map, struct with such fields).

---

## Tricky

### Q16: What does the following code produce?
```go
var i, j any = []int{1}, []int{1}
fmt.Println(i == j)
```
- a) true
- b) false
- c) panic
- d) compile error

**Answer: c — runtime panic** (slice not comparable).

### Q17: What does the following code produce?
```go
func ret() any { return nil }
i := ret()
fmt.Println(i == nil)
```
**Answer:** `true` — nil is returned directly, no type.

### Q18: What does the following code produce?
```go
var p *MyType = nil
func ret() any { return p }
i := ret()
fmt.Println(i == nil)
```
**Answer:** `false` — type *MyType is present.

### Q19: Difference between `[]any` and variadic `...any`?
**Answer:**
- `[]any` — slice
- `...any` — variadic param, inside the function it is `[]any`

### Q20: How does `fmt.Println("a", 1, true)` work?
**Answer:** Variadic `...any` — accepts various types. Internally formats via reflect.

---

## Coding Tasks

### Task 1: Type-asserting helper

```go
func GetString(m map[string]any, key string) (string, bool) {
    v, ok := m[key]
    if !ok { return "", false }
    s, ok := v.(string)
    return s, ok
}
```

### Task 2: Variadic logger

```go
func Logf(format string, args ...any) {
    fmt.Printf(time.Now().Format(time.RFC3339)+" "+format+"\n", args...)
}
```

### Task 3: Generic stack (1.18+)

```go
type Stack[T any] struct{ items []T }
func (s *Stack[T]) Push(x T)            { s.items = append(s.items, x) }
func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    last := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return last, true
}
```

### Task 4: JSON dynamic explore

```go
func explore(a any, depth int) {
    indent := strings.Repeat("  ", depth)
    switch v := a.(type) {
    case map[string]any:
        for k, val := range v {
            fmt.Printf("%s%s:\n", indent, k)
            explore(val, depth+1)
        }
    case []any:
        for i, val := range v {
            fmt.Printf("%s[%d]:\n", indent, i)
            explore(val, depth+1)
        }
    default:
        fmt.Printf("%s%v (%T)\n", indent, v, v)
    }
}
```

### Task 5: Type-safe migration

```go
// Before
type Cache struct { m map[string]any }

// After
type Cache[T any] struct { m map[string]T }
```
