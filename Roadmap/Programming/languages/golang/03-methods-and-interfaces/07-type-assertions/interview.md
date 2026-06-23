# Type Assertions — Interview Questions

## Junior

### Q1: Type assertion syntax?
**Answer:** `v := i.(T)` (panics on mismatch) or `v, ok := i.(T)` (safe).

### Q2: When does the single-value form panic?
**Answer:** When the dynamic type of `i` is not T.

### Q3: Is the two-value form safe?
**Answer:** Yes. On mismatch `ok=false` and there is no panic.

### Q4: Result of `var i any = nil; v, ok := i.(int)`?
**Answer:** `v=0, ok=false`.

### Q5: What is used for custom error inspection?
**Answer:** `errors.As(err, &target)` (Go 1.13+).

---

## Middle

### Q6: How does interface-to-interface assertion work?
**Answer:** It succeeds when the concrete type satisfies the new interface. The method set is checked.

### Q7: Difference between type assertion and type switch?
**Answer:** Assertion handles a single type. A switch handles multiple types and is optimized for that case.

### Q8: Does assertion work on a wrapped error?
**Answer:** No — only direct matches. `errors.As` calls `Unwrap()`.

### Q9: Difference between `errors.Is` and `errors.As`?
**Answer:**
- `Is` — sentinel error comparison (`err == target`)
- `As` — type assertion + Unwrap chain walk

### Q10: Pointer assertion example?
```go
type T struct{}
var i any = &T{}
p, ok := i.(*T)   // p is *T, ok=true
```

---

## Senior

### Q11: Type assertion internals?
**Answer:**
- Read the dynamic type from the itab
- Compare with the target T
- On match — extract the value; on mismatch — panic or false
- Interface-to-interface — method set match
- itab caching makes repeated assertions fast

### Q12: Performance — assertion vs switch?
**Answer:** Roughly equal (~1–2 ns). A switch is an optimized jump for many types.

### Q13: Architectural rule — when to use assertion?
**Answer:** As an escape hatch — error inspection, capability checks, plugin discovery. Prefer interfaces in domain logic.

### Q14: When do generics replace assertion?
**Answer:** Type-safe containers and a single algorithm parameterized by type. For heterogeneous values, assertion is still required.

### Q15: How does the `errors.As` Unwrap chain work?
**Answer:** It first asserts to the target type. On mismatch it calls `err.Unwrap()` and retries. It continues until found or nil.

---

## Tricky

### Q16: What does the following code print?
```go
type T struct{}
var i any = T{}
p, ok := i.(*T)
fmt.Println(p, ok)
```
**Answer:** `<nil> false`. The value is T, not *T.

### Q17: What does the following code print?
```go
err := fmt.Errorf("wrap: %w", &MyErr{})
e, ok := err.(*MyErr)
fmt.Println(e, ok)
```
**Answer:** `nil false`. The error is wrapped — direct assertion does not work.

### Q18: What does the following code do?
```go
var i any = nil
v := i.(int)
```
**Answer:** Panics — single-value form on a nil interface.

### Q19: Does `i.(any)` work?
**Answer:** Yes. For any interface type. In practice it is useless.

### Q20: What does the following code print?
```go
var p *T = nil
var i any = p
v, ok := i.(*T)
fmt.Println(v, ok)
```
**Answer:** `<nil> true`. The type *T matches; the value is nil.

---

## Coding Tasks

### Task 1: Safe getter

```go
func GetString(m map[string]any, key string) (string, bool) {
    v, ok := m[key]
    if !ok { return "", false }
    s, ok := v.(string)
    return s, ok
}
```

### Task 2: Custom error check

```go
type NotFound struct{ ID string }
func (e *NotFound) Error() string { return "not found: " + e.ID }

func handle(err error) {
    var nf *NotFound
    if errors.As(err, &nf) {
        fmt.Println("ID:", nf.ID)
    }
}
```

### Task 3: Optional capability

```go
type Resetter interface { Reset() }

func ResetIfPossible(x any) {
    if r, ok := x.(Resetter); ok { r.Reset() }
}
```

### Task 4: Generic safe assert

```go
func SafeAssert[T any](i any) (T, bool) {
    v, ok := i.(T)
    return v, ok
}
```

### Task 5: Recursive descent

```go
func describe(i any) string {
    switch v := i.(type) {
    case nil:
        return "nil"
    case int:
        return fmt.Sprintf("int:%d", v)
    case string:
        return fmt.Sprintf("str:%s", v)
    case []any:
        items := []string{}
        for _, x := range v { items = append(items, describe(x)) }
        return "[" + strings.Join(items, ",") + "]"
    case map[string]any:
        var sb strings.Builder
        sb.WriteString("{")
        for k, x := range v {
            sb.WriteString(k + ":" + describe(x) + ",")
        }
        sb.WriteString("}")
        return sb.String()
    default:
        return fmt.Sprintf("unknown:%T", v)
    }
}
```
