# Empty Interfaces — Tasks

## Easy 🟢

### Task 1
Get the value of `var i any = 42` as int (type assertion).

### Task 2
`describe(i any) string` — return the type name using a type switch.

### Task 3
`Print(args ...any)` variadic — print each argument separately.

### Task 4
Helper to get a `string` value out of `map[string]any`.

### Task 5
Use `any` in JSON unmarshal to find the `name` field.

---

## Medium 🟡

### Task 6
`Container struct{ items []any }` — `Add`, `Get`, `Len` methods.

### Task 7
`SafeAssert[T any](i any) (T, bool)` — generic helper.

### Task 8
`Equal(a, b any) bool` — `==` when comparable, otherwise false.

### Task 9
Recursively explore JSON with an unknown schema.

### Task 10
Migrate from `any` to generics: `Stack` type.

---

## Hard 🔴

### Task 11
`Bus` (event bus) — `Publish(name string, payload any)`, `Subscribe(name, handler)`.

### Task 12
`Cache` — `Set(key string, val any, ttl time.Duration)`, `Get(key string) any`.

### Task 13
Functional options via `map[string]any` — with validation.

### Task 14
Use `reflect` instead of `any` to inspect fields.

---

## Solutions

### Solution 1
```go
var i any = 42
n, ok := i.(int)
if ok { fmt.Println(n) }
```

### Solution 2
```go
func describe(i any) string {
    switch i.(type) {
    case int:    return "int"
    case string: return "string"
    case bool:   return "bool"
    case nil:    return "nil"
    default:     return "unknown"
    }
}
```

### Solution 3
```go
func Print(args ...any) {
    for _, a := range args { fmt.Println(a) }
}
```

### Solution 4
```go
func GetString(m map[string]any, key string) (string, bool) {
    v, ok := m[key]
    if !ok { return "", false }
    s, ok := v.(string)
    return s, ok
}
```

### Solution 5
```go
var data any
json.Unmarshal([]byte(`{"name":"Alice"}`), &data)
m := data.(map[string]any)
fmt.Println(m["name"])
```

### Solution 6
```go
type Container struct{ items []any }
func (c *Container) Add(x any)     { c.items = append(c.items, x) }
func (c *Container) Get(i int) any { return c.items[i] }
func (c *Container) Len() int      { return len(c.items) }
```

### Solution 7
```go
func SafeAssert[T any](i any) (T, bool) {
    v, ok := i.(T)
    return v, ok
}

n, ok := SafeAssert[int](someAny)
```

### Solution 8
```go
func Equal(a, b any) bool {
    defer func() { recover() }()  // catch panic
    return a == b
}
```

### Solution 9
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

### Solution 10
```go
type Stack[T any] struct{ items []T }

func (s *Stack[T]) Push(x T) { s.items = append(s.items, x) }

func (s *Stack[T]) Pop() (T, bool) {
    var zero T
    if len(s.items) == 0 { return zero, false }
    last := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return last, true
}
```

### Solution 11
```go
type Bus struct {
    mu       sync.RWMutex
    handlers map[string][]func(any)
}

func NewBus() *Bus { return &Bus{handlers: map[string][]func(any){}} }

func (b *Bus) Subscribe(name string, h func(any)) {
    b.mu.Lock(); defer b.mu.Unlock()
    b.handlers[name] = append(b.handlers[name], h)
}

func (b *Bus) Publish(name string, payload any) {
    b.mu.RLock()
    handlers := b.handlers[name]
    b.mu.RUnlock()
    for _, h := range handlers { h(payload) }
}
```

### Solution 12
```go
type entry struct { val any; expiresAt time.Time }
type Cache struct { mu sync.RWMutex; m map[string]entry }

func NewCache() *Cache { return &Cache{m: map[string]entry{}} }

func (c *Cache) Set(key string, val any, ttl time.Duration) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.m[key] = entry{val: val, expiresAt: time.Now().Add(ttl)}
}

func (c *Cache) Get(key string) (any, bool) {
    c.mu.RLock()
    e, ok := c.m[key]
    c.mu.RUnlock()
    if !ok { return nil, false }
    if time.Now().After(e.expiresAt) { return nil, false }
    return e.val, true
}
```

### Solution 13
```go
type Server struct{ port int; debug bool }

func New(opts map[string]any) (*Server, error) {
    s := &Server{port: 80}
    if v, ok := opts["port"]; ok {
        p, ok := v.(int)
        if !ok { return nil, errors.New("port must be int") }
        s.port = p
    }
    if v, ok := opts["debug"]; ok {
        d, ok := v.(bool)
        if !ok { return nil, errors.New("debug must be bool") }
        s.debug = d
    }
    return s, nil
}
```

### Solution 14
```go
import "reflect"

func InspectFields(x any) {
    t := reflect.TypeOf(x)
    v := reflect.ValueOf(x)
    if t.Kind() == reflect.Ptr {
        t = t.Elem()
        v = v.Elem()
    }
    for i := 0; i < t.NumField(); i++ {
        f := t.Field(i)
        val := v.Field(i)
        fmt.Printf("%s (%s): %v\n", f.Name, f.Type, val.Interface())
    }
}
```
