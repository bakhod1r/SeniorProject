# Empty Interfaces — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [`any` Alias History](#any-alias-history)
3. [Boxing Mechanics](#boxing-mechanics)
4. [Reflection with any](#reflection-with-any)
5. [JSON and Dynamic Data](#json-and-dynamic-data)
6. [Type Switch Deep Dive](#type-switch-deep-dive)
7. [When NOT to Use any](#when-not-to-use-any)
8. [Migrating any to Generics](#migrating-any-to-generics)
9. [Patterns](#patterns)
10. [Test](#test)
11. [Cheat Sheet](#cheat-sheet)

---

## Introduction

After the junior level, we look at the empty interface's internal mechanics, real-world context, and alternatives.

---

## `any` Alias History

### Before Go 1.18

```go
func PrintAll(args ...interface{}) { ... }
```

### Go 1.18+

```go
func PrintAll(args ...any) { ... }
```

`any` is an alias for `interface{}`. **Same type**, only the syntax changed:

```go
type any = interface{}
```

### Migrate

```bash
gofmt -r 'interface{} -> any' -w .
```

Or `gopls` will suggest it for you.

### Standard library

Go 1.18+ standard library uses `any` instead of `interface{}` (`fmt.Println`, `json.Marshal`).

---

## Boxing Mechanics

### Value type -> any

```go
var x int = 42
var i any = x   // boxing
```

The value of `x` is copied to the heap. The interface value:

```
i = (type: int, ptr: <heap address with 42>)
```

### Pointer type -> any

```go
var x int = 42
var p *int = &x
var i any = p   // no boxing of int — the pointer is stored
```

`i = (type: *int, ptr: <address>)` — no extra allocation.

### Compiler optimization

For small types (<= 8 bytes), the Go runtime applies certain optimizations. But in the general case — heap allocation.

```bash
go build -gcflags='-m'
# x escapes to heap
```

### Avoiding boxing

1. **Use generics** (1.18+) — type parameters are faster.
2. **Use a specific interface** with methods — boxing still occurs, but you get method dispatch.
3. **Use a pointer** — `var i any = &x`.

---

## Reflection with any

### `reflect.TypeOf` and `reflect.ValueOf`

```go
import "reflect"

func describe(x any) {
    t := reflect.TypeOf(x)
    v := reflect.ValueOf(x)
    fmt.Printf("type: %s, value: %v, kind: %s\n", t, v, t.Kind())
}

describe(42)         // type: int, value: 42, kind: int
describe("hello")    // type: string, value: hello, kind: string
describe([]int{1})   // type: []int, value: [1], kind: slice
```

### Accessing fields

```go
type User struct{ Name string; Age int }

u := User{Name: "Alice", Age: 30}
v := reflect.ValueOf(u)

for i := 0; i < v.NumField(); i++ {
    f := v.Field(i)
    fmt.Printf("%s: %v\n", v.Type().Field(i).Name, f.Interface())
}
```

### Performance

Reflection is **very slow**. Typical: 100+ ns/op. Don't use it on hot paths.

---

## JSON and Dynamic Data

### Generic unmarshal

```go
var data any
json.Unmarshal([]byte(`{"name":"Alice","age":30}`), &data)

// data is map[string]any
m := data.(map[string]any)
fmt.Println(m["name"])  // Alice
fmt.Println(m["age"])   // 30 (float64, JSON numbers default to float64)
```

### When the schema is unknown

```go
var raw any
if err := json.Unmarshal(payload, &raw); err != nil { ... }

// Recursively explore
var explore func(a any, depth int)
explore = func(a any, depth int) {
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
explore(raw, 0)
```

### When the schema is known

```go
type User struct{ Name string; Age int }

var u User
json.Unmarshal(payload, &u)   // any not needed
```

Type-safe and fast.

---

## Type Switch Deep Dive

### Syntax

```go
switch v := i.(type) {
case int:
    // v is int
case string:
    // v is string
case nil:
    // i is nil interface
default:
    // unknown
}
```

### Multi-case

```go
switch v := i.(type) {
case int, int64:
    // v is `any` (the common type), because the type isn't determined
    fmt.Println(v)
case string:
    // v is string
}
```

### Type switch with return

```go
func describe(i any) string {
    switch v := i.(type) {
    case int:
        return strconv.Itoa(v)
    case string:
        return v
    default:
        return fmt.Sprint(i)
    }
}
```

### Performance

A type switch is faster than several type assertions. The compiler optimizes it.

---

## When NOT to Use any

### 1. The concrete type is known

```go
// Bad
func ProcessUser(u any) { ... }

// Good
func ProcessUser(u User) { ... }
```

### 2. Same algorithm, different types — generics

```go
// Bad
func Sum(xs []any) any {
    var total int
    for _, x := range xs { total += x.(int) }
    return total
}

// Good
func Sum[T int | int64 | float64](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

### 3. Map values have a known type

```go
// Bad
config := map[string]any{
    "port":  8080,
    "host":  "localhost",
    "debug": true,
}

// Good
type Config struct {
    Port  int
    Host  string
    Debug bool
}
```

### 4. Hot path

```go
// Bad — boxing/unboxing on every iteration
for _, x := range items {
    process(x.(int) * 2)
}

// Good — concrete slice
items := []int{1, 2, 3}
for _, x := range items {
    process(x * 2)
}
```

---

## Migrating any to Generics

### Example 1: Container

```go
// Old
type List struct { items []any }
func (l *List) Add(x any)     { l.items = append(l.items, x) }
func (l *List) Get(i int) any { return l.items[i] }

// New
type List[T any] struct { items []T }
func (l *List[T]) Add(x T)     { l.items = append(l.items, x) }
func (l *List[T]) Get(i int) T { return l.items[i] }
```

### Example 2: Functional

```go
// Old
func Map(xs []any, f func(any) any) []any { ... }

// New
func Map[T, U any](xs []T, f func(T) U) []U {
    out := make([]U, len(xs))
    for i, x := range xs { out[i] = f(x) }
    return out
}
```

### Example 3: Sum

```go
// Old
func Sum(xs []any) int {
    total := 0
    for _, x := range xs { total += x.(int) }
    return total
}

// New
type Number interface { int | int64 | float64 }
func Sum[T Number](xs []T) T {
    var total T
    for _, x := range xs { total += x }
    return total
}
```

---

## Patterns

### Pattern 1: Variadic for printf-style

```go
func Logf(format string, args ...any) {
    fmt.Printf(time.Now().Format(time.RFC3339)+" "+format+"\n", args...)
}
```

### Pattern 2: Map[string]any for config

```go
func Apply(opts map[string]any) {
    if port, ok := opts["port"].(int); ok { ... }
    if host, ok := opts["host"].(string); ok { ... }
}
```

### Pattern 3: Type-asserting helper

```go
func GetString(m map[string]any, key string) (string, bool) {
    v, ok := m[key]
    if !ok { return "", false }
    s, ok := v.(string)
    return s, ok
}
```

### Pattern 4: Plugin / dispatch

```go
type Handler interface { Handle(any) any }

handlers := map[string]Handler{
    "add": addHandler{},
    "sub": subHandler{},
}
```

---

## Test

### 1. Difference between `interface{}` and `any`?
**Answer:** None — it's an alias.

### 2. When does boxing happen?
**Answer:** When you assign a value type to any — a copy goes to the heap.

### 3. Two forms of type assertion?
**Answer:**
- Single-value: `v := i.(T)` — panics on mismatch
- Two-value: `v, ok := i.(T)` — `ok = false` on mismatch

### 4. What does generic JSON unmarshal return as any?
**Answer:** Object -> `map[string]any`, Array -> `[]any`, Number -> `float64`, String -> `string`, Bool -> `bool`, null -> `nil`.

### 5. When are generics preferable to any?
**Answer:** Same algorithm + different types — generics are faster and type-safe.

---

## Cheat Sheet

```
ANY ALIAS
─────────────────
any = interface{}   (Go 1.18+)
Same type, new syntax

BOXING
─────────────────
Value -> any: heap allocation
Pointer -> any: no boxing (just type info)

REFLECTION
─────────────────
reflect.TypeOf(x), reflect.ValueOf(x)
Slow (~100 ns), don't use on hot paths

JSON
─────────────────
Schema known -> struct (type-safe)
Schema unknown -> any
Numbers -> float64 by default

TYPE SWITCH
─────────────────
switch v := i.(type) {
case T1: ...
case T2, T3: ...   // v stays as any
default: ...
}

WHEN TO USE
─────────────────
+ Heterogeneous collection
+ Dynamic data (JSON)
+ Working with reflect
- Same algorithm — generics
- Concrete type is known
- Hot path
```

---

## Summary

At the middle level, the empty interface:
- `any` = `interface{}` alias (1.18+)
- Boxing — value types go to the heap
- Reflection is slow — don't use on hot paths
- Useful for JSON dynamic data
- Type switch — multi-type checking
- Generics are preferable — same algo + different types
- Migration — any -> generics

At the senior level we'll dive deep into performance, internals, and architectural concerns.
