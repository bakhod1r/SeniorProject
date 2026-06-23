# Type Assertions — Tasks

## Easy 🟢

### Task 1
Safely extract a string from `var i any = "hello"`.

### Task 2
Extract an int from `var i any = 42`; on failure default to `0`.

### Task 3
`describe(i any) string` — handle nil and three types.

### Task 4
Helper for extracting an int from a `map[string]any`.

### Task 5
If an `any` value satisfies `Stringer`, call `String()`.

---

## Medium 🟡

### Task 6
Inspect an error chain using `errors.As`.

### Task 7
Extract a deeply-nested `string` from a JSON-decoded `any`.

### Task 8
`Closer` capability — close every argument that supports it.

### Task 9
Pointer assertion — distinguish `*T` from `T`.

### Task 10
Convert a chain of multiple assertions into a type switch.

---

## Hard 🔴

### Task 11
Generic safe assert: `SafeAssert[T any](i any) (T, bool)`.

### Task 12
Recursive `describe` — slice/map/primitive aware.

### Task 13
Plugin discovery — using a `Configurable` capability.

### Task 14
JSON schema validator using type assertion.

---

## Solutions

### Solution 1
```go
var i any = "hello"
s, ok := i.(string)
if ok { fmt.Println(s) }
```

### Solution 2
```go
n, _ := i.(int)
if n == 0 { /* default */ }
```

### Solution 3
```go
func describe(i any) string {
    switch v := i.(type) {
    case nil:    return "nil"
    case int:    return fmt.Sprintf("int:%d", v)
    case string: return fmt.Sprintf("str:%s", v)
    case bool:   return fmt.Sprintf("bool:%v", v)
    default:     return "unknown"
    }
}
```

### Solution 4
```go
func GetInt(m map[string]any, key string) (int, bool) {
    v, ok := m[key]
    if !ok { return 0, false }
    n, ok := v.(int)
    return n, ok
}
```

### Solution 5
```go
if s, ok := i.(fmt.Stringer); ok {
    fmt.Println(s.String())
}
```

### Solution 6
```go
type NotFound struct{ ID string }
func (e *NotFound) Error() string { return "nf:" + e.ID }

err := fmt.Errorf("wrap: %w", &NotFound{ID: "x"})

var nf *NotFound
if errors.As(err, &nf) {
    fmt.Println("ID:", nf.ID)   // x
}
```

### Solution 7
```go
func GetNested(m map[string]any, keys ...string) (string, bool) {
    var current any = m
    for i, k := range keys {
        cm, ok := current.(map[string]any)
        if !ok { return "", false }
        v, ok := cm[k]
        if !ok { return "", false }
        if i == len(keys)-1 {
            s, ok := v.(string)
            return s, ok
        }
        current = v
    }
    return "", false
}
```

### Solution 8
```go
func CloseAll(args ...any) {
    for _, a := range args {
        if c, ok := a.(io.Closer); ok {
            c.Close()
        }
    }
}
```

### Solution 9
```go
type T struct{}
var i any = T{}    // value
var j any = &T{}   // pointer

if _, ok := i.(*T); !ok { fmt.Println("i is value") }
if _, ok := j.(*T); ok  { fmt.Println("j is pointer") }
```

### Solution 10
```go
// Before
if s, ok := i.(string); ok { handleStr(s) }
if n, ok := i.(int); ok    { handleInt(n) }

// After
switch v := i.(type) {
case string: handleStr(v)
case int:    handleInt(v)
}
```

### Solution 11
```go
func SafeAssert[T any](i any) (T, bool) {
    v, ok := i.(T)
    return v, ok
}

n, ok := SafeAssert[int](someAny)
```

### Solution 12
```go
func describe(i any) string {
    switch v := i.(type) {
    case nil:
        return "nil"
    case bool:
        return fmt.Sprintf("%v", v)
    case int:
        return fmt.Sprintf("%d", v)
    case float64:
        return fmt.Sprintf("%g", v)
    case string:
        return fmt.Sprintf("%q", v)
    case []any:
        parts := make([]string, len(v))
        for i, x := range v { parts[i] = describe(x) }
        return "[" + strings.Join(parts, ",") + "]"
    case map[string]any:
        keys := make([]string, 0, len(v))
        for k := range v { keys = append(keys, k) }
        sort.Strings(keys)
        parts := make([]string, 0, len(keys))
        for _, k := range keys {
            parts = append(parts, fmt.Sprintf("%q:%s", k, describe(v[k])))
        }
        return "{" + strings.Join(parts, ",") + "}"
    default:
        return fmt.Sprintf("<%T>", v)
    }
}
```

### Solution 13
```go
type Plugin interface { Run() error }
type Configurable interface { Configure(map[string]any) error }

func StartPlugin(p Plugin, cfg map[string]any) error {
    if c, ok := p.(Configurable); ok {
        if err := c.Configure(cfg); err != nil { return err }
    }
    return p.Run()
}
```

### Solution 14
```go
type Schema struct{ Required []string; Types map[string]string }

func Validate(data any, s Schema) error {
    m, ok := data.(map[string]any)
    if !ok { return errors.New("expected object") }
    for _, req := range s.Required {
        if _, ok := m[req]; !ok {
            return fmt.Errorf("missing required: %s", req)
        }
    }
    for k, expectedType := range s.Types {
        v, ok := m[k]
        if !ok { continue }
        switch expectedType {
        case "string":
            if _, ok := v.(string); !ok { return fmt.Errorf("%s must be string", k) }
        case "number":
            if _, ok := v.(float64); !ok { return fmt.Errorf("%s must be number", k) }
        case "bool":
            if _, ok := v.(bool); !ok { return fmt.Errorf("%s must be bool", k) }
        }
    }
    return nil
}
```
